/*
 * What every matrix driver is — LivePremier Plus's `routers/driver.js`, with
 * the socket moved onto the bridge.
 *
 * The drivers beside this file (videohub, lightware, turtle, placeholder) are
 * vendored from LivePremier Plus unchanged. They were written against a Node
 * socket; here a browser page runs them, and a page has no TCP, so this base
 * class opens a link through the bridge (`host.link`, see PLUS in app.js) and
 * gives the drivers the same calls — `write`, `onOpen`, `onData`, `onPoll`,
 * `changed` — they had there. Everything the drivers promise still holds:
 *
 * - **A driver never writes its own state.** `route()` sends and returns;
 *   `state` is only ever what the router said.
 * - **1-based in both directions.** A protocol that counts from 0 (the
 *   Videohub does) converts inside its own driver and nowhere else.
 * - Videohub and LW3 push changes; LW2 and Turtle are polled at the period
 *   the driver declares.
 */

export const STATUS = ['disconnected', 'connecting', 'connected'];

export function emptyState() {
  return { model: '', name: '', inputs: 0, outputs: 0, inputLabels: {}, outputLabels: {}, routing: {}, locks: {} };
}

/** The little of Node's EventEmitter the drivers use. */
class Emitter {
  constructor() { this._ev = new Map(); }
  on(name, fn) { if (!this._ev.has(name)) this._ev.set(name, new Set()); this._ev.get(name).add(fn); return this; }
  off(name, fn) { this._ev.get(name)?.delete(fn); return this; }
  emit(name, ...args) { for (const fn of this._ev.get(name) || []) { try { fn(...args); } catch (err) { console.error(err); } } }
}

/** Set by the plugin: `(kind, host, port) => link`, a host.link. */
let makeLink = null;
export const setTransport = (fn) => { makeLink = fn; };

export class MatrixDriver extends Emitter {
  constructor(options) {
    super();
    this.id = options.id;
    this.name = options.name || options.id;
    this.host = options.host;
    this.port = options.port;
    this.log = options.log ?? (() => {});
    this.pollMs = 0;
    this.current = emptyState();
    this.connectionStatus = 'disconnected';
    this.lastError = null;
    this.link = null;
    this.offs = [];
    this.pollTimer = null;
    this.closing = false;
  }

  static get kind() { return 'abstract'; }
  get kind() { return this.constructor.kind; }
  get status() { return this.connectionStatus; }
  get state() { return this.connectionStatus === 'connected' && this.current.outputs > 0 ? this.current : null; }
  describe() {
    return { id: this.id, name: this.name, kind: this.kind, host: this.host, port: this.port, status: this.connectionStatus, error: this.lastError, state: this.state };
  }

  connect() { this.closing = false; this.open(); }
  close() {
    this.closing = true;
    this.drop();
    this.setStatus('disconnected');
  }
  drop() {
    clearInterval(this.pollTimer); this.pollTimer = null;
    for (const off of this.offs) off();
    this.offs = [];
    if (this.link) { this.link.close(); this.link = null; }
  }

  // The bridge reconnects a dropped link by itself, so this only opens.
  open() {
    this.drop();
    this.setStatus('connecting');
    this.current = emptyState();
    if (!makeLink) { this.lastError = 'no transport'; return; }
    const link = makeLink(this.kind, this.host, this.port);
    this.link = link;
    this.offs.push(link.onData((text) => { try { this.onData(text); } catch (err) { this.log(`${this.id} parse threw: ${err.message}`); } }));
    this.offs.push(link.onStatus((state, detail) => {
      if (this.link !== link) return;
      if (state === 'open') {
        this.lastError = null;
        this.current = emptyState();
        this.setStatus('connected');
        try { this.onOpen(); } catch (err) { this.log(`${this.id} onOpen threw: ${err.message}`); }
        clearInterval(this.pollTimer);
        if (this.pollMs) this.pollTimer = setInterval(() => { try { this.onPoll(); } catch (err) { this.log(`${this.id} poll threw: ${err.message}`); } }, this.pollMs);
      } else {
        if (state === 'error') this.lastError = detail || 'error';
        clearInterval(this.pollTimer); this.pollTimer = null;
        this.setStatus('disconnected');
      }
    }));
    link.open();
  }

  setStatus(status) {
    if (this.connectionStatus === status) return;
    this.connectionStatus = status;
    this.emit('status', status);
    this.emit('change', this.describe());
  }
  changed() { this.emit('state', this.current); this.emit('change', this.describe()); }
  write(text) {
    if (!this.link || this.connectionStatus !== 'connected') { this.log(`${this.id}: dropped a command — not connected`); return false; }
    this.link.send(text);
    return true;
  }

  onOpen() {}
  onData() {}
  onPoll() {}
  onIdle() { this.onPoll(); }
  route() { throw new Error('route() not implemented'); }
}

/** Feed bytes in, get whole lines out. CRLF and bare LF both terminate. */
export class LineParser {
  constructor() { this.buffer = ''; }
  push(chunk) {
    this.buffer += chunk;
    const out = [];
    let index;
    while ((index = this.buffer.indexOf('\n')) >= 0) {
      const raw = this.buffer.slice(0, index);
      this.buffer = this.buffer.slice(index + 1);
      out.push(raw.endsWith('\r') ? raw.slice(0, -1) : raw);
    }
    if (this.buffer.length > 64 * 1024) this.buffer = '';
    return out;
  }
}
