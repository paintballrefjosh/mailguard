import React, { useEffect, useState } from 'react';
import api from '../../utils/api';

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

function Toggle({ label, desc, val, onChange }) {
  return (
    <label style={{display:'flex',alignItems:'center',justifyContent:'space-between',
      padding:'10px 0',borderBottom:'1px solid #1f2937',cursor:'pointer'}}>
      <div>
        <p style={{fontSize:'0.875rem',fontWeight:500,color:'#e5e7eb',margin:0}}>{label}</p>
        {desc && <p style={{fontSize:'0.75rem',color:'#6b7280',margin:'2px 0 0'}}>{desc}</p>}
      </div>
      <div onClick={onChange}
        style={{width:'40px',height:'22px',borderRadius:'11px',flexShrink:0,
          background:val?'#4f46e5':'#374151',position:'relative',transition:'background 0.2s',cursor:'pointer'}}>
        <div style={{width:'16px',height:'16px',background:'white',borderRadius:'50%',
          position:'absolute',top:'3px',transition:'left 0.2s',left:val?'21px':'3px'}}/>
      </div>
    </label>
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

export default function SpamFilteringTab() {
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
    const fullKey = `${category}.${key}`;
    setCfg(c => ({...c, [fullKey]: String(value)}));
    await api.post('/settings/upsert', {
      category, key_name: key, value: String(value)
    }).catch(() => {});
    setSaved(true);
    setTimeout(() => setSaved(false), 2000);
  };

  const toggleBool = (category, key) => save(category, key, !bool(`${category}.${key}`));

  return (
    <div className="space-y-5" style={{maxWidth:'640px'}}>

      {/* Virus actions */}
      <div className="card">
        <h3 style={{fontSize:'0.875rem',fontWeight:600,color:'#d1d5db',marginBottom:'4px'}}>Virus Detection</h3>
        <p style={{fontSize:'0.75rem',color:'#6b7280',marginBottom:'14px'}}>
          Action to take when ClamAV detects a virus via Amavis.
        </p>
        <div style={{padding:'10px 0',borderBottom:'1px solid #1f2937'}}>
          <p style={{fontSize:'0.875rem',fontWeight:500,color:'#e5e7eb',margin:'0 0 8px'}}>On virus detected</p>
          <ActionSelect value={get('spam.virus_action')||'quarantine'}
            onChange={v => save('spam', 'virus_action', v)}/>
        </div>
        <Toggle label="Block Encrypted Archives"
          desc="Treat password-protected archives as suspicious"
          val={bool('spam.block_encrypted_archives')}
          onChange={() => toggleBool('spam', 'block_encrypted_archives')}/>
        <div style={{padding:'10px 0'}}>
          <p style={{fontSize:'0.875rem',fontWeight:500,color:'#e5e7eb',margin:'0 0 8px'}}>On banned file attachment</p>
          <ActionSelect value={get('spam.banned_files_action')||'block'}
            onChange={v => save('spam', 'banned_files_action', v)}/>
        </div>
      </div>

      {/* Spam actions */}
      <div className="card">
        <h3 style={{fontSize:'0.875rem',fontWeight:600,color:'#d1d5db',marginBottom:'4px'}}>Spam Detection</h3>
        <p style={{fontSize:'0.75rem',color:'#6b7280',marginBottom:'14px'}}>
          Configure score thresholds and actions for SpamAssassin results.
        </p>
        <ScoreRow label="Tag Score" desc="Add X-Spam headers above this score"
          value={get('spam.sa_tag_score')||'2.0'}
          onChange={v => save('spam', 'sa_tag_score', v)}/>
        <ScoreRow label="Flag Score" desc="Flag message above this score"
          value={get('spam.score_threshold_flag')||'5.0'}
          onChange={v => save('spam', 'score_threshold_flag', v)}/>
        <ScoreRow label="Kill Score" desc="Apply kill action above this score"
          value={get('spam.score_threshold_block')||'10.0'}
          onChange={v => save('spam', 'score_threshold_block', v)}/>
        <div style={{padding:'10px 0',borderTop:'1px solid #1f2937',marginTop:'4px'}}>
          <p style={{fontSize:'0.875rem',fontWeight:500,color:'#e5e7eb',margin:'0 0 8px'}}>On spam above kill score</p>
          <ActionSelect value={get('spam.spam_action')||'flag'}
            onChange={v => save('spam', 'spam_action', v)}/>
        </div>
        <Toggle label="Rewrite Subject" desc="Add [SPAM] tag to subject line when flagged"
          val={bool('spam.sa_rewrite_header')}
          onChange={() => toggleBool('spam', 'sa_rewrite_header')}/>
      </div>

      {/* Header analysis rules */}
      <div className="card">
        <h3 style={{fontSize:'0.875rem',fontWeight:600,color:'#d1d5db',marginBottom:'4px'}}>Header Analysis Rules</h3>
        <p style={{fontSize:'0.75rem',color:'#6b7280',marginBottom:'14px'}}>
          Heuristic checks applied to email headers. Changes take effect on next Amavis restart.
        </p>
        <Toggle
          label="Mismatched Reply-To Domain"
          desc="Flag messages where Reply-To domain differs from From domain (+2.5)"
          val={bool('header_rules.check_reply_to_mismatch')}
          onChange={() => toggleBool('header_rules', 'check_reply_to_mismatch')}/>
        <Toggle
          label="Display Name Spoofing"
          desc="Flag messages where display name contains your domain but sender is external (+4.0)"
          val={bool('header_rules.check_display_name_spoof')}
          onChange={() => toggleBool('header_rules', 'check_display_name_spoof')}/>
        <Toggle
          label="Suspicious X-Mailer"
          desc="Flag messages from known spam-associated mail clients (+1.5)"
          val={bool('header_rules.check_suspicious_mailer')}
          onChange={() => toggleBool('header_rules', 'check_suspicious_mailer')}/>
        <Toggle
          label="Missing Message-ID"
          desc="Flag messages with no Message-ID header (+1.5)"
          val={bool('header_rules.check_missing_mid')}
          onChange={() => toggleBool('header_rules', 'check_missing_mid')}/>
        <Toggle
          label="Lookalike Domains"
          desc="Flag From addresses using lookalike brand names (paypa1.com, g00gle.com, etc.) (+4.0)"
          val={bool('header_rules.check_lookalike_domains')}
          onChange={() => toggleBool('header_rules', 'check_lookalike_domains')}/>
      </div>

      {saved && (
        <p style={{fontSize:'0.75rem',color:'#4ade80',position:'fixed',bottom:'24px',right:'24px',
          background:'#052e16',border:'1px solid #166534',padding:'8px 16px',borderRadius:'8px'}}>
          ✓ Settings saved
        </p>
      )}
    </div>
  );
}