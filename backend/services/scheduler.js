const cron    = require('node-cron');
const db      = require('../utils/db');
const fs      = require('fs');
const { execFile }     = require('child_process');
const { checkAlerts }  = require('./alerts');
const { sendReport }   = require('./reports');
const { initGeoIp }    = require('./geoip');
const { checkHealth }  = require('./health');

function scheduleJobs() {
  // ── Health checks every minute ───────────────────────────────────────────
  cron.schedule('* * * * *', () => {
    checkHealth().catch(e => console.error('[scheduler] health check error:', e.message));
  });

  // ── Log rotation daily at 2am ────────────────────────────────────────────
  cron.schedule('0 2 * * *', () => {
    const conf = '/app/config/logrotate.conf';
    if (!fs.existsSync(conf)) return;
    // Use execFile instead of execSync to avoid blocking the event loop
    execFile('logrotate', ['-s', '/app/logs/logrotate.status', conf], (err) => {
      if (err) console.error('[scheduler] logrotate error:', err.message);
      else console.log('[scheduler] log rotation done');
    });
    execFile('find', ['/app/logs', '-name', '*.gz', '-mtime', '+7', '-delete'],
      (err) => { if (err) console.error('[scheduler] log prune error:', err.message); });
  });

  // ── Hourly stats rollup ──────────────────────────────────────────────────
  cron.schedule('5 * * * *', async () => {
    try {
      await db.query(`
        INSERT INTO stats_hourly
          (hour, total_msgs, allowed, blocked, flagged, quarantined,
           spam_detected, virus_detected, spf_fail, avg_spam_score, greylisted)
        SELECT
          DATE_FORMAT(DATE_SUB(NOW(), INTERVAL 1 HOUR), '%Y-%m-%d %H:00:00'),
          COUNT(*),
          SUM(action='allow'),
          SUM(action='block'),
          SUM(action='flag'),
          SUM(action='quarantine'),
          SUM(spam_score >= 5),
          SUM(virus_found IS NOT NULL),
          SUM(spf_result='fail'),
          AVG(spam_score),
          SUM(action='greylist')
        FROM mail_events
        WHERE received_at >= DATE_SUB(NOW(), INTERVAL 1 HOUR)
          AND received_at <  DATE_FORMAT(NOW(), '%Y-%m-%d %H:00:00')
        ON DUPLICATE KEY UPDATE
          total_msgs     = VALUES(total_msgs),
          allowed        = VALUES(allowed),
          blocked        = VALUES(blocked),
          flagged        = VALUES(flagged),
          quarantined    = VALUES(quarantined),
          spam_detected  = VALUES(spam_detected),
          virus_detected = VALUES(virus_detected),
          spf_fail       = VALUES(spf_fail),
          avg_spam_score = VALUES(avg_spam_score),
          greylisted     = VALUES(greylisted)
      `);
      console.log('[scheduler] stats rollup done');
    } catch(e) { console.error('[scheduler] rollup error', e.message); }
  });

  // ── Alert checks every 2 minutes ─────────────────────────────────────────
  cron.schedule('*/2 * * * *', () => {
    checkAlerts().catch(e => console.error('[scheduler] alert check error:', e.message));
  });

  // ── Daily report at 7am ──────────────────────────────────────────────────
  cron.schedule('0 7 * * *', () => {
    sendReport('daily').catch(e => console.error('[scheduler] daily report error:', e.message));
  });

  // ── Weekly report Monday 7am ─────────────────────────────────────────────
  cron.schedule('0 7 * * 1', () => {
    sendReport('weekly').catch(e => console.error('[scheduler] weekly report error:', e.message));
  });

  // ── Refresh GeoIP database weekly ────────────────────────────────────────
  cron.schedule('0 3 * * 0', () => {
    initGeoIp().catch(e => console.error('[scheduler] geoip refresh error:', e.message));
  });

  // ── Prune events older than 90 days (batched to avoid long transactions) ─
  cron.schedule('0 3 * * *', async () => {
    try {
      let total = 0;
      let deleted;
      do {
        const [r] = await db.query(
          'DELETE FROM mail_events WHERE received_at < NOW() - INTERVAL 90 DAY LIMIT 1000'
        );
        deleted = r.affectedRows;
        total  += deleted;
        if (deleted > 0) await new Promise(r => setTimeout(r, 100));
      } while (deleted === 1000);
      console.log(`[scheduler] pruned ${total} old events`);
    } catch(e) { console.error('[scheduler] prune error:', e.message); }
  });
}

module.exports = { scheduleJobs };