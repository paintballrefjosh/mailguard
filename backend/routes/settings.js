const router = require('express').Router();
const auth   = require('../middleware/auth');
const db     = require('../utils/db');

const ALLOWED_COLS = new Set(['category', 'key_name', 'value', 'value_type', 'description']);

// Allow internal services (postfix entrypoint) to read settings via X-Internal-Token
function authOrInternal(req, res, next) {
  const internalToken = req.headers['x-internal-token'];
  if (internalToken && internalToken === process.env.MAILGUARD_INTERNAL_TOKEN) return next();
  return auth(req, res, next);
}

router.get('/', authOrInternal, async (req, res, next) => {
  try {
    const { category } = req.query;
    let q = 'SELECT * FROM settings', p = [];
    if (category) { q += ' WHERE category=?'; p.push(category); }
    const [rows] = await db.query(q + ' ORDER BY category, key_name', p);
    res.json(rows);
  } catch(e) { next(e); }
});

router.post('/upsert', auth, async (req, res, next) => {
  try {
    const { category, key_name, value, value_type, description } = req.body;
    await db.query(
      `INSERT INTO settings (category, key_name, value, value_type, description)
       VALUES (?,?,?,?,?)
       ON DUPLICATE KEY UPDATE value=VALUES(value)`,
      [category, key_name, value, value_type || 'string', description || null]
    );
    res.json({ ok: true });
  } catch(e) { next(e); }
});

// PUT uses an explicit column list — never trust req.body keys for column names
router.put('/:id', auth, async (req, res, next) => {
  try {
    const sets = [], vals = [];
    for (const [k, v] of Object.entries(req.body)) {
      if (ALLOWED_COLS.has(k)) { sets.push(`${k}=?`); vals.push(v); }
    }
    if (!sets.length) return res.status(400).json({ error: 'No valid fields provided' });
    await db.query(
      `UPDATE settings SET ${sets.join(',')} WHERE id=?`,
      [...vals, req.params.id]
    );
    res.json({ ok: true });
  } catch(e) { next(e); }
});

router.delete('/:id', auth, async (req, res, next) => {
  try {
    await db.query('DELETE FROM settings WHERE id=?', [req.params.id]);
    res.json({ ok: true });
  } catch(e) { next(e); }
});

module.exports = router;