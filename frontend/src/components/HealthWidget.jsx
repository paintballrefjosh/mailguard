import React, { useEffect, useState, useCallback } from 'react';
import { CheckCircle, XCircle, Activity } from 'lucide-react';
import api from '../utils/api';
import useWebSocket from '../utils/useWebSocket';

export default function HealthWidget() {
  const [services, setServices] = useState([]);

  const load = () => {
    api.get('/health').then(r => setServices(r.data.services || [])).catch(() => {});
  };

  useEffect(() => { load(); }, []);

  const handleWs = useCallback((msg) => {
    if (msg.type === 'health') setServices(msg.data);
  }, []);
  useWebSocket(handleWs);

  if (!services.length) return null;

  const allUp = services.every(s => s.healthy);

  return (
    <div className="card">
      <h2 className="text-sm font-semibold text-gray-300 mb-3 flex items-center gap-2">
        <Activity size={15} className={allUp ? 'text-green-400' : 'text-red-400'}/>
        Service Health
        <span className={`ml-auto text-xs px-2 py-0.5 rounded-full
          ${allUp ? 'bg-green-900 text-green-300' : 'bg-red-900 text-red-300'}`}>
          {allUp ? 'All Systems Operational' : 'Degraded'}
        </span>
      </h2>
      <div className="grid grid-cols-2 md:grid-cols-4 gap-2">
        {services.map(s => (
          <div key={s.key}
            className={`flex items-center gap-2 px-3 py-2 rounded-lg text-sm
              ${s.healthy ? 'bg-green-950 border border-green-900' : 'bg-red-950 border border-red-900'}`}>
            {s.healthy
              ? <CheckCircle size={15} className="text-green-400 shrink-0"/>
              : <XCircle    size={15} className="text-red-400 shrink-0"/>}
            <div className="min-w-0">
              <p className="font-medium text-xs text-gray-200 truncate">{s.label}</p>
              {!s.healthy && s.error && (
                <p className="text-xs text-red-400 truncate">{s.error}</p>
              )}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}