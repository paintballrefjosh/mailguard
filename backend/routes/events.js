const router = require('express').Router();
const auth   = require('../middleware/auth');
const db     = require('../utils/db');
const { broadcast }     = require('../services/websocket');
const { lookup }        = require('../services/geoip');
const { reverseLookup, prefetch } = require('../services/rdns');

// ── Policy decision cache ─────────────────────────────────────────────────────
// Keyed by "sender|recipient|sender_ip". The log-shipper's ingest call arrives
// seconds later and picks up the cached action/reason so both end up in one row.
const policyCache = new Map();
const POLICY_CACHE_TTL = 5 * 60 * 1000; // 5 minutes

function setCachedPolicy(sender, recipient, sender_ip, action, reason, helo_name, rule_id) {
  const key = `${sender}|${recipient}|${sender_ip}`;
  policyCache.set(key, { action, reason, helo_name, rule_id, ts: Date.now() });
}

function popCachedPolicy(sender, recipient, sender_ip) {
  const key = `${sender}|${recipient}|${sender_ip}`;
  const entry = policyCache.get(key);
  if (!entry) return null;
  policyCache.delete(key);
  if (Date.now() - entry.ts > POLICY_CACHE_TTL) return null;
  return entry;
}

setInterval(() => {
  const now = Date.now();
  for (const [key, val] of policyCache) {
    if (now - val.ts > POLICY_CACHE_TTL) policyCache.delete(key);
  }
}, 60000);

function internalAuth(req, res, next) {
  const token = req.headers['x-internal-token'];
  if (!token || token !== process.env.MAILGUARD_INTERNAL_TOKEN)
    return res.status(401).json({ error: 'Unauthorized' });
  next();
}

// ── POST /api/events/ingest — called by postfix log-shipper ──────────────────
router.post('/ingest', internalAuth, async (req, res, next) => {
  try {
    const {
      queue_id, action, reason, sender, recipient,
      sender_ip, sender_domain, from_header, subject, headers,
      size_bytes, spam_score, virus_found,
      spf_result, dkim_result, dmarc_result,
      rule_id: shipperRuleId, rule_source: shipperRuleSource
    } = req.body;

    const geo = lookup(sender_ip);

    // Pick up any cached policy decision for this sender/recipient/ip combo.
    // The log-shipper's action is authoritative for reject-stage events
    // (greylist/block/quarantine/flag parsed from NOQUEUE / cleanup log lines).
    // A cached policy decision only enriches genuine delivery ('allow') events —
    // otherwise a cached 'allow' clobbers a real greylist/block, mislabeling it
    // as delivered (regression 2026-07-02).
    const cached = popCachedPolicy(sender, recipient, sender_ip);
    const shipperRejects = action && action !== 'allow';
    let finalAction = shipperRejects ? action : (cached?.action || action || 'allow');
    let finalReason = shipperRejects ? reason : (cached?.reason || reason || null);
    const helo_name = cached?.helo_name || null;

    // Matched rule: the shipper's tag (header/body/milter/policy rejects) wins;
    // otherwise an allow event inherits the rule from the cached policy decision
    // (only when its reason was actually used, i.e. the shipper didn't reject).
    let rule_id = null, rule_source = null;
    if (shipperRuleId && ['blocklist', 'rule'].includes(shipperRuleSource)) {
      rule_id = +shipperRuleId; rule_source = shipperRuleSource;
    } else if (!shipperRejects && cached?.rule_id) {
      rule_id = cached.rule_id; rule_source = 'blocklist';
    }

    // Warm PTR cache for next time this IP sends
    if (sender_ip) prefetch(sender_ip);

    // NOTE: from_email, regex_subject and regex_body rules are no longer
    // evaluated here. They are enforced at SMTP DATA time by Postfix
    // header_checks / body_checks generated from the DB (see
    // utils/postfix-rules.js). The log shipper picks up REJECT/HOLD/WARN
    // log lines and ships events with the appropriate action via this
    // endpoint already.

    const [result] = await db.query(`
      INSERT INTO mail_events
        (queue_id, action, reason, rule_id, rule_source, sender, recipient,
         sender_ip, sender_domain, from_header, helo_name, subject, headers,
         size_bytes, spam_score, virus_found,
         spf_result, dkim_result, dmarc_result,
         country_code, country_name, city, latitude, longitude)
      VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
      [
        queue_id      || null,
        finalAction,
        finalReason,
        rule_id,
        rule_source,
        sender        || null,
        recipient     || null,
        sender_ip     || null,
        sender_domain || null,
        from_header   || null,
        helo_name     || null,
        subject       || null,
        headers ? JSON.stringify(headers) : null,
        size_bytes    || 0,
        spam_score    != null ? spam_score : null,
        virus_found   || null,
        spf_result    || null,
        dkim_result   || null,
        dmarc_result  || null,
        geo?.country_code || null,
        geo?.country_name || null,
        geo?.city         || null,
        geo?.latitude     || null,
        geo?.longitude    || null,
      ]
    );

    // ── Greylist enrichment ───────────────────────────────────────────────────
    if (finalAction === 'allow' && subject && sender && recipient) {
      await db.query(`
        UPDATE mail_events
        SET subject = ?
        WHERE action = 'greylist'
          AND sender    = ?
          AND recipient = ?
          AND subject IS NULL
          AND received_at >= NOW() - INTERVAL 24 HOUR
        ORDER BY received_at DESC
        LIMIT 1`,
        [subject, sender, recipient]
      ).catch(() => {});
    }

    const event = {
      id:            result.insertId,
      received_at:   new Date().toISOString(),
      queue_id,
      action:        finalAction,
      reason:        finalReason,
      rule_id,
      rule_source,
      sender,
      recipient,
      sender_ip,
      sender_domain,
      from_header,
      helo_name,
      subject,
      size_bytes,
      spam_score,
      virus_found,
      spf_result,
      dkim_result,
      dmarc_result,
      country_code:  geo?.country_code,
      country_name:  geo?.country_name,
    };
    broadcast('mail_event', event);

    res.json({ ok: true, id: result.insertId });
  } catch(e) { next(e); }
});

// ── POST /api/events/rule-hit — log shipper bumps a hit counter ─────────────
// Called when postfix header_checks / body_checks fires REJECT/HOLD/WARN
// with a [mailguard:rule_id=N] tag the shipper extracts from the log line.
// The compound-rule milter emits [mailguard:crule_id=N] instead, which the
// shipper posts here with source='rules' so the `rules` table is bumped.
router.post('/rule-hit', internalAuth, async (req, res, next) => {
  try {
    const id = parseInt(req.body?.rule_id, 10);
    if (!id) return res.status(400).json({ error: 'rule_id required' });
    // The `rules` table has no last_hit column; only `blocklists` does.
    if (req.body?.source === 'rules') {
      await db.query('UPDATE rules SET hits=hits+1 WHERE id=?', [id]);
    } else {
      await db.query(
        'UPDATE blocklists SET hits=hits+1, last_hit=NOW() WHERE id=?', [id]);
    }
    res.json({ ok: true });
  } catch(e) { next(e); }
});

// ── POST /api/events/policy — Postfix policy daemon ──────────────────────────
router.post('/policy', internalAuth, async (req, res, next) => {
  try {
    const { sender, recipient, sender_ip, helo_name, queue_id, size } = req.body;
    const sender_domain = sender?.includes('@') ? sender.split('@')[1] : null;
    const geo = lookup(sender_ip);
    const ptr = (await reverseLookup(sender_ip)) ?? null;

    let action = 'DUNNO', reason = null, dbAction = 'allow', ruleId = null;

    // ── IP check ──────────────────────────────────────────────────────────────
    if (sender_ip) {
      const [rows] = await db.query(
        "SELECT id, action, comment FROM blocklists WHERE enabled=1 AND list_type='ip' AND value=? LIMIT 1",
        [sender_ip]
      );
      if (rows.length) {
        reason   = `IP blocklist: ${rows[0].comment || rows[0].id}`;
        dbAction = rows[0].action;
        ruleId   = rows[0].id;
      }
    }

    // ── Domain check (MAIL FROM sender domain) ────────────────────────────────
    // Suffix match: a `domain` entry blocks the domain itself AND any subdomain
    // (example.com also catches mail.example.com), mirroring the helo_domain
    // check below. A stored "*.example.com" is normalised to its base first, so
    // it behaves the same as a bare "example.com". Most-specific rule wins
    // (ORDER BY LENGTH DESC) so a narrow allow can override a broad block.
    if (!reason && sender_domain) {
      const [rows] = await db.query(
        `SELECT id, action, comment, value FROM blocklists
           WHERE enabled=1 AND list_type='domain'
             AND ( ? = (CASE WHEN value LIKE '*.%' THEN SUBSTRING(value,3) ELSE value END)
                OR ? LIKE CONCAT('%.', CASE WHEN value LIKE '*.%' THEN SUBSTRING(value,3) ELSE value END) )
           ORDER BY LENGTH(value) DESC LIMIT 1`,
        [sender_domain, sender_domain]
      );
      if (rows.length) {
        reason   = `Domain blocklist: ${rows[0].comment || rows[0].value}`;
        dbAction = rows[0].action;
        ruleId   = rows[0].id;
      }
    }

    // ── TLD check (sender domain suffix) ─────────────────────────────────────
    if (!reason && sender_domain) {
      const tld = sender_domain.split('.').pop().toLowerCase();
      const [rows] = await db.query(
        "SELECT id, action, comment FROM blocklists WHERE enabled=1 AND list_type='tld' AND value=? LIMIT 1",
        [tld]
      );
      if (rows.length) {
        reason   = `TLD blocklist: .${tld}`;
        dbAction = rows[0].action;
        ruleId   = rows[0].id;
      }
    }

    // ── HELO domain check ─────────────────────────────────────────────────────
    // Matches PTR record (authoritative) first, falls back to announced HELO.
    // Suffix matching: blocking "mailgun.org" also catches "mta1.mailgun.org".
    if (!reason) {
      const [rows] = await db.query(
        "SELECT id, action, comment, value FROM blocklists WHERE enabled=1 AND list_type='helo_domain'"
      );
      for (const row of rows) {
        const val      = row.value.toLowerCase();
        const ptrHost  = ptr?.toLowerCase() ?? null;
        const heloHost = helo_name?.toLowerCase() ?? null;

        const matchPtr  = ptrHost  && (ptrHost  === val || ptrHost.endsWith('.'  + val));
        const matchHelo = heloHost && (heloHost === val || heloHost.endsWith('.' + val) || heloHost.endsWith(val));

        if (matchPtr || matchHelo) {
          const matchedOn = matchPtr ? `PTR ${ptr}` : `HELO ${helo_name}`;
          reason   = `HELO blocklist [${matchedOn}]: ${row.value}`;
          dbAction = row.action;
          ruleId   = row.id;
          break;
        }
      }
    }

    // ── Email check (MAIL FROM full address) ──────────────────────────────────
    if (!reason && sender) {
      const [rows] = await db.query(
        "SELECT id, action, comment FROM blocklists WHERE enabled=1 AND list_type='sender_email' AND value=? LIMIT 1",
        [sender]
      );
      if (rows.length) {
        reason   = `Email blocklist: ${rows[0].comment || sender}`;
        dbAction = rows[0].action;
        ruleId   = rows[0].id;
      }
    }

    if (reason) {
      // The [mailguard:bl_id=N] tag is stripped and turned into rule_id by the
      // log shipper (same convention as header/body checks' rule_id tag).
      const tag = ruleId ? ` [mailguard:bl_id=${ruleId}]` : '';
      if      (dbAction === 'block')      action = `REJECT ${reason}${tag}`;
      else if (dbAction === 'quarantine') action = `HOLD ${reason}${tag}`;
      else if (dbAction === 'allow')      action = 'OK';
    }

    // ── Blocked/quarantined — update hit counters.
    //    The log-shipper handles event insertion via the NOQUEUE reject line.
    if (dbAction === 'block' || dbAction === 'quarantine') {
      const tld = sender_domain?.split('.').pop().toLowerCase() ?? null;
      await db.query(
        `UPDATE blocklists SET hits=hits+1, last_hit=NOW()
         WHERE enabled=1 AND (
           (list_type='ip'           AND value=?) OR
           (list_type='domain'       AND (
             ? = (CASE WHEN value LIKE '*.%' THEN SUBSTRING(value,3) ELSE value END) OR
             ? LIKE CONCAT('%.', CASE WHEN value LIKE '*.%' THEN SUBSTRING(value,3) ELSE value END)
           )) OR
           (list_type='tld'          AND value=?) OR
           (list_type='sender_email' AND value=?) OR
           (list_type='helo_domain'  AND (
             ? LIKE CONCAT('%.', value) OR ? = value OR
             ? LIKE CONCAT('%.', value) OR ? = value
           ))
         )`,
        [sender_ip, sender_domain, sender_domain, tld, sender, ptr, ptr, helo_name, helo_name]
      );
    } else {
      // ── Allowed — cache policy result for ingest to merge into one row
      setCachedPolicy(sender, recipient, sender_ip, dbAction, reason, helo_name, ruleId);
    }

    res.json({ action });
  } catch(e) {
    console.error('[policy]', e.message);
    res.json({ action: 'DUNNO' });
  }
});

// ── GET /api/events/rdns/:ip — reverse DNS lookup ────────────────────────────
router.get('/rdns/:ip', auth, async (req, res, next) => {
  try {
    const ptr = await reverseLookup(req.params.ip);
    res.json({ ptr: ptr || null });
  } catch(e) { next(e); }
});

// ── GET /api/events — mail log ────────────────────────────────────────────────
router.get('/', auth, async (req, res, next) => {
  try {
    const { page=1, limit=50, action, search, from, to } = req.query;
    const offset = (page-1)*limit;
    let where = ['1=1'], params = [];
    if (action) {
      const acts = action.split(',').map(a => a.trim()).filter(Boolean);
      if (acts.length === 1) {
        where.push('action=?'); params.push(acts[0]);
      } else if (acts.length > 1) {
        where.push(`action IN (${acts.map(() => '?').join(',')})`);
        params.push(...acts);
      }
    }
    if (search) {
      where.push('(sender LIKE ? OR recipient LIKE ? OR from_header LIKE ? OR subject LIKE ? OR sender_ip LIKE ? OR sender_domain LIKE ?)');
      const s = `%${search}%`;
      params.push(s, s, s, s, s, s);
    }
    if (from) { where.push('received_at>=?'); params.push(from); }
    if (to)   { where.push('received_at<=?'); params.push(to);   }

    const [[{total}]] = await db.query(
      `SELECT COUNT(*) total FROM mail_events WHERE ${where.join(' AND ')}`, params);
    const [rows] = await db.query(
      `SELECT id, received_at, sender, recipient, subject,
              sender_ip, sender_domain, from_header, helo_name, action, reason,
              spam_score, virus_found, spf_result, dkim_result, dmarc_result,
              size_bytes, country_code, country_name, city
       FROM mail_events WHERE ${where.join(' AND ')}
       ORDER BY received_at DESC LIMIT ? OFFSET ?`,
      [...params, +limit, +offset]);

    res.json({ total, page: +page, limit: +limit, rows });
  } catch(e) { next(e); }
});

// ── GET /api/events/:id — single event detail with headers ───────────────────
router.get('/:id', auth, async (req, res, next) => {
  try {
    const [rows] = await db.query(
      `SELECT *, headers FROM mail_events WHERE id=?`, [req.params.id]);
    if (!rows.length) return res.status(404).json({ error: 'Not found' });
    const row = rows[0];
    if (row.headers && typeof row.headers === 'string') {
      try { row.headers = JSON.parse(row.headers); } catch {}
    }
    row.matched_rule = null;
    if (row.rule_id && row.rule_source) {
      const [r] = row.rule_source === 'rule'
        ? await db.query('SELECT id, name AS label, action FROM rules WHERE id=?', [row.rule_id])
        : await db.query(
            `SELECT id, list_type, value, comment, action FROM blocklists WHERE id=?`, [row.rule_id]);
      const m = r[0];
      row.matched_rule = {
        source: row.rule_source,
        id:     row.rule_id,
        exists: !!m,
        label:  !m ? null
                : row.rule_source === 'rule' ? m.label
                : `${m.list_type}: ${m.value}`,
        action: m?.action || null,
      };
    }
    res.json(row);
  } catch(e) { next(e); }
});

// ── GET /api/events/geo/summary — for world map ───────────────────────────────
router.get('/geo/summary', auth, async (req, res, next) => {
  try {
    const [rows] = await db.query(`
      SELECT country_code, country_name,
             COUNT(*) total,
             SUM(action='block')   blocked,
             SUM(action='allow')   allowed
      FROM mail_events
      WHERE country_code IS NOT NULL
        AND received_at >= NOW() - INTERVAL 7 DAY
      GROUP BY country_code, country_name
      ORDER BY total DESC`);
    res.json(rows);
  } catch(e) { next(e); }
});

module.exports = router;