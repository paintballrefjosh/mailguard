const db      = require('../utils/db');
const { sendMail } = require('./mailer');

async function generateReport(period = 'daily') {
  const interval = period === 'weekly' ? '7 DAY' : '1 DAY';
  const label    = period === 'weekly' ? 'Weekly' : 'Daily';

  const [[totals]] = await db.query(`
    SELECT
      COUNT(*) total,
      SUM(action='allow')        allowed,
      SUM(action='block')        blocked,
      SUM(action='flag')         flagged,
      SUM(action='quarantine')   quarantined,
      SUM(virus_found IS NOT NULL) viruses,
      SUM(spf_result='fail')     spf_fail,
      SUM(dkim_result='fail')    dkim_fail,
      SUM(dmarc_result='fail')   dmarc_fail,
      AVG(spam_score)            avg_spam,
      MAX(spam_score)            max_spam
    FROM mail_events
    WHERE received_at >= NOW() - INTERVAL ${interval}`);

  const [topBlocked] = await db.query(`
    SELECT sender_ip, COUNT(*) cnt
    FROM mail_events
    WHERE action='block' AND received_at >= NOW() - INTERVAL ${interval}
    GROUP BY sender_ip ORDER BY cnt DESC LIMIT 10`);

  const [topDomains] = await db.query(`
    SELECT sender_domain, COUNT(*) cnt, SUM(action='block') blocked
    FROM mail_events
    WHERE received_at >= NOW() - INTERVAL ${interval}
    GROUP BY sender_domain ORDER BY cnt DESC LIMIT 10`);

  const [viruses] = await db.query(`
    SELECT virus_found, COUNT(*) cnt
    FROM mail_events
    WHERE virus_found IS NOT NULL AND received_at >= NOW() - INTERVAL ${interval}
    GROUP BY virus_found ORDER BY cnt DESC LIMIT 10`);

  const [alerts] = await db.query(`
    SELECT alert_type, message, severity, created_at
    FROM alert_log
    WHERE created_at >= NOW() - INTERVAL ${interval}
    ORDER BY created_at DESC LIMIT 20`).catch(() => [[]]);

  // Save to DB for dashboard display
  await db.query(`
    INSERT INTO reports (period, data, generated_at)
    VALUES (?, ?, NOW())
    ON DUPLICATE KEY UPDATE data=VALUES(data), generated_at=NOW()`,
    [period, JSON.stringify({ totals, topBlocked, topDomains, viruses, alerts })]
  ).catch(() => {});

  return { period, label, totals, topBlocked, topDomains, viruses, alerts };
}

function formatReportHtml(r) {
  const t = r.totals;
  const pct = (n, d) => d > 0 ? ((n/d)*100).toFixed(1)+'%' : '0%';
  const fmt = n => (n||0).toLocaleString();

  return `
<!DOCTYPE html>
<html>
<head><style>
  body { font-family: Arial, sans-serif; color: #333; max-width: 700px; margin: 0 auto; padding: 20px; }
  h1 { color: #4f46e5; border-bottom: 2px solid #4f46e5; padding-bottom: 10px; }
  h2 { color: #6366f1; margin-top: 30px; }
  table { width: 100%; border-collapse: collapse; margin: 10px 0; }
  th { background: #4f46e5; color: white; padding: 8px 12px; text-align: left; }
  td { padding: 7px 12px; border-bottom: 1px solid #e5e7eb; }
  tr:nth-child(even) td { background: #f9fafb; }
  .stat { display: inline-block; margin: 5px 15px 5px 0; }
  .stat-value { font-size: 24px; font-weight: bold; color: #4f46e5; }
  .stat-label { font-size: 12px; color: #6b7280; }
  .critical { color: #dc2626; } .warning { color: #d97706; }
</style></head>
<body>
  <h1>MailGuard ${r.label} Report</h1>
  <p>Generated: ${new Date().toLocaleString()}</p>

  <h2>Summary</h2>
  <div>
    <div class="stat"><div class="stat-value">${fmt(t.total)}</div><div class="stat-label">Total Messages</div></div>
    <div class="stat"><div class="stat-value" style="color:#16a34a">${fmt(t.allowed)}</div><div class="stat-label">Allowed (${pct(t.allowed,t.total)})</div></div>
    <div class="stat"><div class="stat-value" style="color:#dc2626">${fmt(t.blocked)}</div><div class="stat-label">Blocked (${pct(t.blocked,t.total)})</div></div>
    <div class="stat"><div class="stat-value" style="color:#d97706">${fmt(t.flagged)}</div><div class="stat-label">Flagged</div></div>
    <div class="stat"><div class="stat-value" style="color:#7c3aed">${fmt(t.quarantined)}</div><div class="stat-label">Quarantined</div></div>
    <div class="stat"><div class="stat-value" style="color:#ea580c">${fmt(t.viruses)}</div><div class="stat-label">Viruses</div></div>
  </div>
  <p>Avg spam score: <strong>${(+t.avg_spam||0).toFixed(2)}</strong> | Max: <strong>${(+t.max_spam||0).toFixed(2)}</strong></p>
  <p>SPF fails: <strong>${fmt(t.spf_fail)}</strong> | DKIM fails: <strong>${fmt(t.dkim_fail)}</strong> | DMARC fails: <strong>${fmt(t.dmarc_fail)}</strong></p>

  ${r.topBlocked.length ? `
  <h2>Top Blocked IPs</h2>
  <table><tr><th>IP Address</th><th>Block Count</th></tr>
  ${r.topBlocked.map(row => `<tr><td>${row.sender_ip||'unknown'}</td><td>${fmt(row.cnt)}</td></tr>`).join('')}
  </table>` : ''}

  ${r.topDomains.length ? `
  <h2>Top Sender Domains</h2>
  <table><tr><th>Domain</th><th>Total</th><th>Blocked</th></tr>
  ${r.topDomains.map(row => `<tr><td>${row.sender_domain||'unknown'}</td><td>${fmt(row.cnt)}</td><td>${fmt(row.blocked)}</td></tr>`).join('')}
  </table>` : ''}

  ${r.viruses.length ? `
  <h2>Viruses Detected</h2>
  <table><tr><th>Signature</th><th>Count</th></tr>
  ${r.viruses.map(row => `<tr><td>${row.virus_found}</td><td>${fmt(row.cnt)}</td></tr>`).join('')}
  </table>` : ''}

  ${r.alerts.length ? `
  <h2>Recent Alerts</h2>
  <table><tr><th>Time</th><th>Type</th><th>Message</th></tr>
  ${r.alerts.map(a => `<tr><td>${new Date(a.created_at).toLocaleString()}</td>
    <td class="${a.severity}">${a.alert_type}</td><td>${a.message}</td></tr>`).join('')}
  </table>` : ''}
</body></html>`;
}

async function sendReport(period = 'daily') {
  const r    = await generateReport(period);
  const html = formatReportHtml(r);
  const to   = process.env.REPORT_EMAIL || process.env.ALERT_EMAIL || '';
  if (!to) { console.warn('[reports] No REPORT_EMAIL set, skipping email.'); return r; }

  await sendMail({
    to,
    subject: `[MailGuard] ${r.label} Report — ${new Date().toLocaleDateString()}`,
    html,
    text: `MailGuard ${r.label} Report\n\nTotal: ${r.totals.total} | Blocked: ${r.totals.blocked} | Viruses: ${r.totals.viruses}\nSee HTML version for full details.`,
  });
  console.log(`[reports] ${period} report sent to ${to}`);
  return r;
}

module.exports = { generateReport, sendReport, formatReportHtml };