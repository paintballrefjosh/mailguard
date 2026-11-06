import React, { useState, useEffect, useRef } from 'react';
import { useSearchParams } from 'react-router-dom';
import { Shield, List, Cpu, Settings as Gear, AlertTriangle,
         Globe, Download, Upload, FlaskConical, TestTube, Filter,
         Clock, Lightbulb, Server, ShieldX } from 'lucide-react';
import api from '../utils/api';

// ── Shared components ─────────────────────────────────────────────────────────
// Scroll to + flash a row deep-linked via ?highlight=<id> (e.g. from the event
// detail's "Matched rule" link, or the mail log's "View rule"). Call with
// ready=true once the list has loaded; rows must carry id={`hl-${id}`} and
// apply the 'mg-rule-flash' class (see index.css) when this returns their id.
function useHighlight(highlightId, ready) {
  const [active, setActive] = useState(null);
  useEffect(() => {
    if (!highlightId || !ready) return;
    const el = document.getElementById(`hl-${highlightId}`);
    if (!el) return;
    el.scrollIntoView({ block: 'center', behavior: 'smooth' });
    setActive(String(highlightId));
    const t = setTimeout(() => setActive(null), 2900); // two 1.4s flashes
    return () => clearTimeout(t);
  }, [highlightId, ready]);
  return active;
}

function Toggle({ label, desc, val, onChange }) {
  return (
    <label style={{display:'flex',alignItems:'center',justifyContent:'space-between',
      padding:'12px 0',borderBottom:'1px solid #1f2937',cursor:'pointer'}}>
      <div>
        <p style={{fontSize:'0.875rem',fontWeight:500,color:'#e5e7eb',margin:0}}>{label}</p>
        {desc && <p style={{fontSize:'0.75rem',color:'#6b7280',margin:'2px 0 0'}}>{desc}</p>}
      </div>
      <div onClick={e => { e.preventDefault(); onChange(); }}
        style={{width:'40px',height:'22px',borderRadius:'11px',flexShrink:0,
          background:val?'#4f46e5':'#374151',position:'relative',
          transition:'background 0.2s',cursor:'pointer',marginLeft:'16px'}}>
        <div style={{width:'16px',height:'16px',background:'white',borderRadius:'50%',
          position:'absolute',top:'3px',transition:'left 0.2s',left:val?'21px':'3px'}}/>
      </div>
    </label>
  );
}

const ACTION_OPTIONS = ['allow','flag','quarantine','block'];
const ACTION_LABELS  = { allow:'Allow', flag:'Flag', quarantine:'Quarantine', block:'Block/Reject' };
const ACTION_COLORS  = {
  allow:      {background:'rgba(20,83,45,0.3)',    color:'#86efac'},
  flag:       {background:'rgba(120,53,15,0.3)',   color:'#fcd34d'},
  quarantine: {background:'rgba(88,28,135,0.3)',   color:'#d8b4fe'},
  block:      {background:'rgba(127,29,29,0.3)',   color:'#fca5a5'},
};

function ActionSelect({ value, onChange }) {
  return (
    <div style={{display:'flex',gap:'4px',flexWrap:'wrap'}}>
      {ACTION_OPTIONS.map(a => (
        <button key={a} onClick={() => onChange(a)}
          style={{padding:'4px 12px',borderRadius:'6px',fontSize:'0.75rem',fontWeight:500,
            cursor:'pointer',border:'none',transition:'all 0.15s',
            ...(value===a ? ACTION_COLORS[a] : {background:'#1f2937',color:'#6b7280'})}}>
          {ACTION_LABELS[a]}
        </button>
      ))}
    </div>
  );
}

function ScoreRow({ label, desc, value, onChange }) {
  return (
    <div style={{display:'flex',alignItems:'center',justifyContent:'space-between',
      padding:'10px 0',borderBottom:'1px solid #1f2937'}}>
      <div>
        <p style={{fontSize:'0.875rem',fontWeight:500,color:'#e5e7eb',margin:0}}>{label}</p>
        {desc && <p style={{fontSize:'0.75rem',color:'#6b7280',margin:'2px 0 0'}}>{desc}</p>}
      </div>
      <input type="number" step="0.5" min="0" max="100"
        style={{width:'80px',textAlign:'center',background:'#1f2937',border:'1px solid #374151',
          borderRadius:'8px',padding:'6px',color:'#e5e7eb',fontSize:'0.875rem'}}
        value={value} onChange={e => onChange(e.target.value)}/>
    </div>
  );
}

const TABS = [
  { key:'general',         label:'General',           icon: Gear },
  { key:'blocklists',      label:'Blocklists',        icon: List },
  { key:'suggestions',     label:'Suggestions',       icon: Lightbulb },
  { key:'rules',           label:'Rules',             icon: AlertTriangle },
  { key:'spam',            label:'Spam & Virus',      icon: Shield },
  { key:'spamfilter',      label:'Spam Filtering',    icon: Filter },
  { key:'greylist',        label:'Greylist & Rate',   icon: Clock },
  { key:'auth',            label:'SPF/DKIM/DMARC',    icon: Cpu },
  { key:'surbl',           label:'SURBL/URIBL',       icon: Globe },
  { key:'alertthresholds', label:'Alert Thresholds',  icon: AlertTriangle },
  { key:'testmode',        label:'Test Mode',         icon: FlaskConical },
  { key:'ruletest',        label:'Rule Tester',       icon: TestTube },
  { key:'importexport',    label:'Import/Export',     icon: Download },
];

// ── Suggestions Tab ───────────────────────────────────────────────────────────
const SUGGESTION_TYPE_ICON = {
  ip:          <Server  size={13} style={{color:'#f87171',flexShrink:0}}/>,
  domain:      <Globe   size={13} style={{color:'#fbbf24',flexShrink:0}}/>,
  helo_domain: <ShieldX size={13} style={{color:'#c084fc',flexShrink:0}}/>,
};
const SUGGESTION_TYPE_LABEL = { ip:'IP', domain:'Domain', helo_domain:'HELO' };

function SuggestionsTab() {
  const [items,    setItems]    = useState([]);
  const [loading,  setLoading]  = useState(false);
  const [blocking, setBlocking] = useState({});
  const [blocked,  setBlocked]  = useState({});
  const [toast,    setToast]    = useState(null);
  const [showDismissed, setShowDismissed] = useState(false);

  const notify = (msg, ok = true) => {
    setToast({ msg, ok });
    setTimeout(() => setToast(null), 3000);
  };

  const load = () => {
    setLoading(true);
    api.get('/suggestions')
      .then(r => setItems(r.data))
      .catch(() => {})
      .finally(() => setLoading(false));
  };
  useEffect(() => { load(); }, []);

  const block = async (s) => {
    const key = `${s.type}:${s.value}`;
    if (blocked[key]) return;
    setBlocking(b => ({ ...b, [key]: true }));
    try {
      await api.post('/blocklists', {
        list_type: s.type,
        value:     s.value,
        action:    'block',
        comment:   `Auto-suggested: ${s.reason}`,
        enabled:   true,
      });
      setBlocked(b => ({ ...b, [key]: true }));
      notify(`Blocked ${SUGGESTION_TYPE_LABEL[s.type]}: ${s.value}`);
      setTimeout(load, 500);
    } catch(e) {
      notify(e.response?.data?.error || e.message, false);
    }
    setBlocking(b => ({ ...b, [key]: false }));
  };

  const dismiss = async (s) => {
    try {
      await api.post('/suggestions/dismiss', { type: s.type, value: s.value });
      setItems(prev => prev.map(i =>
        i.type === s.type && i.value === s.value ? { ...i, dismissed: true } : i
      ));
    } catch(e) { notify('Dismiss failed', false); }
  };

  const clearDismissals = async () => {
    try {
      await api.delete('/suggestions/dismissals');
      load();
      notify('Dismissals cleared — all suggestions restored');
    } catch { notify('Failed to clear dismissals', false); }
  };

  const visible   = items.filter(i => showDismissed ? true : !i.dismissed);
  const dismissed = items.filter(i => i.dismissed).length;
  const active    = items.filter(i => !i.dismissed && !blocked[`${i.type}:${i.value}`]).length;

  return (
    <div className="space-y-4" style={{maxWidth:'700px'}}>
      <div style={{display:'flex',alignItems:'center',justifyContent:'space-between',flexWrap:'wrap',gap:'10px'}}>
        <div>
          <h3 style={{fontSize:'0.875rem',fontWeight:600,color:'#d1d5db',margin:0}}>
            Blocklist Suggestions
            {active > 0 && (
              <span style={{marginLeft:'8px',background:'rgba(245,158,11,0.2)',
                color:'#fbbf24',borderRadius:'999px',padding:'1px 8px',
                fontSize:'0.7rem',fontWeight:700}}>
                {active} new
              </span>
            )}
          </h3>
          <p style={{fontSize:'0.75rem',color:'#6b7280',margin:'2px 0 0'}}>
            Patterns detected from recent mail events. Suggestions reset after 24h.
          </p>
        </div>
        <div style={{display:'flex',gap:'8px'}}>
          {dismissed > 0 && (
            <button onClick={() => setShowDismissed(s => !s)}
              style={{padding:'4px 12px',borderRadius:'6px',fontSize:'0.75rem',
                cursor:'pointer',border:'none',
                background:showDismissed?'rgba(99,102,241,0.2)':'#1f2937',
                color:showDismissed?'#a5b4fc':'#6b7280'}}>
              {showDismissed ? 'Hide' : 'Show'} dismissed ({dismissed})
            </button>
          )}
          {dismissed > 0 && (
            <button onClick={clearDismissals}
              style={{padding:'4px 12px',borderRadius:'6px',fontSize:'0.75rem',
                cursor:'pointer',border:'none',background:'#1f2937',color:'#6b7280'}}>
              Clear dismissals
            </button>
          )}
          <button onClick={load} disabled={loading}
            style={{padding:'4px 12px',borderRadius:'6px',fontSize:'0.75rem',
              cursor:'pointer',border:'none',background:'#1f2937',color:'#6b7280',
              opacity:loading?0.5:1}}>
            {loading ? 'Refreshing…' : 'Refresh'}
          </button>
        </div>
      </div>

      {visible.length === 0 && !loading && (
        <div className="card" style={{textAlign:'center',padding:'40px 0',color:'#6b7280'}}>
          <Lightbulb size={32} style={{margin:'0 auto 12px',opacity:0.25}}/>
          <p style={{margin:0,fontWeight:500}}>
            {items.length === 0 ? 'No suggestions — your blocklists look good!' : 'All suggestions dismissed.'}
          </p>
          {dismissed > 0 && !showDismissed && (
            <button onClick={() => setShowDismissed(true)}
              style={{marginTop:'10px',padding:'5px 14px',borderRadius:'6px',
                fontSize:'0.75rem',background:'#1f2937',border:'none',
                color:'#9ca3af',cursor:'pointer'}}>
              Show {dismissed} dismissed
            </button>
          )}
        </div>
      )}

      <div className="space-y-2">
        {visible.map((s, i) => {
          const key  = `${s.type}:${s.value}`;
          const done = !!blocked[key];
          const busy = !!blocking[key];
          return (
            <div key={i}
              style={{display:'flex',alignItems:'center',gap:'12px',
                padding:'12px 14px',borderRadius:'10px',
                opacity: s.dismissed ? 0.45 : 1,
                background: done ? 'rgba(20,83,45,0.15)'
                  : s.dismissed ? '#0f172a'
                  : 'rgba(120,53,15,0.15)',
                border: `1px solid ${done ? 'rgba(74,222,128,0.2)'
                  : s.dismissed ? '#1f2937'
                  : 'rgba(245,158,11,0.2)'}`,
              }}>
              {SUGGESTION_TYPE_ICON[s.type]}
              <div style={{flex:1,minWidth:0}}>
                <div style={{display:'flex',alignItems:'center',gap:'8px',flexWrap:'wrap'}}>
                  <span style={{fontSize:'0.7rem',background:'#1f2937',
                    padding:'1px 7px',borderRadius:'4px',color:'#9ca3af',flexShrink:0}}>
                    {SUGGESTION_TYPE_LABEL[s.type]}
                  </span>
                  <code style={{fontSize:'0.8rem',color:'#e5e7eb',
                    overflow:'hidden',textOverflow:'ellipsis',whiteSpace:'nowrap'}}>
                    {s.value}
                  </code>
                  {s.dismissed && (
                    <span style={{fontSize:'0.65rem',color:'#6b7280',flexShrink:0}}>
                      dismissed
                    </span>
                  )}
                </div>
                <p style={{fontSize:'0.7rem',color:'#6b7280',margin:'3px 0 0'}}>
                  {s.reason} · <strong style={{color:'#9ca3af'}}>{s.hits}</strong> hit{s.hits!==1?'s':''}
                </p>
              </div>
              {!s.dismissed && !done && (
                <button onClick={() => dismiss(s)}
                  style={{padding:'4px 10px',borderRadius:'6px',fontSize:'0.7rem',
                    cursor:'pointer',border:'none',background:'#1f2937',color:'#6b7280',
                    flexShrink:0}}>
                  Dismiss
                </button>
              )}
              <button onClick={() => block(s)} disabled={done || busy || s.dismissed}
                style={{flexShrink:0,padding:'5px 12px',borderRadius:'6px',
                  fontSize:'0.75rem',fontWeight:600,border:'none',
                  cursor:done||busy||s.dismissed?'default':'pointer',
                  background: done ? 'rgba(20,83,45,0.5)'
                    : busy ? '#1f2937'
                    : 'rgba(239,68,68,0.2)',
                  color: done ? '#4ade80' : busy ? '#6b7280' : '#f87171',
                  opacity: busy ? 0.6 : 1}}>
                {done ? '✓ Blocked' : busy ? '…' : 'Block'}
              </button>
            </div>
          );
        })}
      </div>

      {toast && (
        <div style={{position:'fixed',bottom:'24px',right:'24px',zIndex:50,
          background:toast.ok?'#052e16':'#450a0a',
          border:`1px solid ${toast.ok?'#166534':'#7f1d1d'}`,
          color:toast.ok?'#bbf7d0':'#fca5a5',
          padding:'10px 16px',borderRadius:'10px',fontSize:'0.875rem',
          boxShadow:'0 10px 25px rgba(0,0,0,0.5)'}}>
          {toast.ok?'✓':'✗'} {toast.msg}
        </div>
      )}
    </div>
  );
}

// ── Blocklists Tab ────────────────────────────────────────────────────────────
const BL_TYPES = ['ip','cidr','domain','sender_email','from_email','helo_domain','tld','regex_subject','regex_body','uri'];
const ACTIONS  = ['block','flag','quarantine','allow'];

const IPV4_RE   = /^(\d{1,3}\.){3}\d{1,3}$/;
const IPV6_RE   = /^[0-9a-fA-F:]+$/;
const CIDR_RE   = /^(\d{1,3}\.){3}\d{1,3}\/\d{1,2}$/;
const EMAIL_RE  = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const DOMAIN_RE = /^(\*\.)?[a-zA-Z0-9-]+(\.[a-zA-Z0-9-]+)*$/;
const TLD_RE    = /^[a-zA-Z]{2,24}$/;

function validateValue(type, value) {
  const v = value.trim();
  if (!v) return 'Value is required';
  switch (type) {
    case 'ip':
      if (!IPV4_RE.test(v) && !IPV6_RE.test(v)) return 'Invalid IP address';
      break;
    case 'cidr':
      if (!CIDR_RE.test(v)) return 'Invalid CIDR (e.g. 192.168.1.0/24)';
      break;
    case 'sender_email':
      if (!EMAIL_RE.test(v)) return 'Invalid email address';
      break;
    case 'from_email':
      try { new RegExp(v); } catch { return 'Invalid regular expression'; }
      break;
    case 'domain':
    case 'helo_domain':
      if (!DOMAIN_RE.test(v)) return 'Invalid domain (e.g. example.com or *.example.com)';
      break;
    case 'tld':
      if (!TLD_RE.test(v)) return 'TLD must be letters only, no dots (e.g. "ru", "xyz")';
      if (v.toLowerCase() === 'com' || v.toLowerCase() === 'net' || v.toLowerCase() === 'org')
        return `Blocking .${v.toLowerCase()} would affect nearly all legitimate mail — are you sure? Remove this check to proceed.`;
      break;
    case 'regex_subject':
    case 'regex_body':
      try { new RegExp(v); } catch { return 'Invalid regular expression'; }
      break;
  }
  return null;
}

const ACTION_BG = {
  block:      'bg-red-900 text-red-300',
  flag:       'bg-yellow-900 text-yellow-300',
  quarantine: 'bg-purple-900 text-purple-300',
  allow:      'bg-green-900 text-green-300',
};

const PLACEHOLDER = {
  ip:            '203.0.113.1',
  cidr:          '203.0.113.0/24',
  domain:        'example.com or *.example.com',
  sender_email:  'user@example.com',
  from_email:    'user@example\\.com or \\.mx$',
  helo_domain:   'smtp.example.com',
  tld:           'ru',
  regex_subject: 'Win (free|big|now)',
  regex_body:    'click here.{0,30}unsubscribe',
  uri:           'http://malicious.example.com/path',
};

function BlocklistsTab({ highlightId }) {
  const EMPTY_FORM = { list_type: 'ip', value: '', action: 'block', comment: '' };

  const [items,   setItems]   = useState([]);
  const [loading, setLoading] = useState(false);
  const [filter,  setFilter]  = useState('');
  const [search,  setSearch]  = useState('');
  const [sort,    setSort]    = useState({ col: 'created_at', dir: 'desc' });

  const toggleSort = col => setSort(s =>
    s.col === col ? { col, dir: s.dir === 'asc' ? 'desc' : 'asc' } : { col, dir: 'asc' }
  );

  const sortIcon = col => {
    if (sort.col !== col) return <span style={{color:'#374151',marginLeft:'4px'}}>⇅</span>;
    return <span style={{color:'#a5b4fc',marginLeft:'4px'}}>{sort.dir === 'asc' ? '↑' : '↓'}</span>;
  };

  const [form,    setForm]    = useState(EMPTY_FORM);
  const [formErr, setFormErr] = useState('');
  const [adding,  setAdding]  = useState(false);

  const [editing,  setEditing]  = useState(null);
  const [editForm, setEditForm] = useState({});
  const [editErr,  setEditErr]  = useState('');
  const [saving,   setSaving]   = useState(false);

  const [toast, setToast] = useState(null);
  const notify = (msg, ok = true) => {
    setToast({ msg, ok });
    setTimeout(() => setToast(null), 3000);
  };

  const load = () => {
    setLoading(true);
    api.get('/blocklists')
      .then(r => setItems(r.data))
      .catch(() => notify('Failed to load blocklists', false))
      .finally(() => setLoading(false));
  };
  useEffect(() => { load(); }, []);
  const hl = useHighlight(highlightId, !loading && items.length > 0);

  const handleAdd = async () => {
    setFormErr('');
    const err = validateValue(form.list_type, form.value);
    if (err) { setFormErr(err); return; }
    setAdding(true);
    try {
      await api.post('/blocklists', {
        list_type: form.list_type,
        value:     form.value.trim().toLowerCase(),
        action:    form.action,
        comment:   form.comment.trim(),
        enabled:   true,
      });
      setForm(EMPTY_FORM);
      notify('Entry added');
      load();
    } catch (e) {
      const msg = e.response?.data?.error || e.message;
      setFormErr(e.response?.status === 409 ? `Duplicate: ${msg}` : msg);
    }
    setAdding(false);
  };

  const startEdit = item => {
    setEditing(item.id);
    setEditForm({ value: item.value, action: item.action, comment: item.comment || '' });
    setEditErr('');
  };
  const cancelEdit = () => { setEditing(null); setEditForm({}); setEditErr(''); };

  const saveEdit = async item => {
    setEditErr('');
    const err = validateValue(item.list_type, editForm.value);
    if (err) { setEditErr(err); return; }
    setSaving(true);
    try {
      await api.put(`/blocklists/${item.id}`, {
        value:   item.list_type === 'tld'
                   ? editForm.value.trim().toLowerCase()
                   : editForm.value.trim(),
        action:  editForm.action,
        comment: editForm.comment.trim(),
      });
      setEditing(null);
      notify('Entry updated');
      load();
    } catch (e) {
      const msg = e.response?.data?.error || e.message;
      setEditErr(e.response?.status === 409 ? `Duplicate: ${msg}` : msg);
    }
    setSaving(false);
  };

  const toggle = async item => {
    try {
      await api.put(`/blocklists/${item.id}`, {
        value:   item.value,
        action:  item.action,
        comment: item.comment || '',
        enabled: !item.enabled,
      });
      setItems(prev => prev.map(i => i.id === item.id ? { ...i, enabled: !i.enabled } : i));
    } catch { notify('Toggle failed', false); }
  };

  const del = async id => {
    if (!confirm('Delete this entry?')) return;
    try {
      await api.delete(`/blocklists/${id}`);
      setItems(prev => prev.filter(i => i.id !== id));
      notify('Entry deleted');
    } catch { notify('Delete failed', false); }
  };

  const visible = items.filter(i => {
    if (filter && i.list_type !== filter) return false;
    if (search) {
      const q = search.toLowerCase();
      return i.value?.toLowerCase().includes(q) || i.comment?.toLowerCase().includes(q);
    }
    return true;
  }).sort((a, b) => {
    const { col, dir } = sort;
    let av = a[col], bv = b[col];
    if (col === 'hits') { av = av ?? 0; bv = bv ?? 0; }
    if (col === 'last_hit' || col === 'created_at') {
      av = av ? new Date(av).getTime() : 0;
      bv = bv ? new Date(bv).getTime() : 0;
    }
    if (col === 'enabled') { av = av ? 1 : 0; bv = bv ? 1 : 0; }
    if (av == null) av = '';
    if (bv == null) bv = '';
    const cmp = typeof av === 'number'
      ? av - bv
      : String(av).localeCompare(String(bv));
    return dir === 'asc' ? cmp : -cmp;
  });

  return (
    <div className="space-y-5">
      {/* Add form */}
      <div className="card space-y-3">
        <h3 style={{fontSize:'0.875rem',fontWeight:600,color:'#d1d5db',margin:0}}>Add Entry</h3>
        <div style={{display:'grid',gridTemplateColumns:'140px 1fr 130px',gap:'10px'}}>
          <select className="input" value={form.list_type}
            onChange={e => { setForm({...form, list_type:e.target.value, value:''}); setFormErr(''); }}>
            {BL_TYPES.map(t => <option key={t} value={t}>{t}</option>)}
          </select>
          <input className="input"
            placeholder={PLACEHOLDER[form.list_type] || 'Value'}
            value={form.value}
            onChange={e => { setForm({...form, value:e.target.value}); setFormErr(''); }}
            onKeyDown={e => e.key === 'Enter' && handleAdd()}/>
          <select className="input" value={form.action}
            onChange={e => setForm({...form, action:e.target.value})}>
            {ACTIONS.map(a => <option key={a} value={a}>{a}</option>)}
          </select>
        </div>
        {/* TLD helper hint */}
        {form.list_type === 'tld' && (
          <p style={{fontSize:'0.7rem',color:'#6b7280',margin:0}}>
            Enter the TLD without a dot — e.g. <code style={{background:'#1f2937',padding:'1px 5px',borderRadius:'3px'}}>ru</code>, <code style={{background:'#1f2937',padding:'1px 5px',borderRadius:'3px'}}>cn</code>, <code style={{background:'#1f2937',padding:'1px 5px',borderRadius:'3px'}}>xyz</code>.
            Blocks based on sender domain TLD and PTR record TLD.
          </p>
        )}
        <div style={{display:'flex',gap:'10px'}}>
          <input className="input" style={{flex:1}}
            placeholder="Comment / reason (optional)"
            value={form.comment}
            onChange={e => setForm({...form, comment:e.target.value})}
            onKeyDown={e => e.key === 'Enter' && handleAdd()}/>
          <button className="btn-primary" onClick={handleAdd} disabled={adding}
            style={{minWidth:'80px',opacity:adding?0.6:1}}>
            {adding ? 'Adding…' : 'Add'}
          </button>
        </div>
        {formErr && <p style={{fontSize:'0.75rem',color:'#f87171',margin:0}}>⚠ {formErr}</p>}
      </div>

      {/* Filter / search */}
      <div style={{display:'flex',gap:'10px',flexWrap:'wrap',alignItems:'center'}}>
        <div style={{display:'flex',gap:'5px',flexWrap:'wrap'}}>
          {['', ...BL_TYPES].map(t => (
            <button key={t} onClick={() => setFilter(t)}
              style={{padding:'4px 12px',borderRadius:'6px',fontSize:'0.75rem',
                cursor:'pointer',border:'none',
                background:filter===t?'#4f46e5':'#1f2937',
                color:filter===t?'white':'#9ca3af'}}>
              {t || 'All'}
            </button>
          ))}
        </div>
        <input className="input" style={{width:'220px',marginLeft:'auto'}}
          placeholder="Search value / comment…"
          value={search}
          onChange={e => setSearch(e.target.value)}/>
        <span style={{fontSize:'0.75rem',color:'#6b7280',flexShrink:0}}>
          {visible.length} / {items.length}
        </span>
      </div>

      {/* Table */}
      <div className="overflow-x-auto rounded-xl border border-gray-800">
        <table className="w-full text-sm">
          <thead className="bg-gray-900 text-gray-400 text-xs uppercase">
            <tr>
              {[
                ['list_type','Type'],['value','Value'],['action','Action'],
                ['hits','Hits'],['last_hit','Last Hit'],['comment','Comment'],
                ['enabled','Status'],['',''],
              ].map(([col, label]) => (
                <th key={col}
                  className="px-3 py-3 text-left font-medium whitespace-nowrap"
                  style={{cursor: col ? 'pointer' : 'default', userSelect:'none'}}
                  onClick={() => col && toggleSort(col)}>
                  {label}{col && sortIcon(col)}
                </th>
              ))}
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-800">
            {loading && (
              <tr><td colSpan={8} className="px-3 py-6 text-center text-gray-500">Loading…</td></tr>
            )}
            {!loading && visible.length === 0 && (
              <tr><td colSpan={8} className="px-3 py-6 text-center text-gray-500">
                {items.length === 0 ? 'No entries yet.' : 'No entries match the current filter.'}
              </td></tr>
            )}
            {visible.map(i => editing === i.id ? (
              <tr key={i.id} id={`hl-${i.id}`} style={{background:'#1a1f2e'}}>
                <td className="px-3 py-2">
                  <span style={{fontSize:'0.7rem',background:'#374151',
                    padding:'2px 8px',borderRadius:'4px',color:'#9ca3af'}}>
                    {i.list_type}
                  </span>
                </td>
                <td className="px-3 py-2" style={{minWidth:'220px'}}>
                  <input className="input"
                    style={{fontSize:'0.75rem',padding:'4px 8px',fontFamily:'monospace'}}
                    value={editForm.value}
                    placeholder={PLACEHOLDER[i.list_type]}
                    onChange={e => { setEditForm({...editForm, value:e.target.value}); setEditErr(''); }}
                    onKeyDown={e => { if(e.key==='Enter') saveEdit(i); if(e.key==='Escape') cancelEdit(); }}
                    autoFocus/>
                  {editErr && (
                    <p style={{fontSize:'0.7rem',color:'#f87171',margin:'3px 0 0'}}>⚠ {editErr}</p>
                  )}
                </td>
                <td className="px-3 py-2">
                  <select className="input"
                    style={{fontSize:'0.75rem',padding:'4px 8px',width:'120px'}}
                    value={editForm.action}
                    onChange={e => setEditForm({...editForm, action:e.target.value})}>
                    {ACTIONS.map(a => <option key={a} value={a}>{a}</option>)}
                  </select>
                </td>
                <td className="px-3 py-2 text-gray-500 text-xs">{i.hits ?? 0}</td>
                <td className="px-3 py-2 text-gray-500 text-xs whitespace-nowrap">
                  {i.last_hit ? new Date(i.last_hit).toLocaleDateString() : '—'}
                </td>
                <td className="px-3 py-2" style={{minWidth:'180px'}}>
                  <input className="input"
                    style={{fontSize:'0.75rem',padding:'4px 8px'}}
                    placeholder="Comment (optional)"
                    value={editForm.comment}
                    onChange={e => setEditForm({...editForm, comment:e.target.value})}
                    onKeyDown={e => { if(e.key==='Enter') saveEdit(i); if(e.key==='Escape') cancelEdit(); }}/>
                </td>
                <td className="px-3 py-2">
                  <span style={{fontSize:'0.7rem',color:i.enabled?'#4ade80':'#6b7280'}}>
                    {i.enabled ? 'Enabled' : 'Disabled'}
                  </span>
                </td>
                <td className="px-3 py-2 whitespace-nowrap">
                  <div style={{display:'flex',gap:'6px'}}>
                    <button className="btn-primary text-xs py-1 px-3"
                      onClick={() => saveEdit(i)} disabled={saving}>
                      {saving ? '…' : 'Save'}
                    </button>
                    <button className="btn-ghost text-xs py-1 px-3" onClick={cancelEdit}>
                      Cancel
                    </button>
                  </div>
                </td>
              </tr>
            ) : (
              <tr key={i.id} id={`hl-${i.id}`}
                style={{opacity:i.enabled?1:0.45,transition:'opacity 0.15s'}}
                className={`hover:bg-gray-900${hl === String(i.id) ? ' mg-rule-flash' : ''}`}>
                <td className="px-3 py-2">
                  <span style={{fontSize:'0.7rem',background:'#1f2937',
                    padding:'2px 8px',borderRadius:'4px',color:'#9ca3af',whiteSpace:'nowrap'}}>
                    {i.list_type}
                  </span>
                </td>
                <td className="px-3 py-2 font-mono text-xs text-gray-200"
                  style={{maxWidth:'240px',overflow:'hidden',textOverflow:'ellipsis',whiteSpace:'nowrap'}}
                  title={i.value}>
                  {i.list_type === 'tld' ? `.${i.value}` : i.value}
                </td>
                <td className="px-3 py-2">
                  <span className={`inline-flex px-2 py-0.5 text-xs rounded-full ${ACTION_BG[i.action] || 'bg-gray-800 text-gray-300'}`}>
                    {i.action}
                  </span>
                </td>
                <td className="px-3 py-2 text-xs">
                  {i.hits > 0
                    ? <span style={{color:'#f97316',fontWeight:600}}>{i.hits.toLocaleString()}</span>
                    : <span className="text-gray-600">0</span>}
                </td>
                <td className="px-3 py-2 text-gray-500 text-xs whitespace-nowrap">
                  {i.last_hit ? new Date(i.last_hit).toLocaleDateString() : '—'}
                </td>
                <td className="px-3 py-2 text-gray-500 text-xs"
                  style={{maxWidth:'200px',overflow:'hidden',textOverflow:'ellipsis',whiteSpace:'nowrap'}}
                  title={i.comment || ''}>
                  {i.comment || ''}
                </td>
                <td className="px-3 py-2">
                  <span style={{fontSize:'0.7rem',color:i.enabled?'#4ade80':'#6b7280'}}>
                    {i.enabled ? '● Active' : '○ Disabled'}
                  </span>
                </td>
                <td className="px-3 py-2 whitespace-nowrap">
                  <div style={{display:'flex',gap:'5px'}}>
                    <button className="btn-ghost text-xs py-1 px-2" onClick={() => startEdit(i)}>Edit</button>
                    <button className="btn-ghost text-xs py-1 px-2" onClick={() => toggle(i)}>
                      {i.enabled ? 'Disable' : 'Enable'}
                    </button>
                    <button className="btn-danger text-xs py-1 px-2" onClick={() => del(i.id)}>Del</button>
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {toast && (
        <div style={{position:'fixed',bottom:'24px',right:'24px',zIndex:50,
          background:toast.ok?'#052e16':'#450a0a',
          border:`1px solid ${toast.ok?'#166534':'#7f1d1d'}`,
          color:toast.ok?'#bbf7d0':'#fca5a5',
          padding:'10px 16px',borderRadius:'10px',fontSize:'0.875rem',
          boxShadow:'0 10px 25px rgba(0,0,0,0.5)'}}>
          {toast.ok ? '✓' : '✗'} {toast.msg}
        </div>
      )}
    </div>
  );
}

// ── Spam & Virus Tab ──────────────────────────────────────────────────────────
function SpamTab() {
  const [cfg, setCfg] = useState({});
  useEffect(() => {
    api.get('/settings').then(r => {
      const m = {};
      r.data.forEach(s => { m[`${s.category}.${s.key_name}`] = s.value; });
      setCfg(m);
    });
  }, []);

  const set = (k, v) => setCfg(c => ({...c, [k]: v}));
  const boolVal = k => cfg[k] === 'true';
  const saveKey = async (k, v) => {
    const [cat, ...rest] = k.split('.');
    await api.post('/settings/upsert', { category:cat, key_name:rest.join('.'), value:String(v) }).catch(()=>{});
  };
  const toggleBool = async k => {
    const nv = !boolVal(k);
    set(k, String(nv));
    await saveKey(k, nv);
  };

  return (
    <div className="card" style={{maxWidth:'560px'}}>
      <Toggle label="Enable ClamAV" desc="Scan all messages for viruses"
        val={boolVal('virus.clamav_enabled')} onChange={() => toggleBool('virus.clamav_enabled')}/>
      <Toggle label="Block on Virus" desc="Reject message when virus is found"
        val={boolVal('virus.block_on_virus')} onChange={() => toggleBool('virus.block_on_virus')}/>
      <Toggle label="Block Encrypted Archives"
        val={boolVal('virus.block_encrypted_archives')} onChange={() => toggleBool('virus.block_encrypted_archives')}/>
      <Toggle label="SpamAssassin Header Rewrite" desc="Rewrite subject with [SPAM] tag"
        val={boolVal('spam.sa_rewrite_header')} onChange={() => toggleBool('spam.sa_rewrite_header')}/>
      <ScoreRow label="Spam Flag Score" desc="Flag messages above this score"
        value={cfg['spam.score_threshold_flag']||'5.0'}
        onChange={v => { set('spam.score_threshold_flag', v); saveKey('spam.score_threshold_flag', v); }}/>
      <ScoreRow label="Spam Block Score" desc="Block messages above this score"
        value={cfg['spam.score_threshold_block']||'10.0'}
        onChange={v => { set('spam.score_threshold_block', v); saveKey('spam.score_threshold_block', v); }}/>
      <Toggle label="Greylisting" desc="Temporarily reject first-time senders"
        val={boolVal('smtp.greylist_enabled')} onChange={() => toggleBool('smtp.greylist_enabled')}/>
    </div>
  );
}

// ── Spam Filtering Tab ────────────────────────────────────────────────────────
function SpamFilteringTab() {
  const [cfg,   setCfg]   = useState({});
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    Promise.all([
      api.get('/settings?category=spam'),
      api.get('/settings?category=header_rules'),
    ]).then(([s, h]) => {
      const m = {};
      [...s.data, ...h.data].forEach(r => { m[`${r.category}.${r.key_name}`] = r.value; });
      setCfg(m);
    }).catch(() => {});
  }, []);

  const get  = k => cfg[k] ?? '';
  const bool = k => cfg[k] === 'true';

  const save = async (category, key, value) => {
    setCfg(c => ({...c, [`${category}.${key}`]: String(value)}));
    await api.post('/settings/upsert', { category, key_name:key, value:String(value) }).catch(() => {});
    setSaved(true);
    setTimeout(() => setSaved(false), 2000);
  };

  const toggleBool = (category, key) => save(category, key, !bool(`${category}.${key}`));

  return (
    <div className="space-y-5" style={{maxWidth:'640px'}}>
      <div className="card">
        <h3 style={{fontSize:'0.875rem',fontWeight:600,color:'#d1d5db',marginBottom:'4px'}}>Virus Detection</h3>
        <p style={{fontSize:'0.75rem',color:'#6b7280',marginBottom:'14px'}}>Action when ClamAV detects a virus via Amavis.</p>
        <div style={{padding:'10px 0',borderBottom:'1px solid #1f2937'}}>
          <p style={{fontSize:'0.875rem',fontWeight:500,color:'#e5e7eb',margin:'0 0 8px'}}>On virus detected</p>
          <ActionSelect value={get('spam.virus_action')||'quarantine'} onChange={v => save('spam','virus_action',v)}/>
        </div>
        <Toggle label="Block Encrypted Archives" desc="Treat password-protected archives as suspicious"
          val={bool('spam.block_encrypted_archives')} onChange={() => toggleBool('spam','block_encrypted_archives')}/>
        <div style={{padding:'10px 0'}}>
          <p style={{fontSize:'0.875rem',fontWeight:500,color:'#e5e7eb',margin:'0 0 8px'}}>On banned file attachment</p>
          <ActionSelect value={get('spam.banned_files_action')||'block'} onChange={v => save('spam','banned_files_action',v)}/>
        </div>
      </div>

      <div className="card">
        <h3 style={{fontSize:'0.875rem',fontWeight:600,color:'#d1d5db',marginBottom:'4px'}}>Spam Detection</h3>
        <p style={{fontSize:'0.75rem',color:'#6b7280',marginBottom:'14px'}}>Score thresholds and actions for SpamAssassin.</p>
        <ScoreRow label="Tag Score" desc="Add X-Spam headers above this score"
          value={get('spam.sa_tag_score')||'2.0'} onChange={v => save('spam','sa_tag_score',v)}/>
        <ScoreRow label="Flag Score" desc="Flag message above this score"
          value={get('spam.score_threshold_flag')||'5.0'} onChange={v => save('spam','score_threshold_flag',v)}/>
        <ScoreRow label="Kill Score" desc="Apply kill action above this score"
          value={get('spam.score_threshold_block')||'10.0'} onChange={v => save('spam','score_threshold_block',v)}/>
        <div style={{padding:'10px 0',borderTop:'1px solid #1f2937',marginTop:'4px'}}>
          <p style={{fontSize:'0.875rem',fontWeight:500,color:'#e5e7eb',margin:'0 0 8px'}}>On spam above kill score</p>
          <ActionSelect value={get('spam.spam_action')||'flag'} onChange={v => save('spam','spam_action',v)}/>
        </div>
        <Toggle label="Rewrite Subject" desc="Add [SPAM] tag to subject line when flagged"
          val={bool('spam.sa_rewrite_header')} onChange={() => toggleBool('spam','sa_rewrite_header')}/>
      </div>

      <div className="card">
        <h3 style={{fontSize:'0.875rem',fontWeight:600,color:'#d1d5db',marginBottom:'4px'}}>Header Analysis Rules</h3>
        <p style={{fontSize:'0.75rem',color:'#6b7280',marginBottom:'14px'}}>
          Heuristic checks on email headers. Changes take effect on next Amavis restart.
        </p>
        <Toggle label="Mismatched Reply-To Domain" desc="Flag when Reply-To domain differs from From domain (+2.5)"
          val={bool('header_rules.check_reply_to_mismatch')} onChange={() => toggleBool('header_rules','check_reply_to_mismatch')}/>
        <Toggle label="Display Name Spoofing" desc="Flag when display name contains your domain but sender is external (+4.0)"
          val={bool('header_rules.check_display_name_spoof')} onChange={() => toggleBool('header_rules','check_display_name_spoof')}/>
        <Toggle label="Suspicious X-Mailer" desc="Flag messages from known spam-associated mail clients (+1.5)"
          val={bool('header_rules.check_suspicious_mailer')} onChange={() => toggleBool('header_rules','check_suspicious_mailer')}/>
        <Toggle label="Missing Message-ID" desc="Flag messages with no Message-ID header (+1.5)"
          val={bool('header_rules.check_missing_mid')} onChange={() => toggleBool('header_rules','check_missing_mid')}/>
        <Toggle label="Lookalike Domains" desc="Flag From addresses using lookalike brand names (paypa1.com, g00gle.com) (+4.0)"
          val={bool('header_rules.check_lookalike_domains')} onChange={() => toggleBool('header_rules','check_lookalike_domains')}/>
      </div>

      {saved && (
        <div style={{position:'fixed',bottom:'24px',right:'24px',zIndex:50,
          background:'#052e16',border:'1px solid #166534',color:'#bbf7d0',
          padding:'8px 16px',borderRadius:'8px',fontSize:'0.75rem'}}>
          ✓ Settings saved
        </div>
      )}
    </div>
  );
}

// ── Auth Tab ──────────────────────────────────────────────────────────────────
function AuthTab() {
  const [cfg, setCfg] = useState([]);
  useEffect(() => { api.get('/auth_settings').then(r => setCfg(r.data)).catch(() => {}); }, []);

  const boolVal = k => cfg.find(c => c.setting_key === k)?.value === 'true';
  const toggleBool = async k => {
    const nv = !boolVal(k);
    setCfg(prev => prev.map(c => c.setting_key===k ? {...c, value:String(nv)} : c));
    await api.put(`/auth_settings/${k}`, { value:String(nv) }).catch(() => {});
  };

  const AUTH_TOGGLES = [
    ['spf_enabled',         'SPF Checking',        'Validate Sender Policy Framework'],
    ['spf_reject_fail',     'Reject SPF Fail',     'Hard reject on SPF fail'],
    ['spf_reject_softfail', 'Reject SPF SoftFail', 'Reject on softfail (stricter)'],
    ['dkim_enabled',        'DKIM Verification',   'Verify DomainKeys signatures'],
    ['dkim_reject_fail',    'Reject DKIM Fail',    'Hard reject on DKIM failure'],
    ['dmarc_enabled',       'DMARC Policy',        'Enforce DMARC alignment'],
    ['dmarc_reject_fail',   'Reject DMARC Fail',   'Hard reject on DMARC failure'],
    ['rdns_check',          'Reverse DNS Check',   'Verify sender IP has valid PTR record'],
    ['rdns_reject',         'Reject rDNS Fail',    'Reject if no valid PTR record'],
    ['helo_check',          'HELO/EHLO Validation','Validate SMTP HELO hostname'],
    ['helo_reject',         'Reject HELO Fail',    'Reject invalid HELO/EHLO'],
  ];

  return (
    <div className="card" style={{maxWidth:'560px'}}>
      {AUTH_TOGGLES.map(([k, l, d]) => (
        <Toggle key={k} label={l} desc={d} val={boolVal(k)} onChange={() => toggleBool(k)}/>
      ))}
    </div>
  );
}

// ── SURBL Tab ─────────────────────────────────────────────────────────────────
function SurblTab() {
  const [lists, setLists] = useState([]);
  useEffect(() => { api.get('/surbl').then(r => setLists(r.data)); }, []);

  const toggle = async item => {
    await api.put(`/surbl/${item.id}`, {...item, enabled:!item.enabled}).catch(() => {});
    setLists(prev => prev.map(l => l.id===item.id ? {...l, enabled:!l.enabled} : l));
  };

  return (
    <div className="card" style={{maxWidth:'560px'}}>
      <h3 style={{fontSize:'0.875rem',fontWeight:600,color:'#d1d5db',marginBottom:'16px'}}>Realtime URI Blocklists</h3>
      {lists.map(l => (
        <div key={l.id} style={{display:'flex',alignItems:'center',justifyContent:'space-between',
          padding:'10px 0',borderBottom:'1px solid #1f2937'}}>
          <div>
            <p style={{fontSize:'0.875rem',fontWeight:500,color:'#e5e7eb',margin:0}}>{l.name}</p>
            <p style={{fontSize:'0.7rem',color:'#6b7280',fontFamily:'monospace',margin:'2px 0 0'}}>{l.zone}</p>
          </div>
          <div style={{display:'flex',alignItems:'center',gap:'12px'}}>
            <span style={{fontSize:'0.75rem',color:'#6b7280'}}>weight {l.weight}</span>
            <Toggle label="" val={l.enabled} onChange={() => toggle(l)}/>
          </div>
        </div>
      ))}
    </div>
  );
}

// ── Test Mode Tab ─────────────────────────────────────────────────────────────
function TestModeTab() {
  const [cfg,   setCfg]   = useState({});
  const [rules, setRules] = useState([]);
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    api.get('/settings?category=general').then(r => {
      const m = {};
      r.data.forEach(s => { m[s.key_name] = s.value; });
      setCfg(m);
    });
    api.get('/rules').then(r => setRules(r.data)).catch(() => {});
  }, []);

  const boolVal = k => cfg[k] === 'true';
  const saveKey = async (k, v) => {
    await api.post('/settings/upsert', { category:'general', key_name:k, value:String(v) }).catch(() => {});
    setCfg(c => ({...c, [k]: String(v)}));
    setSaved(true); setTimeout(() => setSaved(false), 2000);
  };

  const toggleRuleTest = async rule => {
    const cond    = typeof rule.conditions==='string' ? JSON.parse(rule.conditions) : rule.conditions;
    const newCond = {...cond, test_mode: !cond.test_mode};
    await api.put(`/rules/${rule.id}`, {...rule, conditions:JSON.stringify(newCond)}).catch(() => {});
    setRules(prev => prev.map(r => r.id===rule.id ? {...r, conditions:JSON.stringify(newCond)} : r));
  };

  const getRuleTestMode = rule => {
    try {
      const c = typeof rule.conditions==='string' ? JSON.parse(rule.conditions) : rule.conditions;
      return !!c.test_mode;
    } catch { return false; }
  };

  return (
    <div className="space-y-5" style={{maxWidth:'640px'}}>
      <div className="card">
        <h3 style={{fontSize:'0.875rem',fontWeight:600,color:'#d1d5db',marginBottom:'4px'}}>Global Test Mode</h3>
        <p style={{fontSize:'0.75rem',color:'#6b7280',marginBottom:'16px'}}>
          When enabled, MailGuard logs what would happen without actually blocking or flagging messages.
        </p>
        <Toggle label="Enable Global Test Mode"
          desc="All block/flag/quarantine actions become allow — events still logged with intended action"
          val={boolVal('test_mode_enabled')}
          onChange={() => saveKey('test_mode_enabled', !boolVal('test_mode_enabled'))}/>
        <Toggle label="Add Test Mode Header"
          desc="Adds X-MailGuard-TestMode: true header to messages processed in test mode"
          val={boolVal('test_mode_notify')}
          onChange={() => saveKey('test_mode_notify', !boolVal('test_mode_notify'))}/>
        {saved && <p style={{fontSize:'0.75rem',color:'#4ade80',marginTop:'8px'}}>✓ Saved</p>}
        {boolVal('test_mode_enabled') && (
          <div style={{marginTop:'12px',padding:'10px 14px',borderRadius:'8px',
            background:'rgba(245,158,11,0.1)',border:'1px solid rgba(245,158,11,0.3)'}}>
            <p style={{fontSize:'0.75rem',color:'#fbbf24',margin:0}}>
              ⚠ Global test mode is active — no messages are being blocked or filtered.
            </p>
          </div>
        )}
      </div>

      <div className="card">
        <h3 style={{fontSize:'0.875rem',fontWeight:600,color:'#d1d5db',marginBottom:'4px'}}>Per-Rule Test Mode</h3>
        <p style={{fontSize:'0.75rem',color:'#6b7280',marginBottom:'16px'}}>
          Enable test mode on individual rules without affecting other active rules.
        </p>
        {rules.length === 0
          ? <p style={{color:'#6b7280',fontSize:'0.875rem'}}>No rules configured yet.</p>
          : rules.map(r => (
            <div key={r.id} style={{display:'flex',alignItems:'center',justifyContent:'space-between',
              padding:'10px 0',borderBottom:'1px solid #1f2937'}}>
              <div style={{minWidth:0,flex:1}}>
                <p style={{fontSize:'0.875rem',fontWeight:500,color:'#e5e7eb',margin:0}}>{r.name}</p>
                <p style={{fontSize:'0.7rem',color:'#6b7280',margin:'2px 0 0'}}>
                  Action: <span className={`badge-${r.action}`}>{r.action}</span>
                  {' '}Priority: {r.priority}
                </p>
              </div>
              <Toggle label="" val={getRuleTestMode(r)} onChange={() => toggleRuleTest(r)}/>
            </div>
          ))
        }
      </div>
    </div>
  );
}

// ── Rule Tester Tab ───────────────────────────────────────────────────────────
function RuleTesterTab() {
  const [mode,    setMode]    = useState('headers');
  const [raw,     setRaw]     = useState('');
  const [result,  setResult]  = useState(null);
  const [loading, setLoading] = useState(false);

  const test = async () => {
    if (!raw.trim()) return;
    setLoading(true);
    try {
      const r = await api.post('/config/test', { raw, mode });
      setResult(r.data);
    } catch(e) {
      setResult({ error: e.response?.data?.error || e.message });
    }
    setLoading(false);
  };

  const ACTION_COLOR = { block:'#f87171', flag:'#fbbf24', quarantine:'#c084fc', allow:'#4ade80' };

  return (
    <div className="space-y-5" style={{maxWidth:'700px'}}>
      <div className="card">
        <h3 style={{fontSize:'0.875rem',fontWeight:600,color:'#d1d5db',marginBottom:'4px'}}>Rule Tester</h3>
        <p style={{fontSize:'0.75rem',color:'#6b7280',marginBottom:'16px'}}>
          Paste email headers or a full raw message to see which rules and blocklists would match.
        </p>
        <div style={{display:'flex',gap:'6px',marginBottom:'12px'}}>
          {[['headers','Headers only'],['full','Full message (headers + body)']].map(([v,l]) => (
            <button key={v} onClick={() => setMode(v)}
              style={{padding:'6px 14px',borderRadius:'6px',fontSize:'0.75rem',cursor:'pointer',border:'none',
                background:mode===v?'#4f46e5':'#1f2937', color:mode===v?'white':'#9ca3af'}}>
              {l}
            </button>
          ))}
        </div>
        <textarea
          style={{width:'100%',minHeight:'180px',background:'#0f172a',border:'1px solid #374151',
            borderRadius:'8px',padding:'12px',fontSize:'0.75rem',fontFamily:'monospace',
            color:'#e5e7eb',resize:'vertical',boxSizing:'border-box'}}
          placeholder={mode==='headers'
            ? 'From: sender@example.com\nTo: user@yourdomain.com\nSubject: Test\nReceived: from mail.example.com [1.2.3.4]'
            : 'Paste full raw email here (headers + blank line + body)'}
          value={raw} onChange={e => setRaw(e.target.value)}/>
        <div style={{display:'flex',gap:'10px',marginTop:'10px',alignItems:'center'}}>
          <button className="btn-primary" onClick={test} disabled={loading || !raw.trim()}>
            {loading ? 'Testing…' : 'Run Test'}
          </button>
          {result && (
            <button onClick={() => setResult(null)}
              style={{padding:'6px 12px',borderRadius:'6px',fontSize:'0.75rem',
                background:'transparent',border:'1px solid #374151',color:'#6b7280',cursor:'pointer'}}>
              Clear
            </button>
          )}
        </div>
      </div>

      {result && !result.error && (
        <div className="card space-y-4">
          <div style={{display:'flex',alignItems:'center',gap:'12px'}}>
            <h3 style={{fontSize:'0.875rem',fontWeight:600,color:'#d1d5db',margin:0}}>Result</h3>
            <span style={{padding:'4px 14px',borderRadius:'20px',fontSize:'0.875rem',fontWeight:700,
              background:`${ACTION_COLOR[result.action]}22`,
              color:ACTION_COLOR[result.action]||'#e5e7eb',
              border:`1px solid ${ACTION_COLOR[result.action]}44`}}>
              {result.action?.toUpperCase()}
            </span>
          </div>
          <div>
            <p style={{fontSize:'0.7rem',color:'#6b7280',textTransform:'uppercase',letterSpacing:'0.05em',marginBottom:'6px'}}>Extracted</p>
            <div style={{display:'grid',gridTemplateColumns:'1fr 1fr',gap:'6px'}}>
              {Object.entries(result.extracted||{}).map(([k,v]) => v ? (
                <div key={k} style={{background:'#0f172a',borderRadius:'6px',padding:'6px 10px'}}>
                  <p style={{fontSize:'0.65rem',color:'#6b7280',margin:'0 0 2px',textTransform:'uppercase'}}>{k}</p>
                  <p style={{fontSize:'0.8rem',color:'#e5e7eb',margin:0,overflow:'hidden',textOverflow:'ellipsis',whiteSpace:'nowrap'}}>{v}</p>
                </div>
              ) : null)}
            </div>
          </div>
          {result.matches?.length > 0 ? (
            <div>
              <p style={{fontSize:'0.7rem',color:'#6b7280',textTransform:'uppercase',letterSpacing:'0.05em',marginBottom:'6px'}}>
                Matches ({result.matches.length})
              </p>
              <div className="space-y-2">
                {result.matches.map((m, i) => (
                  <div key={i} style={{display:'flex',alignItems:'center',gap:'10px',
                    padding:'8px 12px',borderRadius:'8px',background:'#0f172a',border:'1px solid #1f2937'}}>
                    <span className={`badge-${m.action}`}>{m.action}</span>
                    <span style={{fontSize:'0.75rem',background:'#1f2937',padding:'2px 8px',borderRadius:'4px',color:'#9ca3af'}}>{m.type}</span>
                    <span style={{fontSize:'0.8rem',color:'#e5e7eb',fontFamily:'monospace',overflow:'hidden',textOverflow:'ellipsis',whiteSpace:'nowrap'}}>{m.value}</span>
                    {m.comment && <span style={{fontSize:'0.7rem',color:'#6b7280',marginLeft:'auto',flexShrink:0}}>{m.comment}</span>}
                  </div>
                ))}
              </div>
            </div>
          ) : (
            <p style={{fontSize:'0.875rem',color:'#4ade80'}}>✓ No matches — message would be allowed.</p>
          )}
        </div>
      )}
      {result?.error && (
        <div style={{padding:'12px',borderRadius:'8px',background:'rgba(127,29,29,0.2)',
          border:'1px solid #7f1d1d',color:'#f87171',fontSize:'0.875rem'}}>
          Error: {result.error}
        </div>
      )}
    </div>
  );
}

// ── Import/Export Tab ─────────────────────────────────────────────────────────
function ImportExportTab() {
  const [importing,    setImporting]    = useState(false);
  const [importResult, setImportResult] = useState(null);
  const [mergeMode,    setMergeMode]    = useState(true);
  const fileRef = useRef(null);

  const exportConfig = () => {
    const a    = document.createElement('a');
    a.href     = '/api/config/export';
    a.download = `mailguard-config-${new Date().toISOString().slice(0,10)}.json`;
    a.click();
  };

  const importConfig = async e => {
    const file = e.target.files?.[0];
    if (!file) return;
    setImporting(true); setImportResult(null);
    try {
      const data = JSON.parse(await file.text());
      const r    = await api.post('/config/import', {...data, merge:mergeMode});
      setImportResult(r.data);
    } catch(e) {
      setImportResult({ error: e.response?.data?.error || e.message });
    }
    setImporting(false);
    e.target.value = '';
  };

  return (
    <div className="space-y-5" style={{maxWidth:'600px'}}>
      <div className="card">
        <h3 style={{fontSize:'0.875rem',fontWeight:600,color:'#d1d5db',marginBottom:'4px'}}>Export Configuration</h3>
        <p style={{fontSize:'0.75rem',color:'#6b7280',marginBottom:'16px'}}>
          Download all blocklists, rules, settings, SURBL lists, and auth settings as a JSON file.
        </p>
        <button className="btn-primary flex items-center gap-2" onClick={exportConfig}>
          <Download size={15}/>Export Config JSON
        </button>
      </div>
      <div className="card">
        <h3 style={{fontSize:'0.875rem',fontWeight:600,color:'#d1d5db',marginBottom:'4px'}}>Import Configuration</h3>
        <p style={{fontSize:'0.75rem',color:'#6b7280',marginBottom:'16px'}}>
          Import a previously exported config file.
        </p>
        <Toggle label="Merge mode"
          desc="On: update existing entries. Off: replace rules entirely (blocklists always merge)"
          val={mergeMode} onChange={() => setMergeMode(m => !m)}/>
        <div style={{marginTop:'14px'}}>
          <input ref={fileRef} type="file" accept=".json" style={{display:'none'}} onChange={importConfig}/>
          <button className="btn-ghost flex items-center gap-2" onClick={() => fileRef.current?.click()}
            disabled={importing}>
            <Upload size={15}/>{importing ? 'Importing…' : 'Choose JSON File'}
          </button>
        </div>
        {importResult && !importResult.error && (
          <div style={{marginTop:'14px',padding:'12px',borderRadius:'8px',
            background:'rgba(5,46,22,0.4)',border:'1px solid #166534'}}>
            <p style={{color:'#4ade80',fontWeight:600,fontSize:'0.875rem',margin:'0 0 6px'}}>✓ Import successful</p>
            {Object.entries(importResult.results?.imported||{}).map(([k,v]) => (
              <p key={k} style={{color:'#86efac',fontSize:'0.75rem',margin:'2px 0'}}>{k}: {v} records</p>
            ))}
            {importResult.results?.errors?.length > 0 && (
              <div style={{marginTop:'8px'}}>
                <p style={{color:'#fbbf24',fontSize:'0.75rem',fontWeight:600}}>Warnings:</p>
                {importResult.results.errors.map((e,i) => (
                  <p key={i} style={{color:'#fbbf24',fontSize:'0.7rem',margin:'2px 0'}}>{e}</p>
                ))}
              </div>
            )}
          </div>
        )}
        {importResult?.error && (
          <div style={{marginTop:'14px',padding:'12px',borderRadius:'8px',
            background:'rgba(127,29,29,0.2)',border:'1px solid #7f1d1d',color:'#f87171',fontSize:'0.875rem'}}>
            Error: {importResult.error}
          </div>
        )}
      </div>
    </div>
  );
}

// ── Greylist & Rate Limiting Tab ──────────────────────────────────────────────
function GreylistRateLimitTab() {
  const [cfg,        setCfg]        = useState({});
  const [saved,      setSaved]      = useState(false);
  const [restarting, setRestarting] = useState(false);
  const [restartMsg, setRestartMsg] = useState('');

  useEffect(() => {
    Promise.all([
      api.get('/settings?category=greylist'),
      api.get('/settings?category=ratelimit'),
    ]).then(([g, r]) => {
      const m = {};
      [...g.data, ...r.data].forEach(s => { m[`${s.category}.${s.key_name}`] = s.value; });
      setCfg(m);
    }).catch(() => {});
  }, []);

  const get    = k => cfg[k] ?? '';
  const bool   = k => cfg[k] === 'true';
  const save   = async (category, key, value) => {
    setCfg(c => ({...c, [`${category}.${key}`]: String(value)}));
    await api.post('/settings/upsert', { category, key_name:key, value:String(value) }).catch(() => {});
    setSaved(true); setTimeout(() => setSaved(false), 4000);
  };
  const toggle = (cat, key) => save(cat, key, !bool(`${cat}.${key}`));

  const restartPostfix = async () => {
    setRestarting(true);
    setRestartMsg('');
    try {
      await api.post('/restart/postfix');
      setRestartMsg('Postfix restarted — new settings are now active.');
    } catch { setRestartMsg('Restart failed — try: docker compose restart postfix'); }
    setRestarting(false);
    setTimeout(() => setRestartMsg(''), 5000);
  };

  const numRow = (cat, key, label, desc, min, max, unit) => (
    <div style={{display:'flex',alignItems:'center',justifyContent:'space-between',
      padding:'10px 0',borderBottom:'1px solid #1f2937'}}>
      <div>
        <p style={{fontSize:'0.875rem',fontWeight:500,color:'#e5e7eb',margin:0}}>{label}</p>
        {desc && <p style={{fontSize:'0.75rem',color:'#6b7280',margin:'2px 0 0'}}>{desc}</p>}
      </div>
      <div style={{display:'flex',alignItems:'center',gap:'6px',flexShrink:0}}>
        <input type="number" min={min} max={max}
          style={{width:'80px',textAlign:'center',background:'#1f2937',border:'1px solid #374151',
            borderRadius:'8px',padding:'6px',color:'#e5e7eb',fontSize:'0.875rem'}}
          value={get(`${cat}.${key}`) || '0'}
          onChange={e => save(cat, key, e.target.value)}/>
        {unit && <span style={{fontSize:'0.75rem',color:'#6b7280'}}>{unit}</span>}
      </div>
    </div>
  );

  return (
    <div className="space-y-5" style={{maxWidth:'600px'}}>
      <div className="card">
        <div style={{display:'flex',alignItems:'center',justifyContent:'space-between',marginBottom:'4px'}}>
          <h3 style={{fontSize:'0.875rem',fontWeight:600,color:'#d1d5db',margin:0}}>Greylisting</h3>
          <Toggle label="" val={bool('greylist.enabled')} onChange={() => toggle('greylist','enabled')}/>
        </div>
        <p style={{fontSize:'0.75rem',color:'#6b7280',marginBottom:'14px'}}>
          Temporarily reject mail from unknown senders. Legitimate servers retry; spambots usually don't.
          Changes take effect on next Postfix restart.
        </p>
        <div style={{opacity:bool('greylist.enabled')?1:0.4,pointerEvents:bool('greylist.enabled')?'auto':'none'}}>
          {numRow('greylist','delay_seconds',  'Delay',         'Seconds to defer first-time senders', 60, 3600, 'seconds')}
          {numRow('greylist','retry_window',   'Retry Window',  'Hours sender must retry within', 1, 48, 'hours')}
          {numRow('greylist','max_age_days',   'Whitelist Age', 'Days to remember approved sender triples', 1, 365, 'days')}
          <Toggle label="Use Built-in Whitelist"
            desc="Automatically whitelist known legitimate senders (major ISPs, etc.)"
            val={bool('greylist.whitelist_clients')}
            onChange={() => toggle('greylist','whitelist_clients')}/>
        </div>
        {bool('greylist.enabled') && (
          <div style={{marginTop:'10px',padding:'8px 12px',borderRadius:'6px',
            background:'rgba(99,102,241,0.1)',border:'1px solid rgba(99,102,241,0.2)'}}>
            <p style={{fontSize:'0.75rem',color:'#a5b4fc',margin:0}}>
              ℹ Greylisting is active. First-time senders will be deferred for {get('greylist.delay_seconds')||'300'} seconds.
              Restart Postfix to apply changes:{' '}
              <code style={{background:'#1f2937',padding:'1px 5px',borderRadius:'3px'}}>docker compose restart postfix</code>
            </p>
          </div>
        )}
      </div>

      <div className="card">
        <div style={{display:'flex',alignItems:'center',justifyContent:'space-between',marginBottom:'4px'}}>
          <h3 style={{fontSize:'0.875rem',fontWeight:600,color:'#d1d5db',margin:0}}>Rate Limiting</h3>
          <Toggle label="" val={bool('ratelimit.enabled')} onChange={() => toggle('ratelimit','enabled')}/>
        </div>
        <p style={{fontSize:'0.75rem',color:'#6b7280',marginBottom:'14px'}}>
          Limit how many connections and messages a single IP can send per time window.
          Set to 0 to disable a specific limit. Changes take effect on next Postfix restart.
        </p>
        <div style={{opacity:bool('ratelimit.enabled')?1:0.4,pointerEvents:bool('ratelimit.enabled')?'auto':'none'}}>
          {numRow('ratelimit','time_window_seconds',    'Time Window',           'Rolling window for all rate counters', 60, 86400, 'seconds')}
          {numRow('ratelimit','max_connections_per_ip', 'Max Connections / IP',  'Simultaneous SMTP connections per IP (0 = unlimited)', 0, 1000, '')}
          {numRow('ratelimit','max_messages_per_ip',    'Max Messages / IP',     'Messages per IP per time window (0 = unlimited)', 0, 10000, '')}
          {numRow('ratelimit','max_recipients_per_ip',  'Max Recipients / IP',   'Recipients per IP per time window (0 = unlimited)', 0, 10000, '')}
          {numRow('ratelimit','max_messages_per_sender','Max Messages / Sender', 'Messages per sender address per time window (0 = unlimited)', 0, 10000, '')}
          <div style={{padding:'10px 0'}}>
            <p style={{fontSize:'0.875rem',fontWeight:500,color:'#e5e7eb',margin:'0 0 8px'}}>Action when limit exceeded</p>
            <div style={{display:'flex',gap:'6px'}}>
              {['defer','reject'].map(a => (
                <button key={a} onClick={() => save('ratelimit','action',a)}
                  style={{padding:'4px 14px',borderRadius:'6px',fontSize:'0.75rem',fontWeight:500,
                    cursor:'pointer',border:'none',
                    background: get('ratelimit.action')===a ? (a==='defer'?'rgba(99,102,241,0.3)':'rgba(127,29,29,0.3)') : '#1f2937',
                    color: get('ratelimit.action')===a ? (a==='defer'?'#a5b4fc':'#fca5a5') : '#6b7280'}}>
                  {a==='defer' ? 'Defer (421 try later)' : 'Reject (450 blocked)'}
                </button>
              ))}
            </div>
            <p style={{fontSize:'0.7rem',color:'#6b7280',margin:'6px 0 0'}}>
              Defer is gentler — legitimate mail will retry. Reject immediately refuses the connection.
            </p>
          </div>
        </div>
        <div style={{marginTop:'10px',padding:'8px 12px',borderRadius:'6px',
          background:'rgba(30,30,30,0.5)',border:'1px solid #374151'}}>
          <p style={{fontSize:'0.75rem',color:'#6b7280',margin:0}}>
            ℹ Your internal networks ({'{'}10.x, 172.16.x, 192.168.x{'}'}) are always exempt from rate limits.
            Restart Postfix to apply changes.
          </p>
        </div>
      </div>

      {(saved || restartMsg) && (
        <div style={{position:'fixed',bottom:'24px',right:'24px',zIndex:50,
          background:'#1e1b4b',border:'1px solid #4f46e5',color:'#a5b4fc',
          padding:'12px 16px',borderRadius:'10px',fontSize:'0.875rem',
          boxShadow:'0 10px 25px rgba(0,0,0,0.5)'}}>
          {restartMsg
            ? <p style={{margin:0}}>{restartMsg}</p>
            : <>
                <p style={{margin:'0 0 8px',fontWeight:600}}>✓ Settings saved</p>
                <p style={{margin:'0 0 8px',fontSize:'0.75rem',color:'#818cf8'}}>
                  Restart Postfix to apply changes.
                </p>
                <button onClick={restartPostfix} disabled={restarting}
                  style={{padding:'5px 12px',borderRadius:'6px',fontSize:'0.75rem',
                    background:'#4f46e5',color:'white',border:'none',cursor:'pointer',
                    opacity:restarting?0.6:1}}>
                  {restarting ? 'Restarting…' : '↺ Restart Postfix Now'}
                </button>
              </>
          }
        </div>
      )}
    </div>
  );
}

// ── Alert Thresholds Tab ──────────────────────────────────────────────────────
function AlertThresholdsTab() {
  const [cfg,   setCfg]   = useState({});
  const [saved, setSaved] = useState(false);
  const [saving,setSaving]= useState(false);

  useEffect(() => {
    api.get('/alerts/settings').then(r => setCfg(r.data)).catch(() => {});
  }, []);

  const get  = k => cfg[k] ?? '';
  const bool = k => cfg[k] !== 'false';

  const set = (k, v) => setCfg(c => ({ ...c, [k]: String(v) }));

  const save = async () => {
    setSaving(true);
    try {
      await api.put('/alerts/settings', cfg);
      setSaved(true);
      setTimeout(() => setSaved(false), 2000);
    } catch(e) {
      console.error('Failed to save alert settings:', e);
    }
    setSaving(false);
  };

  const numField = (key, label, desc, min, max, unit) => (
    <div style={{display:'flex',alignItems:'center',justifyContent:'space-between',
      padding:'10px 0',borderBottom:'1px solid #1f2937'}}>
      <div>
        <p style={{fontSize:'0.875rem',fontWeight:500,color:'#e5e7eb',margin:0}}>{label}</p>
        {desc && <p style={{fontSize:'0.75rem',color:'#6b7280',margin:'2px 0 0'}}>{desc}</p>}
      </div>
      <div style={{display:'flex',alignItems:'center',gap:'6px',flexShrink:0}}>
        <input type="number" min={min} max={max}
          style={{width:'80px',textAlign:'center',background:'#1f2937',
            border:'1px solid #374151',borderRadius:'8px',padding:'6px',
            color:'#e5e7eb',fontSize:'0.875rem'}}
          value={get(key) || '0'}
          onChange={e => set(key, e.target.value)}/>
        {unit && <span style={{fontSize:'0.75rem',color:'#6b7280'}}>{unit}</span>}
      </div>
    </div>
  );

  return (
    <div className="space-y-5" style={{maxWidth:'600px'}}>
      <div className="card">
        <h3 style={{fontSize:'0.875rem',fontWeight:600,color:'#d1d5db',marginBottom:'4px'}}>Alert Email</h3>
        <p style={{fontSize:'0.75rem',color:'#6b7280',marginBottom:'14px'}}>
          Email address to receive alert notifications.
        </p>
        <input className="input" type="email"
          placeholder="alerts@example.com"
          value={get('alert_email')}
          onChange={e => set('alert_email', e.target.value)}/>
      </div>
      <div className="card">
        <div style={{display:'flex',alignItems:'center',justifyContent:'space-between',marginBottom:'14px'}}>
          <div>
            <h3 style={{fontSize:'0.875rem',fontWeight:600,color:'#d1d5db',margin:0}}>Virus Detection</h3>
            <p style={{fontSize:'0.75rem',color:'#6b7280',margin:'2px 0 0'}}>Alert when viruses are detected.</p>
          </div>
          <Toggle label="" val={bool('virus_enabled')} onChange={() => set('virus_enabled', !bool('virus_enabled'))}/>
        </div>
        <p style={{fontSize:'0.75rem',color:'#6b7280',margin:0}}>Fires when any virus is detected in a 5-minute window.</p>
      </div>
      <div className="card">
        <div style={{display:'flex',alignItems:'center',justifyContent:'space-between',marginBottom:'4px'}}>
          <div>
            <h3 style={{fontSize:'0.875rem',fontWeight:600,color:'#d1d5db',margin:0}}>Spam Score Spike</h3>
            <p style={{fontSize:'0.75rem',color:'#6b7280',margin:'2px 0 0'}}>Alert when many high-scoring messages arrive in a short window.</p>
          </div>
          <Toggle label="" val={bool('spam_spike_enabled')} onChange={() => set('spam_spike_enabled', !bool('spam_spike_enabled'))}/>
        </div>
        <div style={{opacity:bool('spam_spike_enabled')?1:0.4,pointerEvents:bool('spam_spike_enabled')?'auto':'none'}}>
          {numField('spam_spike_score','Score Threshold','Minimum spam score to count toward the spike',1,20,'score')}
          {numField('spam_spike_count','Message Count','Number of messages above threshold to trigger alert',1,100,'messages')}
        </div>
      </div>
      <div className="card">
        <div style={{display:'flex',alignItems:'center',justifyContent:'space-between',marginBottom:'4px'}}>
          <div>
            <h3 style={{fontSize:'0.875rem',fontWeight:600,color:'#d1d5db',margin:0}}>High IP Block Rate</h3>
            <p style={{fontSize:'0.75rem',color:'#6b7280',margin:'2px 0 0'}}>Alert when a single IP is blocked repeatedly.</p>
          </div>
          <Toggle label="" val={bool('ip_block_enabled')} onChange={() => set('ip_block_enabled', !bool('ip_block_enabled'))}/>
        </div>
        <div style={{opacity:bool('ip_block_enabled')?1:0.4,pointerEvents:bool('ip_block_enabled')?'auto':'none'}}>
          {numField('ip_block_count','Block Count','Number of blocks to trigger alert',1,1000,'blocks')}
          {numField('ip_block_window_min','Time Window','Rolling window for counting blocks',1,60,'minutes')}
        </div>
      </div>
      <div className="card">
        <div style={{display:'flex',alignItems:'center',justifyContent:'space-between',marginBottom:'4px'}}>
          <div>
            <h3 style={{fontSize:'0.875rem',fontWeight:600,color:'#d1d5db',margin:0}}>Auth Failure Spike</h3>
            <p style={{fontSize:'0.75rem',color:'#6b7280',margin:'2px 0 0'}}>Alert when SPF/DKIM/DMARC failures spike in a 10-minute window.</p>
          </div>
          <Toggle label="" val={bool('auth_fail_enabled')} onChange={() => set('auth_fail_enabled', !bool('auth_fail_enabled'))}/>
        </div>
        <div style={{opacity:bool('auth_fail_enabled')?1:0.4,pointerEvents:bool('auth_fail_enabled')?'auto':'none'}}>
          {numField('auth_fail_count','Failure Count','Number of auth failures in 10 minutes to trigger alert',1,500,'failures')}
        </div>
      </div>
      <div className="card">
        <div style={{display:'flex',alignItems:'center',justifyContent:'space-between',marginBottom:'4px'}}>
          <div>
            <h3 style={{fontSize:'0.875rem',fontWeight:600,color:'#d1d5db',margin:0}}>Queue Backlog</h3>
            <p style={{fontSize:'0.75rem',color:'#6b7280',margin:'2px 0 0'}}>Alert when the mail queue depth appears high.</p>
          </div>
          <Toggle label="" val={bool('queue_enabled')} onChange={() => set('queue_enabled', !bool('queue_enabled'))}/>
        </div>
        <div style={{opacity:bool('queue_enabled')?1:0.4,pointerEvents:bool('queue_enabled')?'auto':'none'}}>
          {numField('queue_depth','Queue Depth','Number of messages in 5-minute window to trigger alert',10,10000,'messages')}
        </div>
      </div>
      <div style={{display:'flex',alignItems:'center',gap:'12px'}}>
        <button className="btn-primary" onClick={save} disabled={saving} style={{opacity:saving?0.6:1}}>
          {saving ? 'Saving…' : 'Save Alert Settings'}
        </button>
        {saved && <span style={{fontSize:'0.875rem',color:'#4ade80'}}>✓ Saved</span>}
      </div>
    </div>
  );
}

// ── General Tab ───────────────────────────────────────────────────────────────
function GeneralTab() {
  const [sessionTimeout, setSessionTimeout] = useState('720');
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    api.get('/settings?category=general').then(r => {
      const row = r.data.find(s => s.key_name === 'session_timeout_minutes');
      if (row) setSessionTimeout(row.value);
    }).catch(() => {});
  }, []);

  async function save() {
    setSaving(true);
    setSaved(false);
    try {
      await api.post('/settings/upsert', {
        category: 'general', key_name: 'session_timeout_minutes',
        value: String(parseInt(sessionTimeout, 10) || 0), value_type: 'integer',
        description: 'Session timeout in minutes (0 = unlimited)',
      });
      setSaved(true);
      setTimeout(() => setSaved(false), 2000);
    } finally { setSaving(false); }
  }

  return (
    <div className="card" style={{maxWidth:'560px'}}>
      <p style={{color:'#6b7280',fontSize:'0.875rem',marginBottom:'20px'}}>
        Core settings like hostname, relay, and ports are configured in{' '}
        <code style={{background:'#1f2937',padding:'1px 6px',borderRadius:'4px'}}>.env</code>{' '}
        and take effect on container restart.
      </p>

      <div style={{borderTop:'1px solid #1f2937',paddingTop:'16px'}}>
        <h3 style={{fontSize:'0.8rem',color:'#6b7280',textTransform:'uppercase',
          letterSpacing:'0.05em',marginBottom:'12px'}}>Session</h3>
        <div style={{display:'flex',alignItems:'center',justifyContent:'space-between',
          padding:'10px 0',borderBottom:'1px solid #1f2937'}}>
          <div>
            <p style={{fontSize:'0.875rem',fontWeight:500,color:'#e5e7eb',margin:0}}>
              Session Timeout
            </p>
            <p style={{fontSize:'0.75rem',color:'#6b7280',margin:'2px 0 0'}}>
              Minutes before login sessions expire. Set to 0 for unlimited.
            </p>
          </div>
          <div style={{display:'flex',alignItems:'center',gap:'8px',marginLeft:'16px'}}>
            <input
              type="number" min="0" step="1"
              value={sessionTimeout}
              onChange={e => setSessionTimeout(e.target.value)}
              style={{width:'80px',textAlign:'center',background:'#1f2937',
                border:'1px solid #374151',borderRadius:'8px',padding:'6px',
                color:'#e5e7eb',fontSize:'0.875rem'}}
            />
            <span style={{fontSize:'0.75rem',color:'#6b7280'}}>min</span>
          </div>
        </div>
        <div style={{display:'flex',justifyContent:'flex-end',marginTop:'12px'}}>
          <button onClick={save} disabled={saving}
            style={{padding:'6px 16px',borderRadius:'8px',fontSize:'0.8rem',fontWeight:500,
              border:'none',cursor:'pointer',
              background: saved ? '#16a34a' : '#4f46e5',
              color:'white'}}>
            {saved ? 'Saved' : saving ? 'Saving…' : 'Save'}
          </button>
        </div>
      </div>
    </div>
  );
}

// ── Main Settings Page ────────────────────────────────────────────────────────
// ── Compound Rules Tab ────────────────────────────────────────────────────────
// Multi-condition rules (AND across message parts) enforced at SMTP time by the
// mailguard-milter. Stored in the `rules` table as conditions = {"all":[…]}.
// Only these compound rows are shown/managed here; legacy object-form rules
// (spam_score_gte, attachment_ext, …) used by the Rule Tester are left alone.
const CR_FIELDS = [
  { value: 'header_from_domain', label: 'From: header domain', hint: 'domain of the visible From: address' },
  { value: 'header_from',        label: 'From: header (full)',  hint: 'the whole From: header value' },
  { value: 'sender_domain',      label: 'Envelope sender domain', hint: 'MAIL FROM (Return-Path) domain' },
  { value: 'subject',            label: 'Subject',              hint: 'the Subject header' },
  { value: 'body',               label: 'Body (decoded)',       hint: 'MIME-decoded text — catches base64/HTML' },
];
const CR_OPS = [
  { value: 'eq',       label: 'equals' },
  { value: 'contains', label: 'contains' },
  { value: 'regex',    label: 'matches regex' },
];
const CR_FIELD_LABEL = Object.fromEntries(CR_FIELDS.map(f => [f.value, f.label]));
const CR_OP_LABEL     = Object.fromEntries(CR_OPS.map(o => [o.value, o.label]));

function parseCompoundConditions(conditions) {
  let c = conditions;
  if (typeof c === 'string') { try { c = JSON.parse(c); } catch { return null; } }
  if (c && Array.isArray(c.all)) return c.all;
  return null;
}

function validateCompound(name, conds) {
  if (!name.trim()) return 'Rule name is required';
  if (!conds.length) return 'Add at least one condition';
  for (const c of conds) {
    if (!c.field || !c.op) return 'Each condition needs a field and an operator';
    if (c.value == null || c.value === '') return 'Each condition needs a value';
    if (c.op === 'regex') {
      try { new RegExp(c.value); } catch { return `Invalid regex: ${c.value}`; }
    }
  }
  return null;
}

// Editable list of {field, op, value} rows (AND-ed together).
function ConditionRows({ conds, setConds }) {
  const update = (i, patch) => setConds(conds.map((c, idx) => idx === i ? { ...c, ...patch } : c));
  const remove = i => setConds(conds.filter((_, idx) => idx !== i));
  const add    = () => setConds([...conds, { field: 'body', op: 'contains', value: '' }]);

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
      {conds.map((c, i) => (
        <div key={i} style={{ display: 'flex', alignItems: 'center', gap: '8px', flexWrap: 'wrap' }}>
          {i > 0 && (
            <span style={{ fontSize: '0.7rem', fontWeight: 700, color: '#818cf8',
              width: '34px', textAlign: 'center', flexShrink: 0 }}>AND</span>
          )}
          {i === 0 && <span style={{ width: '34px', flexShrink: 0 }} />}
          <select className="input" style={{ width: '190px', fontSize: '0.8rem' }}
            value={c.field} onChange={e => update(i, { field: e.target.value })}>
            {CR_FIELDS.map(f => <option key={f.value} value={f.value}>{f.label}</option>)}
          </select>
          <select className="input" style={{ width: '130px', fontSize: '0.8rem' }}
            value={c.op} onChange={e => update(i, { op: e.target.value })}>
            {CR_OPS.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
          </select>
          <input className="input" style={{ flex: 1, minWidth: '160px', fontSize: '0.8rem',
            fontFamily: 'monospace' }}
            placeholder={c.op === 'regex' ? 'e.g. subscription|renew' : c.field.includes('domain') ? 'e.g. gmail.com' : 'value'}
            value={c.value} onChange={e => update(i, { value: e.target.value })}/>
          <button className="btn-ghost" style={{ padding: '4px 10px', fontSize: '0.75rem', flexShrink: 0 }}
            onClick={() => remove(i)} disabled={conds.length === 1} title="Remove condition">✕</button>
        </div>
      ))}
      <button className="btn-ghost" style={{ alignSelf: 'flex-start', fontSize: '0.75rem',
        padding: '4px 12px', marginLeft: '42px' }} onClick={add}>+ Add condition</button>
    </div>
  );
}

function CompoundRulesTab({ highlightId }) {
  const NEW_RULE = () => ({
    name: '', priority: 100,
    conds: [{ field: 'header_from_domain', op: 'eq', value: '' }],
  });

  const [items,   setItems]   = useState([]);
  const [loading, setLoading] = useState(false);
  const [form,    setForm]    = useState(NEW_RULE());
  const [formErr, setFormErr] = useState('');
  const [saving,  setSaving]  = useState(false);

  const [editing,  setEditing]  = useState(null);   // rule id
  const [editForm, setEditForm] = useState(null);   // {name, priority, conds}
  const [editErr,  setEditErr]  = useState('');

  const [toast, setToast] = useState(null);
  const notify = (msg, ok = true) => { setToast({ msg, ok }); setTimeout(() => setToast(null), 3000); };

  const load = () => {
    setLoading(true);
    api.get('/rules')
      .then(r => setItems(r.data.filter(x => parseCompoundConditions(x.conditions))))
      .catch(() => notify('Failed to load rules', false))
      .finally(() => setLoading(false));
  };
  useEffect(() => { load(); }, []);
  const hl = useHighlight(highlightId, !loading && items.length > 0);

  const handleAdd = async () => {
    setFormErr('');
    const err = validateCompound(form.name, form.conds);
    if (err) { setFormErr(err); return; }
    setSaving(true);
    try {
      await api.post('/rules', {
        name: form.name.trim(),
        priority: Number(form.priority) || 100,
        action: 'block',
        enabled: true,
        conditions: { all: form.conds.map(c => ({ field: c.field, op: c.op, value: c.value.trim() })) },
      });
      setForm(NEW_RULE());
      notify('Rule added — enforced at SMTP time');
      load();
    } catch (e) {
      setFormErr(e.response?.data?.error || e.message);
    }
    setSaving(false);
  };

  const startEdit = item => {
    setEditing(item.id);
    setEditForm({
      name: item.name,
      priority: item.priority,
      conds: parseCompoundConditions(item.conditions).map(c => ({
        field: c.field, op: (c.op || 'regex'), value: String(c.value ?? ''),
      })),
    });
    setEditErr('');
  };
  const cancelEdit = () => { setEditing(null); setEditForm(null); setEditErr(''); };

  const saveEdit = async item => {
    setEditErr('');
    const err = validateCompound(editForm.name, editForm.conds);
    if (err) { setEditErr(err); return; }
    try {
      await api.put(`/rules/${item.id}`, {
        name: editForm.name.trim(),
        priority: Number(editForm.priority) || 100,
        action: 'block',
        enabled: item.enabled,
        conditions: { all: editForm.conds.map(c => ({ field: c.field, op: c.op, value: c.value.trim() })) },
      });
      cancelEdit();
      notify('Rule updated');
      load();
    } catch (e) {
      setEditErr(e.response?.data?.error || e.message);
    }
  };

  const toggle = async item => {
    try {
      await api.put(`/rules/${item.id}`, { enabled: !item.enabled });
      setItems(prev => prev.map(i => i.id === item.id ? { ...i, enabled: !i.enabled } : i));
    } catch { notify('Toggle failed', false); }
  };

  const del = async id => {
    if (!confirm('Delete this rule?')) return;
    try {
      await api.delete(`/rules/${id}`);
      setItems(prev => prev.filter(i => i.id !== id));
      notify('Rule deleted');
    } catch { notify('Delete failed', false); }
  };

  const summary = conds => conds.map(c =>
    `${CR_FIELD_LABEL[c.field] || c.field} ${CR_OP_LABEL[c.op] || c.op} ${c.value}`
  ).join('  AND  ');

  return (
    <div className="space-y-5" style={{ maxWidth: '860px' }}>
      {/* Explainer */}
      <div className="card" style={{ background: 'rgba(79,70,229,0.08)', border: '1px solid rgba(79,70,229,0.3)' }}>
        <p style={{ fontSize: '0.8rem', color: '#c7d2fe', margin: 0 }}>
          Compound rules combine several conditions with <strong>AND</strong> across different parts of a
          message — something the single-field blocklists can't do. A match is a <strong>hard SMTP reject</strong>
          {' '}at message time (the mail is refused, never queued or delivered), enforced by the MailGuard milter.
          The body is MIME-decoded, so base64/HTML-obfuscated spam is caught too.
        </p>
      </div>

      {/* Add form */}
      <div className="card space-y-3">
        <h3 style={{ fontSize: '0.875rem', fontWeight: 600, color: '#d1d5db', margin: 0 }}>New Compound Rule</h3>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 120px', gap: '10px' }}>
          <input className="input" placeholder="Rule name / reason (e.g. Gmail subscription spam)"
            value={form.name} onChange={e => { setForm({ ...form, name: e.target.value }); setFormErr(''); }}/>
          <input className="input" type="number" min="1" placeholder="Priority"
            title="Lower number = evaluated first"
            value={form.priority} onChange={e => setForm({ ...form, priority: e.target.value })}/>
        </div>
        <div>
          <p style={{ fontSize: '0.7rem', color: '#6b7280', margin: '0 0 6px 42px' }}>
            Reject when ALL of these match:
          </p>
          <ConditionRows conds={form.conds} setConds={c => { setForm({ ...form, conds: c }); setFormErr(''); }}/>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
          <span style={{ fontSize: '0.75rem', ...ACTION_COLORS.block, padding: '3px 10px', borderRadius: '9999px' }}>
            Action: Block / Reject
          </span>
          <span style={{ fontSize: '0.7rem', color: '#6b7280' }}>
            Hard SMTP reject (only enforceable action for compound rules)
          </span>
          <button className="btn-primary" onClick={handleAdd} disabled={saving}
            style={{ marginLeft: 'auto', minWidth: '90px', opacity: saving ? 0.6 : 1 }}>
            {saving ? 'Adding…' : 'Add Rule'}
          </button>
        </div>
        {formErr && <p style={{ fontSize: '0.75rem', color: '#f87171', margin: 0 }}>⚠ {formErr}</p>}
      </div>

      {/* Existing rules */}
      <div className="space-y-3">
        {loading && <p style={{ color: '#6b7280', fontSize: '0.875rem' }}>Loading…</p>}
        {!loading && items.length === 0 && (
          <p style={{ color: '#6b7280', fontSize: '0.875rem' }}>No compound rules yet.</p>
        )}
        {items.map(item => editing === item.id ? (
          <div key={item.id} className="card space-y-3" style={{ border: '1px solid #4f46e5' }}>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 120px', gap: '10px' }}>
              <input className="input" value={editForm.name}
                onChange={e => { setEditForm({ ...editForm, name: e.target.value }); setEditErr(''); }}/>
              <input className="input" type="number" min="1" value={editForm.priority}
                onChange={e => setEditForm({ ...editForm, priority: e.target.value })}/>
            </div>
            <ConditionRows conds={editForm.conds}
              setConds={c => { setEditForm({ ...editForm, conds: c }); setEditErr(''); }}/>
            {editErr && <p style={{ fontSize: '0.75rem', color: '#f87171', margin: 0 }}>⚠ {editErr}</p>}
            <div style={{ display: 'flex', gap: '8px' }}>
              <button className="btn-primary text-xs py-1 px-4" onClick={() => saveEdit(item)}>Save</button>
              <button className="btn-ghost text-xs py-1 px-4" onClick={cancelEdit}>Cancel</button>
            </div>
          </div>
        ) : (
          <div key={item.id} id={`hl-${item.id}`}
            className={`card${hl === String(item.id) ? ' mg-rule-flash' : ''}`}
            style={{ opacity: item.enabled ? 1 : 0.5, display: 'flex', alignItems: 'flex-start',
              justifyContent: 'space-between', gap: '16px' }}>
            <div style={{ minWidth: 0, flex: 1 }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '10px', flexWrap: 'wrap' }}>
                <span style={{ fontSize: '0.875rem', fontWeight: 600, color: '#e5e7eb' }}>{item.name}</span>
                <span style={{ fontSize: '0.7rem', ...ACTION_COLORS.block, padding: '2px 8px', borderRadius: '9999px' }}>block</span>
                <span style={{ fontSize: '0.7rem', color: '#6b7280' }}>priority {item.priority}</span>
                {item.hits > 0 && (
                  <span style={{ fontSize: '0.7rem', color: '#fbbf24' }}>{item.hits} hit{item.hits === 1 ? '' : 's'}</span>
                )}
              </div>
              <p style={{ fontSize: '0.75rem', color: '#9ca3af', fontFamily: 'monospace',
                margin: '6px 0 0', wordBreak: 'break-word' }}>
                {summary(parseCompoundConditions(item.conditions))}
              </p>
            </div>
            <div style={{ display: 'flex', alignItems: 'center', gap: '8px', flexShrink: 0 }}>
              <Toggle label="" val={!!item.enabled} onChange={() => toggle(item)}/>
              <button className="btn-ghost text-xs py-1 px-3" onClick={() => startEdit(item)}>Edit</button>
              <button className="btn-ghost text-xs py-1 px-3" style={{ color: '#f87171' }}
                onClick={() => del(item.id)}>Delete</button>
            </div>
          </div>
        ))}
      </div>

      {toast && (
        <div style={{ position: 'fixed', bottom: '24px', right: '24px', padding: '12px 18px',
          borderRadius: '10px', fontSize: '0.8rem', zIndex: 50,
          background: toast.ok ? 'rgba(20,83,45,0.95)' : 'rgba(127,29,29,0.95)',
          color: toast.ok ? '#86efac' : '#fca5a5', border: '1px solid rgba(255,255,255,0.1)' }}>
          {toast.msg}
        </div>
      )}
    </div>
  );
}

export default function Settings() {
  const [searchParams] = useSearchParams();
  const [tab, setTab] = useState(searchParams.get('tab') || 'general');
  const highlightId = searchParams.get('highlight');

  useEffect(() => {
    const t = searchParams.get('tab');
    if (t) setTab(t);
  }, [searchParams]);

  const PANELS = {
    blocklists:      <BlocklistsTab highlightId={highlightId}/>,
    suggestions:     <SuggestionsTab/>,
    spam:            <SpamTab/>,
    spamfilter:      <SpamFilteringTab/>,
    greylist:        <GreylistRateLimitTab/>,
    auth:            <AuthTab/>,
    surbl:           <SurblTab/>,
    alertthresholds: <AlertThresholdsTab/>,
    testmode:        <TestModeTab/>,
    ruletest:        <RuleTesterTab/>,
    importexport:    <ImportExportTab/>,
    general:         <GeneralTab/>,
    rules:           <CompoundRulesTab highlightId={highlightId}/>,
  };

  return (
    <div className="space-y-5">
      <h1 className="text-2xl font-bold">Settings</h1>
      <div style={{display:'flex',flexWrap:'wrap',gap:'4px',
        borderBottom:'1px solid #1f2937',paddingBottom:'12px'}}>
        {TABS.map(({key, label, icon:Icon}) => (
          <button key={key} onClick={() => setTab(key)}
            style={{display:'inline-flex',alignItems:'center',gap:'6px',padding:'6px 12px',
              borderRadius:'8px',fontSize:'0.8rem',fontWeight:500,cursor:'pointer',border:'none',
              background:tab===key?'#4f46e5':'transparent',
              color:tab===key?'white':'#9ca3af'}}>
            <Icon size={14}/>{label}
          </button>
        ))}
      </div>
      {PANELS[tab]}
    </div>
  );
}