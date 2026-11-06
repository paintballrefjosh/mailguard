import React, { useState, useEffect, useCallback, useRef } from 'react';
import { Outlet, NavLink, useNavigate } from 'react-router-dom';
import { LayoutDashboard, Mail, Settings, Shield, LogOut,
         Bell, FileText, AlertTriangle, Archive, Inbox, X } from 'lucide-react';
import useWebSocket from '../utils/useWebSocket';
import useNotification from '../utils/useNotification';
import { AlertContext } from '../utils/AlertContext';
import api from '../utils/api';

const nav = [
  { to:'/',            label:'Dashboard',  icon: LayoutDashboard },
  { to:'/events',      label:'Mail Log',   icon: Mail },
  { to:'/queue',       label:'Mail Queue', icon: Inbox },
  { to:'/quarantine',  label:'Quarantine', icon: Archive },
  { to:'/reports',     label:'Reports',    icon: FileText },
  { to:'/alerts',      label:'Alerts',     icon: AlertTriangle },
  { to:'/settings',    label:'Settings',   icon: Settings },
];

export default function Layout() {
  const navigate = useNavigate();
  const [unreadAlerts,    setUnreadAlerts]    = useState(0);
  const [quarantineCount, setQuarantineCount] = useState(0);
  const { flashTitle, flashPage } = useNotification();

  const [toasts, setToasts] = useState([]);
  const toastIdRef   = useRef(0);
  const activeToasts = useRef({});

  useEffect(() => {
    api.get('/alerts?unread=true')
      .then(r => setUnreadAlerts(r.data.length))
      .catch(() => {});

    // Load quarantine count on mount
    api.get('/quarantine/count')
      .then(r => setQuarantineCount(r.data.count || 0))
      .catch(() => {});

    // Refresh quarantine count every 60s
    const interval = setInterval(() => {
      api.get('/quarantine/count')
        .then(r => setQuarantineCount(r.data.count || 0))
        .catch(() => {});
    }, 60000);
    return () => clearInterval(interval);
  }, []);

  const addToast = useCallback((data) => {
    const id      = ++toastIdRef.current;
    const persist = data.severity === 'critical' || data.type?.startsWith('health_');
    const key     = data.type || String(id);

    if (activeToasts.current[key]) {
      const oldId = activeToasts.current[key];
      setToasts(prev => prev.filter(t => t.id !== oldId));
    }

    const toast = { id, key, ...data, persistent: persist };
    activeToasts.current[key] = id;
    setToasts(prev => [...prev, toast]);

    if (!persist) {
      setTimeout(() => dismissToast(id, key), 6000);
    }
  }, []);

  const dismissToast = useCallback((id, key) => {
    setToasts(prev => prev.filter(t => t.id !== id));
    if (activeToasts.current[key] === id) {
      delete activeToasts.current[key];
    }
  }, []);

  const { decrementUnread, clearUnread } = (() => {
    const dec   = useCallback((by = 1) => setUnreadAlerts(n => Math.max(0, n - by)), []);
    const clear = useCallback(() => setUnreadAlerts(0), []);
    return { decrementUnread: dec, clearUnread: clear };
  })();

  const handleWsMessage = useCallback((msg) => {
    if (msg.type === 'alert') {
      setUnreadAlerts(n => n + 1);
      addToast(msg.data);
      flashTitle(`⚠ Alert: ${msg.data.type?.replace(/_/g, ' ') || 'MailGuard'}`);
      flashPage('#f97316');
    }
    if (msg.type === 'mail_event') {
      if (msg.data?.action === 'quarantine') {
        setQuarantineCount(n => n + 1);
      }
    }
    if (msg.type === 'health') {
      msg.data.forEach(svc => {
        if (svc.healthy) {
          const key   = `health_${svc.key}`;
          const oldId = activeToasts.current[key];
          if (oldId) {
            setToasts(prev => prev.map(t =>
              t.id === oldId
                ? { ...t, message: `${svc.label} is back online.`, severity: 'info', persistent: false }
                : t
            ));
            setTimeout(() => dismissToast(oldId, key), 4000);
          }
        } else {
          flashTitle(`🔴 ${svc.label} is DOWN`);
          flashPage('#dc2626');
        }
      });
    }
  }, [addToast, dismissToast, flashTitle, flashPage]);

  useWebSocket(handleWsMessage);

  const logout = () => { localStorage.removeItem('mg_token'); navigate('/login'); };

  const toastBg = (severity) => {
    if (severity === 'critical') return { bg:'#450a0a', border:'#7f1d1d', color:'#fca5a5', icon:'🔴' };
    if (severity === 'info')     return { bg:'#052e16', border:'#166534', color:'#bbf7d0', icon:'✓' };
    return                              { bg:'#422006', border:'#92400e', color:'#fde68a', icon:'⚠' };
  };

  return (
    <AlertContext.Provider value={{ decrementUnread, clearUnread }}>
      <div className="flex h-screen overflow-hidden">
        <aside className="w-56 bg-gray-900 border-r border-gray-800 flex flex-col">
          <div className="flex items-center gap-2 px-5 py-5 border-b border-gray-800">
            <Shield className="text-indigo-400" size={22}/>
            <span className="font-bold text-lg tracking-tight">MailGuard</span>
          </div>
          <nav className="flex-1 px-3 py-4 space-y-1">
            {nav.map(({to, label, icon:Icon}) => (
              <NavLink key={to} to={to} end={to==='/'} className={({isActive}) =>
                `flex items-center gap-3 px-3 py-2 rounded-lg text-sm font-medium transition-colors relative
                 ${isActive ? 'bg-indigo-600 text-white' : 'text-gray-400 hover:bg-gray-800 hover:text-gray-100'}`}>
                <Icon size={17}/>{label}
                {to==='/alerts' && unreadAlerts > 0 && (
                  <span className="ml-auto bg-red-500 text-white text-xs rounded-full px-1.5 py-0.5 min-w-[20px] text-center">
                    {unreadAlerts}
                  </span>
                )}
                {to==='/quarantine' && quarantineCount > 0 && (
                  <span className="ml-auto bg-purple-600 text-white text-xs rounded-full px-1.5 py-0.5 min-w-[20px] text-center">
                    {quarantineCount}
                  </span>
                )}
              </NavLink>
            ))}
          </nav>
          <button onClick={logout}
            className="flex items-center gap-3 px-6 py-4 text-sm text-gray-500 hover:text-red-400 border-t border-gray-800">
            <LogOut size={16}/>Logout
          </button>
        </aside>

        <main className="flex-1 overflow-y-auto bg-gray-950 p-6">
          <Outlet />
        </main>

        {/* Toast stack */}
        <div style={{position:'fixed',bottom:'24px',right:'24px',zIndex:50,
          display:'flex',flexDirection:'column-reverse',gap:'8px',maxWidth:'380px'}}>
          {toasts.map(toast => {
            const style = toastBg(toast.severity);
            return (
              <div key={toast.id}
                style={{background:style.bg, border:`1px solid ${style.border}`,
                  color:style.color, borderRadius:'12px',
                  boxShadow:'0 10px 25px rgba(0,0,0,0.5)',
                  animation:'slideIn 0.2s ease-out'}}>
                <div style={{display:'flex',alignItems:'flex-start',gap:'10px',padding:'12px 14px'}}>
                  <span style={{fontSize:'0.9rem',flexShrink:0,marginTop:'1px'}}>{style.icon}</span>
                  <div style={{flex:1,minWidth:0}}>
                    <p style={{fontSize:'0.7rem',fontWeight:700,textTransform:'uppercase',
                      letterSpacing:'0.05em',margin:'0 0 3px',opacity:0.8}}>
                      {toast.type?.replace(/_/g,' ') || 'Alert'}
                      {toast.persistent && (
                        <span style={{marginLeft:'6px',fontSize:'0.6rem',
                          background:'rgba(255,255,255,0.1)',padding:'1px 5px',borderRadius:'3px'}}>
                          PERSISTENT
                        </span>
                      )}
                    </p>
                    <p style={{fontSize:'0.8rem',margin:0,lineHeight:1.4}}>{toast.message}</p>
                    {toast.persistent && (
                      <p style={{fontSize:'0.65rem',margin:'4px 0 0',opacity:0.6}}>
                        Will auto-dismiss when resolved
                      </p>
                    )}
                  </div>
                  <button onClick={() => dismissToast(toast.id, toast.key)}
                    style={{background:'none',border:'none',cursor:'pointer',
                      color:'inherit',opacity:0.6,flexShrink:0,padding:'0 0 0 4px'}}
                    title="Dismiss">
                    <X size={14}/>
                  </button>
                </div>
              </div>
            );
          })}
        </div>

        <style>{`
          @keyframes slideIn {
            from { transform: translateX(20px); opacity: 0; }
            to   { transform: translateX(0);    opacity: 1; }
          }
        `}</style>
      </div>
    </AlertContext.Provider>
  );
}