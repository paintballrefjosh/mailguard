const db      = require('../utils/db');
const { sendMail } = require('./mailer');
const { broadcast } = require('./websocket');

// Track recently fired alerts to avoid flooding (cooldown per alert type)
const cooldowns = {};
const COOLDOWN_MS = 15 * 60 * 1000; // 15 minutes per alert type

async function getThresholds() {
  const [rows] = await db.query(
    "SELECT key_name, value FROM settings WHERE category='alerts'"
  );
  const cfg = {};
  rows.forEach(r => { cfg[r.key_name] = r.value; });
  return {
    virus_enabled:         cfg.virus_enabled         !== 'false',
    spam_spike_enabled:    cfg.spam_spike_enabled     !== 'false',
    spam_spike_score:      parseFloat(cfg.spam_spike_score      || '8.0'),
    spam_spike_count:      parseInt(cfg.spam_spike_count        || '5'),
    ip_block_enabled:      cfg.ip_block_enabled       !== 'false',
    ip_block_count:        parseInt(cfg.ip_block_count          || '20'),
    ip_block_window_min:   parseInt(cfg.ip_block_window_min     || '10'),
    auth_fail_enabled:     cfg.auth_fail_enabled      !== 'false',
    auth_fail_count:       parseInt(cfg.auth_fail_count         || '10'),
    queue_enabled:         cfg.queue_enabled          !== 'false',
    queue_depth:           parseInt(cfg.queue_depth             || '100'),
    alert_email:           cfg.alert_email            || process.env.ALERT_EMAIL || '',
  };
}

function canFire(key) {
  const now = Date.now();
  if (cooldowns[key] && now - cooldowns[key] < COOLDOWN_MS) return false;
  cooldowns[key] = now;
  return true;
}

async function saveAlert(type, message, severity = 'warning') {
  await db.query(
    "INSERT INTO alert_log (alert_type, message, severity) VALUES (?,?,?)",
    [type, message, severity]
  ).catch(() => {});
  broadcast('alert', { type, message, severity, ts: new Date().toISOString() });
}

async function sendAlertEmail(cfg, subject, body) {
  if (!cfg.alert_email) return;
  try {
    await sendMail({
      to:      cfg.alert_email,
      subject: `[MailGuard Alert] ${subject}`,
      text:    body,
      html:    `<pre style="font-family:monospace">${body}</pre>`,
    });
  } catch(e) {
    console.error('[alerts] email failed:', e.message);
  }
}

async function checkAlerts() {
  try {
    const cfg = await getThresholds();

    // ── Virus detected ───────────────────────────────────────────────────────
    if (cfg.virus_enabled) {
      const [[{ cnt }]] = await db.query(
        "SELECT COUNT(*) cnt FROM mail_events WHERE virus_found IS NOT NULL AND received_at >= NOW() - INTERVAL 5 MINUTE"
      );
      if (cnt > 0 && canFire('virus')) {
        const msg = `${cnt} virus(es) detected in the last 5 minutes.`;
        await saveAlert('virus', msg, 'critical');
        await sendAlertEmail(cfg, 'Virus Detected', msg);
      }
    }

    // ── Spam score spike ─────────────────────────────────────────────────────
    if (cfg.spam_spike_enabled) {
      const [[{ cnt }]] = await db.query(
        "SELECT COUNT(*) cnt FROM mail_events WHERE spam_score >= ? AND received_at >= NOW() - INTERVAL 10 MINUTE",
        [cfg.spam_spike_score]
      );
      if (cnt >= cfg.spam_spike_count && canFire('spam_spike')) {
        const msg = `${cnt} messages scored above ${cfg.spam_spike_score} in the last 10 minutes.`;
        await saveAlert('spam_spike', msg, 'warning');
        await sendAlertEmail(cfg, 'Spam Score Spike', msg);
      }
    }

    // ── High block rate from single IP ───────────────────────────────────────
    if (cfg.ip_block_enabled) {
      const [rows] = await db.query(
        `SELECT sender_ip, COUNT(*) cnt FROM mail_events
         WHERE action='block' AND received_at >= NOW() - INTERVAL ? MINUTE
         GROUP BY sender_ip HAVING cnt >= ?
         ORDER BY cnt DESC LIMIT 5`,
        [cfg.ip_block_window_min, cfg.ip_block_count]
      );
      for (const row of rows) {
        const key = `ip_block_${row.sender_ip}`;
        if (canFire(key)) {
          const msg = `IP ${row.sender_ip} has been blocked ${row.cnt} times in the last ${cfg.ip_block_window_min} minutes.`;
          await saveAlert('ip_block', msg, 'warning');
          await sendAlertEmail(cfg, 'High Block Rate', msg);
        }
      }
    }

    // ── SPF/DKIM/DMARC failure spike ─────────────────────────────────────────
    if (cfg.auth_fail_enabled) {
      const [[{ cnt }]] = await db.query(
        `SELECT COUNT(*) cnt FROM mail_events
         WHERE (spf_result='fail' OR dkim_result='fail' OR dmarc_result='fail')
           AND received_at >= NOW() - INTERVAL 10 MINUTE`
      );
      if (cnt >= cfg.auth_fail_count && canFire('auth_fail')) {
        const msg = `${cnt} auth failures (SPF/DKIM/DMARC) in the last 10 minutes.`;
        await saveAlert('auth_fail', msg, 'warning');
        await sendAlertEmail(cfg, 'Auth Failure Spike', msg);
      }
    }

    // ── Queue backlog (check Postfix queue depth via log heuristic) ──────────
    if (cfg.queue_enabled) {
      const [[{ cnt }]] = await db.query(
        `SELECT COUNT(*) cnt FROM mail_events
         WHERE action='allow' AND received_at >= NOW() - INTERVAL 5 MINUTE
           AND queue_id IS NOT NULL`
      );
      if (cnt >= cfg.queue_depth && canFire('queue')) {
        const msg = `Queue depth appears high: ${cnt} messages in the last 5 minutes.`;
        await saveAlert('queue', msg, 'warning');
        await sendAlertEmail(cfg, 'Queue Backlog', msg);
      }
    }
  } catch(e) {
    console.error('[alerts] check error:', e.message);
  }
}

module.exports = { checkAlerts, saveAlert };