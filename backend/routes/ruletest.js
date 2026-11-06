const router = require('express').Router();
const auth   = require('../middleware/auth');
const db     = require('../utils/db');

// Parse raw email headers or full email into a structured object
function parseHeaders(raw) {
  const headers = {};
  const lines   = raw.replace(/\r\n/g, '\n').split('\n');
  let current   = null;

  for (const line of lines) {
    if (!line.trim()) break; // end of headers
    if (line.match(/^\s+/) && current) {
      // Continuation
      headers[current] += ' ' + line.trim();
    } else {
      const m = line.match(/^([\w-]+):\s*(.*)$/);
      if (m) {
        current = m[1].toLowerCase();
        headers[current] = m[2];
      }
    }
  }
  return headers;
}

function extractEnvelope(headers, body = '') {
  // Extract from, to, subject, IP from headers
  const from     = headers['from']     || headers['return-path'] || '';
  const to       = headers['to']       || '';
  const subject  = headers['subject']  || '';
  const received = headers['received'] || '';
  const msgId    = headers['message-id'] || '';

  // Try to extract sender IP from Received header
  const ipMatch = received.match(/\[(\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3})\]/);
  const sender_ip = ipMatch ? ipMatch[1] : null;

  // Extract email address from From header
  const emailMatch = from.match(/<?([^<>\s]+@[^<>\s]+)>?/);
  const sender     = emailMatch ? emailMatch[1].toLowerCase() : from.toLowerCase();
  const domain     = sender.includes('@') ? sender.split('@')[1] : '';

  // Extract spam score
  const spamHeader = headers['x-spam-score'] || headers['x-spam-status'] || '';
  const spamMatch  = spamHeader.match(/([\d.]+)/);
  const spam_score = spamMatch ? parseFloat(spamMatch[1]) : null;

  // Extract auth results
  const authHeader = headers['authentication-results'] || headers['arc-authentication-results'] || '';
  const spfMatch   = authHeader.match(/spf=(\w+)/i);
  const dkimMatch  = authHeader.match(/dkim=(\w+)/i);
  const dmarcMatch = authHeader.match(/dmarc=(\w+)/i);

  return {
    sender, domain, sender_ip, subject, spam_score,
    spf_result:   spfMatch  ? spfMatch[1].toLowerCase()  : null,
    dkim_result:  dkimMatch ? dkimMatch[1].toLowerCase() : null,
    dmarc_result: dmarcMatch? dmarcMatch[1].toLowerCase(): null,
    has_body:     body.trim().length > 0,
    body_preview: body.trim().slice(0, 500),
    raw_headers:  headers,
  };
}

async function testAgainstBlocklists(env) {
  const matches = [];

  // IP check
  if (env.sender_ip) {
    const [rows] = await db.query(
      "SELECT id,list_type,value,action,comment FROM blocklists WHERE enabled=1 AND list_type='ip' AND value=?",
      [env.sender_ip]
    );
    rows.forEach(r => matches.push({ source: 'blocklist', ...r, matched_value: env.sender_ip }));
  }

  // CIDR check (simplified — exact match only for test)
  if (env.sender_ip) {
    const [rows] = await db.query(
      "SELECT id,list_type,value,action,comment FROM blocklists WHERE enabled=1 AND list_type='cidr'",
    );
    // Note: full CIDR matching would need a library; we show the list for manual review
    if (rows.length) matches.push({ source: 'info', action: 'review', comment: `${rows.length} CIDR entries exist — manual IP range check required` });
  }

  // Domain check
  if (env.domain) {
    const [rows] = await db.query(
      "SELECT id,list_type,value,action,comment FROM blocklists WHERE enabled=1 AND list_type='domain' AND value=?",
      [env.domain]
    );
    rows.forEach(r => matches.push({ source: 'blocklist', ...r, matched_value: env.domain }));
  }

  // Email check
  if (env.sender) {
    const [rows] = await db.query(
      "SELECT id,list_type,value,action,comment FROM blocklists WHERE enabled=1 AND list_type='email' AND value=?",
      [env.sender]
    );
    rows.forEach(r => matches.push({ source: 'blocklist', ...r, matched_value: env.sender }));
  }

  // Regex subject check
  if (env.subject) {
    const [rows] = await db.query(
      "SELECT id,list_type,value,action,comment FROM blocklists WHERE enabled=1 AND list_type='regex_subject'"
    );
    for (const r of rows) {
      try {
        if (new RegExp(r.value, 'i').test(env.subject))
          matches.push({ source: 'blocklist', ...r, matched_value: env.subject });
      } catch {}
    }
  }

  // Regex body check
  if (env.body_preview) {
    const [rows] = await db.query(
      "SELECT id,list_type,value,action,comment FROM blocklists WHERE enabled=1 AND list_type='regex_body'"
    );
    for (const r of rows) {
      try {
        if (new RegExp(r.value, 'i').test(env.body_preview))
          matches.push({ source: 'blocklist', ...r, matched_value: '(body match)' });
      } catch {}
    }
  }

  return matches;
}

async function testAgainstRules(env) {
  const [rules] = await db.query(
    'SELECT * FROM rules WHERE enabled=1 ORDER BY priority ASC'
  );
  const matches = [];

  for (const rule of rules) {
    const conds = typeof rule.conditions === 'string'
      ? JSON.parse(rule.conditions) : rule.conditions;
    let matched = false;

    // Evaluate each condition type
    if (conds.sender_ip_cidr && env.sender_ip) {
      matched = conds.sender_ip_cidr.some(cidr => env.sender_ip.startsWith(cidr.split('/')[0].split('.').slice(0,3).join('.')));
    }
    if (conds.spam_score_gte != null && env.spam_score != null) {
      if (env.spam_score >= conds.spam_score_gte) matched = true;
    }
    if (conds.virus_detected && env.virus_found) matched = true;
    if (conds.attachment_ext && env.raw_headers['content-type']) {
      matched = conds.attachment_ext.some(ext => env.raw_headers['content-type'].includes(ext));
    }

    if (matched) matches.push({ source: 'rule', name: rule.name, action: rule.action, priority: rule.priority, conditions: conds });
  }

  return matches;
}

// POST /api/ruletest — test headers/email against all active rules and blocklists
router.post('/', auth, async (req, res, next) => {
  try {
    const { raw, mode = 'headers' } = req.body; // mode: 'headers' | 'full'
    if (!raw?.trim()) return res.status(400).json({ error: 'No input provided' });

    // Split headers from body for full email mode
    const sep    = raw.indexOf('\n\n') > -1 ? raw.indexOf('\n\n') : raw.indexOf('\r\n\r\n');
    const headerPart = sep > -1 ? raw.slice(0, sep) : raw;
    const bodyPart   = sep > -1 ? raw.slice(sep + 2) : '';

    const headers    = parseHeaders(headerPart);
    const env        = extractEnvelope(headers, mode === 'full' ? bodyPart : '');

    const [blockMatches, ruleMatches] = await Promise.all([
      testAgainstBlocklists(env),
      testAgainstRules(env),
    ]);

    const allMatches = [...blockMatches, ...ruleMatches];

    // Determine final action (highest priority = lowest number wins, blocks beat flags)
    const ACTION_PRIORITY = { block: 0, quarantine: 1, flag: 2, allow: 3, DUNNO: 4 };
    let finalAction = 'allow';
    let finalReason = 'No rules matched — message would be allowed';

    for (const m of allMatches) {
      if ((ACTION_PRIORITY[m.action] ?? 99) < (ACTION_PRIORITY[finalAction] ?? 99)) {
        finalAction = m.action;
        finalReason = m.source === 'rule'
          ? `Rule: ${m.name}`
          : `${m.list_type} blocklist: ${m.matched_value}`;
      }
    }

    res.json({
      envelope: env,
      matches:  allMatches,
      final_action: finalAction,
      final_reason: finalReason,
      test_mode:    true,
    });
  } catch(e) { next(e); }
});

module.exports = router;