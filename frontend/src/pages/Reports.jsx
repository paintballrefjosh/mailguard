import React, { useEffect, useState } from 'react';
import { FileText, RefreshCw, Send, TrendingUp, TrendingDown } from 'lucide-react';
import { BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, CartesianGrid } from 'recharts';
import api from '../utils/api';

const fmt = n => (+(n||0)).toLocaleString();
const pct = (n, d) => d > 0 ? ((n/d)*100).toFixed(1)+'%' : '0%';

function StatCard({ label, value, sub, color='text-white' }) {
  return (
    <div className="card text-center">
      <p className={`text-3xl font-bold ${color}`}>{fmt(value)}</p>
      <p className="text-xs text-gray-400 mt-1">{label}</p>
      {sub && <p className="text-xs text-gray-600 mt-0.5">{sub}</p>}
    </div>
  );
}

export default function Reports() {
  const [period,    setPeriod]    = useState('daily');
  const [report,    setReport]    = useState(null);
  const [loading,   setLoading]   = useState(false);
  const [sending,   setSending]   = useState(false);
  const [sentMsg,   setSentMsg]   = useState('');

  const load = (p = period) => {
    setLoading(true);
    api.get(`/reports/${p}`)
      .then(r => setReport(r.data))
      .catch(() => setReport(null))
      .finally(() => setLoading(false));
  };

  useEffect(() => { load(); }, [period]);

  const regenerate = () => {
    setLoading(true);
    api.post(`/reports/${period}/generate`, { send_email: false })
      .then(() => load())
      .catch(() => setLoading(false));
  };

  const sendEmail = () => {
    setSending(true);
    api.post(`/reports/${period}/generate`, { send_email: true })
      .then(() => { setSentMsg('Report sent!'); setTimeout(()=>setSentMsg(''),3000); })
      .catch(() => setSentMsg('Send failed.'))
      .finally(() => setSending(false));
  };

  const t = report?.totals || {};

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between flex-wrap gap-3">
        <h1 className="text-2xl font-bold flex items-center gap-2">
          <FileText size={22} className="text-indigo-400"/>Reports
        </h1>
        <div className="flex items-center gap-2">
          <div className="flex rounded-lg overflow-hidden border border-gray-700">
            {['daily','weekly'].map(p => (
              <button key={p} onClick={()=>setPeriod(p)}
                className={`px-4 py-1.5 text-sm capitalize transition-colors
                  ${period===p ? 'bg-indigo-600 text-white' : 'bg-gray-800 text-gray-400 hover:bg-gray-700'}`}>
                {p}
              </button>
            ))}
          </div>
          <button onClick={regenerate} className="btn-ghost flex items-center gap-2 text-sm">
            <RefreshCw size={14} className={loading?'animate-spin':''}/>Regenerate
          </button>
          <button onClick={sendEmail} disabled={sending}
            className="btn-primary flex items-center gap-2 text-sm">
            <Send size={14}/>{sending ? 'Sending…' : 'Email Report'}
          </button>
          {sentMsg && <span className="text-sm text-green-400">{sentMsg}</span>}
        </div>
      </div>

      {report?.generated_at && (
        <p className="text-xs text-gray-500">
          Generated: {new Date(report.generated_at).toLocaleString()}
        </p>
      )}

      {loading && <div className="text-gray-400 text-sm">Loading report…</div>}

      {!loading && report && (
        <>
          {/* Summary stats */}
          <div className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-7 gap-3">
            <StatCard label="Total"       value={t.total}/>
            <StatCard label="Allowed"     value={t.allowed}     color="text-green-400"  sub={pct(t.allowed,t.total)}/>
            <StatCard label="Blocked"     value={t.blocked}     color="text-red-400"    sub={pct(t.blocked,t.total)}/>
            <StatCard label="Flagged"     value={t.flagged}     color="text-yellow-400"/>
            <StatCard label="Quarantined" value={t.quarantined} color="text-purple-400"/>
            <StatCard label="Viruses"     value={t.viruses}     color="text-orange-400"/>
            <StatCard label="Avg Spam"    value={(+(t.avg_spam||0)).toFixed(1)} sub={`max ${(+(t.max_spam||0)).toFixed(1)}`}/>
          </div>

          {/* Auth failures */}
          <div className="grid grid-cols-3 gap-3">
            <div className="card text-center">
              <p className="text-2xl font-bold text-pink-400">{fmt(t.spf_fail)}</p>
              <p className="text-xs text-gray-400 mt-1">SPF Failures</p>
            </div>
            <div className="card text-center">
              <p className="text-2xl font-bold text-pink-400">{fmt(t.dkim_fail)}</p>
              <p className="text-xs text-gray-400 mt-1">DKIM Failures</p>
            </div>
            <div className="card text-center">
              <p className="text-2xl font-bold text-pink-400">{fmt(t.dmarc_fail)}</p>
              <p className="text-xs text-gray-400 mt-1">DMARC Failures</p>
            </div>
          </div>

          <div className="grid grid-cols-1 lg:grid-cols-2 gap-5">
            {/* Top blocked IPs */}
            {report.topBlocked?.length > 0 && (
              <div className="card">
                <h2 className="text-sm font-semibold text-gray-300 mb-3">Top Blocked IPs</h2>
                <ResponsiveContainer width="100%" height={200}>
                  <BarChart data={report.topBlocked} layout="vertical"
                    margin={{top:0,right:10,bottom:0,left:80}}>
                    <CartesianGrid stroke="#1f2937" horizontal={false}/>
                    <XAxis type="number" tick={{fontSize:10,fill:'#6b7280'}}/>
                    <YAxis type="category" dataKey="sender_ip"
                      tick={{fontSize:10,fill:'#6b7280'}} width={80}/>
                    <Tooltip contentStyle={{background:'#111827',border:'1px solid #374151',borderRadius:8}}/>
                    <Bar dataKey="cnt" fill="#ef4444" radius={[0,3,3,0]} name="Blocks"/>
                  </BarChart>
                </ResponsiveContainer>
              </div>
            )}

            {/* Top sender domains */}
            {report.topDomains?.length > 0 && (
              <div className="card">
                <h2 className="text-sm font-semibold text-gray-300 mb-3">Top Sender Domains</h2>
                <div className="space-y-1.5 max-h-52 overflow-y-auto">
                  {report.topDomains.map((d,i) => (
                    <div key={i} className="flex items-center justify-between text-sm py-1 border-b border-gray-800">
                      <span className="text-gray-300 truncate max-w-[200px]">{d.sender_domain||'unknown'}</span>
                      <div className="flex gap-3 text-xs shrink-0">
                        <span className="text-gray-400">{fmt(d.cnt)} total</span>
                        {d.blocked > 0 && <span className="text-red-400">{fmt(d.blocked)} blocked</span>}
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>

          {/* Viruses */}
          {report.viruses?.length > 0 && (
            <div className="card">
              <h2 className="text-sm font-semibold text-gray-300 mb-3">Virus Detections</h2>
              <div className="space-y-1">
                {report.viruses.map((v,i) => (
                  <div key={i} className="flex justify-between text-sm py-1.5 border-b border-gray-800">
                    <span className="font-mono text-orange-300 text-xs">{v.virus_found}</span>
                    <span className="text-gray-400">{fmt(v.cnt)}×</span>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Recent alerts in period */}
          {report.alerts?.length > 0 && (
            <div className="card">
              <h2 className="text-sm font-semibold text-gray-300 mb-3">Alerts During Period</h2>
              <div className="space-y-1.5 max-h-48 overflow-y-auto">
                {report.alerts.map((a,i) => (
                  <div key={i} className="flex gap-3 text-xs py-1.5 border-b border-gray-800">
                    <span className="text-gray-500 shrink-0">{new Date(a.created_at).toLocaleString()}</span>
                    <span className={`shrink-0 font-medium ${a.severity==='critical'?'text-red-400':'text-yellow-400'}`}>
                      {a.alert_type?.replace(/_/g,' ')}
                    </span>
                    <span className="text-gray-300 truncate">{a.message}</span>
                  </div>
                ))}
              </div>
            </div>
          )}
        </>
      )}

      {!loading && !report && (
        <div className="card text-center py-12 text-gray-500">
          <FileText size={32} className="mx-auto mb-3 opacity-30"/>
          <p>No report data yet. Click Regenerate to build one now.</p>
        </div>
      )}
    </div>
  );
}