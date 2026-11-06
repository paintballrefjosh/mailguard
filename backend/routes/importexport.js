const router = require('express').Router();
const auth   = require('../middleware/auth');
const db     = require('../utils/db');

// ── GET /api/export — export all config as JSON ───────────────────────────────
router.get('/', auth, async (req, res, next) => {
  try {
    const [blocklists]  = await db.query('SELECT list_type,value,action,comment,enabled FROM blocklists ORDER BY list_type,value');
    const [rules]       = await db.query('SELECT name,description,priority,conditions,action,tag_value,enabled FROM rules ORDER BY priority');
    const [settings]    = await db.query('SELECT category,key_name,value,value_type,description FROM settings ORDER BY category,key_name');
    const [surbl]       = await db.query('SELECT name,zone,enabled,weight FROM surbl_lists ORDER BY name');
    const [auth_settings] = await db.query('SELECT setting_key,value FROM auth_settings ORDER BY setting_key');

    const payload = {
      version:     '1.0',
      exported_at: new Date().toISOString(),
      blocklists,
      rules: rules.map(r => ({
        ...r,
        conditions: typeof r.conditions === 'string' ? JSON.parse(r.conditions) : r.conditions,
      })),
      settings,
      surbl,
      auth_settings,
    };

    const { format = 'json' } = req.query;

    if (format === 'csv') {
      // CSV export of blocklists only
      const lines = ['list_type,value,action,comment,enabled'];
      blocklists.forEach(b => {
        lines.push(`${b.list_type},"${b.value}","${b.action}","${(b.comment||'').replace(/"/g,'""')}",${b.enabled}`);
      });
      res.setHeader('Content-Type', 'text/csv');
      res.setHeader('Content-Disposition', `attachment; filename="mailguard-blocklists-${Date.now()}.csv"`);
      return res.send(lines.join('\n'));
    }

    res.setHeader('Content-Type', 'application/json');
    res.setHeader('Content-Disposition', `attachment; filename="mailguard-config-${Date.now()}.json"`);
    res.json(payload);
  } catch(e) { next(e); }
});

// ── POST /api/export/import — import config from JSON ─────────────────────────
router.post('/import', auth, async (req, res, next) => {
  try {
    const data     = req.body;
    const results  = { blocklists: 0, rules: 0, settings: 0, surbl: 0, errors: [] };
    const { merge = true } = req.query; // merge=true keeps existing, merge=false replaces

    if (data.blocklists?.length) {
      for (const b of data.blocklists) {
        try {
          await db.query(`
            INSERT INTO blocklists (list_type, value, action, comment, enabled)
            VALUES (?,?,?,?,?)
            ON DUPLICATE KEY UPDATE action=VALUES(action), comment=VALUES(comment), enabled=VALUES(enabled)`,
            [b.list_type, b.value, b.action||'block', b.comment||'', b.enabled!==false?1:0]
          );
          results.blocklists++;
        } catch(e) { results.errors.push(`blocklist ${b.value}: ${e.message}`); }
      }
    }

    if (data.rules?.length) {
      if (!merge) await db.query("DELETE FROM rules WHERE 1=1");
      for (const r of data.rules) {
        try {
          await db.query(`
            INSERT INTO rules (name, description, priority, conditions, action, tag_value, enabled)
            VALUES (?,?,?,?,?,?,?)
            ON DUPLICATE KEY UPDATE description=VALUES(description), priority=VALUES(priority),
              conditions=VALUES(conditions), action=VALUES(action), enabled=VALUES(enabled)`,
            [r.name, r.description||'', r.priority||100,
             JSON.stringify(r.conditions||{}), r.action||'flag', r.tag_value||null, r.enabled!==false?1:0]
          );
          results.rules++;
        } catch(e) { results.errors.push(`rule ${r.name}: ${e.message}`); }
      }
    }

    if (data.settings?.length) {
      for (const s of data.settings) {
        try {
          await db.query(`
            INSERT INTO settings (category, key_name, value, value_type, description)
            VALUES (?,?,?,?,?)
            ON DUPLICATE KEY UPDATE value=VALUES(value)`,
            [s.category, s.key_name, s.value, s.value_type||'string', s.description||'']
          );
          results.settings++;
        } catch(e) { results.errors.push(`setting ${s.category}.${s.key_name}: ${e.message}`); }
      }
    }

    if (data.surbl?.length) {
      for (const s of data.surbl) {
        try {
          await db.query(`
            INSERT INTO surbl_lists (name, zone, enabled, weight)
            VALUES (?,?,?,?)
            ON DUPLICATE KEY UPDATE enabled=VALUES(enabled), weight=VALUES(weight)`,
            [s.name, s.zone, s.enabled!==false?1:0, s.weight||1.0]
          );
          results.surbl++;
        } catch(e) { results.errors.push(`surbl ${s.name}: ${e.message}`); }
      }
    }

    res.json({ ok: true, results });
  } catch(e) { next(e); }
});

module.exports = router;