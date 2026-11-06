const { WebSocketServer } = require('ws');
const jwt = require('jsonwebtoken');

let wss;

function initWss(server) {
  wss = new WebSocketServer({ server, path: '/ws' });

  wss.on('connection', (ws, req) => {
    // Authenticate via token query param: /ws?token=...
    const url    = new URL(req.url, 'http://localhost');
    const token  = url.searchParams.get('token');
    try {
      jwt.verify(token, process.env.JWT_SECRET);
      ws.authenticated = true;
    } catch {
      ws.close(4401, 'Unauthorized');
      return;
    }

    ws.isAlive = true;
    ws.on('pong', () => { ws.isAlive = true; });
    ws.on('error', () => {});
  });

  // Heartbeat — drop dead connections every 30s
  setInterval(() => {
    wss.clients.forEach(ws => {
      if (!ws.isAlive) { ws.terminate(); return; }
      ws.isAlive = false;
      ws.ping();
    });
  }, 30000);

  console.log('[ws] WebSocket server ready on /ws');
}

function broadcast(type, data) {
  if (!wss) return;
  const msg = JSON.stringify({ type, data, ts: new Date().toISOString() });
  wss.clients.forEach(ws => {
    if (ws.authenticated && ws.readyState === ws.OPEN) {
      ws.send(msg);
    }
  });
}

module.exports = { initWss, broadcast };