const router  = require('express').Router();
const auth    = require('../middleware/auth');
const http    = require('http');

function dockerExec(cmd) {
  return new Promise((resolve, reject) => {
    const container = process.env.POSTFIX_CONTAINER || 'mailguard-postfix';
    const createBody = JSON.stringify({
      AttachStdout: true, AttachStderr: true,
      Cmd: ['sh', '-c', cmd],
    });
    const createReq = http.request({
      socketPath: '/var/run/docker.sock',
      path:       `/containers/${container}/exec`,
      method:     'POST',
      headers:    { 'Content-Type': 'application/json', 'Content-Length': createBody.length },
    }, res => {
      let data = '';
      res.on('data', c => data += c);
      res.on('end', () => {
        try {
          const { Id } = JSON.parse(data);
          const startBody = JSON.stringify({ Detach: false, Tty: false });
          const startReq  = http.request({
            socketPath: '/var/run/docker.sock',
            path:       `/exec/${Id}/start`,
            method:     'POST',
            headers:    { 'Content-Type': 'application/json', 'Content-Length': startBody.length },
          }, sres => {
            const chunks = [];
            sres.on('data', c => chunks.push(c));
            sres.on('end', () => {
              const buf = Buffer.concat(chunks);
              let out = '', i = 0;
              while (i + 8 <= buf.length) {
                const size = buf.readUInt32BE(i + 4);
                out += buf.slice(i + 8, i + 8 + size).toString();
                i += 8 + size;
              }
              resolve(out);
            });
          });
          startReq.on('error', reject);
          startReq.write(startBody);
          startReq.end();
        } catch(e) { reject(e); }
      });
    });
    createReq.on('error', reject);
    createReq.write(createBody);
    createReq.end();
  });
}

function parseQueue(raw) {
  const items = [];
  const blocks = raw.split(/\n(?=-|\s*$)/).filter(Boolean);
  for (const block of blocks) {
    const lines = block.trim().split('\n');
    if (!lines[0]) continue;
    const m = lines[0].match(/^([A-F0-9]+)\*?\s+(\d+)\s+(\w{3}\s+\w{3}\s+\d+\s+[\d:]+)\s+(.+)$/);
    if (!m) continue;
    const [, id, size, date, sender] = m;
    const recipients = [];
    let reason = '';
    for (let i = 1; i < lines.length; i++) {
      const l = lines[i].trim();
      if (l.startsWith('(')) reason = l.replace(/[()]/g, '');
      else if (l.includes('@') || l.includes('unknown')) recipients.push(l);
    }
    items.push({ id, size: +size, date, sender, recipients, reason });
  }
  return items;
}

// In-memory subject cache: { queueId -> { subject, ts } }
const subjectCache = new Map();
const SUBJECT_CACHE_TTL = 10 * 60 * 1000; // 10 minutes

async function fetchSubject(id) {
  const cached = subjectCache.get(id);
  if (cached && Date.now() - cached.ts < SUBJECT_CACHE_TTL) return cached.subject;
  try {
    const raw = await dockerExec(`postcat -q ${id} 2>/dev/null | grep -i "^Subject:" | head -1`);
    const m   = raw.match(/^Subject:\s*(.+)/im);
    const subject = m ? m[1].trim() : null;
    subjectCache.set(id, { subject, ts: Date.now() });
    return subject;
  } catch {
    return null;
  }
}

// Evict stale subject cache entries periodically
setInterval(() => {
  const now = Date.now();
  for (const [k, v] of subjectCache) {
    if (now - v.ts > SUBJECT_CACHE_TTL) subjectCache.delete(k);
  }
}, 5 * 60 * 1000);

// ── GET /api/quarantine — list with search/filter ─────────────────────────────
router.get('/', auth, async (req, res, next) => {
  try {
    const raw   = await dockerExec('postqueue -p 2>/dev/null || echo ""');
    let items   = parseQueue(raw);
    const total = items.length;

    const { search, minSize, maxSize, from, to, withSubjects } = req.query;

    // Optionally enrich with subjects (cached)
    if (withSubjects === 'true' && items.length > 0 && items.length <= 200) {
      await Promise.all(
        items.map(async item => {
          item.subject = await fetchSubject(item.id);
        })
      );
    } else {
      // Use cached subjects where available without fetching new ones
      items.forEach(item => {
        const cached = subjectCache.get(item.id);
        if (cached) item.subject = cached.subject;
      });
    }

    // Apply filters
    if (search) {
      const q = search.toLowerCase();
      items = items.filter(i =>
        i.sender?.toLowerCase().includes(q) ||
        i.reason?.toLowerCase().includes(q) ||
        i.subject?.toLowerCase().includes(q) ||
        i.recipients?.some(r => r.toLowerCase().includes(q))
      );
    }
    if (minSize) items = items.filter(i => i.size >= +minSize);
    if (maxSize) items = items.filter(i => i.size <= +maxSize);
    if (from || to) {
      const now = new Date();
      items = items.filter(i => {
        const d = new Date(`${i.date} ${now.getFullYear()}`);
        if (isNaN(d)) return true;
        if (from && d < new Date(from)) return false;
        if (to   && d > new Date(to))   return false;
        return true;
      });
    }

    res.json({ items, total, filtered: items.length });
  } catch(e) { next(e); }
});

// ── GET /api/quarantine/count — lightweight count for nav badge ───────────────
router.get('/count', auth, async (req, res, next) => {
  try {
    const raw   = await dockerExec('postqueue -p 2>/dev/null | grep -c "^[A-F0-9]" || echo 0');
    const count = parseInt(raw.trim()) || 0;
    res.json({ count });
  } catch(e) {
    res.json({ count: 0 });
  }
});

// ── GET /api/quarantine/:id/download ─────────────────────────────────────────
router.get('/:id/download', auth, async (req, res, next) => {
  try {
    const { id } = req.params;
    if (!/^[A-F0-9]+$/.test(id)) return res.status(400).json({ error: 'Invalid queue ID' });
    const eml = await dockerExec(`postcat -q ${id} 2>/dev/null`);
    res.setHeader('Content-Type', 'message/rfc822');
    res.setHeader('Content-Disposition', `attachment; filename="${id}.eml"`);
    res.send(eml);
  } catch(e) { next(e); }
});

// ── POST /api/quarantine/:id/release ─────────────────────────────────────────
router.post('/:id/release', auth, async (req, res, next) => {
  try {
    const { id } = req.params;
    if (!/^[A-F0-9]+$/.test(id)) return res.status(400).json({ error: 'Invalid queue ID' });
    await dockerExec(`postsuper -H ${id} 2>/dev/null`);
    await dockerExec(`postqueue -i ${id} 2>/dev/null`);
    subjectCache.delete(id);
    res.json({ ok: true });
  } catch(e) { next(e); }
});

// ── DELETE /api/quarantine/:id ────────────────────────────────────────────────
router.delete('/:id', auth, async (req, res, next) => {
  try {
    const { id } = req.params;
    if (!/^[A-F0-9]+$/.test(id)) return res.status(400).json({ error: 'Invalid queue ID' });
    await dockerExec(`postsuper -d ${id} 2>/dev/null`);
    subjectCache.delete(id);
    res.json({ ok: true });
  } catch(e) { next(e); }
});

// ── POST /api/quarantine/:id/rescan ──────────────────────────────────────────
router.post('/:id/rescan', auth, async (req, res, next) => {
  try {
    const { id } = req.params;
    if (!/^[A-F0-9]+$/.test(id)) return res.status(400).json({ error: 'Invalid queue ID' });
    const raw    = await dockerExec(`postcat -q ${id} 2>/dev/null`);
    const result = { id, spam_score: null, virus: null, recommendation: 'unknown' };
    const scoreM = raw.match(/X-Spam-Score:\s*([\d.]+)/i);
    if (scoreM) result.spam_score = parseFloat(scoreM[1]);
    const virusM = raw.match(/X-Virus-Status:\s*(\S+)/i);
    if (virusM) result.virus = virusM[1];
    result.recommendation =
      result.virus && result.virus !== 'Clean' ? 'delete'
      : result.spam_score >= 10 ? 'delete'
      : result.spam_score >= 5  ? 'review'
      : 'release';
    res.json(result);
  } catch(e) { next(e); }
});

// ── POST /api/quarantine/:id/whitelist ────────────────────────────────────────
router.post('/:id/whitelist', auth, async (req, res, next) => {
  try {
    const { id } = req.params;
    if (!/^[A-F0-9]+$/.test(id)) return res.status(400).json({ error: 'Invalid queue ID' });
    const raw   = await dockerExec(`postcat -q ${id} 2>/dev/null`);
    const fromM = raw.match(/^From:\s*<?([^>\s]+@[^>\s]+)>?/im);
    if (!fromM) return res.status(400).json({ error: 'Could not extract sender' });
    const sender = fromM[1].toLowerCase();
    const db = require('../utils/db');
    await db.query(
      "INSERT IGNORE INTO blocklists (list_type,value,action,comment,enabled) VALUES ('email',?,'allow','Whitelisted from quarantine',1)",
      [sender]
    );
    res.json({ ok: true, sender });
  } catch(e) { next(e); }
});

module.exports = router;