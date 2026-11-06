const nodemailer = require('nodemailer');

let transport;

function getTransport() {
  if (!transport) {
    transport = nodemailer.createTransport({
      host: process.env.SMTP_HOST || 'postfix',
      port: parseInt(process.env.SMTP_PORT || '25'),
      secure: false,
      tls: { rejectUnauthorized: false },
    });
  }
  return transport;
}

async function sendMail({ to, subject, html, text }) {
  const t = getTransport();
  await t.sendMail({
    from: process.env.SMTP_FROM || `mailguard@${process.env.MAIL_DOMAIN || 'localhost'}`,
    to,
    subject,
    html,
    text,
  });
}

module.exports = { sendMail };