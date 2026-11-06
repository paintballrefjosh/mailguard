const router = require('express').Router();
const auth   = require('../middleware/auth');
const db     = require('../utils/db');
const { syncRules } = require('../utils/postfix-rules');

// These rule types are enforced by postfix header_checks / body_checks /
// sender_whitelist files generated from the DB. Any mutation that affects
// them needs to regenerate the maps and reload postfix. (Includes 'domain'
// because action='allow' on a domain populates the sender_whitelist.)
const SYNC_TYPES = new Set([
  'regex_subject', 'regex_body', 'from_email', 'domain',
]);
function maybeSync(list_type) {
  if (!SYNC_TYPES.has(list_type)) return;
  // Fire and forget — the API response shouldn't block on docker exec.
  syncRules().catch(e => console.warn('[blocklists] syncRules failed:', e.message));
}

// ── Validation ────────────────────────────────────────────────────────────────

const VALID_TYPES   = new Set(['ip','cidr','sender_email','from_email','domain','helo_domain','tld','regex_subject','regex_body','uri']);
const VALID_ACTIONS = new Set(['block','flag','quarantine','allow']);

const IPV4_RE   = /^(\d{1,3}\.){3}\d{1,3}$/;
const IPV6_RE   = /^[0-9a-fA-F:]+$/;
const CIDR_RE   = /^(\d{1,3}\.){3}\d{1,3}\/\d{1,2}$/;
const EMAIL_RE  = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const DOMAIN_RE = /^(\*\.)?[a-zA-Z0-9-]+(\.[a-zA-Z0-9-]+)*$/;
const TLD_RE    = /^[a-zA-Z]{2,24}$/;

function validateEntry(list_type, value) {
  if (!VALID_TYPES.has(list_type))
    return `Invalid list_type: ${list_type}`;
  const v = (value || '').trim();
  if (!v) return 'Value is required';

  switch (list_type) {
    case 'ip':
      if (!IPV4_RE.test(v) && !IPV6_RE.test(v)) return 'Invalid IP address';
      break;
    case 'cidr':
      if (!CIDR_RE.test(v)) return 'Invalid CIDR (e.g. 192.168.1.0/24)';
      break;
    case 'sender_email':
      if (!EMAIL_RE.test(v)) return 'Invalid email address';
      break;
    case 'from_email':
      try { new RegExp(v); }
      catch { return 'Invalid regular expression'; }
      break;
    case 'domain':
    case 'helo_domain':
      if (!DOMAIN_RE.test(v)) return 'Invalid domain (e.g. example.com or *.example.com)';
      break;
    case 'tld':
      if (!TLD_RE.test(v)) return 'TLD must be letters only, no dots (e.g. "ru", "xyz")';
      break;
    case 'regex_subject':
    case 'regex_body':
      try { new RegExp(v); }
      catch { return 'Invalid regular expression'; }
      break;
    // uri — accept any non-empty string
  }
  return null;
}

// ── GET /api/blocklists ───────────────────────────────────────────────────────
router.get('/', auth, async (req, res, next) => {
  try {
    const { type } = req.query;
    let q = 'SELECT * FROM blocklists', p = [];
    if (type) { q += ' WHERE list_type=?'; p.push(type); }
    const [rows] = await db.query(q + ' ORDER BY created_at DESC', p);
    res.json(rows);
  } catch(e) { next(e); }
});

// ── POST /api/blocklists/lookup — batch existence check ─────────────────────
// Used by the mail log's "Quick Block" menu to show green (already blocked)
// vs red (not yet blocked) for each candidate value without one round trip
// per item. Exact list_type+value match, case-insensitive — mirrors the
// duplicate check POST / applies, so green means "clicking Block here would
// 409". Does not attempt suffix/CIDR containment matching.
router.post('/lookup', auth, async (req, res, next) => {
  try {
    const checks = Array.isArray(req.body?.checks) ? req.body.checks.slice(0, 20) : [];
    const results = await Promise.all(checks.map(async ({ type, value }) => {
      if (!VALID_TYPES.has(type) || !value) return { type, value, match: null };
      const [[row]] = await db.query(
        `SELECT id, action, enabled FROM blocklists
         WHERE list_type=? AND LOWER(value)=LOWER(?) LIMIT 1`,
        [type, String(value).trim()]
      );
      return { type, value, match: row || null };
    }));
    res.json(results);
  } catch(e) { next(e); }
});

// ── POST /api/blocklists ──────────────────────────────────────────────────────
router.post('/', auth, async (req, res, next) => {
  try {
    const { list_type, action = 'block', comment, enabled = true } = req.body;
    // Normalise TLD to lowercase before storing
    const value = list_type === 'tld'
      ? (req.body.value || '').trim().toLowerCase()
      : (req.body.value || '').trim();

    const err = validateEntry(list_type, value);
    if (err) return res.status(400).json({ error: err });

    if (!VALID_ACTIONS.has(action))
      return res.status(400).json({ error: `Invalid action: ${action}` });

    // Duplicate check
    const [[existing]] = await db.query(
      'SELECT id FROM blocklists WHERE list_type=? AND value=? LIMIT 1',
      [list_type, value]
    );
    if (existing) return res.status(409).json({ error: 'Duplicate entry' });

    const [r] = await db.query(
      'INSERT INTO blocklists (list_type, value, action, comment, enabled) VALUES (?,?,?,?,?)',
      [list_type, value, action, comment || null, enabled ? 1 : 0]
    );
    maybeSync(list_type);
    res.json({ id: r.insertId });
  } catch(e) { next(e); }
});

// ── PUT /api/blocklists/:id ───────────────────────────────────────────────────
router.put('/:id', auth, async (req, res, next) => {
  try {
    const { action, comment, enabled } = req.body;

    // Fetch existing row so we know the list_type for validation
    const [[row]] = await db.query(
      'SELECT list_type, value FROM blocklists WHERE id=? LIMIT 1',
      [req.params.id]
    );
    if (!row) return res.status(404).json({ error: 'Not found' });

    const value = row.list_type === 'tld'
      ? (req.body.value || '').trim().toLowerCase()
      : (req.body.value || '').trim();

    const err = validateEntry(row.list_type, value);
    if (err) return res.status(400).json({ error: err });

    if (action && !VALID_ACTIONS.has(action))
      return res.status(400).json({ error: `Invalid action: ${action}` });

    // Duplicate check (exclude self)
    if (value !== row.value) {
      const [[dup]] = await db.query(
        'SELECT id FROM blocklists WHERE list_type=? AND value=? AND id!=? LIMIT 1',
        [row.list_type, value, req.params.id]
      );
      if (dup) return res.status(409).json({ error: 'Duplicate entry' });
    }

    await db.query(
      'UPDATE blocklists SET value=?, action=?, comment=?, enabled=? WHERE id=?',
      [value, action, comment || null, enabled !== undefined ? (enabled ? 1 : 0) : 1, req.params.id]
    );
    maybeSync(row.list_type);
    res.json({ ok: true });
  } catch(e) { next(e); }
});

// ── DELETE /api/blocklists/:id ────────────────────────────────────────────────
router.delete('/:id', auth, async (req, res, next) => {
  try {
    const [[row]] = await db.query(
      'SELECT list_type FROM blocklists WHERE id=? LIMIT 1', [req.params.id]);
    await db.query('DELETE FROM blocklists WHERE id=?', [req.params.id]);
    if (row) maybeSync(row.list_type);
    res.json({ ok: true });
  } catch(e) { next(e); }
});

module.exports = router;