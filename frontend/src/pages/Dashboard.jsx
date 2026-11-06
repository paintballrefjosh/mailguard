import React, { useEffect, useState, useCallback } from 'react';
import { LineChart, Line, BarChart, Bar, XAxis, YAxis, Tooltip,
         ResponsiveContainer, CartesianGrid, Legend } from 'recharts';
import { CheckCircle, XCircle, Flag, Archive, Bug,
         Lightbulb, TrendingUp, Globe, Clock, ShieldX, Server } from 'lucide-react';
import api from '../utils/api';
import useWebSocket from '../utils/useWebSocket';
import GeoMap from '../components/GeoMap';
import HealthWidget from '../components/HealthWidget';

const Stat = ({ label, value, icon: Icon, color }) => (
  <div className="card flex items-center gap-4">
    <div className={`p-3 rounded-lg ${color}`}><Icon size={22}/></div>
    <div>
      <p className="text-xs text-gray-400 uppercase tracking-wide">{label}</p>
      <p className="text-2xl font-bold">{value ?? '—'}</p>
    </div>
  </div>
);

const TYPE_ICON = {
  ip:          <Server  size={13} style={{color:'#f87171',flexShrink:0}}/>,
  domain:      <Globe   size={13} style={{color:'#fbbf24',flexShrink:0}}/>,
  helo_domain: <ShieldX size={13} style={{color:'#c084fc',flexShrink:0}}/>,
};

const TYPE_LABEL = {
  ip:          'IP',
  domain:      'Domain',
  helo_domain: 'HELO',
};

export default function Dashboard() {
  const [data,      setData]      = useState(null);
  const [liveCount, setLiveCount] = useState(0);
  const [blocking,  setBlocking]  = useState({});
  const [blocked,   setBlocked]   = useState({});
  const [toast,     setToast]     = useState(null);

  const load = () => api.get('/dashboard/stats').then(r => setData(r.data));
  useEffect(() => { load(); }, []);

  const handleWs = useCallback((msg) => {
    if (msg.type === 'mail_event') {
      setLiveCount(n => {
        const next = n + 1;
        if (next % 10 === 0) load();
        return next;
      });
    }
  }, []);
  useWebSocket(handleWs);

  const notify = (msg, ok = true) => {
    setToast({ msg, ok });
    setTimeout(() => setToast(null), 3500);
  };

  const blockSuggestion = async (s) => {
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
      notify(`Blocked ${TYPE_LABEL[s.type]}: ${s.value}`);
      // Refresh suggestions
      setTimeout(load, 500);
    } catch(e) {
      notify(e.response?.data?.error || e.message, false);
    }
    setBlocking(b => ({ ...b, [key]: false }));
  };

  if (!data) return <div className="text-gray-400 text-sm mt-10 text-center">Loading…</div>;
  const { totals: t, trend, topSenders, suggestions } = data;

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold">Dashboard
          <span className="text-gray-500 font-normal text-base ml-2">(last 24 h)</span>
        </h1>
        {liveCount > 0 && (
          <span className="text-xs bg-green-900 text-green-300 px-3 py-1 rounded-full">
            ● {liveCount} live event{liveCount!==1?'s':''} received
          </span>
        )}
      </div>

      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        <Stat label="Total"       value={t.total}       icon={TrendingUp}  color="bg-indigo-900 text-indigo-300"/>
        <Stat label="Allowed"     value={t.allowed}     icon={CheckCircle} color="bg-green-900 text-green-300"/>
        <Stat label="Blocked"     value={t.blocked}     icon={XCircle}     color="bg-red-900 text-red-300"/>
        <Stat label="Flagged"     value={t.flagged}     icon={Flag}        color="bg-yellow-900 text-yellow-300"/>
        <Stat label="Quarantined" value={t.quarantined} icon={Archive}     color="bg-purple-900 text-purple-300"/>
        <Stat label="Greylisted"  value={t.greylisted}  icon={Clock}       color="bg-blue-900 text-blue-300"/>
        <Stat label="Viruses"     value={t.viruses}     icon={Bug}         color="bg-orange-900 text-orange-300"/>
        <Stat label="Avg Spam"    value={t.avg_spam ? (+t.avg_spam).toFixed(1) : '0.0'}
          icon={TrendingUp} color="bg-gray-800 text-gray-300"/>
      </div>

      <div className="card">
        <h2 className="text-sm font-semibold text-gray-300 mb-4">Traffic Trend (7 days)</h2>
        <ResponsiveContainer width="100%" height={220}>
          <LineChart data={trend.slice(-168)} margin={{top:0,right:10,bottom:0,left:-10}}>
            <CartesianGrid stroke="#1f2937" strokeDasharray="3 3"/>
            <XAxis dataKey="h" tick={{fontSize:10,fill:'#6b7280'}} interval={11}
              tickFormatter={v=>v?.slice(5,13)}/>
            <YAxis tick={{fontSize:10,fill:'#6b7280'}}/>
            <Tooltip contentStyle={{background:'#111827',border:'1px solid #374151',borderRadius:8}}/>
            <Legend wrapperStyle={{fontSize:12}}/>
            <Line type="monotone" dataKey="total_msgs"     stroke="#6366f1" dot={false} name="Total"/>
            <Line type="monotone" dataKey="allowed"        stroke="#22c55e" dot={false} name="Allowed"/>
            <Line type="monotone" dataKey="blocked"        stroke="#ef4444" dot={false} name="Blocked"/>
            <Line type="monotone" dataKey="spam_detected"  stroke="#f59e0b" dot={false} name="Spam"/>
            <Line type="monotone" dataKey="virus_detected" stroke="#f97316" dot={false} name="Virus"/>
            <Line type="monotone" dataKey="greylisted"     stroke="#6b7280" dot={false} name="Greylisted"/>
          </LineChart>
        </ResponsiveContainer>
      </div>

      <HealthWidget />

      <div className="card">
        <h2 className="text-sm font-semibold text-gray-300 mb-4 flex items-center gap-2">
          <Globe size={15} className="text-indigo-400"/>Mail Origin Map (7 days)
        </h2>
        <GeoMap />
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <div className="card">
          <h2 className="text-sm font-semibold text-gray-300 mb-3">Top Sender IPs (24h)</h2>
          <ResponsiveContainer width="100%" height={180}>
            <BarChart data={topSenders} margin={{top:0,right:0,bottom:0,left:-20}}>
              <CartesianGrid stroke="#1f2937"/>
              <XAxis dataKey="sender_ip" tick={{fontSize:9,fill:'#6b7280'}}/>
              <YAxis tick={{fontSize:10,fill:'#6b7280'}}/>
              <Tooltip contentStyle={{background:'#111827',border:'1px solid #374151',borderRadius:8}}/>
              <Bar dataKey="cnt"     fill="#6366f1" name="Total"   radius={[3,3,0,0]}/>
              <Bar dataKey="blocked" fill="#ef4444" name="Blocked" radius={[3,3,0,0]}/>
            </BarChart>
          </ResponsiveContainer>
        </div>

        {/* Blocklist Suggestions */}
        <div className="card">
          <h2 className="text-sm font-semibold text-gray-300 mb-3 flex items-center gap-2">
            <Lightbulb size={15} className="text-yellow-400"/>
            Blocklist Suggestions
            {suggestions.length > 0 && (
              <span className="ml-auto text-xs bg-yellow-900 text-yellow-300 px-2 py-0.5 rounded-full">
                {suggestions.length}
              </span>
            )}
          </h2>
          {suggestions.length === 0
            ? <p className="text-gray-500 text-sm">No new suggestions — looking good!</p>
            : (
              <div className="space-y-2 max-h-52 overflow-y-auto">
                {suggestions.map((s, i) => {
                  const key = `${s.type}:${s.value}`;
                  const done = !!blocked[key];
                  const busy = !!blocking[key];
                  return (
                    <div key={i}
                      style={{display:'flex',alignItems:'center',gap:'10px',
                        background: done ? 'rgba(20,83,45,0.2)' : 'rgba(120,53,15,0.2)',
                        border: `1px solid ${done ? 'rgba(74,222,128,0.2)' : 'rgba(245,158,11,0.2)'}`,
                        borderRadius:'8px',padding:'8px 12px'}}>
                      {TYPE_ICON[s.type]}
                      <div style={{flex:1,minWidth:0}}>
                        <div style={{display:'flex',alignItems:'center',gap:'6px'}}>
                          <span style={{fontSize:'0.7rem',background:'#1f2937',
                            padding:'1px 6px',borderRadius:'4px',color:'#9ca3af',flexShrink:0}}>
                            {TYPE_LABEL[s.type]}
                          </span>
                          <code style={{fontSize:'0.75rem',color:'#e5e7eb',
                            overflow:'hidden',textOverflow:'ellipsis',whiteSpace:'nowrap'}}>
                            {s.value}
                          </code>
                        </div>
                        <p style={{fontSize:'0.65rem',color:'#6b7280',margin:'2px 0 0'}}>
                          {s.reason} · {s.hits} hit{s.hits!==1?'s':''}
                        </p>
                      </div>
                      <button
                        onClick={() => blockSuggestion(s)}
                        disabled={done || busy}
                        style={{flexShrink:0,padding:'4px 10px',borderRadius:'6px',
                          fontSize:'0.7rem',fontWeight:600,border:'none',cursor: done||busy ? 'default' : 'pointer',
                          background: done ? 'rgba(20,83,45,0.5)' : busy ? '#1f2937' : 'rgba(239,68,68,0.2)',
                          color: done ? '#4ade80' : busy ? '#6b7280' : '#f87171',
                          opacity: busy ? 0.6 : 1}}>
                        {done ? '✓ Blocked' : busy ? '…' : 'Block'}
                      </button>
                    </div>
                  );
                })}
              </div>
            )
          }
        </div>
      </div>

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