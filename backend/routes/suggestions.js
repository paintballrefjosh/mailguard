const router = require('express').Router();
const auth   = require('../middleware/auth');
const db     = require('../utils/db');

// ── GET /api/suggestions — full list with dismiss state ───────────────────────
router.get('/', auth, async (req, res, next) => {
  try {
    // IPs blocked 5+ times in last hour
    const [ips] = await db.query(`
      SELECT sender_ip AS value, COUNT(*) hits, 'ip' AS type,
             'High block rate in last hour' AS reason
      FROM mail_events
      WHERE action='block'
        AND received_at >= NOW() - INTERVAL 1 HOUR
        AND sender_ip IS NOT NULL
        AND sender_ip NOT IN (
          SELECT value FROM blocklists WHERE list_type='ip' AND enabled=1
        )
      GROUP BY sender_ip HAVING hits >= 5
      ORDER BY hits DESC LIMIT 10`);

    // Domains blocked 3+ times in last 24h
    const [domains] = await db.query(`
      SELECT sender_domain AS value, COUNT(*) hits, 'domain' AS type,
             'Repeated blocks in last 24h' AS reason
      FROM mail_events
      WHERE action='block'
        AND received_at >= NOW() - INTERVAL 24 HOUR
        AND sender_domain IS NOT NULL AND sender_domain != ''
        AND sender_domain NOT IN (
          SELECT value FROM blocklists WHERE list_type='domain' AND enabled=1
        )
      GROUP BY sender_domain HAVING hits >= 3
      ORDER BY hits DESC LIMIT 10`);

    // HELO hostnames blocked 3+ times in last 24h
    const [helo] = await db.query(`
      SELECT sender_domain AS value, COUNT(*) hits, 'helo_domain' AS type,
             'Repeated HELO blocks in last 24h' AS reason
      FROM mail_events
      WHERE action='block'
        AND reason LIKE '%HELO blocklist%'
        AND received_at >= NOW() - INTERVAL 24 HOUR
        AND sender_domain IS NOT NULL AND sender_domain != ''
        AND sender_domain NOT IN (
          SELECT value FROM blocklists WHERE list_type='helo_domain' AND enabled=1
        )
      GROUP BY sender_domain HAVING hits >= 3
      ORDER BY hits DESC LIMIT 10`);

    // High spam score domains
    const [spam] = await db.query(`
      SELECT sender_domain AS value, COUNT(*) hits,
             ROUND(AVG(spam_score),1) AS avg_score, 'domain' AS type,
             'High average spam score' AS reason
      FROM mail_events
      WHERE spam_score IS NOT NULL
        AND received_at >= NOW() - INTERVAL 24 HOUR
        AND sender_domain IS NOT NULL AND sender_domain != ''
        AND sender_domain NOT IN (
          SELECT value FROM blocklists WHERE list_type='domain' AND enabled=1
        )
      GROUP BY sender_domain
      HAVING AVG(spam_score) >= 8.0 AND COUNT(*) >= 3
      ORDER BY avg_score DESC LIMIT 10`);

    // Load dismissed suggestions (within last 24h)
    const [dismissed] = await db.query(`
      SELECT CONCAT(type, ':', value) AS key_name
      FROM suggestion_dismissals
      WHERE dismissed_at >= NOW() - INTERVAL 24 HOUR`
    ).catch(() => [[]]);

    const dismissedKeys = new Set(dismissed.map(d => d.key_name));

    const all = [
      ...ips,
      ...domains,
      ...helo,
      ...spam.map(s => ({ ...s, reason: `${s.reason} (avg ${s.avg_score})` })),
    ].map(s => ({
      ...s,
      dismissed: dismissedKeys.has(`${s.type}:${s.value}`),
    }));

    res.json(all);
  } catch(e) { next(e); }
});

// ── POST /api/suggestions/dismiss — dismiss a suggestion for 24h ──────────────
router.post('/dismiss', auth, async (req, res, next) => {
  try {
    const { type, value } = req.body;
    if (!type || !value) return res.status(400).json({ error: 'type and value required' });

    // Create table if it doesn't exist yet
    await db.query(`
      CREATE TABLE IF NOT EXISTS suggestion_dismissals (
        id           INT AUTO_INCREMENT PRIMARY KEY,
        type         VARCHAR(50)  NOT NULL,
        value        VARCHAR(500) NOT NULL,
        dismissed_at DATETIME     NOT NULL DEFAULT NOW(),
        INDEX idx_dismissed_at (dismissed_at),
        UNIQUE KEY uk_type_value (type, value(100))
      )
    `);

    await db.query(`
      INSERT INTO suggestion_dismissals (type, value, dismissed_at)
      VALUES (?, ?, NOW())
      ON DUPLICATE KEY UPDATE dismissed_at = NOW()`,
      [type, value]
    );

    res.json({ ok: true });
  } catch(e) { next(e); }
});

// ── DELETE /api/suggestions/dismissals — clear all dismissals ─────────────────
router.delete('/dismissals', auth, async (req, res, next) => {
  try {
    await db.query('DELETE FROM suggestion_dismissals WHERE 1=1').catch(() => {});
    res.json({ ok: true });
  } catch(e) { next(e); }
});

module.exports = router;