const router = require('express').Router();
const auth   = require('../middleware/auth');
const http   = require('http');

const RESTARTABLE = ['mailguard-postfix', 'mailguard-amavis', 'mailguard-spamassassin'];

function dockerRestart(container) {
  return new Promise((resolve, reject) => {
    const req = http.request({
      socketPath: '/var/run/docker.sock',
      path:       `/containers/${container}/restart?t=10`,
      method:     'POST',
    }, res => {
      res.resume();
      res.on('end', () => {
        if (res.statusCode === 204) resolve();
        else reject(new Error(`HTTP ${res.statusCode}`));
      });
    });
    req.on('error', reject);
    req.end();
  });
}

// POST /api/restart/:service
router.post('/:service', auth, async (req, res, next) => {
  try {
    const map = {
      postfix:      'mailguard-postfix',
      amavis:       'mailguard-amavis',
      spamassassin: 'mailguard-spamassassin',
    };
    const container = map[req.params.service];
    if (!container) return res.status(400).json({ error: 'Unknown service' });
    await dockerRestart(container);
    res.json({ ok: true, restarted: container });
  } catch(e) { next(e); }
});

module.exports = router;