const router = require('express').Router();
const auth   = require('../middleware/auth');
const db     = require('../utils/db');

// GET /api/auth_settings
router.get('/', auth, async (req, res, next) => {
  try {
    const [rows] = await db.query('SELECT * FROM auth_settings');
    res.json(rows);
  } catch(e) { next(e); }
});

// PUT /api/auth_settings/:key
router.put('/:key', auth, async (req, res, next) => {
  try {
    const { value } = req.body;
    await db.query(
      'INSERT INTO auth_settings (setting_key, value) VALUES (?,?) ON DUPLICATE KEY UPDATE value=?',
      [req.params.key, value, value]
    );
    res.json({ ok: true });
  } catch(e) { next(e); }
});

module.exports = router;