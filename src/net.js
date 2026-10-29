// LAN multiplayer client. One WebSocket to the same origin (/ws); the host
// browser is authoritative and broadcasts snapshots, the guest renders them
// and streams back inputs.

const RECONNECT_DELAY = 1200;

export class NetClient {
  constructor() {
    this.ws = null;
    this.role = null;          // 'host' | 'guest' | null
    this.code = null;
    this.opp = null;
    this.name = null;
    this.connected = false;
    this.inRoom = false;
    this.onMessage = null;
    this.onState = null;       // (status) => void  status: 'connecting'|'open'|'closed'
    this.snapCount = 0;
    this.lastSnapAt = 0;
  }

  _status(s) {
    this.status = s;
    this.onState?.(s);
  }

  connect() {
    if (this.ws && (this.ws.readyState === 0 || this.ws.readyState === 1)) return;
    this._status('connecting');
    const proto = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
    const ws = new WebSocket(`${proto}//${window.location.host}/ws`);
    this.ws = ws;

    ws.onopen = () => {
      this.connected = true;
      this._status('open');
    };
    ws.onclose = () => {
      this.connected = false;
      this._status('closed');
    };
    ws.onerror = () => {
      this._status('closed');
    };
    ws.onmessage = (event) => {
      let msg;
      try {
        msg = JSON.parse(event.data);
      } catch {
        return;
      }
      switch (msg.t) {
        case 'hosted':
          this.role = 'host';
          this.code = msg.code;
          this.name = msg.name;
          this.inRoom = true;
          break;
        case 'joined':
          this.role = 'guest';
          this.code = msg.code;
          this.opp = msg.opp;
          this.name = msg.name;
          this.inRoom = true;
          break;
        case 'start':
          this.opp = msg.opp;
          this.inRoom = true;
          break;
        case 'snap':
          this.snapCount += 1;
          this.lastSnapAt = performance.now();
          break;
        default:
          break;
      }
      this.onMessage?.(msg);
    };
  }

  host(name, sport) {
    this.connect();
    this._pendingHost = name;
    // Send once the socket opens.
    const ws = this.ws;
    const send = () => {
      if (ws.readyState === 1) ws.send(JSON.stringify({ t: 'host', name, sport }));
      else if (ws.readyState === 0) setTimeout(send, 50);
    };
    send();
  }

  join(name, code) {
    this.connect();
    const ws = this.ws;
    const send = () => {
      if (ws.readyState === 1) ws.send(JSON.stringify({ t: 'join', name, code }));
      else if (ws.readyState === 0) setTimeout(send, 50);
    };
    send();
  }

  send(obj) {
    if (this.ws?.readyState === 1) {
      this.ws.send(JSON.stringify(obj));
      return true;
    }
    return false;
  }

  sendSnap(state) {
    return this.send({ t: 'snap', ...state });
  }

  sendInput(input) {
    return this.send({ t: 'in', ...input });
  }

  sendMsg(obj) {
    return this.send({ t: 'msg', ...obj });
  }

  ping() {
    this._pingSent = performance.now();
    return this.send({ t: 'ping', now: this._pingSent });
  }

  dispose() {
    try {
      this.ws?.close();
    } catch {
      /* ignore */
    }
    this.ws = null;
    this.role = null;
    this.code = null;
    this.opp = null;
    this.inRoom = false;
    this.connected = false;
  }
}
