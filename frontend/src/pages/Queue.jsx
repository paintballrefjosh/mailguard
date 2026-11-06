import React, { useEffect, useState, useCallback } from 'react';
import { Mail, RefreshCw, Play, Trash2, AlertTriangle, CheckCircle, Clock } from 'lucide-react';
import api from '../utils/api';
import useWebSocket from '../utils/useWebSocket';

const STATUS_STYLE = {
  active:   { background:'rgba(20,83,45,0.3)',    color:'#86efac', label:'Active'   },
  deferred: { background:'rgba(120,53,15,0.3)',   color:'#fcd34d', label:'Deferred' },
  hold:     { background:'rgba(88,28,135,0.3)',   color:'#d8b4fe', label:'Hold'     },
};

const fmt = n => n ? `${(n/1024).toFixed(1)} KB` : '—';

function StatBadge({ label, value, color }) {
  return (
    <div className="card" style={{textAlign:'center',padding:'12px 20px'}}>
      <p style={{fontSize:'1.75rem',fontWeight:700,color,margin:0}}>{value}</p>
      <p style={{fontSize:'0.75rem',color:'#6b7280',margin:'4px 0 0'}}>{label}</p>
    </div>
  );
}

export default function Queue() {
  const [data,     setData]     = useState({ stats:{}, items:[] });
  const [loading,  setLoading]  = useState(false);
  const [flushing, setFlushing] = useState(false);
  const [selected, setSelected] = useState(null);
  const [toast,    setToast]    = useState(null);
  const [filter,   setFilter]   = useState('all');

  const load = useCallback(() => {
    setLoading(true);
    api.get('/queue').then(r => setData(r.data)).catch(()=>{}).finally(()=>setLoading(false));
  }, []);

  useEffect(() => { load(); }, [load]);

  // Auto-refresh when new mail events arrive
  const handleWs = useCallback(msg => {
    if (msg.type === 'mail_event') load();
  }, [load]);
  useWebSocket(handleWs);

  const notify = (msg, ok = true) => {
    setToast({ msg, ok });
    setTimeout(() => setToast(null), 3500);
  };

  const flush = async () => {
    setFlushing(true);
    try {
      await api.post('/queue/flush');
      notify('Queue flush triggered — messages will retry delivery.');
      setTimeout(load, 2000);
    } catch { notify('Flush failed.', false); }
    setFlushing(false);
  };

  const retry = async (id, e) => {
    e.stopPropagation();
    await api.post(`/queue/${id}/retry`).catch(()=>{});
    notify(`Message ${id} queued for immediate retry.`);
    setTimeout(load, 1500);
  };

  const remove = async (id, e) => {
    e.stopPropagation();
    if (!confirm(`Delete message ${id} from queue?`)) return;
    await api.delete(`/queue/${id}`).catch(()=>{});
    notify(`Message ${id} deleted.`);
    setSelected(null);
    load();
  };

  const deleteAll = async () => {
    if (!confirm('Delete ALL deferred messages? This cannot be undone.')) return;
    await api.delete('/queue').catch(()=>{});
    notify('All deferred messages deleted.');
    load();
  };

  const visible = data.items.filter(i => filter === 'all' || i.status === filter);
  const { stats } = data;

  return (
    <div className="space-y-5">
      {/* Header */}
      <div style={{display:'flex',alignItems:'center',justifyContent:'space-between',flexWrap:'wrap',gap:'12px'}}>
        <h1 className="text-2xl font-bold" style={{display:'flex',alignItems:'center',gap:'8px'}}>
          <Mail size={22} style={{color:'#818cf8'}}/>Mail Queue
          <span style={{fontSize:'1rem',fontWeight:400,color:'#6b7280'}}>
            ({stats.total ?? 0} messages)
          </span>
        </h1>
        <div style={{display:'flex',gap:'8px',flexWrap:'wrap'}}>
          <button onClick={load} className="btn-ghost flex items-center gap-2 text-sm">
            <RefreshCw size={14} style={{animation:loading?'spin 1s linear infinite':''}}/>
            Refresh
          </button>
          <button onClick={flush} disabled={flushing || !stats.total}
            style={{display:'inline-flex',alignItems:'center',gap:'6px',padding:'6px 14px',
              borderRadius:'8px',fontSize:'0.875rem',fontWeight:500,cursor:'pointer',border:'none',
              background:'rgba(99,102,241,0.2)',color:'#a5b4fc',
              opacity:(flushing||!stats.total)?0.5:1}}>
            <Play size={14}/>{flushing ? 'Flushing…' : 'Flush Queue'}
          </button>
          {stats.deferred > 0 && (
            <button onClick={deleteAll}
              style={{display:'inline-flex',alignItems:'center',gap:'6px',padding:'6px 14px',
                borderRadius:'8px',fontSize:'0.875rem',fontWeight:500,cursor:'pointer',border:'none',
                background:'rgba(127,29,29,0.3)',color:'#fca5a5'}}>
              <Trash2 size={14}/>Delete All Deferred
            </button>
          )}
        </div>
      </div>

      {/* Stats */}
      <div style={{display:'grid',gridTemplateColumns:'repeat(4,1fr)',gap:'12px'}}>
        <StatBadge label="Total"    value={stats.total    ?? 0} color="#e5e7eb"/>
        <StatBadge label="Active"   value={stats.active   ?? 0} color="#86efac"/>
        <StatBadge label="Deferred" value={stats.deferred ?? 0} color="#fcd34d"/>
        <StatBadge label="On Hold"  value={stats.hold     ?? 0} color="#d8b4fe"/>
      </div>

      {/* Filter tabs */}
      <div style={{display:'flex',gap:'6px'}}>
        {['all','active','deferred','hold'].map(f => (
          <button key={f} onClick={() => setFilter(f)}
            style={{padding:'4px 14px',borderRadius:'6px',fontSize:'0.75rem',fontWeight:500,
              cursor:'pointer',border:'none',textTransform:'capitalize',
              background: filter===f ? '#4f46e5' : '#1f2937',
              color: filter===f ? 'white' : '#9ca3af'}}>
            {f}
          </button>
        ))}
      </div>

      {/* Empty state */}
      {visible.length === 0 && !loading && (
        <div className="card" style={{textAlign:'center',padding:'56px 0'}}>
          <CheckCircle size={36} style={{margin:'0 auto 12px',color:'#4ade80',opacity:0.6}}/>
          <p style={{fontWeight:500,color:'#e5e7eb',margin:0}}>Queue is empty</p>
          <p style={{fontSize:'0.875rem',color:'#6b7280',margin:'6px 0 0'}}>
            All messages have been delivered.
          </p>
        </div>
      )}

      {/* Queue items */}
      <div className="space-y-2">
        {visible.map(item => {
          const st = STATUS_STYLE[item.status] || STATUS_STYLE.deferred;
          const isOpen = selected === item.id;
          return (
            <div key={item.id}
              className="card"
              style={{border: isOpen ? '1px solid #4f46e5' : '1px solid #1f2937',
                cursor:'pointer',transition:'border-color 0.15s'}}
              onClick={() => setSelected(isOpen ? null : item.id)}>

              {/* Summary row */}
              <div style={{display:'flex',alignItems:'flex-start',gap:'12px'}}>
                <span style={{padding:'2px 10px',borderRadius:'20px',fontSize:'0.7rem',
                  fontWeight:600,flexShrink:0,whiteSpace:'nowrap',...st}}>
                  {st.label}
                </span>
                <div style={{minWidth:0,flex:1}}>
                  <div style={{display:'flex',alignItems:'center',gap:'8px',flexWrap:'wrap'}}>
                    <span style={{fontFamily:'monospace',fontSize:'0.7rem',color:'#818cf8',flexShrink:0}}>
                      {item.id}
                    </span>
                    <span style={{fontSize:'0.875rem',color:'#e5e7eb',overflow:'hidden',
                      textOverflow:'ellipsis',whiteSpace:'nowrap'}}>
                      {item.sender || '(unknown sender)'}
                    </span>
                    {item.recipients?.[0] && (
                      <span style={{fontSize:'0.75rem',color:'#6b7280'}}>→ {item.recipients[0]}</span>
                    )}
                  </div>
                  {item.reason && (
                    <p style={{fontSize:'0.7rem',color:'#fbbf24',margin:'4px 0 0',
                      display:'flex',alignItems:'center',gap:'4px'}}>
                      <AlertTriangle size={10}/>
                      {item.reason.length > 120 ? item.reason.slice(0,120)+'…' : item.reason}
                    </p>
                  )}
                </div>
                <div style={{fontSize:'0.7rem',color:'#6b7280',flexShrink:0,textAlign:'right'}}>
                  <div style={{display:'flex',alignItems:'center',gap:'4px',justifyContent:'flex-end'}}>
                    <Clock size={10}/>{item.date}
                  </div>
                  <div style={{marginTop:'2px'}}>{fmt(item.size)}</div>
                </div>
              </div>

              {/* Expanded detail + actions */}
              {isOpen && (
                <div style={{marginTop:'12px',paddingTop:'12px',borderTop:'1px solid #1f2937'}}
                  onClick={e => e.stopPropagation()}>

                  {/* Recipients list */}
                  {item.recipients?.length > 0 && (
                    <div style={{marginBottom:'10px'}}>
                      <p style={{fontSize:'0.7rem',color:'#6b7280',textTransform:'uppercase',
                        letterSpacing:'0.05em',margin:'0 0 4px'}}>Recipients</p>
                      {item.recipients.map((r,i) => (
                        <p key={i} style={{fontSize:'0.8rem',color:'#d1d5db',margin:'2px 0',
                          fontFamily:'monospace'}}>{r}</p>
                      ))}
                    </div>
                  )}

                  {/* Full reason */}
                  {item.reason && (
                    <div style={{marginBottom:'10px',padding:'8px 12px',borderRadius:'6px',
                      background:'rgba(120,53,15,0.2)',border:'1px solid rgba(120,53,15,0.3)'}}>
                      <p style={{fontSize:'0.7rem',color:'#6b7280',textTransform:'uppercase',
                        letterSpacing:'0.05em',margin:'0 0 4px'}}>Delivery error</p>
                      <p style={{fontSize:'0.75rem',color:'#fcd34d',margin:0,
                        fontFamily:'monospace',wordBreak:'break-all'}}>{item.reason}</p>
                    </div>
                  )}

                  {/* Action buttons */}
                  <div style={{display:'flex',gap:'8px',flexWrap:'wrap'}}>
                    <button onClick={e => retry(item.id, e)}
                      style={{display:'inline-flex',alignItems:'center',gap:'6px',
                        padding:'6px 12px',borderRadius:'8px',fontSize:'0.75rem',
                        fontWeight:500,cursor:'pointer',border:'none',
                        background:'rgba(20,83,45,0.4)',color:'#86efac'}}>
                      <Play size={13}/>Retry Now
                    </button>
                    <button onClick={e => remove(item.id, e)}
                      style={{display:'inline-flex',alignItems:'center',gap:'6px',
                        padding:'6px 12px',borderRadius:'8px',fontSize:'0.75rem',
                        fontWeight:500,cursor:'pointer',border:'none',
                        background:'rgba(127,29,29,0.4)',color:'#fca5a5'}}>
                      <Trash2 size={13}/>Delete
                    </button>
                  </div>
                </div>
              )}
            </div>
          );
        })}
      </div>

      {/* Toast */}
      {toast && (
        <div style={{position:'fixed',bottom:'24px',right:'24px',zIndex:50,
          background: toast.ok ? '#052e16' : '#450a0a',
          border: `1px solid ${toast.ok ? '#166534' : '#7f1d1d'}`,
          color: toast.ok ? '#bbf7d0' : '#fca5a5',
          padding:'12px 16px',borderRadius:'12px',fontSize:'0.875rem',
          boxShadow:'0 10px 25px rgba(0,0,0,0.5)'}}>
          {toast.ok ? '✓' : '✗'} {toast.msg}
        </div>
      )}
    </div>
  );
}