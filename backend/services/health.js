const net     = require('net');
const http    = require('http');
const db      = require('../utils/db');
const { saveAlert }  = require('./alerts');
const { sendMail }   = require('./mailer');
const { broadcast }  = require('./websocket');

// Track previous states to only alert on transitions
const prevState = {};
// When each service was first seen down (ms epoch), used to report downtime on recovery
const downSince = {};

function formatDuration(ms) {
  const s = Math.round(ms / 1000);
  if (s < 60) return `${s}s`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m ${s % 60}s`;
  const h = Math.floor(m / 60);
  return `${h}h ${m % 60}m`;
}

function checkSpamAssassin() {
  return new Promise((resolve, reject) => {
    const sock = new net.Socket();
    sock.setTimeout(5000);
    sock.connect(783, 'spamassassin', () => {
      sock.write('PING SPAMC/1.5\r\n\r\n');
    });
    sock.on('data', data => {
      if (data.toString().includes('SPAMD')) {
        sock.destroy();
        resolve();
      } else {
        sock.destroy();
        reject(new Error('unexpected response'));
      }
    });
    sock.on('timeout', () => { sock.destroy(); reject(new Error('timeout')); });
    sock.on('error',   err  => reject(err));
  });
}

const SERVICES = [
  { key: 'database',     label: 'MariaDB',       check: checkDb },
  { key: 'postfix',      label: 'Postfix SMTP',  check: () => checkTcp('postfix', 25) },
  { key: 'clamav',       label: 'ClamAV',        check: () => checkTcp('clamav', 3310) },
  { key: 'spamassassin', label: 'SpamAssassin',  check: checkSpamAssassin },
];

async function checkDb() {
  await db.query('SELECT 1');
}

function checkTcp(host, port) {
  return new Promise((resolve, reject) => {
    const sock = new net.Socket();
    sock.setTimeout(5000);
    sock.connect(port, host, () => { sock.destroy(); resolve(); });
    sock.on('timeout', () => { sock.destroy(); reject(new Error('timeout')); });
    sock.on('error',   err  => reject(err));
  });
}

async function getAlertEmail() {
  try {
    const [[row]] = await db.query(
      "SELECT value FROM settings WHERE category='alerts' AND key_name='alert_email'"
    );
    return row?.value || process.env.ALERT_EMAIL || '';
  } catch { return process.env.ALERT_EMAIL || ''; }
}

async function checkHealth() {
  const results = [];
  const transitions = [];

  for (const svc of SERVICES) {
    let healthy = true;
    let error   = null;
    try {
      await svc.check();
    } catch(e) {
      healthy = false;
      error   = e.message;
    }

    const prev   = prevState[svc.key];
    // First check after startup: only alert if already down (state before a restart is unknown).
    // Seeing a healthy service on first check is the normal case and stays silent.
    const changed = prev === undefined ? !healthy : prev !== healthy;

    if (changed) transitions.push({ svc, healthy, error });
    if (!healthy && downSince[svc.key] === undefined) downSince[svc.key] = Date.now();
    prevState[svc.key] = healthy;

    results.push({ key: svc.key, label: svc.label, healthy, error });
  }

  // Broadcast current health to dashboard
  broadcast('health', results);

  // Alert on transitions (up or down)
  for (const { svc, healthy, error } of transitions) {
    let downtime = '';
    if (healthy && downSince[svc.key] !== undefined) {
      downtime = formatDuration(Date.now() - downSince[svc.key]);
    }
    if (healthy) delete downSince[svc.key];

    const severity = healthy ? 'info' : 'critical';
    const message  = healthy
      ? `${svc.label} is back online${downtime ? ` after ${downtime} down` : ''}.`
      : `${svc.label} is DOWN: ${error}`;

    await saveAlert(`health_${svc.key}`, message, severity);

    // Email on both transitions so a recovery is never left unconfirmed
    const to = await getAlertEmail();
    if (to) {
      await sendMail({
        to,
        subject: healthy
          ? `[MailGuard] Service Recovered: ${svc.label}`
          : `[MailGuard] Service Down: ${svc.label}`,
        text: message,
        html: healthy
          ? `<p style="font-family:sans-serif;color:#16a34a"><strong>✔ ${svc.label} is back online</strong>${downtime ? `<br>Downtime: ${downtime}` : ''}</p>`
          : `<p style="font-family:sans-serif;color:#dc2626"><strong>⚠ ${svc.label} is DOWN</strong><br>${error}</p>`,
      }).catch(e => console.error('[health] email failed:', e.message));
    }
  }

  return results;
}

module.exports = { checkHealth, SERVICES };