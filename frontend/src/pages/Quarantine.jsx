import React, { useEffect, useState, useCallback, useRef } from 'react';
import { Archive, RefreshCw, Play, Trash2, Download,
         Shield, UserCheck, AlertTriangle, ThumbsDown, ThumbsUp,
         Brain, Search, X, SlidersHorizontal, BookOpen } from 'lucide-react';
import api from '../utils/api';
import useWebSocket from '../utils/useWebSocket';

const fmt     = n => n ? `${(n/1024).toFixed(1)} KB` : '—';
const recColor = r => r==='release'?'#4ade80':r==='delete'?'#f87171':'#fbbf24';

function ActionBtn({ icon: Icon, label, color, onClick, disabled }) {
  return (
    <button onClick={onClick} disabled={disabled}
      style={{display:'inline-flex',alignItems:'center',gap:'6px',padding:'6px 12px',
        borderRadius:'8px',fontSize:'0.75rem',fontWeight:500,
        cursor:disabled?'not-allowed':'pointer',opacity:disabled?0.4:1,border:'none',...color}}>
      <Icon size={13}/>{label}
    </button>
  );
}

function BayesStats() {
  const [stats, setStats] = useState(null);
  useEffect(() => { api.get('/bayes/stats').then(r => setStats(r.data)).catch(()=>{}); }, []);
  if (!stats) return null;
  const spamCount = stats.training_counts?.find(t => t.train_type==='spam')?.cnt || 0;
  const hamCount  = stats.training_counts?.find(t => t.train_type==='ham')?.cnt  || 0;
  return (
    <div className="card" style={{display:'flex',alignItems:'center',gap:'16px',flexWrap:'wrap'}}>
      <Brain size={18} style={{color:'#818cf8',flexShrink:0}}/>
      <div>
        <p style={{fontSize:'0.75rem',fontWeight:600,color:'#d1d5db',margin:0}}>Bayesian Filter</p>
        <p style={{fontSize:'0.7rem',color:'#6b7280',margin:'2px 0 0'}}>
          {spamCount} spam trained · {hamCount} ham trained
          {stats.stats?.['nspam'] && ` · ${stats.stats['nspam']} spam tokens`}
        </p>
      </div>
      <button onClick={() => api.post('/bayes/rebuild').then(()=>window.location.reload())}
        style={{marginLeft:'auto',padding:'4px 12px',borderRadius:'6px',fontSize:'0.75rem',
          background:'#1f2937',border:'1px solid #374151',color:'#9ca3af',cursor:'pointer'}}>
        Rebuild DB
      </button>
    </div>
  );
}

export default function Quarantine() {
  const [items,      setItems]      = useState([]);
  const [total,      setTotal]      = useState(0);
  const [loading,    setLoading]    = useState(false);
  const [selected,   setSelected]   = useState(null);
  const [scanning,   setScanning]   = useState({});
  const [scanResult, setScanResult] = useState({});
  const [training,   setTraining]   = useState({});
  const [toast,      setToast]      = useState(null);
  const [loadingSubjects, setLoadingSubjects] = useState(false);

  // Filter state
  const [search,     setSearch]     = useState('');
  const [minSize,    setMinSize]    = useState('');
  const [maxSize,    setMaxSize]    = useState('');
  const [dateFrom,   setDateFrom]   = useState('');
  const [dateTo,     setDateTo]     = useState('');
  const [showFilter, setShowFilter] = useState(false);

  const hasFilters = search || minSize || maxSize || dateFrom || dateTo;

  const load = useCallback((withSubjects = false) => {
    setLoading(true);
    const params = {};
    if (search)      params.search      = search;
    if (minSize)     params.minSize     = +minSize * 1024;
    if (maxSize)     params.maxSize     = +maxSize * 1024;
    if (dateFrom)    params.from        = dateFrom;
    if (dateTo)      params.to          = dateTo;
    if (withSubjects) params.withSubjects = 'true';

    api.get('/quarantine', { params })
      .then(r => { setItems(r.data.items); setTotal(r.data.total); })
      .catch(()=>{})
      .finally(()=>setLoading(false));
  }, [search, minSize, maxSize, dateFrom, dateTo]);

  useEffect(() => { load(); }, [load]);

  const loadSubjects = async () => {
    setLoadingSubjects(true);
    const params = { withSubjects: 'true' };
    if (search)   params.search  = search;
    if (minSize)  params.minSize = +minSize * 1024;
    if (maxSize)  params.maxSize = +maxSize * 1024;
    if (dateFrom) params.from    = dateFrom;
    if (dateTo)   params.to      = dateTo;
    try {
      const r = await api.get('/quarantine', { params });
      setItems(r.data.items);
      setTotal(r.data.total);
    } catch {}
    setLoadingSubjects(false);
  };

  // Update count via WebSocket when quarantine events arrive
  const handleWs = useCallback((msg) => {
    if (msg.type === 'mail_event' && msg.data?.action === 'quarantine') {
      load();
    }
  }, [load]);
  useWebSocket(handleWs);

  const clearFilters = () => {
    setSearch(''); setMinSize(''); setMaxSize('');
    setDateFrom(''); setDateTo('');
  };

  const notify = (msg, ok = true) => {
    setToast({ msg, ok });
    setTimeout(() => setToast(null), 4000);
  };

  const release = async id => {
    await api.post(`/quarantine/${id}/release`).catch(()=>{});
    notify(`Message ${id} released.`);
    load();
  };

  const remove = async id => {
    if (!confirm('Delete this message permanently?')) return;
    await api.delete(`/quarantine/${id}`).catch(()=>{});
    notify(`Message ${id} deleted.`);
    setSelected(null);
    load();
  };

  const rescan = async id => {
    setScanning(s => ({...s, [id]: true}));
    try {
      const r = await api.post(`/quarantine/${id}/rescan`);
      setScanResult(s => ({...s, [id]: r.data}));
    } catch { notify('Rescan failed.', false); }
    setScanning(s => ({...s, [id]: false}));
  };

  const whitelist = async id => {
    try {
      const r = await api.post(`/quarantine/${id}/whitelist`);
      notify(`${r.data.sender} added to allowlist.`);
    } catch { notify('Whitelist failed.', false); }
  };

  const trainBayes = async (id, type) => {
    const key = `${id}_${type}`;
    setTraining(t => ({...t, [key]: true}));
    try {
      await api.post('/bayes/train', { queue_id: id, train_type: type });
      notify(`Trained as ${type}. Bayesian filter updated.`);
    } catch(e) {
      notify(`Training failed: ${e.response?.data?.error || e.message}`, false);
    }
    setTraining(t => ({...t, [key]: false}));
  };

  const download = id => { window.open(`/api/quarantine/${id}/download`, '_blank'); };

  const subjectsLoaded = items.some(i => i.subject !== undefined);

  return (
    <div className="space-y-5">
      {/* Header */}
      <div style={{display:'flex',alignItems:'center',justifyContent:'space-between',flexWrap:'wrap',gap:'12px'}}>
        <h1 className="text-2xl font-bold" style={{display:'flex',alignItems:'center',gap:'8px'}}>
          <Archive size={22} style={{color:'#818cf8'}}/>Quarantine
          <span style={{fontSize:'1rem',fontWeight:400,color:'#6b7280'}}>
            ({hasFilters ? `${items.length} of ${total}` : `${total} held`})
          </span>
        </h1>
        <div style={{display:'flex',gap:'8px',flexWrap:'wrap'}}>
          {!subjectsLoaded && total > 0 && total <= 200 && (
            <button onClick={loadSubjects} disabled={loadingSubjects}
              style={{display:'inline-flex',alignItems:'center',gap:'6px',padding:'6px 12px',
                borderRadius:'8px',fontSize:'0.875rem',cursor:'pointer',border:'none',
                background:'rgba(99,102,241,0.15)',color:'#a5b4fc',
                opacity:loadingSubjects?0.6:1}}>
              <BookOpen size={14}/>{loadingSubjects?'Loading…':'Load Subjects'}
            </button>
          )}
          <button onClick={() => setShowFilter(f => !f)}
            style={{display:'inline-flex',alignItems:'center',gap:'6px',padding:'6px 12px',
              borderRadius:'8px',fontSize:'0.875rem',cursor:'pointer',border:'none',
              background:showFilter||hasFilters?'rgba(99,102,241,0.2)':'#1f2937',
              color:showFilter||hasFilters?'#a5b4fc':'#9ca3af'}}>
            <SlidersHorizontal size={14}/>Filters
            {hasFilters && (
              <span style={{background:'#6366f1',color:'white',borderRadius:'999px',
                padding:'0 5px',fontSize:'0.65rem',fontWeight:700}}>ON</span>
            )}
          </button>
          <button onClick={() => load()} className="btn-ghost flex items-center gap-2 text-sm">
            <RefreshCw size={14} style={{animation:loading?'spin 1s linear infinite':''}}/>Refresh
          </button>
        </div>
      </div>

      {/* Filter panel */}
      {showFilter && (
        <div className="card space-y-3">
          <div style={{display:'flex',alignItems:'center',justifyContent:'space-between'}}>
            <h3 style={{fontSize:'0.875rem',fontWeight:600,color:'#d1d5db',margin:0}}>Filters</h3>
            {hasFilters && (
              <button onClick={clearFilters}
                style={{fontSize:'0.75rem',color:'#6b7280',background:'none',border:'none',
                  cursor:'pointer',display:'flex',alignItems:'center',gap:'4px'}}>
                <X size={12}/>Clear all
              </button>
            )}
          </div>
          <div style={{display:'grid',gridTemplateColumns:'1fr 1fr',gap:'12px'}}>
            {/* Search */}
            <div style={{gridColumn:'1/-1'}}>
              <label style={{fontSize:'0.7rem',color:'#6b7280',display:'block',marginBottom:'4px'}}>
                Search sender / recipient / reason{subjectsLoaded?' / subject':''}
              </label>
              <div style={{position:'relative'}}>
                <Search size={13} style={{position:'absolute',left:'10px',top:'9px',color:'#6b7280'}}/>
                <input className="input" style={{paddingLeft:'30px'}}
                  placeholder="e.g. spam@example.com or bounce"
                  value={search} onChange={e => setSearch(e.target.value)}/>
              </div>
            </div>
            {/* Size */}
            <div>
              <label style={{fontSize:'0.7rem',color:'#6b7280',display:'block',marginBottom:'4px'}}>
                Min size (KB)
              </label>
              <input className="input" type="number" min="0" placeholder="0"
                value={minSize} onChange={e => setMinSize(e.target.value)}/>
            </div>
            <div>
              <label style={{fontSize:'0.7rem',color:'#6b7280',display:'block',marginBottom:'4px'}}>
                Max size (KB)
              </label>
              <input className="input" type="number" min="0" placeholder="∞"
                value={maxSize} onChange={e => setMaxSize(e.target.value)}/>
            </div>
            {/* Date range */}
            <div>
              <label style={{fontSize:'0.7rem',color:'#6b7280',display:'block',marginBottom:'4px'}}>
                From date
              </label>
              <input className="input" type="datetime-local"
                value={dateFrom} onChange={e => setDateFrom(e.target.value)}/>
            </div>
            <div>
              <label style={{fontSize:'0.7rem',color:'#6b7280',display:'block',marginBottom:'4px'}}>
                To date
              </label>
              <input className="input" type="datetime-local"
                value={dateTo} onChange={e => setDateTo(e.target.value)}/>
            </div>
          </div>
          {!subjectsLoaded && (
            <p style={{fontSize:'0.7rem',color:'#6b7280',margin:0}}>
              ℹ Click "Load Subjects" above to enable subject search.
            </p>
          )}
        </div>
      )}

      <BayesStats/>

      {items.length === 0 && !loading && (
        <div className="card" style={{textAlign:'center',padding:'56px 0',color:'#6b7280'}}>
          <Archive size={36} style={{margin:'0 auto 12px',opacity:0.25}}/>
          <p style={{fontWeight:500,margin:0}}>
            {hasFilters ? 'No messages match your filters.' : 'Quarantine is empty'}
          </p>
          {hasFilters && (
            <button onClick={clearFilters}
              style={{marginTop:'12px',padding:'6px 16px',borderRadius:'8px',
                fontSize:'0.875rem',background:'#1f2937',border:'1px solid #374151',
                color:'#9ca3af',cursor:'pointer'}}>
              Clear filters
            </button>
          )}
        </div>
      )}

      <div className="space-y-3">
        {items.map(item => (
          <div key={item.id} className="card"
            style={{border:selected===item.id?'1px solid #4f46e5':'1px solid #1f2937',
              cursor:'pointer',transition:'border-color 0.15s'}}
            onClick={() => setSelected(selected===item.id ? null : item.id)}>

            <div style={{display:'flex',alignItems:'flex-start',
              justifyContent:'space-between',gap:'12px'}}>
              <div style={{minWidth:0,flex:1}}>
                <div style={{display:'flex',alignItems:'center',gap:'8px',flexWrap:'wrap'}}>
                  <span style={{fontFamily:'monospace',fontSize:'0.7rem',
                    color:'#818cf8',flexShrink:0}}>{item.id}</span>
                  <span style={{fontSize:'0.875rem',color:'#e5e7eb',overflow:'hidden',
                    textOverflow:'ellipsis',whiteSpace:'nowrap'}}>
                    {item.sender || '(unknown sender)'}
                  </span>
                  {item.recipients?.[0] && (
                    <span style={{fontSize:'0.75rem',color:'#6b7280'}}>
                      → {item.recipients[0]}
                    </span>
                  )}
                </div>
                {item.subject && (
                  <p style={{fontSize:'0.8rem',color:'#d1d5db',margin:'3px 0 0',
                    overflow:'hidden',textOverflow:'ellipsis',whiteSpace:'nowrap'}}>
                    {item.subject}
                  </p>
                )}
                {item.reason && (
                  <p style={{fontSize:'0.75rem',color:'#fbbf24',margin:'4px 0 0',
                    display:'flex',alignItems:'center',gap:'4px'}}>
                    <AlertTriangle size={11}/>Hold reason: {item.reason}
                  </p>
                )}
                {scanResult[item.id] && (
                  <p style={{fontSize:'0.75rem',margin:'4px 0 0',fontWeight:500,
                    color:recColor(scanResult[item.id].recommendation)}}>
                    Scan: spam={scanResult[item.id].spam_score?.toFixed(1)??'—'}
                    {scanResult[item.id].virus && ` · virus=${scanResult[item.id].virus}`}
                    {' '}→ <strong>{scanResult[item.id].recommendation}</strong>
                  </p>
                )}
              </div>
              <div style={{fontSize:'0.75rem',color:'#6b7280',flexShrink:0,textAlign:'right'}}>
                <div>{item.date}</div>
                <div>{fmt(item.size)}</div>
              </div>
            </div>

            {selected === item.id && (
              <div style={{display:'flex',flexWrap:'wrap',gap:'8px',marginTop:'14px',
                paddingTop:'14px',borderTop:'1px solid #1f2937'}}
                onClick={e => e.stopPropagation()}>
                <ActionBtn icon={Play} label="Release"
                  color={{background:'rgba(20,83,45,0.4)',color:'#86efac'}}
                  onClick={() => release(item.id)}/>
                <ActionBtn icon={Trash2} label="Delete"
                  color={{background:'rgba(127,29,29,0.4)',color:'#fca5a5'}}
                  onClick={() => remove(item.id)}/>
                <ActionBtn icon={Shield}
                  label={scanning[item.id]?'Scanning…':'Re-scan'}
                  color={{background:'rgba(55,48,163,0.4)',color:'#a5b4fc'}}
                  onClick={() => rescan(item.id)} disabled={scanning[item.id]}/>
                <ActionBtn icon={Download} label="Download .eml"
                  color={{background:'#1f2937',color:'#9ca3af'}}
                  onClick={() => download(item.id)}/>
                <ActionBtn icon={UserCheck} label="Whitelist Sender"
                  color={{background:'rgba(120,53,15,0.4)',color:'#fcd34d'}}
                  onClick={() => whitelist(item.id)}/>
                <div style={{width:'100%',height:'1px',background:'#1f2937',margin:'4px 0'}}/>
                <span style={{fontSize:'0.7rem',color:'#6b7280',alignSelf:'center',
                  display:'flex',alignItems:'center',gap:'4px'}}>
                  <Brain size={12}/>Train Bayesian filter:
                </span>
                <ActionBtn icon={ThumbsDown}
                  label={training[`${item.id}_spam`]?'Training…':'Train as Spam'}
                  color={{background:'rgba(127,29,29,0.3)',color:'#fca5a5'}}
                  onClick={() => trainBayes(item.id,'spam')}
                  disabled={!!training[`${item.id}_spam`]}/>
                <ActionBtn icon={ThumbsUp}
                  label={training[`${item.id}_ham`]?'Training…':'Train as Ham'}
                  color={{background:'rgba(20,83,45,0.3)',color:'#86efac'}}
                  onClick={() => trainBayes(item.id,'ham')}
                  disabled={!!training[`${item.id}_ham`]}/>
              </div>
            )}
          </div>
        ))}
      </div>

      {toast && (
        <div style={{position:'fixed',bottom:'24px',right:'24px',zIndex:50,
          background:toast.ok?'#052e16':'#450a0a',
          border:`1px solid ${toast.ok?'#166534':'#7f1d1d'}`,
          color:toast.ok?'#bbf7d0':'#fca5a5',
          padding:'12px 16px',borderRadius:'12px',fontSize:'0.875rem',
          boxShadow:'0 10px 25px rgba(0,0,0,0.5)'}}>
          {toast.ok?'✓':'✗'} {toast.msg}
        </div>
      )}
    </div>
  );
}