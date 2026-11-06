const router = require('express').Router();
const auth   = require('../middleware/auth');
const db     = require('../utils/db');
const { generateReport, sendReport } = require('../services/reports');

// GET /api/reports/:period — get latest cached report
router.get('/:period', auth, async (req, res, next) => {
  try {
    const { period } = req.params;
    if (!['daily','weekly'].includes(period))
      return res.status(400).json({ error: 'period must be daily or weekly' });

    const [rows] = await db.query(
      'SELECT * FROM reports WHERE period=?', [period]
    );

    if (!rows.length) {
      // Generate on demand if not cached yet
      const r = await generateReport(period);
      return res.json(r);
    }

    const row = rows[0];
    const data = typeof row.data === 'string' ? JSON.parse(row.data) : row.data;
    res.json({ ...data, period, generated_at: row.generated_at });
  } catch(e) { next(e); }
});

// POST /api/reports/:period/generate — force regenerate and optionally email
router.post('/:period/generate', auth, async (req, res, next) => {
  try {
    const { period } = req.params;
    const { send_email = false } = req.body;
    if (!['daily','weekly'].includes(period))
      return res.status(400).json({ error: 'period must be daily or weekly' });

    const r = send_email ? await sendReport(period) : await generateReport(period);
    res.json({ ok: true, period, totals: r.totals });
  } catch(e) { next(e); }
});

module.exports = router;