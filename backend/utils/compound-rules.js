// Generates the compound-rule file the MailGuard milter enforces.
//
// Source of truth is the `rules` table. A row is a "compound rule" (enforced
// by the milter at SMTP time) when its conditions JSON has an "all" array of
// {field, op, value} clauses that are AND-ed together. This is what lets a
// single rule span multiple message parts — e.g. header From: domain AND body
// content — which Postfix's line-oriented header_checks/body_checks maps can
// never express.
//
// Only action='block' is enforced by the milter (it returns a hard 5xx REJECT
// at end-of-DATA). quarantine/flag need post-queue machinery and are skipped.
//
// The milter hot-reloads this file on mtime change, so writing it is enough —
// no reload/exec needed.

const fs   = require('fs').promises;
const path = require('path');
const db   = require('./db');

const MAPS_DIR   = process.env.POSTFIX_MAPS_DYNAMIC || '/mailguard/maps-dynamic';
const RULES_FILE = path.join(MAPS_DIR, 'compound_rules.json');

const KNOWN_FIELDS = new Set([
  'header_from_domain', 'header_from', 'subject', 'body', 'sender_domain',
]);
const KNOWN_OPS = new Set(['regex', 'eq', 'contains']);

// Parse a rules.conditions value (JSON string or already-parsed object) and,
// if it's a compound rule, return its normalised clause array. Returns null
// for the legacy object-form rules (spam_score_gte, attachment_ext, …) which
// the milter does not handle.
function parseCompound(conditions) {
  let c = conditions;
  if (typeof c === 'string') {
    try { c = JSON.parse(c); } catch { return null; }
  }
  if (!c || !Array.isArray(c.all) || c.all.length === 0) return null;

  const clauses = [];
  for (const clause of c.all) {
    if (!clause || typeof clause !== 'object') return null;
    const field = clause.field;
    const op    = (clause.op || 'regex').toLowerCase();
    const value = clause.value;
    if (!KNOWN_FIELDS.has(field) || !KNOWN_OPS.has(op) || value == null || value === '')
      return null;
    if (op === 'regex') {
      try { new RegExp(value); } catch { return null; }
    }
    clauses.push({ field, op, value: String(value) });
  }
  return clauses;
}

async function ensureDir() {
  await fs.mkdir(MAPS_DIR, { recursive: true });
}

async function regenerateCompoundRules() {
  await ensureDir();
  const [rows] = await db.query(
    `SELECT id, name, conditions, action, enabled
       FROM rules
      WHERE enabled = 1 AND action = 'block'
      ORDER BY priority ASC, id ASC`
  );

  const out = [];
  let skipped = 0;
  for (const r of rows) {
    const clauses = parseCompound(r.conditions);
    if (!clauses) { skipped++; continue; }
    out.push({
      id:         r.id,
      action:     'block',
      reason:     r.name || 'Blocked by MailGuard rule',
      conditions: clauses,
    });
  }

  await fs.writeFile(RULES_FILE, JSON.stringify(out, null, 2) + '\n', 'utf8');
  return { compound_rules: out.length, skipped_non_compound: skipped };
}

module.exports = { regenerateCompoundRules, parseCompound };
