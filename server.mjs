// SUNSET SLAM LAN host: serves the built game from dist/ and relays
// multiplayer traffic over WebSocket (RFC 6455, no dependencies).
//
//   node server.mjs            # port 4173, binds all interfaces
//   PORT=8080 node server.mjs
//
// Protocol (JSON text frames):
//   client → server: {t:'host', name}        create a room, become player A
//                    {t:'join', name, code?} join an open room as player B
//                    {t:'snap', ...}         host → authoritative snapshot
//                    {t:'in', ...}           guest → input state
//                    {t:'msg', ...}          host → guest one-shot events
//                    {t:'ping'} / {t:'pong'}
//   server → client: {t:'hosted', code}
//                    {t:'joined', code, opp}
//                    {t:'start', opp, side}
//                    {t:'left'}              opponent disconnected
//                    {t:'err', msg}
// The server is a dumb relay + matchmaker: the host browser is authoritative
// for the match simulation, the guest renders host snapshots.

import { createServer } from 'node:http';
import { createHash } from 'node:crypto';
import { readFile, stat } from 'node:fs/promises';
import { networkInterfaces, hostname } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), 'dist');
const PORT = Number(process.env.PORT || 4173);
const HOST = process.env.HOST || '0.0.0.0';
const BOOT_TIME = Date.now();

// All non-internal IPv4 addresses, best-for-distance first (Tailscale 100.x).
function lanAddresses() {
  const out = [];
  for (const list of Object.values(networkInterfaces())) {
    for (const net of list || []) {
      if (net.family !== 'IPv4' || net.internal) continue;
      out.push(net.address);
    }
  }
  return out.sort((a, b) => {
    const score = (ip) => (ip.startsWith('100.') ? 0 : ip.startsWith('172.16.') ? 1 : ip.startsWith('192.168.') ? 2 : 3);
    return score(a) - score(b);
  });
}

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
  '.ttf': 'font/ttf',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
  '.webm': 'video/webm',
  '.map': 'application/json',
};

/* ───────────────────────── static files ───────────────────────── */
async function serveStatic(req, res) {
  const url = new URL(req.url, 'http://x');
  let filePath = path.normalize(path.join(ROOT, decodeURIComponent(url.pathname)));
  if (!filePath.startsWith(ROOT)) {
    res.writeHead(403).end('Forbidden');
    return;
  }
  try {
    const info = await stat(filePath);
    if (info.isDirectory()) filePath = path.join(filePath, 'index.html');
  } catch {
    // SPA fallback: unknown paths get the shell.
    filePath = path.join(ROOT, 'index.html');
  }
  try {
    const body = await readFile(filePath);
    res.writeHead(200, {
      'content-type': MIME[path.extname(filePath).toLowerCase()] || 'application/octet-stream',
      'cache-control': 'no-cache',
    });
    res.end(body);
  } catch {
    res.writeHead(404).end('Not found');
  }
}

/* ───────────────────────── WebSocket (RFC 6455) ───────────────────────── */
const WS_GUID = '258EAFA5-E914-47DA-95CA-C5AB0DC85B11';

function acceptKey(key) {
  return createHash('sha1').update(key + WS_GUID).digest('base64');
}

// Assembles complete frames from a chunk stream.
function createFrameParser(onMessage, onClose) {
  let buffer = Buffer.alloc(0);
  return {
    feed(chunk) {
      buffer = Buffer.concat([buffer, chunk]);
      for (;;) {
        if (buffer.length < 2) return;
        const fin = (buffer[0] & 0x80) !== 0;
        const opcode = buffer[0] & 0x0f;
        const masked = (buffer[1] & 0x80) !== 0;
        let length = buffer[1] & 0x7f;
        let offset = 2;
        if (length === 126) {
          if (buffer.length < 4) return;
          length = buffer.readUInt16BE(2);
          offset = 4;
        } else if (length === 127) {
          if (buffer.length < 10) return;
          const big = buffer.readBigUInt64BE(2);
          if (big > 32n * 1024n * 1024n) { onClose(); return; }
          length = Number(big);
          offset = 10;
        }
        let maskKey = null;
        if (masked) {
          if (buffer.length < offset + 4) return;
          maskKey = buffer.subarray(offset, offset + 4);
          offset += 4;
        }
        if (buffer.length < offset + length) return;
        const payload = Buffer.from(buffer.subarray(offset, offset + length));
        if (masked) {
          for (let i = 0; i < payload.length; i += 1) {
            payload[i] ^= maskKey[i % 4];
          }
        }
        buffer = buffer.subarray(offset + length);
        this.touch?.();
        if (opcode === 0x8) { onClose(); return; }   // close
        if (opcode === 0x9) continue;                 // ping: browser-level
        if (opcode === 0xA) continue;                 // pong
        if (opcode === 0x1 && fin) {                  // text
          try {
            onMessage(payload.toString('utf8'));
          } catch {
            /* malformed payload: ignore */
          }
        }
        // Continuation/binary frames are not used by this protocol.
      }
    },
  };
}

function encodeFrame(text) {
  const payload = Buffer.from(text, 'utf8');
  const length = payload.length;
  let header;
  if (length < 126) {
    header = Buffer.from([0x81, length]);
  } else if (length < 65536) {
    header = Buffer.alloc(4);
    header[0] = 0x81;
    header[1] = 126;
    header.writeUInt16BE(length, 2);
  } else {
    header = Buffer.alloc(10);
    header[0] = 0x81;
    header[1] = 127;
    header.writeBigUInt64BE(BigInt(length), 2);
  }
  return Buffer.concat([header, payload]);
}

let aliveSockets = new Set();

setInterval(() => {
  for (const conn of aliveSockets) {
    if (!conn.alive) { aliveSockets.delete(conn); conn.close(); continue; }
    if (conn.silenceFor() > 70) { conn.alive = false; conn.close(); continue; }
    conn.protocolPing();
  }
}, 30000).unref();

class WsConnection {
  constructor(socket) {
    this.socket = socket;
    this.alive = true;
    this.lastSeen = Date.now();
    aliveSockets.add(this);
    socket.on('error', () => { this.alive = false; });
    socket.on('close', () => { this.alive = false; });
  }

  silenceFor() {
    return (Date.now() - this.lastSeen) / 1000;
  }

  protocolPing() {
    if (this.socket.destroyed) return;
    try {
      this.socket.write(Buffer.from([0x89, 0x00])); // WS ping, empty payload
    } catch {
      this.alive = false;
    }
  }

  send(obj) {
    if (!this.alive || this.socket.destroyed) return false;
    try {
      this.socket.write(encodeFrame(JSON.stringify(obj)));
      return true;
    } catch {
      this.alive = false;
      return false;
    }
  }

  close() {
    this.alive = false;
    try {
      this.socket.end(encodeFrame(JSON.stringify({ t: 'bye' })));
    } catch {
      /* already gone */
    }
  }
}

/* ───────────────────────── room broker ───────────────────────── */
const rooms = new Map(); // code → { code, hostWs, guestWs, hostName, guestName }
const CODE_CHARS = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';

function newCode() {
  for (let attempt = 0; attempt < 50; attempt += 1) {
    let code = '';
    for (let i = 0; i < 4; i += 1) code += CODE_CHARS[Math.floor(Math.random() * CODE_CHARS.length)];
    if (!rooms.has(code)) return code;
  }
  return null;
}

function sanitizeName(raw, fallback) {
  const name = String(raw || '').trim().replace(/[^\w \-.]/g, '').slice(0, 12);
  return name || fallback;
}

function dropRoom(code, reasonWs) {
  const room = rooms.get(code);
  if (!room) return;
  const other = reasonWs === room.hostWs ? room.guestWs : room.hostWs;
  rooms.delete(code);
  other?.send({ t: 'left' });
  other?.close();
  reasonWs.close();
}

function handleConnection(ws) {
  let room = null;
  let isHost = false;
  ws.socket.on('error', () => { /* connection-level failures are non-fatal */ });

  ws.socket.on('close', () => {
    if (room) dropRoom(room.code, ws);
  });

  const parser = createFrameParser(
    (text) => {
      let msg;
      try {
        msg = JSON.parse(text);
      } catch {
        return;
      }
      ws.lastSeen = Date.now();
      switch (msg.t) {
        case 'host': {
          if (room) return;
          const code = newCode();
          if (!code) { ws.send({ t: 'err', msg: 'Server busy' }); return; }
          room = {
            code,
            hostWs: ws,
            guestWs: null,
            hostName: sanitizeName(msg.name, 'DUKA'),
            guestName: null,
          };
          isHost = true;
          rooms.set(code, room);
          ws.send({ t: 'hosted', code, name: room.hostName });
          break;
        }
        case 'join': {
          if (room) return;
          let target = null;
          if (msg.code) {
            target = rooms.get(String(msg.code).toUpperCase().trim());
          } else {
            // First open room on the LAN (typical single-game household).
            for (const candidate of rooms.values()) {
              if (!candidate.guestWs) { target = candidate; break; }
            }
          }
          if (!target) { ws.send({ t: 'err', msg: 'No open match found' }); return; }
          room = target;
          room.guestWs = ws;
          room.guestName = sanitizeName(msg.name, 'LAKI');
          isHost = false;
          ws.send({ t: 'joined', code: room.code, opp: room.hostName, name: room.guestName });
          room.hostWs.send({ t: 'start', opp: room.guestName });
          room.guestWs.send({ t: 'start', opp: room.hostName });
          break;
        }
        case 'snap': {
          if (isHost && room?.guestWs) room.guestWs.send(msg);
          break;
        }
        case 'msg': {
          if (isHost && room?.guestWs) room.guestWs.send(msg);
          break;
        }
        case 'in': {
          if (!isHost && room?.hostWs) room.hostWs.send(msg);
          break;
        }
        case 'ping': {
          ws.send({ t: 'pong', now: msg.now });
          break;
        }
        default:
          break;
      }
    },
    () => {
      if (room) dropRoom(room.code, ws);
    }
  );
  ws.touch = () => { ws.lastSeen = Date.now(); };
  ws.socket.on('data', (chunk) => parser.feed(chunk));
}

/* ───────────────────────── server ───────────────────────── */
function sendJson(res, obj) {
  res.writeHead(200, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-cache' });
  res.end(JSON.stringify(obj));
}

function isLocal(req) {
  const addr = req.socket.remoteAddress || '';
  return addr === '127.0.0.1' || addr === '::1' || addr === '::ffff:127.0.0.1';
}

function hostPage(res) {
  res.writeHead(200, { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-cache' });
  res.end(`<!doctype html>
<html lang="en"><head><meta charset="utf-8"/>
<meta name="viewport" content="width=device-width, initial-scale=1"/>
<title>SUNSET SLAM — Match Host</title>
<style>
  :root { color-scheme: dark; }
  * { box-sizing: border-box; }
  body { margin:0; min-height:100vh; display:grid; place-items:center; font-family:Arial, sans-serif;
    background: radial-gradient(circle at 50% 85%, #35234a, #0b1526 55%, #060d18); color:#fff5e6; padding:24px; }
  .card { width:min(680px,100%); background:rgba(8,24,38,.88); border:1px solid rgba(255,211,110,.3);
    border-radius:14px; padding:34px 38px; box-shadow:0 30px 80px rgba(0,0,0,.5); }
  .kicker { color:#ff6846; font-size:11px; letter-spacing:.28em; font-weight:bold; }
  h1 { margin:10px 0 4px; font-size:44px; line-height:.95; }
  h1 span { color:#ffd36e; }
  .sub { color:#94b0ba; margin:6px 0 26px; font-size:14px; }
  .row { display:flex; align-items:center; gap:12px; padding:14px 16px; margin-bottom:10px;
    background:rgba(255,255,255,.045); border:1px solid rgba(255,255,255,.12); border-radius:10px; }
  .row.best { border-color:rgba(91,231,199,.55); background:rgba(91,231,199,.07); }
  .tag { font-size:9px; font-weight:bold; letter-spacing:.18em; padding:4px 8px; border-radius:4px; white-space:nowrap; }
  .tag.ts { color:#072024; background:#5be7c7; }
  .tag.lan { color:#fff5e6; background:rgba(255,255,255,.14); }
  .url { flex:1; font-family:monospace; font-size:15px; color:#ffd36e; word-break:break-all; }
  button { cursor:pointer; border:0; border-radius:6px; padding:10px 14px; font-weight:bold;
    letter-spacing:.1em; font-size:11px; background:#ffd36e; color:#08131d; }
  button:hover { filter:brightness(1.08); }
  button.ghost { background:rgba(255,255,255,.1); color:#fff5e6; }
  button.danger { background:rgba(255,104,70,.16); color:#ff9b80; border:1px solid rgba(255,104,70,.4); }
  .meta { display:flex; gap:22px; margin-top:22px; padding-top:16px; border-top:1px solid rgba(255,255,255,.1);
    color:#94b0ba; font-size:11px; letter-spacing:.14em; }
  .meta b { color:#fff5e6; }
  .ok { color:#5be7c7; font-size:12px; margin-top:14px; min-height:16px; }
</style></head><body>
<div class="card">
  <div class="kicker">MATCH HOST · RUNNING</div>
  <h1>SUNSET <span>SLAM</span></h1>
  <div class="sub">Send Laki one of the addresses below — he opens it, presses JOIN LAKI, and plays.</div>
  <div id="rows"></div>
  <div class="ok" id="ok"></div>
  <div class="meta">
    <span>HOST <b>${hostname()}</b></span>
    <span>UPTIME <b id="uptime">–</b></span>
    <span>PORT <b>${PORT}</b></span>
  </div>
  <div style="margin-top:22px; display:flex; gap:10px;">
    <button class="ghost" onclick="location.href='/'">OPEN THE GAME</button>
    <button class="danger" id="stop">STOP SERVER</button>
  </div>
</div>
<script>
  fetch('/api/status').then(r=>r.json()).then((d)=>{
    const rows = document.getElementById('rows');
    d.addresses.forEach((a, i) => {
      const url = 'http://' + a + ':${PORT}';
      const best = i === 0;
      const row = document.createElement('div');
      row.className = 'row' + (best && a.startsWith('100.') ? ' best' : '');
      row.innerHTML = '<span class="tag ' + (a.startsWith('100.') ? 'ts">TAILSCALE' : 'lan">LOCAL NETWORK') + '</span>' +
        '<span class="url">' + url + '</span>';
      const b = document.createElement('button');
      b.textContent = 'COPY';
      b.onclick = () => { navigator.clipboard.writeText(url); flash('Link copied — send it to Laki'); };
      row.appendChild(b);
      rows.appendChild(row);
    });
    const m = Math.floor(d.uptimeS / 60), s = d.uptimeS % 60;
    document.getElementById('uptime').textContent = m + 'm ' + s + 's';
  });
  function flash(t) { document.getElementById('ok').textContent = t; }
  document.getElementById('stop').onclick = async () => {
    if (!confirm('Stop the match server? Laki will be disconnected.')) return;
    await fetch('/api/stop', { method: 'POST' });
    document.body.innerHTML = '<div class="card"><div class="kicker">MATCH HOST</div><h1>STOPPED</h1><div class="sub">Use the SUNSET SLAM icon to start it again.</div></div>';
  };
  setInterval(() => fetch('/api/status').then(r=>r.json()).then((d)=>{
    const m = Math.floor(d.uptimeS / 60), s = d.uptimeS % 60;
    document.getElementById('uptime').textContent = m + 'm ' + s + 's';
  }).catch(()=>{}), 5000);
</script>
</body></html>`);
}

const server = createServer((req, res) => {
  if (req.headers.upgrade?.toLowerCase() === 'websocket') {
    res.writeHead(426).end('Upgrade required');
    return;
  }
  const url = new URL(req.url, 'http://x');
  if (url.pathname === '/api/status') {
    sendJson(res, { addresses: lanAddresses(), uptimeS: Math.floor((Date.now() - BOOT_TIME) / 1000), port: PORT });
    return;
  }
  if (url.pathname === '/api/stop') {
    if (!isLocal(req)) { res.writeHead(403).end('Local only'); return; }
    sendJson(res, { stopping: true });
    setTimeout(() => process.exit(0), 300);
    return;
  }
  if (url.pathname === '/host') {
    hostPage(res);
    return;
  }
  serveStatic(req, res);
});

server.on('upgrade', (req, socket) => {
  const url = new URL(req.url, 'http://x');
  if (url.pathname !== '/ws') {
    socket.destroy();
    return;
  }
  const key = req.headers['sec-websocket-key'];
  if (!key || req.headers.upgrade?.toLowerCase() !== 'websocket') {
    socket.destroy();
    return;
  }
  socket.write(
    'HTTP/1.1 101 Switching Protocols\r\n' +
    'Upgrade: websocket\r\n' +
    'Connection: Upgrade\r\n' +
    `Sec-WebSocket-Accept: ${acceptKey(key)}\r\n\r\n`
  );
  socket.setNoDelay(true);
  handleConnection(new WsConnection(socket));
});

server.listen(PORT, HOST, () => {
  console.log(`[SUNSET SLAM] serving dist/ + ws on http://${HOST}:${PORT} (ws path /ws)`);
});
