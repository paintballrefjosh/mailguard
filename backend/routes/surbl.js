const router = require('express').Router();
const auth   = require('../middleware/auth');
const db     = require('../utils/db');

const ALLOWED_COLS = new Set(['name', 'zone', 'enabled', 'weight']);

function pickAllowed(body) {
  const cols = [], vals = [];
  for (const [k, v] of Object.entries(body)) {
    if (ALLOWED_COLS.has(k)) { cols.push(k); vals.push(v); }
  }
  return { cols, vals };
}

router.get('/', auth, async (req, res, next) => {
  try {
    const [r] = await db.query('SELECT * FROM surbl_lists ORDER BY id DESC');
    res.json(r);
  } catch(e) { next(e); }
});

router.post('/', auth, async (req, res, next) => {
  try {
    const { cols, vals } = pickAllowed(req.body);
    if (!cols.length) return res.status(400).json({ error: 'No valid fields provided' });
    const [r] = await db.query(
      `INSERT INTO surbl_lists (${cols.join(',')}) VALUES (${cols.map(() => '?').join(',')})`,
      vals
    );
    res.json({ id: r.insertId });
  } catch(e) { next(e); }
});

router.put('/:id', auth, async (req, res, next) => {
  try {
    const { cols, vals } = pickAllowed(req.body);
    if (!cols.length) return res.status(400).json({ error: 'No valid fields provided' });
    await db.query(
      `UPDATE surbl_lists SET ${cols.map(c => `${c}=?`).join(',')} WHERE id=?`,
      [...vals, req.params.id]
    );
    res.json({ ok: true });
  } catch(e) { next(e); }
});

router.delete('/:id', auth, async (req, res, next) => {
  try {
    await db.query('DELETE FROM surbl_lists WHERE id=?', [req.params.id]);
    res.json({ ok: true });
  } catch(e) { next(e); }
});

module.exports = router;