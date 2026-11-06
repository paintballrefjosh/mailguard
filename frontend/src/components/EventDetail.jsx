import React, { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { X, Shield, Globe, Mail, Server, Clock, Hash, ExternalLink } from 'lucide-react';
import api from '../utils/api';

const Row = ({ label, value, mono }) => value ? (
  <div className="flex gap-3 py-2 border-b border-gray-800 last:border-0">
    <span className="text-gray-500 text-xs w-32 shrink-0 pt-0.5">{label}</span>
    <span className={`text-sm text-gray-200 break-all ${mono?'font-mono':''}`}>{value}</span>
  </div>
) : null;

const Badge = ({ val, green, red }) => {
  if (!val) return <span className="text-gray-600 text-xs">—</span>;
  const color = val === green ? 'text-green-400' : val === red ? 'text-red-400' : 'text-yellow-400';
  return <span className={`text-xs font-medium ${color}`}>{val}</span>;
};

export default function EventDetail({ id, onClose }) {
  const [ev, setEv] = useState(null);
  const [loading, setLoading] = useState(true);
  const [ptr, setPtr] = useState(null);

  useEffect(() => {
    setLoading(true);
    setPtr(null);
    api.get(`/events/${id}`)
      .then(r => {
        setEv(r.data);
        if (r.data?.sender_ip) {
          api.get(`/events/rdns/${r.data.sender_ip}`)
            .then(p => setPtr(p.data.ptr))
            .catch(() => {});
        }
      })
      .catch(() => setEv(null))
      .finally(() => setLoading(false));
  }, [id]);

  return (
    <div className="fixed inset-0 z-50 flex justify-end bg-black/50"
      onClick={e => e.target === e.currentTarget && onClose()}>
      <div className="w-full max-w-xl bg-gray-900 border-l border-gray-800 overflow-y-auto h-full shadow-2xl">
        <div className="flex items-center justify-between px-5 py-4 border-b border-gray-800 sticky top-0 bg-gray-900 z-10">
          <h2 className="font-semibold text-gray-100">Event Detail</h2>
          <button onClick={onClose} className="text-gray-500 hover:text-white"><X size={18}/></button>
        </div>

        {loading && <div className="p-6 text-gray-400 text-sm">Loading…</div>}
        {!loading && !ev && <div className="p-6 text-gray-400 text-sm">Event not found.</div>}

        {!loading && ev && (
          <div className="px-5 py-4 space-y-5">
            {/* Status banner */}
            <div className={`rounded-lg px-4 py-3 text-sm font-medium
              ${ev.action==='allow'      ? 'bg-green-900 text-green-200'
              : ev.action==='block'      ? 'bg-red-900 text-red-200'
              : ev.action==='flag'       ? 'bg-yellow-900 text-yellow-200'
              : ev.action==='quarantine' ? 'bg-purple-900 text-purple-200'
              : 'bg-gray-800 text-gray-200'}`}>
              <span className="uppercase font-bold">{ev.action}</span>
              {ev.reason && <span className="ml-2 font-normal opacity-80">— {ev.reason}</span>}
            </div>

            {/* Matched rule — links to the blocklist entry / rule that decided this event */}
            {ev.matched_rule && (
              <div className="flex items-center gap-3 rounded-lg border border-gray-800 bg-gray-950 px-4 py-3">
                <span className="text-gray-500 text-xs w-32 shrink-0">Matched rule</span>
                {ev.matched_rule.exists ? (
                  <Link
                    to={`/settings?tab=${ev.matched_rule.source === 'rule' ? 'rules' : 'blocklists'}&highlight=${ev.matched_rule.id}`}
                    className="text-sm text-indigo-400 hover:text-indigo-300 inline-flex items-center gap-1.5 break-all"
                    title="Open in Settings and highlight the rule">
                    <span className={ev.matched_rule.source === 'rule' ? '' : 'font-mono'}>{ev.matched_rule.label}</span>
                    {ev.matched_rule.action && (
                      <span className="text-xs text-gray-500">({ev.matched_rule.action})</span>
                    )}
                    <ExternalLink size={12} className="shrink-0"/>
                  </Link>
                ) : (
                  <span className="text-sm text-gray-500">
                    {ev.matched_rule.source === 'rule' ? 'Rule' : 'Blocklist entry'} #{ev.matched_rule.id} (deleted)
                  </span>
                )}
              </div>
            )}

            {/* Envelope */}
            <section>
              <h3 className="text-xs text-gray-500 uppercase tracking-wide mb-2 flex items-center gap-1">
                <Mail size={12}/>Envelope
              </h3>
              <Row label="From:"     value={ev.from_header}/>
              <Row label="To"        value={ev.recipient}/>
              <Row label="Subject"   value={ev.subject}/>
              <Row label="Size"      value={ev.size_bytes ? `${(ev.size_bytes/1024).toFixed(1)} KB` : null}/>
              <Row label="Received"  value={ev.received_at ? new Date(ev.received_at).toLocaleString() : null}/>
              <Row label="Queue ID"  value={ev.queue_id} mono/>
            </section>

            {/* Sender info */}
            <section>
              <h3 className="text-xs text-gray-500 uppercase tracking-wide mb-2 flex items-center gap-1">
                <Server size={12}/>Sender
              </h3>
              {ev.sender_ip && (
                <div className="flex gap-3 py-2 border-b border-gray-800">
                  <span className="text-gray-500 text-xs w-32 shrink-0 pt-0.5">IP Address</span>
                  <span className="text-sm text-gray-200 font-mono break-all">
                    {ev.sender_ip}
                    {ptr && <span className="ml-2 text-gray-400 font-sans">({ptr})</span>}
                  </span>
                </div>
              )}
              <Row label="Sender Email"  value={ev.sender}/>
              <Row label="HELO Domain"  value={ev.helo_name}/>
              <Row label="Domain"       value={ev.sender_domain}/>
              {ev.country_name && (
                <div className="flex gap-3 py-2 border-b border-gray-800">
                  <span className="text-gray-500 text-xs w-32 shrink-0 pt-0.5">Location</span>
                  <span className="text-sm text-gray-200">
                    {[ev.city, ev.country_name].filter(Boolean).join(', ')}
                    {ev.country_code && <span className="ml-2 text-gray-500">({ev.country_code})</span>}
                  </span>
                </div>
              )}
            </section>

            {/* Auth results */}
            <section>
              <h3 className="text-xs text-gray-500 uppercase tracking-wide mb-2 flex items-center gap-1">
                <Shield size={12}/>Authentication
              </h3>
              <div className="flex gap-3 py-2 border-b border-gray-800">
                <span className="text-gray-500 text-xs w-32 shrink-0">SPF</span>
                <Badge val={ev.spf_result}  green="pass" red="fail"/>
              </div>
              <div className="flex gap-3 py-2 border-b border-gray-800">
                <span className="text-gray-500 text-xs w-32 shrink-0">DKIM</span>
                <Badge val={ev.dkim_result} green="pass" red="fail"/>
              </div>
              <div className="flex gap-3 py-2 border-b border-gray-800">
                <span className="text-gray-500 text-xs w-32 shrink-0">DMARC</span>
                <Badge val={ev.dmarc_result}green="pass" red="fail"/>
              </div>
              {ev.spam_score != null && (
                <div className="flex gap-3 py-2 border-b border-gray-800">
                  <span className="text-gray-500 text-xs w-32 shrink-0">Spam Score</span>
                  <span className={`text-sm font-mono font-medium
                    ${ev.spam_score >= 10 ? 'text-red-400'
                    : ev.spam_score >= 5  ? 'text-yellow-400'
                    : 'text-green-400'}`}>
                    {(+ev.spam_score).toFixed(2)}
                  </span>
                </div>
              )}
              {ev.virus_found && (
                <div className="flex gap-3 py-2 border-b border-gray-800">
                  <span className="text-gray-500 text-xs w-32 shrink-0">Virus</span>
                  <span className="text-sm text-orange-400 font-mono">{ev.virus_found}</span>
                </div>
              )}
            </section>

            {/* Headers */}
            {ev.headers && Object.keys(ev.headers).length > 0 && (
              <section>
                <h3 className="text-xs text-gray-500 uppercase tracking-wide mb-2 flex items-center gap-1">
                  <Hash size={12}/>Headers
                </h3>
                <div className="bg-gray-950 rounded-lg p-3 font-mono text-xs text-gray-300 space-y-1 max-h-64 overflow-y-auto">
                  {Object.entries(ev.headers).map(([k,v]) => (
                    <div key={k} className="break-all">
                      <span className="text-indigo-400">{k}: </span>{v}
                    </div>
                  ))}
                </div>
              </section>
            )}

            {!ev.headers && (
              <p className="text-xs text-gray-600 italic">
                Full headers not available for this event — captured going forward.
              </p>
            )}
          </div>
        )}
      </div>
    </div>
  );
}