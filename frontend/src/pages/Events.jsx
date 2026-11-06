import React, { useEffect, useState, useCallback, useRef } from 'react';
import { Search, ChevronLeft, ChevronRight, RefreshCw,
         ShieldX, Globe, Server, ChevronDown, Check, Clock, Filter,
         Trash2, ExternalLink } from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import api from '../utils/api';
import useWebSocket from '../utils/useWebSocket';
import useNotification from '../utils/useNotification';
import EventDetail from '../components/EventDetail';

const ALL_ACTIONS = ['allow','block','quarantine','flag','greylist'];
const fmt = d => d ? new Date(d).toLocaleString() : '—';
const badge = a => <span className={`badge-${a}`}>{a}</span>;

function SpamScore({ val }) {
  if (val == null) return <span style={{color:'#6b7280'}}>—</span>;
  const n = parseFloat(val);
  if (isNaN(n)) return <span style={{color:'#6b7280'}}>—</span>;
  const color = n >= 10 ? '#ef4444'
              : n >= 6  ? '#f97316'
              : n >= 3  ? '#facc15'
              : n >= 0  ? '#9ca3af'
              :            '#4ade80';
  return (
    <span style={{color, fontSize:'0.75rem', fontWeight: n >= 3 ? 600 : 400}}>
      {n.toFixed(1)}
    </span>
  );
}

function AuthBadge({ val }) {
  if (!val) return <span style={{color:'#6b7280'}}>—</span>;
  const color = val === 'pass'     ? '#4ade80'
              : val === 'fail'     ? '#f87171'
              : val === 'softfail' ? '#fb923c'
              : '#9ca3af';
  return <span style={{color, fontSize:'0.75rem', fontWeight:500}}>{val}</span>;
}

function hasAuthFailure(r) {
  return r.spf_result   === 'fail' || r.spf_result  === 'softfail' ||
         r.dkim_result  === 'fail' ||
         r.dmarc_result === 'fail';
}

// ── Greylisted icon with tooltip ──────────────────────────────────────────────
function GreylistIcon() {
  const [show, setShow] = useState(false);
  return (
    <span style={{position:'relative',display:'inline-flex',alignItems:'center',marginRight:'5px',flexShrink:0}}
      onMouseEnter={() => setShow(true)} onMouseLeave={() => setShow(false)}>
      <span style={{display:'inline-flex',alignItems:'center',justifyContent:'center',
        width:'16px',height:'16px',borderRadius:'50%',
        background:'rgba(59,130,246,0.15)',border:'1.5px solid #3b82f6',flexShrink:0}}>
        <Clock size={9} style={{color:'#3b82f6'}}/>
      </span>
      {show && (
        <span style={{position:'fixed',background:'#1f2937',border:'1px solid #374151',
          borderRadius:'6px',padding:'4px 8px',fontSize:'0.7rem',color:'#93c5fd',
          whiteSpace:'nowrap',zIndex:9999,pointerEvents:'none',
          boxShadow:'0 4px 12px rgba(0,0,0,0.5)',transform:'translateY(-130%)',marginLeft:'-8px'}}>
          Greylisted — sender will retry
        </span>
      )}
    </span>
  );
}

// ── Blocked icon with tooltip ─────────────────────────────────────────────────
function BlockedIcon({ reason, onClick }) {
  const [show, setShow] = useState(false);
  return (
    <span style={{position:'relative',display:'inline-flex',alignItems:'center',marginRight:'5px',flexShrink:0}}
      onMouseEnter={() => setShow(true)} onMouseLeave={() => setShow(false)}>
      <span onClick={onClick}
        style={{display:'inline-flex',alignItems:'center',justifyContent:'center',
          width:'16px',height:'16px',borderRadius:'50%',
          background:'rgba(239,68,68,0.15)',border:'1.5px solid #ef4444',
          cursor:'pointer',flexShrink:0}}>
        <svg width="10" height="10" viewBox="0 0 10 10" fill="none">
          <circle cx="5" cy="5" r="4" stroke="#ef4444" strokeWidth="1.5"/>
          <line x1="2" y1="8" x2="8" y2="2" stroke="#ef4444" strokeWidth="1.5" strokeLinecap="round"/>
        </svg>
      </span>
      {show && (
        <span style={{position:'fixed',background:'#1f2937',border:'1px solid #374151',
          borderRadius:'6px',padding:'4px 8px',fontSize:'0.7rem',color:'#fca5a5',
          whiteSpace:'nowrap',zIndex:9999,pointerEvents:'none',
          boxShadow:'0 4px 12px rgba(0,0,0,0.5)',transform:'translateY(-130%)',marginLeft:'-8px'}}>
          {reason ? `Blocked: ${reason}` : 'Blocked by rule'}
        </span>
      )}
    </span>
  );
}

// ── Row action menu ───────────────────────────────────────────────────────────
// Each candidate (sender email, domain, IP, …) is looked up against the
// blocklists table on open: an existing exact-match entry marks the item
// green, and clicking a green item opens a submenu to view or delete that
// entry instead of trying to add it again. `matches[key]` is undefined while
// loading, null when there's no existing entry, or {id, action} when there is.
function RowMenu({ row, onClose, onBlocked, onUnblocked }) {
  const ref  = useRef(null);
  const navigate = useNavigate();
  const [matches, setMatches] = useState({});
  const [busy,    setBusy]    = useState({});
  const [openSub, setOpenSub] = useState(null);

  useEffect(() => {
    const handler = e => { if (ref.current && !ref.current.contains(e.target)) onClose(); };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [onClose]);

  const domainParts  = (row.sender_domain || '').split('.');
  const tldVal       = domainParts.length >= 1 ? domainParts[domainParts.length - 1] : null;
  const rootDomVal   = domainParts.length >= 3 ? domainParts.slice(-2).join('.') : null;

  const items = [
    { key:'sender_email', type:'sender_email', icon:ShieldX, label:'Block Sender (Return-Path)', value:row.sender },
    { key:'from_email',   type:'from_email',   icon:ShieldX, label:'Block From address',         value:row.from_header },
    { key:'domain',       type:'domain',       icon:Globe,   label:'Block Domain',               value:row.sender_domain },
    { key:'root_domain',  type:'domain',       icon:Globe,   label:'Block Root Domain',          value:rootDomVal },
    { key:'tld',          type:'tld',          icon:Globe,   label:'Block TLD',                  value:tldVal },
    { key:'helo_domain',  type:'helo_domain',  icon:Server,  label:'Block HELO Domain',          value:row.helo_name },
    { key:'ip',           type:'ip',           icon:Server,  label:'Block IP',                   value:row.sender_ip },
  ].filter(i => i.value);

  // Batch existence check on open — one round trip instead of one per item.
  useEffect(() => {
    if (items.length === 0) return;
    api.post('/blocklists/lookup', {
      checks: items.map(i => ({ type: i.type, value: i.value })),
    }).then(r => {
      const next = {};
      r.data.forEach((res, idx) => { next[items[idx].key] = res.match || null; });
      setMatches(next);
    }).catch(() => {
      const next = {};
      items.forEach(i => { next[i.key] = null; });
      setMatches(next);
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [row.id]);

  const block = async (key, type, value, label) => {
    if (!value || matches[key]) return;
    setBusy(b => ({...b, [key]: true}));
    try {
      const r = await api.post('/blocklists', {
        list_type: type, value, action: 'block',
        comment: `Blocked from mail log — ${label}`, enabled: true,
      });
      setMatches(m => ({...m, [key]: { id: r.data.id, action: 'block' }}));
      onBlocked(type, value);
    } catch(e) { alert(`Failed to block: ${e.response?.data?.error || e.message}`); }
    setBusy(b => ({...b, [key]: false}));
  };

  const deleteMatch = async (key, type, value) => {
    const match = matches[key];
    if (!match) return;
    setBusy(b => ({...b, [key]: true}));
    try {
      await api.delete(`/blocklists/${match.id}`);
      setMatches(m => ({...m, [key]: null}));
      setOpenSub(null);
      onUnblocked(type, value);
    } catch(e) { alert(`Failed to delete: ${e.response?.data?.error || e.message}`); }
    setBusy(b => ({...b, [key]: false}));
  };

  const viewRule = match => {
    onClose();
    navigate(`/settings?tab=blocklists&highlight=${match.id}`);
  };

  return (
    <div ref={ref}
      style={{position:'absolute',right:0,top:'100%',zIndex:50,width:'240px',
        background:'#111827',border:'1px solid #374151',borderRadius:'12px',
        boxShadow:'0 20px 40px rgba(0,0,0,0.6)',overflow:'hidden'}}
      onClick={e => e.stopPropagation()}>
      <p style={{padding:'8px 12px',fontSize:'0.7rem',color:'#6b7280',
        fontWeight:600,textTransform:'uppercase',letterSpacing:'0.05em',
        borderBottom:'1px solid #1f2937'}}>Quick Block</p>
      {items.map(({ key, type, icon:Icon, label, value }) => {
        const match = matches[key];
        const isMatched = !!match;
        return (
          <div key={key}>
            <button
              onClick={() => isMatched ? setOpenSub(o => o===key ? null : key) : block(key, type, value, label)}
              disabled={!!busy[key]}
              style={{width:'100%',display:'flex',alignItems:'center',gap:'10px',
                padding:'10px 12px',textAlign:'left',opacity:busy[key]?0.5:1,
                background:openSub===key?'#1f2937':'transparent',border:'none',cursor:'pointer',color:'inherit'}}
              onMouseEnter={e => e.currentTarget.style.background='#1f2937'}
              onMouseLeave={e => { if (openSub!==key) e.currentTarget.style.background='transparent'; }}>
              <div style={{padding:'6px',borderRadius:'6px',flexShrink:0,
                background:isMatched?'rgba(20,83,45,0.5)':'rgba(127,29,29,0.3)'}}>
                {isMatched
                  ? <Check size={13} style={{color:'#4ade80'}}/>
                  : <Icon  size={13} style={{color:'#f87171'}}/>}
              </div>
              <div style={{minWidth:0,flex:1}}>
                <p style={{fontSize:'0.875rem',fontWeight:500,color:'#e5e7eb',margin:0}}>
                  {isMatched && match.action
                    ? label.replace(/^Block\b/, match.action.charAt(0).toUpperCase() + match.action.slice(1))
                    : label}
                </p>
                <p style={{fontSize:'0.7rem',color:'#6b7280',margin:0,
                  overflow:'hidden',textOverflow:'ellipsis',whiteSpace:'nowrap'}}>{value}</p>
              </div>
              {isMatched && (
                <ChevronDown size={12} style={{color:'#6b7280',flexShrink:0,
                  transform:openSub===key?'rotate(180deg)':'none',transition:'transform 0.15s'}}/>
              )}
            </button>
            {openSub===key && (
              <div style={{display:'flex',gap:'6px',padding:'0 12px 10px 44px',background:'#1f2937'}}
                onClick={e => e.stopPropagation()}>
                <button onClick={() => viewRule(match)}
                  style={{flex:1,display:'flex',alignItems:'center',justifyContent:'center',gap:'5px',
                    padding:'6px',borderRadius:'6px',fontSize:'0.7rem',fontWeight:500,
                    background:'rgba(99,102,241,0.15)',border:'1px solid rgba(99,102,241,0.4)',
                    color:'#a5b4fc',cursor:'pointer'}}>
                  <ExternalLink size={11}/>View rule
                </button>
                <button onClick={() => deleteMatch(key, type, value)} disabled={!!busy[key]}
                  style={{flex:1,display:'flex',alignItems:'center',justifyContent:'center',gap:'5px',
                    padding:'6px',borderRadius:'6px',fontSize:'0.7rem',fontWeight:500,opacity:busy[key]?0.5:1,
                    background:'rgba(127,29,29,0.3)',border:'1px solid rgba(239,68,68,0.4)',
                    color:'#fca5a5',cursor:'pointer'}}>
                  <Trash2 size={11}/>{busy[key] ? '…' : 'Delete'}
                </button>
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}

// ── Sender cell with truncated local-part and highlighted domain ──────────────
function SenderCell({ sender, isGreylisted, isBlocked, reason, onGoToRule }) {
  if (!sender) return <span style={{color:'#6b7280'}}>—</span>;
  const atIdx = sender.lastIndexOf('@');
  const hasAt  = atIdx >= 0;
  const local  = hasAt ? sender.slice(0, atIdx) : sender;
  const domain = hasAt ? sender.slice(atIdx + 1) : null;
  const MAX = 16;
  const displayLocal = hasAt && local.length > MAX ? local.slice(0, MAX) + '…' : local;
  return (
    <div style={{display:'flex',alignItems:'center',minWidth:0}}>
      {isGreylisted && <GreylistIcon/>}
      {isBlocked && (
        <span onClick={e => e.stopPropagation()}>
          <BlockedIcon reason={reason} onClick={onGoToRule}/>
        </span>
      )}
      <div style={{display:'flex',alignItems:'baseline',minWidth:0,overflow:'hidden'}}>
        <span style={{color:'#9ca3af',overflow:'hidden',textOverflow:'ellipsis',whiteSpace:'nowrap',
          flexShrink:1,minWidth:0}}>{displayLocal}</span>
        {domain && (
          <span style={{flexShrink:0,whiteSpace:'nowrap'}}>
            <span style={{color:'#6b7280'}}>@</span>
            <span style={{color:'#818cf8',fontWeight:500}}>{domain}</span>
          </span>
        )}
      </div>
    </div>
  );
}

// ── Action filter modal ───────────────────────────────────────────────────────
function ActionFilterModal({ selected, onChange, onClose }) {
  const ref = useRef(null);
  const [local, setLocal] = useState(new Set(selected));

  useEffect(() => {
    const handler = e => {
      if (ref.current && !ref.current.contains(e.target)) onClose();
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [onClose]);

  const toggle = a => setLocal(prev => {
    const next = new Set(prev);
    next.has(a) ? next.delete(a) : next.add(a);
    return next;
  });

  const apply = () => { onChange(local); onClose(); };

  const ACTION_COLORS = {
    allow:      '#4ade80',
    block:      '#f87171',
    quarantine: '#fb923c',
    flag:       '#facc15',
    greylist:   '#60a5fa',
  };

  return (
    <div style={{position:'fixed',inset:0,background:'rgba(0,0,0,0.6)',zIndex:200,
      display:'flex',alignItems:'center',justifyContent:'center'}}>
      <div ref={ref}
        style={{background:'#111827',border:'1px solid #374151',borderRadius:'16px',
          padding:'24px',width:'280px',boxShadow:'0 25px 50px rgba(0,0,0,0.7)'}}>
        <p style={{fontSize:'0.75rem',fontWeight:600,textTransform:'uppercase',
          letterSpacing:'0.05em',color:'#6b7280',marginBottom:'16px'}}>Filter by Action</p>

        <div style={{display:'flex',flexDirection:'column',gap:'10px',marginBottom:'20px'}}>
          {ALL_ACTIONS.map(a => (
            <label key={a} style={{display:'flex',alignItems:'center',gap:'12px',cursor:'pointer'}}>
              <span style={{position:'relative',width:'18px',height:'18px',flexShrink:0}}>
                <input type="checkbox" checked={local.has(a)} onChange={() => toggle(a)}
                  style={{position:'absolute',opacity:0,width:'18px',height:'18px',cursor:'pointer',margin:0}}/>
                <span style={{
                  display:'flex',alignItems:'center',justifyContent:'center',
                  width:'18px',height:'18px',borderRadius:'5px',
                  background: local.has(a) ? 'rgba(99,102,241,0.25)' : 'transparent',
                  border: `1.5px solid ${local.has(a) ? '#818cf8' : '#4b5563'}`,
                  transition:'all 0.15s',
                }}>
                  {local.has(a) && <Check size={11} style={{color:'#818cf8'}}/>}
                </span>
              </span>
              <span style={{display:'flex',alignItems:'center',gap:'8px',flex:1}}>
                <span style={{width:'8px',height:'8px',borderRadius:'50%',flexShrink:0,
                  background:ACTION_COLORS[a]||'#9ca3af'}}/>
                <span style={{fontSize:'0.875rem',color:'#e5e7eb',textTransform:'capitalize'}}>{a}</span>
              </span>
            </label>
          ))}
        </div>

        <div style={{display:'flex',gap:'8px'}}>
          <button onClick={() => setLocal(new Set(ALL_ACTIONS))}
            style={{flex:1,padding:'7px',borderRadius:'8px',fontSize:'0.75rem',
              background:'transparent',border:'1px solid #374151',color:'#9ca3af',cursor:'pointer'}}
            onMouseEnter={e => e.currentTarget.style.borderColor='#4b5563'}
            onMouseLeave={e => e.currentTarget.style.borderColor='#374151'}>
            All
          </button>
          <button onClick={() => setLocal(new Set())}
            style={{flex:1,padding:'7px',borderRadius:'8px',fontSize:'0.75rem',
              background:'transparent',border:'1px solid #374151',color:'#9ca3af',cursor:'pointer'}}
            onMouseEnter={e => e.currentTarget.style.borderColor='#4b5563'}
            onMouseLeave={e => e.currentTarget.style.borderColor='#374151'}>
            None
          </button>
          <button onClick={apply}
            style={{flex:1,padding:'7px',borderRadius:'8px',fontSize:'0.75rem',fontWeight:600,
              background:'rgba(99,102,241,0.2)',border:'1px solid rgba(99,102,241,0.5)',
              color:'#a5b4fc',cursor:'pointer'}}
            onMouseEnter={e => e.currentTarget.style.background='rgba(99,102,241,0.3)'}
            onMouseLeave={e => e.currentTarget.style.background='rgba(99,102,241,0.2)'}>
            Apply
          </button>
        </div>
      </div>
    </div>
  );
}

// ── Main Events page ──────────────────────────────────────────────────────────
export default function Events() {
  const [rows,         setRows]         = useState([]);
  const [total,        setTotal]        = useState(0);
  const [page,         setPage]         = useState(1);
  const [actionFilter, setActionFilter] = useState(new Set(ALL_ACTIONS));
  const [filterOpen,   setFilterOpen]   = useState(false);
  const [search,       setSearch]       = useState('');
  const [selected,     setSelected]     = useState(null);
  const [newCount,     setNewCount]     = useState(0);
  const [menuRow,      setMenuRow]      = useState(null);
  const [toast,        setToast]        = useState(null);
  const navigate = useNavigate();
  const limit = 50;

  const { flashTitle, flashPage, stopFlash } = useNotification();

  const load = useCallback((resetNew = false) => {
    const isAll = actionFilter.size === ALL_ACTIONS.length;
    const actionParam = isAll ? undefined : [...actionFilter].join(',');
    api.get('/events', { params:{ page, limit, action: actionParam, search } })
      .then(r => {
        setRows(r.data.rows);
        setTotal(r.data.total);
        if (resetNew) { setNewCount(0); stopFlash(); }
      });
  }, [page, actionFilter, search, stopFlash]);

  useEffect(() => { load(); }, [load]);

  const handleWs = useCallback((msg) => {
    if (msg.type === 'mail_event' && page === 1) {
      setNewCount(n => n + 1);
      flashTitle('● New mail event — MailGuard');
      if (document.hasFocus()) flashPage('#6366f1', 400);
    }
  }, [page, flashTitle, flashPage]);
  useWebSocket(handleWs);

  const refresh = () => load(true);
  const pages   = Math.ceil(total / limit);

  const showToast = msg => { setToast(msg); setTimeout(() => setToast(null), 3500); };
  const handleBlocked = (type, value) =>
    showToast(`Blocked ${type==='ip'?'IP':type==='domain'?'domain':'sender'}: ${value}`);
  const handleUnblocked = (type, value) =>
    showToast(`Unblocked ${type==='ip'?'IP':type==='domain'?'domain':'sender'}: ${value}`);

  const isBlocked    = r => r.action === 'block' || r.action === 'quarantine';
  const isGreylisted = r => r.action === 'greylist';
  const goToRule     = () => navigate('/settings?tab=blocklists');

  return (
    <div className="space-y-4">
      <h1 className="text-2xl font-bold">Mail Log</h1>

      <div style={{display:'flex',flexWrap:'wrap',gap:'12px',alignItems:'center'}}>
        <div style={{position:'relative',flex:'1 1 400px'}}>
          <Search size={15} style={{position:'absolute',left:'12px',top:'10px',color:'#6b7280'}}/>
          <input className="input" style={{paddingLeft:'36px',width:'100%'}}
            placeholder="Search sender, subject, IP, domain…"
            value={search} onChange={e => { setSearch(e.target.value); setPage(1); }}/>
        </div>
        <button className="btn-ghost flex items-center gap-2" style={{flexShrink:0}} onClick={refresh}>
          <RefreshCw size={14}/>Refresh
        </button>
        <span style={{marginLeft:'auto',fontSize:'0.875rem',color:'#6b7280',flexShrink:0}}>
          {total.toLocaleString()} events
        </span>
      </div>

      {newCount > 0 && (
        <button onClick={refresh}
          className="w-full text-center py-2 bg-indigo-900 border border-indigo-700 rounded-lg text-sm text-indigo-200 hover:bg-indigo-800 transition-colors">
          ↑ {newCount} new event{newCount!==1?'s':''} — click to refresh
        </button>
      )}

      <div className="overflow-x-auto rounded-xl border border-gray-800">
        <table className="w-full text-sm">
          <thead className="bg-gray-900 text-gray-400 text-xs uppercase">
            <tr>
              {[
                {h:'Time',    px:'px-3'},
                {h:'Sender',  px:'px-3'},
                {h:'From',    px:'px-3'},
                {h:'To',      px:'px-3'},
                {h:'Subject', px:'px-3'},
                {h:'IP',      px:'px-3'},
                {h:'Country', px:'px-3'},
                {h:'action_filter', px:'px-2'},
                {h:'Spam',    px:'px-1'},
                {h:'SPF',     px:'px-1'},
                {h:'DKIM',    px:'px-1'},
                {h:'DMARC',   px:'px-1'},
                {h:'',        px:'px-1'},
              ].map(({h,px}) => {
                if (h === 'action_filter') {
                  const isFiltered = actionFilter.size < ALL_ACTIONS.length;
                  return (
                    <th key="action" className={`${px} py-3 text-left font-medium`}>
                      <button
                        onClick={() => setFilterOpen(true)}
                        style={{display:'inline-flex',alignItems:'center',gap:'5px',
                          background:'transparent',border:'none',cursor:'pointer',padding:0,
                          color: isFiltered ? '#818cf8' : '#9ca3af',
                          fontWeight:600,fontSize:'0.75rem',textTransform:'uppercase',
                          letterSpacing:'0.05em'}}>
                        Action
                        <Filter size={11} style={{
                          color: isFiltered ? '#818cf8' : '#6b7280',
                          fill: isFiltered ? 'rgba(99,102,241,0.3)' : 'none',
                        }}/>
                        {isFiltered && (
                          <span style={{fontSize:'0.6rem',background:'rgba(99,102,241,0.25)',
                            color:'#818cf8',borderRadius:'999px',padding:'1px 5px',
                            fontWeight:700,lineHeight:'1.4'}}>
                            {actionFilter.size}
                          </span>
                        )}
                      </button>
                    </th>
                  );
                }
                return <th key={h} className={`${px} py-3 text-left font-medium`}>{h}</th>;
              })}
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-800">
            {rows.map(r => (
              <tr key={r.id}
                className="hover:bg-gray-900 transition-colors"
                style={{
                  position: 'relative',
                  background: hasAuthFailure(r) ? 'rgba(239,68,68,0.04)' : undefined,
                  borderLeft: hasAuthFailure(r) ? '2px solid rgba(239,68,68,0.35)' : '2px solid transparent',
                }}
                onClick={() => { setMenuRow(null); setSelected(r.id); }}>

                <td className="px-3 py-2 text-gray-400 whitespace-nowrap text-xs">
                  {fmt(r.received_at)}
                </td>

                <td className="px-3 py-2"
                  style={{maxWidth:'220px',overflow:'hidden',whiteSpace:'nowrap'}}>
                  <SenderCell
                    sender={r.sender}
                    isGreylisted={isGreylisted(r)}
                    isBlocked={isBlocked(r)}
                    reason={r.reason}
                    onGoToRule={goToRule}
                  />
                </td>

                <td className="px-3 py-2"
                  style={{maxWidth:'200px',overflow:'hidden',whiteSpace:'nowrap'}}>
                  <SenderCell sender={r.from_header}/>
                </td>

                <td className="px-3 py-2 text-gray-400"
                  style={{maxWidth:'120px',overflow:'hidden',textOverflow:'ellipsis',whiteSpace:'nowrap'}}>
                  {r.recipient}
                </td>
                <td className="px-3 py-2"
                  style={{maxWidth:'160px',overflow:'hidden',textOverflow:'ellipsis',whiteSpace:'nowrap'}}>
                  {r.subject}
                </td>
                <td className="px-3 py-2 text-gray-400 font-mono text-xs">{r.sender_ip}</td>
                <td className="px-3 py-2 text-gray-400 text-xs">
                  {r.country_code ? `${r.country_code} ${r.country_name||''}` : '—'}
                </td>
                <td className="px-2 py-2">{badge(r.action)}</td>
                <td className="px-1 py-2"><SpamScore val={r.spam_score}/></td>
                <td className="px-1 py-2"><AuthBadge val={r.spf_result}/></td>
                <td className="px-1 py-2"><AuthBadge val={r.dkim_result}/></td>
                <td className="px-1 py-2"><AuthBadge val={r.dmarc_result}/></td>

                <td className="px-2 py-2" style={{position:'relative',whiteSpace:'nowrap'}}
                  onClick={e => e.stopPropagation()}>
                  <button
                    onClick={() => setMenuRow(menuRow===r.id ? null : r.id)}
                    style={{display:'inline-flex',alignItems:'center',gap:'4px',
                      padding:'4px 8px',borderRadius:'6px',fontSize:'0.75rem',fontWeight:500,
                      color:menuRow===r.id?'#a5b4fc':'#6b7280',
                      background:menuRow===r.id?'rgba(99,102,241,0.15)':'transparent',
                      border:'1px solid',
                      borderColor:menuRow===r.id?'rgba(99,102,241,0.4)':'transparent',
                      cursor:'pointer'}}
                    onMouseEnter={e => {
                      e.currentTarget.style.background='rgba(99,102,241,0.1)';
                      e.currentTarget.style.color='#a5b4fc';
                      e.currentTarget.style.borderColor='rgba(99,102,241,0.3)';
                    }}
                    onMouseLeave={e => {
                      if(menuRow!==r.id){
                        e.currentTarget.style.background='transparent';
                        e.currentTarget.style.color='#6b7280';
                        e.currentTarget.style.borderColor='transparent';
                      }
                    }}>
                    Actions <ChevronDown size={11}/>
                  </button>
                  {menuRow===r.id && (
                    <RowMenu row={r} onClose={() => setMenuRow(null)}
                      onBlocked={handleBlocked} onUnblocked={handleUnblocked}/>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <div className="flex items-center justify-end gap-3 text-sm">
        <button className="btn-ghost flex items-center gap-1"
          onClick={() => setPage(p => Math.max(1,p-1))} disabled={page===1}>
          <ChevronLeft size={15}/>Prev
        </button>
        <span className="text-gray-400">Page {page} / {pages||1}</span>
        <button className="btn-ghost flex items-center gap-1"
          onClick={() => setPage(p => Math.min(pages,p+1))} disabled={page>=pages}>
          Next<ChevronRight size={15}/>
        </button>
      </div>

      {selected && <EventDetail id={selected} onClose={() => setSelected(null)}/>}

      {filterOpen && (
        <ActionFilterModal
          selected={actionFilter}
          onChange={s => { setActionFilter(s); setPage(1); }}
          onClose={() => setFilterOpen(false)}
        />
      )}

      {toast && (
        <div style={{position:'fixed',bottom:'24px',right:'24px',zIndex:50,
          background:'#052e16',border:'1px solid #166534',color:'#bbf7d0',
          padding:'12px 16px',borderRadius:'12px',fontSize:'0.875rem',
          boxShadow:'0 10px 25px rgba(0,0,0,0.5)'}}>
          ✓ {toast}
        </div>
      )}
    </div>
  );
}