const router = require('express').Router();
const auth   = require('../middleware/auth');
const http   = require('http');
const db     = require('../utils/db');

// Execute command in amavis container via Docker socket
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

const AMAVIS_CONTAINER = process.env.AMAVIS_CONTAINER || 'mailguard-amavis';

// POST /api/bayes/train — train SpamAssassin with a quarantined message
router.post('/train', auth, async (req, res, next) => {
  try {
    const { queue_id, train_type } = req.body; // train_type: 'spam' | 'ham'
    if (!queue_id || !['spam','ham'].includes(train_type))
      return res.status(400).json({ error: 'queue_id and train_type (spam|ham) required' });

    // Get raw message from Postfix queue via quarantine route logic
    const quarantineContainer = process.env.POSTFIX_CONTAINER || 'mailguard-postfix';
    const raw = await dockerExec(quarantineContainer, `postcat -q ${queue_id} 2>/dev/null`);
    if (!raw || raw.length < 10)
      return res.status(404).json({ error: 'Message not found in queue' });

    // Write to temp file in amavis container and run sa-learn
    const tmpFile = `/tmp/train_${queue_id}_${Date.now()}.eml`;
    const escapedRaw = raw.replace(/'/g, "'\\''");
    const output = await dockerExec(AMAVIS_CONTAINER,
      `echo '${escapedRaw}' > ${tmpFile} && \
       su amavis -s /bin/sh -c "sa-learn --${train_type} ${tmpFile}" 2>&1 && \
       rm -f ${tmpFile}`
    );

    // Log training event
    const [evRows] = await db.query(
      'SELECT sender, subject FROM mail_events WHERE queue_id=? LIMIT 1', [queue_id]
    );
    await db.query(
      'INSERT INTO bayes_training_log (queue_id, sender, subject, train_type, trained_by) VALUES (?,?,?,?,?)',
      [queue_id, evRows[0]?.sender||null, evRows[0]?.subject||null, train_type, req.user.email]
    );

    res.json({ ok: true, output: output.trim() });
  } catch(e) { next(e); }
});

// GET /api/bayes/stats — get Bayes database stats
router.get('/stats', auth, async (req, res, next) => {
  try {
    const output = await dockerExec(AMAVIS_CONTAINER,
      'su amavis -s /bin/sh -c "sa-learn --dump magic" 2>&1'
    );
    const stats  = {};
    output.split('\n').forEach(line => {
      const m = line.match(/^0\s+(\d+)\s+(\d+)\s+(.+)$/);
      if (m) stats[m[3].trim()] = parseInt(m[2]);
    });

    const [trainLog] = await db.query(
      `SELECT train_type, COUNT(*) cnt FROM bayes_training_log
       GROUP BY train_type`
    );

    res.json({ stats, training_counts: trainLog });
  } catch(e) {
    res.json({ stats: {}, training_counts: [], error: e.message });
  }
});

// POST /api/bayes/rebuild — rebuild Bayes database
router.post('/rebuild', auth, async (req, res, next) => {
  try {
    const output = await dockerExec(AMAVIS_CONTAINER,
      'su amavis -s /bin/sh -c "sa-learn --rebuild" 2>&1'
    );
    res.json({ ok: true, output: output.trim() });
  } catch(e) { next(e); }
});

module.exports = router;