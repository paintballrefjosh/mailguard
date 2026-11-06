const router = require('express').Router();
const auth   = require('../middleware/auth');
const db     = require('../utils/db');
const { regenerateCompoundRules, parseCompound } = require('../utils/compound-rules');

const ALLOWED_COLS = new Set([
  'name', 'description', 'priority', 'conditions',
  'action', 'tag_value', 'enabled',
]);

function pickAllowed(body) {
  const cols = [], vals = [];
  for (const [k, v] of Object.entries(body)) {
    if (ALLOWED_COLS.has(k)) {
      // conditions may arrive as an object/array — store it as JSON text.
      const val = (k === 'conditions' && v != null && typeof v !== 'string')
        ? JSON.stringify(v) : v;
      cols.push(k); vals.push(val);
    }
  }
  return { cols, vals };
}

// Compound (milter-enforced) rules use conditions = {"all":[{field,op,value}]}.
// Validate that shape up front so a bad rule is rejected at write time rather
// than silently dropped by the generator. Legacy object-form rules (used only
// by the ruletest simulator) are left untouched.
function validateConditions(conditions) {
  if (conditions == null) return null;
  let c = conditions;
  if (typeof c === 'string') {
    try { c = JSON.parse(c); } catch { return 'conditions is not valid JSON'; }
  }
  if (c && Array.isArray(c.all)) {
    if (!parseCompound(c))
      return 'Invalid compound conditions — each clause needs a known field ' +
             '(header_from_domain, header_from, subject, body, sender_domain), ' +
             'op (regex, eq, contains) and value; regex must compile.';
  }
  return null;
}

// Fire-and-forget — regenerate the milter's compound_rules.json after any
// mutation. Never blocks the API response.
function resync() {
  regenerateCompoundRules()
    .catch(e => console.warn('[rules] compound regen failed:', e.message));
}

router.get('/', auth, async (req, res, next) => {
  try {
    const [r] = await db.query('SELECT * FROM rules ORDER BY id DESC');
    res.json(r);
  } catch(e) { next(e); }
});

router.post('/', auth, async (req, res, next) => {
  try {
    const cerr = validateConditions(req.body.conditions);
    if (cerr) return res.status(400).json({ error: cerr });
    const { cols, vals } = pickAllowed(req.body);
    if (!cols.length) return res.status(400).json({ error: 'No valid fields provided' });
    const [r] = await db.query(
      `INSERT INTO rules (${cols.join(',')}) VALUES (${cols.map(() => '?').join(',')})`,
      vals
    );
    resync();
    res.json({ id: r.insertId });
  } catch(e) { next(e); }
});

router.put('/:id', auth, async (req, res, next) => {
  try {
    const cerr = validateConditions(req.body.conditions);
    if (cerr) return res.status(400).json({ error: cerr });
    const { cols, vals } = pickAllowed(req.body);
    if (!cols.length) return res.status(400).json({ error: 'No valid fields provided' });
    await db.query(
      `UPDATE rules SET ${cols.map(c => `${c}=?`).join(',')} WHERE id=?`,
      [...vals, req.params.id]
    );
    resync();
    res.json({ ok: true });
  } catch(e) { next(e); }
});

router.delete('/:id', auth, async (req, res, next) => {
  try {
    await db.query('DELETE FROM rules WHERE id=?', [req.params.id]);
    resync();
    res.json({ ok: true });
  } catch(e) { next(e); }
});

module.exports = router;