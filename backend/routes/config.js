const router = require('express').Router();
const auth   = require('../middleware/auth');
const db     = require('../utils/db');

// ── GET /api/config/export — export all config as JSON ───────────────────────
router.get('/export', auth, async (req, res, next) => {
  try {
    const [blocklists]    = await db.query('SELECT list_type,value,action,comment,enabled FROM blocklists ORDER BY list_type,value');
    const [rules]         = await db.query('SELECT name,description,priority,conditions,action,tag_value,enabled FROM rules ORDER BY priority');
    const [settings]      = await db.query('SELECT category,key_name,value,value_type,description FROM settings ORDER BY category,key_name');
    const [surbl]         = await db.query('SELECT name,zone,enabled,weight FROM surbl_lists ORDER BY name');
    const [auth_settings] = await db.query('SELECT setting_key,value FROM auth_settings ORDER BY setting_key');

    const payload = {
      exported_at: new Date().toISOString(),
      version: '1.0',
      blocklists,
      rules,
      settings,
      surbl_lists: surbl,
      auth_settings,
    };

    res.setHeader('Content-Type', 'application/json');
    res.setHeader('Content-Disposition', `attachment; filename="mailguard-config-${new Date().toISOString().slice(0,10)}.json"`);
    res.json(payload);
  } catch(e) { next(e); }
});

// ── POST /api/config/import — import config from JSON ────────────────────────
router.post('/import', auth, async (req, res, next) => {
  try {
    const { blocklists, rules, settings, surbl_lists, auth_settings, merge = true } = req.body;
    const results = { imported: {}, errors: [] };

    // Import blocklists
    if (blocklists?.length) {
      let count = 0;
      for (const b of blocklists) {
        try {
          await db.query(
            `INSERT INTO blocklists (list_type,value,action,comment,enabled)
             VALUES (?,?,?,?,?)
             ON DUPLICATE KEY UPDATE action=VALUES(action),comment=VALUES(comment),enabled=VALUES(enabled)`,
            [b.list_type, b.value, b.action||'block', b.comment||null, b.enabled??true]
          );
          count++;
        } catch(e) { results.errors.push(`blocklist ${b.value}: ${e.message}`); }
      }
      results.imported.blocklists = count;
    }

    // Import rules
    if (rules?.length) {
      if (!merge) await db.query('DELETE FROM rules');
      let count = 0;
      for (const r of rules) {
        try {
          await db.query(
            `INSERT INTO rules (name,description,priority,conditions,action,tag_value,enabled)
             VALUES (?,?,?,?,?,?,?)
             ON DUPLICATE KEY UPDATE description=VALUES(description),priority=VALUES(priority),
             conditions=VALUES(conditions),action=VALUES(action),enabled=VALUES(enabled)`,
            [r.name, r.description||null, r.priority||100,
             typeof r.conditions==='string'?r.conditions:JSON.stringify(r.conditions),
             r.action, r.tag_value||null, r.enabled??true]
          );
          count++;
        } catch(e) { results.errors.push(`rule ${r.name}: ${e.message}`); }
      }
      results.imported.rules = count;
    }

    // Import settings
    if (settings?.length) {
      let count = 0;
      for (const s of settings) {
        try {
          await db.query(
            `INSERT INTO settings (category,key_name,value,value_type,description)
             VALUES (?,?,?,?,?)
             ON DUPLICATE KEY UPDATE value=VALUES(value)`,
            [s.category, s.key_name, s.value, s.value_type||'string', s.description||null]
          );
          count++;
        } catch(e) { results.errors.push(`setting ${s.category}.${s.key_name}: ${e.message}`); }
      }
      results.imported.settings = count;
    }

    // Import SURBL
    if (surbl_lists?.length) {
      let count = 0;
      for (const s of surbl_lists) {
        try {
          await db.query(
            `INSERT INTO surbl_lists (name,zone,enabled,weight)
             VALUES (?,?,?,?)
             ON DUPLICATE KEY UPDATE enabled=VALUES(enabled),weight=VALUES(weight)`,
            [s.name, s.zone, s.enabled??true, s.weight||1.0]
          );
          count++;
        } catch(e) { results.errors.push(`surbl ${s.name}: ${e.message}`); }
      }
      results.imported.surbl_lists = count;
    }

    // Import auth settings
    if (auth_settings?.length) {
      let count = 0;
      for (const a of auth_settings) {
        try {
          await db.query(
            `INSERT INTO auth_settings (setting_key,value) VALUES (?,?)
             ON DUPLICATE KEY UPDATE value=VALUES(value)`,
            [a.setting_key, a.value]
          );
          count++;
        } catch(e) { results.errors.push(`auth_setting ${a.setting_key}: ${e.message}`); }
      }
      results.imported.auth_settings = count;
    }

    res.json({ ok: true, results });
  } catch(e) { next(e); }
});

// ── POST /api/config/test — test a message against rules/blocklists ───────────
router.post('/test', auth, async (req, res, next) => {
  try {
    const { raw, mode = 'headers' } = req.body; // mode: headers | full
    if (!raw) return res.status(400).json({ error: 'raw message required' });

    const results = { matches: [], action: 'allow', headers: {} };

    // Parse headers from raw input
    const headerSection = mode === 'full'
      ? raw.split(/\r?\n\r?\n/)[0]
      : raw;

    const headerLines = headerSection.split(/\r?\n/);
    const headers = {};
    let currentKey = null;
    for (const line of headerLines) {
      if (/^\s+/.test(line) && currentKey) {
        headers[currentKey] += ' ' + line.trim();
      } else {
        const m = line.match(/^([\w-]+):\s*(.*)$/);
        if (m) { currentKey = m[1].toLowerCase(); headers[currentKey] = m[2]; }
      }
    }
    results.headers = headers;

    // Extract key fields
    const fromHeader   = headers['from'] || '';
    const subject      = headers['subject'] || '';
    const body         = mode === 'full' ? (raw.split(/\r?\n\r?\n/).slice(1).join('\n\n')) : '';
    const senderMatch  = fromHeader.match(/<([^>]+)>/) || fromHeader.match(/(\S+@\S+)/);
    const sender       = senderMatch?.[1] || '';
    const senderDomain = sender.includes('@') ? sender.split('@')[1] : '';
    const receivedFrom = headers['received'] || '';
    const ipMatch      = receivedFrom.match(/\[(\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3})\]/);
    const senderIp     = ipMatch?.[1] || '';

    results.extracted = { sender, senderDomain, senderIp, subject };

    // Check IP blocklist
    if (senderIp) {
      const [rows] = await db.query(
        "SELECT * FROM blocklists WHERE enabled=1 AND list_type='ip' AND value=?", [senderIp]);
      if (rows.length) results.matches.push({ type:'ip', value:senderIp, action:rows[0].action, comment:rows[0].comment });
    }

    // Check domain blocklist
    if (senderDomain) {
      const [rows] = await db.query(
        "SELECT * FROM blocklists WHERE enabled=1 AND list_type='domain' AND value=?", [senderDomain]);
      if (rows.length) results.matches.push({ type:'domain', value:senderDomain, action:rows[0].action, comment:rows[0].comment });
    }

    // Check email blocklist
    if (sender) {
      const [rows] = await db.query(
        "SELECT * FROM blocklists WHERE enabled=1 AND list_type='email' AND value=?", [sender]);
      if (rows.length) results.matches.push({ type:'email', value:sender, action:rows[0].action, comment:rows[0].comment });
    }

    // Check subject regex patterns
    const [subjectRules] = await db.query(
      "SELECT * FROM blocklists WHERE enabled=1 AND list_type='regex_subject'");
    for (const r of subjectRules) {
      try {
        if (new RegExp(r.value, 'i').test(subject)) {
          results.matches.push({ type:'regex_subject', value:r.value, action:r.action, comment:r.comment });
        }
      } catch {}
    }

    // Check body regex patterns
    if (body) {
      const [bodyRules] = await db.query(
        "SELECT * FROM blocklists WHERE enabled=1 AND list_type='regex_body'");
      for (const r of bodyRules) {
        try {
          if (new RegExp(r.value, 'i').test(body)) {
            results.matches.push({ type:'regex_body', value:r.value, action:r.action, comment:r.comment });
          }
        } catch {}
      }
    }

    // Check rules engine
    const [rules] = await db.query("SELECT * FROM rules WHERE enabled=1 ORDER BY priority ASC");
    for (const rule of rules) {
      const cond = typeof rule.conditions === 'string' ? JSON.parse(rule.conditions) : rule.conditions;
      let matched = false;

      if (cond.spam_score_gte && results.spam_score >= cond.spam_score_gte) matched = true;
      if (cond.sender_ip_cidr && senderIp) matched = true; // simplified
      if (cond.attachment_ext) matched = false; // can't check without full message

      if (matched) {
        results.matches.push({ type:'rule', value:rule.name, action:rule.action, comment:rule.description });
      }
    }

    // Determine final action (highest priority match)
    const priority = { block:4, quarantine:3, flag:2, allow:1 };
    for (const m of results.matches) {
      if ((priority[m.action]||0) > (priority[results.action]||0)) {
        results.action = m.action;
      }
    }

    res.json(results);
  } catch(e) { next(e); }
});

module.exports = router;