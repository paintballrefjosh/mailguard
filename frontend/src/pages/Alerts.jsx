import React, { useEffect, useState, useCallback } from 'react';
import { Bell, CheckCheck, AlertTriangle, AlertOctagon, Info } from 'lucide-react';
import api from '../utils/api';
import useWebSocket from '../utils/useWebSocket';
import { useAlertContext } from '../utils/AlertContext';

const SEVERITY_ICON = {
  critical: <AlertOctagon size={16} className="text-red-400 shrink-0"/>,
  warning:  <AlertTriangle size={16} className="text-yellow-400 shrink-0"/>,
  info:     <Info size={16} className="text-blue-400 shrink-0"/>,
};
const SEVERITY_BG = {
  critical: 'border-red-800 bg-red-950/40',
  warning:  'border-yellow-800 bg-yellow-950/40',
  info:     'border-blue-800 bg-blue-950/40',
};

export default function Alerts() {
  const [alerts, setAlerts]   = useState([]);
  const [filter, setFilter]   = useState('all'); // all | unread | critical

  const { decrementUnread, clearUnread } = useAlertContext();

  const load = () => api.get('/alerts?limit=100').then(r => setAlerts(r.data)).catch(()=>{});
  useEffect(() => { load(); }, []);

  const handleWs = useCallback((msg) => {
    if (msg.type === 'alert') {
      setAlerts(prev => [{
        id: Date.now(),
        alert_type: msg.data.type,
        message: msg.data.message,
        severity: msg.data.severity,
        acknowledged: false,
        created_at: msg.data.ts,
      }, ...prev]);
    }
  }, []);
  useWebSocket(handleWs);

  const acknowledge = async (id) => {
    await api.post(`/alerts/acknowledge/${id}`).catch(()=>{});
    setAlerts(prev => prev.map(a => a.id===id ? {...a, acknowledged:true} : a));
    decrementUnread(1);
  };

  const acknowledgeAll = async () => {
    await api.post('/alerts/acknowledge-all').catch(()=>{});
    setAlerts(prev => prev.map(a => ({...a, acknowledged:true})));
    clearUnread();
  };

  const visible = alerts.filter(a => {
    if (filter === 'unread')   return !a.acknowledged;
    if (filter === 'critical') return a.severity === 'critical';
    return true;
  });

  const unread = alerts.filter(a => !a.acknowledged).length;

  return (
    <div className="space-y-5">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold flex items-center gap-2">
          <Bell size={22} className="text-indigo-400"/>Alerts
          {unread > 0 && (
            <span className="text-sm bg-red-600 text-white rounded-full px-2 py-0.5">{unread}</span>
          )}
        </h1>
        <div className="flex gap-2">
          {unread > 0 && (
            <button onClick={acknowledgeAll} className="btn-ghost flex items-center gap-2 text-sm">
              <CheckCheck size={15}/>Acknowledge All
            </button>
          )}
        </div>
      </div>

      {/* Filters */}
      <div className="flex gap-2">
        {['all','unread','critical'].map(f => (
          <button key={f} onClick={()=>setFilter(f)}
            className={`btn text-xs capitalize ${filter===f?'bg-indigo-600 text-white':'bg-gray-800 text-gray-400'}`}>
            {f}
          </button>
        ))}
      </div>

      {visible.length === 0 && (
        <div className="card text-center py-12 text-gray-500">
          <Bell size={32} className="mx-auto mb-3 opacity-30"/>
          <p>No alerts {filter !== 'all' ? `matching "${filter}"` : 'yet'}.</p>
        </div>
      )}

      <div className="space-y-2">
        {visible.map(a => (
          <div key={a.id}
            className={`border rounded-xl px-4 py-3 flex items-start gap-3 transition-opacity
              ${a.acknowledged ? 'opacity-40' : ''}
              ${SEVERITY_BG[a.severity] || 'border-gray-800 bg-gray-900'}`}>
            {SEVERITY_ICON[a.severity]}
            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-2 mb-0.5">
                <span className="text-xs font-semibold uppercase tracking-wide text-gray-300">
                  {a.alert_type?.replace(/_/g,' ')}
                </span>
                <span className="text-xs text-gray-500">
                  {a.created_at ? new Date(a.created_at).toLocaleString() : ''}
                </span>
              </div>
              <p className="text-sm text-gray-200">{a.message}</p>
            </div>
            {!a.acknowledged && (
              <button onClick={()=>acknowledge(a.id)}
                className="text-xs text-gray-500 hover:text-green-400 shrink-0 mt-0.5">
                ✓ Ack
              </button>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}