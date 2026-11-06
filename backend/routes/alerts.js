const router = require('express').Router();
const auth   = require('../middleware/auth');
const db     = require('../utils/db');
const { checkAlerts } = require('../services/alerts');

// GET /api/alerts — recent alerts
router.get('/', auth, async (req, res, next) => {
  try {
    const { limit=50, unread } = req.query;
    let where = '1=1';
    if (unread === 'true') where += ' AND acknowledged=0';
    const [rows] = await db.query(
      `SELECT * FROM alert_log WHERE ${where} ORDER BY created_at DESC LIMIT ?`,
      [+limit]
    );
    res.json(rows);
  } catch(e) { next(e); }
});

// GET /api/alerts/settings — get alert threshold settings
router.get('/settings', auth, async (req, res, next) => {
  try {
    const [rows] = await db.query(
      "SELECT key_name, value FROM settings WHERE category='alerts'"
    );
    const cfg = {};
    rows.forEach(r => { cfg[r.key_name] = r.value; });
    res.json(cfg);
  } catch(e) { next(e); }
});

// PUT /api/alerts/settings — save alert threshold settings
router.put('/settings', auth, async (req, res, next) => {
  try {
    const allowed = [
      'virus_enabled', 'spam_spike_enabled', 'spam_spike_score', 'spam_spike_count',
      'ip_block_enabled', 'ip_block_count', 'ip_block_window_min',
      'auth_fail_enabled', 'auth_fail_count',
      'queue_enabled', 'queue_depth', 'alert_email',
    ];
    for (const key of allowed) {
      if (req.body[key] !== undefined) {
        await db.query(
          `INSERT INTO settings (category, key_name, value, value_type)
           VALUES ('alerts', ?, ?, 'string')
           ON DUPLICATE KEY UPDATE value = VALUES(value)`,
          [key, String(req.body[key])]
        );
      }
    }
    res.json({ ok: true });
  } catch(e) { next(e); }
});

// POST /api/alerts/acknowledge/:id
router.post('/acknowledge/:id', auth, async (req, res, next) => {
  try {
    await db.query('UPDATE alert_log SET acknowledged=1 WHERE id=?', [req.params.id]);
    res.json({ ok: true });
  } catch(e) { next(e); }
});

// POST /api/alerts/acknowledge-all
router.post('/acknowledge-all', auth, async (req, res, next) => {
  try {
    await db.query('UPDATE alert_log SET acknowledged=1 WHERE acknowledged=0');
    res.json({ ok: true });
  } catch(e) { next(e); }
});

// POST /api/alerts/test — trigger a manual check
router.post('/test', auth, async (req, res, next) => {
  try {
    await checkAlerts();
    res.json({ ok: true });
  } catch(e) { next(e); }
});

module.exports = router;