/**
 * worker-proxy.js — GitHub Actions 4G Gateway Client
 * 
 * Runs inside the GitHub Actions runner (or cloud container).
 * Exposes a local HTTP CONNECT proxy on 127.0.0.1:9050 that transparently
 * tunnels all Playwright / Chromium traffic through the Android Phone's 4G IP.
 */

'use strict';

const http = require('http');
const WebSocket = require('ws');

const PROXY_PORT = parseInt(process.env.PROXY_PORT || '9050', 10);
const RELAY_URL = process.env.RELAY_URL || 'wss://cloud-relay-cn0l.onrender.com/worker';

console.log('===========================================================');
console.log('🌐 GitHub Actions 4G Mobile Bridge Starting...');
console.log(`📡 Connecting to Cloud Relay: ${RELAY_URL}`);
console.log(`🔌 Local Proxy Port: 127.0.0.1:${PROXY_PORT}`);
console.log('===========================================================');

let ws = null;
let isConnected = false;
const activeTunnels = new Map();
let connectionSeq = 0;

function connectToRelay() {
  ws = new WebSocket(RELAY_URL);

  ws.on('open', () => {
    isConnected = true;
    console.log('✅ Connected to Cloud Relay! 4G Phone Tunnel is ready for Playwright.');
  });

  ws.on('message', (raw) => {
    try {
      const msg = JSON.parse(raw);
      const tunnel = activeTunnels.get(msg.id);
      if (!tunnel) return;

      if (msg.type === 'connected') {
        tunnel.connected = true;
        tunnel.clientSocket.write('HTTP/1.1 200 Connection Established\r\n\r\n');
        if (tunnel.head && tunnel.head.length > 0) {
          ws.send(JSON.stringify({ id: msg.id, type: 'data', payload: tunnel.head.toString('base64') }));
          tunnel.head = null;
        }
      } else if (msg.type === 'data') {
        if (!tunnel.clientSocket.destroyed) {
          tunnel.clientSocket.write(Buffer.from(msg.payload, 'base64'));
        }
      } else if (msg.type === 'error' || msg.type === 'close') {
        if (!tunnel.connected) {
          tunnel.clientSocket.write(`HTTP/1.1 502 Bad Gateway\r\n\r\n4G Proxy Error: ${msg.error || 'Connection closed'}\r\n`);
        }
        tunnel.clientSocket.end();
        activeTunnels.delete(msg.id);
      }
    } catch (e) {
      console.error('[Worker Proxy Error]:', e.message);
    }
  });

  ws.on('close', () => {
    isConnected = false;
    console.warn('⚠️ Disconnected from Cloud Relay. Reconnecting in 3s...');
    setTimeout(connectToRelay, 3000);
  });

  ws.on('error', (err) => {
    console.error('❌ Cloud Relay WS error:', err.message);
  });
}

connectToRelay();

// Local HTTP Proxy Server for Playwright
const proxyServer = http.createServer((req, res) => {
  res.writeHead(405, { 'Content-Type': 'text/plain' });
  res.end('Only HTTPS CONNECT supported.\n');
});

proxyServer.on('connect', (req, clientSocket, head) => {
  if (!isConnected || !ws || ws.readyState !== WebSocket.OPEN) {
    clientSocket.write('HTTP/1.1 502 Bad Gateway\r\n\r\n4G Gateway Offline.\r\n');
    clientSocket.end();
    return;
  }

  const [host, portStr] = req.url.split(':');
  const port = parseInt(portStr || '443', 10);
  const connId = ++connectionSeq;

  activeTunnels.set(connId, { clientSocket, head, connected: false, host, port });

  // 15s timeout
  const timeoutId = setTimeout(() => {
    if (activeTunnels.has(connId) && !activeTunnels.get(connId).connected) {
      clientSocket.write('HTTP/1.1 504 Gateway Timeout\r\n\r\n4G Phone Timeout.\r\n');
      clientSocket.end();
      activeTunnels.delete(connId);
      if (ws.readyState === WebSocket.OPEN) {
        ws.send(JSON.stringify({ id: connId, type: 'close' }));
      }
    }
  }, 15000);

  clientSocket.on('data', (chunk) => {
    if (ws.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify({ id: connId, type: 'data', payload: chunk.toString('base64') }));
    }
  });

  clientSocket.on('close', () => {
    clearTimeout(timeoutId);
    activeTunnels.delete(connId);
    if (ws.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify({ id: connId, type: 'close' }));
    }
  });

  clientSocket.on('error', () => {
    clearTimeout(timeoutId);
    activeTunnels.delete(connId);
  });

  // Ask phone to dial outbound TCP socket
  ws.send(JSON.stringify({ id: connId, type: 'connect', host, port }));
});

proxyServer.listen(PROXY_PORT, '127.0.0.1', () => {
  console.log(`✅ Proxy listening locally on http://127.0.0.1:${PROXY_PORT}`);
});
