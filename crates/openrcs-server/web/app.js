// openrcs control surface — vanilla ES module, no build step.

// ---------- tiny DOM helper ----------
function el(tag, props = {}, ...kids) {
  const n = document.createElement(tag);
  // allow el('h2', 'text') / el('div', node) — a non-plain-object 2nd arg is a child
  if (props == null || typeof props !== 'object' || props.nodeType || Array.isArray(props)) {
    kids = [props, ...kids];
    props = {};
  }
  for (const [k, v] of Object.entries(props)) {
    if (k === 'class') n.className = v;
    else if (k === 'text') n.textContent = v;
    else if (k === 'html') n.innerHTML = v;
    else if (k.startsWith('on')) n.addEventListener(k.slice(2), v);
    else if (v !== null && v !== undefined && v !== false) n.setAttribute(k, v === true ? '' : v);
  }
  for (const c of kids.flat()) {
    if (c === null || c === undefined || c === false) continue;
    n.append(c.nodeType ? c : document.createTextNode(c));
  }
  return n;
}
const keyOf = (m, idx) => m + '|' + idx.join(',');

// ---------- known LiveCore device models (by DEV_PLATFORM id) ----------
// LiveCore resolves its model from PDEV; Midra has no PDEV and instead
// reports a device code via DEV (259 = Pulse2, confirmed on hardware).
const MODELS = {
  97: 'NeXtage 16', 96: 'NeXtage 08',
  98: 'Ascender 16', 99: 'Ascender 32', 100: 'Ascender 48',
  101: 'SmartMatriX Ultra', 112: 'VIO 4K',
};
const MIDRA_MODELS = {
  259: 'Pulse2',
};
// Model names the LivePremier reports for itself. NLC is the family prefix on
// every one of them, so the map is by the part that differs.
const AWJ_MODELS = {
  NLC_C: 'Aquilon C', NLC_CPLUS: 'Aquilon C+', NLC_CMAX: 'Aquilon Cmax',
  NLC_CMINI: 'Aquilon Cmini',
  NLC_RS1: 'Aquilon RS1', NLC_RS2: 'Aquilon RS2', NLC_RS3: 'Aquilon RS3',
  NLC_RS4: 'Aquilon RS4', NLC_RS5: 'Aquilon RS5', NLC_RS6: 'Aquilon RS6',
  NLC_RSALPHA: 'Aquilon RS alpha',
};

function deviceModel() {
  if (isAwj()) {
    const dev = store.pval(LP.model());
    if (typeof dev !== 'string') return '—';
    return AWJ_MODELS[dev] || dev;
  }
  const pdev = store.val('PDEV');
  if (pdev != null) return MODELS[pdev] || `device ${pdev}`;
  const dev = store.val('DEV');
  if (dev != null) return MIDRA_MODELS[dev] || `Midra device ${dev}`;
  return '—';
}

// ---------- platform capabilities (LiveCore vs Midra) ----------
// Derived from the variable table the device advertised, so the same UI drives
// both platforms. LiveCore takes by sweeping the T-bar (GCtba) on a group index
// (see animateTbar); Midra takes with GCtak per screen. Midra has no PRlay
// (layer-select) and its source
// assignment is device-managed (a direct PRinp write reverts).
const screenCount = () => store.byMnem.get('SCmly')?.dims[0] || store.byMnem.get('PRinp')?.dims[0] || 8;
const layerSlots = () => { const d = store.byMnem.get('PRinp')?.dims; return (d && d[d.length - 1]) || 24; };
const srcMaxOf = () => store.byMnem.get('PRinp')?.max ?? 41;
const inputCount = () => store.byMnem.get('INava')?.dims[0] || 24;
const outputCount = () => store.byMnem.get('OUava')?.dims[0] || 8;
const hasPRlay = () => store.byMnem.has('PRlay');
// Physical connector behind each INplg value. Fixed per platform: every LiveCore
// input card carries the same six plugs, every Midra input the same five.
const PLUG_NAMES = {
  livecore: ['Analog (HD15)', 'DVI-A', 'DVI-D', 'SDI', 'HDMI', 'DisplayPort'],
  midra: ['Analog (HD15)', 'DVI', 'SDI', 'HDMI', 'HDBaseT'],
};
const plugName = (p) => PLUG_NAMES[store.meta?.platform]?.[p] ?? 'Plug ' + (p + 1);
const plugCount = () => store.byMnem.get('INpav')?.dims[1] || ((store.byMnem.get('INplg')?.max ?? 5) + 1);
// A layer shows because it has a source. PRlay is the RCS's multi-layer *edit
// selection*, not visibility — reading it as "shown" hides live layers.
const layerShown = (s, ctx, l) => (store.val('PRinp', s, ctx, l) || 0) > 0;

// ---------- LiveCore preset banks ----------
// PRinp[s,0], [s,1], [s,2] are the fixed preset buffers PA, PB and PC — a take does
// not swap their contents. GCsta says which one is on air, so "program" is a bank the
// device names, not a constant index. GC* are indexed by group, and Plngr maps a
// screen to its group (identity unless screens have been grouped).
// Verified on a NeXtage 16; see docs/PROTOCOL.md.
const GRP_AT_DOWN = 0, GRP_AT_UP = 1, GRP_FROM_DOWN = 2, GRP_FROM_UP = 3;
const hasBanks = () => store.byMnem.has('GCsta');
const groupOf = (s) => store.val('Plngr', s) ?? s;
/** Preset index currently on air for a screen (Midra has one program context). */
function liveCtx(s) {
  if (!hasBanks()) return 0;
  const st = store.val('GCsta', groupOf(s));
  return (st === GRP_AT_UP || st === GRP_FROM_UP) ? 1 : 0;
}
/** Preset index safe to edit — the one that isn't on air. */
const editCtx = (s) => hasBanks() ? 1 - liveCtx(s) : 1;
const midTransition = (s) => {
  const v = store.val('GCsta', groupOf(s));
  return v === GRP_FROM_DOWN || v === GRP_FROM_UP;
};
/** Take: transition to whichever bank is not currently live. */
// The device's own auto-take verbs (GCtku/GCtkd) do NOT animate on real
// LiveCore hardware — firing one leaves the group stuck in EFFECT_FROM_* with
// the T-bar frozen (confirmed on a NeXtage 16, sole session, both with and
// without AUTO_TAKE). The manual T-bar (GCtba) is the mechanism that actually
// transitions, so a take is a client-driven sweep of GCtba from the live end to
// the target end over the transition time; a cut jumps straight there.
const GCTBA_MAX = 65535;
const _tbarAnim = {};   // group -> interval id, so a new take cancels a running one
function stopTbarAnim(g) { if (_tbarAnim[g]) { clearInterval(_tbarAnim[g]); delete _tbarAnim[g]; } }
function animateTbar(g, to, ttime) {
  stopTbarAnim(g);
  // Where the bar is now: the cached value, or inferred from the live bank.
  const from = store.val('GCtba', g) ?? (groupLiveCtx(g) === 1 ? GCTBA_MAX : 0);
  if (!ttime || ttime <= 0 || from === to) { store.set('GCtba', [g], to); return; }
  const start = performance.now();
  const tick = () => {
    const t = Math.min(1, (performance.now() - start) / ttime);
    store.set('GCtba', [g], Math.round(from + (to - from) * t));
    if (t >= 1) stopTbarAnim(g);
  };
  _tbarAnim[g] = setInterval(tick, 45);   // ~22 fps; final tick lands exactly on `to`
  tick();
}
function doTake(screen, ttime) {
  CONFIDENCE.autoSnapshot('before take');            // opt-in undo point, no-op unless armed
  if (!hasBanks()) {                                   // Midra: one-way take per screen
    if (ttime != null && store.byMnem.has('GCtup')) store.set('GCtup', [screen], ttime);
    store.set('GCtak', [screen], 1);
    return;
  }
  const g = groupOf(screen), to = editCtx(screen);    // to = bank we're bringing live
  animateTbar(g, to === 1 ? GCTBA_MAX : 0, ttime);
}
/** Cut: jump the bar straight to the target end. */
function doCut(screen) {
  CONFIDENCE.autoSnapshot('before cut');
  if (!hasBanks()) { store.set('GCtak', [screen], 1); return; }
  const g = groupOf(screen), to = editCtx(screen);
  animateTbar(g, to === 1 ? GCTBA_MAX : 0, 0);
}
/** Complete a transition immediately by snapping the bar to the target end. */
function forceTake(screen) {
  if (!hasBanks()) return;
  const g = groupOf(screen), to = editCtx(screen);
  animateTbar(g, to === 1 ? GCTBA_MAX : 0, 0);
}
/** Manual T-bar, 0 = the DOWN bank (PA) fully on, 65535 = the UP bank (PB). */
function setTbar(screen, v) { if (store.byMnem.has('GCtba')) store.set('GCtba', [groupOf(screen)], v); }
function tbarValue(screen) { return store.val('GCtba', groupOf(screen)) ?? 0; }
/** Step a screen back to the look it had before the last take. */
function doStepBack(screen) {
  if (store.byMnem.has('GCstb')) store.set('GCstb', [groupOf(screen)], 1);   // LiveCore
  else if (store.byMnem.has('GCsba')) store.set('GCsba', [screen], 1);       // Midra
}

// ---------- Screen groups / super-destinations ----------
// A group (0..15) is a destination that takes several screens at once. Plngr
// maps each screen to a group; the GC* take verbs are indexed by group. These
// mirror the per-screen take helpers but drive a group index directly.
const activeScreens = () => Array.from({ length: screenCount() }, (_, s) => s).filter(s => (store.val('SCssh', s) || 0) > 0);
const groupCount = () => store.byMnem.get('GCsta')?.dims[0] || 16;
// [ [group, [screens…]] ], only groups that actually hold an active screen.
function activeGroups() {
  const seen = new Map();
  for (const s of activeScreens()) {
    const g = store.val('Plngr', s) ?? s;
    if (!seen.has(g)) seen.set(g, []);
    seen.get(g).push(s);
  }
  return [...seen.entries()].sort((a, b) => a[0] - b[0]);
}
const groupLiveCtx = (g) => hasBanks() ? ((store.val('GCsta', g) === GRP_AT_UP || store.val('GCsta', g) === GRP_FROM_UP) ? 1 : 0) : 0;
const groupTransitioning = (g) => { const v = store.val('GCsta', g); return v === GRP_FROM_DOWN || v === GRP_FROM_UP; };
function groupTake(g, ttime) {
  if (!hasBanks()) return;
  const to = 1 - groupLiveCtx(g);          // target bank: opposite of what's live
  animateTbar(g, to === 1 ? GCTBA_MAX : 0, ttime);
}
function groupCut(g) {
  if (!hasBanks()) return;
  const to = 1 - groupLiveCtx(g);
  animateTbar(g, to === 1 ? GCTBA_MAX : 0, 0);
}
const groupTbar = (g, v) => { if (store.byMnem.has('GCtba')) store.set('GCtba', [g], v); };
const groupStepBack = (g) => { if (store.byMnem.has('GCstb')) store.set('GCstb', [g], 1); };
const commitGroups = () => { if (store.byMnem.has('GCupd')) store.set('GCupd', [], 1); };

// ---------- store ----------
class Store {
  constructor() {
    this.state = new Map();          // "MNEM|i,i" -> value
    // LivePremier addresses everything by path and answers with arbitrary
    // JSON, so it gets its own map rather than being squeezed into state's
    // mnemonic+index key. Only one of the two is ever in use.
    this.paths = new Map();          // AWJ path -> JSON value
    this.awjErr = null;              // {code, msg} of the last NAK
    this.byMnem = new Map();         // mnemonic -> def
    this.byGroup = new Map();        // group -> [def]
    this.meta = null;
    this.connected = false;
    this.log = [];                   // {dir, text}
    this.listeners = new Set();
    this._pending = false;
    // Plan mode: while on, sets stage into planState instead of hitting the
    // device, and reads prefer the staged value — so a whole look can be built
    // offline and pushed on connect. Persisted, so a reload keeps staged work.
    // See pushPlan / clearPlan.
    this.plan = false;
    this.planState = new Map();       // "MNEM|i,i" -> staged value
    // Connection setup (the appliance case: no keyboard, no shell, so the
    // processor is chosen from the UI). Empty on a bridge started with --device.
    this.found = new Map();           // discovered "host:port" -> platform | null
    this.scanning = false;
    this.setupError = null;
    // Tailnet, only on a bridge started with --tailnet (an appliance that owns
    // the box it runs on). Everything here stays inert otherwise.
    this.tailnetStatus = null;        // {state, name, addr} once the server answers
    this.tailnetErr = '';
    this.tailnetBusy = false;
    this._loadPlan();
    this.connect();
  }

  // False only when the bridge has no processor yet. Undefined — an older
  // bridge, or the hosted demo — counts as configured, so nothing changes for
  // them.
  get configured() { return !this.meta || this.meta.configured !== false; }

  // Point the bridge at a processor. The server persists it and re-seeds us.
  setup(device, platform) {
    this.setupError = null;
    this.send({ t: 'setup', device, platform });
    this.notify();
  }

  // True only when the bridge was started with --tailnet. An older bridge has
  // no such field, so this is false and the view never appears.
  get tailnetEnabled() { return !!this.meta?.tailnet; }

  // Look at or change the tailnet membership of the host running the bridge.
  // Results arrive as a 'tailnet' message and are broadcast to every open
  // surface, not just this one.
  tailnet(action, value = '') {
    this.tailnetErr = '';
    if (action !== 'status') this.tailnetBusy = true;
    this.send({ t: 'tailnet', action, value });
    this.notify();
  }

  // Ask the bridge to sweep its own network for processors. Read-only at the
  // far end — see the server's discovery notes.
  discover() {
    this.found.clear();
    this.scanning = true;
    this.send({ t: 'discover' });
    this.notify();
  }
  _loadPlan() {
    try {
      const p = JSON.parse(localStorage.getItem('openrcs.plan') || '{}');
      this.plan = !!p.on;
      for (const [k, v] of (p.entries || [])) this.planState.set(k, v);
    } catch { /* first run / private mode */ }
  }
  _persistPlan() {
    try { localStorage.setItem('openrcs.plan', JSON.stringify({ on: this.plan, entries: [...this.planState] })); } catch { /* quota/private */ }
  }
  connect() {
    // The hosted demo has no bridge server to reach — a browser cannot open a
    // TCP socket to a processor — so it installs a simulated device under the
    // same interface. Absent that, this is the real link and nothing changes.
    this.ws = globalThis.OPENRCS_DEMO_DEVICE
      ? globalThis.OPENRCS_DEMO_DEVICE()
      : new WebSocket(`ws://${location.host}/ws`);
    this.ws.onmessage = (e) => this.onMsg(JSON.parse(e.data));
    this.ws.onclose = () => { this.connected = false; this.notify(); setTimeout(() => this.connect(), 1500); };
  }
  onMsg(m) {
    switch (m.t) {
      case 'meta': {
        // A second meta means the bridge is pointed somewhere else now. Every
        // view keeps its own cached idea of the device — fetched slots,
        // capability probes, selected screens — and a platform change swaps the
        // variable table underneath all of it. Reloading is the one reset that
        // cannot miss a corner of that state.
        if (this.meta && (this.meta.device !== m.device || this.meta.platform !== m.platform)) {
          location.reload();
          return;
        }
        this.meta = m;
        this.byMnem.clear();
        this.byGroup.clear();
        this.state.clear();
        for (const v of m.vars) {
          this.byMnem.set(v.m, v);
          if (!this.byGroup.has(v.group)) this.byGroup.set(v.group, []);
          this.byGroup.get(v.group).push(v);
        }
        onReady();
        break;
      }
      case 'found':
        this.found.set(m.addr, m.platform || null);
        break;
      case 'scanned':
        this.scanning = false;
        break;
      case 'setuperr':
        this.setupError = m.reason;
        break;
      case 'tailnet':
        this.tailnetStatus = { state: m.state || '', name: m.name || '', addr: m.addr || '' };
        this.tailnetErr = m.err || '';
        this.tailnetBusy = !!m.busy;
        break;
      case 'snap':
        for (const [mn, i, v] of m.items) this.state.set(keyOf(mn, i), v);
        break;
      case 'psnap':
        for (const [path, v] of m.items) this.paths.set(path, v);
        break;
      case 'pval':
        this.paths.set(m.p, m.v);
        this.pushLog('rx', `${m.p} = ${JSON.stringify(m.v)}`);
        break;
      case 'perr':
        // E12 is how the device says "no such path on this build", which the
        // connect-time inventory provokes on purpose. Logged, not raised.
        this.awjErr = { code: m.code, msg: m.msg };
        this.pushLog('er', `${m.code} ${m.msg}`);
        break;
      case 'val':
        this.state.set(keyOf(m.m, m.i), m.v);
        this.pushLog('rx', `${m.m}${m.i.length ? ' ' + m.i.join(',') : ''} = ${m.v}`);
        break;
      case 'err':
        this.pushLog('er', `E${m.code}`);
        break;
      case 'status':
        this.connected = m.connected;
        break;
    }
    this.notify();
  }
  pushLog(dir, text) {
    this.log.push({ dir, text });
    if (this.log.length > 400) this.log.shift();
  }
  // value accessor, by answer mnemonic (what the device sends). In plan mode a
  // staged value shadows the device's, so the UI reflects the planned look.
  val(m, ...idx) {
    const k = keyOf(m, idx);
    if (this.plan && this.planState.has(k)) return this.planState.get(k);
    return this.state.get(k);
  }
  arr(m, n) { return Array.from({ length: n }, (_, i) => this.val(m, i)); }

  send(o) { if (this.ws.readyState === 1) this.ws.send(JSON.stringify(o)); }
  set(m, idx, v) {
    if (this.plan) {                 // stage, don't send
      this.planState.set(keyOf(m, idx), v);
      this._persistPlan();
      this.pushLog('pl', `${m} ${[...idx, v].join(',')}`);
      this.notify();
      return;
    }
    this.send({ t: 'set', m, i: idx, v });
    this.pushLog('tx', `${m} ${[...idx, v].join(',')}`);
  }
  get(m, idx = []) { this.send({ t: 'get', m, i: idx }); }

  // ---- LivePremier (AWJ). Addressed by path; values are JSON.
  pval(path, fallback = undefined) {
    const v = this.paths.get(path);
    return v === undefined ? fallback : v;
  }
  pget(path) { this.send({ t: 'pget', p: path }); }
  pset(path, v) {
    this.send({ t: 'pset', p: path, v });
    this.pushLog('tx', `${path} = ${JSON.stringify(v)}`);
  }
  // Nothing about state changes reaches us until this is written: the device's
  // subscription list starts empty. Prefix matched, so one path per subtree.
  psub(paths) { this.send({ t: 'psub', paths }); }
  scan(m) { this.send({ t: 'scan', m }); }
  raw(d) { this.send({ t: 'raw', d: d.endsWith('\n') ? d : d + '\n' }); this.pushLog('tx', d); }

  // ---- plan mode ----
  setPlan(on) { this.plan = !!on; this._persistPlan(); this.notify(); }
  planList() {
    const out = [];
    for (const [k, v] of this.planState) {
      const bar = k.indexOf('|'); const m = k.slice(0, bar); const idxStr = k.slice(bar + 1);
      out.push({ m, idx: idxStr === '' ? [] : idxStr.split(',').map(Number), v, name: this.byMnem.get(m)?.name || m });
    }
    return out;
  }
  clearPlan() { this.planState.clear(); this._persistPlan(); this.notify(); }
  // Send every staged value to the device for real, then clear the plan.
  async pushPlan(onProgress) {
    const wasPlan = this.plan;
    this.plan = false;               // sends go to the device now
    const entries = this.planList();
    for (let i = 0; i < entries.length; i++) {
      const e = entries[i];
      this.send({ t: 'set', m: e.m, i: e.idx, v: e.v });
      this.pushLog('tx', `${e.m} ${[...e.idx, e.v].join(',')}`);
      if (onProgress) onProgress((i + 1) / entries.length);
      if ((i & 15) === 15) await sleep(30);
    }
    this.planState.clear();
    this.plan = wasPlan;
    this._persistPlan();
    this.notify();
    return entries.length;
  }
  // Stage the current look (from cache) as a starting point for a plan.
  seedPlanFromLook() {
    if (!this.plan) this.setPlan(true);
    for (const [m, idx, v] of captureFromCache(['look']).values) this.set(m, idx, v);
  }

  subscribe(fn) { this.listeners.add(fn); }
  notify() {
    if (DRAG) { this._deferred = true; return; }   // don't rebuild a slider mid-drag
    if (this._pending) return;
    this._pending = true;
    // coalesce with rAF, but fall back to a timer: rAF is throttled to zero in a
    // backgrounded tab, and a control surface must still reflect device state.
    const run = () => { if (!this._pending) return; this._pending = false; this.listeners.forEach(f => f()); };
    requestAnimationFrame(run);
    setTimeout(run, 50);
  }
}

// suppress re-render while a slider thumb is held, so the drag isn't interrupted
let DRAG = false;
function beginDrag() { DRAG = true; }
function endDrag() { DRAG = false; if (store._deferred) { store._deferred = false; store.notify(); } }
// safety net: a pointer release or cancel anywhere ends a drag, so a missed
// pointerup (pointer left the control/window) can never freeze the UI's renders
window.addEventListener('pointerup', () => { if (DRAG) endDrag(); }, true);
window.addEventListener('pointercancel', () => { if (DRAG) endDrag(); }, true);
window.addEventListener('blur', () => { if (DRAG) endDrag(); });

// ---------- app shell ----------
const store = new Store();
// debug handle: the same data path the UI uses, for scripting/inspection
window.openrcs = { store, get VIEWS() { return VIEWS; }, get view() { return currentView; } };
const VIEW_IDS = ['lpscreens', 'lppresets', 'showmode', 'workspace', 'stage', 'wall', 'memories', 'cues', 'keys', 'live', 'layers', 'destinations', 'shows', 'plan', 'connection', 'tally', 'inputs', 'outputs', 'screens', 'stills', 'capture', 'multiview', 'softedge', 'edid', 'audio', 'gpio', 'system', 'inspector', 'console', 'videoout'];
const viewFromHash = () => { const h = location.hash.slice(1); return VIEW_IDS.includes(h) ? h : null; };
let currentView = viewFromHash() || 'stage';
let navCollapsed = (() => { try { return localStorage.getItem('orcs.nav') === '1'; } catch { return false; } })();
const VIEWS = {};

function switchView(id) {
  currentView = id;
  if (location.hash.slice(1) !== id) location.hash = id;
  VIEWS[id].enter?.();
  render();
}
window.addEventListener('hashchange', () => {
  const v = viewFromHash();
  if (v && v !== currentView) switchView(v);
});

function onReady() {
  if (!isAwj()) {
    store.get('?');          // DEV
    store.get('!');          // DEV_PLATFORM -> PDEV
  }
  VIEWS[effectiveView()].enter?.();
}

function header() {
  // Before a processor is chosen there is no model and no platform. Showing the
  // default table's platform there would be a confident lie on a panel whose
  // whole state is "not set up yet".
  const model = store.configured ? deviceModel() : 'no processor';
  const plat = store.configured && store.meta ? store.meta.platform : '';
  return el('header', { class: 'head' },
    el('button', {
      class: 'nav-toggle', title: navCollapsed ? 'Show menu' : 'Hide menu',
      'aria-label': navCollapsed ? 'Show menu' : 'Hide menu',
      onclick: () => { navCollapsed = !navCollapsed; try { localStorage.setItem('orcs.nav', navCollapsed ? '1' : '0'); } catch { /* private mode */ } render(); },
    }, el('span', { class: 'burger' })),
    el('div', { class: 'brand', html: 'open<span>rcs</span>' }),
    el('div', { class: 'dev-id' },
      el('div', { class: 'model', text: model }),
      el('div', { class: 'sub', text: plat ? `${plat.toUpperCase()} · :${store.meta?.port ?? ''}` : 'not configured' })),
    el('div', { class: 'spacer' }),
    store.plan
      ? el('button', { class: 'chip plan', title: 'Plan mode — edits are staged, not sent. Open Plan to push.',
          onclick: () => switchView('plan') },
          el('span', { class: 'dot' }), `PLAN · ${store.planState.size}`)
      : el('div', { class: 'legend' },
          el('span', { class: 'pgm' }, el('b'), 'program'),
          el('span', { class: 'pvw' }, el('b'), 'preview')),
    el('div', { class: 'chip ' + (store.connected ? 'on' : 'off') },
      el('span', { class: 'dot' }), store.connected ? 'ONLINE' : 'OFFLINE'));
}

const NAV = [
  { section: 'LivePremier' },
  ['lpscreens', 'Screens'], ['lppresets', 'Presets'],
  { section: 'Program' },
  ['showmode', 'Show mode'], ['workspace', 'Workspace'], ['stage', 'Stage'], ['wall', 'Wall'], ['memories', 'Memories'], ['cues', 'Cues'], ['keys', 'Keys'], ['live', 'Live'], ['layers', 'Layers'], ['destinations', 'Destinations'],
  { section: 'Setup' },
  ['connection', 'Connection'], ['tailnet', 'Tailnet'], ['tally', 'Tally'], ['inputs', 'Inputs'], ['outputs', 'Outputs'], ['videoout', 'Video out'], ['screens', 'Screens'],
  ['stills', 'Stills'], ['capture', 'Capture'], ['multiview', 'Multiviewer'], ['softedge', 'Soft edge'], ['edid', 'EDID'], ['audio', 'Audio'], ['gpio', 'GPIO'], ['system', 'System'],
  { section: 'Tools' },
  ['shows', 'Shows'], ['plan', 'Plan'], ['inspector', 'Inspector'], ['console', 'Console'],
];

// a view is shown only when the device advertises the variable it needs
// (until meta arrives, show everything so the nav doesn't flicker empty)
const VIEW_REQUIRES = {
  memories: () => store.byMnem.has('PSmet') || store.byMnem.has('PMpst'),  // LiveCore or Midra
  cues: 'PMscf', keys: 'PMscf', tally: 'TAopr',
  stills: () => store.byMnem.has('Slval') || store.byMnem.has('PSfrv'),  // LiveCore or Midra
  capture: 'STcen', multiview: 'MLcen',
  // the video out is a Midra thing, and not every frame in the range has one
  videoout: () => store.byMnem.has('VOmod'),
  // the soft-edge view models LiveCore's per-edge SEcen[screen,edge]; Midra's
  // soft edge is a different (scalar) model, so gate on an indexed SEcen
  softedge: () => (store.byMnem.get('SEcen')?.dims.length || 0) > 0,
  edid: 'EIspf', audio: 'AUile', gpio: 'GPoav',
  // shown whenever a live-look scope exists — true on both platforms
  shows: () => store.byGroup.has('PRESET') || store.byGroup.has('GRP_PRESET_ELEMENT'),
  destinations: 'GCsta',   // screen-group take model (LiveCore)
  wall: 'OSpoh',           // screen output-position map (LiveCore)
};
const viewSupported = (id) => {
  // Not a capability of the processor like the rest of this table — it is a
  // property of the machine the bridge runs on, and it is off unless that
  // machine is an appliance the surface owns. Checked before `configured`,
  // because getting a panel back onto the tailnet is exactly the thing you may
  // need to do before it can reach any processor at all.
  if (id === 'tailnet') return store.tailnetEnabled;
  if (!store.configured) return id === 'connection';
  // The two families share the shell — header, nav, Connection — and nothing
  // else. A view built on the mnemonic variable table has nothing to render on
  // a processor that has no such table, so each family sees only its own.
  const lp = id.startsWith('lp');
  if (isAwj() !== lp) return isAwj() ? id === 'connection' : !lp;
  const req = VIEW_REQUIRES[id];
  if (!req || !store.meta) return true;
  return typeof req === 'function' ? req() : store.byMnem.has(req);
};

// What is actually on screen. A stale hash (or a bookmark) must not strand an
// unconfigured appliance on a blank view it cannot navigate away from.
const effectiveView = () => {
  // A hash, a bookmark or a retarget can leave the surface on a view this
  // family does not have. Fall back to its first rather than to a blank frame.
  if (store.configured && !viewSupported(currentView)) {
    return isAwj() ? 'lpscreens' : 'stage';
  }
  if (store.configured) return currentView;
  // Unconfigured, so everything else is an empty shell — except Tailnet, which
  // is how a panel that cannot see its processor gets reachable again.
  return currentView === 'tailnet' && store.tailnetEnabled ? 'tailnet' : 'connection';
};

function nav() {
  const n = el('nav', { class: 'nav' });
  let section = null, sectionShown = false;
  for (const item of NAV) {
    if (item.section) { section = item.section; sectionShown = false; continue; }
    const [id, label] = item;
    if (!viewSupported(id)) continue;
    if (section && !sectionShown) { n.append(el('div', { class: 'nav-sec', text: section })); sectionShown = true; }
    n.append(el('button', {
      class: id === effectiveView() ? 'active' : '',
      onclick: () => switchView(id),
    }, label));
  }
  n.append(el('div', { class: 'grow' }));
  n.append(el('div', {
    class: 'foot',
    text: !store.meta ? 'connecting…'
      : isAwj() ? `${store.paths.size} properties`
      : `${store.byMnem.size} vars`,
  }));
  return n;
}

function render() {
  const root = document.getElementById('app');
  // preserve focus + caret across full re-render (device frames re-render us)
  const act = document.activeElement;
  const fid = act && act.id ? act.id : null;
  const selS = fid ? act.selectionStart : null;
  const selE = fid ? act.selectionEnd : null;

  root.classList.toggle('nav-hidden', navCollapsed);
  root.replaceChildren(
    header(),
    nav(),
    el('main', { class: 'main' }, VIEWS[effectiveView()].render()),
  );

  if (fid) {
    const next = document.getElementById(fid);
    if (next) {
      next.focus();
      if (selS != null && next.setSelectionRange) {
        try { next.setSelectionRange(selS, selE); } catch { /* non-text input */ }
      }
    }
  }
}

store.subscribe(() => render());

// ================= views =================

const flagOn = (v, bit) => ((v ?? 0) >>> bit & 1) === 1;
const flagSet = (v, bit, on) => on ? ((v ?? 0) | (1 << bit)) >>> 0 : ((v ?? 0) & ~(1 << bit)) >>> 0;

// PEMEM_CATEGORY — the bit layout of PMcat, the preset-memory load/save filter.
const MEM_FILTERS = [
  ['Source', 0], ['Pos/size', 1], ['Transparency', 2], ['Crop', 3], ['Border', 4],
  ['Transitions', 5], ['Effects', 6], ['Timing', 7], ['Speed', 8], ['Flying curve', 9],
  ['Native bkg', 10], ['Mask', 11],
];
const MEM_FILTER_ALL = 4095;

// ---------- working area ----------
// Neither platform can crop an output. LiveCore's OUTPUT_AOI_SIZE has no Midra
// counterpart at all, and the Midra video out's own area of interest exists only
// in its recording mode, which is standard definition — so on a frame whose SDI
// plug is carrying an output (CTvom 1 or 2) there is no hardware crop to be had
// at HD. When the picture that matters is a region of a screen, the constraint
// has to live on this side instead: openrcs composes inside the region and the
// device is simply never told why its layers never go near the edges.
//
// A convention, not a device setting. Nothing is written to establish one, and a
// screen without a working area behaves exactly as it did before.
const WORK_AREA = (() => {
  const KEY = 'openrcs.workarea';
  let areas = {};                       // screen index -> {x, y, w, h}, screen pixels
  try { areas = JSON.parse(localStorage.getItem(KEY) || '{}') || {}; } catch { /* first run */ }
  const persist = () => { try { localStorage.setItem(KEY, JSON.stringify(areas)); } catch { /* quota/private */ } };

  const get = (s) => areas[s] || null;
  const has = (s) => !!areas[s];
  const count = () => Object.keys(areas).length;
  function set(s, rect) {
    areas[s] = { x: Math.round(rect.x), y: Math.round(rect.y), w: Math.round(rect.w), h: Math.round(rect.h) };
    persist();
  }
  function clear(s) { delete areas[s]; persist(); }

  /**
   * Fit a layer rectangle inside the screen's working area.
   *
   * Size is clamped before position, so a layer pushed at the boundary slides
   * along it instead of shrinking — which is what dragging one into a corner
   * should feel like. This is the backstop: every placement path in the two
   * layer views funnels through setGeom, so nothing can escape the region even
   * if it was positioned by a numeric field or a memory recall.
   */
  function fit(s, r) {
    const a = get(s);
    if (!a) return r;
    const w = Math.min(r.w, a.w), h = Math.min(r.h, a.h);
    return {
      w, h,
      left: Math.max(a.x, Math.min(a.x + a.w - w, r.left)),
      top: Math.max(a.y, Math.min(a.y + a.h - h, r.top)),
    };
  }

  const snapshot = () => ({ ...areas });
  function restore(o) { if (o && typeof o === 'object') { areas = { ...o }; persist(); } }
  return { get, has, set, clear, count, fit, snapshot, restore };
})();

/**
 * The rectangle layers are composed into: the working area if the screen has
 * one, otherwise the whole screen. Layout presets measure against this rather
 * than the raster, so "Fill" fills the region that is actually seen.
 */
function workPx(s) {
  const a = WORK_AREA.get(s);
  if (a) return { x: a.x, y: a.y, w: a.w, h: a.h };
  const w = store.val('SCssh', s) || 1920, h = store.val('SCssv', s) || 1080;
  return { x: 0, y: 0, w, h };
}

/**
 * The working area drawn over a screen canvas, as an overlay the mouse ignores.
 * Positioned in percentages so it sits correctly on the pixel-scaled canvas in
 * Layers and the percentage-laid-out ones in Workspace and Stage alike.
 */
function workOverlay(s, sw, sh, withTag = true) {
  const a = WORK_AREA.get(s);
  if (!a || !sw || !sh) return null;
  const pc = (v, of) => (v / of * 100) + '%';
  return el('div', {
    class: 'work-area',
    style: `left:${pc(a.x, sw)};top:${pc(a.y, sh)};width:${pc(a.w, sw)};height:${pc(a.h, sh)}`,
  }, withTag ? el('span', { class: 'work-area-tag', text: `${a.w}×${a.h}` }) : null);
}

// ---------- layer memories ----------
// Neither platform has a device-side layer bank: the device stores whole screen
// presets (PM*) and nothing smaller. Every per-layer property is separately
// addressable as PR*[screen, preset, layer] though, so one layer's worth of
// state can be captured and re-applied anywhere. That makes this a client-side
// bank, kept alongside Cues and Keys, and it works the same on LiveCore's 24
// layers and Midra's 8.

// Which PMcat category each leaf answers to, so a layer memory recalls under
// the same filter chips as a screen memory. Native background (bit 10) has no
// layer equivalent — it is a property of the screen, not of a layer.
const LAYER_CAT = {
  PRinp: 0,
  PRpoh: 1, PRpov: 1, PRpoz: 1, PRsih: 1, PRsiv: 1, PRroh: 1, PRrov: 1, PRroz: 1,
  PRalp: 2,
  PRcph: 3, PRcpv: 3, PRcsh: 3, PRcsv: 3,
  PRbst: 4, PRbcr: 4, PRbcg: 4, PRbcb: 4, PRbal: 4, PRbsh: 4, PRbsv: 4, PRshp: 4,
  PRotr: 5, PRowa: 5, PRctr: 5, PRcwa: 5,
  PRflg: 6, PRaov: 6, PRsmm: 6, PRfli: 6, PRftr: 6,
  PRoso: 7, PRoeo: 7, PRcso: 7, PRceo: 7, PRodu: 7, PRcdu: 7,
  PRtba: 8, PRtbb: 8,
  PRbah: 9, PRbav: 9, PRbaz: 9, PRbbh: 9, PRbbv: 9, PRbbz: 9,
  PRmcv: 11,
};

// Every writable per-layer preset variable the device advertised — 40 on a
// LiveCore, 27 on a Midra. Read off the table rather than listed here, so the
// set follows whichever platform the bridge connected to. PRlay is the RCS's
// edit selection rather than layer state; capturing it would drag the
// operator's cursor around on every recall.
function layerLeaves() {
  const out = [];
  for (const [m, def] of store.byMnem) {
    if (def.group !== 'PRESET' && def.group !== 'GRP_PRESET_ELEMENT') continue;
    if (def.ro || m === 'PRlay' || (def.dims?.length ?? 0) !== 3) continue;
    out.push(m);
  }
  return out;
}

const LAYER_MEM = (() => {
  const KEY = 'openrcs.layermem';
  const N = 50;                    // the depth of the LivePremier layer bank
  const slots = new Array(N).fill(null);
  try {
    const saved = JSON.parse(localStorage.getItem(KEY) || 'null');
    if (Array.isArray(saved)) for (let i = 0; i < N && i < saved.length; i++) slots[i] = saved[i] || null;
  } catch { /* first run / private mode */ }
  const persist = () => { try { localStorage.setItem(KEY, JSON.stringify(slots)); } catch { /* quota/private */ } };

  const get = (n) => slots[n] || null;
  const count = () => slots.filter(Boolean).length;

  /** Ask the device for one layer's leaves, so a capture has values to read. */
  function fetch(s, ctx, l) { for (const m of layerLeaves()) store.get(m, [s, ctx, l]); }

  /** Snapshot one layer into a slot. Reads the cache only — writes nothing. */
  function save(n, s, ctx, l) {
    const values = {};
    for (const m of layerLeaves()) {
      const v = store.val(m, s, ctx, l);
      if (v != null) values[m] = v;
    }
    slots[n] = {
      label: get(n)?.label || '',
      saved: new Date().toISOString(),
      // A LiveCore capture means nothing on a Midra. The position bias is the
      // same but the ranges are not (alpha 0..256 against 0..255, position
      // 0..131072 against 0..65535) and a third of the leaves do not exist on
      // the other platform. Recorded so a recall can refuse rather than write
      // plausible nonsense.
      platform: store.meta?.platform || '',
      from: { screen: s, preset: ctx, layer: l },
      values,
    };
    persist();
    return Object.keys(values).length;
  }

  function relabel(n, label) { if (slots[n]) { slots[n].label = label; persist(); } }
  function erase(n) { slots[n] = null; persist(); }

  const clampTo = (def, v) => Math.max(def.min, Math.min(def.max, v));

  /**
   * Write a stored layer onto a target layer, honouring the record mask.
   * Returns the mnemonics written so the caller can read them back: a Midra
   * refuses a source with no signal and answers with neither an echo nor an
   * error code, so a write is not evidence that anything changed.
   */
  function apply(n, s, ctx, l, mask) {
    const slot = get(n);
    if (!slot) return [];
    const wrote = [];
    for (const [m, v] of Object.entries(slot.values)) {
      const def = store.byMnem.get(m);
      if (!def) continue;                     // a leaf this platform does not have
      const bit = LAYER_CAT[m];
      if (bit != null && !flagOn(mask, bit)) continue;
      store.set(m, [s, ctx, l], clampTo(def, v));
      wrote.push(m);
    }
    return wrote;
  }

  /** Which of a just-applied set the device did not take. */
  function verify(n, s, ctx, l, wrote) {
    const slot = get(n);
    if (!slot) return [];
    return wrote.filter((m) => {
      const def = store.byMnem.get(m);
      return def && store.val(m, s, ctx, l) !== clampTo(def, slot.values[m]);
    });
  }

  /** The whole bank as plain data, for a show file, and back again. */
  const snapshot = () => slots.map((x) => x);
  function restore(list) {
    if (!Array.isArray(list)) return;
    for (let i = 0; i < N; i++) slots[i] = list[i] || null;
    persist();
  }

  return { N, get, count, fetch, save, relabel, erase, apply, verify, snapshot, restore };
})();

// ---------- Memories ----------
VIEWS.memories = (() => {
  let scope = 'master';          // 'master' | 'screen' | 'layer'
  let mode = 'recall';           // 'recall' | 'take' | 'save' | 'inspect'
  let screen = 0;
  let selected = null;
  // PMcat, the device's own load/save record mask. One filter serves all three
  // scopes: the layer bank re-uses the same bits, so a layer recalls under the
  // chips an operator already knows from screen memories.
  let filter = MEM_FILTER_ALL;
  let filterOpen = false;
  // Which bank a load lands in / a save is taken from. PMprf and PSprf both
  // spell it 0 = the bank on air, 1 = the bank that is not.
  let bank = 'pvw';

  const fetched = new Set();     // screen-memory slots whose contents we've pulled
  const labelled = new Set();    // slots whose device label we've asked for

  let flashMsg = null, flashTimer = null;
  function flash(t) {
    flashMsg = t; clearTimeout(flashTimer);
    flashTimer = setTimeout(() => { flashMsg = null; store.notify(); }, 3200);
    store.notify();
  }

  // ---- Midra memory model: 8 slots, content in PMinp/geom[slot,screen,layer].
  // Save = GCsrq (device stores the live program); reset = CTpmr. Recall is
  // re-applied to the preview context client-side, then taken. ----
  const mid = (() => {
    const N = 8;
    let sel = null;
    const got = new Set();
    function ensure(slot) {
      if (got.has(slot)) return; got.add(slot);
      for (let sc = 0; sc < screenCount(); sc++)
        for (let l = 0; l < layerSlots(); l++)
          for (const m of ['PMinp', 'PMpoh', 'PMpov', 'PMsih', 'PMsiv']) store.get(m, [slot, sc, l]);
      store.get('PMssh', [slot, 0]); store.get('PMssv', [slot, 0]);
    }
    function enter() {
      if (store.byMnem.has('CTpmu')) store.set('CTpmu', [], 1);
      store.scan('PMpst'); store.scan('SCmly'); store.scan('SCssh'); store.scan('SCssv');
    }
    function save(slot) { store.set('GCsrq', [2, slot], 1); store.get('PMpst', [slot]); got.delete(slot); ensure(slot); store.notify(); }
    function reset(slot) { store.set('CTpmr', [slot], 1); store.get('PMpst', [slot]); got.delete(slot); if (sel === slot) sel = null; store.notify(); }
    function recall(slot) {                       // re-apply the stored preset to preview (ctx 1)
      if (store.byMnem.has('CTpmu')) store.set('CTpmu', [], 1);
      for (let sc = 0; sc < screenCount(); sc++)
        for (let l = 0; l < layerSlots(); l++) {
          store.set('PRsih', [sc, 1, l], store.val('PMsih', slot, sc, l) || 0);
          store.set('PRsiv', [sc, 1, l], store.val('PMsiv', slot, sc, l) || 0);
          store.set('PRpoh', [sc, 1, l], store.val('PMpoh', slot, sc, l) ?? POS_BIAS);
          store.set('PRpov', [sc, 1, l], store.val('PMpov', slot, sc, l) ?? POS_BIAS);
          store.set('PRinp', [sc, 1, l], store.val('PMinp', slot, sc, l) || 0);
        }
      store.notify();
    }
    function thumb(slot) {
      const sw = store.val('PMssh', slot, 0) || 1920, sh = store.val('PMssv', slot, 0) || 1080;
      const CW = 300, scale = CW / sw;
      const cv = el('div', { class: 'screen-canvas mem-thumb', style: `width:${CW}px;height:${Math.round(sh * scale)}px` });
      let drawn = 0;
      for (let l = 0; l < layerSlots(); l++) {
        const src = store.val('PMinp', slot, 0, l);
        if (!src) continue;
        const w = store.val('PMsih', slot, 0, l) || 0, h = store.val('PMsiv', slot, 0, l) || 0;
        const cx = (store.val('PMpoh', slot, 0, l) ?? POS_BIAS) - POS_BIAS, cy = (store.val('PMpov', slot, 0, l) ?? POS_BIAS) - POS_BIAS;
        cv.append(el('div', { class: 'lrect', style: `left:${(cx - w / 2) * scale}px;top:${(cy - h / 2) * scale}px;width:${w * scale}px;height:${h * scale}px;background:${srcColor(src)};z-index:${l + 1}` },
          el('span', { class: 'lrect-tag', text: sourceName(src) })));
        drawn++;
      }
      if (!drawn) cv.append(el('span', { class: 'se-mid', text: 'empty' }));
      return cv;
    }
    function grid() {
      const g = el('div', { class: 'mem-grid' });
      for (let i = 0; i < N; i++) {
        const used = store.val('PMpst', i) === 1;
        g.append(el('button', { class: 'slot' + (used ? ' valid' : '') + (sel === i ? ' sel' : ''), onclick: () => { sel = i; ensure(i); store.notify(); } },
          el('span', { class: 'num', text: i + 1 }),
          used ? el('span', { class: 'lbl', text: 'preset' }) : null));
      }
      return g;
    }
    function body() {
      const isUsed = sel != null && store.val('PMpst', sel) === 1;
      const detail = sel != null ? el('div', { class: 'panel' },
        el('div', { class: 'row' }, el('h2', `Memory ${sel + 1}`), el('div', { class: 'spacer' }),
          isUsed ? el('button', { class: 'btn recall', onclick: () => recall(sel) }, 'Recall to preview') : null,
          el('button', { class: 'btn save', onclick: () => save(sel) }, 'Save current program'),
          isUsed ? el('button', { class: 'btn ghost', onclick: () => reset(sel) }, 'Erase') : null),
        isUsed ? el('div', { class: 'row', style: 'align-items:flex-start' }, thumb(sel))
          : el('div', { class: 'hint', text: 'Empty slot — “Save current program” stores the live layout here.' })) : null;
      return el('div', {}, detail, el('div', { class: 'panel' }, grid()));
    }
    const hint = () => {
      const used = Array.from({ length: N }, (_, i) => store.val('PMpst', i)).filter(v => v === 1).length;
      return `${used} of ${N} presets saved · tap a slot to inspect`;
    };
    return { enter, body, hint };
  })();

  // ---- layer bank: one layer captured here, applied to any other ----
  const lay = (() => {
    let from = { screen: 0, role: 'pgm', layer: 0 };
    let to = { screen: 0, role: 'pvw', layer: 0 };
    let sel = null;
    let report = null;           // outcome of the last apply, shown in the detail
    const ctxOf = (a) => a.role === 'pgm' ? liveCtx(a.screen) : editCtx(a.screen);

    function enter() {
      // Midra protects the program preset; without update mode a write to the
      // preview context silently fails to stick (the same reason Layers sets it).
      if (store.byMnem.has('CTpmu')) store.set('CTpmu', [], 1);
      for (const m of ['SCmly', 'SCssh', 'SCssv']) if (store.byMnem.has(m)) store.scan(m);
      if (hasBanks()) store.scan('GCsta');
      LAYER_MEM.fetch(from.screen, ctxOf(from), from.layer);
    }

    // SCmly is what the screen is actually configured for; PRinp's last dimension
    // is only the frame's ceiling. Offering 24 layers on a 4-layer screen invites
    // a capture of something that cannot exist.
    const layerCount = (s) => store.val('SCmly', s) || layerSlots();
    function layerSelect(a, onchange) {
      const s = el('select', { onchange: (e) => { a.layer = +e.target.value; onchange(); } });
      for (let i = 0; i < layerCount(a.screen); i++) {
        const o = el('option', { value: i, text: 'Layer ' + (i + 1) });
        if (i === a.layer) o.selected = true;
        s.append(o);
      }
      return s;
    }
    // The bank is named by role, not by index. On a LiveCore which buffer is on
    // air moves with the device, so a fixed preset number would address the
    // wrong one; on a Midra the mapping is fixed at program 0 / preview 1.
    // liveCtx/editCtx already resolve both, so the choice is offered either way
    // — gating it on GCsta would leave a Midra able to address only context 0,
    // which is half the layers it actually has.
    function addr(a, label, onchange) {
      return el('div', { class: 'row' },
        el('b', { text: label }),
        screenSelect(a.screen, (v) => { a.screen = v; onchange(); }),
        el('div', { class: 'seg' },
          el('button', { class: a.role === 'pgm' ? 'on take' : '', onclick: () => { a.role = 'pgm'; onchange(); } }, 'Program'),
          el('button', { class: a.role === 'pvw' ? 'on recall' : '', onclick: () => { a.role = 'pvw'; onchange(); } }, 'Preview')),
        layerSelect(a, onchange),
        el('div', { class: 'spacer' }),
        el('span', { class: 'hint', text: sourceName(store.val('PRinp', a.screen, ctxOf(a), a.layer) || 0) }));
    }

    function saveTo(n) {
      const wrote = LAYER_MEM.save(n, from.screen, ctxOf(from), from.layer);
      sel = n; report = null;
      flash(wrote
        ? `Captured ${screenLabel(from.screen)} layer ${from.layer + 1} into memory ${n + 1} — ${wrote} properties`
        : `Nothing to capture yet — layer ${from.layer + 1} has not been read back from the device`);
    }
    function recallTo(n, andTake) {
      const slot = LAYER_MEM.get(n);
      if (!slot) return;
      const here = store.meta?.platform;
      if (slot.platform && here && slot.platform !== here) {
        flash(`Memory ${n + 1} was captured on a ${slot.platform} — its value ranges do not mean the same thing here, so nothing was written`);
        return;
      }
      const ctx = ctxOf(to);
      const wrote = LAYER_MEM.apply(n, to.screen, ctx, to.layer, filter);
      sel = n;
      report = { slot: n, wrote: wrote.length, missed: null };
      // Read back rather than trust the write: a Midra drops a source with no
      // signal and answers with neither an echo nor an error code.
      setTimeout(() => {
        LAYER_MEM.fetch(to.screen, ctx, to.layer);
        setTimeout(() => {
          if (report && report.slot === n) report.missed = LAYER_MEM.verify(n, to.screen, ctx, to.layer, wrote);
          store.notify();
        }, 500);
      }, 250);
      if (andTake) setTimeout(() => doTake(to.screen, 1000), 900);
      flash(`Applied memory ${n + 1} to ${screenLabel(to.screen)} layer ${to.layer + 1}`);
    }

    function tap(n) {
      sel = n;
      if (mode === 'save') saveTo(n);
      else if (mode === 'recall') recallTo(n, false);
      else if (mode === 'take') recallTo(n, true);
      store.notify();
    }

    function grid() {
      const g = el('div', { class: `mem-grid mode-${mode}` });
      for (let i = 0; i < LAYER_MEM.N; i++) {
        const s = LAYER_MEM.get(i);
        g.append(el('button', {
          class: 'slot' + (s ? ' valid' : '') + (sel === i ? ' sel' : ''),
          title: s
            ? `${s.label || 'Layer memory ' + (i + 1)} — captured from ${screenLabel(s.from.screen)} layer ${s.from.layer + 1}`
            : `Layer memory ${i + 1} — empty`,
          onclick: () => tap(i),
        }, el('span', { class: 'num', text: i + 1 }),
          s ? el('span', { class: 'lbl', text: s.label || sourceName(s.values.PRinp || 0) }) : null));
      }
      return g;
    }

    function detail(n) {
      const s = LAYER_MEM.get(n);
      if (!s) return el('div', { class: 'panel' },
        el('div', { class: 'row' }, el('h2', `Layer memory ${n + 1}`)),
        el('div', { class: 'empty-state', text: 'Empty — pick the layer to capture above, switch to Save, then tap this slot.' }));
      const rows = Object.entries(s.values).map(([m, v]) => {
        const def = store.byMnem.get(m);
        const bit = LAYER_CAT[m];
        const cat = MEM_FILTERS.find(([, b]) => b === bit);
        const masked = bit != null && !flagOn(filter, bit);
        return el('tr', { class: (def && !masked) ? '' : 'dim' },
          el('td', { text: m }),
          el('td', { text: def?.name || 'not on this platform' }),
          el('td', { text: cat ? cat[0] : '—' }),
          el('td', { class: 'val', text: v }));
      });
      const kept = Object.keys(s.values).filter((m) => {
        const bit = LAYER_CAT[m];
        return store.byMnem.has(m) && (bit == null || flagOn(filter, bit));
      }).length;
      return el('div', { class: 'panel' },
        el('div', { class: 'row' },
          el('h2', `Layer memory ${n + 1}`),
          el('input', {
            class: 'lbl-in', type: 'text', maxlength: 24, value: s.label, placeholder: 'label',
            onchange: (e) => { LAYER_MEM.relabel(n, e.target.value); store.notify(); },
          }),
          el('div', { class: 'spacer' }),
          el('button', { class: 'btn recall', onclick: () => recallTo(n, false) }, 'Apply to target'),
          el('button', { class: 'btn ghost', onclick: () => { LAYER_MEM.erase(n); if (sel === n) sel = null; report = null; store.notify(); } }, 'Erase')),
        el('div', { class: 'row' }, el('span', { class: 'hint', text:
          `${Object.keys(s.values).length} properties stored, ${kept} pass the current filter · captured `
          + `${new Date(s.saved).toLocaleString()} from ${screenLabel(s.from.screen)} layer ${s.from.layer + 1}`
          + (s.platform ? ` on a ${s.platform}` : '') })),
        report && report.slot === n ? el('div', { class: 'row' },
          el('span', { class: 'ws-flash', text:
            report.missed == null ? `Applied ${report.wrote} properties — reading back…`
              : report.missed.length ? `${report.wrote - report.missed.length} of ${report.wrote} landed — the device refused ${report.missed.join(', ')}`
              : `All ${report.wrote} properties landed` })) : null,
        el('table', { class: 'grid' },
          el('thead', el('tr', ...['Variable', 'Property', 'Category', 'Value'].map(h => el('th', { text: h })))),
          el('tbody', ...rows)));
    }

    function body() {
      const refetch = () => { enter(); store.notify(); };
      return el('div', {},
        el('div', { class: 'panel' },
          addr(from, 'Capture from', refetch),
          addr(to, 'Apply to', () => store.notify()),
          el('div', { class: 'row' }, el('span', { class: 'hint', text:
            'Neither platform stores a single layer, so this bank lives in the browser. It survives a reload, and a recall is checked by reading the layer back.' }))),
        sel != null ? detail(sel) : null,
        el('div', { class: 'panel' }, grid()));
    }
    const hint = () => `${LAYER_MEM.count()} of ${LAYER_MEM.N} layer memories saved · tap a slot to ${mode === 'save' ? 'capture into' : mode === 'take' ? 'apply + take' : 'apply'}`;
    return { enter, body, hint };
  })();

  function enter() {
    if (scope === 'layer') return lay.enter();
    if (store.meta?.platform === 'midra') return mid.enter();
    store.scan('PSval');         // master validity
    store.scan('PMscw');         // screen-memory content width (>0 = present)
    store.scan('PMsch');         // stored screen height
    store.scan('PMmly');         // stored layer count
    store.scan('SCmly');         // per-screen max layers
  }

  // pull the stored per-layer content of one screen-memory slot (once)
  function ensureContent(slot) {
    if (fetched.has(slot)) return;
    fetched.add(slot);
    store.get('PMscw', [slot]); store.get('PMsch', [slot]); store.get('PMmly', [slot]);
    const mly = store.val('PMmly', slot) || 24;
    for (let l = 0; l < mly; l++)
      for (const m of ['PMinp', 'PMpoh', 'PMpov', 'PMsih', 'PMsiv', 'PMalp']) store.get(m, [slot, l]);
  }

  // Labels are 16 gets each, so they are fetched for populated slots only and
  // once — a blind sweep of both banks would be 4608 reads down one TCP link.
  function ensureLabels(isMaster) {
    const m = isMaster ? 'LBPSe' : 'LBPMe';
    if (!store.byMnem.has(m)) return;
    for (let i = 0; i < 144; i++) {
      if (!slotValid(i, isMaster) || labelled.has(m + i)) continue;
      labelled.add(m + i);
      fetchLabel(m, [i]);
    }
  }
  const slotValid = (i, isMaster) => isMaster ? store.val('PSval', i) === 1 : (store.val('PMscw', i) || 0) > 0;
  const slotLabel = (i, isMaster) => readLabel(isMaster ? 'LBPSe' : 'LBPMe', [i]);

  // a scaled thumbnail of a stored memory's layer arrangement
  function memThumb(slot) {
    const B = 32768;
    const sw = store.val('PMscw', slot) || 1920, sh = store.val('PMsch', slot) || 1080;
    const CW = 300, scale = CW / sw;
    const cv = el('div', { class: 'screen-canvas mem-thumb', style: `width:${CW}px;height:${Math.round(sh * scale)}px` });
    const mly = store.val('PMmly', slot) || 0;
    let drawn = 0;
    for (let l = 0; l < mly; l++) {
      const src = store.val('PMinp', slot, l);
      if (!src) continue;
      const w = store.val('PMsih', slot, l) || 0, h = store.val('PMsiv', slot, l) || 0;
      const cx = (store.val('PMpoh', slot, l) ?? B) - B, cy = (store.val('PMpov', slot, l) ?? B) - B;
      const alp = store.val('PMalp', slot, l);
      cv.append(el('div', { class: 'lrect', style:
        `left:${(cx - w / 2) * scale}px;top:${(cy - h / 2) * scale}px;width:${w * scale}px;height:${h * scale}px;`
        + `background:${srcColor(src)};opacity:${alp == null ? 1 : (alp / 256).toFixed(2)};z-index:${l + 1}` },
        el('span', { class: 'lrect-tag', text: sourceName(src) })));
      drawn++;
    }
    if (!drawn) cv.append(el('span', { class: 'se-mid', text: 'empty' }));
    return cv;
  }

  // a per-layer table of the stored memory contents
  function memList(slot) {
    const B = 32768, mly = store.val('PMmly', slot) || 0;
    const rows = [];
    for (let l = 0; l < mly; l++) {
      const src = store.val('PMinp', slot, l);
      const w = store.val('PMsih', slot, l), h = store.val('PMsiv', slot, l);
      const cx = store.val('PMpoh', slot, l), cy = store.val('PMpov', slot, l);
      const alp = store.val('PMalp', slot, l);
      rows.push(el('tr', { class: src ? '' : 'dim' },
        el('td', { text: 'L' + (l + 1) }),
        el('td', {}, src ? el('span', { class: 'swatch-dot', style: `background:${srcColor(src)}` }) : null, ' ' + sourceName(src)),
        el('td', { class: 'val', text: (w != null && h != null) ? `${w}×${h}` : '·' }),
        el('td', { class: 'val', text: (cx != null && cy != null) ? `${cx - B},${cy - B}` : '·' }),
        el('td', { class: 'val', text: alp == null ? '·' : Math.round(alp / 256 * 100) + '%' })));
    }
    return el('table', { class: 'grid', style: 'flex:1' },
      el('thead', el('tr', ...['Layer', 'Source', 'Size', 'Centre', 'Opacity'].map(h => el('th', { text: h })))),
      el('tbody', ...rows));
  }

  const prf = () => bank === 'pgm' ? 0 : 1;

  function slotTap(n) {
    selected = n;
    if (mode === 'inspect') { if (scope === 'screen') ensureContent(n); store.notify(); return; }
    if (scope === 'master') {
      store.set('PSmet', [], n);                       // target slot
      store.set('PSprf', [], prf());
      if (mode === 'recall') store.set('PSloa', [], 1);
      else if (mode === 'take') store.set('PSlot', [], 1);
      else if (mode === 'save') { store.set('PSsav', [], 1); store.scan('PSval'); labelled.delete('LBPSe' + n); }
    } else {
      store.set('PMcat', [], filter);                  // the record mask, both ways
      store.set('PMscf', [], screen);
      store.set('PMmet', [], n);
      store.set('PMprf', [], prf());
      if (mode === 'recall') store.set('PMloa', [], 1);
      else if (mode === 'take') store.set('PMlot', [], 1);
      else if (mode === 'save') { store.set('PMsav', [], 1); store.scan('PMscw'); fetched.delete(n); labelled.delete('LBPMe' + n); ensureContent(n); }
    }
    store.notify();
  }

  function eraseSlot(n) {
    if (scope === 'master') {
      store.set('PSmet', [], n); store.set('PSres', [], 1);
      setTimeout(() => store.scan('PSval'), 400);
    } else {
      store.set('PMscf', [], screen); store.set('PMmet', [], n); store.set('PMres', [], 1);
      fetched.delete(n);
      setTimeout(() => { store.get('PMscw', [n]); store.get('PMmly', [n]); store.notify(); }, 400);
    }
    labelled.delete((scope === 'master' ? 'LBPSe' : 'LBPMe') + n);
    flash(`Erased ${scope === 'master' ? 'master memory' : 'memory'} ${n + 1}`);
  }

  function grid() {
    const isMaster = scope === 'master';
    ensureLabels(isMaster);
    const g = el('div', { class: `mem-grid mode-${mode}` });
    const N = 144;
    for (let i = 0; i < N; i++) {
      const valid = slotValid(i, isMaster), label = valid ? slotLabel(i, isMaster) : '';
      let cls = 'slot';
      if (valid) cls += ' valid';
      if (selected === i) cls += ' sel';
      g.append(el('button', {
        class: cls,
        title: `${isMaster ? 'Master memory' : 'Memory'} ${i + 1}${label ? ' — ' + label : ''}${valid ? '' : ' — empty'}`,
        onclick: () => slotTap(i),
      },
        el('span', { class: 'num', text: i + 1 }),
        valid ? el('span', { class: 'lbl', text: label || (isMaster ? 'saved' : `${store.val('PMmly', i) ?? 0} lyr`) }) : null));
    }
    return g;
  }

  // The record mask is the device's own PMcat, so the chips mean exactly what
  // they mean in the vendor RCS — and the layer bank filters on the same bits.
  function filterChips() {
    const chip = (label, on, fn) => el('button', { class: 'ws-mini' + (on ? ' on' : ''), onclick: fn }, label);
    return el('div', { class: 'ws-filters' },
      ...MEM_FILTERS.map(([label, bit]) =>
        chip(label, flagOn(filter, bit), () => { filter = flagSet(filter, bit, !flagOn(filter, bit)); store.notify(); })),
      chip('All', filter === MEM_FILTER_ALL, () => { filter = MEM_FILTER_ALL; store.notify(); }));
  }

  function toolbar(midra) {
    const nFilters = MEM_FILTERS.filter(([, b]) => flagOn(filter, b)).length;
    const seg = (id, label, cls) => el('button', {
      class: (cls || '') + (mode === id ? ' on' : ''), onclick: () => { mode = id; store.notify(); },
    }, label);
    const scopeBtn = (id, label) => el('button', {
      class: scope === id ? 'on recall' : '',
      onclick: () => { scope = id; selected = null; enter(); store.notify(); },
    }, label);
    return el('div', { class: 'panel' },
      el('div', { class: 'row' },
        el('div', { class: 'seg' },
          midra ? scopeBtn('master', 'Presets') : scopeBtn('master', 'Master'),
          midra ? null : scopeBtn('screen', 'Screen'),
          scopeBtn('layer', 'Layer')),
        scope === 'screen' ? el('label', { class: 'field' }, 'Screen',
          screenSelect(screen, v => { screen = v; enter(); store.notify(); })) : null,
        el('div', { class: 'spacer' }),
        scope !== 'layer' && !midra ? el('div', { class: 'seg' },
          el('button', { class: bank === 'pvw' ? 'on recall' : '', onclick: () => { bank = 'pvw'; store.notify(); } }, mode === 'save' ? 'From preview' : 'Into preview'),
          el('button', { class: bank === 'pgm' ? 'on take' : '', onclick: () => { bank = 'pgm'; store.notify(); } }, mode === 'save' ? 'From program' : 'Into program')) : null,
        // Midra's own bank is driven from the slot detail, not a mode, and it
        // carries no record mask — PMcat is a LiveCore variable. The layer bank
        // has both on either platform, because it applies them itself.
        midra && scope !== 'layer' ? null : el('div', { class: 'seg' },
          seg('recall', scope === 'layer' ? 'Apply' : 'Recall', 'recall'),
          seg('take', scope === 'layer' ? 'Apply + Take' : 'Load + Take', 'take'),
          seg('save', scope === 'layer' ? 'Capture' : 'Save', 'save'),
          scope === 'layer' ? null : seg('inspect', 'Inspect')),
        midra && scope !== 'layer' ? null
          : el('button', { class: 'ws-mini' + (filterOpen ? ' on' : ''), title: 'Which categories a recall carries',
            onclick: () => { filterOpen = !filterOpen; store.notify(); } },
            `Filter: ${nFilters === MEM_FILTERS.length ? 'all' : nFilters}`)),
      filterOpen && !(midra && scope !== 'layer') ? filterChips() : null);
  }

  function liveBody() {
    const isMaster = scope === 'master';
    return el('div', {},
      // stored-content preview for the selected screen memory
      !isMaster && selected != null && slotValid(selected, false)
        ? el('div', { class: 'panel' },
          el('div', { class: 'row' },
            el('h2', `Memory ${selected + 1} contents`),
            el('input', {
              class: 'lbl-in', type: 'text', maxlength: LABEL_LEN, value: slotLabel(selected, false), placeholder: 'label',
              onchange: (e) => { writeLabel('LBPMe', [selected], e.target.value); setTimeout(() => fetchLabel('LBPMe', [selected]), 300); },
            }),
            el('div', { class: 'spacer' }),
            el('span', { class: 'hint', text: `${store.val('PMscw', selected)}×${store.val('PMsch', selected) || '·'} · ${store.val('PMmly', selected) ?? 0} layers` }),
            el('button', { class: 'btn ghost', onclick: () => eraseSlot(selected) }, 'Erase')),
          el('div', { class: 'row', style: 'align-items:flex-start;gap:16px' },
            memThumb(selected),
            memList(selected)))
        : null,
      isMaster && selected != null && slotValid(selected, true)
        ? el('div', { class: 'panel' },
          el('div', { class: 'row' },
            el('h2', `Master memory ${selected + 1}`),
            el('input', {
              class: 'lbl-in', type: 'text', maxlength: LABEL_LEN, value: slotLabel(selected, true), placeholder: 'label',
              onchange: (e) => { writeLabel('LBPSe', [selected], e.target.value); setTimeout(() => fetchLabel('LBPSe', [selected]), 300); },
            }),
            el('div', { class: 'spacer' }),
            el('span', { class: 'hint', text: 'recalls every enabled screen at once' }),
            el('button', { class: 'btn ghost', onclick: () => eraseSlot(selected) }, 'Erase')))
        : null,
      el('div', { class: 'panel' }, grid()));
  }

  function render() {
    const midra = store.meta?.platform === 'midra';
    const hint = scope === 'layer' ? lay.hint()
      : midra ? mid.hint()
      : `${store.arr(scope === 'master' ? 'PSval' : 'PMscw', 144).filter(v => scope === 'master' ? v === 1 : (v || 0) > 0).length} saved`
        + ` · tap a slot to ${mode === 'save' ? 'save into' : mode === 'take' ? 'load + take' : mode === 'inspect' ? 'preview its contents' : 'recall'}`;
    return el('div', {},
      el('div', { class: 'view-head' },
        el('h1', { text: 'Memories' }),
        el('span', { class: 'hint', text: hint }),
        flashMsg ? el('span', { class: 'ws-flash', text: flashMsg }) : null),
      toolbar(midra),
      scope === 'layer' ? lay.body() : midra ? mid.body() : liveBody());
  }

  return { enter, render };
})();

function screenSelect(val, onchange) {
  const s = el('select', { onchange: (e) => onchange(+e.target.value) });
  for (let i = 0; i < screenCount(); i++) {
    const opt = el('option', { value: i, text: `Screen ${i + 1}` });
    if (i === val) opt.selected = true;
    s.append(opt);
  }
  return s;
}

// throttle device sets during slider drags (per mnemonic+index)
const _throttle = new Map();
function throttledSet(m, idx, v) {
  const k = m + '|' + idx.join(',');
  const now = performance.now();
  const last = _throttle.get(k) || 0;
  if (now - last > 40) { _throttle.set(k, now); store.set(m, idx, v); }
  else { clearTimeout(_throttle.get(k + ':t')); _throttle.set(k + ':t', setTimeout(() => store.set(m, idx, v), 45)); }
}

// ---------- device labels ----------
// LABEL_STRINGS are 16-char arrays, one variable get/set per character, ASCII 0..126
// with 0 terminating. Empty on a factory device, so every reader falls back to a
// positional name.
const LABEL_LEN = 16;
function readLabel(m, pre) {
  if (!store.byMnem.has(m)) return '';
  let s = '';
  for (let c = 0; c < LABEL_LEN; c++) {
    const v = store.val(m, ...pre, c);
    if (v == null || v === 0) break;
    s += String.fromCharCode(v);
  }
  return s.trim();
}
function fetchLabel(m, pre) {
  if (!store.byMnem.has(m)) return;
  for (let c = 0; c < LABEL_LEN; c++) store.get(m, [...pre, c]);
}
function writeLabel(m, pre, text) {
  if (!store.byMnem.has(m)) return;
  const t = [...(text || '')].filter(ch => ch.charCodeAt(0) > 0 && ch.charCodeAt(0) < 127).join('').slice(0, LABEL_LEN);
  for (let c = 0; c < LABEL_LEN; c++) store.set(m, [...pre, c], c < t.length ? t.charCodeAt(c) : 0);
}
// an input's label lives under its *active* plug
const inputLabel = (i) => readLabel('LBInp', [i, store.val('INplg', i) ?? 0]);
const screenLabel = (s) => readLabel('LBScr', [s]) || `Screen ${s + 1}`;
const outputLabel = (o) => readLabel('LBOut', [o]) || `Output ${o + 1}`;
const stillLabel = (i) => readLabel('LBLgS', [i]);
const rstillLabel = (i) => readLabel('LBRdS', [i]);

const isMidra = () => store.meta?.platform === 'midra';
/** How many inputs the frame actually has, per the device's own availability map. */
function availableInputs() {
  const d = store.byMnem.get('INava')?.dims[0];
  if (!d) return inputCount();
  let n = 0;
  for (let i = 0; i < d; i++) if (store.val('INava', i) === 1) n++;
  return n || d;
}
/** Does this input have a signal? Unknown counts as yes — never cry wolf. */
function inputHasSignal(i) {
  const def = store.byMnem.get('ISfwi');
  if (!def) return true;
  const plugs = def.dims[1] ?? 1;
  let known = false;
  for (let p = 0; p < plugs; p++) {
    const w = store.val('ISfwi', i, p);
    if (w == null) continue;
    known = true;
    if (w > 0) return true;
  }
  return !known;
}

// LiveCore layer sources (INPUTLAYER): 0 none, 1–24 live inputs, 25–32 large stills,
// 33–40 reduced stills, 41 colour.
//
// Midra's live-layer source list runs black, then one entry per input in order, then
// colour last — recovered from the MIDRA firmware's own string table, where a Pulse2
// reads "Black, Input1-4, HDMI1-2, SDI1-4, Color" for exactly the 0..11 PRinp range.
// An input the frame does not have still occupies its slot in that list.
function sourceName(n) {
  if (n == null) return '·';
  if (n === 0) return '— none —';
  if (isMidra()) return n >= srcMaxOf() ? 'Colour' : 'IN ' + n;
  if (n === 41) return 'Colour';
  if (n >= 33 && n <= 40) return rstillLabel(n - 33) || 'R.Still ' + (n - 32);
  if (n >= 25 && n <= 32) return stillLabel(n - 25) || 'Still ' + (n - 24);
  return inputLabel(n - 1) || 'IN ' + n;
}
/**
 * Whether the device can actually produce this source right now.
 *
 * This matters more than it looks: a layer pointed at an input the frame has no card
 * for never opens, and the transition that is waiting for it sits in EFFECT_FROM_*
 * for ever — the take simply never lands. Confirmed on a NeXtage 16.
 */
function sourceAvailable(n) {
  if (!n) return true;
  // Midra refuses to open a live layer on an input with no signal — the write is
  // dropped without a NAK — so "usable" here means fitted *and* locked to a source.
  // Colour is generated internally and is always available.
  if (isMidra()) {
    if (n >= srcMaxOf()) return true;
    return store.val('INava', n - 1) !== 0 && inputHasSignal(n - 1);
  }
  if (store.meta?.platform !== 'livecore') return true;
  if (n === 41) return true;                                    // colour is always there
  if (n >= 33 && n <= 40) return store.val('RSval', n - 33) !== 0;
  if (n >= 25 && n <= 32) return store.val('LSval', n - 25) !== 0;
  const v = store.val('INava', n - 1);
  return v == null ? true : v === 1;                            // unknown until scanned
}
// ---------- source thumbnails ----------
// The device serves a small PNG per input from its own HTTP server (named .bmp, and
// only for inputs — outputs and previews 404 even with their snapshot slots enabled).
// They only appear once SNAPSHOTS is enabled for that source, which the Workspace does
// on entry. Confirmed on a NeXtage 16; a Pulse2 serves no HTTP at all.
let SNAP_TICK = 0;
const snapshotsWork = () => store.meta?.platform === 'livecore' && !!store.meta?.host;
/** URL for a source's thumbnail, or null when the device cannot provide one. */
function snapshotUrl(n) {
  if (!snapshotsWork() || !n || n > 24) return null;
  // the tick is the whole cache-busting story: a stable URL between ticks means a
  // re-render reuses the cached image instead of refetching and flickering
  return `http://${store.meta.host}/assets/Snapshots/capture_in_${n}.bmp?t=${SNAP_TICK}`;
}
function startSnapshots() {
  if (startSnapshots.timer || !snapshotsWork()) return;
  startSnapshots.timer = setInterval(() => {
    if (currentView !== 'workspace' || document.hidden) return;
    SNAP_TICK++;
    store.notify();
  }, 3000);
}
/** Ask the device to keep thumbnails of the inputs up to date. */
function enableSnapshots() {
  if (!store.byMnem.has('SNena')) return;
  if (store.byMnem.has('SNdis')) store.set('SNdis', [], 0);
  for (let i = 0; i < inputCount() && i < 24; i++) {
    if (store.val('SNena', i) !== 1) store.set('SNena', [i], 1);
  }
}

/** What kind of thing a source number is, for grouping and colouring. */
function sourceKind(n) {
  if (!n) return 'none';
  if (store.meta?.platform !== 'livecore') return 'input';
  if (n === 41) return 'colour';
  if (n >= 33) return 'rstill';
  if (n >= 25) return 'still';
  return 'input';
}

function sourceSelect(mnem, idx, max) {
  if (max == null) max = srcMaxOf();
  const cur = store.val(mnem, ...idx);
  const s = el('select', { onchange: (e) => store.set(mnem, idx, +e.target.value) });
  for (let i = 0; i <= max; i++) {
    // an unavailable source stalls any take that waits for it, so it is only listed
    // when it is the value already on the layer — where hiding it would be a lie
    if (!sourceAvailable(i) && i !== cur) continue;
    const opt = el('option', { value: i, text: sourceName(i) + (sourceAvailable(i) ? '' : ' — not available') });
    if (i === (cur ?? 0)) opt.selected = true;
    s.append(opt);
  }
  return s;
}

// a <select> over an enum, options[value] = label
function enumSelect(mnem, idx, options) {
  const cur = store.val(mnem, ...idx) ?? 0;
  const s = el('select', { onchange: (e) => store.set(mnem, idx, +e.target.value) });
  options.forEach((label, i) => {
    const opt = el('option', { value: i, text: label });
    if (i === cur) opt.selected = true;
    s.append(opt);
  });
  return s;
}

// an <input type=color> bound to three 0..255 device variables
function colorPicker(rM, gM, bM, idx) {
  const c = [rM, gM, bM].map(m => (store.val(m, ...idx) ?? 0) & 255);
  const hex = '#' + c.map(v => v.toString(16).padStart(2, '0')).join('');
  return el('input', { type: 'color', class: 'swatch', value: hex,
    oninput: (e) => {
      const h = e.target.value;
      store.set(rM, idx, parseInt(h.slice(1, 3), 16));
      store.set(gM, idx, parseInt(h.slice(3, 5), 16));
      store.set(bM, idx, parseInt(h.slice(5, 7), 16));
    } });
}

// a toggle button bound to a 0/1 variable
function toggleBtn(label, mnem, idx, onClass = 'pgm') {
  const on = store.val(mnem, ...idx) === 1;
  return el('button', { class: 'btn ' + (on ? onClass : 'ghost'), onclick: () => store.set(mnem, idx, on ? 0 : 1) }, label);
}
function boolChip(v, on = 'yes', off = 'no') {
  return el('span', { class: 'chip ' + (v === 1 ? 'on' : 'off') }, el('span', { class: 'dot' }), v == null ? '·' : v === 1 ? on : off);
}
// green "ok" when fine, red "alarm" when a fault is present
function alarmChip(bad, okText = 'ok', badText = 'alarm') {
  if (bad == null) return el('span', { class: 'chip off' }, el('span', { class: 'dot' }), '·');
  return el('span', { class: 'chip ' + (bad ? 'bad' : 'on') }, el('span', { class: 'dot' }), bad ? badText : okText);
}
function fmtIP(iface) {
  const o = [0, 1, 2, 3].map(k => store.val('ITlip', iface, k));
  return o.every(x => x != null) ? o.join('.') : '·';
}

// a labelled slider bound to a device variable at (mnem, idx)
function bind(label, mnem, idx, min, max, step = 1, fmt = (v) => v) {
  const def = store.byMnem.get(mnem);
  const lo = min ?? def?.min ?? 0, hi = max ?? def?.max ?? 100;
  const cur = store.val(mnem, ...idx);
  const shown = cur == null ? '·' : fmt(cur);
  return el('label', { class: 'field slider' },
    el('span', {}, label, el('b', { class: 'sv', text: shown })),
    el('input', {
      type: 'range', min: lo, max: hi, step, value: cur ?? lo,
      onpointerdown: beginDrag, onpointerup: endDrag, onpointercancel: endDrag,
      oninput: (e) => { throttledSet(mnem, idx, +e.target.value); e.target.parentNode.querySelector('.sv').textContent = fmt(+e.target.value); },
    }));
}

// ---------- Cues (a show script over the memory system) ----------
VIEWS.cues = (() => {
  const KEY = 'openrcs.cues';
  let cues = [];      // { id, label, scope, slot, screen, follow, wait, notes }
  let cur = -1;       // index of the last cue taken
  try {
    const saved = JSON.parse(localStorage.getItem(KEY) || '{}');
    cues = saved.cues || []; cur = saved.cur ?? -1;
  } catch { /* first run */ }
  const persist = () => localStorage.setItem(KEY, JSON.stringify({ cues, cur }));

  // draft for the "add cue" row
  let dScope = 'master', dSlot = 1, dScreen = 0, dLabel = '';
  let dFollow = false, dWait = 3000;

  // Autofollow: after a cue with follow, arm a timer to fire the next one. Any
  // manual action cancels it, so a hold is just leaving follow off.
  let followTimer = null, followFrom = -1, followAt = 0;
  function clearFollow() { if (followTimer) { clearTimeout(followTimer); followTimer = null; followFrom = -1; } }

  function recall(c, take) {
    if (c.scope === 'master') {
      store.set('PSmet', [], c.slot);
      store.set(take ? 'PSlot' : 'PSloa', [], 1);
    } else {
      store.set('PMscf', [], c.screen);
      store.set('PMmet', [], c.slot);
      store.set(take ? 'PMlot' : 'PMloa', [], 1);
    }
  }
  function go(i) {
    if (i < 0 || i >= cues.length) return;
    clearFollow();
    recall(cues[i], true); cur = i; persist();
    const c = cues[i];
    if (c.follow && cur + 1 < cues.length) {
      followFrom = i; followAt = Date.now() + Math.max(0, c.wait || 0);
      followTimer = setTimeout(() => { followTimer = null; followFrom = -1; goNext(); }, Math.max(0, c.wait || 0));
    }
    store.notify();
  }
  function goNext() { go(cur + 1 < cues.length ? cur + 1 : cur); }
  function hold() { clearFollow(); store.notify(); }
  function arm(i) { clearFollow(); recall(cues[i], false); store.notify(); }
  function addCue() {
    const label = dLabel.trim() || (dScope === 'master' ? `Master ${dSlot}` : `Screen ${dScreen + 1} · ${dSlot}`);
    cues.push({ id: Date.now(), label, scope: dScope, slot: dSlot, screen: dScreen, follow: dFollow, wait: dWait, notes: '' });
    dLabel = ''; persist(); store.notify();
  }
  function move(i, d) { const j = i + d; if (j < 0 || j >= cues.length) return; clearFollow(); [cues[i], cues[j]] = [cues[j], cues[i]]; if (cur === i) cur = j; else if (cur === j) cur = i; persist(); store.notify(); }
  function del(i) { clearFollow(); cues.splice(i, 1); if (cur >= cues.length) cur = cues.length - 1; persist(); store.notify(); }
  const patch = (c, k, v) => { c[k] = v; persist(); store.notify(); };

  function cueRow(c, i) {
    const target = c.scope === 'master' ? `Master ${c.slot + 1}` : `Screen ${c.screen + 1} · slot ${c.slot + 1}`;
    return el('div', { class: 'cue' + (i === cur ? ' current' : '') + (followFrom === i ? ' following' : '') },
      el('span', { class: 'cue-n', text: i + 1 }),
      el('div', { class: 'cue-main' },
        el('div', { class: 'cue-label', text: c.label }),
        el('div', { class: 'cue-target', text: target + (c.follow ? ` · auto ${(c.wait / 1000).toFixed(1)}s` : '') }),
        c.notes ? el('div', { class: 'cue-notes', text: c.notes }) : null),
      el('label', { class: 'cue-follow', title: 'Autofollow to the next cue' },
        checkbox(!!c.follow, v => patch(c, 'follow', v)),
        el('input', { type: 'number', min: 0, max: 600000, step: 500, value: c.wait, style: 'width:64px',
          title: 'Wait (ms)', oninput: e => patch(c, 'wait', Math.max(0, +e.target.value || 0)) })),
      el('button', { class: 'btn ghost', onclick: () => arm(i) }, 'Preview'),
      el('button', { class: 'btn pvw', onclick: () => go(i) }, 'Go'),
      el('div', { class: 'cue-ord' },
        el('button', { class: 'btn ghost', onclick: () => move(i, -1) }, '↑'),
        el('button', { class: 'btn ghost', onclick: () => move(i, 1) }, '↓'),
        el('button', { class: 'btn ghost', onclick: () => del(i) }, '✕')));
  }

  function render() {
    const next = cur + 1 < cues.length ? cues[cur + 1] : null;
    const following = followFrom >= 0;
    return el('div', {},
      el('div', { class: 'view-head' }, el('h1', { text: 'Cues' }),
        el('span', { class: 'hint', text: 'A show script — recall, take, and autofollow down the list' })),
      el('div', { class: 'panel' },
        el('div', { class: 'takebar' },
          el('div', { class: 'tbar' },
            el('div', { class: 'cue-next-label', text: next ? `Next: ${next.label}` : (cues.length ? 'End of list' : 'No cues yet') }),
            following ? el('div', { class: 'cue-following-note', text: 'Autofollow armed — GO or HOLD' }) : null),
          following
            ? el('button', { class: 'btn armed take-btn', onclick: hold }, 'HOLD')
            : null,
          el('button', { class: 'btn pgm take-btn', onclick: goNext, disabled: !next || undefined }, 'GO NEXT'))),
      el('div', { class: 'panel' },
        el('h2', 'Add cue'),
        el('div', { class: 'row' },
          el('div', { class: 'seg' },
            el('button', { class: dScope === 'master' ? 'on recall' : '', onclick: () => { dScope = 'master'; store.notify(); } }, 'Master'),
            el('button', { class: dScope === 'screen' ? 'on recall' : '', onclick: () => { dScope = 'screen'; store.notify(); } }, 'Screen')),
          dScope === 'screen' ? el('label', { class: 'field' }, 'Screen', screenSelect(dScreen, v => { dScreen = v; store.notify(); })) : null,
          el('label', { class: 'field' }, 'Slot',
            el('input', { type: 'number', min: 1, max: 144, value: dSlot + 1, style: 'width:70px',
              oninput: (e) => dSlot = Math.max(0, (+e.target.value || 1) - 1) })),
          el('label', { class: 'field' }, 'Label',
            el('input', { id: 'cue-label', type: 'text', placeholder: 'optional', value: dLabel, style: 'width:180px',
              oninput: (e) => dLabel = e.target.value })),
          el('label', { class: 'field' }, 'Autofollow', checkbox(dFollow, v => { dFollow = v; store.notify(); })),
          dFollow ? el('label', { class: 'field' }, 'Wait ms',
            el('input', { type: 'number', min: 0, max: 600000, step: 500, value: dWait, style: 'width:80px',
              oninput: (e) => dWait = Math.max(0, +e.target.value || 0) })) : null,
          el('button', { class: 'btn', onclick: addCue }, 'Add'))),
      el('div', { class: 'panel' },
        el('h2', `Cue list (${cues.length})`),
        cues.length
          ? el('div', { class: 'cue-list' }, ...cues.map(cueRow))
          : el('div', { class: 'empty-state', text: 'Build a cue list from your saved memories, then run the show with GO NEXT — or chain cues with autofollow.' })));
  }
  return { render };
})();

// ---------- Keys (programmable macro buttons) ----------
VIEWS.keys = (() => {
  const KEY = 'openrcs.keys';
  let keys = [];      // { id, name, colour, actions:[{type,...}] }
  let editing = false;
  let openKey = null; // id being edited
  try { keys = JSON.parse(localStorage.getItem(KEY) || '[]'); } catch { /* first run */ }
  const persist = () => localStorage.setItem(KEY, JSON.stringify(keys));

  const ACTION_TYPES = {
    master: { label: 'Recall master memory', fields: ['slot', 'take'], desc: a => `Master mem ${a.slot + 1}${a.take ? ' + take' : ''}` },
    screen: { label: 'Recall screen memory', fields: ['screen', 'slot', 'take'], desc: a => `Screen ${a.screen + 1} mem ${a.slot + 1}${a.take ? ' + take' : ''}` },
    take:   { label: 'Take', fields: ['screenAll'], desc: a => a.screen < 0 ? 'Take all screens' : `Take screen ${a.screen + 1}` },
    freeze: { label: 'Freeze input', fields: ['input', 'on'], desc: a => `${a.on ? 'Freeze' : 'Unfreeze'} IN ${a.input + 1}` },
    black:  { label: 'Output black', fields: ['output', 'on'], desc: a => `${a.on ? 'Black' : 'Unblack'} OUT ${a.output + 1}` },
    ftb:    { label: 'Master fade', fields: ['screen', 'dir'], desc: a => `${a.dir === 1 ? 'Fade to black' : 'Fade up'} screen ${a.screen + 1}` },
  };

  function runAction(a) {
    switch (a.type) {
      case 'master': store.set('PSmet', [], a.slot); store.set(a.take ? 'PSlot' : 'PSloa', [], 1); break;
      case 'screen': store.set('PMscf', [], a.screen); store.set('PMmet', [], a.slot); store.set(a.take ? 'PMlot' : 'PMloa', [], 1); break;
      case 'take': if (a.screen < 0) { for (let s = 0; s < screenCount(); s++) doTake(s); } else doTake(a.screen); break;
      case 'freeze': store.set('INfrz', [a.input], a.on ? 1 : 0); break;
      case 'black': store.set('OUbla', [a.output], a.on ? 1 : 0); break;
      case 'ftb': store.set('MAmfa', [a.screen], a.dir); break;
    }
  }
  const runKey = (k) => k.actions.forEach(runAction);

  // draft for the add-action form (per open key)
  let dType = 'master', dSlot = 0, dScreen = 0, dInput = 0, dOutput = 0, dTake = true, dOn = true, dDir = 1;
  function addAction(k) {
    const a = { type: dType };
    if (dType === 'master') { a.slot = dSlot; a.take = dTake; }
    else if (dType === 'screen') { a.screen = dScreen; a.slot = dSlot; a.take = dTake; }
    else if (dType === 'take') { a.screen = dScreen; }         // dScreen -1 = all
    else if (dType === 'freeze') { a.input = dInput; a.on = dOn; }
    else if (dType === 'black') { a.output = dOutput; a.on = dOn; }
    else if (dType === 'ftb') { a.screen = dScreen; a.dir = dDir; }
    k.actions.push(a); persist(); store.notify();
  }

  function newKey() { const k = { id: Date.now(), name: 'Key ' + (keys.length + 1), actions: [] }; keys.push(k); openKey = k.id; persist(); store.notify(); }
  function delKey(id) { keys = keys.filter(k => k.id !== id); if (openKey === id) openKey = null; persist(); store.notify(); }

  function actionForm(k) {
    const t = ACTION_TYPES[dType];
    const f = (name) => t.fields.includes(name);
    return el('div', { class: 'row', style: 'flex-wrap:wrap' },
      el('label', { class: 'field' }, 'Action', enumSelect2(dType, Object.entries(ACTION_TYPES).map(([v, o]) => [v, o.label]), v => { dType = v; store.notify(); })),
      f('screen') ? el('label', { class: 'field' }, 'Screen', screenSelect(dScreen, v => { dScreen = v; store.notify(); })) : null,
      f('screenAll') ? el('label', { class: 'field' }, 'Screen', el('select', { onchange: e => { dScreen = +e.target.value; } },
        el('option', { value: -1 }, 'All screens'), ...[0, 1, 2, 3, 4, 5, 6, 7].map(s => el('option', { value: s, selected: dScreen === s || undefined }, 'Screen ' + (s + 1)))) ) : null,
      f('slot') ? el('label', { class: 'field' }, 'Slot', el('input', { type: 'number', min: 1, max: 144, value: dSlot + 1, style: 'width:70px', oninput: e => dSlot = Math.max(0, (+e.target.value || 1) - 1) })) : null,
      f('input') ? el('label', { class: 'field' }, 'Input', el('input', { type: 'number', min: 1, max: 24, value: dInput + 1, style: 'width:70px', oninput: e => dInput = Math.max(0, (+e.target.value || 1) - 1) })) : null,
      f('output') ? el('label', { class: 'field' }, 'Output', el('input', { type: 'number', min: 1, max: 8, value: dOutput + 1, style: 'width:70px', oninput: e => dOutput = Math.max(0, (+e.target.value || 1) - 1) })) : null,
      f('take') ? el('label', { class: 'field' }, 'Then take', checkbox(dTake, v => { dTake = v; store.notify(); })) : null,
      f('on') ? el('label', { class: 'field' }, 'On', checkbox(dOn, v => { dOn = v; store.notify(); })) : null,
      f('dir') ? el('label', { class: 'field' }, 'Direction', el('select', { onchange: e => dDir = +e.target.value }, el('option', { value: 1, selected: dDir === 1 || undefined }, 'To black'), el('option', { value: 2, selected: dDir === 2 || undefined }, 'Up'))) : null,
      el('button', { class: 'btn', onclick: () => addAction(k) }, 'Add action'));
  }

  function keyEditor(k) {
    return el('div', { class: 'panel' },
      el('div', { class: 'row' },
        el('label', { class: 'field' }, 'Name', el('input', { type: 'text', value: k.name, style: 'width:220px', oninput: e => { k.name = e.target.value; persist(); } })),
        el('div', { class: 'spacer' }),
        el('button', { class: 'btn ghost', onclick: () => { openKey = null; store.notify(); } }, 'Close'),
        el('button', { class: 'btn ghost', onclick: () => delKey(k.id) }, 'Delete key')),
      el('div', { class: 'action-list' }, ...k.actions.map((a, ai) =>
        el('div', { class: 'action-item' },
          el('span', { class: 'action-n', text: ai + 1 }),
          el('span', { class: 'action-desc', text: ACTION_TYPES[a.type].desc(a) }),
          el('button', { class: 'btn ghost', onclick: () => { k.actions.splice(ai, 1); persist(); store.notify(); } }, '✕')))),
      k.actions.length === 0 ? el('div', { class: 'empty-state', text: 'No actions yet — add one below.' }) : null,
      el('div', { class: 'sub-head' }, 'Add action'),
      actionForm(k));
  }

  function render() {
    const open = keys.find(k => k.id === openKey);
    return el('div', {},
      el('div', { class: 'view-head' }, el('h1', { text: 'Keys' }),
        el('span', { class: 'hint', text: editing ? 'Editing — tap a key to program it' : 'Tap a key to run its actions' }),
        el('div', { class: 'spacer' }),
        el('button', { class: 'btn ' + (editing ? 'pgm' : 'ghost'), onclick: () => { editing = !editing; openKey = null; store.notify(); } }, editing ? 'Done' : 'Edit')),
      el('div', { class: 'panel' },
        el('div', { class: 'key-grid' },
          ...keys.map(k => el('button', { class: 'user-key', onclick: () => editing ? (openKey = k.id, store.notify()) : runKey(k) },
            el('span', { class: 'user-key-name', text: k.name }),
            el('span', { class: 'user-key-sub', text: k.actions.length + ' action' + (k.actions.length === 1 ? '' : 's') }))),
          editing ? el('button', { class: 'user-key add', onclick: newKey }, el('span', { class: 'user-key-name', text: '+ New key' })) : null),
        keys.length === 0 && !editing ? el('div', { class: 'empty-state', text: 'No keys yet. Tap Edit to program one — recall a memory, take, freeze a source, and more, in one press.' }) : null),
      open ? keyEditor(open) : null);
  }
  return { render };
})();

// small helpers used by Keys
function enumSelect2(cur, pairs, onchange) {
  const s = el('select', { onchange: e => onchange(e.target.value) });
  for (const [v, label] of pairs) s.append(el('option', { value: v, selected: v === cur || undefined }, label));
  return s;
}
function checkbox(on, onchange) {
  return el('input', { type: 'checkbox', checked: on || undefined, onchange: e => onchange(e.target.checked) });
}

// ---------- Show files: state snapshot / restore ----------
// Capture the device's writable state to a portable JSON "show", and restore it
// by replaying sets. This is the foundation the Confidence (undo) buffer builds
// on, and the first step toward offline planning. The rule that keeps restore
// safe: capture only *indexed content* variables. A scalar writable inside a
// memory or control group is almost always a momentary trigger — SAVE, LOAD,
// TAKE, RESET — not a value to be restored; the take/swap verbs are indexed but
// live in groups no scope includes. So "indexed, writable, not a status readback"
// captures the look and the banks without ever firing an action.
const SHOW_VERSION = 1;
const sleep = (ms) => new Promise(r => setTimeout(r, ms));

// Scopes are sets of variable *groups*; a scope is offered only when the
// connected device advertises at least one of its groups. Group names cover
// both platforms (LiveCore bare, Midra GRP_*); the engine intersects with
// whatever the device actually has.
const SHOW_SCOPES = [
  { id: 'look', label: 'Live look',
    hint: 'The current on-screen composition — every layer’s source, geometry, opacity, border, crop and transitions, plus the native background and any working areas.',
    groups: ['PRESET', 'PRESET_NATIVE', 'MASTER_ALPHA', 'GRP_PRESET_ELEMENT'] },
  { id: 'memories', label: 'Memory banks',
    hint: 'The stored screen and master memories, and the layer bank. Large — a full bank is thousands of values and takes a moment to read.',
    groups: ['PRESET_MEMORIES', 'MASTER_PRESET_MEMORIES', 'CONFIDENCE_MEMORIES', 'MONITORING_LAYOUT_MEMORIES', 'GRP_PRESET_MEMORY'] },
  { id: 'inputs', label: 'Input setup',
    hint: 'Per-input settings and plug configuration.',
    groups: ['INPUT', 'INPUT_SETTINGS', 'INPUT_SETTINGS_MEMORIES', 'GRP_INPUT', 'GRP_INPUT_SETTINGS', 'GRP_INPUT_SETTINGS_MEMORIES', 'GRP_INPUT_KEYING'] },
  { id: 'outputs', label: 'Outputs & screens',
    hint: 'Output format and processing, screen composition and soft-edge blends.',
    groups: ['OUTPUT', 'OUTPUT_SCREEN', 'OUTPUT_CONTROL', 'OUTPUT_AOI_SIZE', 'SCREEN', 'SCREEN_MIRROR', 'SOFTEDGE', 'MONITORING_LAYOUT', 'MONITORING__OUTPUTS', 'MONITORING_SCREEN', 'GRP_OUTPUT', 'GRP_VIDEO_OUT', 'GRP_SCREEN', 'GRP_SCREEN_CONFIG', 'GRP_SOFTEDGE', 'GRP_OUTPUT_FORMAT'] },
  { id: 'audio', label: 'Audio',
    hint: 'Audio input and output routing and levels.',
    groups: ['GRP_AUDIO_INPUT', 'GRP_AUDIO_OUTPUT'] },
];

// A variable is capturable within a scope when the device has it, it's writable,
// it's indexed (scalars in these groups are triggers/selectors), and it isn't a
// status read-back the device flags writable. Returns the variable defs.
function scopeVars(scope) {
  const out = [];
  for (const g of scope.groups) {
    const list = store.byGroup.get(g);
    if (!list) continue;
    for (const def of list) {
      if (def.ro) continue;
      if (!def.dims || def.dims.length === 0) continue;
      if (/STATUS/.test(def.name || '')) continue;
      out.push(def);
    }
  }
  return out;
}
const scopeOffered = (scope) => scope.groups.some(g => store.byGroup.has(g));
const scopeCount = (scope) => scopeVars(scope).reduce((n, d) => n + d.dims.reduce((a, b) => a * b, 1), 0);

// Ask the device for every index of each named variable, letting the replies
// drain into the store between batches so the link isn't flooded. The store is
// a cache: it only holds values the client has actually read, so any operation
// that needs to compare against the *live* device — capture, or a restore's
// diff — must scan first rather than trust whatever happens to be cached.
async function scanMnems(mnems, onProgress) {
  for (let i = 0; i < mnems.length; i++) {
    store.scan(mnems[i]);
    if (onProgress) onProgress((i + 1) / mnems.length);
    if ((i & 7) === 7) await sleep(40);
  }
  await sleep(450);                        // settle for the last variable's replies
}

// Capture: scan every capturable variable, then serialize what came back.
async function captureShow(scopeIds, onProgress) {
  const scopes = SHOW_SCOPES.filter(s => scopeIds.includes(s.id) && scopeOffered(s));
  const defs = [];
  const seen = new Set();
  for (const sc of scopes) for (const d of scopeVars(sc)) if (!seen.has(d.m)) { seen.add(d.m); defs.push(d); }
  await scanMnems(defs.map(d => d.m), onProgress);
  const values = [];
  for (const [key, v] of store.state) {
    const bar = key.indexOf('|');
    const m = key.slice(0, bar);
    if (!seen.has(m)) continue;
    const idxStr = key.slice(bar + 1);
    values.push([m, idxStr === '' ? [] : idxStr.split(',').map(Number), v]);
  }
  return {
    format: 'openrcs-show', version: SHOW_VERSION,
    created: new Date().toISOString(),
    device: {
      platform: store.meta?.platform || null,
      model: deviceModel() || null,
      serial: store.val('DIdsn') ?? store.val('SYssn') ?? null,
    },
    scopes: scopeIds.filter(id => scopes.some(s => s.id === id)),
    // The layer bank is not device state — no processor stores a single layer —
    // so it travels beside the values rather than among them. A show captured
    // without the memories scope carries none, and leaves any existing bank
    // alone on restore.
    ...(scopeIds.includes('memories') ? { layerBank: LAYER_MEM.snapshot() } : {}),
    // Also not device state, and travels with the look rather than the banks:
    // a working area is a fact about how a screen is being used on this show.
    ...(scopeIds.includes('look') ? { workAreas: WORK_AREA.snapshot() } : {}),
    values,
  };
}

// The distinct variables a show touches that this device has and can be written.
const showMnems = (show) => [...new Set(show.values.map(v => v[0]))].filter(m => {
  const d = store.byMnem.get(m); return d && !d.ro;
});
// Re-read those variables so a diff or restore compares against the live device,
// not a stale/sparse cache.
const refreshShow = (show, onProgress) => scanMnems(showMnems(show), onProgress);

// How a show compares to the *cached* device state: values that would change,
// values that match, and values whose variable this device doesn't have (a
// foreign or newer capture). Only meaningful after refreshShow — the caller
// scans first. Values not yet in the cache count as changed.
function showDiff(show) {
  let same = 0, differ = 0, missing = 0;
  for (const [m, idx, v] of show.values) {
    const def = store.byMnem.get(m);
    if (!def || def.ro) { missing++; continue; }
    if (store.state.get(keyOf(m, idx)) === v) same++; else differ++;
  }
  return { same, differ, missing, total: show.values.length };
}

// Restore: replay captured values as sets, throttled. Only values that differ
// from the device's current state are written — a full look is thousands of
// values but almost all already match, so restore stays fast and touches the
// device as little as possible. Skips anything this device lacks or that's
// read-only. onProgress(fraction) runs across the values to write.
async function restoreShow(show, onProgress) {
  if (show.layerBank) LAYER_MEM.restore(show.layerBank);
  if (show.workAreas) WORK_AREA.restore(show.workAreas);
  const vals = show.values.filter(([m, idx, v]) => {
    const d = store.byMnem.get(m);
    return d && !d.ro && store.state.get(keyOf(m, idx)) !== v;
  });
  for (let i = 0; i < vals.length; i++) {
    const [m, idx, v] = vals[i];
    store.set(m, idx, v);
    if (onProgress) onProgress((i + 1) / vals.length);
    if ((i & 15) === 15) await sleep(30);
  }
  return vals.length;
}

// Snapshot from the client's cache without touching the device — instant, so it
// can run before an action. Only as complete as what's been read, which is
// exactly right for undo: the values an action is about to change were just read
// or written, so they're in the cache and revert can put them back.
function captureFromCache(scopeIds) {
  const scopes = SHOW_SCOPES.filter(s => scopeIds.includes(s.id) && scopeOffered(s));
  const seen = new Set();
  for (const sc of scopes) for (const d of scopeVars(sc)) seen.add(d.m);
  const values = [];
  for (const [key, v] of store.state) {
    const bar = key.indexOf('|');
    const m = key.slice(0, bar);
    if (!seen.has(m)) continue;
    const idxStr = key.slice(bar + 1);
    values.push([m, idxStr === '' ? [] : idxStr.split(',').map(Number), v]);
  }
  return {
    format: 'openrcs-show', version: SHOW_VERSION, created: new Date().toISOString(),
    device: { platform: store.meta?.platform || null, model: deviceModel() || null, serial: store.val('DIdsn') ?? null },
    scopes: scopeIds.filter(id => scopes.some(s => s.id === id)), values,
  };
}

// ---------- Confidence buffer (cheap undo) ----------
// A ring of lightweight 'look' snapshots taken from cache. Revert pushes one
// back through the same re-read-then-write path a show restore uses. Auto-mode
// snapshots just before a take, throttled so a TAKE ALL is one snapshot.
const CONFIDENCE = (() => {
  const KEY = 'openrcs.confidence';
  const CAP = 12;
  let ring = [], auto = false, lastAuto = 0;
  try { const s = JSON.parse(localStorage.getItem(KEY) || '{}'); ring = s.ring || []; auto = !!s.auto; } catch { /* first run */ }
  const persist = () => { try { localStorage.setItem(KEY, JSON.stringify({ ring, auto })); } catch { /* quota/private */ } };

  function snapshot(reason, opts = {}) {
    const snap = captureFromCache(['look']);
    if (!snap.values.length) return null;            // nothing read yet
    snap.id = Date.now(); snap.reason = reason || 'manual'; snap.auto = !!opts.auto;
    ring.unshift(snap);
    if (ring.length > CAP) ring.length = CAP;
    persist();
    if (!opts.auto) store.notify();
    return snap;
  }
  function autoSnapshot(reason) {
    if (!auto) return;
    const now = Date.now();
    if (now - lastAuto < 1500) return;               // coalesce a multi-screen take
    lastAuto = now;
    snapshot(reason, { auto: true });
  }
  return {
    snapshot, autoSnapshot,
    list: () => ring,
    getAuto: () => auto,
    setAuto: (v) => { auto = v; persist(); store.notify(); },
    remove: (id) => { ring = ring.filter(s => s.id !== id); persist(); store.notify(); },
    clear: () => { ring = []; persist(); store.notify(); },
  };
})();

// ---------- Shows view ----------
VIEWS.shows = (() => {
  const KEY = 'openrcs.shows';
  let shows = [];      // { id, name, created, device, scopes, values, kind }
  try { shows = JSON.parse(localStorage.getItem(KEY) || '[]'); } catch { /* first run */ }
  const persist = () => { try { localStorage.setItem(KEY, JSON.stringify(shows)); } catch { /* quota/private */ } };

  let pick = { look: true };            // which scopes to capture
  let busy = null;                      // { label, frac } while capturing/restoring
  let selected = null;                  // id of the show whose detail is open
  let note = '';                        // transient status line

  const setBusy = (label, frac) => { busy = { label, frac }; store.notify(); };
  const clearBusy = () => { busy = null; store.notify(); };
  const fmtWhen = (iso) => { try { return new Date(iso).toLocaleString(); } catch { return iso; } };

  async function doCapture() {
    const ids = SHOW_SCOPES.filter(s => pick[s.id] && scopeOffered(s)).map(s => s.id);
    if (!ids.length) { note = 'Pick at least one thing to capture.'; store.notify(); return; }
    setBusy('Reading device…', 0);
    const show = await captureShow(ids, f => setBusy('Reading device…', f));
    show.id = Date.now();
    show.kind = 'show';
    const scopeLabels = ids.map(id => SHOW_SCOPES.find(s => s.id === id).label).join(', ');
    show.name = `${deviceModel() || 'Show'} — ${new Date().toLocaleString()}`;
    shows.unshift(show); persist();
    note = `Captured ${show.values.length} values (${scopeLabels}).`;
    selected = show.id;
    clearBusy();
  }

  // Read the device before comparing — the diff shown in the detail is against
  // whatever the client last read, which may be sparse right after connecting.
  async function doCompare(show) {
    setBusy('Reading device…', 0);
    await refreshShow(show, f => setBusy('Reading device…', f));
    note = ''; clearBusy();
  }

  async function doRestore(show) {
    // Always re-read first, so the change count is real and the write is minimal.
    setBusy('Reading device…', 0);
    await refreshShow(show, f => setBusy('Reading device…', f));
    const d = showDiff(show);
    clearBusy();
    if (d.differ === 0) { note = `“${show.name}” already matches the device — nothing to restore.`; store.notify(); return; }
    const ok = confirm(
      `Restore “${show.name}”?\n\n` +
      `${d.differ} value(s) will change on the device, ${d.same} already match` +
      (d.missing ? `, ${d.missing} not applicable to this device` : '') + '.\n\n' +
      `This writes to the connected processor.`);
    if (!ok) { note = 'Restore cancelled.'; store.notify(); return; }
    setBusy('Restoring…', 0);
    const n = await restoreShow(show, f => setBusy('Restoring…', f));
    note = `Restored ${n} value(s) from “${show.name}”.`;
    clearBusy();
  }

  function download(show) {
    const safe = (show.name || 'show').replace(/[^\w.-]+/g, '_').slice(0, 60);
    const blob = new Blob([JSON.stringify(show, null, 2)], { type: 'application/json' });
    const a = el('a', { href: URL.createObjectURL(blob), download: `${safe}.orcs-show.json` });
    document.body.append(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(a.href), 4000);
  }

  function importFile(file) {
    const rd = new FileReader();
    rd.onload = () => {
      try {
        const show = JSON.parse(rd.result);
        if (show.format !== 'openrcs-show' || !Array.isArray(show.values)) throw 0;
        show.id = Date.now(); show.kind = show.kind || 'show';
        show.name = show.name || `Imported — ${file.name}`;
        shows.unshift(show); persist(); selected = show.id;
        note = `Imported "${show.name}" (${show.values.length} values).`;
      } catch { note = 'That file isn’t an openrcs show.'; }
      store.notify();
    };
    rd.readAsText(file);
  }

  function rename(show, name) { show.name = name; persist(); }
  function del(id) { shows = shows.filter(s => s.id !== id); if (selected === id) selected = null; persist(); store.notify(); }

  function capturePanel() {
    const offered = SHOW_SCOPES.filter(scopeOffered);
    return el('div', { class: 'panel' },
      el('h2', 'Capture a show'),
      el('div', { class: 'hint', text: 'Read the device’s current state into a saved show you can restore or download.' }),
      el('div', { class: 'scope-list' }, ...offered.map(s => {
        const n = scopeCount(s);
        return el('label', { class: 'scope-row' },
          checkbox(!!pick[s.id], v => { pick[s.id] = v; store.notify(); }),
          el('div', { class: 'scope-main' },
            el('div', { class: 'scope-label' }, s.label,
              el('span', { class: 'scope-n', text: `${n.toLocaleString()} values` })),
            el('div', { class: 'scope-hint', text: s.hint })));
      })),
      el('div', { class: 'row' },
        el('button', { class: 'btn pgm', onclick: doCapture, disabled: busy ? true : undefined }, 'Capture now'),
        el('label', { class: 'btn ghost file-btn' }, 'Import file…',
          el('input', { type: 'file', accept: '.json,application/json', style: 'display:none',
            onchange: e => { if (e.target.files[0]) importFile(e.target.files[0]); e.target.value = ''; } }))),
      busy ? el('div', { class: 'show-prog' },
        el('div', { class: 'show-prog-bar', style: `width:${Math.round(busy.frac * 100)}%` }),
        el('span', { class: 'show-prog-label', text: busy.label })) : null,
      note ? el('div', { class: 'show-note', text: note }) : null);
  }

  function detail(show) {
    const d = showDiff(show);
    return el('div', { class: 'show-detail' },
      el('div', { class: 'row', style: 'align-items:center' },
        el('span', { class: 'diff-chip diff-change', text: `${d.differ} to change` }),
        el('span', { class: 'diff-chip', text: `${d.same} match` }),
        d.missing ? el('span', { class: 'diff-chip diff-missing', text: `${d.missing} n/a here` }) : null,
        el('button', { class: 'btn ghost', onclick: () => doCompare(show), disabled: busy ? true : undefined }, 'Compare with device'),
        el('span', { class: 'show-note', style: 'margin:0', text: 'vs last read' })),
      el('div', { class: 'row' },
        el('button', { class: 'btn pgm', onclick: () => doRestore(show), disabled: busy ? true : undefined }, 'Restore to device'),
        el('button', { class: 'btn ghost', onclick: () => download(show) }, 'Download'),
        el('button', { class: 'btn ghost', onclick: () => del(show.id) }, 'Delete')));
  }

  function confRow(s) {
    const label = s.reason + (s.auto ? ' · auto' : '');
    return el('div', { class: 'conf-row' },
      el('div', { class: 'show-main' },
        el('div', { class: 'conf-name', text: label }),
        el('div', { class: 'show-meta', text: `${s.values.length.toLocaleString()} values · ${fmtWhen(s.created)}` })),
      el('button', { class: 'btn pvw', onclick: () => doRestore(s), disabled: busy ? true : undefined }, 'Revert'),
      el('button', { class: 'btn ghost', onclick: () => CONFIDENCE.remove(s.id) }, '✕'));
  }

  function confidencePanel() {
    const ring = CONFIDENCE.list();
    return el('div', { class: 'panel' },
      el('div', { class: 'row', style: 'align-items:center' },
        el('h2', 'Confidence'),
        el('div', { class: 'spacer' }),
        el('label', { class: 'field' }, 'Auto before take', checkbox(CONFIDENCE.getAuto(), v => CONFIDENCE.setAuto(v))),
        el('button', { class: 'btn', onclick: () => { const s = CONFIDENCE.snapshot('manual'); note = s ? 'Confidence snapshot taken.' : 'Nothing read yet to snapshot — open the Workspace first.'; store.notify(); } }, 'Snapshot now'),
        ring.length ? el('button', { class: 'btn ghost', onclick: () => CONFIDENCE.clear() }, 'Clear') : null),
      el('div', { class: 'hint', text: 'Instant undo — snapshots the current look from what’s already on screen. Revert re-reads the device and writes back only what changed.' }),
      ring.length
        ? el('div', { class: 'show-list' }, ...ring.map(confRow))
        : el('div', { class: 'empty-state', text: 'No confidence snapshots yet. Take one before a risky change, or turn on “Auto before take”.' }));
  }

  function showRow(show) {
    const open = selected === show.id;
    const scopes = (show.scopes || []).map(id => SHOW_SCOPES.find(s => s.id === id)?.label || id).join(', ');
    const foreign = show.device?.platform && store.meta && show.device.platform !== store.meta.platform;
    return el('div', { class: 'show-item' + (open ? ' open' : '') },
      el('div', { class: 'show-head', onclick: () => { selected = open ? null : show.id; store.notify(); } },
        el('div', { class: 'show-main' },
          el('input', { class: 'show-name', type: 'text', value: show.name,
            onclick: e => e.stopPropagation(),
            oninput: e => rename(show, e.target.value) }),
          el('div', { class: 'show-meta', text:
            `${show.values.length.toLocaleString()} values · ${scopes || 'custom'} · ${fmtWhen(show.created)}` +
            (show.device?.model ? ` · ${show.device.model}` : '') })),
        foreign ? el('span', { class: 'diff-chip diff-missing', text: show.device.platform }) : null,
        el('span', { class: 'show-caret', text: open ? '–' : '+' })),
      open ? detail(show) : null);
  }

  function render() {
    return el('div', {},
      el('div', { class: 'view-head' }, el('h1', { text: 'Shows' }),
        el('span', { class: 'hint', text: 'Save and restore the device’s state — a show file for the look and the banks' })),
      capturePanel(),
      confidencePanel(),
      el('div', { class: 'panel' },
        el('h2', `Saved shows (${shows.length})`),
        shows.length
          ? el('div', { class: 'show-list' }, ...shows.map(showRow))
          : el('div', { class: 'empty-state', text: 'No shows yet. Capture the current state above, or import a show file.' })));
  }
  return { render };
})();

// ---------- Destinations (super-destinations / screen groups) ----------
VIEWS.destinations = (() => {
  let ttime = 1000;
  let editing = false;

  function enter() {
    for (const m of ['SCssh', 'SCmly', 'Plngr', 'GCsta', 'GCava', 'GCtba', 'GCtup']) if (store.byMnem.has(m)) store.scan(m);
    // member layer sources, so a card can show what each screen is carrying
    for (const s of activeScreens()) for (let l = 0; l < layerSlots(); l++) store.get('PRinp', [s, groupLiveCtx(groupOf(s)), l]);
  }

  const STATUS = (g) => {
    const v = store.val('GCsta', g);
    if (v == null) return '—';
    if (v === GRP_FROM_DOWN || v === GRP_FROM_UP) return 'Transitioning';
    if (v === 4 || v === 5) return 'Copying';
    return v === GRP_AT_UP ? 'On air · B' : 'On air · A';
  };

  function takeAll() { for (const [g] of activeGroups()) if (membersMulti(g)) groupTake(g, ttime); }
  const membersMulti = (g) => activeScreens().filter(s => (store.val('Plngr', s) ?? s) === g).length > 1;

  function destCard([g, screens]) {
    const live = groupLiveCtx(g);
    const tbar = store.val('GCtba', g) ?? 0;
    const multi = screens.length > 1;
    return el('div', { class: 'dest-card' + (groupTransitioning(g) ? ' transit' : '') },
      el('div', { class: 'dest-head' },
        el('div', { class: 'dest-title' }, multi ? `Group ${g + 1}` : `Screen ${g + 1}`,
          el('span', { class: 'dest-status', text: STATUS(g) })),
        el('div', { class: 'dest-screens' },
          ...screens.map(s => el('span', { class: 'dest-chip' + (multi ? ' grp' : ''), text: `S${s + 1}` })))),
      el('div', { class: 'dest-tbar' },
        el('input', {
          type: 'range', min: 0, max: 65535, value: tbar,
          onpointerdown: beginDrag, onpointerup: endDrag,
          oninput: e => groupTbar(g, +e.target.value),
        })),
      el('div', { class: 'dest-controls' },
        el('button', { class: 'btn', onclick: () => groupStepBack(g), title: 'Step back' }, '↶'),
        el('button', { class: 'btn ghost', onclick: () => groupCut(g) }, 'CUT'),
        el('button', { class: 'btn pgm take-btn', onclick: () => groupTake(g, ttime) }, 'TAKE')));
  }

  // membership editor: one group number per active screen, then commit
  function memberEditor() {
    return el('div', { class: 'panel' },
      el('div', { class: 'row', style: 'align-items:center' },
        el('h2', 'Grouping'),
        el('div', { class: 'hint', text: 'Assign screens to a group to take them as one destination.' }),
        el('div', { class: 'spacer' }),
        el('button', { class: 'btn', onclick: () => { commitGroups(); enter(); } }, 'Update device')),
      el('div', { class: 'group-grid' }, ...activeScreens().map(s => {
        const g = store.val('Plngr', s) ?? s;
        return el('label', { class: 'group-cell' },
          el('span', { class: 'group-scr', text: `Screen ${s + 1}` }),
          el('select', { onchange: e => { store.set('Plngr', [s], +e.target.value); store.notify(); } },
            ...Array.from({ length: groupCount() }, (_, gi) => el('option', { value: gi, selected: gi === g || undefined }, `Group ${gi + 1}`))));
      })));
  }

  function render() {
    const groups = activeGroups();
    const anyMulti = groups.some(([g]) => membersMulti(g));
    return el('div', {},
      el('div', { class: 'view-head' }, el('h1', { text: 'Destinations' }),
        el('span', { class: 'hint', text: 'Take, cut and T-bar whole screen groups as one destination' }),
        el('div', { class: 'spacer' }),
        el('button', { class: 'btn ' + (editing ? 'pgm' : 'ghost'), onclick: () => { editing = !editing; store.notify(); } }, editing ? 'Done' : 'Edit groups')),
      el('div', { class: 'panel' },
        el('div', { class: 'takebar' },
          el('label', { class: 'field' }, 'Transition',
            el('input', { type: 'number', min: 0, max: 3000, step: 100, value: ttime, style: 'width:80px',
              oninput: e => ttime = Math.max(0, +e.target.value || 0) })),
          el('span', { class: 'hint', text: 'ms' }),
          el('div', { class: 'spacer' }),
          el('button', { class: 'btn pgm take-btn', onclick: takeAll, disabled: anyMulti ? undefined : true }, 'TAKE ALL GROUPS')),
        groups.length
          ? el('div', { class: 'dest-grid' }, ...groups.map(destCard))
          : el('div', { class: 'empty-state', text: 'No active screens.' })),
      editing ? memberEditor() : null);
  }
  return { render, enter };
})();

// ---------- Show mode (touch / front-of-house surface) ----------
// A stripped, big-target operator surface: take the whole rig, take each
// destination, and fire master memories — nothing to mis-hit under show light.
VIEWS.showmode = (() => {
  const SLOTS = 24;                    // master-memory tiles to show
  let ttime = 1000;

  function enter() {
    for (const m of ['SCssh', 'GCsta', 'Plngr', 'PSval']) if (store.byMnem.has(m)) store.scan(m);
    for (let i = 0; i < SLOTS; i++) fetchLabel('LBPSe', [i]);
  }

  const takeAll = () => { for (const s of activeScreens()) doTake(s, ttime); };
  const cutAll = () => { for (const s of activeScreens()) doCut(s); };
  function recallMaster(i) { store.set('PSmet', [], i); store.set('PSlot', [], 1); }

  function destTile([g, screens]) {
    const multi = screens.length > 1;
    const st = store.val('GCsta', g);
    const transit = st === GRP_FROM_DOWN || st === GRP_FROM_UP;
    return el('button', { class: 'sm-dest' + (transit ? ' transit' : ''), onclick: () => groupTake(g, ttime) },
      el('span', { class: 'sm-dest-name', text: multi ? `Group ${g + 1}` : screenLabel(screens[0]) }),
      el('span', { class: 'sm-dest-scr', text: screens.map(s => `S${s + 1}`).join(' ') }),
      el('span', { class: 'sm-dest-go', text: 'TAKE' }));
  }

  function memTile(i) {
    const valid = store.val('PSval', i) === 1;
    const label = readLabel('LBPSe', [i]);
    return el('button', { class: 'sm-mem' + (valid ? ' valid' : ''), disabled: valid ? undefined : true, onclick: () => recallMaster(i) },
      el('span', { class: 'sm-mem-n', text: i + 1 }),
      label ? el('span', { class: 'sm-mem-l', text: label }) : null);
  }

  function render() {
    const groups = hasBanks() ? activeGroups() : [];
    return el('div', { class: 'showmode' },
      el('div', { class: 'view-head' }, el('h1', { text: 'Show mode' }),
        el('span', { class: 'hint', text: 'Front-of-house — big targets for running the show' }),
        el('div', { class: 'spacer' }),
        el('label', { class: 'field' }, 'Transition',
          el('input', { type: 'number', min: 0, max: 3000, step: 100, value: ttime, style: 'width:80px',
            oninput: e => ttime = Math.max(0, +e.target.value || 0) }), el('span', { class: 'hint', text: 'ms' }))),
      el('div', { class: 'sm-transport' },
        el('button', { class: 'sm-big cut', onclick: cutAll }, 'CUT ALL'),
        el('button', { class: 'sm-big take', onclick: takeAll }, 'TAKE ALL')),
      groups.length
        ? el('div', { class: 'sm-dests' }, ...groups.map(destTile))
        : null,
      el('div', { class: 'sm-section', text: 'Master memories' }),
      el('div', { class: 'sm-mems' }, ...Array.from({ length: SLOTS }, (_, i) => memTile(i))));
  }
  return { render, enter };
})();

// ---------- Plan (offline planning) ----------
VIEWS.plan = (() => {
  let busy = null;   // { frac }

  async function push() {
    if (!store.connected) { store.notify(); return; }
    busy = { frac: 0 }; store.notify();
    await store.pushPlan(f => { busy = { frac: f }; store.notify(); });
    busy = null; store.notify();
  }

  function planRow(e) {
    return el('div', { class: 'plan-row' },
      el('span', { class: 'plan-mnem', text: e.m + (e.idx.length ? `[${e.idx.join(',')}]` : '') }),
      el('span', { class: 'plan-name', text: e.name }),
      el('span', { class: 'plan-val', text: e.v }));
  }

  function render() {
    const list = store.planList();
    return el('div', {},
      el('div', { class: 'view-head' }, el('h1', { text: 'Plan' }),
        el('span', { class: 'hint', text: 'Build a look with no device — edits are staged, then pushed on connect' })),
      el('div', { class: 'panel' },
        el('div', { class: 'row', style: 'align-items:center' },
          el('label', { class: 'plan-switch' },
            checkbox(store.plan, v => store.setPlan(v)),
            el('span', { text: store.plan ? 'Plan mode ON — edits are staged' : 'Plan mode off — edits go straight to the device' })),
          el('div', { class: 'spacer' }),
          el('span', { class: 'chip ' + (store.connected ? 'on' : 'off') },
            el('span', { class: 'dot' }), store.connected ? 'device online' : 'no device')),
        el('div', { class: 'hint', text: 'While on, everything you do in the Workspace, Layers, Memories and elsewhere is collected here instead of being sent. Reads show your staged values so the look previews as you build it. Push when a device is connected.' })),
      el('div', { class: 'panel' },
        el('div', { class: 'row', style: 'align-items:center' },
          el('h2', `Staged changes (${list.length})`),
          el('div', { class: 'spacer' }),
          el('button', { class: 'btn ghost', onclick: () => store.seedPlanFromLook(), title: 'Stage the current on-screen look as a starting point' }, 'Seed from look'),
          el('button', { class: 'btn pgm', onclick: push, disabled: (!list.length || !store.connected || busy) ? true : undefined },
            store.connected ? 'Push to device' : 'Push (no device)'),
          list.length ? el('button', { class: 'btn ghost', onclick: () => store.clearPlan() }, 'Discard') : null),
        busy ? el('div', { class: 'show-prog' },
          el('div', { class: 'show-prog-bar', style: `width:${Math.round(busy.frac * 100)}%` }),
          el('span', { class: 'show-prog-label', text: 'Pushing…' })) : null,
        list.length
          ? el('div', { class: 'plan-list' }, ...list.slice(0, 300).map(planRow))
          : el('div', { class: 'empty-state', text: store.plan ? 'No staged changes yet. Go build a look — every edit lands here.' : 'Turn on plan mode to start staging changes.' })));
  }
  return { render };
})();

// ---------- Live ----------
VIEWS.live = (() => {
  let screen = 0;
  let ttime = 1000;

  function enter() {
    store.scan('SCmly');
    for (let l = 0; l < layerSlots(); l++) { store.get('PRinp', [screen, 0, l]); if (hasPRlay()) store.get('PRlay', [screen, 0, l]); }
    if (store.byMnem.has('GCtup')) store.get('GCtup', [screen]);
    if (store.byMnem.has('MAfat')) { store.get('MAsna', [screen]); store.get('MAfat', []); }
    if (store.byMnem.has('GCfsc')) store.get('GCfsc', [screen]);
    if (store.byMnem.has('GCfra')) store.get('GCfra', []);
  }

  function take() { doTake(screen, ttime); }
  function cut() { doCut(screen); }
  // MAmfa (master fade auto): 1 = fade to black, 2 = fade up. Best-effort mapping.
  function fadeToBlack() { store.set('MAmfa', [screen], 1); }
  function fadeUp() { store.set('MAmfa', [screen], 2); }

  function layers() {
    const max = store.val('SCmly', screen) || 0;
    if (max === 0) return el('div', { class: 'empty-state', text: 'This screen has no layers. Configure it in Screens, or on the device, then layers appear here.' });
    const wrap = el('div', { class: 'layers' });
    for (let l = 0; l < max; l++) {
      const src = store.val('PRinp', screen, 0, l);
      const on = layerShown(screen, 0, l);
      wrap.append(el('div', { class: 'layer' + (on ? ' on' : '') },
        el('span', { class: 'tag', text: 'L' + (l + 1) }),
        el('span', { class: 'src', text: src != null ? (src === 0 ? '— none —' : 'IN ' + src) : '·' }),
        hasPRlay() ? el('button', { class: 'btn ghost', onclick: () => store.set('PRlay', [screen, 0, l], store.val('PRlay', screen, 0, l) === 1 ? 0 : 1) }, on ? 'Hide' : 'Show') : null));
    }
    return wrap;
  }

  function render() {
    return el('div', {},
      el('div', { class: 'view-head' }, el('h1', { text: 'Live' }),
        el('span', { class: 'hint', text: 'Preview → Program transitions' })),
      el('div', { class: 'panel' },
        el('div', { class: 'row' },
          el('label', { class: 'field' }, 'Screen', screenSelect(screen, v => { screen = v; enter(); store.notify(); })))),
      el('div', { class: 'panel' },
        el('h2', 'Take'),
        el('div', { class: 'takebar' },
          el('div', { class: 'tbar' },
            el('label', { class: 'field slider' },
              el('span', {}, 'Transition', el('b', { class: 'sv', text: (ttime / 1000).toFixed(1) + 's' })),
              el('input', { type: 'range', min: 0, max: 3000, step: 100, value: ttime,
                onpointerdown: beginDrag, onpointerup: endDrag, onpointercancel: endDrag,
                oninput: (e) => { ttime = +e.target.value; e.target.parentNode.querySelector('.sv').textContent = (ttime / 1000).toFixed(1) + 's'; } }))),
          el('button', { class: 'btn pvw take-btn', onclick: cut }, 'CUT'),
          el('button', { class: 'btn pgm take-btn', onclick: take }, 'TAKE'))),
      store.byMnem.has('MAmfa')
        ? el('div', { class: 'panel' },
          el('h2', 'Master fade'),
          el('div', { class: 'row' },
            bind('Fade time', 'MAfat', [], 0, 100, 1, v => (v / 10).toFixed(1) + 's'),
            el('div', { class: 'spacer' }),
            el('button', { class: 'btn', onclick: fadeUp }, 'Fade Up'),
            el('button', { class: 'btn pgm', onclick: fadeToBlack }, 'Fade to Black')))
        : store.byMnem.has('GCfsc')
        ? el('div', { class: 'panel' },
          el('h2', 'Freeze'),
          el('div', { class: 'row' },
            toggleBtn(`Freeze screen ${screen + 1}`, 'GCfsc', [screen], 'pgm'),
            el('div', { class: 'spacer' }),
            store.byMnem.has('GCfra') ? toggleBtn('Freeze all screens', 'GCfra', [], 'pgm') : null))
        : null,
      el('div', { class: 'panel' }, el('h2', `Screen ${screen + 1} layers`), layers()));
  }
  return { enter, render };
})();

// ---------- Layers (graphical arrangement editor) ----------
// Layer geometry on the wire: PRpoh/PRpov are the layer CENTRE in screen pixels
// biased by +POS_BIAS (so a centred full-screen 1080p layer reads 33728,33308 =
// 32768 + 960,540). PRsih/PRsiv are the size in pixels.
const POS_BIAS = 32768;

// ---------- LiveCore enums ----------
// Names taken from the device's own Web RCS, so these are the manufacturer's terms
// rather than guesses. See docs/PROTOCOL.md for how they were recovered.
const TRANSITIONS = ['Cut', 'Fade', 'Slide', 'Wipe', 'Circle', 'Stretch', 'Wipe advanced', '7'];
const TRANSITION_WAYS = ['Left → right', 'Right → left', 'Bottom → up', 'Up → bottom',
  'Vertical from/to centre', 'Horizontal from/to centre', 'Both from/to centre',
  'SW → NE', 'SE → NW', 'NW → SE', 'NE → SW'];
const BORDER_STYLES = ['None', 'Edge', 'Smooth', 'Smooth edge', 'Shadow', 'Smooth shadow'];
// Midra carries five styles rather than six. The manual names only the EDGE and SHADOW
// families, so this drops "smooth edge" from the LiveCore list — inferred, not confirmed.
const MIDRA_BORDER_STYLES = ['None', 'Edge', 'Smooth', 'Shadow', 'Smooth shadow'];
const SHADOW_POSITIONS = ['Bottom right', 'Bottom left', 'Top right', 'Top left'];
/** Labels for a variable's enum, padded with plain numbers if the device has more. */
function enumLabels(mnem, names) {
  const max = store.byMnem.get(mnem)?.max ?? names.length - 1;
  const out = names.slice(0, max + 1);
  for (let i = out.length; i <= max; i++) out.push(String(i));
  return out;
}
const ASPECT_OVERRIDES = ['None', '1:1', 'Centred', 'Fullscreen', 'Cropped'];
const NATIVE_TRANSITIONS = ['Cut', 'Fade', 'Wipe'];
const LAYER_STATUSES = ['Off', 'Open', 'Close', 'Cross', 'Flying', 'Flying depth', 'Slave', 'Mask'];

// PE_FLAGS — the bit layout of PRflg / PMflg.
const PE_FLAG = {
  FORCE_TRANSITION: 0, SMOOTH_TRANSITION: 1, FLIP_H: 2, FLIP_V: 3,
  FLY_BEZIER_1PT: 4, FLY_BEZIER_2PT: 5, FLY_BEZIER_DEVIANT: 6,
  DEPTH_CUT_MIDDLE: 7, DEPTH_CUT_END: 8, FORCE_CROSS: 9,
  BLACK_N_WHITE: 10, NEGATIVE: 11, SEPIA: 12, SOLAR: 13,
  DEPTH_CUT_START: 14, MASK_CUT_N_FILL: 15,
  ANCHOR_SLICE_0: 16, ANCHOR_SLICE_1: 17, ANCHOR_SLICE_2: 18, ANCHOR_SLICE_3: 19,
  ROUND_BORDER_CORNER: 20,
};
VIEWS.layers = (() => {
  let screen = 0;
  // Track the *role* being edited, not a preset index: which bank is program moves
  // with the device (see liveCtx), so a fixed index would edit the wrong one.
  let role = 'pvw';
  let sel = 0;             // selected layer
  const ctxOf = () => role === 'pgm' ? liveCtx(screen) : editCtx(screen);

  const count = () => { const m = store.val('SCmly', screen) || 0; return m > 0 ? m : 8; };
  const screenPx = () => ({
    w: store.val('SCssh', screen) || 1920,
    h: store.val('SCssv', screen) || 1080,
  });
  // Midra built-in layouts: GCqly[screen,ctx]=N picks a preset arrangement; the
  // device then pushes the new per-layer geometry, which our canvas reflects.
  function layoutSelect() {
    const cur = store.val('GCqly', screen, ctxOf()), max = store.byMnem.get('GCqly')?.max ?? 26;
    const s = el('select', { onchange: (e) => { store.set('GCqly', [screen, ctxOf()], +e.target.value); setTimeout(() => { enter(); store.notify(); }, 350); } });
    for (let i = 0; i <= max; i++) { const o = el('option', { value: i, text: 'Layout ' + (i + 1) }); if (i === cur) o.selected = true; s.append(o); }
    return s;
  }

  const LAYER_VARS = ['PRinp', 'PRlay', 'PRalp', 'PRpoh', 'PRpov', 'PRsih', 'PRsiv',
    'PRbst', 'PRbcr', 'PRbcg', 'PRbcb', 'PRbsh', 'PRbsv', 'PRbal',
    'PRcph', 'PRcpv', 'PRcsh', 'PRcsv', 'PRotr', 'PRowa', 'PRctr', 'PRcwa'];
  function enter() {
    // Midra protects the program preset; edits must go to preview with
    // preset-update-mode on. Enabling it here lets source/geometry edits stick,
    // then a take commits them. (LiveCore edits apply directly — don't touch it.)
    if (store.meta?.platform === 'midra') store.set('CTpmu', [], 1);
    if (store.byMnem.has('GCqly')) store.get('GCqly', [screen, ctxOf()]);
    store.scan('SCmly'); store.scan('SCssh'); store.scan('SCssv');
    for (const m of ['PNinp', 'PNalp', 'PNbcr', 'PNbcg', 'PNbcb']) if (store.byMnem.has(m)) store.get(m, [screen, ctxOf()]);
    const n = count();
    for (let l = 0; l < n; l++)
      for (const m of LAYER_VARS) if (store.byMnem.has(m)) store.get(m, [screen, ctxOf(), l]);
  }

  function background() {
    const i = [screen, ctxOf()];
    const src = store.val('PNinp', ...i);
    return el('div', { class: 'editor' },
      el('div', { class: 'row' },
        el('label', { class: 'field' }, 'Source',
          enumSelect('PNinp', i, ['Colour', ...Array.from({ length: 8 }, (_, k) => 'BG set ' + (k + 1))])),
        el('label', { class: 'field' }, 'Colour', colorPicker('PNbcr', 'PNbcg', 'PNbcb', i))),
      bind('Opacity', 'PNalp', i, 0, 256, 1, v => Math.round(v / 256 * 100) + '%'));
  }

  // device layer -> {left,top,w,h} in device pixels
  function rectPx(l) {
    const cx = (store.val('PRpoh', screen, ctxOf(), l) ?? POS_BIAS) - POS_BIAS;
    const cy = (store.val('PRpov', screen, ctxOf(), l) ?? POS_BIAS) - POS_BIAS;
    const w = store.val('PRsih', screen, ctxOf(), l) ?? 0;
    const h = store.val('PRsiv', screen, ctxOf(), l) ?? 0;
    return { left: cx - w / 2, top: cy - h / 2, w, h };
  }
  const setGeom = (l, r) => {
    r = WORK_AREA.fit(screen, r);
    throttledSet('PRsih', [screen, ctxOf(), l], Math.round(r.w));
    throttledSet('PRsiv', [screen, ctxOf(), l], Math.round(r.h));
    throttledSet('PRpoh', [screen, ctxOf(), l], Math.round(r.left + r.w / 2 + POS_BIAS));
    throttledSet('PRpov', [screen, ctxOf(), l], Math.round(r.top + r.h / 2 + POS_BIAS));
  };

  function canvas() {
    const s = screenPx();
    const CW = 720, scale = CW / s.w, CH = s.h * scale;
    const cv = el('div', { class: 'screen-canvas', style: `width:${CW}px;height:${Math.round(CH)}px` });
    cv.append(workOverlay(screen, s.w, s.h) || '');
    const n = count();
    for (let l = 0; l < n; l++) {
      const on = layerShown(screen, ctxOf(), l);
      const src = store.val('PRinp', screen, ctxOf(), l);
      // don't clutter the canvas with empty, hidden layers
      if (!src && !on && l !== sel) continue;
      const r = rectPx(l);
      const box = el('div', {
        class: 'lrect' + (l === sel ? ' sel' : '') + (on ? '' : ' off'),
        style: `left:${r.left * scale}px;top:${r.top * scale}px;width:${r.w * scale}px;height:${r.h * scale}px;z-index:${l + 1}`,
        onpointerdown: (e) => dragMove(e, l, scale),
      },
        el('span', { class: 'lrect-tag', text: `L${l + 1}${src ? ' · ' + sourceName(src) : ''}` }),
        ...['nw', 'ne', 'sw', 'se'].map(c =>
          el('div', { class: 'handle ' + c, onpointerdown: (e) => dragResize(e, l, scale, c) })));
      cv.append(box);
    }
    return el('div', { class: 'canvas-wrap' }, cv);
  }

  function dragMove(e, l, scale) {
    e.preventDefault(); e.stopPropagation();
    beginDrag(); sel = l;
    const box = e.currentTarget;
    const sx = e.clientX, sy = e.clientY, r0 = rectPx(l);
    const move = (ev) => {
      const dx = (ev.clientX - sx) / scale, dy = (ev.clientY - sy) / scale;
      const r = { ...r0, left: r0.left + dx, top: r0.top + dy };
      box.style.left = r.left * scale + 'px'; box.style.top = r.top * scale + 'px';
      setGeom(l, r);
    };
    const up = () => { document.removeEventListener('pointermove', move); document.removeEventListener('pointerup', up); endDrag(); };
    document.addEventListener('pointermove', move); document.addEventListener('pointerup', up);
  }

  function dragResize(e, l, scale, corner) {
    e.preventDefault(); e.stopPropagation();
    beginDrag(); sel = l;
    const box = e.currentTarget.parentNode;
    const sx = e.clientX, sy = e.clientY, r0 = rectPx(l);
    const west = corner.includes('w'), north = corner.includes('n');
    const move = (ev) => {
      const dx = (ev.clientX - sx) / scale, dy = (ev.clientY - sy) / scale;
      let left = r0.left, right = r0.left + r0.w, top = r0.top, bot = r0.top + r0.h;
      if (west) left = Math.min(right - 16, r0.left + dx); else right = Math.max(left + 16, right + dx);
      if (north) top = Math.min(bot - 16, r0.top + dy); else bot = Math.max(top + 16, bot + dy);
      const r = { left, top, w: right - left, h: bot - top };
      box.style.left = r.left * scale + 'px'; box.style.top = r.top * scale + 'px';
      box.style.width = r.w * scale + 'px'; box.style.height = r.h * scale + 'px';
      setGeom(l, r);
    };
    const up = () => { document.removeEventListener('pointermove', move); document.removeEventListener('pointerup', up); endDrag(); };
    document.addEventListener('pointermove', move); document.addEventListener('pointerup', up);
  }

  // quick geometry presets for the selected layer
  function fit() {
    const a = workPx(screen);
    setGeom(sel, { left: a.x, top: a.y, w: a.w, h: a.h }); store.notify();
  }
  function quad(ix) {
    const a = workPx(screen), w = a.w / 2, h = a.h / 2;
    setGeom(sel, { left: a.x + (ix % 2) * w, top: a.y + (ix < 2 ? 0 : 1) * h, w, h }); store.notify();
  }
  // reorder the selected layer in the screen's z-stack (LAYER_SWAP)
  function reorder(dir) {
    store.set('LSscr', [], screen);
    store.set('LSprs', [], ctxOf());       // preset = the bank being edited
    store.set('LSlay', [], sel);
    store.set(dir === 'up' ? 'LSrai' : 'LSlow', [], 1);
  }

  function stack() {
    const n = count();
    const wrap = el('div', { class: 'layers' });
    for (let l = n - 1; l >= 0; l--) {
      const src = store.val('PRinp', screen, ctxOf(), l);
      const on = layerShown(screen, ctxOf(), l);
      wrap.append(el('div', { class: 'layer' + (on ? ' on' : '') + (l === sel ? ' sel' : ''), onclick: () => { sel = l; store.notify(); } },
        el('span', { class: 'tag', text: 'L' + (l + 1) }),
        el('span', { class: 'src', text: sourceName(src) }),
        hasPRlay() ? el('button', { class: 'btn ghost', onclick: (e) => { e.stopPropagation(); store.set('PRlay', [screen, ctxOf(), l], store.val('PRlay', screen, ctxOf(), l) === 1 ? 0 : 1); } }, on ? 'Hide' : 'Show') : null));
    }
    return wrap;
  }

  function editor() {
    const i = [screen, ctxOf(), sel];
    return el('div', { class: 'editor' },
      el('div', { class: 'row' },
        el('label', { class: 'field' }, 'Source', sourceSelect('PRinp', i)),
        hasPRlay() ? el('button', { class: 'btn ' + (store.val('PRlay', ...i) === 1 ? 'pgm' : 'ghost'), onclick: () => store.set('PRlay', i, store.val('PRlay', ...i) === 1 ? 0 : 1) },
          store.val('PRlay', ...i) === 1 ? 'Visible' : 'Hidden') : null),
      el('div', { class: 'row' },
        el('span', { class: 'hint', text: 'Snap:' }),
        el('button', { class: 'btn ghost', onclick: fit }, 'Full'),
        ...['◰', '◳', '◱', '◲'].map((g, k) => el('button', { class: 'btn ghost', onclick: () => quad(k) }, g)),
        el('div', { class: 'spacer' }),
        el('span', { class: 'hint', text: 'Order:' }),
        el('button', { class: 'btn ghost', title: 'Bring forward', onclick: () => reorder('up') }, '▲'),
        el('button', { class: 'btn ghost', title: 'Send back', onclick: () => reorder('down') }, '▼')),
      el('div', { class: 'grid2' },
        bind('Opacity', 'PRalp', i, 0, 256, 1, v => Math.round(v / 256 * 100) + '%'),
        bind('Position H', 'PRpoh', i, 0, 131072, 16),
        bind('Position V', 'PRpov', i, 0, 131072, 16),
        bind('Size H', 'PRsih', i, 0, 65535, 16),
        bind('Size V', 'PRsiv', i, 0, 65535, 16)),
      el('div', { class: 'sub-head' }, 'Border'),
      el('div', { class: 'row' },
        el('label', { class: 'field' }, 'Style',
          enumSelect('PRbst', i, ['None', 'Solid', 'Double', 'Bevel', 'Groove', 'Dashed'])),
        el('label', { class: 'field' }, 'Colour', colorPicker('PRbcr', 'PRbcg', 'PRbcb', i))),
      el('div', { class: 'grid2' },
        bind('Border width', 'PRbsh', i, 0, 127, 1),
        bind('Border height', 'PRbsv', i, 0, 127, 1),
        bind('Border opacity', 'PRbal', i, 0, 255, 1, v => Math.round(v / 255 * 100) + '%')),
      el('div', { class: 'sub-head' }, 'Transitions (on take)'),
      el('div', { class: 'grid2' },
        el('label', { class: 'field' }, 'Opening', enumSelect('PRotr', i, TRANSITIONS)),
        el('label', { class: 'field' }, 'Closing', enumSelect('PRctr', i, TRANSITIONS)),
        bind('Opening direction', 'PRowa', i, 0, 10, 1),
        bind('Closing direction', 'PRcwa', i, 0, 10, 1)),
      el('div', { class: 'sub-head' }, 'Crop'),
      el('div', { class: 'grid2' },
        bind('Crop H pos', 'PRcph', i, 0, 65535, 16),
        bind('Crop V pos', 'PRcpv', i, 0, 65535, 16),
        bind('Crop width', 'PRcsh', i, 0, 58981, 16),
        bind('Crop height', 'PRcsv', i, 0, 58981, 16)));
  }

  function render() {
    const configured = (store.val('SCmly', screen) || 0) > 0;
    return el('div', {},
      el('div', { class: 'view-head' }, el('h1', { text: 'Layers' }),
        el('span', { class: 'hint', text: `${screenLabel(screen)} · ${role === 'pgm' ? 'Program' : 'Preview'} · drag to arrange` })),
      el('div', { class: 'panel' },
        el('div', { class: 'row' },
          el('label', { class: 'field' }, 'Screen', screenSelect(screen, v => { screen = v; sel = 0; enter(); store.notify(); })),
          el('div', { class: 'seg' },
            el('button', { class: role === 'pgm' ? 'on take' : '', onclick: () => { role = 'pgm'; enter(); store.notify(); } }, 'Program'),
            el('button', { class: role === 'pvw' ? 'on recall' : '', onclick: () => { role = 'pvw'; enter(); store.notify(); } }, 'Preview')),
          store.byMnem.has('GCqly') ? el('label', { class: 'field' }, 'Layout', layoutSelect()) : null,
          !configured ? el('span', { class: 'hint', text: '⚠ screen not configured — edits are stored but won’t display until a screen is set up' }) : null)),
      el('div', { class: 'split-wide' },
        el('div', { class: 'panel' }, el('h2', 'Arrangement'), canvas()),
        el('div', {},
          el('div', { class: 'panel' }, el('h2', 'Layer stack'), stack()),
          el('div', { class: 'panel' }, el('h2', 'Background'), background()),
          el('div', { class: 'panel' }, el('h2', `Layer ${sel + 1}`), editor()))));
  }
  return { enter, render, focus(s, r) { screen = s; if (r) role = r; sel = 0; } };
})();

// device layer -> {left,top,w,h} in device pixels (shared with the Stage view)
function layerRectPx(screen, ctx, l) {
  const cx = (store.val('PRpoh', screen, ctx, l) ?? POS_BIAS) - POS_BIAS;
  const cy = (store.val('PRpov', screen, ctx, l) ?? POS_BIAS) - POS_BIAS;
  const w = store.val('PRsih', screen, ctx, l) ?? 0;
  const h = store.val('PRsiv', screen, ctx, l) ?? 0;
  return { left: cx - w / 2, top: cy - h / 2, w, h };
}
// stable-ish colour per source, so a source reads the same across screens
function srcColor(n) {
  if (!n) return 'transparent';
  const hue = (n * 47) % 360;
  return `hsl(${hue} 55% 45%)`;
}

// ---------- Stage (all screens at a glance) ----------
VIEWS.stage = (() => {
  // Which role to show, resolved to a preset index per screen — the bank that is
  // program is the device's business, not a constant (see liveCtx).
  let role = 'pgm';
  let ttime = 1000;
  const ctxOf = (s) => role === 'pgm' ? liveCtx(s) : editCtx(s);
  const active = () => Array.from({ length: screenCount() }, (_, s) => s).filter(s => (store.val('SCssh', s) || 0) > 0);
  function takeAll() { for (const s of active()) doTake(s, ttime); }
  function cutAll() { for (const s of active()) doCut(s); }

  function enter() {
    for (const m of ['SCssh', 'SCssv', 'SCmly']) store.scan(m);
    for (const m of ['GCsta', 'Plngr']) if (store.byMnem.has(m)) store.scan(m);
    for (let s = 0; s < screenCount(); s++) {
      fetchLabel('LBScr', [s]);
      for (let l = 0; l < layerSlots(); l++)
        for (const c of [0, 1])
          for (const m of ['PRinp', 'PRpoh', 'PRpov', 'PRsih', 'PRsiv'])
            store.get(m, [s, c, l]);
    }
  }

  function screenCard(s) {
    const ctx = ctxOf(s);
    const sw = store.val('SCssh', s) || 1920, sh = store.val('SCssv', s) || 1080;
    const CW = 380, scale = CW / sw, CH = Math.round(sh * scale);
    const cv = el('div', { class: 'stage-screen', style: `width:${CW}px;height:${CH}px` });
    cv.append(workOverlay(s, sw, sh, false) || '');
    const max = store.val('SCmly', s) || 0;
    for (let l = 0; l < max; l++) {
      const src = store.val('PRinp', s, ctx, l) || 0;
      if (!src) continue;                                   // draw layers that have a source
      const r = layerRectPx(s, ctx, l);
      cv.append(el('div', {
        class: 'stage-layer' + (sourceAvailable(src) ? '' : ' missing'),
        style: `left:${r.left * scale}px;top:${r.top * scale}px;width:${r.w * scale}px;height:${r.h * scale}px;`
             + `background:${srcColor(src)};z-index:${l + 1}`,
      }, el('span', { text: sourceName(src) })));
    }
    return el('div', { class: 'stage-card', onclick: () => { VIEWS.layers.focus(s, role); switchView('layers'); } },
      el('div', { class: 'stage-head' },
        el('span', { class: 'stage-name', text: screenLabel(s) }),
        midTransition(s) ? el('span', { class: 'ws-busy', text: '···' }) : null,
        el('span', { class: 'stage-dim', text: `${sw}×${sh} · ${store.val('SCmly', s) || 0} layers` })),
      cv);
  }

  function render() {
    const screens = active();
    return el('div', {},
      el('div', { class: 'view-head' }, el('h1', { text: 'Stage' }),
        el('span', { class: 'hint', text: `${screens.length} active screen${screens.length === 1 ? '' : 's'} · click one to edit its layers` })),
      el('div', { class: 'panel' },
        el('div', { class: 'takebar' },
          el('div', { class: 'seg' },
            el('button', { class: role === 'pgm' ? 'on take' : '', onclick: () => { role = 'pgm'; enter(); store.notify(); } }, 'Program'),
            el('button', { class: role === 'pvw' ? 'on recall' : '', onclick: () => { role = 'pvw'; enter(); store.notify(); } }, 'Preview')),
          el('div', { class: 'tbar' },
            el('label', { class: 'field slider' },
              el('span', {}, 'Transition', el('b', { class: 'sv', text: (ttime / 1000).toFixed(1) + 's' })),
              el('input', { type: 'range', min: 0, max: 3000, step: 100, value: ttime,
                onpointerdown: beginDrag, onpointerup: endDrag, onpointercancel: endDrag,
                oninput: (e) => { ttime = +e.target.value; e.target.parentNode.querySelector('.sv').textContent = (ttime / 1000).toFixed(1) + 's'; } }))),
          el('button', { class: 'btn pvw take-btn', onclick: cutAll }, 'CUT ALL'),
          el('button', { class: 'btn pgm take-btn', onclick: takeAll }, 'TAKE ALL'))),
      screens.length
        ? el('div', { class: 'stage-grid' }, ...screens.map(screenCard))
        : el('div', { class: 'panel' }, el('div', { class: 'empty-state', text: 'No screens configured yet.' })));
  }
  return { enter, render };
})();

// ---------- Wall (screen output-position map) ----------
// Screens occupy a rectangle in the device's output-tile grid: position
// OSpoh/OSpov (1..16, 1-based) and size SCsih/SCsiv (in tiles). This canvas
// places them to scale and lets you drag one to reposition it, then commit the
// arrangement with OSCREEN_OUT_GLOBAL_UPDATE.
VIEWS.wall = (() => {
  const clamp = (v, lo, hi) => Math.min(Math.max(v, lo), hi);
  const active = () => Array.from({ length: screenCount() }, (_, s) => s).filter(s => (store.val('SCssh', s) || 0) > 0);
  const posH = (s) => store.val('OSpoh', s) || 1;
  const posV = (s) => store.val('OSpov', s) || 1;
  const sizeH = (s) => store.val('SCsih', s) || 1;
  const sizeV = (s) => store.val('SCsiv', s) || 1;

  let sel = null, grab = null;

  function enter() {
    for (const m of ['SCssh', 'SCssv', 'SCmly', 'OSpoh', 'OSpov', 'SCsih', 'SCsiv', 'OSsou']) if (store.byMnem.has(m)) store.scan(m);
    for (let s = 0; s < screenCount(); s++) fetchLabel('LBScr', [s]);
  }

  const gridDims = () => {
    let w = 4, h = 3;
    for (const s of active()) { w = Math.max(w, posH(s) + sizeH(s) - 1); h = Math.max(h, posV(s) + sizeV(s) - 1); }
    return { w, h };
  };

  function onDown(e, s, tile) {
    beginDrag(); sel = s;
    grab = { x: e.clientX, y: e.clientY, poh: posH(s), pov: posV(s), tile };
    try { e.currentTarget.setPointerCapture(e.pointerId); } catch { /* ignore */ }
    store.notify();
  }
  function onMove(e, s) {
    if (!DRAG || sel !== s || !grab) return;
    const dx = Math.round((e.clientX - grab.x) / grab.tile);
    const dy = Math.round((e.clientY - grab.y) / grab.tile);
    const nh = clamp(grab.poh + dx, 1, 16 - sizeH(s) + 1);
    const nv = clamp(grab.pov + dy, 1, 16 - sizeV(s) + 1);
    if (nh !== posH(s)) store.set('OSpoh', [s], nh);
    if (nv !== posV(s)) store.set('OSpov', [s], nv);
  }
  function onUp() { endDrag(); grab = null; }

  const stepSize = (s, axis, d) => {
    const m = axis === 'h' ? 'SCsih' : 'SCsiv';
    const cur = axis === 'h' ? sizeH(s) : sizeV(s);
    const pos = axis === 'h' ? posH(s) : posV(s);
    store.set(m, [s], clamp(cur + d, 1, 16 - pos + 1));
  };

  function screenRect(s, tile) {
    const w = sizeH(s) * tile, h = sizeV(s) * tile;
    const left = (posH(s) - 1) * tile, top = (posV(s) - 1) * tile;
    const sw = store.val('SCssh', s) || 0, sh = store.val('SCssv', s) || 0;
    return el('div', {
      class: 'wall-screen' + (sel === s ? ' sel' : ''),
      style: `left:${left}px;top:${top}px;width:${w}px;height:${h}px;background:${srcColor(s + 1)}`,
      onpointerdown: e => onDown(e, s, tile),
      onpointermove: e => onMove(e, s),
      onpointerup: onUp, onpointercancel: onUp,
      onclick: () => { sel = s; store.notify(); },
    },
      el('span', { class: 'wall-name', text: screenLabel(s) }),
      el('span', { class: 'wall-dim', text: sw ? `${sw}×${sh}` : `${sizeH(s)}×${sizeV(s)} tiles` }));
  }

  function selPanel() {
    if (sel == null) return el('div', { class: 'hint', text: 'Click a screen to select it, drag to reposition.' });
    const s = sel;
    return el('div', { class: 'row', style: 'align-items:center;flex-wrap:wrap' },
      el('span', { class: 'wall-sel-name', text: screenLabel(s) }),
      el('label', { class: 'field' }, 'Pos',
        el('span', { class: 'wall-ro', text: `${posH(s)},${posV(s)}` })),
      el('label', { class: 'field' }, 'Width',
        el('button', { class: 'btn ghost', onclick: () => stepSize(s, 'h', -1) }, '−'),
        el('span', { class: 'wall-ro', text: sizeH(s) }),
        el('button', { class: 'btn ghost', onclick: () => stepSize(s, 'h', 1) }, '+')),
      el('label', { class: 'field' }, 'Height',
        el('button', { class: 'btn ghost', onclick: () => stepSize(s, 'v', -1) }, '−'),
        el('span', { class: 'wall-ro', text: sizeV(s) }),
        el('button', { class: 'btn ghost', onclick: () => stepSize(s, 'v', 1) }, '+')));
  }

  function render() {
    const screens = active();
    const { w, h } = gridDims();
    const CW = 720, tile = Math.floor(CW / w), CH = tile * h;
    const canvas = el('div', { class: 'wall-canvas', style: `width:${w * tile}px;height:${CH}px;--tile:${tile}px` });
    // grid lines
    for (let x = 1; x < w; x++) canvas.append(el('div', { class: 'wall-gline v', style: `left:${x * tile}px` }));
    for (let y = 1; y < h; y++) canvas.append(el('div', { class: 'wall-gline h', style: `top:${y * tile}px` }));
    for (const s of screens) canvas.append(screenRect(s, tile));

    return el('div', {},
      el('div', { class: 'view-head' }, el('h1', { text: 'Wall' }),
        el('span', { class: 'hint', text: 'Where each screen sits in the output — drag to arrange, then apply' }),
        el('div', { class: 'spacer' }),
        el('button', { class: 'btn pgm', onclick: () => { if (store.byMnem.has('OSupd')) store.set('OSupd', [], 1); }, disabled: store.byMnem.has('OSupd') ? undefined : true }, 'Apply to device')),
      el('div', { class: 'panel' }, selPanel()),
      el('div', { class: 'panel' },
        screens.length
          ? el('div', { class: 'wall-wrap' }, canvas)
          : el('div', { class: 'empty-state', text: 'No active screens to map.' })),
      el('div', { class: 'panel' },
        el('div', { class: 'hint', text: 'Positions are in output tiles (OSpoh/OSpov); size is SCsih/SCsiv. Apply commits the layout with a global output update.' })));
  }
  return { enter, render };
})();


// ================= LivePremier (AWJ) =================
//
// A different processor generation with a different protocol, so these views
// share no state with the mnemonic ones above: they read store.paths, not
// store.state, and they are the only views shown when the bridge is pointed at
// a LivePremier.
//
// THE PATHS BELOW MUST MATCH crates/openrcs-awj/src/paths.rs. Two builders for
// one protocol is a duplication with a real failure mode — a path that is right
// in one and stale in the other fails as an E12 at runtime, not at build time.

const isAwj = () => store.meta?.platform === 'livepremier';

const LP_SCREENS = 24;
const LP_PRESET_PAGE = 50;      // matches the server's connect-time inventory

const LP = {
  model: () => 'DeviceObject/system/$device/@items/1/@props/dev',
  label: (s) => `DeviceObject/$screen/@items/S${s}/control/@props/label`,
  isUsed: (s) => `DeviceObject/$screenAuxGroup/@items/S${s}/status/@props/isUsed`,
  transition: (s) => `DeviceObject/$screenAuxGroup/@items/S${s}/status/@props/transition`,
  takeStatus: (s) => `DeviceObject/$screenAuxGroup/@items/S${s}/status/@props/take`,
  takeTime: (s, up) => `DeviceObject/$screenAuxGroup/@items/S${s}/control/@props/take${up ? 'Up' : 'Down'}Time`,
  letter: (s, which) => `DeviceObject/$screenAuxGroup/@items/S${s}/control/@props/preset${which}`,
  take: (s) => `DeviceObject/$screenAuxGroup/@items/S${s}/control/@props/xTake`,
  cut: (s) => `DeviceObject/$screenAuxGroup/@items/S${s}/control/@props/xCut`,
  presetValid: (n) => `DeviceObject/presetBank/$bank/@items/${n}/status/@props/isValid`,
  presetLabel: (n) => `DeviceObject/presetBank/$bank/@items/${n}/control/@props/label`,
  loadScreen: (slot, s, target) =>
    `DeviceObject/presetBank/control/load/$slot/@items/${slot}/$screen/@items/S${s}/$preset/@items/${target}/@props/xRequest`,
  layerSource: (s, letter, layer) =>
    `DeviceObject/$screen/@items/S${s}/$preset/@items/${letter}/$layer/@items/${layer}/source/@props/inputNum`,
  // One prefix covers every screen's control and status: the device pushes a
  // change whose path STARTS WITH a subscribed string.
  SUB_SCREENS: 'DeviceObject/$screenAuxGroup',
};

// Every transition state names the end the T-bar is at or came from, so the
// rule is the DOWN/UP suffix. Testing only for AT_UP gets the four in-flight
// states backwards, invisibly, for exactly the length of a transition.
const lpProgramIsDown = (t) => typeof t === 'string' && t.endsWith('DOWN');

// The letter addressing a side of a screen. A device reports its own, and does
// not always use A and B, so these are read rather than assumed.
function lpLetter(s, which /* 'program' | 'preview' */) {
  const t = store.pval(LP.transition(s));
  const down = store.pval(LP.letter(s, 'Down'), 'A');
  const up = store.pval(LP.letter(s, 'Up'), 'B');
  const wantDown = which === 'program' ? lpProgramIsDown(t) : !lpProgramIsDown(t);
  return wantDown ? down : up;
}

const lpUsedScreens = () =>
  Array.from({ length: LP_SCREENS }, (_, i) => i + 1).filter(s => store.pval(LP.isUsed(s)) === true);

const lpSeconds = (tenths) => (tenths == null ? '·' : (tenths / 10).toFixed(1));

// ---------- LivePremier: Screens ----------
VIEWS.lpscreens = (() => {
  let live = false;      // whether we have written a subscription list

  function setLive(on) {
    live = on;
    // An empty list turns pushes off again — the device filters by prefix, and
    // nothing matches nothing.
    store.psub(on ? [LP.SUB_SCREENS] : []);
    store.notify();
  }

  function enter() {
    // The server inventories on connect; this covers a view opened later, or
    // after a device has been away.
    for (const s of lpUsedScreens()) {
      store.pget(LP.transition(s));
      store.pget(LP.takeStatus(s));
    }
  }

  function row(s) {
    const t = store.pval(LP.transition(s));
    const taking = store.pval(LP.takeStatus(s));
    const moving = typeof taking === 'string' && taking !== 'OFF';
    const up = store.pval(LP.takeTime(s, true));
    const down = store.pval(LP.takeTime(s, false));
    return el('tr', {},
      el('td', { text: `S${s}` }),
      el('td', { text: store.pval(LP.label(s)) || '—' }),
      el('td', { class: 'val', text: t == null ? '·' : String(t) }),
      el('td', { class: 'val', text: `${lpLetter(s, 'program')} / ${lpLetter(s, 'preview')}` }),
      el('td', { class: 'val', text: `${lpSeconds(up)} / ${lpSeconds(down)} s` }),
      el('td', {},
        moving
          ? el('span', { class: 'chip on' }, el('span', { class: 'dot' }), String(taking).toLowerCase())
          : el('span', { class: 'chip off' }, el('span', { class: 'dot' }), 'idle')),
      el('td', {},
        el('button', { class: 'btn pgm', onclick: () => store.pset(LP.take(s), true) }, 'Take'),
        el('button', { class: 'btn ghost', onclick: () => store.pset(LP.cut(s), true) }, 'Cut')));
  }

  function render() {
    const used = lpUsedScreens();
    return el('div', {},
      el('div', { class: 'view-head' },
        el('h1', { text: 'Screens' }),
        el('span', { class: 'hint', text: 'Screens in use, and the transition each is holding' })),
      el('div', { class: 'panel' },
        el('div', { class: 'row' },
          el('button', {
            class: live ? 'btn primary' : 'btn',
            onclick: () => setLive(!live),
          }, live ? 'Live updates on' : 'Live updates off'),
          el('span', {
            class: 'hint',
            text: live
              ? 'The device is pushing screen changes to this bridge.'
              : 'This processor tells a client nothing until asked to. Until this is on, what you see is what was last read.',
          })),
        used.length
          ? el('table', { class: 'grid' },
              el('thead', {}, el('tr', {}, ...['Screen', 'Label', 'Transition', 'PGM / PRW', 'Take up / down', 'State', ''].map(h => el('th', { text: h })))),
              el('tbody', {}, ...used.map(row)))
          : el('div', { class: 'hint pad', text: store.connected ? 'No screen on this device is in use.' : 'Waiting for the processor.' })));
  }

  return { enter, render };
})();

// ---------- LivePremier: Presets ----------
VIEWS.lppresets = (() => {
  let pages = 1;                 // how much of the bank has been asked for
  let target = 'PREVIEW';
  let screen = null;             // null = every screen in use

  function fetchPage(page) {
    const from = page * LP_PRESET_PAGE + 1;
    for (let n = from; n < from + LP_PRESET_PAGE; n++) {
      store.pget(LP.presetValid(n));
      store.pget(LP.presetLabel(n));
    }
  }

  function enter() {
    if (screen === null) screen = lpUsedScreens()[0] ?? 1;
  }

  function recall(slot) {
    const screens = screen === 'all' ? lpUsedScreens() : [screen];
    // Recalls are silent — the device answers a write with nothing — so the
    // surface reads the affected screen back rather than assuming it landed.
    for (const s of screens) {
      store.pset(LP.loadScreen(slot, s, target), true);
      store.pget(LP.transition(s));
    }
  }

  function slotTile(n) {
    const valid = store.pval(LP.presetValid(n)) === true;
    const label = store.pval(LP.presetLabel(n));
    return el('button', {
      class: 'slot' + (valid ? ' valid' : ''),
      disabled: !valid,
      title: valid ? `Recall ${n} to ${target.toLowerCase()}` : `Slot ${n} is empty`,
      onclick: () => valid && recall(n),
    },
      el('span', { class: 'num', text: String(n) }),
      valid ? el('span', { class: 'lbl', text: label || 'preset' }) : null);
  }

  function render() {
    const slots = [];
    for (let n = 1; n <= pages * LP_PRESET_PAGE; n++) slots.push(slotTile(n));
    const used = lpUsedScreens();
    return el('div', {},
      el('div', { class: 'view-head' },
        el('h1', { text: 'Presets' }),
        el('span', { class: 'hint', text: 'Screen preset bank — a slot the device reports as empty cannot be recalled' })),
      el('div', { class: 'panel' },
        el('div', { class: 'row' },
          el('label', { text: 'To ' }),
          el('select', {
            onchange: (e) => { target = e.target.value; store.notify(); },
          }, ...['PREVIEW', 'PROGRAM'].map(v => el('option', { value: v, selected: v === target, text: v.toLowerCase() }))),
          el('label', { text: ' on ' }),
          el('select', {
            onchange: (e) => { screen = e.target.value === 'all' ? 'all' : Number(e.target.value); store.notify(); },
          },
            ...used.map(s => el('option', { value: String(s), selected: s === screen, text: `S${s} ${store.pval(LP.label(s)) || ''}`.trim() })),
            el('option', { value: 'all', selected: screen === 'all', text: 'every screen in use' }))),
        el('div', { class: 'mem-grid' }, ...slots),
        el('div', { class: 'row' },
          el('button', {
            class: 'btn',
            onclick: () => { fetchPage(pages); pages += 1; store.notify(); },
          }, `Read slots ${pages * LP_PRESET_PAGE + 1}–${(pages + 1) * LP_PRESET_PAGE}`),
          el('span', { class: 'hint', text: 'The bank holds 1000 slots and each costs two reads, so it is paged rather than read whole.' }))));
  }

  return { enter, render };
})();

// ---------- Screens ----------
VIEWS.screens = (() => {
  let sel = 0;
  function enter() {
    for (const m of ['SCmly', 'OSsou', 'SCsih', 'SCsiv', 'SCssh', 'SCssv']) if (store.byMnem.has(m)) store.scan(m);
  }
  const screenPxOf = (s) => ({ w: store.val('SCssh', s) || 1920, h: store.val('SCssv', s) || 1080 });

  // Common shapes to carve out of a screen, so the usual cases are one tap
  // rather than four numbers. Each returns a rect in screen pixels.
  const PRESETS = [
    ['16:9 centred', (p) => insetToAspect(p, 16 / 9)],
    ['4:3 centred', (p) => insetToAspect(p, 4 / 3)],
    ['Left half', (p) => ({ x: 0, y: 0, w: Math.round(p.w / 2), h: p.h })],
    ['Right half', (p) => ({ x: Math.round(p.w / 2), y: 0, w: Math.round(p.w / 2), h: p.h })],
    ['Centre 80%', (p) => ({ x: Math.round(p.w * 0.1), y: Math.round(p.h * 0.1), w: Math.round(p.w * 0.8), h: Math.round(p.h * 0.8) })],
  ];
  function insetToAspect(p, ar) {
    const w = Math.min(p.w, Math.round(p.h * ar)), h = Math.round(w / ar);
    return { x: Math.round((p.w - w) / 2), y: Math.round((p.h - h) / 2), w, h };
  }

  /**
   * Pull layers that were already placed back inside the region.
   *
   * Setting a working area deliberately does not move anything on its own —
   * that would rearrange a live screen the moment the region was drawn. This is
   * the same clamp applied on request, across every preset bank so a take does
   * not bring an overhanging layer back.
   */
  function fitExisting(s) {
    const banks = store.byMnem.get('PRinp')?.dims?.[1] ?? 3;
    let moved = 0;
    for (let c = 0; c < banks; c++) {
      for (let l = 0; l < (store.val('SCmly', s) || layerSlots()); l++) {
        if (!store.val('PRinp', s, c, l)) continue;           // nothing placed there
        const w = store.val('PRsih', s, c, l) ?? 0, h = store.val('PRsiv', s, c, l) ?? 0;
        const cx = (store.val('PRpoh', s, c, l) ?? POS_BIAS) - POS_BIAS;
        const cy = (store.val('PRpov', s, c, l) ?? POS_BIAS) - POS_BIAS;
        const r = WORK_AREA.fit(s, { left: cx - w / 2, top: cy - h / 2, w, h });
        if (r.w === w && r.h === h && r.left === cx - w / 2 && r.top === cy - h / 2) continue;
        store.set('PRsih', [s, c, l], Math.round(r.w));
        store.set('PRsiv', [s, c, l], Math.round(r.h));
        store.set('PRpoh', [s, c, l], Math.round(r.left + r.w / 2 + POS_BIAS));
        store.set('PRpov', [s, c, l], Math.round(r.top + r.h / 2 + POS_BIAS));
        moved++;
      }
    }
    store.notify();
    return moved;
  }

  function areaEditor() {
    const s = sel, p = screenPxOf(s), a = WORK_AREA.get(s);
    const CW = 420, scale = CW / p.w;
    const cv = el('div', { class: 'screen-canvas', style: `width:${CW}px;height:${Math.round(p.h * scale)}px` });
    cv.append(workOverlay(s, p.w, p.h) || el('span', { class: 'se-mid', text: 'whole screen' }));

    const num = (label, key, max) => el('label', { class: 'field' }, label,
      el('input', {
        type: 'number', class: 'lbl-in', style: 'width:88px', min: 0, max,
        value: a ? a[key] : (key === 'w' ? p.w : key === 'h' ? p.h : 0), disabled: !a,
        onchange: (e) => {
          const next = { ...(a || { x: 0, y: 0, w: p.w, h: p.h }) };
          next[key] = Math.max(0, Math.min(max, Math.round(+e.target.value)));
          WORK_AREA.set(s, next); store.notify();
        },
      }));

    return el('div', { class: 'panel' },
      el('div', { class: 'row' },
        el('h2', `Working area — screen ${s + 1}`),
        screenSelect(sel, (v) => { sel = v; store.notify(); }),
        el('div', { class: 'spacer' }),
        el('span', { class: 'hint', text: `screen is ${p.w}×${p.h}` }),
        a ? el('button', { class: 'btn ghost', onclick: () => fitExisting(s) }, 'Fit existing layers') : null,
        a ? el('button', { class: 'btn ghost', onclick: () => { WORK_AREA.clear(s); store.notify(); } }, 'Use whole screen') : null),
      el('div', { class: 'hint pad', text:
        'Neither platform can crop an output, so this is openrcs’s own constraint rather than a device setting: '
        + 'layers are kept inside the region and the processor is never told. Use it when only part of the screen is '
        + 'actually seen — an LED wall inside a larger canvas, or an SDI feed that has to stay within a frame.' }),
      el('div', { class: 'row', style: 'align-items:flex-start;gap:16px' },
        cv,
        el('div', { style: 'flex:1' },
          el('div', { class: 'row' }, ...PRESETS.map(([label, make]) =>
            el('button', { class: 'ws-mini', onclick: () => { WORK_AREA.set(s, make(p)); store.notify(); } }, label))),
          el('div', { class: 'grid2' },
            num('X', 'x', p.w), num('Y', 'y', p.h),
            num('Width', 'w', p.w), num('Height', 'h', p.h)),
          el('div', { class: 'hint pad', text: a
            ? 'Layouts divide this region, and a layer cannot be dragged, sized or recalled outside it. '
              + 'Layers placed before the region was drawn are left where they are — “Fit existing layers” pulls them in.'
            : 'No working area — layers use the whole screen. Pick a shape above to set one.' }))));
  }

  function render() {
    const rows = [];
    for (let i = 0; i < screenCount(); i++) {
      const max = store.val('SCmly', i);
      const a = WORK_AREA.get(i);
      rows.push(el('tr', { class: i === sel ? 'sel-row' : '', onclick: () => { sel = i; store.notify(); } },
        el('td', { text: 'Screen ' + (i + 1) }),
        el('td', { class: 'val', text: fmt(store.val('OSsou', i)) }),
        el('td', { class: 'val', text: `${fmt(store.val('SCsih', i))}×${fmt(store.val('SCsiv', i))}` }),
        el('td', { class: 'val', text: fmt(max) }),
        el('td', { class: 'val', text: a ? `${a.w}×${a.h} @ ${a.x},${a.y}` : 'whole screen' }),
        el('td', {}, (max || 0) > 0 ? el('span', { class: 'chip on' }, el('span', { class: 'dot' }), 'active') : el('span', { class: 'chip off' }, el('span', { class: 'dot' }), 'unused'))));
    }
    return el('div', {},
      el('div', { class: 'view-head' }, el('h1', { text: 'Screens' }),
        el('span', { class: 'hint', text: `Output screens and their layer capacity${WORK_AREA.count() ? ` · ${WORK_AREA.count()} with a working area` : ''}` })),
      el('div', { class: 'panel' },
        el('table', { class: 'grid' },
          el('thead', {}, el('tr', {}, ...['Screen', 'Output', 'Size (mode)', 'Max layers', 'Working area', 'State'].map(h => el('th', { text: h })))),
          el('tbody', {}, ...rows))),
      areaEditor());
  }
  return { enter, render };
})();
const fmt = (v) => v == null ? '·' : String(v);
// alarm truthiness: null stays null, else nonzero = fault
const nz = (v) => v == null ? null : v !== 0;
// card temperature in 0.01 °C units (hundredths); 0 and 0xFFFF mean "no sensor"
// (verified on real NeXtage hardware: 3100 -> 31.0 °C)
const temp = (v) => (v == null || v === 0 || v === 65535) ? '·' : (v / 100).toFixed(1) + ' °C';

// ---------- Tally (live on-air indicators) ----------
VIEWS.tally = (() => {
  const N = () => store.byMnem.get('TAopr')?.dims[0] || 42;   // sources: inputs, stills, generators
  const hasTally = () => store.byMnem.has('TAopr');
  function enter() { if (hasTally()) { store.scan('TAopr'); store.scan('TAopw'); } store.scan('INava'); }
  function tile(i) {
    const pgm = store.val('TAopr', i) === 1;
    const pvw = store.val('TAopw', i) === 1;
    const cls = 'tally-tile' + (pgm ? ' pgm' : pvw ? ' pvw' : '');
    return el('div', { class: cls },
      el('span', { class: 'tally-src', text: 'IN ' + (i + 1) }),
      el('span', { class: 'tally-state', text: pgm ? 'PGM' : pvw ? 'PVW' : '' }));
  }
  function render() {
    if (!hasTally())
      return el('div', {},
        el('div', { class: 'view-head' }, el('h1', { text: 'Tally' })),
        el('div', { class: 'panel' }, el('div', { class: 'empty-state', text: 'This device does not report a tally bus.' })));
    const n = N();
    const onPgm = Array.from({ length: n }, (_, i) => store.val('TAopr', i)).filter(v => v === 1).length;
    const onPvw = Array.from({ length: n }, (_, i) => store.val('TAopw', i)).filter(v => v === 1).length;
    return el('div', {},
      el('div', { class: 'view-head' }, el('h1', { text: 'Tally' }),
        el('span', { class: 'hint', text: `${onPgm} on program · ${onPvw} on preview` })),
      el('div', { class: 'panel' },
        el('div', { class: 'tally-grid' }, ...Array.from({ length: n }, (_, i) => tile(i)))));
  }
  return { enter, render };
})();

// ---------- Inputs ----------
VIEWS.inputs = (() => {
  const N = () => inputCount();
  let sel = null;
  const hasProc = () => store.byMnem.has('IEbri');   // input processing (both platforms)
  const PROC = ['IEbri', 'IEcon', 'IEclr', 'IEhue', 'IEugr', 'IEugg', 'IEugb', 'IEchs', 'IEcvs', 'IEche', 'IEcve'];
  function enter() {
    for (const m of ['INava', 'INplg', 'INpav', 'INfrz', 'INffz', 'INbla', 'INpat']) if (store.byMnem.has(m)) store.scan(m);
    for (const m of ['ISspr', 'ISsva', 'IScfo', 'ISswi', 'ISshe']) if (store.byMnem.has(m)) store.scan(m);
    if (sel != null && hasProc()) { const p = store.val('INplg', sel) ?? 0; for (const m of PROC) store.get(m, [sel, p]); }
  }
  function row(i) {
    const avail = store.val('INava', i) === 1;
    const plug = store.val('INplg', i) ?? 0;
    const present = store.val('ISspr', i, plug);
    const valid = store.val('ISsva', i, plug);
    const w = store.val('ISswi', i, plug), h = store.val('ISshe', i, plug);
    const frozen = store.val('INfrz', i) === 1;
    const black = store.val('INbla', i) === 1;
    return el('tr', { class: (avail ? '' : 'dim') + (sel === i ? ' sel-row' : ''), style: hasProc() ? 'cursor:pointer' : '', onclick: hasProc() ? () => { sel = i; enter(); store.notify(); } : null },
      el('td', { text: 'IN ' + (i + 1) }),
      el('td', {}, boolChip(avail ? 1 : 0, 'ready', 'unused')),
      el('td', {}, plugSelect(i, plug)),
      el('td', {}, boolChip(valid === 1 ? 1 : present === 1 ? 0 : (present == null ? null : 0), 'valid', present === 1 ? 'unstable' : 'no signal')),
      el('td', { class: 'val', text: (w && h) ? `${w}×${h}` : '·' }),
      el('td', {},
        el('button', { class: 'btn ghost' + (frozen ? ' pgm' : ''), onclick: (e) => { e.stopPropagation(); store.set('INfrz', [i], frozen ? 0 : 1); } }, 'Freeze'),
        el('button', { class: 'btn ghost' + (black ? ' pgm' : ''), style: 'margin-left:6px', onclick: (e) => { e.stopPropagation(); store.set('INbla', [i], black ? 0 : 1); } }, 'Black')));
  }
  // Active-plug selector. Plugs without a connector fitted (INpav=0) are listed
  // but disabled; a fresh cache reads INpav as null, which counts as available.
  function plugSelect(i, plug) {
    const s = el('select', {
      onclick: (e) => e.stopPropagation(),
      onchange: (e) => { store.set('INplg', [i], +e.target.value); if (sel === i) enter(); },
    });
    for (let p = 0; p < plugCount(); p++) {
      const o = el('option', { value: p, text: plugName(p) });
      if (store.val('INpav', i, p) === 0) o.disabled = true;
      if (p === plug) o.selected = true;
      s.append(o);
    }
    return s;
  }
  function resetProc(i, p) {
    const d = { IEbri: 128, IEcon: 128, IEclr: 128, IEhue: 180, IEugr: 128, IEugg: 128, IEugb: 128, IEchs: 0, IEcvs: 0, IEche: 0, IEcve: 0 };
    for (const m in d) store.set(m, [i, p], d[m]);
    store.notify();
  }
  function settings() {
    const i = sel, p = store.val('INplg', i) ?? 0, idx = [i, p];
    return el('div', { class: 'panel' },
      el('div', { class: 'row' }, el('h2', `Input ${i + 1} · ${plugName(p)} adjustment`), el('div', { class: 'spacer' }),
        el('button', { class: 'btn ghost', onclick: () => resetProc(i, p) }, 'Reset')),
      el('div', { class: 'grid2' },
        bind('Brightness', 'IEbri', idx, 0, 255), bind('Contrast', 'IEcon', idx, 0, 255),
        bind('Colour', 'IEclr', idx, 0, 255), bind('Hue', 'IEhue', idx, 0, 360, 1, v => (v - 180) + '°')),
      el('div', { class: 'sub-head' }, 'RGB gain'),
      el('div', { class: 'grid2' },
        bind('Red', 'IEugr', idx, 0, 255), bind('Green', 'IEugg', idx, 0, 255), bind('Blue', 'IEugb', idx, 0, 255)),
      el('div', { class: 'sub-head' }, 'Crop'),
      el('div', { class: 'grid2' },
        bind('Left', 'IEchs', idx, 0, 4095, 8), bind('Top', 'IEcvs', idx, 0, 4095, 8),
        bind('Right', 'IEche', idx, 0, 4095, 8), bind('Bottom', 'IEcve', idx, 0, 4095, 8)));
  }
  function render() {
    const n = N();
    const ready = Array.from({ length: n }, (_, i) => store.val('INava', i)).filter(v => v === 1).length;
    const rows = Array.from({ length: n }, (_, i) => row(i));
    return el('div', {},
      el('div', { class: 'view-head' }, el('h1', { text: 'Inputs' }),
        el('span', { class: 'hint', text: `${ready} of ${n} ready${hasProc() ? ' · click a row to adjust it' : ''}` })),
      sel != null && hasProc() ? settings() : null,
      el('div', { class: 'panel', style: 'overflow:auto' },
        el('table', { class: 'grid' },
          el('thead', {}, el('tr', {}, ...['Input', 'State', 'Connector', 'Signal', 'Size', ''].map(h => el('th', { text: h })))),
          el('tbody', {}, ...rows))));
  }
  return { enter, render };
})();

// ---------- Outputs ----------
VIEWS.outputs = (() => {
  const N = () => outputCount();
  let sel = 0;
  function enter() {
    for (const m of ['OUava', 'OUena', 'OUuse', 'OUfst', 'OUfor', 'OUrat', 'OUbla', 'OUshs', 'OUsvs', 'OUhdc',
      'OCgam', 'OCbri', 'OCcon', 'OCgre', 'OCggr', 'OCgbl',
      'OSaoi', 'OSocp', 'OSash', 'OSasv', 'OSaph', 'OSapv',
      'OSsmh', 'OSsmv', 'OSSsh', 'OSSsv', 'OSSph', 'OSSpv', 'OSsro']) if (store.byMnem.has(m)) store.scan(m);
  }
  // set the output format (and, on Midra, fire the update trigger to apply it)
  function formatSelect() {
    const cur = store.val('OUfor', sel) ?? 0, max = store.byMnem.get('OUfor')?.max ?? 54;
    const s = el('select', { onchange: (e) => { store.set('OUfor', [sel], +e.target.value); if (store.byMnem.has('OUfru')) store.set('OUfru', [sel], 1); } });
    for (let i = 0; i <= max; i++) { const o = el('option', { value: i, text: i === 0 ? 'Auto' : 'Format ' + i }); if (i === cur) o.selected = true; s.append(o); }
    return s;
  }
  function row(i) {
    const avail = store.val('OUava', i) === 1;
    const ena = store.val('OUena', i) === 1;
    const used = store.val('OUuse', i) === 1;
    const w = store.val('OUshs', i), h = store.val('OUsvs', i);
    const black = store.val('OUbla', i) === 1;
    return el('tr', { class: (avail ? '' : 'dim') + (i === sel ? ' sel-row' : ''), onclick: () => { sel = i; store.notify(); } },
      el('td', { text: 'OUT ' + (i + 1) }),
      el('td', boolChip(avail ? 1 : 0, 'connected', 'no display')),
      el('td', boolChip(ena ? 1 : 0, 'live', 'off')),
      el('td', { class: 'val', text: `fmt ${store.val('OUfst', i) ?? '·'}` }),
      el('td', { class: 'val', text: (w && h) ? `${w}×${h}` : '·' }),
      el('td',
        el('button', { class: 'btn ghost' + (used ? ' pgm' : ''), onclick: (e) => { e.stopPropagation(); store.set('OUuse', [i], used ? 0 : 1); } }, 'Use'),
        el('button', { class: 'btn ghost' + (black ? ' pgm' : ''), style: 'margin-left:6px', onclick: (e) => { e.stopPropagation(); store.set('OUbla', [i], black ? 0 : 1); } }, 'Black')));
  }
  // ---- Area of interest (LiveCore) ----
  // A per-output crop: the output carries a window of its format rather than the
  // whole raster. Two things make it unlike the Midra video out's area of
  // interest, and the UI has to respect both:
  //   * position and size are plain pixels here — no +32768 bias;
  //   * the values are staged, and only take effect when OSaup is fired. So the
  //     panel edits freely and commits on Apply, rather than writing live.
  // OUT_AOI_STATUS is the device's own readback of what it actually settled on,
  // which is what the canvas draws — a staged edit that the device will clamp
  // should not be shown as though it already happened.
  const AOI_MODES = ['Format size', 'Custom'];
  function aoiSection(i) {
    if (!store.byMnem.has('OSash')) return null;          // Midra has no per-output AoI
    const idx = [i];
    const mode = store.val('OSaoi', i) ?? 0;
    const custom = mode === 1;
    const maxW = store.val('OSsmh', i) || 1920, maxH = store.val('OSsmv', i) || 1080;
    const liveW = store.val('OSSsh', i), liveH = store.val('OSSsv', i);
    const liveX = store.val('OSSph', i), liveY = store.val('OSSpv', i);
    const rot = store.val('OSsro', i);

    const modeSeg = el('div', { class: 'seg' }, ...AOI_MODES.map((label, m) =>
      el('button', {
        class: mode === m ? 'on recall' : '',
        onclick: () => { store.set('OSaoi', idx, m); store.set('OSaup', idx, 1); setTimeout(enter, 500); },
      }, label)));

    // A device that has never been given a custom area parks these at the
    // variable's own ceiling (100000), which is not a size anyone typed and
    // reads as nonsense in a pixel field. Show the format's size instead —
    // the same thing the output is actually carrying.
    const shown = (mnem, fallback) => {
      const v = store.val(mnem, i), ceil = store.byMnem.get(mnem)?.max ?? 100000;
      return (v == null || v === 0 || v >= ceil) ? fallback : v;
    };
    const num = (label, mnem, max, fallback) => el('label', { class: 'field' }, label,
      el('input', {
        type: 'number', class: 'lbl-in', style: 'width:88px', min: 0, max,
        value: shown(mnem, fallback), disabled: !custom,
        onchange: (e) => store.set(mnem, idx, Math.max(0, Math.min(max, Math.round(+e.target.value)))),
      }));

    // What the device says it is doing, drawn inside the format's full raster.
    const CW = 300, scale = CW / maxW;
    const cv = el('div', { class: 'screen-canvas vo-canvas', style: `width:${CW}px;height:${Math.round(maxH * scale)}px` });
    if (liveW && liveH) {
      cv.append(el('div', {
        class: 'vo-aoi' + (custom ? '' : ' unset'),
        style: `left:${(liveX || 0) * scale}px;top:${(liveY || 0) * scale}px;`
          + `width:${liveW * scale}px;height:${liveH * scale}px;cursor:default`,
      }, el('span', { class: 'vo-aoi-tag', text: `${liveW}×${liveH}` })));
    } else {
      cv.append(el('span', { class: 'se-mid', text: 'no area reported' }));
    }

    return el('div', {},
      el('div', { class: 'sub-head' }, 'Area of interest'),
      el('div', { class: 'row' },
        modeSeg,
        el('div', { class: 'spacer' }),
        el('span', { class: 'hint', text: `format ${maxW}×${maxH}${rot ? ` · rotation ${rot}` : ''}` })),
      el('div', { class: 'row', style: 'align-items:flex-start;gap:16px' },
        cv,
        el('div', { style: 'flex:1' },
          el('div', { class: 'grid2' },
            num('Width', 'OSash', maxW, maxW),
            num('Height', 'OSasv', maxH, maxH),
            num('Position X', 'OSaph', maxW, 0),
            num('Position Y', 'OSapv', maxH, 0)),
          store.byMnem.has('OSocp') ? bind('Overscan compensation', 'OSocp', idx, 0, 20, 1, v => v + '%') : null,
          el('div', { class: 'row' },
            el('button', { class: 'btn primary', disabled: !custom, onclick: () => { store.set('OSaup', idx, 1); setTimeout(enter, 500); } }, 'Apply'),
            el('button', {
              class: 'btn ghost', disabled: !custom,
              onclick: () => { store.set('OSash', idx, maxW); store.set('OSasv', idx, maxH); store.set('OSaph', idx, 0); store.set('OSapv', idx, 0); store.set('OSaup', idx, 1); setTimeout(enter, 500); },
            }, 'Whole format')),
          el('div', { class: 'hint pad', text: custom
            ? 'Edits are staged — Apply commits them, and the picture above is the device’s own readback, not what was typed.'
            : 'The output carries its whole format. Switch to Custom to crop a window out of it.' }),
          // Worth saying out loud rather than letting an operator discover it
          // mid-show: on the one frame this has been tried on, the staged values
          // were accepted and echoed but OUT_AOI_STATUS never moved off a
          // 200x200 floor, so the crop could not be confirmed as happening.
          custom && liveW === 200 && liveH === 200
            ? el('div', { class: 'hint pad bad', text: 'The device is reporting a 200×200 area regardless of what is staged — the crop has not been confirmed on this output. Check the picture on the output before trusting it.' })
            : null)));
  }
  function detail() {
    const i = [sel];
    return el('div', { class: 'editor' },
      el('div', { class: 'row' },
        el('label', { class: 'field' }, 'Format', formatSelect()),
        store.byMnem.has('OUrat') ? bind('Rate', 'OUrat', i, 0, store.byMnem.get('OUrat').max) : null,
        toggleBtn('HDCP', 'OUhdc', i),
        toggleBtn('Black', 'OUbla', i, 'pgm')),
      el('div', { class: 'sub-head' }, 'Output processing'),
      el('div', { class: 'grid2' },
        bind('Brightness', 'OCbri', i, 0, 255, 1),
        bind('Contrast', 'OCcon', i, 0, 255, 1),
        bind('Gamma', 'OCgam', i, 5, 40, 1, v => (v / 10).toFixed(1)),
        bind('Gain R', 'OCgre', i, 0, 255, 1),
        bind('Gain G', 'OCggr', i, 0, 255, 1),
        bind('Gain B', 'OCgbl', i, 0, 255, 1)),
      aoiSection(sel));
  }
  function render() {
    const rows = Array.from({ length: N() }, (_, i) => row(i));
    return el('div', {},
      el('div', { class: 'view-head' }, el('h1', { text: 'Outputs' }), el('span', { class: 'hint', text: 'Physical outputs, formats and processing' })),
      el('div', { class: 'split' },
        el('div', { class: 'panel', style: 'overflow:auto' },
          el('table', { class: 'grid' },
            el('thead', el('tr', ...['Output', 'Display', 'State', 'Format', 'Size', ''].map(h => el('th', { text: h })))),
            el('tbody', ...rows))),
        el('div', { class: 'panel' }, el('h2', `Output ${sel + 1}`), detail())));
  }
  return { enter, render };
})();

// ---------- Video Out (Midra) ----------
// A second, independently-scaled output that most Midra frames carry on an SDI
// plug. It is not one of the numbered outputs: it has its own format, its own
// image controls, and — the reason it is worth a view of its own — an area of
// interest, so it can carry a crop of a screen rather than the whole thing.
//
// Every enum below was recovered from the device's own string table and then
// confirmed against a Pulse2. See docs/PROTOCOL.md.

// CTvom VIDEO_OUT_CFGMODE. The order is not a guess: the device advertises one
// capability flag per value, in this order, and a frame that cannot offer a
// mode reports 0 for its flag.
const VIDEO_OUT_MODES = [
  ['Recording', 'DFmvo', 'An independent feed with its own format and area of interest'],
  ['Mirror output 1', 'DFmoa', 'Carries whatever output 1 is showing'],
  ['Mirror output 2', 'DFmob', 'Carries whatever output 2 is showing'],
];

// VOmod VIDOUT_MODE — what the recording feed is a view of. Always a screen;
// there is no way to point it at an input, and the device refuses 4.
const VIDEO_OUT_SOURCES = ['Screen 1', 'Screen 2', 'Screen H-tiled', 'Screen V-tiled'];

// VOfor VIDOUT_FORMAT 0..13 — the composite/SD half of the frame's format
// table, which is exactly the range this variable allows.
const VIDEO_OUT_FORMATS = ['Auto', 'PAL', 'PAL 4/3', 'PAL 16/9', 'NTSC', 'NTSC 4/3',
  'NTSC 16/9', 'PAL-M', 'PAL-N combi', 'NTSC 4.43', 'PAL 60', 'SECAM', '480i', '576i'];

// OUpat / VOpat 0..9.
const TEST_PATTERNS = ['Off', 'V grey scale', 'H grey scale', 'V colour bar', 'H colour bar',
  'Grid', 'SMPTE', 'V burst', 'Centring', 'Soft-edge centring'];

VIEWS.videoout = (() => {
  const B = POS_BIAS;
  const CW = 460;                       // canvas width for the area-of-interest editor
  let drag = null;

  const cfgMode = () => store.val('CTvom') ?? 0;
  const recording = () => cfgMode() === 0;
  const modeOffered = (flag) => store.val(flag) !== 0;   // null (unread) reads as offered

  function enter() {
    for (const m of ['VOmod', 'VOpoh', 'VOpov', 'VOsih', 'VOsiv', 'VOfor', 'VOrat', 'VOpat', 'VOpct',
      'VObcr', 'VObcg', 'VObcb', 'VOfli', 'VOgam', 'VOsha', 'VOovc',
      'VOfvs', 'VOfst', 'VOrst', 'VOkin', 'VOshs', 'VOsvs', 'VOpls',
      'CTvom', 'DFvdo', 'DFvso', 'DFmvo', 'DFmoa', 'DFmob',
      'SCssh', 'SCssv']) if (store.byMnem.has(m)) store.scan(m);
  }

  // The screen the feed is a view of, and therefore the space the area of
  // interest is expressed in. The tiled modes span both screens.
  function sourceSize() {
    const w0 = store.val('SCssh', 0) || 1920, h0 = store.val('SCssv', 0) || 1080;
    const w1 = store.val('SCssh', 1) || 0, h1 = store.val('SCssv', 1) || 0;
    switch (store.val('VOmod') ?? 0) {
      case 1: return { w: w1 || w0, h: h1 || h0 };
      case 2: return { w: w0 + (w1 || w0), h: Math.max(h0, h1 || h0) };
      case 3: return { w: Math.max(w0, w1 || w0), h: h0 + (h1 || h0) };
      default: return { w: w0, h: h0 };
    }
  }

  // The stored rectangle, in source-screen pixels. A freshly reset device parks
  // every one of these at the bias value, which is not a usable rectangle — so
  // an unset size falls back to the whole screen rather than drawing nothing.
  function aoi() {
    const src = sourceSize();
    const rawW = store.val('VOsih'), rawH = store.val('VOsiv');
    const unset = (v) => v == null || v === B;
    const w = unset(rawW) ? src.w : rawW, h = unset(rawH) ? src.h : rawH;
    const cx = (store.val('VOpoh') ?? B) - B, cy = (store.val('VOpov') ?? B) - B;
    return { w, h, cx, cy, src, unset: unset(rawW) && unset(rawH) };
  }

  const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));
  function writeAoi(next) {
    const src = sourceSize();
    const w = clamp(Math.round(next.w), 16, src.w), h = clamp(Math.round(next.h), 16, src.h);
    const cx = clamp(Math.round(next.cx), -src.w, src.w), cy = clamp(Math.round(next.cy), -src.h, src.h);
    store.set('VOsih', [], w); store.set('VOsiv', [], h);
    store.set('VOpoh', [], B + cx); store.set('VOpov', [], B + cy);
  }

  // Drag the rectangle to move it, drag its corner handle to resize. The centre
  // is what the device stores, so a move writes position and a resize writes
  // size — never both, or a resize would walk the rectangle across the screen.
  function canvas() {
    const a = aoi();
    const scale = CW / a.src.w;
    const cv = el('div', { class: 'screen-canvas vo-canvas', style: `width:${CW}px;height:${Math.round(a.src.h * scale)}px` });
    const left = (a.cx - a.w / 2) * scale + CW / 2;
    const top = (a.cy - a.h / 2) * scale + (a.src.h * scale) / 2;
    const rect = el('div', {
      class: 'vo-aoi' + (a.unset ? ' unset' : ''),
      style: `left:${left}px;top:${top}px;width:${a.w * scale}px;height:${a.h * scale}px`,
      onpointerdown: (e) => {
        if (e.target.classList.contains('vo-handle')) return;
        e.preventDefault(); e.target.setPointerCapture?.(e.pointerId);
        drag = { kind: 'move', x: e.clientX, y: e.clientY, cx: a.cx, cy: a.cy, w: a.w, h: a.h, scale };
      },
    }, el('span', { class: 'vo-aoi-tag', text: `${a.w}×${a.h}` }),
      el('div', {
        class: 'vo-handle',
        onpointerdown: (e) => {
          e.preventDefault(); e.stopPropagation(); e.target.setPointerCapture?.(e.pointerId);
          drag = { kind: 'size', x: e.clientX, y: e.clientY, cx: a.cx, cy: a.cy, w: a.w, h: a.h, scale };
        },
      }));
    const onMove = (e) => {
      if (!drag) return;
      const dx = (e.clientX - drag.x) / drag.scale, dy = (e.clientY - drag.y) / drag.scale;
      if (drag.kind === 'move') writeAoi({ w: drag.w, h: drag.h, cx: drag.cx + dx, cy: drag.cy + dy });
      else writeAoi({ w: drag.w + dx * 2, h: drag.h + dy * 2, cx: drag.cx, cy: drag.cy });
      store.notify();
    };
    cv.addEventListener('pointermove', onMove);
    cv.addEventListener('pointerup', () => { drag = null; });
    cv.addEventListener('pointerleave', () => { drag = null; });
    cv.append(rect);
    return cv;
  }

  function num(label, mnem, get, set, min, max) {
    return el('label', { class: 'field' }, label,
      el('input', {
        type: 'number', class: 'lbl-in', style: 'width:90px', min, max, value: get(),
        onchange: (e) => { set(clamp(Math.round(+e.target.value), min, max)); store.notify(); },
      }));
  }

  function aoiPanel() {
    const a = aoi();
    return el('div', { class: 'panel' },
      el('div', { class: 'row' },
        el('h2', 'Area of interest'),
        el('div', { class: 'spacer' }),
        el('span', { class: 'hint', text: `within ${a.src.w}×${a.src.h} · ${VIDEO_OUT_SOURCES[store.val('VOmod') ?? 0]}` }),
        el('button', { class: 'btn ghost', onclick: () => { writeAoi({ w: a.src.w, h: a.src.h, cx: 0, cy: 0 }); store.notify(); } }, 'Whole screen')),
      !recording() ? el('div', { class: 'hint pad', text: 'The area of interest only applies in Recording mode — a mirrored output carries its source untouched.' }) : null,
      el('div', { class: 'row', style: 'align-items:flex-start;gap:16px' },
        canvas(),
        el('div', { class: 'grid2', style: 'flex:1' },
          num('Width', 'VOsih', () => a.w, (v) => store.set('VOsih', [], v), 16, a.src.w),
          num('Height', 'VOsiv', () => a.h, (v) => store.set('VOsiv', [], v), 16, a.src.h),
          num('Centre X', 'VOpoh', () => a.cx, (v) => store.set('VOpoh', [], B + v), -a.src.w, a.src.w),
          num('Centre Y', 'VOpov', () => a.cy, (v) => store.set('VOpov', [], B + v), -a.src.h, a.src.h))),
      a.unset ? el('div', { class: 'hint pad', text: 'No area stored yet — the whole screen is shown. Drag the rectangle or type a size to set one.' }) : null);
  }

  function modePanel() {
    const cur = cfgMode();
    const sdiOnly = store.val('DFvso') === 1;
    const plugs = [0, 1, 2].map(i => store.val('VOpls', i));
    const activePlug = plugs.findIndex(v => v === 1);
    return el('div', { class: 'panel' },
      el('div', { class: 'row' },
        el('h2', 'Mode'),
        el('div', { class: 'spacer' }),
        el('span', { class: 'hint', text: sdiOnly ? 'this frame carries the video out on its SDI plug only' : 'video out plugs' }),
        boolChip(activePlug >= 0 ? 1 : 0, `plug ${activePlug + 1} active`, 'no plug active')),
      el('div', { class: 'row' }, ...VIDEO_OUT_MODES.map(([label, flag, hint], i) => {
        const offered = modeOffered(flag);
        return el('button', {
          class: 'btn ' + (cur === i ? 'primary' : 'ghost') + (offered ? '' : ' dim'),
          disabled: !offered, title: offered ? hint : 'not offered by this frame',
          onclick: () => { store.set('CTvom', [], i); setTimeout(enter, 800); },
        }, label);
      })),
      el('div', { class: 'hint pad', text: VIDEO_OUT_MODES[cur]?.[2] || '' }),
      el('div', { class: 'hint pad', text: 'Changing the mode reconfigures the plug — the output re-syncs and its format changes with it.' }));
  }

  function formatPanel() {
    const cur = store.val('VOfor') ?? 0;
    const sel = el('select', {
      onchange: (e) => { store.set('VOfor', [], +e.target.value); if (store.byMnem.has('VOfru')) store.set('VOfru', [], 1); setTimeout(enter, 700); },
    });
    VIDEO_OUT_FORMATS.forEach((name, i) => {
      const o = el('option', { value: i, text: name });
      if (i === cur) o.selected = true;
      sel.append(o);
    });
    const rate = store.val('VOrst'), w = store.val('VOshs'), h = store.val('VOsvs');
    return el('div', { class: 'panel' },
      el('div', { class: 'row' },
        el('h2', 'Format'),
        el('div', { class: 'spacer' }),
        boolChip(store.val('VOfvs'), 'valid', 'invalid'),
        el('span', { class: 'hint', text: `${(w && h) ? `${w}×${h}` : '·'}${rate ? ` @ ${(rate / 1000).toFixed(2)} Hz` : ''}` })),
      el('div', { class: 'row' },
        el('label', { class: 'field' }, 'Format', sel),
        store.byMnem.has('VOrat') ? bind('Rate', 'VOrat', [], 0, store.byMnem.get('VOrat').max) : null,
        store.byMnem.has('VOovc') ? toggleBtn('Overscan', 'VOovc', [], 'pgm') : null),
      el('div', { class: 'hint pad', text: 'Overscan compensation shrinks the picture slightly so a display that overscans still shows the edges.' }));
  }

  function imagePanel() {
    const pat = store.val('VOpat') ?? 0;
    const sel = el('select', { onchange: (e) => store.set('VOpat', [], +e.target.value) });
    TEST_PATTERNS.forEach((name, i) => {
      const o = el('option', { value: i, text: name });
      if (i === pat) o.selected = true;
      sel.append(o);
    });
    const sw = (m) => store.val(m) ?? 0;
    return el('div', { class: 'panel' },
      el('h2', 'Image'),
      el('div', { class: 'row' },
        el('label', { class: 'field' }, 'Test pattern', sel),
        store.byMnem.has('VOpct') ? toggleBtn('Centred', 'VOpct', [], 'pgm') : null,
        el('label', { class: 'field' }, 'Background',
          el('span', { class: 'swatch-dot', style: `background:rgb(${sw('VObcr')},${sw('VObcg')},${sw('VObcb')})` }))),
      el('div', { class: 'grid2' },
        bind('Background R', 'VObcr', [], 0, 255, 1),
        bind('Background G', 'VObcg', [], 0, 255, 1),
        bind('Background B', 'VObcb', [], 0, 255, 1),
        store.byMnem.has('VOgam') ? bind('Gamma', 'VOgam', [], 5, 40, 1, v => (v / 10).toFixed(1)) : null,
        store.byMnem.has('VOsha') ? bind('Sharpness', 'VOsha', [], 0, 255, 1) : null,
        store.byMnem.has('VOfli') ? bind('Flicker filter', 'VOfli', [], 0, 7, 1) : null));
  }

  function render() {
    if (store.val('DFvdo') === 0) {
      return el('div', {},
        el('div', { class: 'view-head' }, el('h1', { text: 'Video out' })),
        el('div', { class: 'panel' }, el('div', { class: 'empty-state', text: 'This frame has no video output.' })));
    }
    const srcSel = el('select', { onchange: (e) => { store.set('VOmod', [], +e.target.value); setTimeout(enter, 500); } });
    VIDEO_OUT_SOURCES.forEach((name, i) => {
      const o = el('option', { value: i, text: name });
      if (i === (store.val('VOmod') ?? 0)) o.selected = true;
      srcSel.append(o);
    });
    return el('div', {},
      el('div', { class: 'view-head' },
        el('h1', { text: 'Video out' }),
        el('span', { class: 'hint', text: 'The frame’s second output — its own format, and a crop of a screen rather than the whole one' })),
      modePanel(),
      recording() ? el('div', { class: 'panel' },
        el('div', { class: 'row' },
          el('h2', 'Source'), srcSel,
          el('div', { class: 'spacer' }),
          el('span', { class: 'hint', text: 'always a screen — the video out cannot be pointed at an input' }))) : null,
      recording() ? aoiPanel() : null,
      formatPanel(),
      imagePanel());
  }
  return { enter, render };
})();

// ---------- Stills ----------
VIEWS.stills = (() => {
  const N = 101;
  let sel = null;

  // Midra frame store: 8 frames (PSfrv + size). The logo vars (PSlov…) are in the
  // table but some models' firmware rejects them (E10), so probe once and only
  // show logos where supported.
  const mid = (() => {
    let logos = null;   // null = unprobed, true/false = supported
    function enter() {
      for (const m of ['PSfrv', 'PSfsh', 'PSfsv', 'PSsta', 'PSprg']) store.scan(m);
      if (logos === null) {   // one-shot capability probe
        const mark = store.log.length;
        store.get('PSlov', [0]);
        setTimeout(() => {
          const failed = store.log.slice(mark).some(e => e.dir === 'er');
          logos = !failed;
          if (logos) for (const m of ['PSlov', 'PSlsh', 'PSlsv']) store.scan(m);
          store.notify();
        }, 400);
      }
    }
    function cell(kind, i, validM, hM, vM) {
      const valid = store.val(validM, i) === 1;
      const w = store.val(hM, i), h = store.val(vM, i);
      return el('div', { class: 'still-cell' + (valid ? ' valid' : '') },
        el('span', { class: 'num', text: kind + ' ' + (i + 1) }),
        el('span', { class: 'still-meta', text: valid ? `${w ?? '·'}×${h ?? '·'}` : 'empty' }));
    }
    function render() {
      const frames = Array.from({ length: 8 }, (_, i) => store.val('PSfrv', i)).filter(v => v === 1).length;
      const logoCount = logos ? Array.from({ length: 16 }, (_, i) => store.val('PSlov', i)).filter(v => v === 1).length : 0;
      const status = store.val('PSsta'), prog = store.val('PSprg');
      return el('div', {},
        el('div', { class: 'view-head' }, el('h1', { text: 'Stills' }),
          el('span', { class: 'hint', text: `${frames} frames${logos ? ` · ${logoCount} logos` : ''}${status ? ` · capture ${prog ?? 0}%` : ''}` })),
        el('div', { class: 'panel' }, el('h2', 'Frames'),
          el('div', { class: 'still-grid' }, ...Array.from({ length: 8 }, (_, i) => cell('Frame', i, 'PSfrv', 'PSfsh', 'PSfsv')))),
        logos ? el('div', { class: 'panel' }, el('h2', 'Logos'),
          el('div', { class: 'still-grid' }, ...Array.from({ length: 16 }, (_, i) => cell('Logo', i, 'PSlov', 'PSlsh', 'PSlsv')))) : null);
    }
    return { enter, render };
  })();

  function enter() {
    if (store.meta?.platform === 'midra') return mid.enter();
    for (const m of ['Slval', 'SLusd', 'SLiwd', 'SLihe']) store.scan(m);
  }
  function render() {
    if (store.meta?.platform === 'midra') return mid.render();
    const used = Array.from({ length: N }, (_, i) => store.val('Slval', i)).filter(v => (v || 0) > 0).length;
    const g = el('div', { class: 'mem-grid' });
    for (let i = 0; i < N; i++) {
      const valid = (store.val('Slval', i) || 0) > 0;
      g.append(el('button', { class: 'slot' + (valid ? ' valid' : '') + (sel === i ? ' sel' : ''), onclick: () => { sel = i; store.notify(); } },
        el('span', { class: 'num', text: i + 1 }),
        valid ? el('span', { class: 'lbl', text: 'still' }) : null));
    }
    const detail = sel != null ? el('div', { class: 'row' },
      el('span', { class: 'hint', text: `Still ${sel + 1}: ${store.val('SLiwd', sel) ?? '·'}×${store.val('SLihe', sel) ?? '·'}` }),
      el('div', { class: 'spacer' }),
      (store.val('Slval', sel) || 0) > 0 ? el('button', { class: 'btn', onclick: () => { store.set('SLera', [sel], 1); store.scan('Slval'); } }, 'Erase') : null) : null;
    return el('div', {},
      el('div', { class: 'view-head' }, el('h1', { text: 'Stills' }), el('span', { class: 'hint', text: `${used} of ${N} slots used` })),
      detail ? el('div', { class: 'panel' }, detail) : null,
      el('div', { class: 'panel' }, g));
  }
  return { enter, render };
})();

// ---------- Still capture (grab a frame from a live source) ----------
VIEWS.capture = (() => {
  const NSLOT = 8;
  // presets operate on the source's total frame (fw × fh)
  const PRESETS = [
    ['Full frame', (w, h) => [0, 0, w, h]],
    ['Left half', (w, h) => [0, 0, (w / 2) | 0, h]],
    ['Right half', (w, h) => [(w / 2) | 0, 0, (w / 2) | 0, h]],
    ['Top half', (w, h) => [0, 0, w, (h / 2) | 0]],
    ['Bottom half', (w, h) => [0, (h / 2) | 0, w, (h / 2) | 0]],
    ['Centre ½', (w, h) => [(w / 4) | 0, (h / 4) | 0, (w / 2) | 0, (h / 2) | 0]],
  ];
  const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));
  function enter() {
    for (const m of ['STcso', 'STcen', 'STcfe', 'STcpx', 'STcpy', 'STcwi', 'STche', 'STcdo', 'STctw', 'STcth'])
      store.get(m, []);
    for (const m of ['STsss', 'STsdo', 'STswi', 'STshe']) store.scan(m);
    store.scan('INava');
  }
  // the source frame we're cropping out of; sim reports 0 with no signal, so fall back to 1080p
  function frame() {
    const w = store.val('STctw') || 0, h = store.val('STcth') || 0;
    return w > 0 && h > 0 ? [w, h] : [1920, 1080];
  }
  function setRegion(x, y, w, h) {
    const [fw, fh] = frame();
    w = clamp(w | 0, 16, fw); h = clamp(h | 0, 16, fh);
    x = clamp(x | 0, 0, fw - w); y = clamp(y | 0, 0, fh - h);
    store.set('STcwi', [], w); store.set('STche', [], h);
    store.set('STcpx', [], x); store.set('STcpy', [], y);
    store.notify();
  }
  // click the preview to recentre the region on that point (size kept)
  function onCanvasClick(e) {
    const [fw, fh] = frame();
    const r = e.currentTarget.getBoundingClientRect();
    const cx = ((e.clientX - r.left) / r.width) * fw;
    const cy = ((e.clientY - r.top) / r.height) * fh;
    const w = store.val('STcwi') || (fw / 2) | 0, h = store.val('STche') || (fh / 2) | 0;
    setRegion(cx - w / 2, cy - h / 2, w, h);
  }
  function preview(region) {
    const [fw, fh] = frame();
    const x = store.val('STcpx') || 0, y = store.val('STcpy') || 0;
    const w = store.val('STcwi') || fw, h = store.val('STche') || fh;
    const box = el('div', { class: 'cap-frame', style: `aspect-ratio:${fw}/${fh}`, onclick: region ? onCanvasClick : null });
    if (region) box.append(el('div', {
      class: 'cap-region',
      style: `left:${(x / fw) * 100}%;top:${(y / fh) * 100}%;width:${(w / fw) * 100}%;height:${(h / fh) * 100}%`,
    }, el('span', { class: 'cap-dim', text: `${w}×${h}` })));
    else box.append(el('div', { class: 'cap-region full' }, el('span', { class: 'cap-dim', text: `${fw}×${fh}` })));
    return box;
  }
  function slotRow(i) {
    const st = store.val('STsss', i);
    const done = store.val('STsdo', i) === 1;
    const w = store.val('STswi', i), h = store.val('STshe', i);
    return el('tr', { class: st ? '' : 'dim' },
      el('td', { text: 'Slot ' + (i + 1) }),
      el('td', boolChip(st ? 1 : 0, 'active', 'idle')),
      el('td', { class: 'val', text: (w || h) ? `${w ?? '·'}×${h ?? '·'}` : '—' }),
      el('td', boolChip(done ? 1 : 0, 'done', '—')));
  }
  function render() {
    const region = store.val('STcfe') === 1;
    const done = store.val('STcdo') === 1;
    const busy = store.val('STcen') === 1;
    const srcMax = store.byMnem.get('STcso')?.max ?? 31;
    return el('div', {},
      el('div', { class: 'view-head' }, el('h1', { text: 'Still capture' }),
        el('span', { class: 'hint', text: 'Grab a frame from a live source into the still library' })),
      el('div', { class: 'split' },
        el('div', { class: 'panel' }, el('h2', 'Source & region'),
          el('div', { class: 'row' },
            el('label', { class: 'field' }, 'Source', sourceSelect('STcso', [], srcMax)),
            el('label', { class: 'field' }, 'Area',
              el('div', { class: 'seg' },
                el('button', { class: !region ? 'on take' : '', onclick: () => { store.set('STcfe', [], 0); store.notify(); } }, 'Full frame'),
                el('button', { class: region ? 'on recall' : '', onclick: () => { store.set('STcfe', [], 1); store.notify(); } }, 'Region')))),
          region ? el('div', { class: 'row cap-presets' },
            ...PRESETS.map(([label, fn]) => el('button', { class: 'btn ghost', onclick: () => setRegion(...fn(...frame())) }, label))) : null,
          region ? el('div', { class: 'row' },
            bind('X', 'STcpx', [], 0, frame()[0]), bind('Y', 'STcpy', [], 0, frame()[1])) : null,
          region ? el('div', { class: 'row' },
            bind('Width', 'STcwi', [], 16, frame()[0]), bind('Height', 'STche', [], 16, frame()[1])) : null,
          el('div', { class: 'row' },
            el('button', { class: 'btn big ' + (busy ? 'ghost' : 'take'), disabled: busy || false, onclick: () => { store.set('STcen', [], 1); store.get('STcdo'); store.notify(); } }, busy ? 'Capturing…' : 'Capture'),
            el('div', { class: 'spacer' }),
            el('span', { class: 'hint', text: 'Result' }), boolChip(done ? 1 : 0, 'captured', 'idle'))),
        el('div', { class: 'panel' }, el('h2', region ? 'Region' : 'Frame'),
          preview(region),
          el('div', { class: 'hint', style: 'margin-top:8px', text: region ? 'Click the frame to recentre the region' : 'Whole source frame will be captured' }))),
      el('div', { class: 'panel', style: 'overflow:auto' }, el('h2', 'Capture slots'),
        el('table', { class: 'grid' },
          el('thead', el('tr', ...['Slot', 'Status', 'Size', 'Done'].map(h => el('th', { text: h })))),
          el('tbody', ...Array.from({ length: NSLOT }, (_, i) => slotRow(i))))));
  }
  return { enter, render };
})();

// ---------- Multiviewer designer (monitoring output layout) ----------
VIEWS.multiview = (() => {
  const NW = 12;                      // custom widgets per monitoring output
  let out = 0;                        // monitoring output 0/1
  let sel = 0;                        // selected widget
  // NB widget geometry assumed top-left origin in output px (MLcph/MLcpv/MLcsh/MLcsv);
  // unlike the main layers, no +bias was observed — confirm on hardware.
  function enter() {
    for (const m of ['MLfen', 'MLfes', 'MLfso', 'MLupd', 'MOshs', 'MOsvs', 'MOava']) store.get(m, [out]);
    for (let w = 0; w < NW; w++)
      for (const m of ['MLcen', 'MLces', 'MLcso', 'MLcph', 'MLcpv', 'MLcsh', 'MLcsv']) store.get(m, [out, w]);
    for (let mem = 0; mem < 8; mem++) { store.get('MMouw', [mem]); store.get('MMouh', [mem]); }
  }
  const outSize = () => [store.val('MOshs', out) || 1920, store.val('MOsvs', out) || 1080];
  const monName = n => n == null ? '·' : n === 0 ? '—' : 'Src ' + n;
  function monSource(mnem, idx) {
    const cur = store.val(mnem, ...idx) ?? 0;
    const s = el('select', { onchange: (e) => { store.set(mnem, idx, +e.target.value); } });
    for (let i = 0; i <= 55; i++) { const o = el('option', { value: i, text: monName(i) }); if (i === cur) o.selected = true; s.append(o); }
    return s;
  }
  function rectPx(w) {
    return { left: store.val('MLcph', out, w) ?? 0, top: store.val('MLcpv', out, w) ?? 0,
      w: store.val('MLcsh', out, w) ?? 0, h: store.val('MLcsv', out, w) ?? 0 };
  }
  const setGeom = (w, r) => {
    throttledSet('MLcph', [out, w], Math.round(r.left)); throttledSet('MLcpv', [out, w], Math.round(r.top));
    throttledSet('MLcsh', [out, w], Math.round(r.w)); throttledSet('MLcsv', [out, w], Math.round(r.h));
  };
  const setGeomNow = (w, r) => {
    store.set('MLcph', [out, w], Math.round(r.left)); store.set('MLcpv', [out, w], Math.round(r.top));
    store.set('MLcsh', [out, w], Math.round(r.w)); store.set('MLcsv', [out, w], Math.round(r.h));
  };
  function canvas() {
    const [W, H] = outSize();
    const CW = 720, scale = CW / W, CH = H * scale;
    const cv = el('div', { class: 'screen-canvas', style: `width:${CW}px;height:${Math.round(CH)}px` });
    for (let w = 0; w < NW; w++) {
      const on = store.val('MLcen', out, w) === 1;
      if (!on && w !== sel) continue;
      const r = rectPx(w), src = store.val('MLces', out, w);
      const box = el('div', {
        class: 'lrect' + (w === sel ? ' sel' : '') + (on ? '' : ' off'),
        style: `left:${r.left * scale}px;top:${r.top * scale}px;width:${r.w * scale}px;height:${r.h * scale}px;z-index:${w + 1}`,
        onpointerdown: (e) => dragMove(e, w, scale),
      },
        el('span', { class: 'lrect-tag', text: `${w + 1}${src ? ' · ' + monName(src) : ''}` }),
        ...['nw', 'ne', 'sw', 'se'].map(c => el('div', { class: 'handle ' + c, onpointerdown: (e) => dragResize(e, w, scale, c) })));
      cv.append(box);
    }
    return el('div', { class: 'canvas-wrap' }, cv);
  }
  function dragMove(e, w, scale) {
    e.preventDefault(); e.stopPropagation(); beginDrag(); sel = w;
    const box = e.currentTarget, sx = e.clientX, sy = e.clientY, r0 = rectPx(w);
    const move = (ev) => {
      const r = { ...r0, left: r0.left + (ev.clientX - sx) / scale, top: r0.top + (ev.clientY - sy) / scale };
      box.style.left = r.left * scale + 'px'; box.style.top = r.top * scale + 'px'; setGeom(w, r);
    };
    const up = () => { document.removeEventListener('pointermove', move); document.removeEventListener('pointerup', up); endDrag(); };
    document.addEventListener('pointermove', move); document.addEventListener('pointerup', up);
  }
  function dragResize(e, w, scale, corner) {
    e.preventDefault(); e.stopPropagation(); beginDrag(); sel = w;
    const box = e.currentTarget.parentNode, sx = e.clientX, sy = e.clientY, r0 = rectPx(w);
    const west = corner.includes('w'), north = corner.includes('n');
    const move = (ev) => {
      const dx = (ev.clientX - sx) / scale, dy = (ev.clientY - sy) / scale;
      let left = r0.left, right = r0.left + r0.w, top = r0.top, bot = r0.top + r0.h;
      if (west) left = Math.min(right - 16, r0.left + dx); else right = Math.max(left + 16, right + dx);
      if (north) top = Math.min(bot - 16, r0.top + dy); else bot = Math.max(top + 16, bot + dy);
      const r = { left, top, w: right - left, h: bot - top };
      box.style.left = r.left * scale + 'px'; box.style.top = r.top * scale + 'px';
      box.style.width = r.w * scale + 'px'; box.style.height = r.h * scale + 'px'; setGeom(w, r);
    };
    const up = () => { document.removeEventListener('pointermove', move); document.removeEventListener('pointerup', up); endDrag(); };
    document.addEventListener('pointermove', move); document.addEventListener('pointerup', up);
  }
  // lay N=cols*rows widgets over the output, assigning Src 1..N to empty ones
  function layout(cols, rows) {
    const [W, H] = outSize(), cw = Math.floor(W / cols), ch = Math.floor(H / rows), n = cols * rows;
    for (let w = 0; w < NW; w++) {
      if (w < n) {
        store.set('MLcen', [out, w], 1);
        if (!(store.val('MLces', out, w) > 0)) store.set('MLces', [out, w], w + 1);
        setGeomNow(w, { left: (w % cols) * cw, top: Math.floor(w / cols) * ch, w: cw, h: ch });
      } else store.set('MLcen', [out, w], 0);
    }
    sel = 0; store.notify();
  }
  function widgetEditor() {
    const i = [out, sel], on = store.val('MLcen', ...i) === 1, [W, H] = outSize();
    return el('div', { class: 'editor' },
      el('div', { class: 'row' },
        el('span', { class: 'hint', text: `Widget ${sel + 1}` }), el('div', { class: 'spacer' }),
        el('button', { class: 'btn ' + (on ? 'pgm' : 'ghost'), onclick: () => store.set('MLcen', i, on ? 0 : 1) }, on ? 'Enabled' : 'Disabled')),
      el('div', { class: 'row' },
        el('label', { class: 'field' }, 'Source', monSource('MLces', i)),
        el('label', { class: 'field' }, 'OSD label', checkbox(store.val('MLcso', ...i) === 1, v => store.set('MLcso', i, v ? 1 : 0)))),
      el('div', { class: 'grid2' },
        bind('X', 'MLcph', i, 0, W, 8), bind('Y', 'MLcpv', i, 0, H, 8),
        bind('Width', 'MLcsh', i, 16, W, 8), bind('Height', 'MLcsv', i, 16, H, 8)));
  }
  function list() {
    const wrap = el('div', { class: 'layers' });
    for (let w = 0; w < NW; w++) {
      const on = store.val('MLcen', out, w) === 1, src = store.val('MLces', out, w);
      wrap.append(el('div', { class: 'layer' + (on ? ' on' : '') + (w === sel ? ' sel' : ''), onclick: () => { sel = w; store.notify(); } },
        el('span', { class: 'tag', text: '' + (w + 1) }),
        el('span', { class: 'src', text: monName(src) }),
        el('button', { class: 'btn ghost', onclick: (e) => { e.stopPropagation(); store.set('MLcen', [out, w], on ? 0 : 1); } }, on ? 'On' : 'Off')));
    }
    return wrap;
  }
  function memories() {
    const g = el('div', { class: 'mon-mem' });
    for (let mem = 0; mem < 8; mem++) {
      const wpx = store.val('MMouw', mem) || 0;
      g.append(el('div', { class: 'mon-mem-cell' + (wpx ? ' saved' : '') },
        el('span', { class: 'mm-n', text: 'M' + (mem + 1) }),
        el('div', { class: 'mm-btns' },
          el('button', { class: 'btn ghost', onclick: () => { store.set('MMsav', [out, mem], 1); store.get('MMouw', [mem]); } }, 'Save'),
          el('button', { class: 'btn ghost', onclick: () => { store.set('MMloa', [mem, out], 1); enter(); store.notify(); } }, 'Load'))));
    }
    return g;
  }
  function render() {
    const avail = store.val('MOava', out) === 1;
    const full = store.val('MLfen', out) === 1;
    const [W, H] = outSize();
    return el('div', {},
      el('div', { class: 'view-head' }, el('h1', { text: 'Multiviewer' }),
        el('span', { class: 'hint', text: `Monitor ${out + 1} · ${W}×${H}${avail ? '' : ' · output not present'}` })),
      el('div', { class: 'panel' },
        el('div', { class: 'row' },
          el('label', { class: 'field' }, 'Output',
            el('div', { class: 'seg' },
              el('button', { class: out === 0 ? 'on take' : '', onclick: () => { out = 0; sel = 0; enter(); store.notify(); } }, 'Monitor 1'),
              el('button', { class: out === 1 ? 'on take' : '', onclick: () => { out = 1; sel = 0; enter(); store.notify(); } }, 'Monitor 2'))),
          el('label', { class: 'field' }, 'Mode',
            el('div', { class: 'seg' },
              el('button', { class: !full ? 'on recall' : '', onclick: () => { store.set('MLfen', [out], 0); store.notify(); } }, 'Custom'),
              el('button', { class: full ? 'on take' : '', onclick: () => { store.set('MLfen', [out], 1); store.notify(); } }, 'Fullscreen'))),
          el('div', { class: 'spacer' }),
          el('button', { class: 'btn ghost', onclick: () => { store.set('MLres', [out], 1); enter(); store.notify(); } }, 'Reset'),
          el('button', { class: 'btn take', onclick: () => { store.set('MLupd', [out], 1); } }, 'Apply to output'))),
      full
        ? el('div', { class: 'panel' }, el('h2', 'Fullscreen source'),
          el('div', { class: 'row' },
            el('label', { class: 'field' }, 'Source', monSource('MLfes', [out])),
            el('label', { class: 'field' }, 'OSD label', checkbox(store.val('MLfso', out) === 1, v => store.set('MLfso', [out], v ? 1 : 0)))))
        : el('div', { class: 'split-wide' },
          el('div', { class: 'panel' },
            el('div', { class: 'row' },
              el('span', { class: 'hint', text: 'Layouts:' }),
              el('button', { class: 'btn ghost', onclick: () => layout(2, 2) }, 'Quad'),
              el('button', { class: 'btn ghost', onclick: () => layout(3, 3) }, '3×3'),
              el('button', { class: 'btn ghost', onclick: () => layout(4, 3) }, '4×3'),
              el('button', { class: 'btn ghost', onclick: () => layout(1, 1) }, 'Single')),
            canvas()),
          el('div', { class: 'panel' }, widgetEditor(), el('div', { class: 'sub-head' }, 'Widgets'), list())),
      el('div', { class: 'panel' }, el('h2', 'Layout memories'), memories()));
  }
  return { enter, render };
})();

// ---------- EDID generator (CVT-RB timing → EDID 1.4 base block) ----------
function cvtRB(H, V, R) {
  const CLK_STEP = 0.25, MIN_VBLANK = 460, HSYNC = 32, HBLANK = 160, VFPORCH = 3;
  const hActive = Math.floor(H / 8) * 8, ar = H / V, near = (a, b) => Math.abs(a - b) < 0.03;
  const vSync = near(ar, 4 / 3) ? 4 : near(ar, 16 / 9) ? 5 : near(ar, 16 / 10) ? 6
    : near(ar, 5 / 4) ? 7 : near(ar, 15 / 9) ? 7 : 10;
  const hPeriod = (1e6 / R - MIN_VBLANK) / (V + VFPORCH);
  let vBlank = Math.ceil(MIN_VBLANK / hPeriod);
  if (vBlank < vSync + VFPORCH + 6) vBlank = vSync + VFPORCH + 6;
  const pclk = Math.floor(((hActive + HBLANK) / hPeriod) / CLK_STEP) * CLK_STEP;
  return { pclkHz: Math.round(pclk * 1e6), hActive, hBlank: HBLANK, hFront: 48, hSync: HSYNC, vActive: V, vBlank, vFront: VFPORCH, vSync };
}
function edidDTD(b, off, t) {
  const pc = Math.round(t.pclkHz / 10000);
  b[off] = pc & 0xFF; b[off + 1] = (pc >> 8) & 0xFF;
  b[off + 2] = t.hActive & 0xFF; b[off + 3] = t.hBlank & 0xFF;
  b[off + 4] = ((t.hActive >> 8) << 4) | ((t.hBlank >> 8) & 0x0F);
  b[off + 5] = t.vActive & 0xFF; b[off + 6] = t.vBlank & 0xFF;
  b[off + 7] = ((t.vActive >> 8) << 4) | ((t.vBlank >> 8) & 0x0F);
  b[off + 8] = t.hFront & 0xFF; b[off + 9] = t.hSync & 0xFF;
  b[off + 10] = ((t.vFront & 0x0F) << 4) | (t.vSync & 0x0F);
  b[off + 11] = ((t.hFront >> 8) << 6) | (((t.hSync >> 8) & 3) << 4) | (((t.vFront >> 4) & 3) << 2) | ((t.vSync >> 4) & 3);
  b[off + 17] = 0x1E;
}
function edidText(b, off, tag, str) {
  b[off + 3] = tag;
  const s = (str || '').slice(0, 13);
  for (let i = 0; i < 13; i++) b[off + 5 + i] = i < s.length ? s.charCodeAt(i) : (i === s.length ? 0x0A : 0x20);
}
function edidRange(b, off, minV, maxV, maxClk) {
  b[off + 3] = 0xFD;
  b[off + 5] = minV; b[off + 6] = maxV; b[off + 7] = 15; b[off + 8] = 160;
  b[off + 9] = Math.round(maxClk / 10);
  for (let i = 11; i < 18; i++) b[off + i] = (i === 11 ? 0x0A : 0x20);
}
function buildEdid({ H, V, R, name = 'openrcs', mfr = 'AWY', year = 2026 }) {
  const t = cvtRB(H, V, R), b = new Uint8Array(256);
  b.set([0x00, 0xFF, 0xFF, 0xFF, 0xFF, 0xFF, 0xFF, 0x00], 0);
  const c = (i) => mfr.toUpperCase().charCodeAt(i) - 64, m = (c(0) << 10) | (c(1) << 5) | c(2);
  b[8] = (m >> 8) & 0xFF; b[9] = m & 0xFF; b[10] = 1; b[17] = (year - 1990) & 0xFF;
  b[18] = 1; b[19] = 4; b[20] = 0x80 | (0b010 << 4) | 0b0010; b[23] = 0x78; b[24] = 0x0A;
  b.set([0xEE, 0x91, 0xA3, 0x54, 0x4C, 0x99, 0x26, 0x0F, 0x50, 0x54], 25);
  for (let i = 38; i < 54; i++) b[i] = 0x01;
  edidDTD(b, 54, t);
  edidRange(b, 72, 23, Math.max(61, R + 1), t.pclkHz / 1e6 + 10);
  edidText(b, 90, 0xFC, name);
  edidText(b, 108, 0xFE, `${H}x${V}@${R}`);
  let sum = 0; for (let i = 0; i < 127; i++) sum += b[i];
  b[127] = (256 - (sum % 256)) % 256;
  return { bytes: b, timing: t };
}

// ---------- EDID management ----------
VIEWS.edid = (() => {
  // counts derived from the table: LiveCore EIava[24,6]/EOava[8,4],
  // Midra EIava[10,5]/EOava[2,8]
  const NIN = () => store.byMnem.get('EIava')?.dims[0] || 24;
  const inPlugs = () => store.byMnem.get('EIava')?.dims[1] || 6;
  const NOUT = () => store.byMnem.get('EOava')?.dims[0] || 8;
  const outPlugs = () => store.byMnem.get('EOava')?.dims[1] || 4;
  let inPlug = 0, outPlug = 0;
  // custom-EDID writer state
  const EDID_PRESETS = [
    ['1920×1080', 1920, 1080], ['1280×720', 1280, 720], ['3840×2160', 3840, 2160],
    ['2560×1440', 2560, 1440], ['1920×1200', 1920, 1200], ['1600×900', 1600, 900],
    ['1280×1024', 1280, 1024], ['1024×768', 1024, 768], ['Custom', 0, 0],
  ];
  let cIn = 0, cPlug = 0, cPreset = 0, cW = 1920, cH = 1080, cR = 60, cName = 'openrcs';
  let gen = null, writeStatus = '';
  function enter() {
    for (const m of ['EIava', 'EIspf', 'EIhcd']) store.scan(m);
    for (const m of ['EOava', 'EOval', 'EOhcd']) store.scan(m);
  }
  function generate() {
    const p = EDID_PRESETS[cPreset];
    const H = cPreset === EDID_PRESETS.length - 1 ? cW : p[1];
    const V = cPreset === EDID_PRESETS.length - 1 ? cH : p[2];
    if (!(H >= 640 && H <= 4096 && V >= 480 && V <= 2160)) { writeStatus = 'resolution out of range'; store.notify(); return; }
    gen = { ...buildEdid({ H, V, R: cR, name: cName }), H, V, R: cR };
    writeStatus = ''; store.notify();
  }
  function writeEdid() {
    if (!gen) return;
    if (!confirm(`Write a custom ${gen.H}×${gen.V}@${gen.R} EDID to IN ${cIn + 1} · ${plugName(cPlug)}?\nThis overwrites that input's stored EDID.`)) return;
    for (let i = 0; i < 256; i++) store.set('EIdat', [cIn, cPlug, i], gen.bytes[i]);
    store.set('EIstr', [cIn, cPlug], 1);
    writeStatus = 'written — 256 bytes sent + stored';
    store.notify();
  }
  const optSel = (cur, opts, onchange) => {
    const s = el('select', { onchange: (e) => onchange(e.target.value) });
    for (const [val, label] of opts) { const o = el('option', { value: val, text: label }); if ('' + val === '' + cur) o.selected = true; s.append(o); }
    return s;
  };
  const numInput = (val, onchange) => el('input', { type: 'number', class: 'num-in', value: val, oninput: (e) => onchange(+e.target.value | 0) });
  function customPanel() {
    const isCustom = cPreset === EDID_PRESETS.length - 1;
    const inputs = Array.from({ length: NIN() }, (_, i) => [i, 'IN ' + (i + 1)]);
    const plugs = Array.from({ length: inPlugs() }, (_, i) => [i, plugName(i)]);
    const presets = EDID_PRESETS.map(([l], i) => [i, l]);
    const refreshes = [24, 25, 30, 50, 60].map(r => [r, r + ' Hz']);
    const preview = gen ? (() => {
      const t = gen.timing, hex = [];
      for (let r = 0; r < 8; r++) hex.push([...gen.bytes.slice(r * 16, r * 16 + 16)].map(x => x.toString(16).padStart(2, '0')).join(' '));
      return el('div', {},
        el('div', { class: 'row', style: 'margin-top:10px' },
          el('span', { class: 'hint', text: `${gen.H}×${gen.V}@${gen.R} · pixel clock ${(t.pclkHz / 1e6).toFixed(2)} MHz · ${gen.H + t.hBlank}×${gen.V + t.vBlank} total · checksum OK` }),
          el('div', { class: 'spacer' }),
          el('button', { class: 'btn take', onclick: writeEdid }, `Write to IN ${cIn + 1}`)),
        el('pre', { class: 'edid-hex', text: hex.join('\n') }));
    })() : el('div', { class: 'hint', style: 'margin-top:8px', text: 'Choose a resolution and Generate to preview the EDID, then write it to an input.' });
    return el('div', { class: 'panel' }, el('h2', 'Custom EDID writer'),
      el('div', { class: 'row', style: 'flex-wrap:wrap;gap:10px' },
        el('label', { class: 'field' }, 'Target input', optSel(cIn, inputs, v => { cIn = +v; store.notify(); })),
        el('label', { class: 'field' }, 'Plug', optSel(cPlug, plugs, v => { cPlug = +v; store.notify(); })),
        el('label', { class: 'field' }, 'Resolution', optSel(cPreset, presets, v => { cPreset = +v; store.notify(); })),
        isCustom ? el('label', { class: 'field' }, 'Width', numInput(cW, v => cW = v)) : null,
        isCustom ? el('label', { class: 'field' }, 'Height', numInput(cH, v => cH = v)) : null,
        el('label', { class: 'field' }, 'Refresh', optSel(cR, refreshes, v => { cR = +v; store.notify(); })),
        el('label', { class: 'field' }, 'Monitor name', el('input', { type: 'text', class: 'num-in', style: 'width:130px', value: cName, maxlength: 13, oninput: (e) => cName = e.target.value })),
        el('button', { class: 'btn', onclick: generate }, 'Generate')),
      writeStatus ? el('div', { class: 'hint', style: 'margin-top:6px', text: writeStatus }) : null,
      preview);
  }
  function numField(mnem, idx, max) {
    const cur = store.val(mnem, ...idx);
    return el('input', {
      type: 'number', class: 'num-in', min: 0, max, value: cur ?? 0,
      onchange: (e) => { const v = Math.max(0, Math.min(max, +e.target.value | 0)); store.set(mnem, idx, v); },
    });
  }
  // decode the current preferred-format NAME (EIpfn is 16 chars per input/plug),
  // fetched lazily so we only pull names for the plug on screen
  const pfFetched = new Set();
  function pfName(i, p) {
    const key = i + ',' + p;
    if (!pfFetched.has(key)) { pfFetched.add(key); for (let c = 0; c < 16; c++) store.get('EIpfn', [i, p, c]); }
    let s = '';
    for (let c = 0; c < 16; c++) { const v = store.val('EIpfn', i, p, c); if (v == null || v === 0) break; s += String.fromCharCode(v); }
    return s.trim();
  }
  function inRow(i) {
    const idx = [i, inPlug], avail = store.val('EIava', ...idx) === 1;
    const spfMax = store.byMnem.get('EIspf')?.max ?? 146;
    return el('tr', { class: avail ? '' : 'dim' },
      el('td', { text: 'IN ' + (i + 1) }),
      el('td', boolChip(avail ? 1 : 0, 'present', '—')),
      el('td', { class: 'val', text: fmt(store.val('EIhcd', ...idx)) }),
      el('td', numField('EIspf', idx, spfMax),
        avail ? el('span', { class: 'hint', style: 'margin-left:8px', text: pfName(i, inPlug) }) : null),
      el('td',
        el('button', { class: 'btn ghost', onclick: () => store.set('EIstr', idx, 1) }, 'Store'),
        store.byMnem.has('Edpsf') ? el('button', { class: 'btn ghost', style: 'margin-left:6px', onclick: () => store.set('Edpsf', idx, 1) }, 'Factory') : null));
  }
  function outRow(i) {
    const idx = [i, outPlug], avail = store.val('EOava', ...idx) === 1, valid = store.val('EOval', ...idx) === 1;
    return el('tr', { class: avail ? '' : 'dim' },
      el('td', { text: 'OUT ' + (i + 1) }),
      el('td', boolChip(avail ? 1 : 0, 'present', '—')),
      el('td', boolChip(valid ? 1 : 0, 'valid', '—')),
      el('td', { class: 'val', text: fmt(store.val('EOhcd', ...idx)) }),
      el('td', el('button', { class: 'btn ghost', onclick: () => { store.set('EOred', idx, 1); store.scan('EOhcd'); store.scan('EOval'); } }, 'Read EDID')));
  }
  function plugSeg(cur, set, n, name) {
    const s = el('div', { class: 'seg' });
    for (let p = 0; p < n; p++) s.append(el('button', { class: p === cur ? 'on take' : '', onclick: () => { set(p); store.notify(); } }, name ? name(p) : 'Plug ' + (p + 1)));
    return s;
  }
  function render() {
    return el('div', {},
      el('div', { class: 'view-head' }, el('h1', { text: 'EDID' }),
        el('span', { class: 'hint', text: 'Preferred formats on inputs, and the EDID reported by attached displays' })),
      el('div', { class: 'panel' }, el('h2', 'Inputs'),
        el('div', { class: 'row' },
          el('label', { class: 'field' }, 'Connector', plugSeg(inPlug, p => inPlug = p, inPlugs(), plugName)),
          el('div', { class: 'spacer' }),
          el('span', { class: 'hint', text: 'Set a preferred format, Store to apply, Factory to revert' })),
        el('div', { style: 'overflow:auto' },
          el('table', { class: 'grid' },
            el('thead', el('tr', ...['Input', 'EDID', 'Hashcode', 'Pref format', 'Actions'].map(h => el('th', { text: h })))),
            el('tbody', ...Array.from({ length: NIN() }, (_, i) => inRow(i)))))),
      el('div', { class: 'panel' }, el('h2', 'Outputs'),
        el('div', { class: 'row' },
          el('label', { class: 'field' }, 'Connector', plugSeg(outPlug, p => outPlug = p, outPlugs())),
          el('div', { class: 'spacer' }),
          el('span', { class: 'hint', text: 'Read the EDID a connected display advertises' })),
        el('div', { style: 'overflow:auto' },
          el('table', { class: 'grid' },
            el('thead', el('tr', ...['Output', 'Display', 'EDID', 'Hashcode', ''].map(h => el('th', { text: h })))),
            el('tbody', ...Array.from({ length: NOUT() }, (_, i) => outRow(i)))))),
      customPanel(),
      store.byMnem.has('EdIsf')
        ? el('div', { class: 'panel' }, el('h2', 'EDID library'),
          el('div', { class: 'row' },
            el('button', { class: 'btn ghost', onclick: () => store.set('EdIsf', [], 1) }, 'Reset inputs to factory'),
            store.byMnem.has('PCelr') ? el('button', { class: 'btn ghost', onclick: () => { if (confirm('Reset the entire EDID library to factory?')) store.set('PCelr', [], 1); } }, 'Reset EDID library') : null))
        : null);
  }
  return { enter, render };
})();

// ---------- Soft edge (edge blending for multi-output screens) ----------
VIEWS.softedge = (() => {
  let screen = 0, edge = 0;              // edge 0..3
  const EDGES = ['Left', 'Right', 'Top', 'Bottom'];   // order GUESSED
  function enter() {
    store.scan('SCmly');
    for (let e = 0; e < 4; e++) for (const m of ['SEcen', 'SEadv', 'SEapc', 'SEbof']) store.get(m, [screen, e]);
    for (const m of ['SEbrl', 'SEblg', 'SEbbl']) store.get(m, [screen, 0]);
  }
  function edgeMap() {
    const box = el('div', { class: 'se-screen' });
    for (let e = 0; e < 4; e++) {
      const on = store.val('SEcen', screen, e) === 1;
      box.append(el('div', {
        class: `se-edge ${EDGES[e].toLowerCase()}` + (on ? ' on' : '') + (e === edge ? ' sel' : ''),
        onclick: () => { edge = e; store.notify(); },
      }, el('span', { class: 'se-lbl', text: EDGES[e] })));
    }
    box.append(el('span', { class: 'se-mid', text: `Screen ${screen + 1}` }));
    return el('div', { class: 'canvas-wrap' }, box);
  }
  function edgeEditor() {
    const i = [screen, edge], on = store.val('SEcen', ...i) === 1, adv = store.val('SEadv', ...i) === 1;
    return el('div', { class: 'editor' },
      el('div', { class: 'row' },
        el('span', { class: 'hint', text: EDGES[edge] + ' edge' }), el('div', { class: 'spacer' }),
        el('button', { class: 'btn ' + (on ? 'pgm' : 'ghost'), onclick: () => { store.set('SEcen', i, on ? 0 : 1); store.notify(); } }, on ? 'Blend on' : 'Blend off')),
      bind('Black offset', 'SEbof', i, 0, 1023, 1),
      el('div', { class: 'row' },
        el('label', { class: 'field' }, 'Curve',
          el('div', { class: 'seg' },
            el('button', { class: !adv ? 'on recall' : '', onclick: () => { store.set('SEadv', i, 0); store.notify(); } }, 'Simple'),
            el('button', { class: adv ? 'on take' : '', onclick: () => { store.set('SEadv', i, 1); store.notify(); } }, 'Advanced'))),
        adv ? bind('Points', 'SEapc', i, 0, 10, 1) : null));
  }
  function render() {
    const configured = (store.val('SCmly', screen) || 0) > 0;
    return el('div', {},
      el('div', { class: 'view-head' }, el('h1', { text: 'Soft edge' }),
        el('span', { class: 'hint', text: `Screen ${screen + 1} · click an edge to blend it into its neighbour` })),
      el('div', { class: 'panel' },
        el('div', { class: 'row' },
          el('label', { class: 'field' }, 'Screen', screenSelect(screen, v => { screen = v; edge = 0; enter(); store.notify(); })),
          configured ? null : el('span', { class: 'hint', text: 'screen not configured' }))),
      el('div', { class: 'split-wide' },
        el('div', { class: 'panel' }, edgeMap()),
        el('div', { class: 'panel' }, edgeEditor(),
          el('div', { class: 'sub-head' }, 'Black level (screen)'),
          el('div', { class: 'grid2' },
            bind('Red', 'SEbrl', [screen, 0], 0, 127, 1),
            bind('Green', 'SEblg', [screen, 0], 0, 127, 1),
            bind('Blue', 'SEbbl', [screen, 0], 0, 127, 1)))));
  }
  return { enter, render };
})();

// ---------- Workspace (the working page: sources, screens, layer properties, memories) ----------
// One page you can actually run a show from: drag a source onto a layer, arrange it,
// edit every property of the selected layer, take it to air, and store/recall the look.
VIEWS.workspace = (() => {
  let sel = null;            // { s, c, l } selected layer
  let armed = null;          // armed source number (click-to-place, the touch-friendly path)
  let hidden = new Set();    // screens hidden from the page
  let srcTab = 'inputs';     // source rail tab
  let showLive = true, showEdit = true;   // which banks are drawn
  let ttime = 1000;          // take duration, ms
  let open = new Set(['geom', 'transp', 'effects']);   // expanded inspector sections
  let keepAspect = false;
  let dragSrc = null;        // source number under an HTML5 drag
  let dragLayer = null;      // { s, c, l } layer being dragged between slots
  const B = POS_BIAS;

  const active = () => Array.from({ length: screenCount() }, (_, s) => s).filter(s => (store.val('SCssh', s) || 0) > 0);
  const maxLayers = (s) => store.val('SCmly', s) || 4;
  const screenPx = (s) => ({ w: store.val('SCssh', s) || 1920, h: store.val('SCssv', s) || 1080 });
  // On LiveCore the two banks are program and preview and which is which moves with
  // GCsta; on Midra context 0 is program and 1 is the protected preview.
  const ctxRole = (s, c) => (hasBanks() ? (c === liveCtx(s) ? 'pgm' : 'pvw') : (c === 0 ? 'pgm' : 'pvw'));
  const ctxName = (s, c) => ctxRole(s, c) === 'pgm' ? 'Program' : 'Preview';
  // program first so the on-air look always sits on top of the stack, whichever
  // bank the device currently has live
  const shownCtx = (s) => [0, 1]
    .filter(c => (ctxRole(s, c) === 'pgm' ? showLive : showEdit))
    .sort((a, b) => (ctxRole(s, a) === 'pgm' ? 0 : 1) - (ctxRole(s, b) === 'pgm' ? 0 : 1));

  // size every canvas to the largest box that fits its slot, keeping aspect ratio
  function fitCanvases() {
    document.querySelectorAll('.ws-screen .canvas-wrap').forEach(wrap => {
      const cv = wrap.querySelector('.screen-canvas'); if (!cv) return;
      const ar = parseFloat(cv.dataset.ar) || (16 / 9);
      const availW = wrap.clientWidth, availH = wrap.clientHeight;
      if (!availW || !availH) return;
      let w = availW, h = w / ar;
      if (h > availH) { h = availH; w = h * ar; }
      cv.style.width = Math.round(w) + 'px';
      cv.style.height = Math.round(h) + 'px';
    });
  }
  window.addEventListener('resize', () => { if (currentView === 'workspace') fitCanvases(); });

  function enter() {
    if (store.meta?.platform === 'midra') store.set('CTpmu', [], 1);
    for (const m of ['SCssh', 'SCssv', 'SCmly', 'INava', 'INplg']) if (store.byMnem.has(m)) store.scan(m);
    // signal presence per input, so a source that cannot be placed reads as such
    if (store.byMnem.has('ISfwi')) store.scan('ISfwi');
    for (const m of ['GCsta', 'Plngr', 'GCtba', 'GCtup', 'GCtdn']) if (store.byMnem.has(m)) store.scan(m);
    if (store.meta?.platform === 'livecore') for (const m of ['LSval', 'RSval']) if (store.byMnem.has(m)) store.scan(m);
    for (let s = 0; s < screenCount(); s++) {
      fetchLabel('LBScr', [s]);
      for (let l = 0; l < layerSlots(); l++)
        for (const c of [0, 1])
          for (const m of ['PRinp', 'PRpoh', 'PRpov', 'PRsih', 'PRsiv', 'PRalp']) store.get(m, [s, c, l]);
    }
    for (let i = 0; i < inputCount(); i++) fetchLabel('LBInp', [i, store.val('INplg', i) ?? 0]);
    for (let i = 0; i < 8; i++) { fetchLabel('LBLgS', [i]); fetchLabel('LBRdS', [i]); }
    if (store.byMnem.has('PSval')) { store.scan('PSval'); store.scan('PSssm'); }
    if (store.byMnem.has('PMscw')) store.scan('PMscw');
    if (store.byMnem.has('PMpst')) store.scan('PMpst');
    if (sel) fetchLayer(sel.s, sel.c, sel.l);
    enableSnapshots();
    startSnapshots();
    // land on the page with something in the properties panel rather than an empty one
    if (!sel) setTimeout(selectSomething, 700);
  }

  // every per-layer variable the inspector can show
  const LAYER_VARS = ['PRinp', 'PRalp', 'PRpoh', 'PRpov', 'PRpoz', 'PRsih', 'PRsiv',
    'PRaov', 'PRflg', 'PRcph', 'PRcpv', 'PRcsh', 'PRcsv',
    'PRbst', 'PRbcr', 'PRbcg', 'PRbcb', 'PRbal', 'PRbsh', 'PRbsv',
    'PRotr', 'PRowa', 'PRctr', 'PRcwa', 'PRoso', 'PRoeo', 'PRcso', 'PRceo',
    'PRtba', 'PRtbb', 'PRbah', 'PRbav', 'PRbbh', 'PRbbv', 'PRroh', 'PRrov', 'PRroz',
    // Midra spells these out instead of packing them into PRflg
    'PRodu', 'PRcdu', 'PRftr', 'PRsmm', 'PRfli', 'PRshp'];
  function fetchLayer(s, c, l) {
    for (const m of LAYER_VARS) if (store.byMnem.has(m)) store.get(m, [s, c, l]);
    if (store.byMnem.has('MAsla')) { store.get('MAsla', [s, l]); store.get('MAsfa', [s, l]); }
    if (store.byMnem.has('STsls')) store.get('STsls', [s, l]);
    if (store.byMnem.has('Plsgr')) store.get('Plsgr', [s, l]);
    if (store.byMnem.has('GCfrl')) store.get('GCfrl', [s, l]);
  }
  function select(s, c, l) { sel = { s, c, l }; fetchLayer(s, c, l); store.notify(); }
  /** First layer worth showing: the editable bank of the first visible screen. */
  function selectSomething() {
    if (sel) return;
    for (const s of active()) {
      if (hidden.has(s)) continue;
      for (const c of [editCtx(s), liveCtx(s)])
        for (let l = 0; l < maxLayers(s); l++)
          if (store.val('PRinp', s, c, l)) { select(s, c, l); return; }
    }
  }

  // ---- geometry ----
  const setGeom = (s, c, l, r) => {
    r = WORK_AREA.fit(s, r);
    throttledSet('PRsih', [s, c, l], Math.max(0, Math.round(r.w)));
    throttledSet('PRsiv', [s, c, l], Math.max(0, Math.round(r.h)));
    throttledSet('PRpoh', [s, c, l], Math.round(r.left + r.w / 2 + B));
    throttledSet('PRpov', [s, c, l], Math.round(r.top + r.h / 2 + B));
  };
  const setGeomNow = (s, c, l, r) => {
    r = WORK_AREA.fit(s, r);
    store.set('PRsih', [s, c, l], Math.max(0, Math.round(r.w)));
    store.set('PRsiv', [s, c, l], Math.max(0, Math.round(r.h)));
    store.set('PRpoh', [s, c, l], Math.round(r.left + r.w / 2 + B));
    store.set('PRpov', [s, c, l], Math.round(r.top + r.h / 2 + B));
  };
  const scaleOf = (cv, sw, sh) => ({ x: cv.clientWidth / sw || 1, y: cv.clientHeight / sh || 1 });
  const asPct = (box, r, sw, sh) => {
    box.style.left = (r.left / sw * 100) + '%'; box.style.top = (r.top / sh * 100) + '%';
    box.style.width = (r.w / sw * 100) + '%'; box.style.height = (r.h / sh * 100) + '%';
  };
  const assignedLayers = (s, c) => {
    const o = []; for (let l = 0; l < maxLayers(s); l++) if (store.val('PRinp', s, c, l)) o.push(l); return o;
  };
  const firstFreeLayer = (s, c) => {
    for (let l = 0; l < maxLayers(s); l++) if (!store.val('PRinp', s, c, l)) return l;
    return null;
  };

  // ---- placing a source ----
  /** Put a source on a layer, giving it a sensible box if it has none yet. */
  function assign(s, c, l, src, at) {
    store.set('PRinp', [s, c, l], src);
    // Midra drops a write it will not honour — an input with no signal, most often —
    // without sending a NAK, so read it back rather than assume it landed.
    if (isMidra()) {
      setTimeout(() => {
        store.get('PRinp', [s, c, l]);
        setTimeout(() => {
          if ((store.val('PRinp', s, c, l) || 0) !== src) {
            const why = src && src < srcMaxOf() && !inputHasSignal(src - 1)
              ? 'there is no signal on it' : 'the device refused it';
            flash(`${sourceName(src)} did not go on L${l + 1} — ${why}`);
          }
        }, 350);
      }, 350);
    }
    const cur = layerRectPx(s, c, l);
    if (!(cur.w > 0 && cur.h > 0)) {
      const { w: sw, h: sh } = screenPx(s);
      if (at) {                                  // dropped somewhere specific: a PiP there
        const w = Math.round(sw / 3), h = Math.round(sh / 3);
        setGeomNow(s, c, l, {
          left: Math.min(Math.max(0, at.x - w / 2), sw - w),
          top: Math.min(Math.max(0, at.y - h / 2), sh - h), w, h,
        });
      } else if (assignedLayers(s, c).filter(x => x !== l).length === 0) {
        setGeomNow(s, c, l, { left: 0, top: 0, w: sw, h: sh });   // first layer fills
      } else {
        const w = Math.round(sw / 3), h = Math.round(sh / 3);
        setGeomNow(s, c, l, { left: Math.round((sw - w) / 2), top: Math.round((sh - h) / 2), w, h });
      }
      if (store.byMnem.has('PRalp') && !store.val('PRalp', s, c, l)) store.set('PRalp', [s, c, l], 256);
    }
    select(s, c, l);
  }
  /** Drop a source onto a screen without naming a layer: take the first free one. */
  function drop(s, c, src, at) {
    const l = firstFreeLayer(s, c);
    if (l == null) { flash(`Screen ${s + 1} has no free layer`); return; }
    assign(s, c, l, src, at);
  }
  function clearLayer(s, c, l) {
    store.set('PRinp', [s, c, l], 0);
    if (sel && sel.s === s && sel.c === c && sel.l === l) sel = null;
    store.notify();
  }
  function clearAll(s, c) { for (let l = 0; l < maxLayers(s); l++) store.set('PRinp', [s, c, l], 0); sel = null; store.notify(); }

  let flashMsg = null, flashTimer = null;
  function flash(t) {
    flashMsg = t; clearTimeout(flashTimer);
    flashTimer = setTimeout(() => { flashMsg = null; store.notify(); }, 2600);
    store.notify();
  }

  // ---- layout presets ----
  const LAYOUTS = [
    ['full', 'Fill', 'Selected source fills the screen'],
    ['2up', '2-up', 'Two sources side by side'],
    ['3up', '3-up', 'Three sources side by side'],
    ['quad', 'Quad', 'Four sources in quadrants'],
    ['pip', 'PiP', 'Full source with an inset'],
    ['stack', 'Stack', 'Two sources, one above the other'],
  ];
  // Layouts divide the working area, not the raster — on a screen with one, a
  // quad is four cells of the region that is seen rather than four cells of a
  // picture whose edges never leave the frame.
  function arrange(s, c, kind) {
    const { x: ox, y: oy, w: sw, h: sh } = workPx(s);
    const ls = assignedLayers(s, c); if (!ls.length) return;
    const put = (l, x, y, w, h) => setGeomNow(s, c, l, { left: ox + x, top: oy + y, w, h });
    if (kind === 'full') {
      const t = (sel && sel.s === s && sel.c === c && store.val('PRinp', s, c, sel.l)) ? sel.l : ls[0];
      put(t, 0, 0, sw, sh);
    } else if (kind === '2up') {
      const w = sw / 2; ls.slice(0, 2).forEach((l, i) => put(l, i * w, 0, w, sh));
    } else if (kind === '3up') {
      const w = sw / 3; ls.slice(0, 3).forEach((l, i) => put(l, i * w, 0, w, sh));
    } else if (kind === 'quad') {
      const w = sw / 2, h = sh / 2;
      ls.slice(0, 4).forEach((l, i) => put(l, (i % 2) * w, (i < 2 ? 0 : 1) * h, w, h));
    } else if (kind === 'stack') {
      const h = sh / 2; ls.slice(0, 2).forEach((l, i) => put(l, 0, i * h, sw, h));
    } else if (kind === 'pip') {
      put(ls[0], 0, 0, sw, sh);
      if (ls[1]) {
        const w = Math.round(sw / 3), h = Math.round(sh / 3), m = Math.round(sw * 0.03);
        put(ls[1], sw - w - m, sh - h - m, w, h);
      }
    }
    store.notify();
  }
  /** Nine-point placement of the selected layer, keeping its size. */
  function place(s, c, l, ix) {
    const { x: ox, y: oy, w: sw, h: sh } = workPx(s), r = layerRectPx(s, c, l);
    const col = ix % 3, row = Math.floor(ix / 3);
    setGeomNow(s, c, l, { left: ox + col * (sw - r.w) / 2, top: oy + row * (sh - r.h) / 2, w: r.w, h: r.h });
    store.notify();
  }
  /** Resize the selected layer to an aspect ratio, keeping its width. */
  function setAspect(s, c, l, ar) {
    const r = layerRectPx(s, c, l);
    setGeomNow(s, c, l, { left: r.left, top: r.top, w: r.w, h: Math.round(r.w / ar) });
    store.notify();
  }
  /** Size the layer to its source's native resolution, centred. */
  function contentSize(s, c, l) {
    const src = store.val('PRinp', s, c, l) || 0;
    let w = 0, h = 0;
    if (src >= 1 && src <= 24) { w = store.val('INish', src - 1) || 0; h = store.val('INisv', src - 1) || 0; }
    else if (src >= 25 && src <= 32) { w = store.val('LSdwi', src - 25) || 0; h = store.val('LSdhe', src - 25) || 0; }
    if (!w || !h) { flash('No native size reported for this source'); return; }
    const { x: ox, y: oy, w: sw, h: sh } = workPx(s);
    setGeomNow(s, c, l, { left: ox + Math.round((sw - w) / 2), top: oy + Math.round((sh - h) / 2), w, h });
    store.notify();
  }
  function reorder(s, c, l, dir) {
    if (!store.byMnem.has('LSscr')) return;
    store.set('LSscr', [], s); store.set('LSprs', [], c); store.set('LSlay', [], l);
    store.set(dir === 'up' ? 'LSrai' : 'LSlow', [], 1);
    setTimeout(() => { for (let k = 0; k < maxLayers(s); k++) fetchLayer(s, c, k); }, 250);
  }

  // ---- pointer drags on the canvas ----
  function dragMove(e, s, c, l, cv, sw, sh) {
    e.preventDefault(); e.stopPropagation(); beginDrag(); select(s, c, l);
    const box = e.currentTarget, sx = e.clientX, sy = e.clientY, r0 = layerRectPx(s, c, l), k = scaleOf(cv, sw, sh);
    const move = (ev) => {
      const r = { ...r0, left: r0.left + (ev.clientX - sx) / k.x, top: r0.top + (ev.clientY - sy) / k.y };
      asPct(box, r, sw, sh); setGeom(s, c, l, r);
    };
    const up = () => { document.removeEventListener('pointermove', move); document.removeEventListener('pointerup', up); endDrag(); };
    document.addEventListener('pointermove', move); document.addEventListener('pointerup', up);
  }
  function dragResize(e, s, c, l, cv, sw, sh, corner) {
    e.preventDefault(); e.stopPropagation(); beginDrag(); select(s, c, l);
    const box = e.currentTarget.parentNode, sx = e.clientX, sy = e.clientY;
    const r0 = layerRectPx(s, c, l), k = scaleOf(cv, sw, sh), ar = r0.h ? r0.w / r0.h : 16 / 9;
    const west = corner.includes('w'), north = corner.includes('n');
    const move = (ev) => {
      const dx = (ev.clientX - sx) / k.x, dy = (ev.clientY - sy) / k.y;
      let left = r0.left, right = r0.left + r0.w, top = r0.top, bot = r0.top + r0.h;
      if (west) left = Math.min(right - 16, r0.left + dx); else right = Math.max(left + 16, right + dx);
      if (north) top = Math.min(bot - 16, r0.top + dy); else bot = Math.max(top + 16, bot + dy);
      let r = { left, top, w: right - left, h: bot - top };
      if (keepAspect) {
        const h = r.w / ar;
        if (north) r.top = bot - h;
        r.h = h;
      }
      asPct(box, r, sw, sh); setGeom(s, c, l, r);
    };
    const up = () => { document.removeEventListener('pointermove', move); document.removeEventListener('pointerup', up); endDrag(); };
    document.addEventListener('pointermove', move); document.addEventListener('pointerup', up);
  }

  // ---- HTML5 drag and drop: source rail -> layer ----
  // A full re-render mid-drag would tear the drag out of the DOM, so a drag holds off
  // rendering the same way a slider does.
  const dragProps = (n) => ({
    draggable: 'true',
    ondragstart: (e) => {
      dragSrc = n; beginDrag();
      e.dataTransfer.effectAllowed = 'copy';
      e.dataTransfer.setData('text/plain', String(n));
    },
    ondragend: () => { dragSrc = null; dragLayer = null; endDrag(); document.querySelectorAll('.drop-hot').forEach(x => x.classList.remove('drop-hot')); },
  });
  /** Read the dragged source out of a drop event, falling back to the module flag. */
  const droppedSource = (e) => {
    const t = e.dataTransfer?.getData('text/plain');
    const n = t === '' || t == null ? NaN : Number(t);
    return Number.isFinite(n) ? n : dragSrc;
  };
  const dropTarget = (onDrop) => ({
    ondragover: (e) => {
      if (dragSrc == null && !dragLayer) return;
      e.preventDefault(); e.stopPropagation();
      e.dataTransfer.dropEffect = 'copy';
      e.currentTarget.classList.add('drop-hot');
    },
    ondragleave: (e) => e.currentTarget.classList.remove('drop-hot'),
    ondrop: (e) => {
      e.preventDefault(); e.stopPropagation();
      e.currentTarget.classList.remove('drop-hot');
      onDrop(e);
      dragSrc = null; dragLayer = null; endDrag();
    },
  });

  // ---- source rail ----
  function srcTile(n) {
    const name = sourceName(n), kind = sourceKind(n);
    const snap = snapshotUrl(n);
    const usable = sourceAvailable(n);
    return el('button', {
      class: 'src-tile' + (armed === n ? ' armed' : '') + ' k-' + kind + (usable ? '' : ' nosig'),
      title: !n ? 'Clear the layer'
        : usable ? `${name} — drag onto a layer, or click to arm`
        : `${name} — no signal, so the device will not put it on a layer`,
      ...dragProps(n),
      onclick: () => { armed = armed === n ? null : n; store.notify(); },
    },
      el('span', {
        class: 'src-sw' + (snap ? ' shot' : ''),
        style: `background:${n === 0 ? 'var(--line-hi)' : srcColor(n)}`
             + (snap ? `;background-image:url("${snap}")` : ''),
      }),
      el('span', { class: 'src-nm', text: name }),
      n ? el('span', { class: 'src-ix', text: srcBadge(n, kind) }) : null);
  }
  function srcBadge(n, kind) {
    if (isMidra()) return n >= srcMaxOf() ? 'COL' : 'IN' + n;
    if (kind === 'still') return 'ST' + (n - 24);
    if (kind === 'rstill') return 'RS' + (n - 32);
    if (kind === 'colour') return '';
    return 'IN' + n;
  }
  function inputNums() {
    if (store.byMnem.has('INava')) {
      const o = []; for (let i = 0; i < inputCount(); i++) if (store.val('INava', i)) o.push(i + 1);
      if (o.length) return o;
    }
    const max = store.meta?.platform === 'livecore' ? Math.min(srcMaxOf(), 24) : srcMaxOf();
    return Array.from({ length: max }, (_, i) => i + 1);
  }
  const loadedStills = () => { const o = []; for (let i = 0; i < 8; i++) if (store.val('LSval', i) === 1) o.push(25 + i); return o; };
  const loadedRStills = () => { const o = []; for (let i = 0; i < 8; i++) if (store.val('RSval', i) === 1) o.push(33 + i); return o; };

  /** Every source number the device is already using, so nothing in use is unlistable. */
  function sourcesInUse() {
    const set = new Set();
    for (let s = 0; s < screenCount(); s++)
      for (let c = 0; c < 3; c++)
        for (let l = 0; l < layerSlots(); l++) {
          const v = store.val('PRinp', s, c, l);
          if (v) set.add(v);
        }
    return set;
  }
  function sourceRail() {
    const live = store.meta?.platform === 'livecore';
    if (!live) {
      // Midra: every input slot the frame has, then colour last. Slots the frame does
      // not carry are dropped, but anything already sitting on a layer stays listed.
      const slots = store.byMnem.get('INava')?.dims[0] ?? inputCount();
      const inUse = sourcesInUse();
      const nums = [];
      for (let i = 1; i <= slots && i < srcMaxOf(); i++)
        if (store.val('INava', i - 1) !== 0 || inUse.has(i)) nums.push(i);
      nums.push(srcMaxOf());                                    // colour
      return el('div', { class: 'panel ws-rail' }, el('h2', 'Sources'),
        el('div', { class: 'src-list' }, srcTile(0), ...nums.map(srcTile)),
        el('div', { class: 'ws-rail-foot hint', text: armed != null ? `${sourceName(armed)} armed` : 'Drag onto a layer' }));
    }
    const tab = (id, label) => el('button', { class: 'src-tab' + (srcTab === id ? ' on' : ''), onclick: () => { srcTab = id; store.notify(); } }, label);
    let items;
    if (srcTab === 'stills') {
      const st = loadedStills(), rs = loadedRStills();
      items = st.length || rs.length ? [...st, ...rs]
        : [el('div', { class: 'hint', style: 'padding:10px 8px', text: 'No stills loaded — load or capture frames in the Stills view.' })];
    } else if (srcTab === 'other') {
      items = [41];
    } else {
      items = inputNums();
    }
    const list = el('div', { class: 'src-list' }, srcTile(0),
      ...items.map(x => typeof x === 'number' ? srcTile(x) : x));
    return el('div', { class: 'panel ws-rail' },
      el('div', { class: 'src-tabs' }, tab('inputs', 'Inputs'), tab('stills', 'Stills'), tab('other', 'Other')),
      list,
      el('div', { class: 'ws-rail-foot hint', text: armed != null ? `${sourceName(armed)} armed` : 'Drag onto a layer' }));
  }

  // ---- one bank of one screen ----
  function contextCanvas(s, c) {
    const { w: sw, h: sh } = screenPx(s);
    const role = ctxRole(s, c);
    const n = maxLayers(s);
    const cv = el('div', { class: 'screen-canvas ws-cv-' + role });
    cv.dataset.ar = String(sw / sh);
    cv.append(workOverlay(s, sw, sh, false) || '');
    const pointFromEvent = (e) => {
      const b = cv.getBoundingClientRect();
      return { x: (e.clientX - b.left) / (b.width || 1) * sw, y: (e.clientY - b.top) / (b.height || 1) * sh };
    };
    // dropping on bare canvas places the source on the first free layer, where you let go
    Object.entries(dropTarget((e) => {
      const src = droppedSource(e);
      if (src == null || Number.isNaN(src)) return;
      drop(s, c, src, pointFromEvent(e));
    })).forEach(([k, v]) => cv.addEventListener(k.slice(2), v));

    for (let l = 0; l < n; l++) {
      const src = store.val('PRinp', s, c, l);
      const isSel = sel && sel.s === s && sel.c === c && sel.l === l;
      if (!src && !isSel) continue;
      const r = layerRectPx(s, c, l);
      const alpha = (store.val('PRalp', s, c, l) ?? 256) / 256;
      const missing = src && !sourceAvailable(src);
      const snap = snapshotUrl(src);
      const box = el('div', {
        class: 'lrect' + (isSel ? ' sel' : '') + (src ? '' : ' empty') + (missing ? ' missing' : '') + (snap ? ' shot' : ''),
        title: missing ? `${sourceName(src)} is not available — a take waiting on this layer will not land` : '',
        style: `background:${srcColor(src)};z-index:${l + 1};opacity:${Math.max(0.15, alpha)}`
             + (snap ? `;background-image:url("${snap}")` : ''),
        ...dropTarget((e) => {
          const n2 = droppedSource(e);
          if (n2 == null || Number.isNaN(n2)) return;
          assign(s, c, l, n2);
        }),
        onpointerdown: (e) => {
          if (armed != null) { e.stopPropagation(); assign(s, c, l, armed); }
          else dragMove(e, s, c, l, cv, sw, sh);
        },
      },
        el('span', { class: 'lrect-tag' + (missing ? ' bad' : ''), text: `L${l + 1}${src ? ' · ' + sourceName(src) : ''}${missing ? ' ⚠' : ''}` }),
        ...['nw', 'ne', 'sw', 'se'].map(cn =>
          el('div', { class: 'handle ' + cn, onpointerdown: (e) => dragResize(e, s, c, l, cv, sw, sh, cn) })));
      asPct(box, r, sw, sh);
      cv.append(box);
    }
    const broken = assignedLayers(s, c).filter(l => !sourceAvailable(store.val('PRinp', s, c, l)));
    return el('div', { class: 'ws-ctx ws-ctx-' + role },
      el('div', { class: 'ws-ctx-head' },
        el('span', { class: 'ws-ctx-tag ' + role }, ctxName(s, c)),
        role === 'pgm' ? el('span', { class: 'ws-onair', text: 'ON AIR' }) : null,
        broken.length ? el('button', {
          class: 'ws-warn',
          title: `${broken.map(l => 'L' + (l + 1) + ' · ' + sourceName(store.val('PRinp', s, c, l))).join(', ')} — the source is not available, so a take will not land. Click to clear them.`,
          onclick: () => { broken.forEach(l => store.set('PRinp', [s, c, l], 0)); store.notify(); },
        }, `⚠ ${broken.length} unavailable`) : null,
        el('div', { class: 'spacer' }),
        el('span', { class: 'hint', text: `${assignedLayers(s, c).length}/${n} layers` }),
        el('button', { class: 'ws-mini', title: 'Clear every layer in this bank', onclick: () => clearAll(s, c) }, 'Clear')),
      el('div', { class: 'canvas-wrap' }, cv),
      slotRow(s, c));
  }

  function slotRow(s, c) {
    const row = el('div', { class: 'ws-slots' });
    for (let l = 0; l < maxLayers(s); l++) {
      const src = store.val('PRinp', s, c, l), isSel = sel && sel.s === s && sel.c === c && sel.l === l;
      row.append(el('button', {
        class: 'ws-slot' + (isSel ? ' sel' : '') + (src ? ' filled' : ''),
        style: src ? `--c:${srcColor(src)}` : '',
        title: src ? `L${l + 1} · ${sourceName(src)}` : `L${l + 1} — empty`,
        ...dropTarget((e) => {
          const n = droppedSource(e);
          if (n == null || Number.isNaN(n)) return;
          assign(s, c, l, n);
        }),
        onclick: () => { if (armed != null) assign(s, c, l, armed); else select(s, c, l); },
      }, `L${l + 1}`));
    }
    row.append(el('div', { class: 'spacer' }));
    for (const [k, label, t] of LAYOUTS)
      row.append(el('button', { class: 'ws-lay', title: t, onclick: () => arrange(s, c, k) }, label));
    return row;
  }

  // ---- screen card ----
  function screenCard(s) {
    const cols = shownCtx(s).map(c => contextCanvas(s, c));
    const g = groupOf(s), status = store.val('GCsta', g);
    const busy = midTransition(s);
    // both platforms carry a T-bar, but over different ranges (0..65535 / 0..10000)
    const tbarDef = store.byMnem.get('GCtba');
    const tbarMax = tbarDef?.max ?? 65535;
    const tbarIdx = hasBanks() ? g : s;
    const tbar = !!tbarDef;
    const takeReady = store.byMnem.has('GCtav') ? store.val('GCtav', s) !== 0 : true;
    return el('div', { class: 'panel ws-screen' },
      el('div', { class: 'ws-screen-head' },
        el('h2', screenLabel(s)),
        el('span', { class: 'ws-dim hint', text: `${screenPx(s).w}×${screenPx(s).h}` }),
        busy ? el('button', { class: 'ws-mini ws-busy', title: 'Transition in progress — click to complete it now', onclick: () => forceTake(s) }, '···') : null,
        el('div', { class: 'spacer' }),
        tbar ? el('label', { class: 'ws-tbar', title: 'T-bar — drag to transition by hand' },
          el('input', {
            type: 'range', min: 0, max: tbarMax, step: Math.max(1, Math.round(tbarMax / 256)),
            value: store.val('GCtba', tbarIdx) ?? 0,
            onpointerdown: beginDrag, onpointerup: endDrag, onpointercancel: endDrag,
            oninput: (e) => throttledSet('GCtba', [tbarIdx], +e.target.value),
          })) : null,
        store.byMnem.has('GCfsc') ? el('button', {
          class: 'ws-mini' + (store.val('GCfsc', s) === 1 ? ' on' : ''), title: 'Freeze this screen',
          onclick: () => store.set('GCfsc', [s], store.val('GCfsc', s) === 1 ? 0 : 1),
        }, '❄') : null,
        store.byMnem.has('GCrpr') ? el('button', { class: 'ws-mini', title: 'Copy program back into preview', onclick: () => { store.set('GCrpr', [s], 1); setTimeout(() => enter(), 400); } }, '⇊') : null,
        (store.byMnem.has('GCstb') || store.byMnem.has('GCsba')) ? el('button', { class: 'ws-mini', title: 'Return to the look before the last take', onclick: () => doStepBack(s) }, '↶') : null,
        el('button', { class: 'ws-mini pvw-b', onclick: () => doCut(s) }, 'Cut'),
        el('button', { class: 'ws-mini pgm-b' + (takeReady ? '' : ' dim'), title: takeReady ? '' : 'The device reports nothing to take', onclick: () => doTake(s, ttime) }, 'Take')),
      el('div', { class: 'ws-ctxs' }, ...cols));
  }

  // ================= layer inspector =================
  function section(id, title, ...body) {
    const isOpen = open.has(id);
    return el('div', { class: 'insp-sec' + (isOpen ? ' open' : '') },
      el('button', {
        class: 'insp-head',
        onclick: () => { if (isOpen) open.delete(id); else open.add(id); store.notify(); },
      }, el('span', { class: 'insp-caret', text: isOpen ? '▾' : '▸' }), title),
      isOpen ? el('div', { class: 'insp-body' }, ...body) : null);
  }
  /** A numeric entry bound to a device variable, with the device's own range. */
  function num(label, mnem, idx, opts = {}) {
    const def = store.byMnem.get(mnem);
    if (!def) return null;
    const cur = store.val(mnem, ...idx);
    const id = `n-${mnem}-${idx.join('-')}`;
    return el('label', { class: 'nfield' },
      el('span', { text: label }),
      el('input', {
        id, type: 'number', min: opts.min ?? def.min, max: opts.max ?? def.max, step: opts.step ?? 1,
        value: cur ?? '',
        onchange: (e) => { const v = Math.round(+e.target.value); if (Number.isFinite(v)) store.set(mnem, idx, v); },
      }));
  }
  /** Geometry entry in screen pixels: the wire carries a biased centre, not a corner. */
  function geomField(label, s, c, l, axis) {
    const r = layerRectPx(s, c, l), { w: sw, h: sh } = screenPx(s);
    const val = { x: r.left, y: r.top, w: r.w, h: r.h }[axis];
    const id = `g-${axis}-${s}-${c}-${l}`;
    return el('label', { class: 'nfield' },
      el('span', { text: label }),
      el('input', {
        id, type: 'number', step: 1, value: Math.round(val),
        onchange: (e) => {
          const v = Math.round(+e.target.value); if (!Number.isFinite(v)) return;
          const next = { left: r.left, top: r.top, w: r.w, h: r.h };
          if (axis === 'x') next.left = v;
          else if (axis === 'y') next.top = v;
          else if (axis === 'w') { const ar = r.h ? r.w / r.h : 1; next.w = v; if (keepAspect && ar) next.h = Math.round(v / ar); }
          else { const ar = r.w ? r.h / r.w : 1; next.h = v; if (keepAspect && ar) next.w = Math.round(v / ar); }
          setGeomNow(s, c, l, next); store.notify();
        },
      }),
      el('span', { class: 'nunit hint', text: axis === 'x' || axis === 'w' ? `/${sw}` : `/${sh}` }));
  }
  /** A checkbox over a plain 0/1 variable (Midra's equivalent of a PRflg bit). */
  function boolVar(label, mnem, idx) {
    if (!store.byMnem.has(mnem)) return null;
    const on = store.val(mnem, ...idx) === 1;
    return el('label', { class: 'cbox' },
      el('input', { type: 'checkbox', checked: on || null, onchange: (e) => store.set(mnem, idx, e.target.checked ? 1 : 0) }),
      el('span', { text: label }));
  }
  /** A checkbox over one bit of PRflg. */
  function flagBox(label, s, c, l, bit) {
    if (!store.byMnem.has('PRflg')) return null;
    const v = store.val('PRflg', s, c, l) ?? 0, on = flagOn(v, bit);
    return el('label', { class: 'cbox' },
      el('input', { type: 'checkbox', checked: on || null, onchange: (e) => store.set('PRflg', [s, c, l], flagSet(v, bit, e.target.checked)) }),
      el('span', { text: label }));
  }

  function inspector() {
    if (!sel) {
      return el('div', { class: 'panel ws-insp' }, el('h2', 'Layer'),
        el('div', { class: 'empty-state', text: 'Select a layer to edit its properties.' }));
    }
    const { s, c, l } = sel, i = [s, c, l];
    const src = store.val('PRinp', ...i) || 0;
    const role = ctxRole(s, c);
    const has = (m) => store.byMnem.has(m);
    const perspective = store.val('PEsps', s) === 1;

    return el('div', { class: 'panel ws-insp' },
      el('div', { class: 'insp-title' },
        el('h2', `L${l + 1}`),
        el('span', { class: 'ws-ctx-tag ' + role }, ctxName(s, c)),
        el('span', { class: 'hint', text: screenLabel(s) }),
        el('div', { class: 'spacer' }),
        el('button', { class: 'ws-mini', title: 'Remove this layer from the preset', onclick: () => clearLayer(s, c, l) }, 'Clear')),

      el('div', { class: 'insp-src' },
        el('label', { class: 'field' }, 'Source', sourceSelect('PRinp', i)),
        el('div', { class: 'row' },
          el('span', { class: 'hint', text: 'Order' }),
          el('button', { class: 'ws-mini', title: 'Bring forward', onclick: () => reorder(s, c, l, 'up') }, '▲'),
          el('button', { class: 'ws-mini', title: 'Send back', onclick: () => reorder(s, c, l, 'down') }, '▼'),
          el('div', { class: 'spacer' }),
          has('SLstu') ? el('span', { class: 'hint', title: 'Layer status reported by the device',
            text: 'status: ' + (LAYER_STATUSES[store.val('SLstu', s, l) ?? 0] || '·').toLowerCase() }) : null)),

      section('geom', 'Position / size',
        el('div', { class: 'nrow' }, geomField('X', s, c, l, 'x'), geomField('Y', s, c, l, 'y')),
        el('div', { class: 'nrow' }, geomField('Width', s, c, l, 'w'), geomField('Height', s, c, l, 'h')),
        el('div', { class: 'row wrap' },
          el('label', { class: 'cbox' },
            el('input', { type: 'checkbox', checked: keepAspect || null, onchange: (e) => { keepAspect = e.target.checked; store.notify(); } }),
            el('span', { text: 'Keep aspect' })),
          el('div', { class: 'spacer' }),
          el('button', { class: 'ws-mini', title: WORK_AREA.has(s) ? 'Fill the working area' : 'Fill the screen', onclick: () => { const a = workPx(s); setGeomNow(s, c, l, { left: a.x, top: a.y, w: a.w, h: a.h }); store.notify(); } }, WORK_AREA.has(s) ? 'Area size' : 'Screen size'),
          el('button', { class: 'ws-mini', title: "Size to the source's own resolution", onclick: () => contentSize(s, c, l) }, 'Content size')),
        el('div', { class: 'row' },
          el('span', { class: 'hint', text: 'Place' }),
          el('div', { class: 'pos9' }, ...Array.from({ length: 9 }, (_, k) =>
            el('button', { title: 'Move here', onclick: () => place(s, c, l, k) })))),
        el('div', { class: 'row wrap' },
          el('span', { class: 'hint', text: 'Aspect' }),
          ...[['5:4', 5 / 4], ['4:3', 4 / 3], ['16:10', 16 / 10], ['15:9', 15 / 9], ['16:9', 16 / 9], ['21:9', 21 / 9]]
            .map(([lbl, ar]) => el('button', { class: 'ws-mini', onclick: () => setAspect(s, c, l, ar) }, lbl))),
        perspective && has('PRpoz') ? num('Depth (Z)', 'PRpoz', i) : null,
        perspective && has('PRroz') ? el('div', { class: 'nrow' }, num('Rotate X', 'PRroh', i), num('Rotate Y', 'PRrov', i), num('Rotate Z', 'PRroz', i)) : null),

      section('transp', 'Transparency',
        bind('Layer opacity', 'PRalp', i, null, null, 1,
          v => Math.round(v / (store.byMnem.get('PRalp')?.max || 256) * 100) + '%'),
        has('MAsla') ? bind('Master fader', 'MAsla', [s, l], 0, 255, 1, v => Math.round(v / 255 * 100) + '%') : null,
        has('MAsfa') ? el('div', { class: 'row' },
          el('span', { class: 'hint', text: 'Auto fade' }),
          el('button', { class: 'ws-mini', onclick: () => store.set('MAsfa', [s, l], 1) }, 'Fade in'),
          el('button', { class: 'ws-mini', onclick: () => store.set('MAsfa', [s, l], 2) }, 'Fade out')) : null),

      section('crop', 'Cropping',
        el('div', { class: 'nrow' }, num('Pos H', 'PRcph', i, { step: 16 }), num('Size H', 'PRcsh', i, { step: 16 })),
        el('div', { class: 'nrow' }, num('Pos V', 'PRcpv', i, { step: 16 }), num('Size V', 'PRcsv', i, { step: 16 })),
        has('PRaov') ? el('label', { class: 'field' }, 'Aspect override', enumSelect('PRaov', i, ASPECT_OVERRIDES)) : null,
        el('button', { class: 'ws-mini', title: 'Remove the crop', onclick: () => { store.set('PRcph', i, 32768); store.set('PRcpv', i, 32768); store.set('PRcsh', i, 0); store.set('PRcsv', i, 0); } }, 'Reset crop')),

      section('border', 'Border',
        el('div', { class: 'row' },
          el('label', { class: 'field' }, 'Style',
            enumSelect('PRbst', i, enumLabels('PRbst', isMidra() ? MIDRA_BORDER_STYLES : BORDER_STYLES))),
          el('label', { class: 'field' }, 'Colour', colorPicker('PRbcr', 'PRbcg', 'PRbcb', i))),
        el('div', { class: 'nrow' }, num('Width', 'PRbsh', i), num('Height', 'PRbsv', i)),
        bind('Border opacity', 'PRbal', i, null, null, 1, v => Math.round(v / 255 * 100) + '%'),
        has('PRshp') ? el('label', { class: 'field' }, 'Shadow position', enumSelect('PRshp', i, SHADOW_POSITIONS)) : null,
        has('PRflg') ? flagBox('Rounded corners', s, c, l, PE_FLAG.ROUND_BORDER_CORNER) : null,
        has('CTsbc') ? bind('Corner radius (global)', 'CTsbc', [], 0, 250, 1) : null),

      section('trans', 'Transitions',
        el('div', { class: 'row' },
          el('label', { class: 'field' }, 'Opening', enumSelect('PRotr', i, enumLabels('PRotr', TRANSITIONS))),
          el('label', { class: 'field' }, 'Direction', enumSelect('PRowa', i, enumLabels('PRowa', TRANSITION_WAYS)))),
        el('div', { class: 'row' },
          el('label', { class: 'field' }, 'Closing', enumSelect('PRctr', i, enumLabels('PRctr', TRANSITIONS))),
          el('label', { class: 'field' }, 'Direction', enumSelect('PRcwa', i, enumLabels('PRcwa', TRANSITION_WAYS))))),

      // Midra gives each layer its own opening/closing duration; LiveCore instead slides
      // the layer's window inside the screen's overall take duration.
      has('PRodu')
        ? section('timing', 'Timing',
          bind('Opening', 'PRodu', i, 0, 255, 1, v => (v / 10).toFixed(1) + 's'),
          bind('Closing', 'PRcdu', i, 0, 255, 1, v => (v / 10).toFixed(1) + 's'))
        : section('timing', 'Timing & speed',
          el('div', { class: 'nrow' }, num('Open start', 'PRoso', i), num('Open end', 'PRoeo', i)),
          el('div', { class: 'nrow' }, num('Close start', 'PRcso', i), num('Close end', 'PRceo', i)),
          el('div', { class: 'hint', text: 'Offsets sit inside the take duration, so a layer can lead or trail the others.' }),
          bind('Speed point 1', 'PRtba', i, 0, 255, 1),
          bind('Speed point 2', 'PRtbb', i, 0, 255, 1)),

      has('PRbah') ? section('fly', 'Flying curve',
        el('div', { class: 'row wrap' },
          flagBox('Bezier 1 point', s, c, l, PE_FLAG.FLY_BEZIER_1PT),
          flagBox('Bezier 2 points', s, c, l, PE_FLAG.FLY_BEZIER_2PT),
          flagBox('Parabolic', s, c, l, PE_FLAG.FLY_BEZIER_DEVIANT)),
        el('div', { class: 'nrow' }, num('Pt1 H', 'PRbah', i, { step: 16 }), num('Pt1 V', 'PRbav', i, { step: 16 })),
        el('div', { class: 'nrow' }, num('Pt2 H', 'PRbbh', i, { step: 16 }), num('Pt2 V', 'PRbbv', i, { step: 16 }))) : null,

      // Midra exposes the same effects as plain variables rather than PRflg bits.
      has('PRflg')
        ? section('effects', 'Effects',
          el('div', { class: 'row wrap' },
            flagBox('Force transition', s, c, l, PE_FLAG.FORCE_TRANSITION),
            flagBox('Force cross-transition', s, c, l, PE_FLAG.FORCE_CROSS),
            flagBox('Smooth move', s, c, l, PE_FLAG.SMOOTH_TRANSITION)),
          el('div', { class: 'row wrap' },
            flagBox('Flip H', s, c, l, PE_FLAG.FLIP_H),
            flagBox('Flip V', s, c, l, PE_FLAG.FLIP_V)),
          el('div', { class: 'row wrap' },
            flagBox('Black & white', s, c, l, PE_FLAG.BLACK_N_WHITE),
            flagBox('Negative', s, c, l, PE_FLAG.NEGATIVE),
            flagBox('Sepia', s, c, l, PE_FLAG.SEPIA),
            flagBox('Solarise', s, c, l, PE_FLAG.SOLAR)),
          has('STsls') ? bind('Strobe', 'STsls', [s, l], 0, 60, 1, v => v ? v + ' fps' : 'off') : null,
          has('Plsgr') ? num('Layer group', 'Plsgr', [s, l]) : null)
        : section('effects', 'Effects',
          el('div', { class: 'row wrap' },
            has('PRftr') ? boolVar('Force transition', 'PRftr', i) : null,
            has('PRsmm') ? boolVar('Smooth move', 'PRsmm', i) : null),
          has('PRfli') ? el('label', { class: 'field' }, 'Flip', enumSelect('PRfli', i, ['None', 'Horizontal', 'Vertical', 'Both'])) : null,
          has('GCfrl') ? el('div', { class: 'row' },
            el('button', {
              class: 'ws-mini' + (store.val('GCfrl', s, l) === 1 ? ' on' : ''),
              onclick: () => store.set('GCfrl', [s, l], store.val('GCfrl', s, l) === 1 ? 0 : 1),
            }, '❄ Freeze layer')) : null));
  }

  // ================= memories =================
  const memFilter = { v: MEM_FILTER_ALL };
  let memScope = 'screen';     // 'screen' | 'master'
  let memSel = null;
  let memSaveMode = false;
  let memScreen = 0;
  let memOpen = true;          // the memory grid folds away to give the canvases room
  let filterOpen = false;

  function memoryBar() {
    if (store.meta?.platform !== 'livecore') return midraMemoryBar();
    if (!store.byMnem.has('PMsav')) return null;
    const N = 144, PER_ROW = 24;
    const isMaster = memScope === 'master';
    const used = (i) => isMaster ? store.val('PSval', i) === 1 : (store.val('PMscw', i) || 0) > 0;
    const grid = el('div', { class: 'ws-mem' });
    for (let i = 0; i < N; i++) {
      const v = used(i), label = readLabel(isMaster ? 'LBPSe' : 'LBPMe', [i]);
      grid.append(el('button', {
        class: 'ws-mslot' + (v ? ' valid' : '') + (memSel === i ? ' sel' : '') + (memSaveMode ? ' arm' : ''),
        title: `${isMaster ? 'Master memory' : 'Memory'} ${i + 1}${label ? ' — ' + label : ''}${v ? '' : ' — empty'}`,
        onclick: () => memClick(i),
      }, el('span', { class: 'num', text: i + 1 }), label ? el('span', { class: 'mlbl', text: label }) : null));
    }
    const chip = (label, on, fn) => el('button', { class: 'ws-mini' + (on ? ' on' : ''), onclick: fn }, label);
    const nFilters = MEM_FILTERS.filter(([, b]) => flagOn(memFilter.v, b)).length;
    return el('div', { class: 'panel ws-membar' + (memOpen ? '' : ' shut') },
      el('div', { class: 'ws-membar-head' },
        el('button', { class: 'ws-mini', title: memOpen ? 'Hide memories' : 'Show memories', onclick: () => { memOpen = !memOpen; store.notify(); } }, memOpen ? '▾' : '▸'),
        el('div', { class: 'seg' },
          el('button', { class: !isMaster ? 'on recall' : '', onclick: () => { memScope = 'screen'; memSel = null; store.notify(); } }, 'Screen'),
          el('button', { class: isMaster ? 'on recall' : '', onclick: () => { memScope = 'master'; memSel = null; store.notify(); } }, 'Master')),
        !isMaster ? screenSelect(memScreen, v => { memScreen = v; store.notify(); }) : null,
        chip(memSaveMode ? 'SAVE — pick a slot' : 'Save mode', memSaveMode, () => { memSaveMode = !memSaveMode; store.notify(); }),
        chip(`Filter: ${nFilters === MEM_FILTERS.length ? 'all' : nFilters}`, filterOpen, () => { filterOpen = !filterOpen; store.notify(); }),
        el('div', { class: 'spacer' }),
        el('span', { class: 'hint', text: isMaster ? 'a master memory recalls every screen at once' : 'click loads to preview · save mode stores the on-air look' })),
      filterOpen ? el('div', { class: 'ws-filters' },
        ...MEM_FILTERS.map(([label, bit]) =>
          chip(label, flagOn(memFilter.v, bit), () => { memFilter.v = flagSet(memFilter.v, bit, !flagOn(memFilter.v, bit)); store.notify(); })),
        chip('All', memFilter.v === MEM_FILTER_ALL, () => { memFilter.v = MEM_FILTER_ALL; store.notify(); })) : null,
      memOpen ? grid : null,
      memOpen && memSel != null ? memDetail(memSel, isMaster) : null);
  }

  function memClick(i) {
    const isMaster = memScope === 'master';
    memSel = i;
    if (memSaveMode) { isMaster ? saveMaster(i) : saveScreenMem(i); memSaveMode = false; }
    else { isMaster ? loadMaster(i, false) : loadScreenMem(i, false); }
    store.notify();
  }
  function saveScreenMem(i) {
    store.set('PMscf', [], memScreen);
    store.set('PMprf', [], 0);              // save the bank that is on air
    store.set('PMmet', [], i);
    store.set('PMsav', [], 1);
    setTimeout(() => { store.get('PMscw', [i]); store.get('PMmly', [i]); fetchLabel('LBPMe', [i]); }, 400);
    flash(`Saved ${screenLabel(memScreen)} program into memory ${i + 1}`);
  }
  function loadScreenMem(i, andTake) {
    store.set('PMcat', [], memFilter.v);
    store.set('PMscf', [], memScreen);
    store.set('PMprf', [], 1);              // land it in the bank that is not on air
    store.set('PMmet', [], i);
    store.set(andTake ? 'PMlot' : 'PMloa', [], 1);
    setTimeout(() => { for (let l = 0; l < layerSlots(); l++) for (const c of [0, 1]) for (const m of ['PRinp', 'PRpoh', 'PRpov', 'PRsih', 'PRsiv']) store.get(m, [memScreen, c, l]); store.scan('GCsta'); }, 500);
    flash(`${andTake ? 'Loaded + took' : 'Loaded to preview'} memory ${i + 1}`);
  }
  function saveMaster(i) {
    store.set('PSprf', [], 0);
    store.set('PSmet', [], i);
    store.set('PSsav', [], 1);
    setTimeout(() => { store.get('PSval', [i]); fetchLabel('LBPSe', [i]); }, 400);
    flash(`Saved every screen into master memory ${i + 1}`);
  }
  function loadMaster(i, andTake) {
    store.set('PSmet', [], i);
    store.set('PSprf', [], 1);
    store.set(andTake ? 'PSlot' : 'PSloa', [], 1);
    setTimeout(() => { enter(); store.notify(); }, 600);
    flash(`${andTake ? 'Loaded + took' : 'Loaded to preview'} master memory ${i + 1}`);
  }
  function eraseMem(i, isMaster) {
    if (isMaster) { store.set('PSmet', [], i); store.set('PSres', [], 1); setTimeout(() => store.get('PSval', [i]), 400); }
    else { store.set('PMmet', [], i); store.set('PMres', [], 1); setTimeout(() => store.get('PMscw', [i]), 400); }
    flash(`Erased ${isMaster ? 'master ' : ''}memory ${i + 1}`);
  }
  function memDetail(i, isMaster) {
    const lm = isMaster ? 'LBPSe' : 'LBPMe';
    const valid = isMaster ? store.val('PSval', i) === 1 : (store.val('PMscw', i) || 0) > 0;
    return el('div', { class: 'ws-memdetail' },
      el('span', { class: 'ws-memname', text: `${isMaster ? 'Master memory' : 'Memory'} ${i + 1}` }),
      el('input', {
        id: 'memlabel', type: 'text', class: 'lbl-in', maxlength: LABEL_LEN,
        placeholder: 'label', value: readLabel(lm, [i]),
        onchange: (e) => { writeLabel(lm, [i], e.target.value); setTimeout(() => fetchLabel(lm, [i]), 300); },
      }),
      el('div', { class: 'spacer' }),
      valid ? el('button', { class: 'btn recall', onclick: () => isMaster ? loadMaster(i, false) : loadScreenMem(i, false) }, 'Load to preview') : null,
      valid ? el('button', { class: 'btn take', onclick: () => isMaster ? loadMaster(i, true) : loadScreenMem(i, true) }, 'Load + take') : null,
      el('button', { class: 'btn save', onclick: () => isMaster ? saveMaster(i) : saveScreenMem(i) }, 'Save here'),
      valid ? el('button', { class: 'btn ghost', onclick: () => eraseMem(i, isMaster) }, 'Erase') : null);
  }

  // Midra keeps eight presets in the unit itself (the RCS2's other 56 slots live on the
  // control computer, not the device). Save is a device request; recall re-applies the
  // stored geometry to the preview context, which a take then commits.
  function midraMemoryBar() {
    if (!store.byMnem.has('PMpst')) return null;
    const N = 8;
    const grid = el('div', { class: 'ws-mem' });
    for (let i = 0; i < N; i++) {
      const v = store.val('PMpst', i) === 1;
      grid.append(el('button', {
        class: 'ws-mslot' + (v ? ' valid' : '') + (memSel === i ? ' sel' : '') + (memSaveMode ? ' arm' : ''),
        title: `Preset ${i + 1}${v ? '' : ' — empty'}`,
        onclick: () => {
          memSel = i;
          if (memSaveMode) { saveMidra(i); memSaveMode = false; }
          else if (v) { ensureMidraSlot(i); setTimeout(() => recallMidra(i), 450); }
          store.notify();
        },
      }, el('span', { class: 'num', text: i + 1 })));
    }
    const used = store.val('PMpst', memSel) === 1;
    return el('div', { class: 'panel ws-membar' },
      el('div', { class: 'ws-membar-head' },
        el('h2', 'Presets'),
        el('button', { class: 'ws-mini' + (memSaveMode ? ' on' : ''), onclick: () => { memSaveMode = !memSaveMode; store.notify(); } },
          memSaveMode ? 'SAVE — pick a slot' : 'Save mode'),
        el('div', { class: 'spacer' }),
        el('span', { class: 'hint', text: 'eight presets live in the unit · click one to load it into preview' })),
      grid,
      memSel != null ? el('div', { class: 'ws-memdetail' },
        el('span', { class: 'ws-memname', text: `Preset ${memSel + 1}` }),
        el('div', { class: 'spacer' }),
        used ? el('button', { class: 'btn recall', onclick: () => { ensureMidraSlot(memSel); setTimeout(() => recallMidra(memSel), 450); } }, 'Load to preview') : null,
        used ? el('button', { class: 'btn take', onclick: () => { ensureMidraSlot(memSel); setTimeout(() => { recallMidra(memSel); setTimeout(() => doTake(0, ttime), 300); }, 450); } }, 'Load + take') : null,
        el('button', { class: 'btn save', onclick: () => saveMidra(memSel) }, 'Save here'),
        used && store.byMnem.has('CTpmr') ? el('button', {
          class: 'btn ghost',
          onclick: () => { store.set('CTpmr', [memSel], 1); setTimeout(() => store.get('PMpst', [memSel]), 400); flash(`Erased preset ${memSel + 1}`); },
        }, 'Erase') : null) : null);
  }
  function saveMidra(i) {
    store.set('GCsrq', [2, i], 1);
    setTimeout(() => store.get('PMpst', [i]), 400);
    flash(`Stored the live layout in preset ${i + 1}`);
  }
  /** Pull a stored preset's per-layer content so it can be re-applied. */
  function ensureMidraSlot(i) {
    for (let s = 0; s < screenCount(); s++) {
      store.get('PMssh', [i, s]); store.get('PMssv', [i, s]); store.get('PMsml', [i, s]);
      for (let l = 0; l < layerSlots(); l++)
        for (const m of ['PMinp', 'PMpoh', 'PMpov', 'PMsih', 'PMsiv', 'PMalp']) store.get(m, [i, s, l]);
    }
  }
  function recallMidra(i) {
    if (store.byMnem.has('CTpmu')) store.set('CTpmu', [], 1);   // let preview edits stick
    const c = 1;
    for (let s = 0; s < screenCount(); s++)
      for (let l = 0; l < layerSlots(); l++) {
        const src = store.val('PMinp', i, s, l);
        if (src == null) continue;
        store.set('PRsih', [s, c, l], store.val('PMsih', i, s, l) || 0);
        store.set('PRsiv', [s, c, l], store.val('PMsiv', i, s, l) || 0);
        store.set('PRpoh', [s, c, l], store.val('PMpoh', i, s, l) ?? B);
        store.set('PRpov', [s, c, l], store.val('PMpov', i, s, l) ?? B);
        if (store.byMnem.has('PMalp')) store.set('PRalp', [s, c, l], store.val('PMalp', i, s, l) ?? 255);
        store.set('PRinp', [s, c, l], src);
      }
    flash(`Loaded preset ${i + 1} into preview`);
  }

  // ================= page =================
  function render() {
    const all = active();
    const screens = all.filter(s => !hidden.has(s));
    requestAnimationFrame(fitCanvases);
    return el('div', { class: 'ws-page' },
      el('div', { class: 'panel ws-bar' },
        el('div', { class: 'ws-toggles' },
          el('span', { class: 'ws-bar-lbl', text: 'Show' }),
          el('button', { class: 'ws-tog pgm' + (showLive ? ' on' : ''), onclick: () => { if (showLive && !showEdit) return; showLive = !showLive; store.notify(); } }, 'Program'),
          el('button', { class: 'ws-tog pvw' + (showEdit ? ' on' : ''), onclick: () => { if (showEdit && !showLive) return; showEdit = !showEdit; store.notify(); } }, 'Preview')),
        all.length > 1 ? el('div', { class: 'ws-toggles' },
          el('span', { class: 'ws-bar-lbl', text: 'Screens' }),
          ...all.map(s => el('button', {
            class: 'ws-tog' + (!hidden.has(s) ? ' on' : ''),
            title: (hidden.has(s) ? 'Show ' : 'Hide ') + screenLabel(s),
            onclick: () => { if (hidden.has(s)) hidden.delete(s); else if (screens.length > 1) hidden.add(s); store.notify(); },
          }, `${s + 1}`))) : null,
        el('label', { class: 'field slider ws-ttime' },
          el('span', {}, 'Take time', el('b', { class: 'sv', text: (ttime / 1000).toFixed(1) + 's' })),
          el('input', {
            type: 'range', min: 0, max: 3000, step: 100, value: ttime,
            onpointerdown: beginDrag, onpointerup: endDrag, onpointercancel: endDrag,
            oninput: (e) => { ttime = +e.target.value; e.target.parentNode.querySelector('.sv').textContent = (ttime / 1000).toFixed(1) + 's'; },
          })),
        flashMsg ? el('span', { class: 'ws-flash', text: flashMsg }) : null,
        el('div', { class: 'spacer' }),
        el('button', { class: 'btn pvw', onclick: () => screens.forEach(s => doCut(s)) }, 'Cut all'),
        el('button', { class: 'btn pgm', onclick: () => screens.forEach(s => doTake(s, ttime)) }, 'Take all')),
      el('div', { class: 'ws-body' },
        sourceRail(),
        el('div', { class: 'ws-screens' },
          ...(screens.length ? screens.map(screenCard)
            : [el('div', { class: 'panel' }, el('div', { class: 'empty-state', text: 'No screens configured — set one up in the Screens view.' }))])),
        inspector()),
      memoryBar());
  }
  return { enter, render };
})();

// ---------- Audio (Midra) ----------
VIEWS.audio = (() => {
  const NIN = 25, NOUT = 2;
  let inputs = null;   // per-input audio channel control: null=unprobed, true/false (some models omit it)
  function enter() {
    for (const m of ['AUomv', 'AUoba', 'AUomu', 'AUoim', 'AUode', 'AUoci']) if (store.byMnem.has(m)) store.scan(m);
    if (inputs === null) {
      const mark = store.log.length;
      store.get('AUile', [0]);
      setTimeout(() => {
        inputs = !store.log.slice(mark).some(e => e.dir === 'er');
        if (inputs) for (const m of ['AUaia', 'AUile', 'AUiba', 'AUiim', 'AUimu']) store.scan(m);
        store.notify();
      }, 400);
    } else if (inputs) {
      for (const m of ['AUaia', 'AUile', 'AUiba', 'AUiim', 'AUimu']) store.scan(m);
    }
  }
  function outCard(o) {
    const inp = store.val('AUoci', o);
    return el('div', { class: 'panel' },
      el('div', { class: 'row' }, el('h2', `Output ${o + 1}`), el('div', { class: 'spacer' }),
        el('span', { class: 'hint', text: inp ? `from input ${inp}` : 'no input' }),
        toggleBtn('Mute', 'AUomu', [o], 'pgm')),
      bind('Master volume', 'AUomv', [o], 0, 192, 1, v => Math.round(v / 192 * 100) + '%'),
      el('div', { class: 'grid2' },
        bind('Balance', 'AUoba', [o], 0, 90, 1, v => v === 45 ? 'C' : (v < 45 ? 'L' + (45 - v) : 'R' + (v - 45))),
        bind('Delay', 'AUode', [o], 0, 80, 1, v => v + ' ms')),
      el('label', { class: 'field' }, 'Mono', checkbox(store.val('AUoim', o) === 1, v => store.set('AUoim', [o], v ? 1 : 0))));
  }
  function inRow(i) {
    const avail = store.val('AUaia', i) === 1;
    const bal = store.val('AUiba', i) ?? 45;
    return el('tr', { class: avail ? '' : 'dim' },
      el('td', { text: 'IN ' + (i + 1) }),
      el('td', boolChip(avail ? 1 : 0, 'present', '—')),
      el('td', { style: 'min-width:200px' }, bind('', 'AUile', [i], 0, 255, 1, v => Math.round(v / 255 * 100) + '%')),
      el('td', { class: 'val', text: bal === 45 ? 'C' : (bal < 45 ? 'L' + (45 - bal) : 'R' + (bal - 45)) }),
      el('td', boolChip(store.val('AUiim', i) === 1 ? 1 : 0, 'mono', 'st')),
      el('td', toggleBtn('Mute', 'AUimu', [i], 'pgm')));
  }
  function render() {
    const shown = inputs ? Array.from({ length: NIN }, (_, i) => i).filter(i => store.val('AUaia', i) === 1) : [];
    return el('div', {},
      el('div', { class: 'view-head' }, el('h1', { text: 'Audio' }),
        el('span', { class: 'hint', text: `${NOUT} outputs${inputs ? ` · ${shown.length} input channels` : ''}` })),
      el('div', { class: 'split-wide' }, ...Array.from({ length: NOUT }, (_, o) => outCard(o))),
      inputs
        ? el('div', { class: 'panel', style: 'overflow:auto' }, el('h2', 'Input channels'),
          el('table', { class: 'grid' },
            el('thead', el('tr', ...['Input', 'Signal', 'Level', 'Balance', 'Mode', ''].map(h => el('th', { text: h })))),
            el('tbody', ...(shown.length ? shown : []).map(inRow))))
        : inputs === false
        ? el('div', { class: 'panel' }, el('div', { class: 'empty-state', text: 'This unit exposes audio-output control only.' }))
        : null);
  }
  return { enter, render };
})();

// ---------- GPIO ----------
VIEWS.gpio = (() => {
  const NIN = 2, NOUT = 10;
  const MODES = ['Disabled', 'Take', 'Custom'];
  function enter() {
    for (const m of ['GPiav', 'GPist', 'GPipo', 'GPimo']) store.scan(m);
    for (let i = 0; i < NIN; i++) for (let s = 0; s < 8; s++) store.get('GPits', [i, s]);
    for (const m of ['GPoav', 'GPopo', 'GPomo', 'GPofa']) store.scan(m);
  }
  function inRow(i) {
    const avail = store.val('GPiav', i) === 1;
    const scr = Array.from({ length: 8 }, (_, s) => store.val('GPits', i, s) === 1 ? s + 1 : null).filter(Boolean);
    return el('tr', { class: avail ? '' : 'dim' },
      el('td', { text: 'GPI ' + (i + 1) }),
      el('td', boolChip(avail ? 1 : 0, 'present', 'none')),
      el('td', boolChip(store.val('GPist', i), 'high', 'low')),
      el('td', toggleBtn('Invert', 'GPipo', [i], 'pgm')),
      el('td', { class: 'val', text: scr.length ? 'takes ' + scr.join(',') : '—' }));
  }
  function outRow(i) {
    const avail = store.val('GPoav', i) === 1;
    const cmd = store.val('GPofa', i) === 1;
    return el('tr', { class: avail ? '' : 'dim' },
      el('td', { text: 'GPO ' + (i + 1) }),
      el('td', boolChip(avail ? 1 : 0, 'present', 'none')),
      el('td', el('label', { class: 'field' }, '', enumSelect('GPomo', [i], MODES))),
      el('td', toggleBtn('Invert', 'GPopo', [i], 'pgm')),
      el('td', el('button', { class: 'btn ghost' + (cmd ? ' pgm' : ''), onclick: () => store.set('GPofa', [i], cmd ? 0 : 1) }, 'Fire')));
  }
  function render() {
    return el('div', {},
      el('div', { class: 'view-head' }, el('h1', { text: 'GPIO' }), el('span', { class: 'hint', text: 'Trigger inputs and tally/relay outputs' })),
      el('div', { class: 'split' },
        el('div', { class: 'panel', style: 'overflow:auto' }, el('h2', 'Inputs'),
          el('table', { class: 'grid' },
            el('thead', el('tr', ...['GPI', 'Port', 'State', 'Polarity', 'Action'].map(h => el('th', { text: h })))),
            el('tbody', ...Array.from({ length: NIN }, (_, i) => inRow(i))))),
        el('div', { class: 'panel', style: 'overflow:auto' }, el('h2', 'Outputs'),
          el('table', { class: 'grid' },
            el('thead', el('tr', ...['GPO', 'Port', 'Mode', 'Polarity', ''].map(h => el('th', { text: h })))),
            el('tbody', ...Array.from({ length: NOUT }, (_, i) => outRow(i)))))));
  }
  return { enter, render };
})();

// ---------- System ----------
VIEWS.system = (() => {
  function enter() {
    for (const m of ['DIdsn', 'DIdre', 'ITlpo', 'ITldp', 'TEdal', 'FAalm', 'VEvar', 'CTloc', 'CTkbr'])
      store.get(m, store.byMnem.get(m)?.dims.length ? [0] : []);
    for (let k = 0; k < 4; k++) { store.get('ITlip', [0, k]); store.get('ITlnk', [0, k]); store.get('ITlgw', [0, k]); }
    store.get('TEcar', [0, 0]); store.get('VEmic', [0, 0]);
  }
  // read a var at its natural zero-index (scalar on Midra, [0] on LiveCore)
  const idv = (m) => { const d = store.byMnem.get(m); return d ? store.val(m, ...d.dims.map(() => 0)) : null; };
  function kv(label, value) {
    return el('div', { class: 'kv' }, el('span', { class: 'k', text: label }), el('span', { class: 'v val', text: value }));
  }
  function render() {
    const lock = store.val('CTloc', 0);
    const dhcp = store.val('ITldp', 0) === 1;
    return el('div', {},
      el('div', { class: 'view-head' }, el('h1', { text: 'System' }), el('span', { class: 'hint', text: 'Device, network and status' })),
      el('div', { class: 'split' },
        el('div', { class: 'panel' }, el('h2', 'Device'),
          kv('Model', deviceModel()),
          kv('Serial', fmt(idv('DIdsn'))),
          kv('Reference', fmt(idv('DIdre'))),
          kv('Firmware var', fmt(idv('VEvar'))),
          kv('Micro ver', fmt(store.val('VEmic', 0, 0)))),
        el('div', { class: 'panel' }, el('h2', 'Network'),
          kv('IP address', fmtIP(0)),
          kv('Netmask', [0, 1, 2, 3].map(k => store.val('ITlnk', 0, k)).every(x => x != null) ? [0, 1, 2, 3].map(k => store.val('ITlnk', 0, k)).join('.') : '·'),
          kv('Gateway', [0, 1, 2, 3].map(k => store.val('ITlgw', 0, k)).every(x => x != null) ? [0, 1, 2, 3].map(k => store.val('ITlgw', 0, k)).join('.') : '·'),
          kv('Port', fmt(store.val('ITlpo', 0))),
          el('div', { class: 'kv' }, el('span', { class: 'k', text: 'DHCP' }), boolChip(dhcp ? 1 : 0, 'on', 'off')))),
      el('div', { class: 'split' },
        el('div', { class: 'panel' }, el('h2', 'Health'),
          el('div', { class: 'kv' }, el('span', { class: 'k', text: 'Temperature' }), alarmChip(nz(store.val('TEdal', 0)))),
          el('div', { class: 'kv' }, el('span', { class: 'k', text: 'Fans' }), alarmChip(nz(store.val('FAalm', 0)))),
          kv('Card temp', temp(store.val('TEcar', 0, 0)))),
        el('div', { class: 'panel' }, el('h2', 'Control'),
          el('div', { class: 'row' },
            el('label', { class: 'field' }, 'Front-panel lock',
              el('div', { class: 'seg' },
                el('button', { class: lock === 0 ? 'on recall' : '', onclick: () => store.set('CTloc', [], 0) }, 'Unlocked'),
                el('button', { class: lock === 1 ? 'on take' : '', onclick: () => store.set('CTloc', [], 1) }, 'Locked'))),
            store.byMnem.get('CTkbr') ? bind('Key brightness', 'CTkbr', [], 10, 100) : null))));
  }
  return { enter, render };
})();

// ---------- Inspector (data-driven variable browser) ----------
VIEWS.inspector = (() => {
  let q = '';
  function render() {
    const matches = [];
    if (store.meta) {
      const needle = q.toLowerCase();
      for (const v of store.byMnem.values()) {
        if (!needle || v.m.toLowerCase().includes(needle) || v.name.toLowerCase().includes(needle) || v.group.toLowerCase().includes(needle)) {
          matches.push(v);
          if (matches.length > 200) break;
        }
      }
    }
    const rows = matches.map(v => {
      const cur = store.val(v.m, ...v.dims.map(() => 0));
      return el('tr', {},
        el('td', { text: v.m }),
        el('td', { style: 'font-family:var(--sans)', text: v.name }),
        el('td', { class: 'val', text: v.dims.length ? '[' + v.dims.join(',') + ']' : '·' }),
        el('td', { class: 'val', text: `${v.min}…${v.max}` }),
        el('td', { class: 'val', text: cur == null ? '·' : cur }),
        el('td', {},
          el('button', { class: 'btn ghost', onclick: () => v.dims.length ? store.scan(v.m) : store.get(v.m) }, 'Read'),
          v.ro ? null : el('button', { class: 'btn ghost', style: 'margin-left:6px', onclick: () => {
            const val = prompt(`Set ${v.name} (${v.min}…${v.max})`, cur ?? v.min);
            if (val !== null) store.set(v.m, v.dims.map(() => 0), +val);
          } }, 'Set')));
    });
    return el('div', {},
      el('div', { class: 'view-head' }, el('h1', { text: 'Inspector' }),
        el('span', { class: 'hint', text: 'Every variable the device exposes — search, read, set' })),
      el('div', { class: 'panel' },
        el('div', { class: 'row' },
          el('input', { id: 'insp-search', type: 'text', placeholder: 'search mnemonic / name / group…', value: q, style: 'flex:1',
            oninput: (e) => { q = e.target.value; store.notify(); } }),
          el('span', { class: 'hint', text: `${matches.length}${matches.length > 200 ? '+' : ''} shown` }))),
      el('div', { class: 'panel', style: 'overflow:auto' },
        el('table', { class: 'grid' },
          el('thead', {}, el('tr', {}, ...['Mnem', 'Name', 'Dims', 'Range', 'Value@0', ''].map(h => el('th', { text: h })))),
          el('tbody', {}, ...rows))));
  }
  return { render };
})();

// ---------- Console ----------
VIEWS.console = (() => {
  let input = '';
  function render() {
    const log = el('div', { class: 'log' });
    for (const e of store.log.slice(-300)) {
      log.append(el('div', { class: 'line ' + (e.dir === 'tx' ? 'tx' : e.dir === 'er' ? 'er' : 'rx'), text: (e.dir === 'tx' ? '» ' : e.dir === 'er' ? '✗ ' : '« ') + e.text }));
    }
    requestAnimationFrame(() => { log.scrollTop = log.scrollHeight; });
    return el('div', {},
      el('div', { class: 'view-head' }, el('h1', { text: 'Console' }),
        el('span', { class: 'hint', text: 'Raw protocol — sent and received frames' })),
      el('div', { class: 'console' }, log,
        el('div', { class: 'row' },
          el('input', { id: 'con-input', type: 'text', placeholder: 'raw line, e.g.  0,VEvar', value: input, style: 'flex:1',
            oninput: (e) => input = e.target.value,
            onkeydown: (e) => { if (e.key === 'Enter' && input.trim()) { store.raw(input.trim()); input = ''; e.target.value = ''; store.notify(); } } }),
          el('button', { class: 'btn', onclick: () => { if (input.trim()) { store.raw(input.trim()); store.notify(); } } }, 'Send'))));
  }
  return { render };
})();

// ---------- Tailnet ----------
//
// Present only on a bridge started with --tailnet: an appliance that owns the
// box it runs on. On any ordinary install this view does not exist, because
// connecting and disconnecting the host's VPN is not something a control
// surface for a video processor should be able to do.
//
// The question it answers, in this order: what is this panel called on the
// tailnet, is it on, and if not, which reason. That is otherwise unanswerable
// from a box with a touchscreen, no keyboard and no shell.
//
// Text entry is a tapped keyboard for the same reason the Connection view uses
// a keypad — there is no physical one. Auth keys are long, so the honest advice
// is in the hint: seed the key at build time, or use the CLI over SSH. This is
// the path for when neither happened and somebody is standing in front of it.
VIEWS.tailnet = (() => {
  let field = null;              // 'name' | 'key' | null — which pad is open
  let entry = '';
  let shift = false;
  let asked = false;

  function enter() {
    // One status request per visit. The server broadcasts every change after
    // that, so polling would only add traffic to a box that has better uses
    // for it.
    if (!asked) { asked = true; store.tailnet('status'); }
  }

  const open = (which) => {
    field = which;
    entry = which === 'name' ? (store.tailnetStatus?.name || '').split('.')[0] : '';
    shift = false;
    store.notify();
  };
  const close = () => { field = null; entry = ''; store.notify(); };

  const tap = (ch) => { if (entry.length < 200) entry += ch; store.notify(); };
  const back = () => { entry = entry.slice(0, -1); store.notify(); };

  // A tapped keyboard. Digits and lower case cover a hostname; Shift and the
  // symbol row exist for auth keys, which are mixed case with hyphens.
  function textpad() {
    const rows = field === 'name'
      ? ['1234567890', 'qwertyuiop', 'asdfghjkl', 'zxcvbnm-']
      : ['1234567890', 'qwertyuiop', 'asdfghjkl', 'zxcvbnm-_'];
    return el('div', { class: 'textpad' },
      rows.map(r => el('div', { class: 'textpad-row' },
        [...r].map(c => el('button', {
          class: 'key', onclick: () => tap(shift ? c.toUpperCase() : c),
        }, shift ? c.toUpperCase() : c)))),
      el('div', { class: 'textpad-row' },
        el('button', { class: shift ? 'key on' : 'key', onclick: () => { shift = !shift; store.notify(); } }, '⇧'),
        el('button', { class: 'key wide', onclick: back }, '⌫'),
        el('button', { class: 'key wide', onclick: () => { entry = ''; store.notify(); } }, 'Clear')));
  }

  function editor() {
    const isName = field === 'name';
    return el('div', { class: 'panel' },
      el('h2', isName ? 'Rename this panel' : 'Auth key'),
      el('div', { class: 'addr-display', text: entry || '—' }),
      textpad(),
      el('div', { class: 'hint pad', text: isName
        ? 'Letters, digits and hyphens. This becomes the name you reach it by.'
        : 'Starts with tskey-. Long to tap: prefer seeding it into the image, or use the CLI over SSH.' }),
      el('div', { class: 'row' },
        el('button', { class: 'btn', onclick: close }, 'Cancel'),
        el('button', {
          class: 'btn primary big', disabled: !entry.trim() || store.tailnetBusy,
          onclick: () => { store.tailnet(isName ? 'hostname' : 'up', entry.trim()); close(); },
        }, isName ? 'Rename' : 'Join')));
  }

  function statusPanel() {
    const st = store.tailnetStatus;
    const state = st?.state || '';
    const on = state === 'Running';
    // Every one of these means something different, and "not connected" for all
    // of them is what makes this hard to diagnose from the far end.
    const explain = {
      Running: 'On the tailnet.',
      NeedsLogin: 'Logged out — this panel has no identity yet. Join it with an auth key.',
      Stopped: 'Disconnected. It still has its identity, so Connect brings it straight back.',
      NoState: 'The daemon is running but has never joined.',
      '': 'tailscaled is not answering. That is a different fault from being logged out — the service may not be running.',
    }[state] ?? state;

    return el('div', { class: 'panel' }, el('h2', 'This panel'),
      el('div', { class: 'row' },
        el('div', { class: 'chip ' + (on ? 'on' : 'off') },
          el('span', { class: 'dot' }), on ? 'ONLINE' : (state || 'UNKNOWN'))),
      el('div', { class: 'kv' },
        el('div', { class: 'k', text: 'name' }),
        el('div', { class: 'v', text: st?.name || '—' })),
      el('div', { class: 'kv' },
        el('div', { class: 'k', text: 'address' }),
        el('div', { class: 'v', text: st?.addr || '—' })),
      el('div', { class: 'hint pad', text: explain }),
      store.tailnetErr
        ? el('div', { class: 'hint pad bad', text: store.tailnetErr })
        : null);
  }

  function actions() {
    const st = store.tailnetStatus;
    const on = st?.state === 'Running';
    const busy = store.tailnetBusy;
    return el('div', { class: 'panel' }, el('h2', 'Actions'),
      el('div', { class: 'row wrap' },
        el('button', { class: 'btn', disabled: busy, onclick: () => store.tailnet('status') },
          busy ? 'Working…' : 'Refresh'),
        on
          ? el('button', { class: 'btn', disabled: busy, onclick: () => store.tailnet('down') }, 'Disconnect')
          : el('button', { class: 'btn primary', disabled: busy, onclick: () => store.tailnet('up') }, 'Connect'),
        el('button', { class: 'btn', disabled: busy, onclick: () => open('name') }, 'Rename'),
        el('button', { class: 'btn', disabled: busy, onclick: () => open('key') }, 'Enter auth key')),
      el('div', { class: 'hint pad', text: on
        ? 'Disconnect keeps this panel’s identity — it does not have to be re-added to the tailnet.'
        : 'Connect reuses the identity this panel already has. Without one, enter an auth key.' }));
  }

  function render() {
    if (field) return el('div', { class: 'view' }, editor());
    return el('div', { class: 'view' },
      el('div', { class: 'split' }, statusPanel(), actions()));
  }

  return { enter, render };
})();

// ---------- Connection ----------
//
// Which processor the bridge talks to, set from the surface itself.
//
// This exists for the appliance: a panel with a touchscreen, no keyboard and no
// shell. Everything here is therefore tappable — the address is entered on a
// keypad rather than in a text field, and the scan list is the path anyone will
// actually use. On a desktop the same view is just a nicer way to retarget than
// restarting the bridge with different arguments.
VIEWS.connection = (() => {
  let entry = null;             // keypad buffer; null until seeded from meta
  let plat = null;              // 'livecore' | 'midra' | 'livepremier'
  let seeded = false;

  const isDemo = () => !!globalThis.OPENRCS_DEMO_DEVICE;

  function enter() {
    if (seeded) return;
    seeded = true;
    entry = store.meta?.device || '';
    plat = store.meta?.platform || 'livecore';
  }

  const tap = (ch) => { if (entry.length < 64) entry += ch; store.notify(); };
  const back = () => { entry = entry.slice(0, -1); store.notify(); };
  const clear = () => { entry = ''; store.notify(); };

  function keypad() {
    const keys = ['1', '2', '3', '4', '5', '6', '7', '8', '9', '.', '0', ':'];
    return el('div', { class: 'keypad' },
      keys.map(k => el('button', { class: 'key', onclick: () => tap(k) }, k)),
      el('button', { class: 'key wide', onclick: back }, '⌫'),
      el('button', { class: 'key wide', onclick: clear }, 'Clear'));
  }

  function platformPicker() {
    const pick = (p) => { plat = p; store.notify(); };
    return el('div', { class: 'seg big' },
      el('button', { class: plat === 'livecore' ? 'on recall' : '', onclick: () => pick('livecore') }, 'LiveCore'),
      el('button', { class: plat === 'midra' ? 'on recall' : '', onclick: () => pick('midra') }, 'Midra'),
      el('button', { class: plat === 'livepremier' ? 'on recall' : '', onclick: () => pick('livepremier') }, 'LivePremier'));
  }

  function foundList() {
    if (store.scanning && store.found.size === 0) {
      return el('div', { class: 'hint pad', text: 'Scanning the local network…' });
    }
    if (store.found.size === 0) {
      return el('div', { class: 'hint pad', text: 'No scan yet. Scan looks for processors on this bridge’s own network.' });
    }
    return el('div', { class: 'found' },
      [...store.found].map(([addr, p]) => el('button', {
        class: 'found-row' + (addr === entry ? ' sel' : ''),
        onclick: () => {
          entry = addr;
          // Trust the greeting when it identified itself; leave the operator's
          // choice alone when it did not.
          if (p) plat = p;
          store.notify();
        },
      },
        el('span', { class: 'addr', text: addr }),
        el('span', { class: 'plat', text: p ? p.toUpperCase() : 'pick platform' }))));
  }

  function statusPanel() {
    const dev = store.meta?.device;
    return el('div', { class: 'panel' }, el('h2', 'Current'),
      el('div', { class: 'kv' },
        el('span', { class: 'k', text: 'Processor' }),
        el('span', { class: 'v val', text: dev || (isDemo() ? 'simulated' : 'not set') })),
      el('div', { class: 'kv' },
        el('span', { class: 'k', text: 'Platform' }),
        // The bridge serves a default variable table before it is configured;
        // reporting that table's platform as the device's would be wrong.
        el('span', { class: 'v val', text: store.configured ? (store.meta?.platform || '').toUpperCase() || '·' : '·' })),
      el('div', { class: 'kv' },
        el('span', { class: 'k', text: 'Link' }),
        el('div', { class: 'chip ' + (store.connected ? 'on' : 'off') },
          el('span', { class: 'dot' }), store.connected ? 'ONLINE' : 'OFFLINE')),
      !store.configured
        ? el('div', { class: 'hint pad', text: 'No processor set. Enter its address, or scan for one.' })
        : null,
      store.configured && !store.connected
        ? el('div', { class: 'hint pad', text: 'Set, but not answering. Check the address, the cabling and that nothing else holds a control session.' })
        : null);
  }

  function render() {
    if (entry === null) enter();
    const canConnect = entry.trim().length > 0 && !isDemo();
    return el('div', {},
      el('div', { class: 'view-head' },
        el('h1', { text: 'Connection' }),
        el('span', { class: 'hint', text: 'Which processor this surface controls' })),
      isDemo()
        ? el('div', { class: 'panel' }, el('h2', 'Demonstration'),
            el('div', { class: 'hint pad', text: 'This is a simulated device in a browser. A real bridge is what connects to a processor, so there is nothing to point anywhere here.' }))
        : null,
      el('div', { class: 'split' },
        statusPanel(),
        el('div', { class: 'panel' }, el('h2', 'Find'),
          el('div', { class: 'row' },
            el('button', {
              class: 'btn', disabled: store.scanning || isDemo(),
              onclick: () => store.discover(),
            }, store.scanning ? 'Scanning…' : 'Scan'),
            el('span', { class: 'hint', text: 'Looks for processors on this bridge’s network' })),
          foundList(),
          // Measured on real hardware: a Pulse2 answers the connection and
          // says nothing. Without this line, a found-but-unlabelled row reads
          // as a half-failure rather than the normal Midra result.
          store.found.size
            ? el('div', { class: 'hint pad', text: 'Not every processor names its platform. Tap one, set the platform, and connect.' })
            : null)),
      el('div', { class: 'split' },
        el('div', { class: 'panel' }, el('h2', 'Address'),
          el('div', { class: 'addr-display', text: entry || '—' }),
          keypad(),
          el('div', { class: 'hint pad', text: 'The control port is added automatically. A hostname needs the bridge’s --device option.' })),
        el('div', { class: 'panel' }, el('h2', 'Platform'),
          platformPicker(),
          el('div', { class: 'hint pad', text: 'LiveCore: Ascender, NeXtage, SmartMatriX Ultra. Midra: Pulse2, Eikos2, Saphyr, SmartMatriX2, QuickMatriX, QuickVu.' }),
          store.setupError
            ? el('div', { class: 'hint pad bad', text: `Rejected: ${store.setupError}` })
            : null,
          el('button', {
            class: 'btn primary big', disabled: !canConnect,
            onclick: () => store.setup(entry.trim(), plat),
          }, 'Connect'))));
  }

  return { enter, render };
})();

render();
