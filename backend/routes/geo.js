const router = require('express').Router();
const auth   = require('../middleware/auth');
const { lookup } = require('../services/geoip');

// GET /api/geo/lookup?ip=1.2.3.4
router.get('/lookup', auth, (req, res) => {
  const { ip } = req.query;
  if (!ip) return res.status(400).json({ error: 'ip required' });
  const result = lookup(ip);
  res.json(result || { error: 'not found' });
});

module.exports = router;