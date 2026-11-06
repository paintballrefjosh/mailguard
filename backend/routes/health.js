const router = require('express').Router();
const auth   = require('../middleware/auth');
const { checkHealth } = require('../services/health');

// GET /api/health — run checks and return results (no auth for uptime monitors)
router.get('/', async (req, res, next) => {
  try {
    const results  = await checkHealth();
    const allUp    = results.every(r => r.healthy);
    res.status(allUp ? 200 : 503).json({
      status:   allUp ? 'ok' : 'degraded',
      services: results,
      ts:       new Date().toISOString(),
    });
  } catch(e) { next(e); }
});

module.exports = router;