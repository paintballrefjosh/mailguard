const router = require('express').Router();
const auth   = require('../middleware/auth');
const http   = require('http');

const POSTFIX_CONTAINER = process.env.POSTFIX_CONTAINER || 'mailguard-postfix';

function dockerExec(container, cmd) {
  return new Promise((resolve, reject) => {
    const body = JSON.stringify({
      AttachStdout: true, AttachStderr: true,
      Cmd: ['sh', '-c', cmd],
    });
    const req = http.request({
      socketPath: '/var/run/docker.sock',
      path:       `/containers/${container}/exec`,
      method:     'POST',
      headers:    { 'Content-Type': 'application/json', 'Content-Length': body.length },
    }, res => {
      let data = '';
      res.on('data', c => data += c);
      res.on('end', () => {
        try {
          const { Id } = JSON.parse(data);
          const startBody = JSON.stringify({ Detach: false, Tty: false });
          const sr = http.request({
            socketPath: '/var/run/docker.sock',
            path:       `/exec/${Id}/start`,
            method:     'POST',
            headers:    { 'Content-Type': 'application/json', 'Content-Length': startBody.length },
          }, sres => {
            const chunks = [];
            sres.on('data', c => chunks.push(c));
            sres.on('end', () => {
              const buf = Buffer.concat(chunks);
              let out = '';
              let i = 0;
              while (i + 8 <= buf.length) {
                const size = buf.readUInt32BE(i + 4);
                out += buf.slice(i + 8, i + 8 + size).toString();
                i += 8 + size;
              }
              resolve(out);
            });
          });
          sr.on('error', reject);
          sr.write(startBody);
          sr.end();
        } catch(e) { reject(e); }
      });
    });
    req.on('error', reject);
    req.write(body);
    req.end();
  });
}

// Parse postqueue -p output into structured items
function parseQueue(raw) {
  const items = [];
  if (!raw || !raw.trim()) return items;

  const blocks = raw.split(/\n(?=[\w-]{6,}[\*!]?\s)/);
  for (const block of blocks) {
    const lines = block.trim().split('\n');
    if (!lines[0] || lines[0].startsWith('Mail queue is empty')) continue;

    // First line: queue_id [*!] size date sender
    const m = lines[0].match(/^([A-F0-9a-f]+)([\*!]?)\s+(\d+)\s+(\w{3}\s+\w{3}\s+\d+\s+[\d:]+)\s+(.+)$/);
    if (!m) continue;

    const [, id, flags, size, date, sender] = m;
    const status = flags === '*' ? 'active' : flags === '!' ? 'hold' : 'deferred';
    const recipients = [];
    let reason = '';

    for (let i = 1; i < lines.length; i++) {
      const l = lines[i].trim();
      if (!l) continue;
      if (l.startsWith('(') && l.endsWith(')')) {
        reason = l.slice(1, -1);
      } else if (l.includes('@') || l.match(/^[a-zA-Z0-9._+-]+$/)) {
        recipients.push(l);
      }
    }

    items.push({
      id, status, size: +size, date, sender,
      recipients, reason,
    });
  }
  return items;
}

// GET /api/queue — list all queued messages
router.get('/', auth, async (req, res, next) => {
  try {
    const raw   = await dockerExec(POSTFIX_CONTAINER, 'postqueue -p 2>/dev/null || echo ""');
    const items = parseQueue(raw);
    const stats = {
      total:     items.length,
      active:    items.filter(i => i.status === 'active').length,
      deferred:  items.filter(i => i.status === 'deferred').length,
      hold:      items.filter(i => i.status === 'hold').length,
    };
    res.json({ stats, items });
  } catch(e) { next(e); }
});

// POST /api/queue/flush — flush the entire queue
router.post('/flush', auth, async (req, res, next) => {
  try {
    await dockerExec(POSTFIX_CONTAINER, 'postqueue -f 2>/dev/null');
    res.json({ ok: true });
  } catch(e) { next(e); }
});

// POST /api/queue/:id/retry — retry a single message
router.post('/:id/retry', auth, async (req, res, next) => {
  try {
    const { id } = req.params;
    if (!/^[A-F0-9a-f]+$/.test(id)) return res.status(400).json({ error: 'Invalid queue ID' });
    await dockerExec(POSTFIX_CONTAINER, `postqueue -i ${id} 2>/dev/null`);
    res.json({ ok: true });
  } catch(e) { next(e); }
});

// DELETE /api/queue/:id — delete a single message from queue
router.delete('/:id', auth, async (req, res, next) => {
  try {
    const { id } = req.params;
    if (!/^[A-F0-9a-f]+$/.test(id)) return res.status(400).json({ error: 'Invalid queue ID' });
    await dockerExec(POSTFIX_CONTAINER, `postsuper -d ${id} 2>/dev/null`);
    res.json({ ok: true });
  } catch(e) { next(e); }
});

// DELETE /api/queue — delete all deferred messages
router.delete('/', auth, async (req, res, next) => {
  try {
    await dockerExec(POSTFIX_CONTAINER, 'postsuper -d ALL deferred 2>/dev/null');
    res.json({ ok: true });
  } catch(e) { next(e); }
});

module.exports = router;