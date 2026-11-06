import React, { useState, useRef, useEffect } from 'react';
import { Download, Upload, FlaskConical, ToggleLeft, ToggleRight,
         CheckCircle, XCircle, Flag, Shield, ChevronDown, ChevronUp,
         AlertTriangle, FileJson, FileText } from 'lucide-react';
import api from '../utils/api';

// ── Import / Export ───────────────────────────────────────────────────────────
function ImportExport() {
  const [importing,  setImporting]  = useState(false);
  const [importResult, setImportResult] = useState(null);
  const [importError,  setImportError]  = useState('');
  const fileRef = useRef(null);

  const exportJson = () => {
    window.open('/api/export', '_blank');
  };

  const exportCsv = () => {
    window.open('/api/export?format=csv', '_blank');
  };

  const handleFile = async (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setImporting(true);
    setImportResult(null);
    setImportError('');
    try {
      const text = await file.text();
      const data = JSON.parse(text);
      const r    = await api.post('/export/import', data);
      setImportResult(r.data.results);
    } catch(err) {
      setImportError(err.response?.data?.error || err.message || 'Import failed');
    }
    setImporting(false);
    e.target.value = '';
  };

  return (
    <div className="card space-y-5">
      <h2 className="font-semibold text-gray-200 flex items-center gap-2">
        <FileJson size={18} className="text-indigo-400"/>Import / Export
      </h2>

      <div>
        <p className="text-sm text-gray-400 mb-3">
          Export all configuration (blocklists, rules, settings, SURBL, auth settings) as a JSON backup.
          CSV export is blocklists only.
        </p>
        <div style={{display:'flex',gap:'10px',flexWrap:'wrap'}}>
          <button onClick={exportJson}
            style={{display:'inline-flex',alignItems:'center',gap:'6px',padding:'8px 16px',
              borderRadius:'8px',fontSize:'0.875rem',fontWeight:500,cursor:'pointer',
              background:'rgba(99,102,241,0.15)',border:'1px solid rgba(99,102,241,0.4)',color:'#a5b4fc'}}>
            <Download size={15}/>Export JSON
          </button>
          <button onClick={exportCsv}
            style={{display:'inline-flex',alignItems:'center',gap:'6px',padding:'8px 16px',
              borderRadius:'8px',fontSize:'0.875rem',fontWeight:500,cursor:'pointer',
              background:'rgba(99,102,241,0.1)',border:'1px solid rgba(99,102,241,0.3)',color:'#818cf8'}}>
            <FileText size={15}/>Export Blocklists CSV
          </button>
        </div>
      </div>

      <div style={{borderTop:'1px solid #1f2937',paddingTop:'16px'}}>
        <p className="text-sm text-gray-400 mb-3">
          Import a previously exported JSON config. Existing entries are updated, new ones are added.
        </p>
        <button onClick={() => fileRef.current?.click()}
          disabled={importing}
          style={{display:'inline-flex',alignItems:'center',gap:'6px',padding:'8px 16px',
            borderRadius:'8px',fontSize:'0.875rem',fontWeight:500,cursor:'pointer',
            background:'rgba(16,185,129,0.1)',border:'1px solid rgba(16,185,129,0.3)',color:'#6ee7b7',
            opacity:importing?0.6:1}}>
          <Upload size={15}/>{importing ? 'Importing…' : 'Import JSON'}
        </button>
        <input ref={fileRef} type="file" accept=".json" style={{display:'none'}} onChange={handleFile}/>

        {importError && (
          <div style={{marginTop:'12px',padding:'10px 14px',borderRadius:'8px',
            background:'rgba(127,29,29,0.3)',border:'1px solid rgba(239,68,68,0.3)',
            color:'#fca5a5',fontSize:'0.875rem'}}>
            ✕ {importError}
          </div>
        )}

        {importResult && (
          <div style={{marginTop:'12px',padding:'12px 14px',borderRadius:'8px',
            background:'rgba(20,83,45,0.3)',border:'1px solid rgba(74,222,128,0.3)',
            color:'#bbf7d0',fontSize:'0.875rem'}}>
            <p className="font-medium mb-1">✓ Import complete</p>
            <ul style={{listStyle:'none',padding:0,margin:0,color:'#86efac',fontSize:'0.8rem'}}>
              <li>Blocklists: {importResult.blocklists} imported</li>
              <li>Rules: {importResult.rules} imported</li>
              <li>Settings: {importResult.settings} imported</li>
              <li>SURBL: {importResult.surbl} imported</li>
              {importResult.errors?.length > 0 && (
                <li style={{color:'#fca5a5',marginTop:'4px'}}>
                  {importResult.errors.length} error(s): {importResult.errors[0]}
                  {importResult.errors.length > 1 && ` (+${importResult.errors.length-1} more)`}
                </li>
              )}
            </ul>
          </div>
        )}
      </div>
    </div>
  );
}

// ── Test Mode ─────────────────────────────────────────────────────────────────
function TestMode() {
  const [global,  setGlobal]  = useState(false);
  const [rules,   setRules]   = useState([]);
  const [saving,  setSaving]  = useState(false);
  const [saved,   setSaved]   = useState(false);

  useEffect(() => {
    api.get('/settings').then(r => {
      const s = r.data.find(x => x.category==='testing' && x.key_name==='test_mode_enabled');
      if (s) setGlobal(s.value === 'true');
    }).catch(()=>{});
    api.get('/rules').then(r => setRules(r.data)).catch(()=>{});
  }, []);

  const toggleGlobal = async () => {
    const next = !global;
    setGlobal(next);
    setSaving(true);
    await api.put('/settings/upsert', {
      category: 'testing', key_name: 'test_mode_enabled', value: String(next)
    }).catch(()=>{});
    setSaving(false);
    setSaved(true);
    setTimeout(() => setSaved(false), 2000);
  };

  const toggleRule = async (rule) => {
    const updated = { ...rule, enabled: !rule.enabled };
    await api.put(`/rules/${rule.id}`, updated).catch(()=>{});
    setRules(prev => prev.map(r => r.id===rule.id ? {...r, enabled:!r.enabled} : r));
  };

  return (
    <div className="card space-y-5">
      <h2 className="font-semibold text-gray-200 flex items-center gap-2">
        <FlaskConical size={18} className="text-yellow-400"/>Test Mode
      </h2>

      {/* Global toggle */}
      <div style={{display:'flex',alignItems:'center',justifyContent:'space-between',
        padding:'14px 16px',borderRadius:'10px',
        background: global ? 'rgba(234,179,8,0.08)' : 'rgba(31,41,55,0.5)',
        border:`1px solid ${global ? 'rgba(234,179,8,0.3)' : '#374151'}`}}>
        <div>
          <p style={{fontWeight:600,fontSize:'0.95rem',
            color: global ? '#fde047' : '#e5e7eb'}}>
            Global Test Mode {global ? '— ACTIVE' : '— Inactive'}
          </p>
          <p style={{fontSize:'0.8rem',color:'#6b7280',marginTop:'2px'}}>
            When active, all filtering rules are evaluated but no messages are blocked or flagged.
            Events are logged with action "allow" regardless of rule matches.
          </p>
        </div>
        <button onClick={toggleGlobal} disabled={saving}
          style={{marginLeft:'16px',flexShrink:0,background:'none',border:'none',cursor:'pointer',
            color: global ? '#fde047' : '#6b7280'}}>
          {global
            ? <ToggleRight size={36}/>
            : <ToggleLeft  size={36}/>}
        </button>
      </div>
      {saved && <p style={{fontSize:'0.8rem',color:'#4ade80'}}>✓ Saved</p>}

      {/* Per-rule toggles */}
      <div>
        <p style={{fontSize:'0.8rem',color:'#6b7280',fontWeight:600,
          textTransform:'uppercase',letterSpacing:'0.05em',marginBottom:'8px'}}>
          Per-Rule Enable / Disable
        </p>
        {rules.length === 0 && (
          <p className="text-sm text-gray-500">No rules configured yet.</p>
        )}
        <div style={{display:'flex',flexDirection:'column',gap:'6px'}}>
          {rules.map(rule => (
            <div key={rule.id}
              style={{display:'flex',alignItems:'center',gap:'12px',padding:'10px 14px',
                borderRadius:'8px',background:'#111827',border:'1px solid #1f2937'}}>
              <button onClick={() => toggleRule(rule)}
                style={{flexShrink:0,background:'none',border:'none',cursor:'pointer',
                  color: rule.enabled ? '#6366f1' : '#374151'}}>
                {rule.enabled
                  ? <ToggleRight size={26}/>
                  : <ToggleLeft  size={26}/>}
              </button>
              <div style={{flex:1,minWidth:0}}>
                <p style={{fontSize:'0.875rem',fontWeight:500,
                  color: rule.enabled ? '#e5e7eb' : '#6b7280'}}>{rule.name}</p>
                {rule.description && (
                  <p style={{fontSize:'0.75rem',color:'#4b5563',marginTop:'1px'}}>{rule.description}</p>
                )}
              </div>
              <span style={{fontSize:'0.7rem',padding:'2px 8px',borderRadius:'9999px',flexShrink:0,
                background: rule.enabled ? 'rgba(99,102,241,0.15)' : 'rgba(55,65,81,0.5)',
                color: rule.enabled ? '#a5b4fc' : '#6b7280',
                border:`1px solid ${rule.enabled ? 'rgba(99,102,241,0.3)' : '#374151'}`}}>
                {rule.action}
              </span>
              <span style={{fontSize:'0.7rem',color:'#4b5563',flexShrink:0}}>
                p={rule.priority}
              </span>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

// ── Rule Tester ───────────────────────────────────────────────────────────────
const ACTION_COLOR = {
  block:      {bg:'rgba(127,29,29,0.3)',border:'rgba(239,68,68,0.4)',text:'#fca5a5'},
  quarantine: {bg:'rgba(88,28,135,0.3)',border:'rgba(167,139,250,0.4)',text:'#c4b5fd'},
  flag:       {bg:'rgba(113,63,18,0.3)',border:'rgba(251,191,36,0.4)',text:'#fde68a'},
  allow:      {bg:'rgba(20,83,45,0.3)', border:'rgba(74,222,128,0.4)',text:'#bbf7d0'},
};

function RuleTester() {
  const [mode,    setMode]    = useState('headers');
  const [raw,     setRaw]     = useState('');
  const [result,  setResult]  = useState(null);
  const [testing, setTesting] = useState(false);
  const [error,   setError]   = useState('');
  const [showEnv, setShowEnv] = useState(false);

  const test = async () => {
    if (!raw.trim()) return;
    setTesting(true);
    setResult(null);
    setError('');
    try {
      const r = await api.post('/ruletest', { raw, mode });
      setResult(r.data);
    } catch(e) {
      setError(e.response?.data?.error || e.message);
    }
    setTesting(false);
  };

  const ac = result ? (ACTION_COLOR[result.final_action] || ACTION_COLOR.allow) : null;

  const PLACEHOLDERS = {
    headers: `From: sender@example.com
To: recipient@yourdomain.com
Subject: Test message
Received: from mail.example.com ([203.0.113.45])
Message-ID: <abc123@example.com>
Date: Thu, 05 Mar 2026 12:00:00 +0000`,
    full: `From: sender@example.com
To: recipient@yourdomain.com
Subject: Test message
Received: from mail.example.com ([203.0.113.45])
Message-ID: <abc123@example.com>
Date: Thu, 05 Mar 2026 12:00:00 +0000

This is the email body content.
Click here to win a prize!`,
  };

  return (
    <div className="card space-y-5">
      <h2 className="font-semibold text-gray-200 flex items-center gap-2">
        <Shield size={18} className="text-indigo-400"/>Rule Tester
      </h2>
      <p className="text-sm text-gray-400">
        Paste email headers or a full raw email to see which rules and blocklists would match,
        and what action would be taken — without affecting live mail.
      </p>

      {/* Mode selector */}
      <div style={{display:'flex',gap:'8px'}}>
        {['headers','full'].map(m => (
          <button key={m} onClick={() => setMode(m)}
            style={{padding:'6px 14px',borderRadius:'8px',fontSize:'0.8rem',
              fontWeight:500,cursor:'pointer',
              background: mode===m ? 'rgba(99,102,241,0.2)' : 'transparent',
              border:`1px solid ${mode===m ? 'rgba(99,102,241,0.5)' : '#374151'}`,
              color: mode===m ? '#a5b4fc' : '#6b7280'}}>
            {m === 'headers' ? 'Headers only' : 'Full email'}
          </button>
        ))}
      </div>

      <textarea
        value={raw}
        onChange={e => setRaw(e.target.value)}
        placeholder={PLACEHOLDERS[mode]}
        style={{width:'100%',height:'200px',background:'#0f172a',border:'1px solid #374151',
          borderRadius:'10px',padding:'12px',fontSize:'0.8rem',fontFamily:'monospace',
          color:'#e5e7eb',resize:'vertical',boxSizing:'border-box',outline:'none'}}
      />

      <button onClick={test} disabled={testing || !raw.trim()}
        style={{display:'inline-flex',alignItems:'center',gap:'6px',padding:'8px 20px',
          borderRadius:'8px',fontSize:'0.875rem',fontWeight:600,cursor:'pointer',
          background: testing||!raw.trim() ? 'rgba(99,102,241,0.3)' : 'rgba(99,102,241,0.8)',
          border:'1px solid rgba(99,102,241,0.6)',color:'white',opacity:testing?0.7:1}}>
        <FlaskConical size={15}/>{testing ? 'Testing…' : 'Run Test'}
      </button>

      {error && (
        <div style={{padding:'10px 14px',borderRadius:'8px',fontSize:'0.875rem',
          background:'rgba(127,29,29,0.3)',border:'1px solid rgba(239,68,68,0.3)',color:'#fca5a5'}}>
          ✕ {error}
        </div>
      )}

      {result && (
        <div style={{display:'flex',flexDirection:'column',gap:'12px'}}>
          {/* Final verdict */}
          <div style={{padding:'14px 16px',borderRadius:'10px',
            background: ac.bg, border:`1px solid ${ac.border}`}}>
            <p style={{fontWeight:700,fontSize:'1rem',color:ac.text,marginBottom:'4px'}}>
              {result.final_action.toUpperCase()}
            </p>
            <p style={{fontSize:'0.875rem',color:ac.text,opacity:0.8}}>{result.final_reason}</p>
          </div>

          {/* Extracted envelope */}
          <div>
            <button onClick={() => setShowEnv(!showEnv)}
              style={{display:'flex',alignItems:'center',gap:'6px',fontSize:'0.8rem',
                color:'#6b7280',background:'none',border:'none',cursor:'pointer',padding:0}}>
              {showEnv ? <ChevronUp size={14}/> : <ChevronDown size={14}/>}
              Extracted envelope
            </button>
            {showEnv && (
              <div style={{marginTop:'8px',padding:'12px',borderRadius:'8px',
                background:'#0f172a',border:'1px solid #1f2937',
                fontSize:'0.75rem',fontFamily:'monospace',color:'#9ca3af',
                display:'grid',gridTemplateColumns:'1fr 1fr',gap:'4px 16px'}}>
                {Object.entries(result.envelope)
                  .filter(([k]) => !['raw_headers','body_preview','has_body'].includes(k))
                  .map(([k,v]) => v ? (
                    <div key={k}>
                      <span style={{color:'#6366f1'}}>{k}: </span>
                      <span style={{color:'#e5e7eb'}}>{String(v)}</span>
                    </div>
                  ) : null)}
              </div>
            )}
          </div>

          {/* Matches */}
          {result.matches.length === 0 ? (
            <p style={{fontSize:'0.875rem',color:'#6b7280'}}>No blocklist or rule matches found.</p>
          ) : (
            <div>
              <p style={{fontSize:'0.8rem',color:'#6b7280',fontWeight:600,
                textTransform:'uppercase',letterSpacing:'0.05em',marginBottom:'8px'}}>
                {result.matches.length} match{result.matches.length!==1?'es':''}
              </p>
              <div style={{display:'flex',flexDirection:'column',gap:'6px'}}>
                {result.matches.map((m, i) => {
                  const c = ACTION_COLOR[m.action] || ACTION_COLOR.allow;
                  return (
                    <div key={i} style={{display:'flex',alignItems:'center',gap:'10px',
                      padding:'8px 12px',borderRadius:'8px',
                      background:'#111827',border:'1px solid #1f2937'}}>
                      <span style={{fontSize:'0.7rem',padding:'2px 8px',borderRadius:'9999px',
                        background:c.bg,border:`1px solid ${c.border}`,color:c.text,flexShrink:0}}>
                        {m.action}
                      </span>
                      <div style={{flex:1,minWidth:0}}>
                        <p style={{fontSize:'0.8rem',color:'#e5e7eb',fontWeight:500}}>
                          {m.source === 'rule' ? `Rule: ${m.name}` : `${m.list_type} — ${m.matched_value}`}
                        </p>
                        {m.comment && (
                          <p style={{fontSize:'0.7rem',color:'#4b5563'}}>{m.comment}</p>
                        )}
                      </div>
                      <span style={{fontSize:'0.7rem',color:'#4b5563',flexShrink:0,
                        textTransform:'uppercase'}}>{m.source}</span>
                    </div>
                  );
                })}
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

// ── Main page ─────────────────────────────────────────────────────────────────
export default function Tools() {
  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-bold">Tools</h1>
      <ImportExport />
      <TestMode />
      <RuleTester />
    </div>
  );
}