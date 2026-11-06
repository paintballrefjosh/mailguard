import { useEffect, useRef, useCallback } from 'react';

export default function useWebSocket(onMessage) {
  const ws      = useRef(null);
  const reconnect = useRef(null);

  const connect = useCallback(() => {
    const token = localStorage.getItem('mg_token');
    if (!token) return;

    const proto = window.location.protocol === 'https:' ? 'wss' : 'ws';
    const host  = window.location.host;
    const url   = `${proto}://${host}/ws?token=${token}`;

    ws.current = new WebSocket(url);

    ws.current.onopen  = () => console.log('[ws] connected');
    ws.current.onclose = () => {
      console.log('[ws] disconnected, reconnecting in 5s...');
      reconnect.current = setTimeout(connect, 5000);
    };
    ws.current.onerror = () => ws.current?.close();
    ws.current.onmessage = evt => {
      try {
        const msg = JSON.parse(evt.data);
        onMessage(msg);
      } catch {}
    };
  }, [onMessage]);

  useEffect(() => {
    connect();
    return () => {
      clearTimeout(reconnect.current);
      ws.current?.close();
    };
  }, [connect]);
}