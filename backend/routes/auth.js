const router  = require('express').Router();
const bcrypt  = require('bcryptjs');
const jwt     = require('jsonwebtoken');
const db      = require('../utils/db');

router.post('/login', async (req, res, next) => {
  try {
    const { email, password } = req.body;
    const [rows] = await db.query('SELECT * FROM users WHERE email=?', [email]);
    const user = rows[0];
    if (!user || !(await bcrypt.compare(password, user.password)))
      return res.status(401).json({ error: 'Invalid credentials' });

    // Read session timeout from settings (0 = unlimited)
    const [stRows] = await db.query(
      "SELECT value FROM settings WHERE category='general' AND key_name='session_timeout_minutes' LIMIT 1"
    );
    const timeoutMin = stRows.length ? parseInt(stRows[0].value, 10) : 720;
    const jwtOpts = timeoutMin > 0 ? { expiresIn: timeoutMin * 60 } : {};

    const token = jwt.sign({ id: user.id, role: user.role, email: user.email },
      process.env.JWT_SECRET, jwtOpts);
    res.json({ token, role: user.role, email: user.email });
  } catch(e) { next(e); }
});

router.post('/change-password', require('../middleware/auth'), async (req, res, next) => {
  try {
    const { currentPassword, newPassword } = req.body;
    const [rows] = await db.query('SELECT * FROM users WHERE id=?', [req.user.id]);
    if (!rows[0] || !(await bcrypt.compare(currentPassword, rows[0].password)))
      return res.status(400).json({ error: 'Current password incorrect' });
    const hash = await bcrypt.hash(newPassword, 12);
    await db.query('UPDATE users SET password=? WHERE id=?', [hash, req.user.id]);
    res.json({ ok: true });
  } catch(e) { next(e); }
});
module.exports = router;
