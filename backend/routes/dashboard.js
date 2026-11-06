const router = require('express').Router();
const auth   = require('../middleware/auth');
const db     = require('../utils/db');

router.get('/stats', auth, async (req, res, next) => {
  try {
    const [[totals]] = await db.query(`
      SELECT
        COUNT(*)                          total,
        SUM(action='allow')               allowed,
        SUM(action='block')               blocked,
        SUM(action='flag')                flagged,
        SUM(action='quarantine')          quarantined,
        SUM(action='greylist')            greylisted,
        SUM(virus_found IS NOT NULL)      viruses,
        AVG(spam_score)                   avg_spam,
        SUM(spf_result='fail')            spf_fail
      FROM mail_events
      WHERE received_at >= NOW() - INTERVAL 24 HOUR`);

    const [trend] = await db.query(`
      SELECT
        DATE_FORMAT(hour,'%Y-%m-%d %H:00') h,
        total_msgs, allowed, blocked, flagged,
        spam_detected, virus_detected,
        COALESCE(greylisted, 0) greylisted
      FROM stats_hourly
      ORDER BY hour DESC
      LIMIT 168`);

    const [topSenders] = await db.query(`
      SELECT sender_ip, COUNT(*) cnt, SUM(action='block') blocked
      FROM mail_events
      WHERE received_at >= NOW() - INTERVAL 24 HOUR
      GROUP BY sender_ip
      ORDER BY cnt DESC
      LIMIT 10`);

    const [topDomains] = await db.query(`
      SELECT sender_domain, COUNT(*) cnt, SUM(action='block') blocked
      FROM mail_events
      WHERE received_at >= NOW() - INTERVAL 24 HOUR
      GROUP BY sender_domain
      ORDER BY cnt DESC
      LIMIT 10`);

    // ── Blocklist suggestions ─────────────────────────────────────────────────

    // IP: blocked 5+ times in last hour, not already in blocklist
    const [suggestIps] = await db.query(`
      SELECT sender_ip AS value, COUNT(*) hits, 'ip' AS type,
             'High block rate in last hour' AS reason
      FROM mail_events
      WHERE action='block'
        AND received_at >= NOW() - INTERVAL 1 HOUR
        AND sender_ip IS NOT NULL
        AND sender_ip NOT IN (
          SELECT value FROM blocklists WHERE list_type='ip' AND enabled=1
        )
      GROUP BY sender_ip
      HAVING hits >= 5
      ORDER BY hits DESC
      LIMIT 5`);

    // Domain: blocked 3+ times in last 24h, not already in blocklist
    const [suggestDomains] = await db.query(`
      SELECT sender_domain AS value, COUNT(*) hits, 'domain' AS type,
             'Repeated blocks in last 24h' AS reason
      FROM mail_events
      WHERE action='block'
        AND received_at >= NOW() - INTERVAL 24 HOUR
        AND sender_domain IS NOT NULL
        AND sender_domain != ''
        AND sender_domain NOT IN (
          SELECT value FROM blocklists WHERE list_type='domain' AND enabled=1
        )
      GROUP BY sender_domain
      HAVING hits >= 3
      ORDER BY hits DESC
      LIMIT 5`);

    // HELO hostname: blocked 3+ times in last 24h via helo, not already blocked
    const [suggestHelo] = await db.query(`
      SELECT sender_domain AS value, COUNT(*) hits, 'helo_domain' AS type,
             'Repeated HELO blocks in last 24h' AS reason
      FROM mail_events
      WHERE action='block'
        AND reason LIKE '%HELO blocklist%'
        AND received_at >= NOW() - INTERVAL 24 HOUR
        AND sender_domain IS NOT NULL
        AND sender_domain != ''
        AND sender_domain NOT IN (
          SELECT value FROM blocklists WHERE list_type='helo_domain' AND enabled=1
        )
      GROUP BY sender_domain
      HAVING hits >= 3
      ORDER BY hits DESC
      LIMIT 5`);

    // High spam score domain: avg spam > 8.0 in last 24h, 3+ messages
    const [suggestSpam] = await db.query(`
      SELECT sender_domain AS value, COUNT(*) hits,
             ROUND(AVG(spam_score), 1) AS avg_score,
             'domain' AS type,
             'High average spam score' AS reason
      FROM mail_events
      WHERE spam_score IS NOT NULL
        AND received_at >= NOW() - INTERVAL 24 HOUR
        AND sender_domain IS NOT NULL
        AND sender_domain != ''
        AND sender_domain NOT IN (
          SELECT value FROM blocklists WHERE list_type='domain' AND enabled=1
        )
      GROUP BY sender_domain
      HAVING AVG(spam_score) >= 8.0 AND COUNT(*) >= 3
      ORDER BY avg_score DESC
      LIMIT 5`);

    const suggestions = [
      ...suggestIps,
      ...suggestDomains,
      ...suggestHelo,
      ...suggestSpam.map(s => ({ ...s, reason: `${s.reason} (avg ${s.avg_score})` })),
    ];

    res.json({
      totals,
      trend: trend.reverse(),
      topSenders,
      topDomains,
      suggestions,
    });
  } catch(e) { next(e); }
});

module.exports = router;