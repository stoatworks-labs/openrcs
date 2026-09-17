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
// Model names an AWJ processor reports for itself. NLC is the family prefix
// on every LivePremier, so that half of the map is by the part that differs;
// a Midra 4K or Alta 4K names itself by model alone.
const AWJ_MODELS = {
  NLC_C: 'Aquilon C', NLC_CPLUS: 'Aquilon C+', NLC_CMAX: 'Aquilon Cmax',
  NLC_CMINI: 'Aquilon Cmini',
  NLC_RS1: 'Aquilon RS1', NLC_RS2: 'Aquilon RS2', NLC_RS3: 'Aquilon RS3',
  NLC_RS4: 'Aquilon RS4', NLC_RS5: 'Aquilon RS5', NLC_RS6: 'Aquilon RS6',
  NLC_RSALPHA: 'Aquilon RS alpha',
  QVU: 'QuickVu 4K', PULSE: 'Pulse 4K', EIKOS: 'Eikos 4K', QMX: 'QuickMatrix 4K',
  ZEN100: 'Zenith 100', ZEN200: 'Zenith 200',
};

function deviceModel() {
  if (isAwj()) {
    const dev = awj().model();
    if (typeof dev !== 'string') return '—';
    return AWJ_MODELS[dev] || dev;
  }
  const pdev = store.val('PDEV');
  if (pdev != null) return MODELS[pdev] || `device ${pdev}`;
  const dev = store.val('DEV');
  if (dev != null && isPls()) return PLS_MODELS[dev] || `PLS device ${dev}`;
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
// The device's own GROUPSTATUS enum continues: 4 COPY FROM DOWN, 5 COPY FROM UP —
// the copy that follows an effect when the preset toggle is off. In both the
// screen is still leaving the bank named, so they sit with the EFFECT states.
const GRP_COPY_FROM_DOWN = 4, GRP_COPY_FROM_UP = 5;
// FADE_AUTO (MAmfa / MAnfa / MAsfa): 0 idle, 1 FADE IN (picture up), 2 FADE OUT
// (to black); ALPHA_STATUS (MAnas / MAsas) names where the alpha is. Both from
// the device's own enumerations, the fade direction confirmed on a NeXtage 16.
const FADE_IN = 1, FADE_OUT = 2;
const ALPHA_STATUS = ['at max', 'at min', 'at level', 'fading in', 'fading out'];
const hasBanks = () => store.byMnem.has('GCsta');
const groupOf = (s) => store.val('Plngr', s) ?? s;
/** Preset index currently on air for a screen (Midra has one program context). */
function liveCtx(s) {
  if (!hasBanks()) return 0;
  const st = store.val('GCsta', groupOf(s));
  return (st === GRP_AT_UP || st === GRP_FROM_UP || st === GRP_COPY_FROM_UP) ? 1 : 0;
}
/** Preset index safe to edit — the one that isn't on air. */
const editCtx = (s) => hasBanks() ? 1 - liveCtx(s) : 1;
const midTransition = (s) => {
  const v = store.val('GCsta', groupOf(s));
  return v === GRP_FROM_DOWN || v === GRP_FROM_UP || v === GRP_COPY_FROM_DOWN || v === GRP_COPY_FROM_UP;
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
// Midra's PRESET_UPDATE_MODE (CTpmu) must be OFF for the take verb to work.
// Measured on a Pulse2 (2026-09-16): with it on, GCtak is accepted, latches at 1
// and transitions nothing, GCtav sits at 0 and every preview edit keeps it
// there; with it off, preview (ctx 1) edits stick just the same and GCtak puts
// them on air. The mode was being switched on here on the belief that preview
// edits needed it — they do not. Leave it off, and make sure of it before a
// take, since the vendor client turns it on when it connects.
function midraEditMode() {
  if (isMidra() && store.byMnem.has('CTpmu') && store.val('CTpmu') !== 0) store.set('CTpmu', [], 0);
}
// A Midra take is the device's own GCtak, which runs each layer's programmed
// transition. It is a level the device drops after the transition — but an
// inert one (see above) leaves it latched at 1, and a 1 written over a 1 is
// nothing — so it is always pulsed 0 then 1.
function midraTake(screen) {
  midraEditMode();
  store.set('GCtak', [screen], 0);
  store.set('GCtak', [screen], 1);
}
// A Midra cut runs the T-bar to its far end: GCtba is 0..10000 and either
// end-to-end move puts the preview on air (the same two-ended bar as
// LiveCore, on a different scale). The bar has to be seen to travel — a single
// write of the far end is ignored, two writes 50 ms apart (the middle, then
// the end) land every time. Proven on the Pulse2 in both directions.
function midraCut(screen) {
  midraEditMode();
  const max = store.byMnem.get('GCtba')?.max ?? 10000;
  const at = store.val('GCtba', screen) ?? 0;
  const to = at >= max / 2 ? 0 : max;
  store.set('GCtba', [screen], Math.round(max / 2));
  setTimeout(() => store.set('GCtba', [screen], to), 50);
}
function doTake(screen, ttime) {
  CONFIDENCE.autoSnapshot('before take');            // opt-in undo point, no-op unless armed
  if (!hasBanks()) {                                   // Midra: one-way take per screen
    if (ttime != null && store.byMnem.has('GCtup')) store.set('GCtup', [screen], ttime);
    midraTake(screen);
    return;
  }
  const g = groupOf(screen), to = editCtx(screen);    // to = bank we're bringing live
  animateTbar(g, to === 1 ? GCTBA_MAX : 0, ttime);
}
/** Cut: jump the bar straight to the target end. */
function doCut(screen) {
  CONFIDENCE.autoSnapshot('before cut');
  if (!hasBanks()) { midraCut(screen); return; }
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
const groupLiveCtx = (g) => { if (!hasBanks()) return 0; const st = store.val('GCsta', g); return (st === GRP_AT_UP || st === GRP_FROM_UP || st === GRP_COPY_FROM_UP) ? 1 : 0; };
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
    this.log = [];                   // {dir, text} — a ring of the last 400
    // Every NAK the device has sent, counted for as long as the page lives.
    // The log above is a ring, so "did anything fail since I marked it" cannot
    // be asked of it once it has wrapped; a capability probe asks this instead.
    this.errCount = 0;
    this.listeners = new Set();
    this._pending = false;
    // Plan mode: while on, sets stage into planState instead of hitting the
    // device, and reads prefer the staged value — so a whole look can be built
    // offline and pushed on connect. Persisted, so a reload keeps staged work.
    // See pushPlan / clearPlan.
    this.plan = false;
    this.planState = new Map();       // "MNEM|i,i" -> staged value
    this.planPaths = new Map();       // AWJ path -> staged value
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
      for (const [k, v] of (p.paths || [])) this.planPaths.set(k, v);
    } catch { /* first run / private mode */ }
  }
  _persistPlan() {
    try { localStorage.setItem('openrcs.plan', JSON.stringify({ on: this.plan, entries: [...this.planState], paths: [...this.planPaths] })); } catch { /* quota/private */ }
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
        this.errCount++;
        this.pushLog('er', `E${m.code}`);
        break;
      case 'status': {
        // A link that comes back after dropping — the bridge's watchdog gave up
        // on a deaf session, or the unit rebooted — has a device whose state
        // may have moved. Ask it who it is again and let the view re-read
        // what it shows; the cache is refreshed rather than trusted.
        const back = m.connected && !this.connected;
        this.connected = m.connected;
        if (back && this.meta) setTimeout(() => onReady(), 300);
        break;
      }
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
    if (this.plan && this.planPaths.has(path)) return this.planPaths.get(path);
    const v = this.paths.get(path);
    return v === undefined ? fallback : v;
  }
  pget(path) { this.send({ t: 'pget', p: path }); }
  // A trigger — an `x…` property: a take, a recall, an update — is an action,
  // not state, so plan mode never stages one; it goes to the processor.
  static isTrigger(path) { return /\/x[A-Z][A-Za-z]*$/.test(path); }
  pset(path, v) {
    if (this.plan && !Store.isTrigger(path)) {
      this.planPaths.set(path, v);
      this._persistPlan();
      this.pushLog('pl', `${path} = ${JSON.stringify(v)}`);
      this.notify();
      return;
    }
    this.send({ t: 'pset', p: path, v });
    this.pushLog('tx', `${path} = ${JSON.stringify(v)}`);
  }
  planPathList() { return [...this.planPaths].map(([path, v]) => ({ path, v })); }
  unplanPath(path) { this.planPaths.delete(path); this._persistPlan(); this.notify(); }
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
  clearPlan() { this.planState.clear(); this.planPaths.clear(); this._persistPlan(); this.notify(); }
  // Send every staged value to the device for real, then clear the plan.
  async pushPlan(onProgress) {
    const wasPlan = this.plan;
    this.plan = false;               // sends go to the device now
    const entries = this.planList();
    const paths = this.planPathList();
    const total = entries.length + paths.length;
    for (let i = 0; i < entries.length; i++) {
      const e = entries[i];
      this.send({ t: 'set', m: e.m, i: e.idx, v: e.v });
      this.pushLog('tx', `${e.m} ${[...e.idx, e.v].join(',')}`);
      if (onProgress) onProgress((i + 1) / total);
      if ((i & 15) === 15) await sleep(30);
    }
    // AWJ writes are silent, so each is read back once the batch is through.
    for (let i = 0; i < paths.length; i++) {
      const e = paths[i];
      this.send({ t: 'pset', p: e.path, v: e.v });
      this.pushLog('tx', `${e.path} = ${JSON.stringify(e.v)}`);
      if (onProgress) onProgress((entries.length + i + 1) / total);
      if ((i & 15) === 15) await sleep(30);
    }
    if (paths.length) setTimeout(() => { for (const e of paths) this.pget(e.path); }, 300);
    this.planState.clear();
    this.planPaths.clear();
    this.plan = wasPlan;
    this._persistPlan();
    this.notify();
    return total;
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
const VIEW_IDS = ['lpscreens', 'lplayers', 'lppresets', 'lpinputs', 'lpsystem', 'lpmultiview', 'lpoutputs', 'lpstills', 'lpinspector', 'lpaudio', 'lpsetup', 'lpshow', 'lpcues', 'lpplan', 'plslive', 'plslayers', 'plsmemories', 'plsinputs', 'plsoutputs', 'plsaudio', 'plspictures', 'plssystem', 'showmode', 'workspace', 'stage', 'wall', 'memories', 'cues', 'keys', 'live', 'layers', 'destinations', 'shows', 'plan', 'connection', 'tally', 'inputs', 'outputs', 'screens', 'stills', 'capture', 'multiview', 'softedge', 'edid', 'audio', 'gpio', 'system', 'inspector', 'console', 'videoout'];
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
    if (!isPls()) store.get('!');   // DEV_PLATFORM -> PDEV; the PLS300 has no such special
  }
  VIEWS[effectiveView()].enter?.();
}

// How a platform name is shown: the series for an AWJ pick, the family
// otherwise.
const platformName = (plat) => AWJ_PLATFORMS[plat] || (plat === 'pls300' ? 'PLS300' : String(plat || '').toUpperCase());

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
      // The address actually configured, not the family's default port: two
      // bridges on one desk (a NeXtage in the tray app, a Pulse2 from the
      // command line) look the same in every other way, and a simulator or a
      // second unit on a non-default port would otherwise be described as
      // something it is not.
      el('div', { class: 'sub', text: plat ? `${platformName(plat)} · ${store.meta?.device || ':' + (store.meta?.port || '')}` : 'not configured' })),
    el('div', { class: 'spacer' }),
    store.plan
      ? el('button', { class: 'chip plan', title: 'Plan mode — edits are staged, not sent. Open Plan to push.',
          onclick: () => switchView(isAwj() ? 'lpplan' : 'plan') },
          el('span', { class: 'dot' }), `PLAN · ${store.planState.size + store.planPaths.size}`)
      : el('div', { class: 'legend' },
          el('span', { class: 'pgm' }, el('b'), 'program'),
          el('span', { class: 'pvw' }, el('b'), 'preview')),
    el('div', { class: 'chip ' + (store.connected ? 'on' : 'off') },
      el('span', { class: 'dot' }), store.connected ? 'ONLINE' : 'OFFLINE'));
}

const NAV = [
  { section: 'PLS300' },
  ['plslive', 'Live'], ['plslayers', 'Layers'], ['plsmemories', 'Memories'], ['plsinputs', 'Inputs'], ['plsoutputs', 'Outputs'], ['plsaudio', 'Audio'], ['plspictures', 'Pictures'], ['plssystem', 'System'],
  { section: () => awjSeriesName() },
  ['lpshow', 'Show'], ['lpscreens', 'Screens'], ['lplayers', 'Layers'], ['lppresets', 'Presets'], ['lpcues', 'Cues'], ['lpmultiview', 'Multiviewer'], ['lpaudio', 'Audio'],
  ['lpinputs', 'Inputs'], ['lpoutputs', 'Outputs'], ['lpstills', 'Stills'], ['lpsetup', 'Setup'], ['lpsystem', 'System'], ['lpplan', 'Plan'], ['lpinspector', 'Inspector'],
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
  // Live layers and inputs are spelled for the Midra 4K / Alta 4K model only;
  // the LivePremier dialect has neither yet.
  lplayers: () => awjDialect() === 'mng',
  lpinputs: () => awjDialect() === 'mng',
  lpsystem: () => awjDialect() === 'mng',
  lpmultiview: () => awjDialect() === 'mng',
  lpoutputs: () => awjDialect() === 'mng',
  lpstills: () => awjDialect() === 'mng',
  lpaudio: () => awjDialect() === 'mng',
  lpsetup: () => awjDialect() === 'mng',
  lpshow: () => awjDialect() === 'mng',
};
// What a PLS300 keeps of the Midra/LiveCore surface: the tools that read the
// variable table rather than name a variable.
const PLS_SHARED_VIEWS = new Set(['shows', 'plan', 'inspector', 'console']);
const viewSupported = (id) => {
  // Not a capability of the processor like the rest of this table — it is a
  // property of the machine the bridge runs on, and it is off unless that
  // machine is an appliance the surface owns. Checked before `configured`,
  // because getting a panel back onto the tailnet is exactly the thing you may
  // need to do before it can reach any processor at all.
  if (id === 'tailnet') return store.tailnetEnabled;
  if (!store.configured) return id === 'connection';
  // The families share the shell — header, nav, Connection — and nothing
  // else. A view built on the mnemonic variable table has nothing to render on
  // a processor that has no such table, so each family sees only its own. The
  // PLS300 is a third surface on the mnemonic table: its own views, plus the
  // table-driven tools that work on any mnemonic platform.
  const kind = id.startsWith('lp') ? 'awj' : id.startsWith('pls') ? 'pls' : 'mnem';
  const fam = isAwj() ? 'awj' : isPls() ? 'pls' : 'mnem';
  if (kind !== fam) {
    if (id === 'connection') return true;
    if (fam === 'pls' && kind === 'mnem') return PLS_SHARED_VIEWS.has(id);
    return false;
  }
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
    return isAwj() ? 'lpscreens' : isPls() ? 'plslive' : 'stage';
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
    if (section && !sectionShown) { n.append(el('div', { class: 'nav-sec', text: typeof section === 'function' ? section() : section })); sectionShown = true; }
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

/**
 * The selection's chrome — outline and corner handles — as an element of its
 * own, appended to the canvas after the layers and drawn above them all.
 *
 * The layers themselves keep the order the device stacks them in. They used to
 * lift the selected one to the front, which put a full-screen selection — L1,
 * the default — over every other layer, so a press on any of them grabbed L1
 * and nothing but the selected layer could be dragged; its corners still
 * worked, which is why resizing seemed fine while moving did not. The chrome
 * is inert to the pointer except for its handles, so a press inside it reaches
 * whichever layer is really under the cursor, and it follows the box through a
 * drag by watching the inline style every drag handler writes to.
 *
 * `onResize(e, corner, box)` receives the layer's own box, since the handle is
 * no longer inside it.
 */
function selectionChrome(cv, box, onResize) {
  const chrome = el('div', { class: 'sel-chrome' + (box.classList.contains('top') ? ' top' : '') },
    ...(onResize ? ['nw', 'ne', 'sw', 'se'].map(c => el('div', { class: 'handle ' + c, onpointerdown: (e) => onResize(e, c, box) })) : []));
  const follow = () => { for (const k of ['left', 'top', 'width', 'height']) chrome.style[k] = box.style[k]; };
  follow();
  new MutationObserver(follow).observe(box, { attributes: true, attributeFilter: ['style'] });
  cv.append(chrome);
  return chrome;
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
      midraEditMode();
      store.scan('PMpst'); store.scan('SCmly'); store.scan('SCssh'); store.scan('SCssv');
    }
    function save(slot) { store.set('GCsrq', [2, slot], 1); store.get('PMpst', [slot]); got.delete(slot); ensure(slot); store.notify(); }
    function reset(slot) { store.set('CTpmr', [slot], 1); store.get('PMpst', [slot]); got.delete(slot); if (sel === slot) sel = null; store.notify(); }
    function recall(slot) {                       // re-apply the stored preset to preview (ctx 1)
      midraEditMode();
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
          isUsed ? confirmBtn(`midra-save-${sel}`, 'Save current program', 'Tap again to overwrite', () => save(sel), 'btn save')
                 : el('button', { class: 'btn save', onclick: () => save(sel) }, 'Save current program'),
          isUsed ? confirmBtn(`midra-erase-${sel}`, 'Erase', 'Tap again to erase', () => reset(sel)) : null),
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
      // Midra: keep preset-update mode OFF — preview edits stick without it,
      // and with it on the take verb is dead (see midraEditMode).
      midraEditMode();
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
          confirmBtn(`layerbank-erase-${n}`, 'Erase', 'Tap again to erase', () => { LAYER_MEM.erase(n); if (sel === n) sel = null; report = null; store.notify(); })),
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
        el('td', { text: layerName(l) }),
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
    // Save mode onto a slot already in use overwrites it — a second tap on the
    // same slot within three seconds confirms; a tap anywhere else disarms.
    if (mode === 'save' && slotValid(n, scope === 'master')) {
      const key = `memgrid-save-${scope}-${screen}-${n}`;
      if (ARMED !== key) {
        clearTimeout(ARMED_TIMER); ARMED = key;
        ARMED_TIMER = setTimeout(() => { if (ARMED === key) { ARMED = null; store.notify(); } }, 3000);
        flash(`Memory ${n + 1} is in use — tap it again to overwrite`);
        return;
      }
      ARMED = null;
    }
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
      if (ARMED === `memgrid-save-${scope}-${screen}-${i}`) cls += ' armed-danger';
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
            confirmBtn(`mem-erase-${screen}-${selected}`, 'Erase', 'Tap again to erase', () => eraseSlot(selected))),
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
            confirmBtn(`master-erase-${selected}`, 'Erase', 'Tap again to erase', () => eraseSlot(selected))))
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

// LiveCore layer sources (INPUTLAYER): 0 none, 1–24 live inputs, 25–32 the eight
// loaded frames (the "large stills"), 33–40 the eight logos (the "reduced
// stills"), 41 colour — named as the device's own RCS names them, Frame and
// Logo, so an operator used to it finds the same words here.
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
  if (n >= 33 && n <= 40) return rstillLabel(n - 33) || 'Logo ' + (n - 32);
  if (n >= 25 && n <= 32) return stillLabel(n - 25) || 'Frame ' + (n - 24);
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
    if (n <= 8 && store.val('PSfrv', n - 1) === 1) return true;       // a loaded frame, on the frame layer
    if (store.val('INava', n - 1) === 0) return n > availableInputs(); // no card: beyond the cards the device still accepts it (9, 10 on a Pulse2)
    return inputHasSignal(n - 1);
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
// The Midra's eight layer slots are, in the device's own LAYER enumeration:
// the background frame, PiP 1–4, logo 1–2 and audio. SCmly says how many the
// model fits (a Pulse2 answers 2: the frame layer and one PiP). LiveCore
// layers are plain numbered layers.
const MIDRA_LAYER_NAMES = ['Frame', 'PiP 1', 'PiP 2', 'PiP 3', 'PiP 4', 'Logo 1', 'Logo 2', 'Audio'];
// GCqly's 27 built-in arrangements, in the device's own words (its LAYOUT
// enumeration, 0..26). "Idle" is the resting value the trigger reads back as.
const MIDRA_LAYOUTS = ['Idle', 'Reset', 'Full W1', 'Full W2', 'Full W3', 'Full W4', 'Splitted', 'Left', 'Right', 'Bottom',
  '2 layers split H', '2 layers split V', '3 layers split H', '3 layers split V',
  'Background live + PiP top left', 'Background live + PiP top right', 'Background live + PiP bottom left', 'Background live + PiP bottom right',
  'Background frame + 2 PiP split H', 'Background frame + 2 PiP split V',
  'Background frame + 3 PiP split H on left', 'Background frame + 3 PiP split H on right', 'Background frame + 3 PiP split V on top', 'Background frame + 3 PiP split H on bottom',
  'Background frame + 3 PiP split H', 'Background frame + 3 PiP split diagonal', 'Reset with source'];
const layerName = (l) => isMidra() ? (MIDRA_LAYER_NAMES[l] || 'L' + (l + 1)) : 'L' + (l + 1);
// On a Midra the same INPUTLAYER number means a different thing per layer —
// the enumeration literally reads "INPUT / FRAME n": on the background frame
// layer 1–8 is the loaded frame of that number (a Pulse2 with frames 1 and 2
// loaded accepts exactly 1 and 2 there, and 9, 10 and colour), on a PiP it is
// the input. Name it for the layer it sits on.
function sourceNameFor(n, l) {
  if (isMidra() && l === 0 && n >= 1 && n < srcMaxOf()) return n <= 8 ? 'Frame ' + n : 'Src ' + n;
  return sourceName(n);
}
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
  const layer = mnem === 'PRinp' ? idx[idx.length - 1] : null;   // a Midra names a number by the layer it is on
  const s = el('select', { onchange: (e) => store.set(mnem, idx, +e.target.value) });
  for (let i = 0; i <= max; i++) {
    // an unavailable source stalls any take that waits for it, so it is only listed
    // when it is the value already on the layer — where hiding it would be a lie
    if (!sourceAvailable(i) && i !== cur) continue;
    const opt = el('option', { value: i, text: (layer != null ? sourceNameFor(i, layer) : sourceName(i)) + (sourceAvailable(i) ? '' : ' — not available') });
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
// A destructive action behind a second tap: the first tap arms the button and
// relabels it, the second within three seconds fires it, anything else
// disarms. One key per action, so arming "erase 12" never fires "erase 13".
// On a live show a single stray tap must not erase a memory.
let ARMED = null, ARMED_TIMER = null;
function confirmBtn(key, label, armedLabel, onConfirm, cls = 'btn ghost') {
  const armed = ARMED === key;
  return el('button', {
    class: cls + (armed ? ' armed-danger' : ''),
    title: armed ? 'Tap again to confirm' : `${label} — asks for a second tap`,
    onclick: (e) => {
      e.stopPropagation();
      clearTimeout(ARMED_TIMER);
      if (armed) { ARMED = null; onConfirm(); return; }
      ARMED = key;
      ARMED_TIMER = setTimeout(() => { if (ARMED === key) { ARMED = null; store.notify(); } }, 3000);
      store.notify();
    },
  }, armed ? armedLabel : label);
}
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
    const label = dLabel.trim() || (dScope === 'master' ? `Master ${dSlot + 1}` : `Screen ${dScreen + 1} · ${dSlot + 1}`);
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
    ftb:    { label: 'Master fade', fields: ['screen', 'dir'], desc: a => `${a.dir === FADE_OUT ? 'Fade to black' : 'Fade up'} screen ${a.screen + 1}` },
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
  let dType = 'master', dSlot = 0, dScreen = 0, dInput = 0, dOutput = 0, dTake = true, dOn = true, dDir = FADE_OUT;
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
      f('dir') ? el('label', { class: 'field' }, 'Direction', el('select', { onchange: e => dDir = +e.target.value }, el('option', { value: FADE_OUT, selected: dDir === FADE_OUT || undefined }, 'To black'), el('option', { value: FADE_IN, selected: dDir === FADE_IN || undefined }, 'Up'))) : null,
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
    groups: ['INPUT', 'INPUT_SETTINGS', 'INPUT_SETTINGS_MEMORIES', 'GRP_INPUT', 'GRP_INPUT_SETTINGS', 'GRP_INPUT_SETTINGS_MEMORIES', 'GRP_INPUT_KEYING', 'GRP_KEYING', 'GRP_EDID'] },
  { id: 'outputs', label: 'Outputs & screens',
    hint: 'Output format and processing, screen composition and soft-edge blends.',
    groups: ['OUTPUT', 'OUTPUT_SCREEN', 'OUTPUT_CONTROL', 'OUTPUT_AOI_SIZE', 'SCREEN', 'SCREEN_MIRROR', 'SOFTEDGE', 'MONITORING_LAYOUT', 'MONITORING__OUTPUTS', 'MONITORING_SCREEN', 'GRP_OUTPUT', 'GRP_VIDEO_OUT', 'GRP_SCREEN', 'GRP_SCREEN_CONFIG', 'GRP_SOFTEDGE', 'GRP_OUTPUT_FORMAT', 'GRP_SETTINGS', 'GRP_REFERENCE'] },
  { id: 'audio', label: 'Audio',
    hint: 'Audio input and output routing and levels.',
    groups: ['GRP_AUDIO_INPUT', 'GRP_AUDIO_OUTPUT', 'GRP_AUDIO'] },
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
    if (hasBanks()) store.scan('GCsta');
    for (let c = 0; c < (store.byMnem.get('PRinp')?.dims?.[1] ?? 1); c++)
      for (let l = 0; l < layerSlots(); l++) { store.get('PRinp', [screen, c, l]); if (hasPRlay()) store.get('PRlay', [screen, c, l]); }
    if (store.byMnem.has('GCtup')) store.get('GCtup', [screen]);
    if (store.byMnem.has('MAfat')) { store.get('MAsna', [screen]); store.get('MAnas', [screen]); store.get('MAfat', []); }
    if (store.byMnem.has('GCfsc')) store.get('GCfsc', [screen]);
    if (store.byMnem.has('GCfra')) store.get('GCfra', []);
  }

  function take() { doTake(screen, ttime); }
  function cut() { doCut(screen); }
  // MAmfa (SCREEN_MASTER_FADE_AUTO) is the device's FADE_AUTO enum: 0 idle,
  // 1 FADE IN (picture up), 2 FADE OUT (to black). Confirmed on a NeXtage 16:
  // a 2 runs MAnas through TRANSITION_OUT to AT MIN, a 1 back through
  // TRANSITION_IN to AT MAX. The status enum: 0 at max, 1 at min,
  // 2 at consigne, 3 transition in, 4 transition out.
  function fadeToBlack() { store.set('MAmfa', [screen], FADE_OUT); }
  function fadeUp() { store.set('MAmfa', [screen], FADE_IN); }
  function fadeState() {
    const st = store.val('MAnas', screen);
    return st == null ? '' : (ALPHA_STATUS[st] || `status ${st}`);
  }

  // The bank on air is the one GCsta names (LiveCore), not a fixed index —
  // showing bank A here while B is live lied about what the audience sees.
  function layers() {
    const max = store.val('SCmly', screen) || 0;
    if (max === 0) return el('div', { class: 'empty-state', text: 'This screen has no layers. Configure it in Screens, or on the device, then layers appear here.' });
    const c = liveCtx(screen);
    const wrap = el('div', { class: 'layers' });
    for (let l = 0; l < max; l++) {
      const src = store.val('PRinp', screen, c, l);
      const on = layerShown(screen, c, l);
      wrap.append(el('div', { class: 'layer' + (on ? ' on' : '') },
        el('span', { class: 'tag', text: layerName(l) }),
        el('span', { class: 'src', text: sourceNameFor(src, l) }),
        hasPRlay() ? el('button', { class: 'btn ghost', onclick: () => store.set('PRlay', [screen, c, l], store.val('PRlay', screen, c, l) === 1 ? 0 : 1) }, on ? 'Hide' : 'Show') : null));
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
            el('span', { class: 'hint', text: fadeState() }),
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
      el('div', { class: 'panel' }, el('h2', `Screen ${screen + 1} layers · on air`), layers()));
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
// Output formats and rates — the OUfor/OUfst and OUrat enumerations as the device's own
// RCS lists them, so an operator sees the resolution and not an index. LiveCore from the
// Web RCS a NeXtage serves (ORX_WebRCS.swf v04.02.03: ENUM_OFORMAT_NAME 0…54 and, for
// OUT_PREVIEW_RATE, ENUM_OFIELDRATE_NAME 0…9 — the variable is declared CUSTOM…60HZ, so
// 72/75 Hz belong to the monitoring output only), Midra from RCS2 (MDR_launcher.swf
// v2.2.03: ENUM_OFORMAT_NAME 0…45, ENUM_OFIELDRATE_NAME 0…15). Index 0 is SDTV PAL on both
// — neither list has an "auto" entry. The vendor's text, with its own aspect-ratio
// inconsistencies (LiveCore calls 1680×1050 16:9, Midra 16:10), only retyped: "X" → "×",
// "1080P" → "1080p". Recovery is described in docs/PROTOCOL.md.
const LIVECORE_OUTPUT_FORMATS = [
  'SDTV PAL',
  'SDTV NTSC',
  'EDTV 480p',
  'EDTV 576p',
  'HDTV 720p',
  'HDTV 1035i',
  'HDTV 1080i',
  'HDTV 1080p',
  'HDTV 1080sF',
  'DCDM 2048×1080',
  'Computer 640×480 (4:3 VGA)',
  'Computer 800×600 (4:3 SVGA)',
  'Computer 848×480 (16:9 WVGA)',
  'Computer 1024×768 (4:3 XGA)',
  'Computer 1152×864 (4:3)',
  'Computer 1280×720 (16:9 720p)',
  'Computer 1280×768 (15:9 WXGA)',
  'Computer 1280×800 (16:10 WXGA2)',
  'Computer 1280×960 (4:3)',
  'Computer 1280×1024 (5:4 SXGA)',
  'Computer 1360×768 (16:9)',
  'Computer 1360×1024 (4:3)',
  'Computer 1366×768 (16:9 SWXGAPB)',
  'Computer 1366×800 (15:9 SWXGAP)',
  'Computer 1400×1050 (4:3 SXGAP)',
  'Computer 1440×900 (16:10 900p)',
  'Computer 1440×960 (3:2)',
  'Computer 1600×900 (16:9)',
  'Computer 1600×1200 (4:3 UXGA)',
  'Computer 1680×1050 (16:9 WSXGAP)',
  'Computer 1920×1080 (16:9 1080p)',
  'Computer 1920×1200 (16:10 WUXGA)',
  'Computer 1920×1440 (4:3)',
  'Computer 2048×1080 (2K)',
  'Computer 2048×1152 (16:9)',
  'Computer 2048×1536 (4:3 QXGA)',
  'Computer 2560×1440 (16:9)',
  'Computer 2560×1600 (16:10 WQXGA)',
  'Computer custom 1',
  'Computer custom 2',
  'Computer custom 3',
  'Computer custom 4',
  'Computer custom 5',
  'Computer custom 6',
  'Computer custom 7',
  'Computer custom 8',
  'Computer custom 9',
  'Computer custom 10',
  'UHDTV 2160p (3840×2160)',
  'Cinema 4K (4096×2160)',
  'Computer 2560×1080 (21:9)',
  'Computer 1920×2160 (UHDTV side by side)',
  'Computer 2048×2160 (4K side by side)',
  'Computer 3840×1080 (UHDTV top bottom)',
  'Computer 4096×1080 (4K top bottom)',
];
const MIDRA_OUTPUT_FORMATS = [
  'SDTV PAL',
  'SDTV NTSC',
  'EDTV 480p',
  'EDTV 576p',
  'HDTV 720p',
  'HDTV 1035i',
  'HDTV 1080i',
  'HDTV 1080p',
  'DCDM 2048×1080',
  'Computer 640×480 (4:3 VGA)',
  'Computer 800×600 (4:3 SVGA)',
  'Computer 848×480 (16:9 WVGA)',
  'Computer 1024×768 (4:3 XGA)',
  'Computer 1152×864 (4:3)',
  'Computer 1280×720 (16:9 720p)',
  'Computer 1280×768 (15:9 WXGA)',
  'Computer 1280×800 (16:10 WXGA2)',
  'Computer 1280×960 (4:3)',
  'Computer 1280×1024 (5:4 SXGA)',
  'Computer 1360×768 (16:9)',
  'Computer 1360×1024 (4:3)',
  'Computer 1366×768 (16:9 SWXGAPB)',
  'Computer 1366×800 (15:9 SWXGAP)',
  'Computer 1400×1050 (4:3 SXGAP)',
  'Computer 1440×900 (16:10 900p)',
  'Computer 1600×900 (16:9)',
  'Computer 1600×1200 (4:3 UXGA)',
  'Computer 1680×1050 (16:10 WSXGAP)',
  'Computer 1920×1080 (16:9 1080p)',
  'Computer 1920×1200 (16:10 WUXGA)',
  'Computer 1920×1440 (4:3)',
  'Computer 2048×1080 (2K)',
  'Computer 2048×1152 (16:9)',
  'Computer 2048×1536 (4:3 QXGA)',
  'Computer 2560×1440 (16:9)',
  'Computer 2560×1600 (16:10 WQXGA)',
  'Computer custom 1',
  'Computer custom 2',
  'Computer custom 3',
  'Computer custom 4',
  'Computer custom 5',
  'Computer custom 6',
  'Computer custom 7',
  'Computer custom 8',
  'Computer custom 9',
  'Computer custom 10',
];
const LIVECORE_OUTPUT_RATES = [
  'Custom',
  'Internal rate',
  '23.97 Hz',
  '24 Hz',
  '25 Hz',
  '29.97 Hz',
  '30 Hz',
  '50 Hz',
  '59.94 Hz',
  '60 Hz',
];
const MIDRA_OUTPUT_RATES = [
  '23.97 Hz',
  '24 Hz',
  '25 Hz',
  '29.97 Hz',
  '30 Hz',
  '47.95 Hz',
  '48 Hz',
  '50 Hz',
  '59.94 Hz',
  '60 Hz',
  '72 Hz',
  '75 Hz',
  '85 Hz',
  '100 Hz',
  '119.88 Hz',
  '120 Hz',
];
const outputFormatNames = () => enumLabels('OUfor', isMidra() ? MIDRA_OUTPUT_FORMATS : LIVECORE_OUTPUT_FORMATS);
const outputRateNames = () => enumLabels('OUrat', isMidra() ? MIDRA_OUTPUT_RATES : LIVECORE_OUTPUT_RATES);
/** The name of an output format index, or the bare number when it is off the list. */
function outputFormatName(v) { return v == null ? '·' : (outputFormatNames()[v] ?? String(v)); }
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
    for (let i = 0; i <= max; i++) { const o = el('option', { value: i, text: MIDRA_LAYOUTS[i] || 'Layout ' + (i + 1) }); if (i === cur) o.selected = true; s.append(o); }
    return s;
  }

  const LAYER_VARS = ['PRinp', 'PRlay', 'PRalp', 'PRpoh', 'PRpov', 'PRsih', 'PRsiv',
    'PRbst', 'PRbcr', 'PRbcg', 'PRbcb', 'PRbsh', 'PRbsv', 'PRbal',
    'PRcph', 'PRcpv', 'PRcsh', 'PRcsv', 'PRotr', 'PRowa', 'PRctr', 'PRcwa'];
  function enter() {
    // Midra protects the program preset: edits go to the preview context and a
    // take commits them. Preset-update mode stays OFF — with it on the take
    // verb is inert (see midraEditMode). LiveCore edits apply directly.
    midraEditMode();
    if (isMidra() && store.byMnem.has('PSfrv')) store.scan('PSfrv');
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
        el('span', { class: 'lrect-tag', text: `${layerName(l)}${src ? ' · ' + sourceNameFor(src, l) : ''}` }));
      cv.append(box);
      if (l === sel) selectionChrome(cv, box, (e, c, b) => dragResize(e, l, scale, c, b));
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

  function dragResize(e, l, scale, corner, box) {
    e.preventDefault(); e.stopPropagation();
    beginDrag(); sel = l;
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
        el('span', { class: 'tag', text: layerName(l) }),
        el('span', { class: 'src', text: sourceNameFor(src, l) }),
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
          el('div', { class: 'panel' }, el('h2', isMidra() ? layerName(sel) : `Layer ${sel + 1}`), editor()))));
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
  // The output→screen model, as the device spells it. OUTPUT_SCREEN (OS*) is
  // indexed by OUTPUT: OSsou[o] is the screen output o carries, OSpoh/OSpov[o]
  // the tile of that screen it shows (1-based), OSomo[o] whether it shows the
  // program (0) or the preview (1). A screen's size in output tiles is
  // SCsih×SCsiv[s]. Read off a NeXtage 16 where outputs 1 and 2 each carry
  // screen 1 and 2 at tile 1,1 — an earlier reading of OSpoh as a per-screen
  // position drew both screens on one tile and hid one behind the other.
  const clamp = (v, lo, hi) => Math.min(Math.max(v, lo), hi);
  const active = () => Array.from({ length: screenCount() }, (_, s) => s).filter(s => (store.val('SCssh', s) || 0) > 0);
  const sizeH = (s) => store.val('SCsih', s) || 1;
  const sizeV = (s) => store.val('SCsiv', s) || 1;
  const outputs = () => Array.from({ length: outputCount() }, (_, o) => o).filter(o => store.val('OUava', o) !== 0);
  const outScreen = (o) => store.val('OSsou', o);
  const outTile = (o) => ({ h: store.val('OSpoh', o) || 1, v: store.val('OSpov', o) || 1 });
  const outMode = (o) => store.val('OSomo', o) || 0;      // 0 program, 1 preview
  const outputsOf = (s) => outputs().filter(o => outScreen(o) === s);

  let sel = null;   // selected output, or null

  function enter() {
    for (const m of ['SCssh', 'SCssv', 'SCmly', 'SCsih', 'SCsiv', 'OUava', 'OUena', 'OSsou', 'OSpoh', 'OSpov', 'OSomo', 'OSipo']) if (store.byMnem.has(m)) store.scan(m);
    for (let s = 0; s < screenCount(); s++) fetchLabel('LBScr', [s]);
    for (let o = 0; o < outputCount(); o++) fetchLabel('LBOut', [o]);
  }

  const stepSize = (s, axis, d) => {
    const m = axis === 'h' ? 'SCsih' : 'SCsiv';
    const cur = axis === 'h' ? sizeH(s) : sizeV(s);
    store.set(m, [s], clamp(cur + d, 1, 16));
  };
  function moveTo(o, h, v) {
    if (h !== outTile(o).h) store.set('OSpoh', [o], h);
    if (v !== outTile(o).v) store.set('OSpov', [o], v);
  }

  function chip(o) {
    const on = store.val('OUena', o) === 1;
    return el('button', {
      class: 'wall-out' + (sel === o ? ' sel' : '') + (on ? '' : ' off') + (outMode(o) === 1 ? ' pvw' : ''),
      title: `${outputLabel(o)} — ${outMode(o) === 1 ? 'preview' : 'program'}${on ? '' : ', not enabled'}. Click to select, then click a tile to move it.`,
      onclick: (e) => { e.stopPropagation(); sel = sel === o ? null : o; store.notify(); },
    },
      el('span', { class: 'wall-out-name', text: outputLabel(o) }),
      el('span', { class: 'wall-out-mode', text: outMode(o) === 1 ? 'PVW' : 'PGM' }));
  }

  function screenCard(s) {
    const w = sizeH(s), h = sizeV(s);
    const sw = store.val('SCssh', s) || 0, sh = store.val('SCssv', s) || 0;
    const tile = Math.max(56, Math.min(150, Math.floor(600 / Math.max(w, 1))));
    const grid = el('div', { class: 'wall-grid', style: `grid-template-columns:repeat(${w},${tile}px);grid-auto-rows:${Math.round(tile * 9 / 16)}px` });
    for (let v = 1; v <= h; v++) for (let hh = 1; hh <= w; hh++) {
      const here = outputsOf(s).filter(o => outTile(o).h === hh && outTile(o).v === v);
      const canDrop = sel != null && outScreen(sel) === s;
      grid.append(el('div', {
        class: 'wall-tile' + (here.length ? '' : ' empty') + (canDrop ? ' drop' : ''),
        title: canDrop ? `Move ${outputLabel(sel)} to tile ${hh},${v}` : `Tile ${hh},${v}`,
        onclick: () => { if (canDrop) { moveTo(sel, hh, v); sel = null; store.notify(); } },
      }, el('span', { class: 'wall-tile-n', text: `${hh},${v}` }), ...here.map(chip)));
    }
    const off = outputsOf(s).filter(o => outTile(o).h > w || outTile(o).v > h);
    return el('div', { class: 'panel wall-screen-card' },
      el('div', { class: 'row', style: 'align-items:center;flex-wrap:wrap' },
        el('span', { class: 'wall-sel-name', text: screenLabel(s) }),
        el('span', { class: 'hint', text: sw ? `${sw}×${sh}` : '' }),
        el('div', { class: 'spacer' }),
        el('label', { class: 'field' }, 'Tiles across',
          el('button', { class: 'btn ghost', onclick: () => stepSize(s, 'h', -1) }, '−'),
          el('span', { class: 'wall-ro', text: w }),
          el('button', { class: 'btn ghost', onclick: () => stepSize(s, 'h', 1) }, '+')),
        el('label', { class: 'field' }, 'down',
          el('button', { class: 'btn ghost', onclick: () => stepSize(s, 'v', -1) }, '−'),
          el('span', { class: 'wall-ro', text: h }),
          el('button', { class: 'btn ghost', onclick: () => stepSize(s, 'v', 1) }, '+'))),
      el('div', { class: 'wall-wrap' }, grid),
      off.length ? el('div', { class: 'hint pad', text: `Outside the screen's tiles: ${off.map(o => `${outputLabel(o)} at ${outTile(o).h},${outTile(o).v}`).join(', ')} — select it and click a tile.` }) : null,
      outputsOf(s).length ? null : el('div', { class: 'hint pad', text: 'No output carries this screen.' }));
  }

  function selPanel() {
    if (sel == null) return el('div', { class: 'hint', text: 'Each screen is a grid of output tiles; the outputs carrying it sit on the tile they show. Click an output, then a tile, to move it. Apply commits the layout with a global output update — the outputs re-sync.' });
    const o = sel, scr = outScreen(o);
    return el('div', { class: 'row', style: 'align-items:center;flex-wrap:wrap' },
      el('span', { class: 'wall-sel-name', text: outputLabel(o) }),
      el('label', { class: 'field' }, 'Carries',
        el('select', { onchange: (e) => { store.set('OSsou', [o], +e.target.value); store.notify(); } },
          ...Array.from({ length: screenCount() }, (_, s) => el('option', { value: s, selected: s === scr || undefined }, screenLabel(s))))),
      store.byMnem.has('OSomo') ? el('label', { class: 'field' }, 'Shows',
        el('select', { onchange: (e) => { store.set('OSomo', [o], +e.target.value); store.notify(); } },
          el('option', { value: 0, selected: outMode(o) === 0 || undefined }, 'Program'),
          el('option', { value: 1, selected: outMode(o) === 1 || undefined }, 'Preview'))) : null,
      el('label', { class: 'field' }, 'Tile',
        el('span', { class: 'wall-ro', text: `${outTile(o).h},${outTile(o).v}` })),
      el('span', { class: 'hint', text: 'click a tile of its screen to move it' }),
      el('div', { class: 'spacer' }),
      el('button', { class: 'btn ghost', onclick: () => { sel = null; store.notify(); } }, 'Done'));
  }

  function render() {
    const screens = active();
    const orphan = outputs().filter(o => !screens.includes(outScreen(o)));
    return el('div', { onclick: () => { if (sel != null) { sel = null; store.notify(); } } },
      el('div', { class: 'view-head' }, el('h1', { text: 'Wall' }),
        el('span', { class: 'hint', text: 'Which output shows which tile of which screen — arrange, then apply' }),
        el('div', { class: 'spacer' }),
        el('button', { class: 'btn pgm', onclick: () => { if (store.byMnem.has('OSupd')) store.set('OSupd', [], 1); }, disabled: store.byMnem.has('OSupd') ? undefined : true }, 'Apply to device')),
      el('div', { class: 'panel' }, selPanel()),
      screens.length
        ? el('div', {}, ...screens.map(screenCard))
        : el('div', { class: 'panel' }, el('div', { class: 'empty-state', text: 'No active screens to map.' })),
      orphan.length ? el('div', { class: 'panel' }, el('h2', 'Outputs on unused screens'),
        el('div', { class: 'row', style: 'flex-wrap:wrap' }, ...orphan.map(o => el('div', { class: 'row', style: 'align-items:center;gap:6px' }, chip(o), el('span', { class: 'hint', text: `→ ${screenLabel(outScreen(o))}` }))))) : null,
      el('div', { class: 'panel' },
        el('div', { class: 'hint', text: 'Per output: OSsou is the screen it carries, OSpoh/OSpov the tile, OSomo program or preview; SCsih/SCsiv is the screen’s size in tiles. Apply is OSupd.' })));
  }
  return { enter, render };
})();


// ================= AWJ: LivePremier, Midra 4K, Alta 4K =================
//
// A different processor generation with a different protocol, so these views
// share no state with the mnemonic ones above: they read store.paths, not
// store.state, and they are the only views shown when the bridge is pointed at
// an AWJ processor.
//
// One wire protocol, two object models. A LivePremier and a Midra 4K / Alta 4K
// answer on the same port and share framing, verbs and the six transition
// states — and no path at all: each answers E12 to the other's spelling. So
// the views below never spell a path. They ask AWJ_DIALECTS[awjDialect()],
// which knows a destination as `S1`/`A1` on both models and turns that into a
// path only at the last step. Above that line the two are the same processor.
//
// THE PATHS BELOW MUST MATCH crates/openrcs-awj/src/paths.rs (LP) AND
// crates/openrcs-awj/src/mng.rs (MNG). Two builders for one protocol is a
// duplication with a real failure mode — a path that is right in one and
// stale in the other fails as an E12 at runtime, not at build time.

const AWJ_PLATFORMS = { livepremier: 'LivePremier', midra4k: 'Midra 4K', alta4k: 'Alta 4K' };
const isAwj = () => Object.hasOwn(AWJ_PLATFORMS, store.meta?.platform);
// Which object model the operator's pick implies. Midra 4K and Alta 4K are one
// model; the pick is kept apart only so the header can name the series.
const awjDialect = () => (store.meta?.platform === 'livepremier' ? 'nlc' : 'mng');
const awjSeriesName = () => AWJ_PLATFORMS[store.meta?.platform] || 'AWJ';

const LP_SCREENS = 24;
const AWJ_PRESET_PAGE = 50;      // matches the server's connect-time inventory

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

// Midra 4K / Alta 4K. Screen 1 and auxiliary 1 are both keyed `1`, in two
// lists, so every builder takes the `{kind, n}` a destination id parses to.
const MNG_LIST = { screen: '$screen', aux: '$auxiliaryScreen' };
const MNG_CURRENT = 'DeviceObject/preconfig/status/$state/@items/CURRENT';
const MNG = {
  model: () => 'DeviceObject/system/@props/dev',
  platformLabel: () => 'DeviceObject/system/@props/platformLabel',
  version: () => 'DeviceObject/system/version/@props/updater',
  label: (d) => `DeviceObject/${MNG_LIST[d.kind]}/@items/${d.n}/control/@props/label`,
  // "In service" is in the APPLIED preconfig, not on the destination: `enable`
  // on a screen, a mode other than DISABLE on an auxiliary.
  screenEnabled: (n) => `${MNG_CURRENT}/$screen/@items/${n}/@props/enable`,
  auxMode: (n) => `${MNG_CURRENT}/$auxiliaryScreen/@items/${n}/@props/mode`,
  transition: (d) => `DeviceObject/transition/${MNG_LIST[d.kind]}/@items/${d.n}/status/@props/transition`,
  takeTime: (d) => `DeviceObject/transition/${MNG_LIST[d.kind]}/@items/${d.n}/control/@props/takeTime`,
  take: (d) => `DeviceObject/transition/${MNG_LIST[d.kind]}/@items/${d.n}/control/@props/xTake`,
  cut: (d) => `DeviceObject/transition/${MNG_LIST[d.kind]}/@items/${d.n}/control/@props/xCut`,
  memoryId: (d, buffer) => `DeviceObject/${MNG_LIST[d.kind]}/@items/${d.n}/$preset/@items/${buffer}/status/@props/memoryId`,
  // The status node a buffer's memory bookkeeping lives under, as a
  // subscription prefix: memoryId and isModified, and nothing noisier.
  bufferStatus: (d, buffer) => `DeviceObject/${MNG_LIST[d.kind]}/@items/${d.n}/$preset/@items/${buffer}/status`,
  // `$slot`, not `$bank`; the roots are preset/bank, preset/auxBank, preset/masterBank.
  presetValid: (root, n) => `DeviceObject/${root}/$slot/@items/${n}/status/@props/isValid`,
  presetLabel: (root, n) => `DeviceObject/${root}/$slot/@items/${n}/control/@props/label`,
  load: (root, slot, d, target) =>
    `DeviceObject/${root}/control/load/$slot/@items/${slot}/${MNG_LIST[d.kind]}/@items/${d.n}/$preset/@items/${target}/@props/xRequest`,
  loadMaster: (slot, target) =>
    `DeviceObject/preset/masterBank/control/load/$slot/@items/${slot}/$preset/@items/${target}/@props/xRequest`,
  // Save nests the other way round: destination, buffer, then slot.
  save: (root, slot, d, from) =>
    `DeviceObject/${root}/control/save/${MNG_LIST[d.kind]}/@items/${d.n}/$preset/@items/${from}/$slot/@items/${slot}/@props/xRequest`,
  saveMaster: (slot) => `DeviceObject/preset/masterBank/control/save/$slot/@items/${slot}/@props/xRequest`,
  masterSaveMode: () => 'DeviceObject/preset/masterBank/control/save/@props/mode',
  // Where a SAVE_FROM_* master save puts each destination's buffer: a slot in
  // its own bank, 1 by default for every one of them. Set before the save.
  masterSaveBankSlot: (d) => `DeviceObject/preset/masterBank/control/save/${MNG_LIST[d.kind]}/@items/${d.n}/@props/bankSlot`,
  presetDelete: (root, n) => `DeviceObject/${root}/$slot/@items/${n}/control/@props/xDelete`,
  // The rest of the take node: the T-bar is written on control and read on
  // status, and TAKE ALL is one list on the node's own control.
  tbarControl: (d) => `DeviceObject/transition/${MNG_LIST[d.kind]}/@items/${d.n}/control/@props/tbarPosition`,
  tbarStatus: (d) => `DeviceObject/transition/${MNG_LIST[d.kind]}/@items/${d.n}/status/@props/tbarPosition`,
  presetToggle: (d) => `DeviceObject/transition/${MNG_LIST[d.kind]}/@items/${d.n}/control/@props/enablePresetToggle`,
  stepBack: (d) => `DeviceObject/transition/${MNG_LIST[d.kind]}/@items/${d.n}/control/@props/xStepBack`,
  copyToPreview: (d) => `DeviceObject/transition/${MNG_LIST[d.kind]}/@items/${d.n}/control/@props/xCopyProgramToPreview`,
  freeze: (d) => `DeviceObject/${MNG_LIST[d.kind]}/@items/${d.n}/control/@props/freeze`,
  // Layers: geometry and every other leaf hang off the buffer; the canvas,
  // freeze and fader off the screen. `layerMode` (applied preconfig) says
  // which of the eight slots are real.
  canvasW: (n) => `DeviceObject/$screen/@items/${n}/canvas/status/size/@props/sizeH`,
  canvasH: (n) => `DeviceObject/$screen/@items/${n}/canvas/status/size/@props/sizeV`,
  layerMode: (n, l) => `${MNG_CURRENT}/$screen/@items/${n}/$liveLayer/@items/${l}/@props/mode`,
  layerProp: (n, buffer, l, tail) => `DeviceObject/$screen/@items/${n}/$preset/@items/${buffer}/$liveLayer/@items/${l}/${tail}`,
  layerFreeze: (n, l) => `DeviceObject/$screen/@items/${n}/$liveLayer/@items/${l}/control/@props/freeze`,
  layerFader: (n, l) => `DeviceObject/$screen/@items/${n}/$liveLayer/@items/${l}/fader/@props/opacity`,
  layerFadeIn: (n, l) => `DeviceObject/$screen/@items/${n}/$liveLayer/@items/${l}/fader/@props/xFadeIn`,
  layerFadeOut: (n, l) => `DeviceObject/$screen/@items/${n}/$liveLayer/@items/${l}/fader/@props/xFadeOut`,
  auxSource: (n, buffer) => `DeviceObject/$auxiliaryScreen/@items/${n}/$preset/@items/${buffer}/background/source/@props/content`,
  subDestination: (d) => `DeviceObject/${MNG_LIST[d.kind]}/@items/${d.n}`,
  // Inputs are keyed INPUT_n; labels, connector and signal live on the plug.
  inputAvailable: (i) => `DeviceObject/$input/@items/INPUT_${i}/status/@props/isAvailable`,
  inputLed: (i) => `DeviceObject/$input/@items/INPUT_${i}/status/@props/ledColor`,
  inputPlug: (i) => `DeviceObject/$input/@items/INPUT_${i}/control/@props/plug`,
  inputFreeze: (i) => `DeviceObject/$input/@items/INPUT_${i}/control/@props/freeze`,
  inputBlack: (i) => `DeviceObject/$input/@items/INPUT_${i}/control/@props/black`,
  plugLabel: (i, p) => `DeviceObject/$input/@items/INPUT_${i}/$plug/@items/${p}/control/@props/label`,
  plugType: (i, p) => `DeviceObject/$input/@items/INPUT_${i}/$plug/@items/${p}/status/@props/type`,
  plugSignalValid: (i, p) => `DeviceObject/$input/@items/INPUT_${i}/$plug/@items/${p}/status/signal/@props/isValid`,
  plugFormat: (i, p) => `DeviceObject/$input/@items/INPUT_${i}/$plug/@items/${p}/status/signal/@props/formatName`,
  // The device's own on-air lists: usedOnScreenPgm / usedOnScreenPrw / usedOnAuxPgm / usedOnAuxPrw.
  tally: (bus) => `DeviceObject/tallies/inputs/@props/${bus}`,
  inputSnapshotEnable: (i) => `DeviceObject/$input/@items/INPUT_${i}/snapshot/@props/enable`,
  // The two layers beside the live ones: a background (one of eight sets, or a
  // colour) and a top frame (one of the screen's four top-frame slots).
  bgProp: (n, buffer, tail) => `DeviceObject/$screen/@items/${n}/$preset/@items/${buffer}/background/${tail}`,
  topProp: (n, buffer, tail) => `DeviceObject/$screen/@items/${n}/$preset/@items/${buffer}/top/${tail}`,
  bgSetContent: (n, set) => `DeviceObject/$screen/@items/${n}/$backgroundSet/@items/${set}/control/@props/singleContent`,
  frame: (n, list, k, tail) => `DeviceObject/$screen/@items/${n}/${list === 'top' ? '$topFrame' : '$backFrame'}/@items/${k}/${tail}`,
  // The quick preset: one switch, a mode, a filter of destinations, a status.
  qpEnable: () => 'DeviceObject/quickPreset/control/@props/enable',
  qpMode: () => 'DeviceObject/quickPreset/control/@props/mode',
  qpIsEnabled: () => 'DeviceObject/quickPreset/status/@props/isEnabled',
  qpFilter: (d) => `DeviceObject/quickPreset/control/filter/${MNG_LIST[d.kind]}/@items/${d.n}/@props/enable`,
  qpOn: (d) => `DeviceObject/quickPreset/status/${MNG_LIST[d.kind]}/@items/${d.n}/@props/isEnabled`,
  qpMasterSlot: () => 'DeviceObject/quickPreset/control/mode/master/@props/bankSlot',
  // System.
  deviceLabel: () => 'DeviceObject/system/@props/label',
  serial: () => 'DeviceObject/system/serial/@props/serialNumber',
  temperatureAlarm: () => 'DeviceObject/system/temperature/device/@props/alarm',
  sensor: (name, prop) => `DeviceObject/system/temperature/$sensor/@items/${name}/@props/${prop}`,
  caseFan: (n, prop) => `DeviceObject/system/fan/$case/@items/${n}/@props/${prop}`,
  frontPanel: (prop) => `DeviceObject/system/frontPanel/@props/${prop}`,
  hostname: () => 'DeviceObject/system/network/adapter/@props/hostname',
  ipv4: (prop) => `DeviceObject/system/network/ipv4/status/@props/${prop}`,
  ipv4Dhcp: () => 'DeviceObject/system/network/ipv4/control/@props/enableDhcp',
  reboot: () => 'DeviceObject/system/shutdown/@props/xReboot',
  standbyIsOn: () => 'DeviceObject/system/shutdown/standby/status/@props/isStandbyOn',
  // The multiviewer: twenty widgets on the MTVW output, twenty layout memories.
  mvwWidget: (n, prop) => `DeviceObject/multiviewer/$widget/@items/${n}/control/@props/${prop}`,
  mvwWidgetStatus: (n, prop) => `DeviceObject/multiviewer/$widget/@items/${n}/status/@props/${prop}`,
  mvwSourceValidity: () => 'DeviceObject/multiviewer/status/@props/sourceValidity',
  mvwWidgetValidity: () => 'DeviceObject/multiviewer/status/@props/widgetValidity',
  mvwPresetValid: (s) => `DeviceObject/multiviewer/$bank/@items/${s}/status/@props/isValid`,
  mvwPresetLabel: (s) => `DeviceObject/multiviewer/$bank/@items/${s}/control/@props/label`,
  mvwPresetDelete: (s) => `DeviceObject/multiviewer/$bank/@items/${s}/control/@props/xDelete`,
  mvwLoad: (s) => `DeviceObject/multiviewer/$bank/control/load/$slot/@items/${s}/@props/xRequest`,
  mvwSave: (s) => `DeviceObject/multiviewer/$bank/control/save/$slot/@items/${s}/@props/xRequest`,
  // Timers.
  timer: (n, prop) => `DeviceObject/$timer/@items/TIMER_${n}/control/@props/${prop}`,
  timerState: (n) => `DeviceObject/$timer/@items/TIMER_${n}/status/@props/state`,
  // The still library and the capture into it.
  stillStatus: (s, prop) => `DeviceObject/stillLibrary/$bank/@items/${s}/status/@props/${prop}`,
  stillLabel: (s) => `DeviceObject/stillLibrary/$bank/@items/${s}/control/@props/label`,
  stillDelete: (s) => `DeviceObject/stillLibrary/$bank/@items/${s}/control/@props/xDelete`,
  captureCmd: (prop) => `DeviceObject/stillLibrary/capture/cmd/@props/${prop}`,
  captureStatus: (prop) => `DeviceObject/stillLibrary/capture/status/@props/${prop}`,
  // Outputs, keyed 1..6 and MTVW; the role (applied preconfig) picks the format node.
  outputRole: (k) => `${MNG_CURRENT}/$output/@items/${k}/@props/mode`,
  outputStatus: (k, prop) => `DeviceObject/$output/@items/${k}/status/@props/${prop}`,
  outputLabel: (k) => `DeviceObject/$output/@items/${k}/control/@props/label`,
  outputFormat: (k, role) => `DeviceObject/$output/@items/${k}/format/${role}/control/@props/format`,
  outputFormatUpdate: (k, role) => `DeviceObject/$output/@items/${k}/format/${role}/control/@props/xUpdate`,
  outputFormatValidity: (k, role) => `DeviceObject/$output/@items/${k}/format/${role}/status/@props/formatValidity`,
  outputSetting: (k, prop) => `DeviceObject/$output/@items/${k}/settings/@props/${prop}`,
  outputPattern: (k, prop) => `DeviceObject/$output/@items/${k}/pattern/control/@props/${prop}`,
  outputPlugStatus: (k, plug, prop) => `DeviceObject/$output/@items/${k}/$plug/@items/${plug}/status/@props/${prop}`,
  outputPlugControl: (k, plug, prop) => `DeviceObject/$output/@items/${k}/$plug/@items/${plug}/control/@props/${prop}`,
  outputPlugAudioMode: (k, plug) => `DeviceObject/$output/@items/${k}/$plug/@items/${plug}/audio/control/@props/mode`,
  outputPlugAudioValidity: (k, plug) => `DeviceObject/$output/@items/${k}/$plug/@items/${plug}/audio/status/@props/modeValidity`,
  outputPlugEdid: (k, plug, prop) => `DeviceObject/$output/@items/${k}/$plug/@items/${plug}/edid/status/@props/${prop}`,
  // The output's canvas: area of interest and pitch, each applied with its own xUpdate.
  outputAoi: (k, prop) => `DeviceObject/$output/@items/${k}/canvas/aoi/@props/${prop}`,
  outputPitch: (k, prop) => `DeviceObject/$output/@items/${k}/canvas/pitch/@props/${prop}`,
  outputCanvasStatus: (k, prop) => `DeviceObject/$output/@items/${k}/canvas/status/@props/${prop}`,
  outputHdr: (k, prop) => `DeviceObject/$output/@items/${k}/hdr/control/@props/${prop}`,
  outputHdrStatus: (k, prop) => `DeviceObject/$output/@items/${k}/hdr/status/@props/${prop}`,
  // Custom output formats: one editor, checked and then saved into a slot.
  cfSetting: (prop) => `DeviceObject/customFormats/create/settings/@props/${prop}`,
  cfControl: (prop) => `DeviceObject/customFormats/create/control/@props/${prop}`,
  cfStatus: (prop) => `DeviceObject/customFormats/create/status/@props/${prop}`,
  cfSave: (n) => `DeviceObject/customFormats/create/save/$bank/@items/${n}/@props/xRequest`,
  cfBank: (n, prop) => `DeviceObject/customFormats/$bank/@items/${n}/control/@props/${prop}`,
  cfBankStatus: (n, prop) => `DeviceObject/customFormats/$bank/@items/${n}/status/@props/${prop}`,
  // Input plugs: the settings live on the plug, the keyer with them.
  plugAvailable: (i, p) => `DeviceObject/$input/@items/INPUT_${i}/$plug/@items/${p}/status/@props/isAvailable`,
  plugControl: (i, p, prop) => `DeviceObject/$input/@items/INPUT_${i}/$plug/@items/${p}/control/@props/${prop}`,
  plugStatusProp: (i, p, prop) => `DeviceObject/$input/@items/INPUT_${i}/$plug/@items/${p}/status/@props/${prop}`,
  plugSignal: (i, p, prop) => `DeviceObject/$input/@items/INPUT_${i}/$plug/@items/${p}/status/signal/@props/${prop}`,
  plugSetting: (i, p, tail) => `DeviceObject/$input/@items/INPUT_${i}/$plug/@items/${p}/settings/${tail}`,
  plugHdr: (i, p, prop) => `DeviceObject/$input/@items/INPUT_${i}/$plug/@items/${p}/control/hdr/@props/${prop}`,
  plugHdrStatus: (i, p, prop) => `DeviceObject/$input/@items/INPUT_${i}/$plug/@items/${p}/status/hdr/@props/${prop}`,
  plugEdidCmd: (i, p) => `DeviceObject/$input/@items/INPUT_${i}/$plug/@items/${p}/edid/cmd/@props/data`,
  plugEdidStatus: (i, p) => `DeviceObject/$input/@items/INPUT_${i}/$plug/@items/${p}/edid/status/@props/data`,
  plugEdidExt: (i, p, b, prop) => `DeviceObject/$input/@items/INPUT_${i}/$plug/@items/${p}/edid/status/$extension/@items/BLOCK_${b}/@props/${prop}`,
  inputKeyingAvailable: (i) => `DeviceObject/$input/@items/INPUT_${i}/status/keying/@props/isAvailable`,
  inputCutFillAvailable: (i) => `DeviceObject/$input/@items/INPUT_${i}/status/keying/cutNFill/@props/isAvailable`,
  // The EDID library: user slots 1..64 and the factory DEFAULT_* entries; the
  // editor is the staging area a save files from and a load fills.
  edidBank: (k, prop) => `DeviceObject/system/edid/$bank/@items/${k}/control/@props/${prop}`,
  edidBankStatus: (k, prop) => `DeviceObject/system/edid/$bank/@items/${k}/status/@props/${prop}`,
  edidEdit: (prop) => `DeviceObject/system/edid/edit/control/@props/${prop}`,
  edidEditStatus: (prop) => `DeviceObject/system/edid/edit/status/@props/${prop}`,
  edidSave: (n) => `DeviceObject/system/edid/save/$bank/@items/${n}/@props/xRequest`,
  edidLoad: (n) => `DeviceObject/system/edid/load/$bank/@items/${n}/@props/xRequest`,
  // Screens: layout mode, the canvas as a grid of outputs or free placement, the test pattern.
  screenMode: (n) => `DeviceObject/$screen/@items/${n}/control/@props/mode`,
  screenModeValidity: (n) => `DeviceObject/$screen/@items/${n}/status/@props/modeValidity`,
  screenCanvasWarn: (n) => `DeviceObject/$screen/@items/${n}/canvas/status/@props/hasOverlapWarning`,
  screenGrid: (n, prop) => `DeviceObject/$screen/@items/${n}/canvas/grid/control/@props/${prop}`,
  screenGridStatus: (n, prop) => `DeviceObject/$screen/@items/${n}/canvas/grid/status/@props/${prop}`,
  screenGridOutput: (n, k, prop) => `DeviceObject/$screen/@items/${n}/canvas/grid/$output/@items/${k}/control/@props/${prop}`,
  screenGridSpacing: (n, dim, i) => `DeviceObject/$screen/@items/${n}/canvas/grid/$${dim}Spacing/@items/${i}/control/@props/size`,
  screenGridInfo: (n, i, prop) => `DeviceObject/$screen/@items/${n}/canvas/grid/$infos/@items/${i}/status/@props/${prop}`,
  screenFreeUpdate: (n) => `DeviceObject/$screen/@items/${n}/canvas/free/control/@props/xUpdate`,
  screenFreeSize: (n, prop) => `DeviceObject/$screen/@items/${n}/canvas/free/control/size/@props/${prop}`,
  screenFreeOutput: (n, k, prop) => `DeviceObject/$screen/@items/${n}/canvas/free/control/$output/@items/${k}/@props/${prop}`,
  screenPattern: (n, prop) => `DeviceObject/$screen/@items/${n}/pattern/control/@props/${prop}`,
  // Preconfig: the working configuration, its validity lists, and the NEW and CURRENT states.
  preconfigControl: (prop) => `DeviceObject/preconfig/control/@props/${prop}`,
  preconfigTemplate: (prop) => `DeviceObject/preconfig/control/template/@props/${prop}`,
  preconfigResource: (n, prop) => `DeviceObject/preconfig/control/$resources/@items/${n}/@props/${prop}`,
  preconfigOutput: (k, prop) => `DeviceObject/preconfig/control/$output/@items/${k}/@props/${prop}`,
  preconfigScreen: (n, prop) => `DeviceObject/preconfig/control/$screen/@items/${n}/@props/${prop}`,
  preconfigAux: (n) => `DeviceObject/preconfig/control/$auxiliaryScreen/@items/${n}/@props/enable`,
  preconfigStatus: (prop) => `DeviceObject/preconfig/status/@props/${prop}`,
  preconfigResourceValidity: (n, prop) => `DeviceObject/preconfig/status/$resources/@items/${n}/@props/${prop}`,
  preconfigOutputValidity: (k, prop) => `DeviceObject/preconfig/status/$output/@items/${k}/@props/${prop}`,
  preconfigScreenValidity: (n, prop) => `DeviceObject/preconfig/status/$screen/@items/${n}/@props/${prop}`,
  preconfigState: (state, list, key, prop) => `DeviceObject/preconfig/status/$state/@items/${state}/$${list}/@items/${key}/@props/${prop}`,
  // Configuration slots and the backup / restore that uses them. Export and
  // apply take a list of modules as their trigger; extract takes a flag.
  cfgSlotLabel: (s) => `DeviceObject/system/configuration/storage/$bank/@items/SLOT_${s}/control/@props/label`,
  cfgSlotStatus: (s, prop) => `DeviceObject/system/configuration/storage/$bank/@items/SLOT_${s}/status/@props/${prop}`,
  cfgSlotDelete: (s) => `DeviceObject/system/configuration/storage/$bank/@items/SLOT_${s}/delete/cmd/@props/xRequest`,
  cfgExport: (prop) => `DeviceObject/system/configuration/backup/export/cmd/@props/${prop}`,
  cfgExportStatus: (prop) => `DeviceObject/system/configuration/backup/export/status/@props/${prop}`,
  cfgExtract: (prop) => `DeviceObject/system/configuration/backup/import/extract/cmd/@props/${prop}`,
  cfgExtractStatus: (prop) => `DeviceObject/system/configuration/backup/import/extract/status/@props/${prop}`,
  cfgApply: (prop) => `DeviceObject/system/configuration/backup/import/apply/cmd/@props/${prop}`,
  cfgApplyStatus: (prop) => `DeviceObject/system/configuration/backup/import/apply/status/@props/${prop}`,
  // Streaming.
  streamSlot: (n, prop) => `DeviceObject/streaming/destinationBank/$slot/@items/${n}/@props/${prop}`,
  streamRememberKeys: () => 'DeviceObject/streaming/destinationBank/@props/rememberKeys',
  streamControl: (prop) => `DeviceObject/streaming/control/@props/${prop}`,
  streamTarget: () => 'DeviceObject/streaming/control/destination/@props/target',
  streamVideo: (prop) => `DeviceObject/streaming/control/video/@props/${prop}`,
  streamAudio: (prop) => `DeviceObject/streaming/control/audio/@props/${prop}`,
  streamAudioLive: (prop) => `DeviceObject/streaming/control/audio/live/@props/${prop}`,
  streamStatus: (prop) => `DeviceObject/streaming/status/@props/${prop}`,
  streamVideoStatus: (prop) => `DeviceObject/streaming/status/video/@props/${prop}`,
  streamAudioStatus: (prop) => `DeviceObject/streaming/status/audio/@props/${prop}`,
  // Audio: the clock, the sources, every routing point, mutes, custom mixes, levels, Dante.
  audioControl: (prop) => `DeviceObject/audio/control/@props/${prop}`,
  audioStatus: (prop) => `DeviceObject/audio/status/@props/${prop}`,
  audioSourceAvailable: (key) => `DeviceObject/audio/$source/@items/${key}/status/@props/isAvailable`,
  audioInputStatus: (key, prop) => `DeviceObject/audio/$input/@items/${key}/status/@props/${prop}`,
  audioInputChannelMute: (key, ch) => `DeviceObject/audio/$input/@items/${key}/$channel/@items/${ch}/control/@props/mute`,
  audioLevelSelect: (side) => `DeviceObject/audio/$${side}/level/control/@props/select`,
  audioLevelRefresh: (side) => `DeviceObject/audio/$${side}/level/control/@props/xRefresh`,
  audioLevel: (side) => `DeviceObject/audio/$${side}/level/status/@props/level`,
  audioOutputMute: (key) => `DeviceObject/audio/$output/@items/${key}/control/@props/mute`,
  audioOutputStatus: (key, prop) => `DeviceObject/audio/$output/@items/${key}/status/@props/${prop}`,
  audioOutputChannelMute: (key, ch) => `DeviceObject/audio/$output/@items/${key}/$channel/@items/${ch}/control/@props/mute`,
  audioLineOut: (n, prop) => `DeviceObject/audio/$lineOut/@items/${n}/control/@props/${prop}`,
  audioLineOutDirect: (n) => `DeviceObject/audio/$lineOut/@items/${n}/control/directRouting/@props/source`,
  audioLineOutFollow: (n) => `DeviceObject/audio/$lineOut/@items/${n}/control/followScreen/@props/screen`,
  audioDestMute: (d) => `DeviceObject/audio/${MNG_LIST[d.kind]}/@items/${d.n}/control/@props/mute`,
  audioCustomChannels: () => 'DeviceObject/audio/custom/status/@props/availableChannels',
  audioCustom: (n, prop) => `DeviceObject/audio/custom/$source/@items/CUSTOM_${n}/control/@props/${prop}`,
  danteControl: (prop) => `DeviceObject/audio/dante/control/@props/${prop}`,
  danteStatus: (prop) => `DeviceObject/audio/dante/status/@props/${prop}`,
  danteIp: (which, prop) => `DeviceObject/audio/dante/ipv4/${which}/status/@props/${prop}`,
  danteChannelAvailable: (n) => `DeviceObject/audio/dante/$channel/@items/${n}/status/@props/isAvailable`,
  danteChannelSource: (n, prop) => `DeviceObject/audio/dante/$channel/@items/${n}/source/status/@props/${prop}`,
  danteChannelSourceCmd: (n, prop) => `DeviceObject/audio/dante/$channel/@items/${n}/source/cmd/@props/${prop}`,
  danteChannelTx: (n) => `DeviceObject/audio/dante/$channel/@items/${n}/transmitter/status/@props/label`,
  danteChannelTxCmd: (n, prop) => `DeviceObject/audio/dante/$channel/@items/${n}/transmitter/cmd/@props/${prop}`,
  danteGroup: (n, prop) => `DeviceObject/audio/dante/$outputGroup/@items/${n}/control/@props/${prop}`,
  danteGroupDirect: (n) => `DeviceObject/audio/dante/$outputGroup/@items/${n}/control/directRouting/@props/source`,
  danteGroupFollow: (n) => `DeviceObject/audio/dante/$outputGroup/@items/${n}/control/followScreen/@props/screen`,
  // Per destination: the routing point on the screen or auxiliary, and the
  // audio layer each of its buffers carries.
  destAudioMode: (d) => `DeviceObject/${MNG_LIST[d.kind]}/@items/${d.n}/audio/control/@props/mode`,
  destAudioDirect: (d) => `DeviceObject/${MNG_LIST[d.kind]}/@items/${d.n}/audio/control/directRouting/@props/source`,
  screenAudioFollowLayer: (n) => `DeviceObject/$screen/@items/${n}/audio/control/followLiveLayer/@props/layer`,
  audioLayer: (d, buffer) => `DeviceObject/${MNG_LIST[d.kind]}/@items/${d.n}/$preset/@items/${buffer}/audio/control/@props/source`,
  audioLayerStatus: (d, buffer) => `DeviceObject/${MNG_LIST[d.kind]}/@items/${d.n}/$preset/@items/${buffer}/audio/status/@props/source`,
  outputAudioMode: (k) => `DeviceObject/$output/@items/${k}/audio/control/@props/mode`,
  outputAudioDirect: (k) => `DeviceObject/$output/@items/${k}/audio/control/directRouting/@props/source`,
  mvwAudio: (prop) => `DeviceObject/multiviewer/audio/control/@props/${prop}`,
  mvwAudioDirect: () => 'DeviceObject/multiviewer/audio/control/directRouting/@props/source',
  mvwAudioVu: () => 'DeviceObject/multiviewer/audio/control/vuMeters/@props/widget',
  mvwAudioFollow: () => 'DeviceObject/multiviewer/audio/control/followWidget/@props/widget',
  mvwAudioStatus: (prop) => `DeviceObject/multiviewer/audio/status/@props/${prop}`,
  mvwAudioVuValidity: () => 'DeviceObject/multiviewer/audio/status/vuMeters/@props/widgetValidity',
  qpAudioMode: () => 'DeviceObject/quickPreset/control/audio/@props/mode',
  qpAudioForce: () => 'DeviceObject/quickPreset/control/audio/forceSource/@props/source',
  // LUTs: two libraries of slots the device loads .cube files into (from a
  // path on the unit — the Web RCS uploads them), four LUT resources each
  // allocated to an input, and per plug / output a conversion LUT (colour
  // space and HDR) and a correction LUT, picked from the validity lists.
  lutBank: (kind, n, prop) => `DeviceObject/lutLibraries/${kind}/$bank/@items/${n}/control/@props/${prop}`,
  lutBankStatus: (kind, n, prop) => `DeviceObject/lutLibraries/${kind}/$bank/@items/${n}/status/@props/${prop}`,
  lutResource: (n) => `DeviceObject/$inputLutResource/@items/${n}/control/@props/useOnInput`,
  plugConversionLut: (i, p, prop) => `DeviceObject/$input/@items/INPUT_${i}/$plug/@items/${p}/control/conversionLut/@props/${prop}`,
  plugConversionLutStatus: (i, p, prop) => `DeviceObject/$input/@items/INPUT_${i}/$plug/@items/${p}/status/conversionLut/@props/${prop}`,
  plugCorrectionLut: (i, p, prop) => `DeviceObject/$input/@items/INPUT_${i}/$plug/@items/${p}/settings/correctionLut/control/@props/${prop}`,
  plugCorrectionLutStatus: (i, p, prop) => `DeviceObject/$input/@items/INPUT_${i}/$plug/@items/${p}/settings/correctionLut/status/@props/${prop}`,
  outputConversionLut: (k, prop) => `DeviceObject/$output/@items/${k}/conversionLut/control/@props/${prop}`,
  outputConversionLutStatus: (k, prop) => `DeviceObject/$output/@items/${k}/conversionLut/status/@props/${prop}`,
  outputCorrectionLut: (k, prop) => `DeviceObject/$output/@items/${k}/settings/correctionLut/control/@props/${prop}`,
  outputCorrectionLutStatus: (k, prop) => `DeviceObject/$output/@items/${k}/settings/correctionLut/status/@props/${prop}`,
  // Soft edge on a grid gap (models that blend): the curve and the black level, applied with xSoftedgeUpdate.
  screenGridSoftedge: (n, dim, i, tail) => `DeviceObject/$screen/@items/${n}/canvas/grid/$${dim}Spacing/@items/${i}/softedge/${tail}`,
  // Autoscale on load: per screen for the preset banks, one flag for the multiviewer's.
  presetAutoScale: (n) => `DeviceObject/preset/bank/control/$screen/@items/${n}/@props/autoScale`,
  mvwLoadAutoScale: () => 'DeviceObject/multiviewer/$bank/control/load/@props/autoScale',
  // What a bank save records, set on the destination (or the master bank) before the save.
  saveFilter: (root, d, prop) => `DeviceObject/${root}/control/save/${MNG_LIST[d.kind]}/@items/${d.n}/@props/${prop}`,
  masterSaveFilter: (prop) => `DeviceObject/preset/masterBank/control/save/@props/${prop}`,
  // Both lists' control and status, one prefix.
  SUB_TRANSITIONS: 'DeviceObject/transition',
  SUB_TALLIES: 'DeviceObject/tallies',
  SUB_INPUTS: 'DeviceObject/$input',
  SUB_QUICK_PRESET: 'DeviceObject/quickPreset',
  SUB_SYSTEM: 'DeviceObject/system',
  SUB_MULTIVIEWER: 'DeviceObject/multiviewer',
  SUB_TIMERS: 'DeviceObject/$timer',
  SUB_STILLS: 'DeviceObject/stillLibrary',
  SUB_OUTPUTS: 'DeviceObject/$output',
  SUB_AUDIO: 'DeviceObject/audio',
  SUB_PRECONFIG: 'DeviceObject/preconfig',
  SUB_SCREENS: 'DeviceObject/$screen',
  SUB_STREAMING: 'DeviceObject/streaming',
  SUB_CUSTOM_FORMATS: 'DeviceObject/customFormats',
};
const MNG_MVW_WIDGETS = 27;   // slots on an Alta 4K; a Midra 4K has 20, and widgetValidity says which are usable
const MNG_TIMERS = 3;
const MNG_STILL_SLOTS = 50;
const MNG_OUTPUTS = ['1', '2', '3', '4', '5', '6', 'MTVW'];
const MNG_INPUTS = 16;
const MNG_TALLY_BUSES = ['usedOnScreenPgm', 'usedOnScreenPrw', 'usedOnAuxPgm', 'usedOnAuxPrw'];

// Every transition state names the end the T-bar is at or came from, so the
// rule is the DOWN/UP suffix. Testing only for AT_UP gets the four in-flight
// states backwards, invisibly, for exactly the length of a transition.
const awjProgramIsDown = (t) => typeof t === 'string' && t.endsWith('DOWN');
const awjResting = (t) => t === 'AT_UP' || t === 'AT_DOWN';

/** `S1` -> {id, kind:'screen', n:1}; `A2` -> {id, kind:'aux', n:2}. */
function awjDest(id) {
  const m = /^([SA])(\d+)$/.exec(String(id || ''));
  return m ? { id, kind: m[1] === 'A' ? 'aux' : 'screen', n: Number(m[2]) } : null;
}

const awjSeconds = (tenths) => (tenths == null ? '·' : (tenths / 10).toFixed(1));

// The two spellings behind one interface. A view calls these with a
// destination id and a bank kind and never sees a path.
const AWJ_DIALECTS = {
  // LivePremier: screens only in this surface, lettered buffers whose names
  // the device reports, a take-up/take-down pair, one 1000-slot screen bank.
  nlc: {
    model: () => store.pval(LP.model()),
    otherModel: () => store.pval(MNG.model()),
    destinations: () =>
      Array.from({ length: LP_SCREENS }, (_, i) => i + 1)
        .filter(s => store.pval(LP.isUsed(s)) === true)
        .map(s => awjDest(`S${s}`)),
    label: (d) => store.pval(LP.label(d.n)),
    transition: (d) => store.pval(LP.transition(d.n)),
    // `status/take` is OFF, TO_UP or TO_DOWN; anything but OFF is a fade in
    // progress. The in-flight transition states say the same thing.
    inFlight(d) {
      const taking = store.pval(LP.takeStatus(d.n));
      return typeof taking === 'string' && taking !== 'OFF' ? String(taking).toLowerCase() : null;
    },
    // The letter addressing a side of a screen. A device reports its own, and
    // does not always use A and B, so these are read rather than assumed.
    buffers(d) {
      const t = store.pval(LP.transition(d.n));
      const down = store.pval(LP.letter(d.n, 'Down'), 'A');
      const up = store.pval(LP.letter(d.n, 'Up'), 'B');
      return awjProgramIsDown(t) ? { program: down, preview: up } : { program: up, preview: down };
    },
    takeTimes: (d) => [store.pval(LP.takeTime(d.n, true)), store.pval(LP.takeTime(d.n, false))],
    takeTimesHead: 'Take up / down',
    take: (d) => store.pset(LP.take(d.n), true),
    cut: (d) => store.pset(LP.cut(d.n), true),
    refresh(d) { store.pget(LP.transition(d.n)); store.pget(LP.takeStatus(d.n)); },
    subscriptions: () => [LP.SUB_SCREENS],
    // Which memory a buffer holds is published in the bank on this model,
    // keyed by letter, and this surface does not read it yet.
    showsMemory: false,
    memoryOn: () => null,
    banks: [{ kind: 'screen', label: 'Screen', slots: 1000, targets: 'screen' }],
    presetValid: (bank, n) => store.pval(LP.presetValid(n)),
    presetLabel: (bank, n) => store.pval(LP.presetLabel(n)),
    fetchSlot(bank, n) { store.pget(LP.presetValid(n)); store.pget(LP.presetLabel(n)); },
    recall(bank, slot, d, target) { store.pset(LP.loadScreen(slot, d.n, target), true); },
  },

  // Midra 4K / Alta 4K: four screens and four auxiliaries whether or not any
  // is set up, buffers literally named UP and DOWN, one take time, and three
  // banks — the auxiliaries have one of their own.
  mng: {
    model: () => store.pval(MNG.model()),
    otherModel: () => store.pval(LP.model()),
    destinations: () => [
      ...[1, 2, 3, 4].filter(n => store.pval(MNG.screenEnabled(n)) === true).map(n => awjDest(`S${n}`)),
      ...[1, 2, 3, 4].filter(n => { const m = store.pval(MNG.auxMode(n)); return m !== undefined && m !== 'DISABLE'; }).map(n => awjDest(`A${n}`)),
    ],
    label: (d) => store.pval(MNG.label(d)),
    transition: (d) => store.pval(MNG.transition(d)),
    // No `status/take` on this model; the four in-flight states are the only
    // sign of a fade in progress, and the honest one.
    inFlight(d) {
      const t = store.pval(MNG.transition(d));
      return typeof t === 'string' && !awjResting(t) ? t.toLowerCase().replace(/_/g, ' ') : null;
    },
    // The vendor's own rule: UP is program for the three `…UP` states.
    buffers(d) {
      const t = store.pval(MNG.transition(d));
      return awjProgramIsDown(t) ? { program: 'DOWN', preview: 'UP' } : { program: 'UP', preview: 'DOWN' };
    },
    takeTimes: (d) => [store.pval(MNG.takeTime(d))],
    takeTimesHead: 'Take time',
    take: (d) => store.pset(MNG.take(d), true),
    cut: (d) => store.pset(MNG.cut(d), true),
    refresh(d) {
      store.pget(MNG.transition(d));
      store.pget(MNG.memoryId(d, 'UP'));
      store.pget(MNG.memoryId(d, 'DOWN'));
    },
    // Transitions for every destination, plus the memory bookkeeping of each
    // one in service — a recall made anywhere then shows up here too.
    subscriptions() {
      return [MNG.SUB_TRANSITIONS, MNG.SUB_TALLIES, MNG.SUB_QUICK_PRESET,
        ...this.destinations().flatMap(d => ['UP', 'DOWN'].map(b => MNG.bufferStatus(d, b)))];
    },
    // The device's emergency key. Its switch is a flag, not a trigger: true
    // puts the mode's content on every destination the filter includes,
    // false takes it off again.
    quickPreset: {
      isOn: () => store.pval(MNG.qpIsEnabled()) === true,
      wanted: () => store.pval(MNG.qpEnable()) === true,
      mode: () => store.pval(MNG.qpMode()),
      masterSlot: () => store.pval(MNG.qpMasterSlot()),
      covers: (d) => store.pval(MNG.qpFilter(d)) === true,
      onDest: (d) => store.pval(MNG.qpOn(d)) === true,
      // The switch answers at once; each destination reports itself on or
      // off only once its fade has run, so that is read again after one.
      set(on) {
        store.pset(MNG.qpEnable(), on);
        if (awjLive) return;
        const re = () => { store.pget(MNG.qpEnable()); store.pget(MNG.qpIsEnabled()); for (const d of awj().destinations()) store.pget(MNG.qpOn(d)); };
        setTimeout(re, 150); setTimeout(re, 1500);
      },
      setMode(m) { store.pset(MNG.qpMode(), m); if (!awjLive) setTimeout(() => store.pget(MNG.qpMode()), 150); },
      setCovers(d, on) { store.pset(MNG.qpFilter(d), on); if (!awjLive) setTimeout(() => store.pget(MNG.qpFilter(d)), 150); },
      refresh(dests) { for (const p of [MNG.qpEnable(), MNG.qpMode(), MNG.qpIsEnabled(), MNG.qpMasterSlot()]) store.pget(p); for (const d of dests) { store.pget(MNG.qpFilter(d)); store.pget(MNG.qpOn(d)); } },
    },
    // The rest of the take node. Every one is feature-detected by the views,
    // so the LivePremier dialect simply lacks them.
    stepBack: (d) => store.pset(MNG.stepBack(d), true),
    copyToPreview: (d) => store.pset(MNG.copyToPreview(d), true),
    frozen: (d) => store.pval(MNG.freeze(d)) === true,
    setFrozen(d, on) { store.pset(MNG.freeze(d), on); if (!awjLive) setTimeout(() => store.pget(MNG.freeze(d)), 120); },
    tbar: (d) => store.pval(MNG.tbarStatus(d)),
    setTbar: (d, v) => pthrottledSet(MNG.tbarControl(d), Math.max(0, Math.min(65535, Math.round(v)))),
    presetToggle: (d) => store.pval(MNG.presetToggle(d)),
    setPresetToggle(d, on) { store.pset(MNG.presetToggle(d), on); if (!awjLive) setTimeout(() => store.pget(MNG.presetToggle(d)), 120); },
    setTakeTime(d, tenths) { store.pset(MNG.takeTime(d), Math.max(0, Math.min(3000, Math.round(tenths)))); if (!awjLive) setTimeout(() => store.pget(MNG.takeTime(d)), 120); },
    // TAKE ALL the way the vendor's Web RCS does it: one xTake per
    // destination, back to back. (The take node also carries an `xTakeMany`
    // list; the simulator ignores it and the vendor UI never writes it.)
    takeMany(dests) { for (const d of dests) store.pset(MNG.take(d), true); },
    refreshExtras(d) { store.pget(MNG.freeze(d)); store.pget(MNG.tbarStatus(d)); store.pget(MNG.presetToggle(d)); },
    // Bank writes. A screen or auxiliary saves one of its buffers. A master
    // save records what `mode` says: from a buffer, the device first stores
    // every in-service destination's buffer into that destination's own bank
    // at `bankSlot` — 1 for all of them out of the box, which is how a master
    // save overwrites screen memory 1 — so the slots are written first, to
    // the master's own number, and the view refuses when any is occupied.
    // `EXISTING` records the memories the buffers already hold and writes no
    // bank slot at all.
    save(bank, slot, d, from) {
      if (bank.kind !== 'master') { store.pset(MNG.save(bank.root, slot, d, from), true); return; }
      if (from === 'EXISTING') store.pset(MNG.masterSaveMode(), 'USE_EXISTING_MEMORIES');
      else {
        for (const dest of this.destinations()) store.pset(MNG.masterSaveBankSlot(dest), slot);
        store.pset(MNG.masterSaveMode(), from === 'PROGRAM' ? 'SAVE_FROM_PGM' : 'SAVE_FROM_PRW');
      }
      store.pset(MNG.saveMaster(slot), true);
    },
    // The screen/aux slots a master save from a buffer would write, and
    // which of them already hold something.
    masterSaveTouches(slot) {
      return this.destinations().map(dest => {
        const b = this.banks.find(x => x.kind === dest.kind);
        return { dest, bank: b, occupied: store.pval(MNG.presetValid(b.root, slot)) === true };
      });
    },
    erase: (bank, slot) => store.pset(MNG.presetDelete(bank.root, slot), true),
    setLabel: (bank, slot, text) => store.pset(MNG.presetLabel(bank.root, slot), String(text ?? '')),
    // Which memory a buffer holds is on the destination here: 0 when it was
    // not loaded from one.
    showsMemory: true,
    memoryOn(d, which) {
      const id = store.pval(MNG.memoryId(d, this.buffers(d)[which]));
      return typeof id === 'number' && id > 0 ? id : null;
    },
    banks: [
      { kind: 'screen', label: 'Screen', slots: 200, targets: 'screen', root: 'preset/bank' },
      { kind: 'aux', label: 'Aux', slots: 200, targets: 'aux', root: 'preset/auxBank' },
      { kind: 'master', label: 'Master', slots: 50, targets: 'none', root: 'preset/masterBank' },
    ],
    presetValid: (bank, n) => store.pval(MNG.presetValid(bank.root, n)),
    presetLabel: (bank, n) => store.pval(MNG.presetLabel(bank.root, n)),
    fetchSlot(bank, n) { store.pget(MNG.presetValid(bank.root, n)); store.pget(MNG.presetLabel(bank.root, n)); },
    recall(bank, slot, d, target) {
      if (bank.kind === 'master') store.pset(MNG.loadMaster(slot, target), true);
      else store.pset(MNG.load(bank.root, slot, d, target), true);
    },
  },
};

const awj = () => AWJ_DIALECTS[awjDialect()];

// The other object model's identity is read on connect too. Both models share
// the port, so a wrong pick connects fine and shows an empty show; this is the
// one thing that can say why.
function awjMismatch() {
  const other = awj().otherModel();
  if (typeof other !== 'string') return null;
  const name = AWJ_MODELS[other] || other;
  const pick = awjDialect() === 'nlc' ? 'Midra 4K or Alta 4K' : 'LivePremier';
  return `This processor reports itself as ${name}, which is not a ${awjSeriesName()}. Pick ${pick} in Connection.`;
}

// ---------- AWJ: live subscriptions, shared ----------
// The device's subscription list is one list per connection and every write
// of it is a replace, so the views cannot each keep their own: whichever wrote
// last would silence the rest. One flag, one union — the dialect's base
// prefixes (transitions, memory bookkeeping, tallies) plus whatever the view
// on screen asked for — and the toggle lives on every view that needs pushes.
let awjLive = false;
let awjViewSubs = () => [];
function awjApplySubs() {
  if (!isAwj()) return;
  store.psub(awjLive ? [...new Set([...awj().subscriptions(), ...awjViewSubs()])] : []);
}
function setAwjLive(on) { awjLive = on; awjApplySubs(); store.notify(); }
function awjLiveRow(what = 'changes') {
  return el('div', { class: 'row' },
    el('button', { class: awjLive ? 'btn primary' : 'btn', onclick: () => setAwjLive(!awjLive) },
      awjLive ? 'Live updates on' : 'Live updates off'),
    el('span', { class: 'hint', text: awjLive
      ? `The device is pushing ${what} to this bridge.`
      : 'This processor tells a client nothing until asked to. Until this is on, what you see is what was last read.' }));
}

// AWJ writes from a drag: the same 40 ms gate as the mnemonic side, keyed by path.
function pthrottledSet(path, v) {
  const now = performance.now();
  const last = _throttle.get(path) || 0;
  if (now - last > 40) { _throttle.set(path, now); store.pset(path, v); }
  else { clearTimeout(_throttle.get(path + ':t')); _throttle.set(path + ':t', setTimeout(() => store.pset(path, v), 45)); }
}

// ---------- Midra 4K / Alta 4K: the live-layer property set ----------
// The fifty-seven leaves a live layer carries, with the ranges and enums the
// device declares — read off a Pulse 4K's own bundle and store, not guessed.
// Position and size are what the canvas edits; the rest is the properties
// panel. `opacity` runs to 256, not 255; borders and shadows to 255.
const MNG_ENUMS = {
  LAYER_ASPECT: ['GLOBAL_SETTING', '1_1', 'CENTERED', 'FULLSCREEN', 'CROPPED', 'INPUT_SETTING'],
  PRESET_EFFECT_FLAGS: ['FLIP_H', 'FLIP_V', 'BLACK_N_WHITE', 'NEGATIVE', 'SEPIA', 'SOLAR'],
  LAYER_BORDER_FLAGS: ['EDGE', 'SMOOTH', 'ROUNDED'],
  PRESET_TRANSITION_FLAGS: ['DISABLE_CROSS_EFFECT', 'DISABLE_CROSS_DEPTH'],
  LAYER_TRANSITION: ['CUT', 'FADE', 'SLIDE', 'WIPE', 'CIRCLE', 'STRETCH'],
  LAYER_TRANSITION_WAY: ['LEFT_TO_RIGHT', 'RIGHT_TO_LEFT', 'BOTTOM_TO_UP', 'UP_TO_BOTTOM', 'V_FROM_TO_CENTER', 'H_FROM_TO_CENTER', 'HV_FROM_TO_CENTER', 'SW_TO_NE', 'SE_TO_NW', 'NW_TO_SE', 'NE_TO_SW'],
  PRESET_FLYING_TYPE: ['LINEAR', 'BEZIER_1PT', 'BEZIER_2PT', 'DEVIANT_CLOCKWISE', 'DEVIANT_ANTICLOCKWISE'],
  PRESET_TRANSITION_SPEED: ['LINEAR', 'SMOOTH'],
};
const MNG_GEOM = {
  posH: 'position/@props/posH', posV: 'position/@props/posV',
  sizeH: 'size/@props/sizeH', sizeV: 'size/@props/sizeV',
  source: 'source/@props/input', opacity: 'opacity/@props/opacity', state: 'status/@props/state',
};
const pct256 = (v) => Math.round(v / 256 * 100) + '%';
const MNG_LAYER_PROPS = [
  { g: 'Opacity', items: [
    { tail: 'opacity/@props/opacity', label: 'Opacity', type: 'range', min: 0, max: 256, fmt: pct256 },
    { tail: 'opacity/@props/inhibitKeying', label: 'Inhibit keying', type: 'bool' }] },
  { g: 'Crop', items: [
    { tail: 'crop/@props/top', label: 'Top', type: 'int', min: 0, max: 65535 },
    { tail: 'crop/@props/bottom', label: 'Bottom', type: 'int', min: 0, max: 65535 },
    { tail: 'crop/@props/left', label: 'Left', type: 'int', min: 0, max: 65535 },
    { tail: 'crop/@props/right', label: 'Right', type: 'int', min: 0, max: 65535 },
    { tail: 'crop/@props/aspectOverride', label: 'Aspect', type: 'enum', values: MNG_ENUMS.LAYER_ASPECT }] },
  { g: 'Mask', items: [
    { tail: 'mask/@props/top', label: 'Top', type: 'int', min: 0, max: 65535 },
    { tail: 'mask/@props/bottom', label: 'Bottom', type: 'int', min: 0, max: 65535 },
    { tail: 'mask/@props/left', label: 'Left', type: 'int', min: 0, max: 65535 },
    { tail: 'mask/@props/right', label: 'Right', type: 'int', min: 0, max: 65535 }] },
  { g: 'Effects', items: [
    { tail: 'effects/@props/flags', label: 'Effects', type: 'flags', values: MNG_ENUMS.PRESET_EFFECT_FLAGS }] },
  { g: 'Border', items: [
    { tail: 'border/edge/@props/style', label: 'Style', type: 'flags', values: MNG_ENUMS.LAYER_BORDER_FLAGS },
    { tail: 'border/edge/@props/sizeH', label: 'Width', type: 'int', min: 0, max: 255 },
    { tail: 'border/edge/@props/sizeV', label: 'Height', type: 'int', min: 0, max: 255 },
    { tail: 'border/edge/@props/radius', label: 'Radius', type: 'int', min: 0, max: 255 },
    { tail: 'border/edge/@props/opacity', label: 'Opacity', type: 'range', min: 0, max: 255, fmt: v => Math.round(v / 255 * 100) + '%' },
    { tail: 'border/edge/color/@props/red', label: 'Red', type: 'int', min: 0, max: 255 },
    { tail: 'border/edge/color/@props/green', label: 'Green', type: 'int', min: 0, max: 255 },
    { tail: 'border/edge/color/@props/blue', label: 'Blue', type: 'int', min: 0, max: 255 }] },
  { g: 'Shadow', items: [
    { tail: 'border/shadow/@props/style', label: 'Style', type: 'flags', values: MNG_ENUMS.LAYER_BORDER_FLAGS },
    { tail: 'border/shadow/@props/sizeH', label: 'Offset X', type: 'int', min: -512, max: 512 },
    { tail: 'border/shadow/@props/sizeV', label: 'Offset Y', type: 'int', min: -512, max: 512 },
    { tail: 'border/shadow/@props/radius', label: 'Radius', type: 'int', min: 0, max: 255 },
    { tail: 'border/shadow/@props/opacity', label: 'Opacity', type: 'range', min: 0, max: 255, fmt: v => Math.round(v / 255 * 100) + '%' }] },
  { g: 'Transitions', items: [
    { tail: 'transition/opening/@props/type', label: 'Opening', type: 'enum', values: MNG_ENUMS.LAYER_TRANSITION },
    { tail: 'transition/opening/@props/way', label: 'Opening way', type: 'enum', values: MNG_ENUMS.LAYER_TRANSITION_WAY },
    { tail: 'transition/closing/@props/type', label: 'Closing', type: 'enum', values: MNG_ENUMS.LAYER_TRANSITION },
    { tail: 'transition/closing/@props/way', label: 'Closing way', type: 'enum', values: MNG_ENUMS.LAYER_TRANSITION_WAY },
    { tail: 'transition/@props/flags', label: 'Cross', type: 'flags', values: MNG_ENUMS.PRESET_TRANSITION_FLAGS },
    { tail: 'flying/@props/type', label: 'Flying curve', type: 'enum', values: MNG_ENUMS.PRESET_FLYING_TYPE },
    { tail: 'speed/@props/type', label: 'Speed', type: 'enum', values: MNG_ENUMS.PRESET_TRANSITION_SPEED }] },
];

// ---------- Midra 4K / Alta 4K: inputs, shared by the views ----------
// Labels live on plugs, so the input's active plug has to be known before its
// label can be asked for; this fetches that second layer once per plug seen.
const mngInputs = (() => {
  const fetched = new Set();
  function ensure(i) {
    const plug = store.pval(MNG.inputPlug(i));
    if (plug == null) return;
    const k = `${i}:${plug}`;
    if (fetched.has(k)) return;
    fetched.add(k);
    for (const p of [MNG.plugLabel(i, plug), MNG.plugType(i, plug), MNG.plugSignalValid(i, plug), MNG.plugFormat(i, plug)]) store.pget(p);
  }
  function refresh() {
    fetched.clear();
    for (let i = 1; i <= MNG_INPUTS; i++)
      for (const p of [MNG.inputAvailable(i), MNG.inputLed(i), MNG.inputPlug(i), MNG.inputFreeze(i), MNG.inputBlack(i)]) store.pget(p);
    for (const b of MNG_TALLY_BUSES) store.pget(MNG.tally(b));
  }
  /** One input, as the surface sees it. */
  function get(i) {
    ensure(i);
    const plug = store.pval(MNG.inputPlug(i));
    const at = (f) => (plug == null ? undefined : store.pval(f(i, plug)));
    return {
      n: i, key: `INPUT_${i}`,
      available: store.pval(MNG.inputAvailable(i)),
      led: store.pval(MNG.inputLed(i)),
      plug,
      label: at(MNG.plugLabel) || '',
      type: at(MNG.plugType),
      signal: at(MNG.plugSignalValid),
      format: at(MNG.plugFormat),
      frozen: store.pval(MNG.inputFreeze(i)) === true,
      black: store.pval(MNG.inputBlack(i)) === true,
    };
  }
  /** The inputs this unit actually has, in order. */
  function available() {
    const out = [];
    for (let i = 1; i <= MNG_INPUTS; i++) if (store.pval(MNG.inputAvailable(i)) === true) out.push(get(i));
    return out;
  }
  /** Which buses an input is on right now, from the device's own lists. */
  function tally(key) {
    const on = (b) => (store.pval(MNG.tally(b)) || []).includes(key);
    return { pgm: on('usedOnScreenPgm') || on('usedOnAuxPgm'), pvw: on('usedOnScreenPrw') || on('usedOnAuxPrw') };
  }
  /** `INPUT_7` -> "IN 7 · Stage"; `COLOR` -> "Colour"; NONE -> "— none —". */
  function name(v) {
    if (!v || v === 'NONE') return '— none —';
    if (v === 'COLOR') return 'Colour';
    const m = /^INPUT_(\d+)$/.exec(v);
    if (!m) return String(v);
    const lbl = get(+m[1]).label;
    return `IN ${m[1]}${lbl ? ' · ' + lbl : ''}`;
  }
  function sourceOptions(cur) {
    const opts = [{ v: 'NONE', text: '— none —' }];
    for (const i of available()) opts.push({ v: i.key, text: `IN ${i.n}${i.label ? ' · ' + i.label : ''}${i.signal === false ? ' (no signal)' : ''}` });
    opts.push({ v: 'COLOR', text: 'Colour' });
    if (cur && !opts.some(o => o.v === cur)) opts.push({ v: cur, text: String(cur) });
    return opts;
  }
  return { ensure, refresh, get, available, tally, name, sourceOptions };
})();

const mngSourceColor = (v) => {
  const m = /^INPUT_(\d+)$/.exec(String(v || ''));
  if (m) return srcColor(+m[1]);
  return v === 'COLOR' ? '#777' : 'transparent';
};

// ---------- Midra 4K / Alta 4K: snapshots ----------
// The unit serves a small PNG per input, output and multiviewer, and one per
// screen frame slot, from its own HTTP server — port 80 on a unit; a
// simulator puts it wherever it was started, so the origin can be overridden
// in Connection. Each input keeps its snapshot only while its `snapshot/
// enable` is on, which the views turn on for the inputs the unit has.
let MNG_SNAP_TICK = 0;
const mngSnapshotOrigin = () => {
  let o = '';
  try { o = localStorage.getItem('orcs.snapshotOrigin') || ''; } catch { /* private mode */ }
  return o || store.meta?.host || '';
};
const mngSnapshotsWork = () => awjDialect() === 'mng' && !!mngSnapshotOrigin();
function mngSnapshotUrl(kind, id) {
  if (!mngSnapshotsWork()) return null;
  // the tick is the whole cache-busting story, as on LiveCore: a stable URL
  // between ticks means a re-render reuses the cached image
  return `http://${mngSnapshotOrigin()}/api/device/snapshots/${kind}/${id}?t=${MNG_SNAP_TICK}`;
}
function startMngSnapshots() {
  if (startMngSnapshots.timer) return;
  startMngSnapshots.timer = setInterval(() => {
    if (!mngSnapshotsWork() || document.hidden) return;
    if (!['lplayers', 'lpinputs', 'lpmultiview', 'lpoutputs', 'lpstills', 'lpshow'].includes(currentView)) return;
    MNG_SNAP_TICK++;
    store.notify();
  }, 4000);
}
/** Ask the unit to keep a snapshot of every input it has. Written only where off. */
function mngEnableSnapshots() {
  for (const i of mngInputs.available()) {
    const p = MNG.inputSnapshotEnable(i.n);
    if (store.pval(p) === false) store.pset(p, true);
  }
}

// ---------- AWJ: System (Midra 4K / Alta 4K) ----------
VIEWS.lpsystem = (() => {
  let read = false;
  let armReboot = false;
  const SENSORS = ['CM_INTAKE', 'CM_OUTTAKE', 'CF_MEZZA_RJ45_IN', 'CF_MEZZA_RJ45_OUT', 'CF_MEZZA_AUDIO',
    'CF_OPT_VIDEO_OPTION_1', 'CF_OPT_VIDEO_OPTION_2', 'FPGA_BALERION', 'FPGA_MERAXES',
    'FPGA_VIDEO_OPT_1_SCALER', 'FPGA_VIDEO_OPT_1_IO', 'FPGA_VIDEO_OPT_2_SCALER', 'FPGA_VIDEO_OPT_2_IO', 'VEGA'];
  function settle() {
    if (read || !store.meta || !store.connected) return;
    read = true;
    for (const p of [MNG.serial(), MNG.deviceLabel(), MNG.temperatureAlarm(), MNG.frontPanel('lock'),
      MNG.frontPanel('lcdBrightness'), MNG.frontPanel('keyBrightness'), MNG.hostname(), MNG.ipv4('ip'),
      MNG.ipv4('netmask'), MNG.ipv4('gateway'), MNG.ipv4('dns'), MNG.ipv4Dhcp(), MNG.standbyIsOn()]) store.pget(p);
    for (const s of SENSORS) for (const k of ['isAvailable', 'temperature', 'alarm']) store.pget(MNG.sensor(s, k));
    for (let n = 1; n <= 4; n++) for (const k of ['isAvailable', 'speed', 'alarm']) store.pget(MNG.caseFan(n, k));
    awjViewSubs = () => [MNG.SUB_SYSTEM, MNG.SUB_STREAMING];
    awjApplySubs();
  }
  function enter() { if (awjDialect() !== 'mng') return; read = false; armReboot = false; mngSystemExtras.reset(); settle(); }

  const ip = (v) => Array.isArray(v) ? v.join('.') : '·';
  const prettyName = (s) => s.replace(/^(CM|CF_MEZZA|CF_OPT|FPGA)_/, (m) => ({ CM_: 'case ', CF_MEZZA_: 'mezzanine ', CF_OPT_: 'option ', FPGA_: 'FPGA ' })[m] || '').toLowerCase().replace(/_/g, ' ');

  function fact(label, value, mono = true) {
    return el('div', { class: 'fact' }, el('span', { class: 'k', text: label }), el('span', { class: mono ? 'v mono' : 'v', text: value ?? '·' }));
  }
  function render() {
    settle();
    const lock = store.pval(MNG.frontPanel('lock'));
    const write = (p, v) => { store.pset(p, v); if (!awjLive) setTimeout(() => store.pget(p), 150); };
    const sensors = SENSORS.filter(s => store.pval(MNG.sensor(s, 'isAvailable')) === true);
    const fans = [1, 2, 3, 4].filter(n => store.pval(MNG.caseFan(n, 'isAvailable')) === true);
    const alarm = store.pval(MNG.temperatureAlarm());
    return el('div', {},
      el('div', { class: 'view-head' }, el('h1', { text: 'System' }), el('span', { class: 'hint', text: 'Identity, network, health and the front panel' })),
      el('div', { class: 'panel' }, awjLiveRow('system changes')),
      el('div', { class: 'split' },
        el('div', { class: 'panel' }, el('h2', 'Identity'),
          fact('Model', store.pval(MNG.model())),
          fact('Series', store.pval(MNG.platformLabel()), false),
          fact('Firmware', store.pval(MNG.version())),
          fact('Serial', store.pval(MNG.serial())),
          fact('Label', store.pval(MNG.deviceLabel()) || '—', false),
          el('h2', 'Network'),
          fact('Hostname', store.pval(MNG.hostname()) || '—'),
          fact('Address', `${ip(store.pval(MNG.ipv4('ip')))} /${store.pval(MNG.ipv4('netmask')) ?? '·'}`),
          fact('Gateway', ip(store.pval(MNG.ipv4('gateway')))),
          fact('DNS', ip(store.pval(MNG.ipv4('dns')))),
          fact('DHCP', store.pval(MNG.ipv4Dhcp()) === true ? 'on' : store.pval(MNG.ipv4Dhcp()) === false ? 'off' : '·', false),
          el('h2', 'Front panel'),
          el('label', { class: 'field' }, 'Lock',
            el('select', { onchange: (e) => write(MNG.frontPanel('lock'), e.target.value) },
              ...['NONE', 'MENU', 'ALL'].map(v => el('option', { value: v, selected: v === lock, text: { NONE: 'unlocked', MENU: 'menu locked', ALL: 'everything locked' }[v] })))),
          el('div', { class: 'nrow' },
            el('label', { class: 'field' }, 'LCD brightness',
              el('input', { type: 'number', min: 1, max: 7, step: 1, value: store.pval(MNG.frontPanel('lcdBrightness')) ?? '',
                onchange: (e) => write(MNG.frontPanel('lcdBrightness'), Math.round(+e.target.value)) })),
            el('label', { class: 'field' }, 'Key brightness',
              el('input', { type: 'number', min: 0, max: 100, step: 1, value: store.pval(MNG.frontPanel('keyBrightness')) ?? '',
                onchange: (e) => write(MNG.frontPanel('keyBrightness'), Math.round(+e.target.value)) }))),
          el('h2', 'Power'),
          el('div', { class: 'row' },
            el('span', { class: 'chip ' + (store.pval(MNG.standbyIsOn()) === true ? 'bad' : 'on') }, el('span', { class: 'dot' }), store.pval(MNG.standbyIsOn()) === true ? 'standby' : 'running'),
            el('button', { class: 'btn ' + (armReboot ? 'pgm' : 'ghost'), onclick: () => {
              if (!armReboot) { armReboot = true; store.notify(); setTimeout(() => { armReboot = false; store.notify(); }, 4000); return; }
              store.pset(MNG.reboot(), true); armReboot = false; store.notify();
            } }, armReboot ? 'Tap again to reboot' : 'Reboot'))),
        el('div', { class: 'panel' }, el('h2', {}, 'Health ', alarmChipMng(alarm)),
          el('table', { class: 'grid' },
            el('thead', {}, el('tr', {}, ...['Sensor', '°C', 'Alarm'].map(h => el('th', { text: h })))),
            el('tbody', {}, ...sensors.map(s => {
              const t = store.pval(MNG.sensor(s, 'temperature')), a = store.pval(MNG.sensor(s, 'alarm'));
              return el('tr', {}, el('td', { text: prettyName(s) }),
                el('td', { class: 'val', text: typeof t === 'number' ? (t / 100).toFixed(1) : '·' }),
                el('td', {}, alarmChipMng(a)));
            }))),
          sensors.length ? null : el('div', { class: 'hint pad', text: 'No sensor has answered yet.' }),
          fans.length ? el('table', { class: 'grid' },
            el('thead', {}, el('tr', {}, ...['Case fan', 'Speed', 'Alarm'].map(h => el('th', { text: h })))),
            el('tbody', {}, ...fans.map(n => {
              const sp = store.pval(MNG.caseFan(n, 'speed'));
              return el('tr', {}, el('td', { text: `Fan ${n}` }),
                el('td', { class: 'val', text: sp == null ? '·' : sp === 65535 ? 'not reported' : String(sp) }),
                el('td', {}, alarmChipMng(store.pval(MNG.caseFan(n, 'alarm')) === true ? 'ALARM' : 'NONE')));
            }))) : null,
          el('div', { class: 'hint pad', text: 'Readings are the device’s own; a fan speed of 65535 is its way of saying it has none to report.' }))),
      el('div', { class: 'split' },
        el('div', { class: 'panel' }, mngSystemExtras.slots()),
        el('div', { class: 'panel' }, mngSystemExtras.streaming())));
  }
  return { enter, render };
})();

/** A chip for the device's own alarm words: NONE is fine, anything else is not. */
function alarmChipMng(a) {
  if (a == null) return el('span', { class: 'chip off' }, el('span', { class: 'dot' }), '·');
  const bad = a !== 'NONE' && a !== false;
  return el('span', { class: 'chip ' + (bad ? 'bad' : 'on') }, el('span', { class: 'dot' }), bad ? String(a).toLowerCase() : 'ok');
}

// ---------- AWJ: Multiviewer (Midra 4K / Alta 4K) ----------
// The one multiviewer, on the output keyed MTVW: up to twenty windows the
// model calls widgets, each with a source the device lists as valid, laid out
// in the multiviewer output's pixels (top-left, unlike a layer's centre).
// Twenty layout memories, and the three timers a widget can show.
VIEWS.lpmultiview = (() => {
  let read = false;
  let sel = 1;
  let mode = 'recall';        // memories: recall | save | erase | label
  let armed = null;
  let labelDraft = '';
  const OSD = ['OFF', 'BASIC', 'DETAILED'];
  const TIMER_TYPES = ['CURRENT_TIME', 'COUNTDOWN', 'STOPWATCH'];

  const validWidgets = () => (store.pval(MNG.mvwWidgetValidity()) || []).map(Number).filter(n => n >= 1 && n <= MNG_MVW_WIDGETS);
  const outputPx = () => {
    const w = store.pval(MNG.outputStatus('MTVW', 'sizeH')), h = store.pval(MNG.outputStatus('MTVW', 'sizeV'));
    return { w: w > 0 ? w : 1920, h: h > 0 ? h : 1080, reported: w > 0 && h > 0 };
  };
  const W = (n, prop) => MNG.mvwWidget(n, prop);
  const wv = (n, prop) => store.pval(W(n, prop));

  function settle() {
    if (read || !store.meta || !store.connected) return;
    read = true;
    for (const p of [MNG.mvwWidgetValidity(), MNG.mvwSourceValidity(), MNG.outputStatus('MTVW', 'sizeH'), MNG.outputStatus('MTVW', 'sizeV')]) store.pget(p);
    // Only the slots this unit says it has: the model carries up to 27 and
    // the rest answer E12.
    const slots = validWidgets();
    for (const n of (slots.length ? slots : Array.from({ length: 16 }, (_, i) => i + 1))) {
      for (const p of ['enable', 'source', 'posH', 'posV', 'sizeH', 'sizeV', 'displayOsd']) store.pget(W(n, p));
      store.pget(MNG.mvwWidgetStatus(n, 'isEnabled'));
    }
    for (let s = 1; s <= 20; s++) { store.pget(MNG.mvwPresetValid(s)); store.pget(MNG.mvwPresetLabel(s)); }
    store.pget(MNG.mvwLoadAutoScale());
    for (let t = 1; t <= MNG_TIMERS; t++) { for (const p of ['type', 'label', 'countdownDuration']) store.pget(MNG.timer(t, p)); store.pget(MNG.timerState(t)); }
    mngInputs.refresh();
    awjViewSubs = () => [MNG.SUB_MULTIVIEWER, MNG.SUB_TIMERS];
    awjApplySubs();
    startMngSnapshots();
  }
  function enter() { if (awjDialect() !== 'mng') return; read = false; armed = null; settle(); }
  const readBack = (n) => { if (awjLive) return; setTimeout(() => { for (const p of ['enable', 'source', 'posH', 'posV', 'sizeH', 'sizeV', 'displayOsd']) store.pget(W(n, p)); store.pget(MNG.mvwWidgetStatus(n, 'isEnabled')); }, 150); };

  // A source the device lists, named for an operator.
  function sourceName(v) {
    if (!v || v === 'NONE') return '— none —';
    let m;
    if ((m = /^INPUT_(\d+)$/.exec(v))) return mngInputs.name(v);
    if ((m = /^SCREEN_PRGM_(\d+)$/.exec(v))) return `Screen ${m[1]} program`;
    if ((m = /^SCREEN_PRW_(\d+)$/.exec(v))) return `Screen ${m[1]} preview`;
    if ((m = /^AUX_PRGM_(\d+)$/.exec(v))) return `Aux ${m[1]} program`;
    if ((m = /^AUX_PRW_(\d+)$/.exec(v))) return `Aux ${m[1]} preview`;
    if ((m = /^TIMER_(\d+)$/.exec(v))) return `Timer ${m[1]}${store.pval(MNG.timer(+m[1], 'label')) ? ' · ' + store.pval(MNG.timer(+m[1], 'label')) : ''}`;
    return String(v).toLowerCase().replace(/_/g, ' ');
  }
  function sourceColor(v) {
    if (/^INPUT_/.test(v)) return mngSourceColor(v);
    if (/^SCREEN_PRGM|^AUX_PRGM/.test(v)) return 'var(--pgm)';
    if (/^SCREEN_PRW|^AUX_PRW/.test(v)) return 'var(--pvw)';
    if (/^TIMER_/.test(v)) return 'var(--armed)';
    return 'transparent';
  }

  // ---- geometry: top-left plus size, in output pixels
  const rectPx = (n) => ({ left: wv(n, 'posH') ?? 0, top: wv(n, 'posV') ?? 0, w: wv(n, 'sizeH') ?? 0, h: wv(n, 'sizeV') ?? 0 });
  function setGeom(n, r) {
    pthrottledSet(W(n, 'posH'), Math.max(0, Math.round(r.left)));
    pthrottledSet(W(n, 'posV'), Math.max(0, Math.round(r.top)));
    pthrottledSet(W(n, 'sizeH'), Math.max(16, Math.round(r.w)));
    pthrottledSet(W(n, 'sizeV'), Math.max(16, Math.round(r.h)));
  }
  function dragMove(e, n, scale) {
    e.preventDefault(); e.stopPropagation();
    beginDrag(); sel = n;
    const box = e.currentTarget, sx = e.clientX, sy = e.clientY, r0 = rectPx(n);
    const move = (ev) => {
      const r = { ...r0, left: r0.left + (ev.clientX - sx) / scale, top: r0.top + (ev.clientY - sy) / scale };
      box.style.left = r.left * scale + 'px'; box.style.top = r.top * scale + 'px';
      setGeom(n, r);
    };
    const up = () => { document.removeEventListener('pointermove', move); document.removeEventListener('pointerup', up); endDrag(); readBack(n); };
    document.addEventListener('pointermove', move); document.addEventListener('pointerup', up);
  }
  function dragResize(e, n, scale, corner, box) {
    e.preventDefault(); e.stopPropagation();
    beginDrag(); sel = n;
    const sx = e.clientX, sy = e.clientY, r0 = rectPx(n);
    const west = corner.includes('w'), north = corner.includes('n');
    const move = (ev) => {
      const dx = (ev.clientX - sx) / scale, dy = (ev.clientY - sy) / scale;
      let left = r0.left, right = r0.left + r0.w, top = r0.top, bot = r0.top + r0.h;
      if (west) left = Math.min(right - 16, r0.left + dx); else right = Math.max(left + 16, right + dx);
      if (north) top = Math.min(bot - 16, r0.top + dy); else bot = Math.max(top + 16, bot + dy);
      const r = { left, top, w: right - left, h: bot - top };
      box.style.left = r.left * scale + 'px'; box.style.top = r.top * scale + 'px';
      box.style.width = r.w * scale + 'px'; box.style.height = r.h * scale + 'px';
      setGeom(n, r);
    };
    const up = () => { document.removeEventListener('pointermove', move); document.removeEventListener('pointerup', up); endDrag(); readBack(n); };
    document.addEventListener('pointermove', move); document.addEventListener('pointerup', up);
  }
  // Grid presets over the usable widgets in slot order; the rest are disabled.
  function grid(cols, rows) {
    const o = outputPx(), ws = validWidgets();
    const cw = o.w / cols, ch = o.h / rows;
    ws.forEach((n, i) => {
      const on = i < cols * rows;
      store.pset(W(n, 'enable'), on);
      if (on) setGeom(n, { left: (i % cols) * cw, top: Math.floor(i / cols) * ch, w: cw, h: ch });
      readBack(n);
    });
  }

  function canvas() {
    const o = outputPx();
    const CW = Math.min(720, Math.max(360, (window.innerWidth || 1200) - 620));
    const scale = CW / o.w, CH = o.h * scale;
    const cv = el('div', { class: 'screen-canvas', style: `width:${CW}px;height:${Math.round(CH)}px` });
    for (const n of validWidgets()) {
      const on = wv(n, 'enable') === true;
      // a disabled widget keeps its old box; drawing every one of them buries
      // the layout, so only the selected one shows dashed
      if (!on && n !== sel) continue;
      const src = wv(n, 'source');
      const r = rectPx(n);
      const m = /^INPUT_(\d+)$/.exec(String(src || ''));
      const shot = on && m ? mngSnapshotUrl('inputs', +m[1]) : null;
      const box = el('div', {
        class: 'lrect' + (n === sel ? ' sel' : '') + (on ? '' : ' off') + (shot ? ' shot' : ''),
        style: `left:${r.left * scale}px;top:${r.top * scale}px;width:${r.w * scale}px;height:${r.h * scale}px;z-index:${n};` +
          (shot ? `background-image:url(${shot})` : on && src && src !== 'NONE' ? `background:color-mix(in srgb, ${sourceColor(src)} 45%, transparent)` : ''),
        onpointerdown: (e) => dragMove(e, n, scale),
      },
        el('span', { class: 'lrect-tag', text: `W${n}${on && src && src !== 'NONE' ? ' · ' + sourceName(src) : on ? '' : ' · off'}` }));
      cv.append(box);
      if (n === sel) selectionChrome(cv, box, (e, c, b) => dragResize(e, n, scale, c, b));
    }
    return el('div', { class: 'canvas-wrap' }, cv);
  }

  function panel() {
    const n = sel;
    const on = wv(n, 'enable') === true;
    const src = wv(n, 'source');
    const write = (p, v) => { store.pset(W(n, p), v); readBack(n); };
    const srcSel = el('select', { onchange: (e) => write('source', e.target.value) });
    for (const v of (store.pval(MNG.mvwSourceValidity()) || ['NONE'])) srcSel.append(el('option', { value: v, selected: v === src, text: sourceName(v) }));
    if (src != null && !(store.pval(MNG.mvwSourceValidity()) || []).includes(src)) srcSel.append(el('option', { value: src, selected: true, text: String(src) }));
    const num = (prop, label) => el('label', { class: 'field' }, label,
      el('input', { type: 'number', step: 1, min: 0, value: wv(n, prop) ?? '', onchange: (e) => write(prop, Math.max(0, Math.round(+e.target.value || 0))) }));
    return el('div', { class: 'editor' },
      el('h2', {}, `Widget ${n} `, el('span', { class: 'chip ' + (store.pval(MNG.mvwWidgetStatus(n, 'isEnabled')) === true ? 'on' : 'off') }, el('span', { class: 'dot' }), store.pval(MNG.mvwWidgetStatus(n, 'isEnabled')) === true ? 'shown' : 'hidden')),
      el('button', { class: 'btn ' + (on ? 'primary' : 'ghost'), onclick: () => write('enable', !on) }, on ? 'Enabled' : 'Enable'),
      el('label', { class: 'field' }, 'Source', srcSel),
      el('label', { class: 'field' }, 'On-screen label',
        el('select', { onchange: (e) => write('displayOsd', e.target.value) },
          ...OSD.map(v => el('option', { value: v, selected: v === wv(n, 'displayOsd'), text: v.toLowerCase() })))),
      el('div', { class: 'nrow' }, num('posH', 'Left'), num('posV', 'Top')),
      el('div', { class: 'nrow' }, num('sizeH', 'Width'), num('sizeV', 'Height')));
  }

  // ---- layout memories, the same four modes as the preset banks
  function afterWrite(s) { const re = () => { store.pget(MNG.mvwPresetValid(s)); store.pget(MNG.mvwPresetLabel(s)); }; re(); setTimeout(re, 300); }
  function tap(s) {
    const valid = store.pval(MNG.mvwPresetValid(s)) === true;
    if (mode === 'recall') { if (!valid) return; store.pset(MNG.mvwLoad(s), true); setTimeout(() => { for (const n of validWidgets()) readBack(n); }, 400); return; }
    if (mode === 'save') { store.pset(MNG.mvwSave(s), true); afterWrite(s); return; }
    if (mode === 'label') { armed = s; labelDraft = store.pval(MNG.mvwPresetLabel(s)) || ''; store.notify(); return; }
    if (mode === 'erase') { if (!valid) return; if (armed !== s) { armed = s; store.notify(); return; } store.pset(MNG.mvwPresetDelete(s), true); armed = null; afterWrite(s); store.notify(); }
  }
  function memories() {
    const tiles = [];
    for (let s = 1; s <= 20; s++) {
      const valid = store.pval(MNG.mvwPresetValid(s)) === true;
      const label = store.pval(MNG.mvwPresetLabel(s));
      tiles.push(el('button', { class: 'slot' + (valid ? ' valid' : '') + (armed === s ? ' sel' : ''),
        disabled: mode === 'recall' || mode === 'erase' ? !valid : false,
        title: { recall: valid ? `Recall layout ${s}` : `Slot ${s} is empty`, save: `Store the layout in slot ${s}${valid ? ' (overwrites)' : ''}`, erase: armed === s ? `Tap again to erase ${s}` : `Erase ${s}`, label: `Label ${s}` }[mode],
        onclick: () => tap(s) },
        el('span', { class: 'num', text: String(s) }), valid ? el('span', { class: 'lbl', text: label || 'layout' }) : null));
    }
    return el('div', { class: 'panel' }, el('h2', 'Layout memories'),
      el('div', { class: 'row' },
        el('div', { class: 'seg' }, ...[['recall', 'Recall', 'recall'], ['save', 'Save', 'save'], ['erase', 'Erase', 'take'], ['label', 'Label', 'recall']].map(([m, t, cls]) =>
          el('button', { class: mode === m ? 'on ' + cls : '', onclick: () => { mode = m; armed = null; store.notify(); } }, t))),
        el('span', { class: 'hint', text: { recall: 'Tap a memory to recall its layout.', save: 'Tap a slot to store the current layout in it.', erase: 'Tap a memory, then tap it again to erase it.', label: 'Tap a memory to name it.' }[mode] }),
        mode === 'recall' ? awjToggle(MNG.mvwLoadAutoScale(), (on) => on ? 'Autoscale on load' : 'Load as saved', { small: true, cls: 'primary', title: 'Rescale a memory’s widgets to the multiviewer’s resolution on load' }) : null),
      el('div', { class: 'mem-grid' }, ...tiles),
      mode === 'label' && armed !== null ? el('div', { class: 'row' },
        el('label', { text: `Slot ${armed} ` }),
        el('input', { type: 'text', maxlength: 64, value: labelDraft, oninput: (e) => { labelDraft = e.target.value; } }),
        el('button', { class: 'btn primary', onclick: () => { store.pset(MNG.mvwPresetLabel(armed), labelDraft); afterWrite(armed); armed = null; store.notify(); } }, 'Set label'),
        el('button', { class: 'btn ghost', onclick: () => { armed = null; store.notify(); } }, 'Cancel')) : null);
  }

  function timers() {
    const rows = [];
    for (let t = 1; t <= MNG_TIMERS; t++) {
      const type = store.pval(MNG.timer(t, 'type')), st = store.pval(MNG.timerState(t));
      const write = (p, v) => { store.pset(MNG.timer(t, p), v); if (!awjLive) setTimeout(() => { store.pget(MNG.timer(t, p)); store.pget(MNG.timerState(t)); }, 150); };
      const fire = (p) => { store.pset(MNG.timer(t, p), true); if (!awjLive) setTimeout(() => store.pget(MNG.timerState(t)), 200); };
      const secs = store.pval(MNG.timer(t, 'countdownDuration'));
      rows.push(el('tr', {},
        el('td', { text: `Timer ${t}` }),
        el('td', {}, el('input', { type: 'text', maxlength: 32, value: store.pval(MNG.timer(t, 'label')) ?? '', onchange: (e) => write('label', e.target.value) })),
        el('td', {}, el('select', { onchange: (e) => write('type', e.target.value) }, ...TIMER_TYPES.map(v => el('option', { value: v, selected: v === type, text: v.toLowerCase().replace(/_/g, ' ') })))),
        el('td', {}, type === 'COUNTDOWN' ? el('input', { class: 'num', type: 'number', min: 0, max: 86399, step: 1, value: secs ?? '', title: 'seconds', onchange: (e) => write('countdownDuration', Math.max(0, Math.min(86399, Math.round(+e.target.value || 0)))) }) : el('span', { class: 'hint', text: '—' })),
        el('td', {}, el('span', { class: 'chip ' + (st && st !== 'IDLE' ? 'on' : 'off') }, el('span', { class: 'dot' }), String(st ?? '·').toLowerCase())),
        el('td', { class: 'acts' },
          el('button', { class: 'btn small primary', onclick: () => fire('xStart') }, 'Start'),
          el('button', { class: 'btn small ghost', onclick: () => fire('xPause') }, 'Pause'),
          el('button', { class: 'btn small ghost', onclick: () => fire('xStop') }, 'Stop'))));
    }
    return el('div', { class: 'panel' }, el('h2', 'Timers'),
      el('table', { class: 'grid' },
        el('thead', {}, el('tr', {}, ...['', 'Label', 'Type', 'Countdown (s)', 'State', ''].map(h => el('th', { text: h })))),
        el('tbody', {}, ...rows)),
      el('div', { class: 'hint pad', text: 'A widget shows a timer as its source. Pause and stop are the device’s own verbs; a stopwatch counts up, a countdown counts its duration down.' }));
  }

  function render() {
    settle();
    const o = outputPx();
    const ws = validWidgets();
    if (!ws.includes(sel)) sel = ws[0] ?? 1;
    return el('div', {},
      el('div', { class: 'view-head' }, el('h1', { text: 'Multiviewer' }), el('span', { class: 'hint', text: 'The monitoring output’s windows — drag to move, corners to resize; twenty layout memories; the three timers' })),
      el('div', { class: 'panel' },
        awjLiveRow('multiviewer changes'),
        el('div', { class: 'row' },
          el('span', { class: 'hint', text: `${o.w}×${o.h}${o.reported ? '' : ' (assumed)'} · ${ws.length} widgets this unit can use` }),
          el('div', { class: 'grow' }),
          el('div', { class: 'seg' }, ...[[2, 2, 'Quad'], [3, 3, '3×3'], [4, 3, '4×3'], [4, 4, '4×4']].map(([c, r, t]) => el('button', { onclick: () => grid(c, r) }, t))))),
      el('div', { class: 'split-wide' },
        el('div', { class: 'panel' },
          el('div', { class: 'row' }, el('div', { class: 'seg' }, ...ws.map(n => el('button', { class: n === sel ? 'on recall' : '', onclick: () => { sel = n; store.notify(); } }, `W${n}`)))),
          canvas()),
        el('div', { class: 'panel' }, ws.length ? panel() : el('div', { class: 'hint pad', text: 'Waiting for the multiviewer.' }))),
      memories(),
      timers());
  }
  return { enter, render };
})();

// ---------- AWJ: Stills (Midra 4K / Alta 4K) ----------
// The still library — fifty slots the device fills from a capture or an
// upload — and the frame slots each screen points at it with.
VIEWS.lpstills = (() => {
  let read = false;
  let armed = null;
  let erasing = false;
  const cap = { stream: null, libraryMode: 'AUTO_SLOT', librarySlot: 1, fileType: 'PNG' };

  function settle() {
    if (read || !store.meta || !store.connected) return;
    read = true;
    for (let s = 1; s <= MNG_STILL_SLOTS; s++) { for (const p of ['isValid', 'fileName', 'width', 'height', 'fileSize']) store.pget(MNG.stillStatus(s, p)); store.pget(MNG.stillLabel(s)); }
    for (const p of ['stream', 'libraryMode', 'librarySlot', 'fileType', 'mode', 'destination']) store.pget(MNG.captureCmd(p));
    for (const p of ['status', 'fileName', 'streamValidity']) store.pget(MNG.captureStatus(p));
    for (const d of awj().destinations()) if (d.kind === 'screen')
      for (const list of ['back', 'top']) for (let f = 1; f <= 4; f++) for (const tail of ['status/@props/isValid', 'control/@props/label', 'control/@props/librarySlot']) store.pget(MNG.frame(d.n, list, f, tail));
    mngInputs.refresh();
    awjViewSubs = () => [MNG.SUB_STILLS];
    awjApplySubs();
    startMngSnapshots();
  }
  function enter() { if (awjDialect() !== 'mng') return; read = false; armed = null; settle(); }
  const kb = (n) => (n == null ? '·' : n >= 1048576 ? (n / 1048576).toFixed(1) + ' MB' : Math.round(n / 1024) + ' KB');

  function library() {
    const tiles = [];
    for (let s = 1; s <= MNG_STILL_SLOTS; s++) {
      const valid = store.pval(MNG.stillStatus(s, 'isValid')) === true;
      const name = store.pval(MNG.stillStatus(s, 'fileName')) || store.pval(MNG.stillLabel(s)) || 'image';
      const w = store.pval(MNG.stillStatus(s, 'width')), h = store.pval(MNG.stillStatus(s, 'height'));
      tiles.push(el('button', { class: 'slot still' + (valid ? ' valid' : '') + (armed === s ? ' sel' : ''),
        disabled: erasing && !valid,
        title: valid ? `${name} · ${w}×${h} · ${kb(store.pval(MNG.stillStatus(s, 'fileSize')))}${erasing ? (armed === s ? ' — tap again to erase' : ' — tap to erase') : ''}` : `Slot ${s} is empty`,
        onclick: () => {
          if (!erasing) { armed = armed === s ? null : s; store.notify(); return; }
          if (!valid) return;
          if (armed !== s) { armed = s; store.notify(); return; }
          store.pset(MNG.stillDelete(s), true); armed = null;
          setTimeout(() => { for (const p of ['isValid', 'fileName']) store.pget(MNG.stillStatus(s, p)); }, 300);
          store.notify();
        } },
        el('span', { class: 'num', text: String(s) }),
        valid ? el('span', { class: 'lbl', text: name }) : null,
        valid && w ? el('span', { class: 'lbl', text: `${w}×${h}` }) : null));
    }
    return el('div', { class: 'panel' }, el('h2', 'Library'),
      el('div', { class: 'row' },
        el('button', { class: 'btn ' + (erasing ? 'pgm' : 'ghost'), onclick: () => { erasing = !erasing; armed = null; store.notify(); } }, erasing ? 'Erasing — tap a slot twice' : 'Erase…'),
        el('span', { class: 'hint', text: 'Fifty slots. The device fills one from a capture below, or from an upload in its own Web RCS; a frame slot on a screen points at one of these.' })),
      el('div', { class: 'mem-grid' }, ...tiles));
  }

  function capture() {
    const cur = (p) => store.pval(MNG.captureCmd(p));
    const st = store.pval(MNG.captureStatus('status'));
    const streams = store.pval(MNG.captureStatus('streamValidity')) || [];
    const name = (v) => /^INPUT_/.test(v) ? mngInputs.name(v) : /^OUTPUT_(\d+)$/.test(v) ? `Output ${v.slice(7)}` : v === 'MTVW' ? 'Multiviewer' : String(v);
    const write = (p, v) => { store.pset(MNG.captureCmd(p), v); if (!awjLive) setTimeout(() => store.pget(MNG.captureCmd(p)), 150); };
    return el('div', { class: 'panel' }, el('h2', 'Capture'),
      el('div', { class: 'row wrap' },
        el('label', { class: 'field' }, 'Grab',
          el('select', { onchange: (e) => write('stream', e.target.value) }, ...streams.map(v => el('option', { value: v, selected: v === cur('stream'), text: name(v) })))),
        el('label', { class: 'field' }, 'Into',
          el('select', { onchange: (e) => write('libraryMode', e.target.value) },
            el('option', { value: 'AUTO_SLOT', selected: cur('libraryMode') === 'AUTO_SLOT', text: 'the next free slot' }),
            el('option', { value: 'SPECIFIC_SLOT', selected: cur('libraryMode') === 'SPECIFIC_SLOT', text: 'a slot I pick' }))),
        cur('libraryMode') === 'SPECIFIC_SLOT' ? el('label', { class: 'field' }, 'Slot',
          el('input', { class: 'num', type: 'number', min: 1, max: MNG_STILL_SLOTS, step: 1, value: cur('librarySlot') ?? 1, onchange: (e) => write('librarySlot', Math.max(1, Math.min(MNG_STILL_SLOTS, Math.round(+e.target.value || 1)))) })) : null,
        el('label', { class: 'field' }, 'File',
          el('select', { onchange: (e) => write('fileType', e.target.value) }, ...['PNG', 'BMP', 'JPEG'].map(v => el('option', { value: v, selected: v === cur('fileType'), text: v })))),
        el('button', { class: 'btn primary', onclick: () => {
          store.pset(MNG.captureCmd('destination'), 'LIBRARY');
          store.pset(MNG.captureCmd('xRequest'), true);
          const re = () => { for (const p of ['status', 'fileName']) store.pget(MNG.captureStatus(p)); for (let s = 1; s <= MNG_STILL_SLOTS; s++) for (const p of ['isValid', 'fileName', 'width', 'height', 'fileSize']) store.pget(MNG.stillStatus(s, p)); };
          setTimeout(re, 800); setTimeout(re, 3000);
        } }, 'Capture now'),
        el('span', { class: 'chip ' + (st === 'DONE' ? 'on' : st && st !== 'NO_REQUEST' ? 'bad' : 'off') }, el('span', { class: 'dot' }), String(st ?? '·').toLowerCase().replace(/_/g, ' ')),
        store.pval(MNG.captureStatus('fileName')) ? el('span', { class: 'hint', text: store.pval(MNG.captureStatus('fileName')) }) : null),
      el('div', { class: 'hint pad', text: 'A frame of the chosen source, into the library. The device reports the result; a source with no signal fails.' }));
  }

  function frames() {
    const screens = awj().destinations().filter(d => d.kind === 'screen');
    if (!screens.length) return null;
    return el('div', { class: 'panel' }, el('h2', 'Frame slots'),
      el('div', { class: 'hint pad', text: 'Each screen has four back frames (what a background set can show) and four top frames (what the top layer can show), each pointing at a library slot. Set them in the unit’s Preconfig; this is what they hold.' }),
      el('table', { class: 'grid' },
        el('thead', {}, el('tr', {}, ...['Screen', 'Slot', 'Back frame', 'Library', 'Top frame', 'Library'].map(h => el('th', { text: h })))),
        el('tbody', {}, ...screens.flatMap(d => [1, 2, 3, 4].map(f => {
          const cell = (list) => {
            const valid = store.pval(MNG.frame(d.n, list, f, 'status/@props/isValid'));
            const lbl = store.pval(MNG.frame(d.n, list, f, 'control/@props/label'));
            const shot = valid ? mngSnapshotUrl(`screens/${d.n}/${list}`, f) : null;
            return [el('td', {}, shot ? el('img', { class: 'thumb', src: shot, alt: '', width: 96, height: 54 }) : el('span', { class: 'chip off' }, el('span', { class: 'dot' }), valid === false ? 'empty' : '·'), lbl ? ' ' + lbl : ''),
              el('td', { class: 'val', text: String(store.pval(MNG.frame(d.n, list, f, 'control/@props/librarySlot')) ?? '·') })];
          };
          return el('tr', {}, el('td', { text: f === 1 ? d.id : '' }), el('td', { class: 'val', text: String(f) }), ...cell('back'), ...cell('top'));
        })))));
  }

  function render() {
    settle();
    return el('div', {},
      el('div', { class: 'view-head' }, el('h1', { text: 'Stills' }), el('span', { class: 'hint', text: 'The still library, a capture into it, and the frame slots each screen points at it with' })),
      el('div', { class: 'panel' }, awjLiveRow('library changes')),
      capture(), library(), frames());
  }
  return { enter, render };
})();

// ---------- AWJ: Outputs (Midra 4K / Alta 4K) ----------
VIEWS.lpoutputs = (() => {
  let read = false;
  let sel = '1';
  const PATTERNS = ['NO_PATTERN', 'COLOR', 'VERTICAL_GREY_SCALE', 'HORIZONTAL_GREY_SCALE', 'VERTICAL_COLOR_BAR', 'HORIZONTAL_COLOR_BAR', 'GRID_16_16', 'GRID_32_32', 'GRID_CUSTOM', 'SMPTE', 'BURST_H', 'BURST_V', 'VERTICAL_GRADIENT', 'HORIZONTAL_GRADIENT', 'CHECKERBOARD', 'SOFTEDGE', 'PATHOLOGICAL'];
  const SETTINGS = [['gamma', 'Gamma', 5, 40, v => (v / 10).toFixed(1)], ['brightness', 'Brightness', -128, 127, v => v], ['contrast', 'Contrast', -128, 127, v => v],
    ['saturation', 'Saturation', -128, 127, v => v], ['hue', 'Hue', -90, 90, v => v + '°'], ['gainR', 'Gain R', -128, 127, v => v], ['gainG', 'Gain G', -128, 127, v => v], ['gainB', 'Gain B', -128, 127, v => v]];
  const roleOf = (key) => {
    const m = store.pval(MNG.outputRole(key));
    return m === 'SCREEN_FORMAT' ? 'screen' : m === 'MULTIVIEWER' ? 'multiviewer' : typeof m === 'string' && m.startsWith('AUX') ? 'auxiliary' : null;
  };
  function settle() {
    if (read || !store.meta || !store.connected) return;
    read = true;
    for (const k of MNG_OUTPUTS) {
      for (const p of ['isAvailable', 'isValid', 'format', 'rate', 'sizeH', 'sizeV', 'ledColor', 'isFormatInterlaced']) store.pget(MNG.outputStatus(k, p));
      store.pget(MNG.outputLabel(k)); store.pget(MNG.outputRole(k));
      store.pget(MNG.outputPlugStatus(k, 1, 'plugStatus')); store.pget(MNG.outputPlugStatus(k, 1, 'type'));
      store.pget(MNG.outputPattern(k, 'type')); store.pget(MNG.outputPattern(k, 'inhibit'));
      for (const [p] of SETTINGS) store.pget(MNG.outputSetting(k, p));
    }
    awjViewSubs = () => [MNG.SUB_OUTPUTS, MNG.SUB_CUSTOM_FORMATS];
    awjApplySubs();
    startMngSnapshots();
  }
  function fetchFormats(k) {
    const role = roleOf(k);
    if (!role) return;
    store.pget(MNG.outputFormat(k, role)); store.pget(MNG.outputFormatValidity(k, role));
  }
  function enter() { if (awjDialect() !== 'mng') return; read = false; mngOutputExtras.reset(); settle(); }

  function row(k) {
    const avail = store.pval(MNG.outputStatus(k, 'isAvailable'));
    const fmt = store.pval(MNG.outputStatus(k, 'format')), rate = store.pval(MNG.outputStatus(k, 'rate'));
    const w = store.pval(MNG.outputStatus(k, 'sizeH')), h = store.pval(MNG.outputStatus(k, 'sizeV'));
    const role = store.pval(MNG.outputRole(k));
    const shot = avail !== false ? mngSnapshotUrl(k === 'MTVW' ? 'multiviewer' : 'outputs', k === 'MTVW' ? 1 : +k) : null;
    return el('tr', { class: (avail === false ? 'dim' : '') + (k === sel ? ' sel' : ''), onclick: () => { sel = k; fetchFormats(k); store.notify(); } },
      el('td', {}, shot ? el('img', { class: 'thumb', src: shot, alt: '', width: 96, height: 54 }) : null),
      el('td', { text: k === 'MTVW' ? 'MVW' : `OUT ${k}` }),
      el('td', { text: store.pval(MNG.outputLabel(k)) || '—' }),
      el('td', { class: 'val', text: role ? String(role).toLowerCase().replace(/_/g, ' ') : '·' }),
      el('td', { class: 'val', text: fmt ? `${String(fmt).replace(/_/g, ' ')}${rate ? ' @ ' + rate : ''}` : '·' }),
      el('td', { class: 'val', text: w ? `${w}×${h}` : '·' }),
      el('td', {}, el('span', { class: 'chip ' + (store.pval(MNG.outputPlugStatus(k, 1, 'plugStatus')) === 'ACTIVE' ? 'on' : 'off') }, el('span', { class: 'dot' }),
        `${store.pval(MNG.outputPlugStatus(k, 1, 'type')) || ''} ${String(store.pval(MNG.outputPlugStatus(k, 1, 'plugStatus')) || '·').toLowerCase()}`.trim())),
      el('td', {}, store.pval(MNG.outputPattern(k, 'inhibit')) === false ? el('span', { class: 'chip bad' }, el('span', { class: 'dot' }), 'pattern') : null));
  }

  function editor(k) {
    const role = roleOf(k);
    const write = (p, v) => { store.pset(p, v); if (!awjLive) setTimeout(() => store.pget(p), 150); };
    const fmtSel = role ? (() => {
      const cur = store.pval(MNG.outputFormat(k, role));
      const opts = store.pval(MNG.outputFormatValidity(k, role)) || (cur ? [cur] : []);
      const s = el('select', { onchange: (e) => { store.pset(MNG.outputFormat(k, role), e.target.value); store.pset(MNG.outputFormatUpdate(k, role), true); setTimeout(() => { store.pget(MNG.outputFormat(k, role)); for (const p of ['format', 'rate', 'sizeH', 'sizeV']) store.pget(MNG.outputStatus(k, p)); }, 800); } });
      for (const v of opts) s.append(el('option', { value: v, selected: v === cur, text: String(v).replace(/_/g, ' ') }));
      return s;
    })() : null;
    const inhibit = store.pval(MNG.outputPattern(k, 'inhibit'));
    return el('div', { class: 'editor' },
      el('h2', { text: k === 'MTVW' ? 'Multiviewer output' : `Output ${k}` }),
      el('label', { class: 'field' }, 'Label', el('input', { type: 'text', maxlength: 32, value: store.pval(MNG.outputLabel(k)) ?? '', onchange: (e) => write(MNG.outputLabel(k), e.target.value) })),
      role ? el('label', { class: 'field' }, `Format (${role})`, fmtSel) : el('div', { class: 'hint', text: 'Not in service in the applied configuration; no format to set.' }),
      el('label', { class: 'field' }, 'Test pattern',
        el('select', { onchange: (e) => write(MNG.outputPattern(k, 'type'), e.target.value) },
          ...PATTERNS.map(v => el('option', { value: v, selected: v === store.pval(MNG.outputPattern(k, 'type')), text: v.toLowerCase().replace(/_/g, ' ') })))),
      el('button', { class: 'btn ' + (inhibit === false ? 'pgm' : 'ghost'), onclick: () => write(MNG.outputPattern(k, 'inhibit'), inhibit !== false ? false : true) }, inhibit === false ? 'Pattern on the output' : 'Show pattern'),
      el('details', { class: 'group', open: true }, el('summary', { text: 'Picture' }),
        ...SETTINGS.map(([p, label, min, max, fmt]) => {
          const path = MNG.outputSetting(k, p), v = store.pval(path);
          return el('label', { class: 'field slider' },
            el('span', {}, label, el('b', { class: 'sv', text: v == null ? '·' : fmt(v) })),
            el('input', { type: 'range', min, max, step: 1, value: v ?? 0,
              onpointerdown: beginDrag, onpointerup: endDrag, onpointercancel: endDrag,
              oninput: (e) => { pthrottledSet(path, +e.target.value); e.target.parentNode.querySelector('.sv').textContent = fmt(+e.target.value); } }));
        })),
      mngOutputExtras.canvas(k),
      mngOutputExtras.signal(k),
      mngOutputExtras.luts(k),
      mngOutputExtras.display(k));
  }

  function render() {
    settle();
    if (!store.pval(MNG.outputFormatValidity(sel, roleOf(sel) || 'screen')) && roleOf(sel)) fetchFormats(sel);
    return el('div', {},
      el('div', { class: 'view-head' }, el('h1', { text: 'Outputs' }), el('span', { class: 'hint', text: 'Every output, what it is for, its format and signal, a test pattern and picture settings' })),
      el('div', { class: 'panel' }, awjLiveRow('output changes')),
      el('div', { class: 'split-wide' },
        el('div', { class: 'panel' },
          el('table', { class: 'grid rows' },
            el('thead', {}, el('tr', {}, ...['', 'Output', 'Label', 'Role', 'Format', 'Size', 'Plug', ''].map(h => el('th', { text: h })))),
            el('tbody', {}, ...MNG_OUTPUTS.map(row))),
          el('div', { class: 'hint pad', text: 'Tap an output to edit it. A format change is applied with the device’s own update trigger and read back after it has settled.' })),
        el('div', { class: 'panel' }, editor(sel))),
      mngOutputExtras.customFormats());
  }
  return { enter, render };
})();

// ---------- AWJ: Inspector (any path) ----------
// Every path this bridge has seen from the processor, with its value, plus a
// way to read or write any path at all — the AWJ side of the Inspector and
// Console the mnemonic families have. What it lists is what has been read;
// the object model is far larger than any inventory, so the search is over
// what the surface has touched, and the get is for the rest.
VIEWS.lpinspector = (() => {
  let q = '';
  let path = '';
  let value = '';
  let showLog = true;
  function render() {
    const rows = [];
    const needle = q.trim().toLowerCase();
    let n = 0;
    for (const [p, v] of store.paths) {
      if (needle && !p.toLowerCase().includes(needle)) continue;
      if (n++ >= 400) break;
      rows.push(el('tr', {}, el('td', { class: 'mono path', text: p.replace(/^DeviceObject\//, '') , onclick: () => { path = p; value = JSON.stringify(v); store.notify(); } }), el('td', { class: 'val', text: JSON.stringify(v) })));
    }
    const log = (store.log || []).slice(-80).reverse();
    return el('div', {},
      el('div', { class: 'view-head' }, el('h1', { text: 'Inspector' }), el('span', { class: 'hint', text: `${store.paths.size} properties read so far — search them, read any path, write any value` })),
      el('div', { class: 'panel' },
        el('div', { class: 'row' },
          el('input', { type: 'text', class: 'wide', placeholder: 'DeviceObject/… (a full path)', value: path, oninput: (e) => { path = e.target.value; } }),
          el('button', { class: 'btn', onclick: () => { if (path.trim()) store.pget(path.trim()); } }, 'Get'),
          el('input', { type: 'text', placeholder: 'value, as JSON', value: value, oninput: (e) => { value = e.target.value; } }),
          el('button', { class: 'btn pgm', onclick: () => {
            let v; try { v = JSON.parse(value); } catch { v = value; }
            if (path.trim()) { store.pset(path.trim(), v); setTimeout(() => store.pget(path.trim()), 200); }
          } }, 'Set')),
        el('div', { class: 'hint pad', text: 'A write goes to the processor as typed. Numbers, true/false, lists and strings are JSON; anything that does not parse is sent as a string. A path the processor does not have answers E12 in the log below.' })),
      el('div', { class: 'panel' },
        el('div', { class: 'row' }, el('input', { type: 'text', class: 'wide', placeholder: 'filter the properties read so far', value: q, oninput: (e) => { q = e.target.value; store.notify(); } })),
        el('div', { class: 'scroll' }, el('table', { class: 'grid' }, el('tbody', {}, ...rows)))),
      el('div', { class: 'panel' },
        el('div', { class: 'row' }, el('h2', 'Console'), el('button', { class: 'btn small ghost', onclick: () => { showLog = !showLog; store.notify(); } }, showLog ? 'Hide' : 'Show')),
        showLog ? el('div', { class: 'log', style: 'max-height:40vh' }, ...log.map(l => el('div', { class: 'line ' + l.dir, text: `${l.dir === 'tx' ? '»' : l.dir === 'er' ? '✗' : '«'} ${l.text}` }))) : null));
  }
  return { render };
})();

// ---------- AWJ: field helpers shared by the setup-style views ----------
// A write on this protocol is answered with nothing, so every field reads its
// path back after a beat unless Live updates is carrying the change.
function awjWrite(path, v, extra = []) {
  store.pset(path, v);
  if (awjLive) return;
  setTimeout(() => { store.pget(path); for (const p of extra) store.pget(p); }, 150);
}
const awjWords = (v) => String(v ?? '·').toLowerCase().replace(/_/g, ' ');
function awjSelect(label, path, options, opts = {}) {
  const v = store.pval(path);
  const s = el('select', { disabled: !!opts.disabled, onchange: (e) => (opts.write || awjWrite)(path, e.target.value, opts.extra || []) });
  for (const o of options) {
    const val = typeof o === 'string' ? o : o.v;
    s.append(el('option', { value: val, selected: val === v, text: typeof o === 'string' ? awjWords(o) : o.text }));
  }
  if (v != null && !options.some(o => (typeof o === 'string' ? o : o.v) === v)) s.append(el('option', { value: v, selected: true, text: String(v) }));
  return label == null ? s : el('label', { class: 'field' }, label, s);
}
function awjNumber(label, path, min, max, opts = {}) {
  const inp = el('input', { class: opts.cls, type: 'number', min, max, step: opts.step ?? 1, value: store.pval(path) ?? '',
    onchange: (e) => { let n = +e.target.value || 0; if (!opts.float) n = Math.round(n); n = Math.max(min, Math.min(max, n)); (opts.write || awjWrite)(path, n, opts.extra || []); } });
  return label == null ? inp : el('label', { class: 'field' }, label, inp);
}
function awjText(label, path, maxlength = 32, opts = {}) {
  const inp = el('input', { class: opts.cls, type: 'text', maxlength, value: store.pval(path) ?? '', onchange: (e) => awjWrite(path, e.target.value) });
  return label == null ? inp : el('label', { class: 'field' }, label, inp);
}
function awjToggle(path, label, opts = {}) {
  const on = store.pval(path) === true;
  return el('button', { class: 'btn ' + (opts.small ? 'small ' : '') + (on ? (opts.cls || 'pgm') : 'ghost'), title: opts.title, disabled: !!opts.disabled,
    onclick: () => awjWrite(path, !on, opts.extra || []) }, typeof label === 'function' ? label(on) : label);
}
function awjRange(label, path, min, max, fmt = (v) => String(v)) {
  const v = store.pval(path);
  return el('label', { class: 'field slider' },
    el('span', {}, label, el('b', { class: 'sv', text: v == null ? '·' : fmt(v) })),
    el('input', { type: 'range', min, max, step: 1, value: v ?? min,
      onpointerdown: beginDrag, onpointerup: endDrag, onpointercancel: endDrag,
      oninput: (e) => { pthrottledSet(path, +e.target.value); e.target.parentNode.querySelector('.sv').textContent = fmt(+e.target.value); } }));
}
/** A trigger (`x…` property): written true, then the listed paths are read back after `after` ms. */
function awjTrigger(path, label, opts = {}) {
  return el('button', { class: 'btn ' + (opts.cls || 'ghost'), title: opts.title, disabled: !!opts.disabled, onclick: () => {
    store.pset(path, true);
    const re = () => { for (const p of opts.reads || []) store.pget(p); };
    setTimeout(re, opts.after ?? 300);
    if (opts.again) setTimeout(re, opts.again);
    if (opts.then) opts.then();
  } }, label);
}
function awjChip(cls, text) { return el('span', { class: 'chip ' + cls }, el('span', { class: 'dot' }), text); }
/** A chip for the device's own status words: idle / done / in progress / error. */
function awjStatusChip(s) {
  if (s == null) return awjChip('off', '·');
  const w = String(s);
  const cls = /ERROR|FAIL|INVALID|NOT_/.test(w) ? 'bad' : /DONE|OK|VALID|RUNNING|FINISH/.test(w) ? 'on' : /PROGRESS|TRANSITION/.test(w) ? 'pvw' : 'off';
  return awjChip(cls, awjWords(w));
}
/** A one-line status list of flag names, from a `…Filter` list, as toggle buttons. */
function awjFlagRow(path, values, opts = {}) {
  const set = new Set(Array.isArray(store.pval(path)) ? store.pval(path) : []);
  return el('div', { class: 'row wrap' }, ...values.map(f => el('button', {
    class: 'btn small ' + (set.has(f) ? (opts.cls || 'pgm') : 'ghost'),
    onclick: () => { const n = new Set(set); n.has(f) ? n.delete(f) : n.add(f); awjWrite(path, values.filter(x => n.has(x))); } },
    opts.text ? opts.text(f) : awjWords(f))));
}

// ---------- Midra 4K / Alta 4K: audio sources and inputs ----------
// Audio travels as eight-channel sources — an input's embedded audio (whichever
// plug is active), four Dante groups, two analogue line inputs, the media
// player and ten custom mixes — and every place it comes out is a routing
// point that either carries one source directly or follows something.
const MNG_AUDIO_SOURCES = ['NONE', ...Array.from({ length: 16 }, (_, i) => `IN${i + 1}`), 'IN_DANTE_CH1_8', 'IN_DANTE_CH9_16', 'IN_DANTE_CH17_24', 'IN_DANTE_CH25_32',
  'IN_ANALOG_1', 'IN_ANALOG_2', 'IN_MEDIA_PLAYER', ...Array.from({ length: 10 }, (_, i) => `CUSTOM_${i + 1}`)];
const MNG_AUDIO_INPUTS = ['IN1_SDI_EMBEDDED', 'IN1_HDMI_EMBEDDED', 'IN2_SDI_EMBEDDED', 'IN2_HDMI_EMBEDDED', 'IN3_SDI_EMBEDDED', 'IN4_SDI_EMBEDDED', 'IN5_HDMI_EMBEDDED', 'IN6_HDMI_EMBEDDED',
  'IN6_RJ45_EMBEDDED', 'IN7_HDMI_EMBEDDED', 'IN7_RJ45_EMBEDDED', 'IN8_HDMI_EMBEDDED', 'IN9_DP_EMBEDDED', 'IN10_DP_EMBEDDED', 'IN11_ACTIVE_PLUG_EMBEDDED', 'IN12_ACTIVE_PLUG_EMBEDDED',
  'IN13_ACTIVE_PLUG_EMBEDDED', 'IN14_ACTIVE_PLUG_EMBEDDED', 'IN15_ACTIVE_PLUG_EMBEDDED', 'IN16_ACTIVE_PLUG_EMBEDDED', 'IN_DANTE_CH1_8', 'IN_DANTE_CH9_16', 'IN_DANTE_CH17_24', 'IN_DANTE_CH25_32',
  'IN_ANALOG_1', 'IN_ANALOG_2', 'IN_MEDIA_PLAYER'];
const MNG_AUDIO_OUTPUTS = ['VIDEO_OUT_1', 'VIDEO_OUT_2', 'VIDEO_OUT_3', 'VIDEO_OUT_4', 'VIDEO_OUT_5', 'VIDEO_OUT_6'];
const MNG_AUDIO_PAIRS = ['CHANNEL_1_2', 'CHANNEL_3_4', 'CHANNEL_5_6', 'CHANNEL_7_8'];
/** "IN3 · Camera", "Dante 9–16", "Line in 2", "Custom 4 · Ambience". */
function mngAudioSourceName(v) {
  if (!v || v === 'NONE') return '— none —';
  let m;
  if ((m = /^IN(\d+)$/.exec(v))) return mngInputs.name(`INPUT_${m[1]}`);
  if ((m = /^IN_DANTE_CH(\d+)_(\d+)$/.exec(v))) return `Dante ${m[1]}–${m[2]}`;
  if ((m = /^IN_ANALOG_(\d)$/.exec(v))) return `Line in ${m[1]}`;
  if (v === 'IN_MEDIA_PLAYER') return 'Media player';
  if ((m = /^CUSTOM_(\d+)$/.exec(v))) { const l = store.pval(MNG.audioCustom(+m[1], 'label')); return `Custom ${m[1]}${l ? ' · ' + l : ''}`; }
  return String(v);
}
/** "IN1 SDI", "IN6 RJ45", "Dante 1–8", "Line in 1". */
function mngAudioInputName(k) {
  let m;
  if ((m = /^IN(\d+)_(SDI|HDMI|RJ45|DP|ACTIVE_PLUG)_EMBEDDED$/.exec(k))) return `IN${m[1]} ${m[2] === 'ACTIVE_PLUG' ? 'active plug' : m[2]}`;
  return mngAudioSourceName(k);
}
function mngAudioSourceOptions(cur) {
  const opts = MNG_AUDIO_SOURCES.filter(k => k === 'NONE' || store.pval(MNG.audioSourceAvailable(k)) === true).map(k => ({ v: k, text: mngAudioSourceName(k) }));
  if (cur && !opts.some(o => o.v === cur)) opts.push({ v: cur, text: String(cur) });
  return opts;
}

// ---------- AWJ: Audio (Midra 4K / Alta 4K) ----------
VIEWS.lpaudio = (() => {
  let read = false;
  let custom = 1;        // the custom source being edited
  const D = () => awj();
  function settle() {
    if (read || !store.meta || !store.connected) return;
    read = true;
    mngInputs.refresh();
    for (const p of ['mode', 'masterRate', 'transitionDelay']) store.pget(MNG.audioControl(p));
    for (const p of ['isDanteRateInvalid', 'mode', 'rate', 'frequency']) store.pget(MNG.audioStatus(p));
    for (const k of MNG_AUDIO_SOURCES) if (k !== 'NONE') store.pget(MNG.audioSourceAvailable(k));
    for (const k of MNG_AUDIO_INPUTS) for (const p of ['isAvailable', 'isAudioDetected', 'channelCount']) store.pget(MNG.audioInputStatus(k, p));
    for (const d of D().destinations()) {
      store.pget(MNG.destAudioMode(d)); store.pget(MNG.destAudioDirect(d)); store.pget(MNG.audioDestMute(d));
      if (d.kind === 'screen') store.pget(MNG.screenAudioFollowLayer(d.n));
      for (const b of ['UP', 'DOWN']) { store.pget(MNG.audioLayer(d, b)); store.pget(MNG.audioLayerStatus(d, b)); }
    }
    for (const k of ['1', '2', '3', '4', '5', '6']) { store.pget(MNG.outputAudioMode(k)); store.pget(MNG.outputAudioDirect(k)); }
    for (const k of MNG_AUDIO_OUTPUTS) { store.pget(MNG.audioOutputMute(k)); store.pget(MNG.audioOutputStatus(k, 'isAvailable')); store.pget(MNG.audioOutputStatus(k, 'source')); }
    for (const p of ['mode']) store.pget(MNG.mvwAudio(p));
    for (const p of [MNG.mvwAudioDirect(), MNG.mvwAudioVu(), MNG.mvwAudioFollow(), MNG.mvwAudioStatus('source'), MNG.mvwAudioVuValidity()]) store.pget(p);
    for (const n of [1, 2]) for (const p of [MNG.audioLineOut(n, 'mode'), MNG.audioLineOut(n, 'selectedAudioPair'), MNG.audioLineOutDirect(n), MNG.audioLineOutFollow(n)]) store.pget(p);
    for (const n of [1, 2, 3, 4]) for (const p of [MNG.danteGroup(n, 'mode'), MNG.danteGroupDirect(n), MNG.danteGroupFollow(n)]) store.pget(p);
    for (const p of ['global', 'type', 'id', 'version', 'ethernetMode', 'hasInitFailed']) store.pget(MNG.danteStatus(p));
    for (const p of ['ip', 'isPlugged', 'macAddress']) store.pget(MNG.danteIp('primary', p));
    for (let n = 1; n <= 32; n++) store.pget(MNG.danteChannelAvailable(n));
    store.pget(MNG.audioCustomChannels());
    for (let n = 1; n <= 10; n++) { store.pget(MNG.audioCustom(n, 'label')); store.pget(MNG.audioCustom(n, 'channelMapping')); }
    for (const side of ['input', 'output']) { store.pget(MNG.audioLevelSelect(side)); store.pget(MNG.audioLevel(side)); }
    store.pget(MNG.qpAudioMode()); store.pget(MNG.qpAudioForce());
    awjViewSubs = () => [MNG.SUB_AUDIO, MNG.SUB_QUICK_PRESET, MNG.SUB_MULTIVIEWER, ...D().destinations().map(d => MNG.subDestination(d) + '/audio'), ...D().destinations().flatMap(d => ['UP', 'DOWN'].map(b => `${MNG.subDestination(d)}/$preset/@items/${b}/audio`))];
    awjApplySubs();
  }
  function enter() { if (awjDialect() !== 'mng') return; read = false; settle(); }

  const srcSel = (path, disabled) => awjSelect(null, path, mngAudioSourceOptions(store.pval(path)), { disabled });

  function destRow(d) {
    const { program, preview } = D().buffers(d);
    const mode = store.pval(MNG.destAudioMode(d));
    const modes = d.kind === 'screen' ? ['FOLLOW_AUDIO_LAYER', 'FOLLOW_LIVE_LAYER_CONTENT', 'DIRECT_ROUTING'] : ['FOLLOW_AUDIO_LAYER', 'FOLLOW_CONTENT', 'DIRECT_ROUTING'];
    const words = { FOLLOW_AUDIO_LAYER: 'audio layer', FOLLOW_LIVE_LAYER_CONTENT: 'a live layer’s content', FOLLOW_CONTENT: 'its content', DIRECT_ROUTING: 'direct' };
    const layers = [];
    if (d.kind === 'screen') for (let l = 1; l <= 8; l++) { const m = store.pval(MNG.layerMode(d.n, l)); if (m !== undefined && m !== 'DISABLE') layers.push(String(l)); }
    return el('tr', {},
      el('td', { text: d.id }),
      el('td', { text: D().label(d) || '—' }),
      el('td', {}, srcSel(MNG.audioLayer(d, program))),
      el('td', {}, srcSel(MNG.audioLayer(d, preview))),
      el('td', {}, awjSelect(null, MNG.destAudioMode(d), modes.map(m => ({ v: m, text: words[m] })))),
      el('td', {}, mode === 'DIRECT_ROUTING' ? srcSel(MNG.destAudioDirect(d)) : mode === 'FOLLOW_LIVE_LAYER_CONTENT' && d.kind === 'screen'
        ? awjSelect(null, MNG.screenAudioFollowLayer(d.n), layers.map(l => ({ v: l, text: `layer ${l}` }))) : el('span', { class: 'hint', text: '—' })),
      el('td', {}, awjToggle(MNG.audioDestMute(d), (on) => on ? 'Muted' : 'Mute', { small: true, cls: 'bad' })));
  }
  function outputRow(k) {
    const key = `VIDEO_OUT_${k}`;
    const mode = store.pval(MNG.outputAudioMode(k));
    const avail = store.pval(MNG.audioOutputStatus(key, 'isAvailable'));
    return el('tr', { class: avail === false ? 'dim' : '' },
      el('td', { text: `OUT ${k}` }),
      el('td', {}, awjSelect(null, MNG.outputAudioMode(k), [{ v: 'AUTO', text: 'the screen it shows' }, { v: 'DIRECT_ROUTING', text: 'direct' }, { v: 'NONE', text: 'none' }])),
      el('td', {}, mode === 'DIRECT_ROUTING' ? srcSel(MNG.outputAudioDirect(k)) : el('span', { class: 'hint', text: '—' })),
      el('td', { class: 'val', text: mngAudioSourceName(store.pval(MNG.audioOutputStatus(key, 'source'))) }),
      el('td', {}, awjToggle(MNG.audioOutputMute(key), (on) => on ? 'Muted' : 'Mute', { small: true, cls: 'bad' })));
  }
  function mvwRow() {
    const mode = store.pval(MNG.mvwAudio('mode'));
    const widgets = (store.pval(MNG.mvwWidgetValidity()) || []).map(String);
    const vuOk = store.pval(MNG.mvwAudioVuValidity()) || ['NONE'];
    return el('tr', {},
      el('td', { text: 'MVW' }),
      el('td', {}, awjSelect(null, MNG.mvwAudio('mode'), [{ v: 'FOLLOW_WIDGET', text: 'a widget' }, { v: 'DIRECT_ROUTING', text: 'direct' }])),
      el('td', {}, mode === 'DIRECT_ROUTING' ? srcSel(MNG.mvwAudioDirect()) : awjSelect(null, MNG.mvwAudioFollow(), widgets.map(w => ({ v: w, text: `widget ${w}` })))),
      el('td', { class: 'val', text: mngAudioSourceName(store.pval(MNG.mvwAudioStatus('source'))) }),
      el('td', {}, el('label', { class: 'field' }, 'VU meters on ', awjSelect(null, MNG.mvwAudioVu(), vuOk.map(w => ({ v: String(w), text: w === 'NONE' ? 'no widget' : `widget ${w}` }))))));
  }
  function lineRow(n) {
    const mode = store.pval(MNG.audioLineOut(n, 'mode'));
    return el('tr', {},
      el('td', { text: `Line out ${n}` }),
      el('td', {}, awjSelect(null, MNG.audioLineOut(n, 'mode'), [{ v: 'FOLLOW_SCREEN', text: 'a screen' }, { v: 'DIRECT_ROUTING', text: 'direct' }])),
      el('td', {}, mode === 'DIRECT_ROUTING' ? srcSel(MNG.audioLineOutDirect(n)) : awjSelect(null, MNG.audioLineOutFollow(n), ['1', '2', '3', '4'].map(s => ({ v: s, text: `screen ${s}` })))),
      el('td', {}, awjSelect(null, MNG.audioLineOut(n, 'selectedAudioPair'), MNG_AUDIO_PAIRS.map(p => ({ v: p, text: 'channels ' + p.replace('CHANNEL_', '').replace('_', '–') })))),
      el('td', {}));
  }
  function danteRow(n) {
    const mode = store.pval(MNG.danteGroup(n, 'mode'));
    return el('tr', {},
      el('td', { text: `Dante ${(n - 1) * 8 + 1}–${n * 8}` }),
      el('td', {}, awjSelect(null, MNG.danteGroup(n, 'mode'), [{ v: 'FOLLOW_SCREEN', text: 'a screen' }, { v: 'DIRECT_ROUTING', text: 'direct' }])),
      el('td', {}, mode === 'DIRECT_ROUTING' ? srcSel(MNG.danteGroupDirect(n)) : awjSelect(null, MNG.danteGroupFollow(n), ['1', '2', '3', '4'].map(s => ({ v: s, text: `screen ${s}` })))),
      el('td', {}), el('td', {}));
  }
  function customPanel() {
    const chans = store.pval(MNG.audioCustomChannels()) || ['NONE'];
    const map = store.pval(MNG.audioCustom(custom, 'channelMapping')) || Array(8).fill('NONE');
    const chanName = (c) => c === 'NONE' ? '— none —' : (() => { const m = /^(.*)_CH(\d+)$/.exec(c); return m ? `${mngAudioInputName(m[1])} ch ${m[2]}` : awjWords(c); })();
    return el('div', {},
      el('div', { class: 'row wrap' }, el('div', { class: 'seg' }, ...Array.from({ length: 10 }, (_, i) => i + 1).map(n =>
        el('button', { class: n === custom ? 'on recall' : '', onclick: () => { custom = n; store.notify(); } }, `C${n}`)))),
      awjText(`Custom ${custom} label`, MNG.audioCustom(custom, 'label'), 32),
      el('div', { class: 'row wrap' }, ...map.map((c, i) => {
        const s = el('select', { onchange: (e) => { const next = [...map]; next[i] = e.target.value; awjWrite(MNG.audioCustom(custom, 'channelMapping'), next); } });
        for (const ch of chans) s.append(el('option', { value: ch, selected: ch === c, text: chanName(ch) }));
        if (!chans.includes(c)) s.append(el('option', { value: c, selected: true, text: chanName(c) }));
        return el('label', { class: 'field' }, `Channel ${i + 1}`, s);
      })),
      el('div', { class: 'hint', text: 'A custom source is eight channels picked one by one from any embedded, Dante or analogue channel the unit has; it is then offered wherever a source is.' }));
  }
  function inputsTable() {
    const rows = MNG_AUDIO_INPUTS.filter(k => store.pval(MNG.audioInputStatus(k, 'isAvailable')) === true);
    const sel = store.pval(MNG.audioLevelSelect('input')), lvl = store.pval(MNG.audioLevel('input'));
    return el('div', {},
      el('table', { class: 'grid' },
        el('thead', {}, el('tr', {}, ...['Audio input', 'Audio', 'Channels', 'Level'].map(h => el('th', { text: h })))),
        el('tbody', {}, ...rows.map(k => {
          const det = store.pval(MNG.audioInputStatus(k, 'isAudioDetected'));
          return el('tr', { class: sel === k ? 'sel' : '', onclick: () => { awjWrite(MNG.audioLevelSelect('input'), k); } },
            el('td', { text: mngAudioInputName(k) }),
            el('td', {}, awjChip(det === true ? 'on' : 'off', det === true ? 'detected' : det === false ? 'silent' : '·')),
            el('td', { class: 'val', text: String(store.pval(MNG.audioInputStatus(k, 'channelCount')) ?? '·') }),
            el('td', { class: 'val', text: sel === k && lvl != null ? String(lvl) : '' }));
        }))),
      el('div', { class: 'row' },
        awjTrigger(MNG.audioLevelRefresh('input'), 'Read level', { reads: [MNG.audioLevel('input')], after: 250 }),
        el('span', { class: 'hint', text: `of ${sel ? mngAudioInputName(sel) : 'the selected input'} — tap a row to select it; the unit reports one level at a time, on request.` })),
      rows.length ? null : el('div', { class: 'hint pad', text: 'No audio input has answered as available yet.' }));
  }
  function levelsOut() {
    const sel = store.pval(MNG.audioLevelSelect('output')), lvl = store.pval(MNG.audioLevel('output'));
    return el('div', { class: 'row wrap' },
      el('label', { text: 'Output level of ' }),
      awjSelect(null, MNG.audioLevelSelect('output'), MNG_AUDIO_OUTPUTS.map(k => ({ v: k, text: 'OUT ' + k.replace('VIDEO_OUT_', '') }))),
      awjTrigger(MNG.audioLevelRefresh('output'), 'Read level', { reads: [MNG.audioLevel('output')], after: 250 }),
      el('span', { class: 'val', text: sel && lvl != null ? String(lvl) : '·' }));
  }
  function dantePanel() {
    const g = store.pval(MNG.danteStatus('global'));
    const chans = []; for (let n = 1; n <= 32; n++) if (store.pval(MNG.danteChannelAvailable(n)) === true) chans.push(n);
    return el('div', {},
      el('div', { class: 'row wrap' },
        awjStatusChip(g),
        el('span', { class: 'hint', text: `${store.pval(MNG.danteStatus('type')) || 'no card'} · ${store.pval(MNG.danteStatus('version')) || '·'} · ${awjWords(store.pval(MNG.danteStatus('ethernetMode')))} · primary ${(store.pval(MNG.danteIp('primary', 'ip')) || []).join('.') || '·'}` })),
      el('table', { class: 'grid' },
        el('thead', {}, el('tr', {}, ...['Dante out', 'Follows', 'Source / screen', 'Pair', ''].map(h => el('th', { text: h })))),
        el('tbody', {}, ...[1, 2, 3, 4].map(danteRow))),
      chans.length ? el('table', { class: 'grid' },
        el('thead', {}, el('tr', {}, ...['Channel', 'Receives', 'Transmits as'].map(h => el('th', { text: h })))),
        el('tbody', {}, ...chans.map(n => el('tr', {},
          el('td', { text: String(n) }),
          el('td', {}, el('span', { class: 'val', text: store.pval(MNG.danteChannelSource(n, 'connectedTo')) || store.pval(MNG.danteChannelSource(n, 'label')) || '—' })),
          el('td', {}, el('span', { class: 'val', text: store.pval(MNG.danteChannelTx(n)) || '—' }))))))
        : el('div', { class: 'hint pad', text: 'No Dante channel has answered as available: the unit has no Dante card, or the card has not initialised. Subscriptions are made in Dante Controller.' }));
  }

  function render() {
    settle();
    const used = D().destinations();
    const rate = store.pval(MNG.audioStatus('rate')), freq = store.pval(MNG.audioStatus('frequency'));
    return el('div', {},
      el('div', { class: 'view-head' }, el('h1', { text: 'Audio' }), el('span', { class: 'hint', text: 'Where every output’s audio comes from — the audio layer each preset carries, or a source routed straight to it' })),
      el('div', { class: 'panel' }, awjLiveRow('audio changes'),
        el('div', { class: 'row wrap' },
          awjSelect('Clock', MNG.audioControl('mode'), [{ v: 'MASTER', text: 'internal' }, { v: 'DANTE', text: 'Dante' }]),
          awjSelect('Rate', MNG.audioControl('masterRate'), [{ v: '32K', text: '32 kHz' }, { v: '44K1', text: '44.1 kHz' }, { v: '48K', text: '48 kHz' }]),
          awjNumber('Transition delay', MNG.audioControl('transitionDelay'), 0, 100, { cls: 'num' }),
          awjChip(store.pval(MNG.audioStatus('isDanteRateInvalid')) === true ? 'bad' : 'on', `${awjWords(rate)}${freq ? ' · ' + freq + ' Hz' : ''}`),
          el('div', { class: 'grow' }),
          awjSelect('Quick preset audio', MNG.qpAudioMode(), [{ v: 'PRESET', text: 'what the preset says' }, { v: 'KEEP', text: 'keep the current' }, { v: 'MUTE', text: 'mute' }, { v: 'FORCE_SOURCE', text: 'force a source' }]),
          store.pval(MNG.qpAudioMode()) === 'FORCE_SOURCE' ? srcSel(MNG.qpAudioForce()) : null)),
      el('div', { class: 'panel' }, el('h2', 'Screens and auxiliaries'),
        used.length ? el('table', { class: 'grid' },
          el('thead', {}, el('tr', {}, ...['Destination', 'Label', 'Audio layer · program', 'Audio layer · preview', 'Output follows', 'Source / layer', ''].map(h => el('th', { text: h })))),
          el('tbody', {}, ...used.map(destRow))) : el('div', { class: 'hint pad', text: 'No screen or auxiliary is in service.' }),
        el('div', { class: 'hint pad', text: 'The audio layer is the part a show programs: one source per buffer, saved with the memory and swapped by the take exactly as the picture is. Program and preview here are the buffers the transition state names.' })),
      el('div', { class: 'split' },
        el('div', { class: 'panel' }, el('h2', 'Outputs'),
          el('table', { class: 'grid' },
            el('thead', {}, el('tr', {}, ...['Output', 'Follows', 'Source / widget', 'Carrying', ''].map(h => el('th', { text: h })))),
            el('tbody', {}, ...['1', '2', '3', '4', '5', '6'].map(outputRow), mvwRow())),
          el('table', { class: 'grid' },
            el('thead', {}, el('tr', {}, ...['Line out', 'Follows', 'Source / screen', 'Pair', ''].map(h => el('th', { text: h })))),
            el('tbody', {}, ...[1, 2].map(lineRow))),
          levelsOut(),
          el('h2', 'Dante'), dantePanel()),
        el('div', { class: 'panel' }, el('h2', 'Custom sources'), customPanel(),
          el('h2', 'Audio inputs'), inputsTable())));
  }
  return { enter, render };
})();

// ---------- Midra 4K / Alta 4K: LUT libraries, shared ----------
const mngLuts = (() => {
  let read = false;
  function fetch() {
    if (read) return;
    read = true;
    const slot = (n) => { for (const kind of ['conversion', 'correction']) { store.pget(MNG.lutBank(kind, n, 'label')); for (const prop of ['isValid', 'fileName', 'isUsed', ...(kind === 'conversion' ? ['fromColorSpace', 'fromHdrType', 'toColorSpace', 'toHdrType'] : ['colorSpace'])]) store.pget(MNG.lutBankStatus(kind, n, prop)); } };
    for (let n = 1; n <= 5; n++) slot(n);
    setTimeout(() => { if (store.pval(MNG.lutBankStatus('conversion', 5, 'isValid')) !== undefined) for (let n = 6; n <= MNG_LUT_SLOTS; n++) slot(n); }, 600);
    for (let n = 1; n <= MNG_LUT_RESOURCES; n++) store.pget(MNG.lutResource(n));
  }
  function reset() { read = false; }
  const slots = (kind) => { const out = []; for (let n = 1; n <= MNG_LUT_SLOTS; n++) if (store.pval(MNG.lutBankStatus(kind, n, 'isValid')) !== undefined) out.push(n); return out; };
  /** The option list for a LUT select: what the device allows here, named from the library. */
  function options(kind, validity) {
    return (validity || ['NONE']).map(v => ({ v: String(v), text: v === 'NONE' ? '— none —' : `${v} · ${store.pval(MNG.lutBank(kind, +v, 'label')) || store.pval(MNG.lutBankStatus(kind, +v, 'fileName')) || 'unnamed'}` }));
  }
  function panel() {
    fetch();
    return el('div', { class: 'panel' },
      el('h2', 'LUT libraries'),
      ...['conversion', 'correction'].map(kind => el('div', {},
        el('h2', { text: kind === 'conversion' ? 'Conversion LUTs (colour space and HDR)' : 'Correction LUTs' }),
        el('table', { class: 'grid' },
          el('thead', {}, el('tr', {}, ...['Slot', 'Label', 'File', kind === 'conversion' ? 'From → to' : 'Colour space', 'In use', ''].map(h => el('th', { text: h })))),
          el('tbody', {}, ...slots(kind).map(n => {
            const valid = store.pval(MNG.lutBankStatus(kind, n, 'isValid')) === true;
            const S = (prop) => store.pval(MNG.lutBankStatus(kind, n, prop));
            return el('tr', { class: valid ? '' : 'dim' },
              el('td', { text: String(n) }),
              el('td', {}, valid ? awjText(null, MNG.lutBank(kind, n, 'label'), 32) : el('span', { class: 'hint', text: 'empty' })),
              el('td', { class: 'val', text: valid ? (S('fileName') || '') : '' }),
              el('td', { class: 'val', text: valid ? (kind === 'conversion' ? `${awjWords(S('fromColorSpace'))} ${awjWords(S('fromHdrType'))} → ${awjWords(S('toColorSpace'))} ${awjWords(S('toHdrType'))}` : awjWords(S('colorSpace'))) : '' }),
              el('td', {}, valid ? awjChip(S('isUsed') === true ? 'on' : 'off', S('isUsed') === true ? 'in use' : 'free') : null),
              el('td', { class: 'acts' }, valid ? awjTrigger(MNG.lutBank(kind, n, 'xDelete'), 'Erase', { reads: ['isValid', 'fileName', 'isUsed'].map(prop => MNG.lutBankStatus(kind, n, prop)), after: 600 }) : null));
          }))))),
      el('div', { class: 'hint pad', text: 'A .cube file reaches a slot through the Web RCS’s upload (or a path on the unit); this page names, erases and allocates what is there.' }),
      el('h2', 'LUT resources'),
      el('div', { class: 'row wrap' }, ...Array.from({ length: MNG_LUT_RESOURCES }, (_, i) => i + 1).map(n =>
        el('label', { class: 'field' }, `Resource ${n} on`, awjSelect(null, MNG.lutResource(n), mngInputs.available().map(i => ({ v: i.key, text: `IN ${i.n}${i.label ? ' · ' + i.label : ''}` })))))),
      el('div', { class: 'hint', text: 'Four LUT processors; each serves one input, and only an input with one can run a conversion or correction LUT on its plug.' }));
  }
  return { fetch, reset, options, panel };
})();

// ---------- AWJ: Setup (Midra 4K / Alta 4K) ----------
// The preconfig — which outputs feed which screens, which layers each screen
// gets — is a working copy the device computes and then applies as a whole;
// applying rebuilds the pipeline and blanks every output for a few seconds.
// Below it, each screen's canvas (a grid of outputs, or free placement) and
// its own test pattern.
VIEWS.lpsetup = (() => {
  let read = false;
  let armApply = false;
  let tab = 'config';   // 'config' | 'canvas' | 'luts'
  const D = () => awj();
  const OUT_MODES = { DISABLE: 'off', SCREEN_FORMAT: 'screen', AUX: 'auxiliary', AUX_INPUT_AND_PROGRAM: 'aux: inputs and program', AUX_INPUT_ONLY: 'aux: inputs only', MULTIVIEWER: 'multiviewer' };
  const RES_MODES = { DISABLE: 'off', SEAMLESS: 'seamless (one layer)', SPLIT: 'split (two layers)' };
  const BG_TYPES = { DISABLE: 'none', LIVE_OR_FRAME: 'live or frame', ONLY_LIVE: 'live only', ONLY_FRAME: 'frame only' };
  const PATTERNS = ['NONE', 'GEOMETRIC', 'VERTICAL_GREY_SCALE', 'HORIZONTAL_GREY_SCALE', 'VERTICAL_COLOR_BAR', 'HORIZONTAL_COLOR_BAR', 'GRID_CUSTOM', 'SMPTE', 'VERTICAL_GRADIENT', 'HORIZONTAL_GRADIENT', 'CROSSHATCH', 'CHECKERBOARD', 'SOFTEDGE', 'THIRTY_BPP_1', 'THIRTY_BPP_2'];
  // A list-valued property is spelled like a collection on the wire: the
  // store's `outputList` is `$output` in the device's reply, whichever way
  // it was asked for, so it is asked for that way.
  const STATE_PROPS = { screen: ['enable', 'outputCount', '$output', 'layerCount', 'backgroundLayerType'], auxiliaryScreen: ['mode', '$output'], output: ['mode', 'usedOnScreen', 'usedOnAux'] };

  function settle() {
    if (read || !store.meta || !store.connected) return;
    read = true;
    for (const p of ['xApply', 'xCompute', 'xCopyFromCurrent']) store.pget(MNG.preconfigControl(p));
    for (const p of ['select']) store.pget(MNG.preconfigTemplate(p));
    for (const p of ['hasBeenAppliedOnce', 'applyDone', 'computeDone', 'templateValidity', 'screenValidity', 'auxValidity']) store.pget(MNG.preconfigStatus(p));
    for (let n = 1; n <= 4; n++) {
      for (const p of ['mode', 'useOnScreen']) store.pget(MNG.preconfigResource(n, p));
      for (const p of ['modeValidity', 'useOnScreenValidity']) store.pget(MNG.preconfigResourceValidity(n, p));
      for (const p of ['enable', 'backgroundLayerType']) store.pget(MNG.preconfigScreen(n, p));
      for (const p of ['backgroundLayerTypeValidity', 'topLayerValidity']) store.pget(MNG.preconfigScreenValidity(n, p));
      store.pget(MNG.preconfigAux(n));
      for (const st of ['NEW', 'CURRENT']) {
        for (const p of STATE_PROPS.screen) store.pget(MNG.preconfigState(st, 'screen', n, p));
        for (const p of STATE_PROPS.auxiliaryScreen) store.pget(MNG.preconfigState(st, 'auxiliaryScreen', n, p));
      }
      // The screen's own canvas and pattern.
      store.pget(MNG.screenMode(n)); store.pget(MNG.screenModeValidity(n));
      store.pget(MNG.canvasW(n)); store.pget(MNG.canvasH(n)); store.pget(MNG.screenCanvasWarn(n));
      for (const p of ['columnQty', 'rowQty', 'emptyCellWidth', 'emptyCellHeight']) store.pget(MNG.screenGrid(n, p));
      for (const p of ['columnQty', 'rowQty']) store.pget(MNG.screenGridStatus(n, p));
      for (const k of MNG_OUTPUTS) { for (const p of ['column', 'row']) store.pget(MNG.screenGridOutput(n, k, p)); for (const p of ['left', 'top']) store.pget(MNG.screenFreeOutput(n, k, p)); }
      for (let i = 1; i <= 5; i++) for (const dim of ['column', 'row']) {
        store.pget(MNG.screenGridSpacing(n, dim, i));
        for (const tail of ['curve/@props/enable', 'curve/@props/type', 'curve/@props/gamma', 'blackLevel/@props/offset', 'blackLevel/@props/red', 'blackLevel/@props/green', 'blackLevel/@props/blue']) store.pget(MNG.screenGridSoftedge(n, dim, i, tail));
      }
      for (const p of ['mode', 'sizeH', 'sizeV']) store.pget(MNG.screenFreeSize(n, p));
      for (const p of ['type', 'inhibit']) store.pget(MNG.screenPattern(n, p));
    }
    for (const k of MNG_OUTPUTS) {
      for (const p of ['mode', 'useOnScreen', 'useOnAux']) store.pget(MNG.preconfigOutput(k, p));
      for (const p of ['modeValidity', 'useOnScreenValidity', 'useOnAuxValidity']) store.pget(MNG.preconfigOutputValidity(k, p));
      for (const st of ['NEW', 'CURRENT']) for (const p of STATE_PROPS.output) store.pget(MNG.preconfigState(st, 'output', k, p));
    }
    awjViewSubs = () => [MNG.SUB_PRECONFIG, MNG.SUB_SCREENS];
    awjApplySubs();
  }
  function enter() { if (awjDialect() !== 'mng') return; read = false; armApply = false; mngLuts.reset(); settle(); }
  const reReadStates = () => { setTimeout(() => { read = false; settle(); }, 800); };

  const validity = (path, fallback) => { const v = store.pval(path); return Array.isArray(v) && v.length ? v : fallback; };
  const screenOpts = (path) => validity(path, ['1']).map(s => ({ v: String(s), text: `screen ${s}` }));

  function configPanel() {
    const tpl = store.pval(MNG.preconfigTemplate('select'));
    const computed = store.pval(MNG.preconfigStatus('computeDone')) === true;
    return el('div', { class: 'panel' },
      el('div', { class: 'row wrap' },
        awjChip(store.pval(MNG.preconfigStatus('hasBeenAppliedOnce')) === true ? 'on' : 'off', store.pval(MNG.preconfigStatus('hasBeenAppliedOnce')) === true ? 'a configuration is applied' : 'never applied'),
        awjChip(computed ? 'on' : 'off', computed ? 'computed' : 'not computed'),
        el('div', { class: 'grow' }),
        el('label', { class: 'field' }, 'Template', awjSelect(null, MNG.preconfigTemplate('select'), validity(MNG.preconfigStatus('templateValidity'), tpl ? [tpl] : []).map(t => ({ v: t, text: awjWords(t) })))),
        awjTrigger(MNG.preconfigTemplate('xLoad'), 'Load template', { title: 'Fill the working configuration from the template (nothing is applied)', then: reReadStates }),
        awjTrigger(MNG.preconfigControl('xCopyFromCurrent'), 'Copy from current', { title: 'Fill the working configuration from what is applied', then: reReadStates })),
      el('div', { class: 'split' },
        el('div', {},
          el('h2', 'Layer resources'),
          el('table', { class: 'grid' },
            el('thead', {}, el('tr', {}, ...['Resource', 'Mode', 'On screen'].map(h => el('th', { text: h })))),
            el('tbody', {}, ...[1, 2, 3, 4].map(n => {
              const modes = validity(MNG.preconfigResourceValidity(n, 'modeValidity'), ['DISABLE']);
              return el('tr', { class: modes.length === 1 && modes[0] === 'DISABLE' ? 'dim' : '' },
                el('td', { text: `Scaler ${n}` }),
                el('td', {}, awjSelect(null, MNG.preconfigResource(n, 'mode'), modes.map(m => ({ v: m, text: RES_MODES[m] || awjWords(m) })))),
                el('td', {}, awjSelect(null, MNG.preconfigResource(n, 'useOnScreen'), screenOpts(MNG.preconfigResourceValidity(n, 'useOnScreenValidity')), { disabled: store.pval(MNG.preconfigResource(n, 'mode')) === 'DISABLE' })));
            }))),
          el('h2', 'Screens'),
          el('table', { class: 'grid' },
            el('thead', {}, el('tr', {}, ...['Screen', 'In service', 'Background layer'].map(h => el('th', { text: h })))),
            el('tbody', {}, ...[1, 2, 3, 4].map(n => {
              const ok = validity(MNG.preconfigStatus('screenValidity'), ['1']).map(String).includes(String(n));
              return el('tr', { class: ok ? '' : 'dim' },
                el('td', { text: `S${n}` }),
                el('td', {}, awjToggle(MNG.preconfigScreen(n, 'enable'), (on) => on ? 'in service' : 'off', { small: true, cls: 'primary', disabled: !ok })),
                el('td', {}, awjSelect(null, MNG.preconfigScreen(n, 'backgroundLayerType'), validity(MNG.preconfigScreenValidity(n, 'backgroundLayerTypeValidity'), ['DISABLE']).map(t => ({ v: t, text: BG_TYPES[t] || awjWords(t) })), { disabled: !ok })));
            }))),
          el('h2', 'Auxiliaries'),
          el('div', { class: 'row wrap' }, ...[1, 2, 3, 4].map(n => {
            const ok = validity(MNG.preconfigStatus('auxValidity'), []).map(String).includes(String(n));
            return awjToggle(MNG.preconfigAux(n), (on) => `A${n} ${on ? 'in service' : 'off'}`, { small: true, cls: 'primary', disabled: !ok });
          }))),
        el('div', {},
          el('h2', 'Outputs'),
          el('table', { class: 'grid' },
            el('thead', {}, el('tr', {}, ...['Output', 'Role', 'Screen', 'Auxiliary'].map(h => el('th', { text: h })))),
            el('tbody', {}, ...MNG_OUTPUTS.map(k => {
              const modes = validity(MNG.preconfigOutputValidity(k, 'modeValidity'), ['DISABLE']);
              const mode = store.pval(MNG.preconfigOutput(k, 'mode'));
              return el('tr', { class: modes.length === 1 && modes[0] === 'DISABLE' ? 'dim' : '' },
                el('td', { text: k === 'MTVW' ? 'MVW' : `OUT ${k}` }),
                el('td', {}, awjSelect(null, MNG.preconfigOutput(k, 'mode'), modes.map(m => ({ v: m, text: OUT_MODES[m] || awjWords(m) })))),
                el('td', {}, awjSelect(null, MNG.preconfigOutput(k, 'useOnScreen'), screenOpts(MNG.preconfigOutputValidity(k, 'useOnScreenValidity')), { disabled: mode !== 'SCREEN_FORMAT' })),
                el('td', {}, awjSelect(null, MNG.preconfigOutput(k, 'useOnAux'), validity(MNG.preconfigOutputValidity(k, 'useOnAuxValidity'), ['1']).map(a => ({ v: String(a), text: `aux ${a}` })), { disabled: !String(mode || '').startsWith('AUX') })));
            }))),
          el('div', { class: 'hint pad', text: 'Every choice here is offered from the device’s own validity lists for the model and the cards it has; a change is held in the working configuration until it is computed and applied.' }))),
      el('div', { class: 'row wrap' },
        awjTrigger(MNG.preconfigControl('xCompute'), 'Compute', { cls: 'primary', title: 'Work out the new pipeline from the working configuration, without applying it', then: reReadStates }),
        el('button', { class: 'btn ' + (armApply ? 'pgm' : 'ghost'), disabled: !computed, onclick: () => {
          if (!armApply) { armApply = true; store.notify(); setTimeout(() => { armApply = false; store.notify(); }, 5000); return; }
          store.pset(MNG.preconfigControl('xApply'), true); armApply = false; store.notify();
          setTimeout(() => { read = false; settle(); for (const d of D().destinations()) D().refresh(d); }, 3000);
        } }, armApply ? 'Tap again to apply — every output goes dark for a few seconds' : 'Apply'),
        el('span', { class: 'hint', text: computed ? 'Applying rebuilds the whole pipeline: outputs blank, layers reset, memories stay.' : 'Compute first; Apply is offered once the device has a computed configuration.' })),
      statesTable());
  }
  function statesTable() {
    const cell = (st, list, key, p) => { const v = store.pval(MNG.preconfigState(st, list, key, p)); return Array.isArray(v) ? (v.length ? v.join(', ') : '—') : v == null ? '·' : typeof v === 'boolean' ? (v ? 'yes' : 'no') : awjWords(v); };
    const rows = [];
    for (let n = 1; n <= 4; n++) rows.push(['S' + n, ...['NEW', 'CURRENT'].map(st => `${cell(st, 'screen', n, 'enable') === 'yes' ? 'on' : 'off'} · outputs ${cell(st, 'screen', n, '$output')} · ${cell(st, 'screen', n, 'layerCount')} layers · bg ${cell(st, 'screen', n, 'backgroundLayerType')}`)]);
    for (let n = 1; n <= 4; n++) rows.push(['A' + n, ...['NEW', 'CURRENT'].map(st => `${cell(st, 'auxiliaryScreen', n, 'mode')} · outputs ${cell(st, 'auxiliaryScreen', n, '$output')}`)]);
    for (const k of MNG_OUTPUTS) rows.push([k === 'MTVW' ? 'MVW' : 'OUT ' + k, ...['NEW', 'CURRENT'].map(st => { const m = cell(st, 'output', k, 'mode'); return m === 'screen format' ? `screen ${cell(st, 'output', k, 'usedOnScreen')}` : m.startsWith('aux') ? `${m} ${cell(st, 'output', k, 'usedOnAux')}` : m; })]);
    return el('details', { class: 'group' }, el('summary', { text: 'Computed (new) against applied (current)' }),
      el('table', { class: 'grid' },
        el('thead', {}, el('tr', {}, ...['', 'New', 'Current'].map(h => el('th', { text: h })))),
        el('tbody', {}, ...rows.map(r => el('tr', {}, ...r.map((c, i) => el('td', { class: i ? 'val' : '', text: c })))))));
  }

  function canvasPanel(n) {
    const mode = store.pval(MNG.screenMode(n));
    const modes = validity(MNG.screenModeValidity(n), mode ? [mode] : []);
    const cols = store.pval(MNG.screenGrid(n, 'columnQty')) ?? 1, rows = store.pval(MNG.screenGrid(n, 'rowQty')) ?? 1;
    const outs = MNG_OUTPUTS.filter(k => store.pval(MNG.preconfigState('CURRENT', 'output', k, 'mode')) === 'SCREEN_FORMAT' && String(store.pval(MNG.preconfigState('CURRENT', 'output', k, 'usedOnScreen'))) === String(n));
    const gridReads = [MNG.canvasW(n), MNG.canvasH(n), MNG.screenGridStatus(n, 'columnQty'), MNG.screenGridStatus(n, 'rowQty'), MNG.screenCanvasWarn(n)];
    const w = store.pval(MNG.canvasW(n)), h = store.pval(MNG.canvasH(n));
    const idx = (q) => Array.from({ length: Math.max(1, q) }, (_, i) => String(i + 1));
    return el('div', { class: 'panel' },
      el('div', { class: 'row wrap' },
        el('h2', { text: `S${n} ${D().label(awjDest('S' + n)) || ''}`.trim() }),
        awjChip(store.pval(MNG.screenCanvasWarn(n)) === true ? 'bad' : 'on', `${w || '·'}×${h || '·'}${store.pval(MNG.screenCanvasWarn(n)) === true ? ' · outputs overlap' : ''}`),
        el('div', { class: 'grow' }),
        el('label', { class: 'field' }, 'Layout', awjSelect(null, MNG.screenMode(n), modes.map(m => ({ v: m, text: { SINGLE_OUT: 'one output', GRID: 'grid of outputs', FREE: 'free placement' }[m] || awjWords(m) })), { extra: gridReads })),
        el('label', { class: 'field' }, 'Test pattern', awjSelect(null, MNG.screenPattern(n, 'type'), PATTERNS)),
        awjToggle(MNG.screenPattern(n, 'inhibit'), (on) => on ? 'Pattern off' : 'Pattern on the screen', { title: 'The device inhibits its pattern by default; off here means shown', cls: 'ghost' })),
      mode === 'GRID' ? el('div', {},
        el('div', { class: 'row wrap' },
          awjNumber('Columns', MNG.screenGrid(n, 'columnQty'), 1, 6, { cls: 'num' }),
          awjNumber('Rows', MNG.screenGrid(n, 'rowQty'), 1, 6, { cls: 'num' }),
          awjNumber('Empty cell width', MNG.screenGrid(n, 'emptyCellWidth'), 1, 8192, { cls: 'num' }),
          awjNumber('Empty cell height', MNG.screenGrid(n, 'emptyCellHeight'), 1, 8192, { cls: 'num' }),
          ...idx(cols - 1).map(i => awjNumber(`Column gap ${i}`, MNG.screenGridSpacing(n, 'column', i), -8192, 8192, { cls: 'num' })),
          ...idx(rows - 1).map(i => awjNumber(`Row gap ${i}`, MNG.screenGridSpacing(n, 'row', i), -8192, 8192, { cls: 'num' }))),
        outs.length ? el('table', { class: 'grid' },
          el('thead', {}, el('tr', {}, ...['Output', 'Column', 'Row'].map(hh => el('th', { text: hh })))),
          el('tbody', {}, ...outs.map(k => el('tr', {},
            el('td', { text: k === 'MTVW' ? 'MVW' : `OUT ${k}` }),
            el('td', {}, awjSelect(null, MNG.screenGridOutput(n, k, 'column'), idx(cols))),
            el('td', {}, awjSelect(null, MNG.screenGridOutput(n, k, 'row'), idx(rows))))))) : el('div', { class: 'hint', text: 'No output is applied to this screen.' }),
        el('div', { class: 'row' },
          awjTrigger(MNG.screenGrid(n, 'xUpdate'), 'Apply grid', { cls: 'primary', reads: gridReads, after: 800 }),
          el('span', { class: 'hint', text: 'The grid is staged here and applied with the device’s update trigger; the canvas size follows from the outputs’ formats and the gaps.' })),
        softedgePanel(n, cols, rows))
      : mode === 'FREE' ? el('div', {},
        el('div', { class: 'row wrap' },
          awjSelect('Canvas size', MNG.screenFreeSize(n, 'mode'), [{ v: 'AUTO', text: 'fit the outputs' }, { v: 'CUSTOM', text: 'custom' }]),
          awjNumber('Width', MNG.screenFreeSize(n, 'sizeH'), 1, 16384, { cls: 'num' }),
          awjNumber('Height', MNG.screenFreeSize(n, 'sizeV'), 1, 16384, { cls: 'num' })),
        outs.length ? el('table', { class: 'grid' },
          el('thead', {}, el('tr', {}, ...['Output', 'Left', 'Top'].map(hh => el('th', { text: hh })))),
          el('tbody', {}, ...outs.map(k => el('tr', {},
            el('td', { text: k === 'MTVW' ? 'MVW' : `OUT ${k}` }),
            el('td', {}, awjNumber(null, MNG.screenFreeOutput(n, k, 'left'), -16384, 16384, { cls: 'num' })),
            el('td', {}, awjNumber(null, MNG.screenFreeOutput(n, k, 'top'), -16384, 16384, { cls: 'num' })))))) : el('div', { class: 'hint', text: 'No output is applied to this screen.' }),
        el('div', { class: 'row' },
          awjTrigger(MNG.screenFreeUpdate(n), 'Apply placement', { cls: 'primary', reads: gridReads, after: 800 }),
          el('span', { class: 'hint', text: 'Each output is placed by its top-left corner on the canvas.' })))
      : el('div', { class: 'hint pad', text: mode === 'SINGLE_OUT' ? 'One output: the canvas is that output’s format.' : 'The screen has not reported a layout mode.' }));
  }

  // Soft edge on each gap of a grid, for the models that blend (Eikos 4K):
  // a curve (gamma or Bézier) and a black level, applied with the grid's own
  // soft-edge trigger. A negative gap is the overlap the blend runs across.
  function softedgePanel(n, cols, rows) {
    const gaps = [...Array.from({ length: Math.max(0, cols - 1) }, (_, i) => ['column', i + 1]), ...Array.from({ length: Math.max(0, rows - 1) }, (_, i) => ['row', i + 1])];
    if (!gaps.length) return null;
    const SE = (dim, i, tail) => MNG.screenGridSoftedge(n, dim, i, tail);
    return el('details', { class: 'group' }, el('summary', { text: 'Soft edge (models that blend)' }),
      ...gaps.map(([dim, i]) => el('div', { class: 'row wrap' },
        el('b', { text: `${dim} gap ${i}` }),
        awjToggle(SE(dim, i, 'curve/@props/enable'), (on) => on ? 'Blend on' : 'Blend off', { small: true }),
        awjSelect('Curve', SE(dim, i, 'curve/@props/type'), [{ v: 'GAMMA', text: 'gamma' }, { v: 'BEZIER', text: 'Bézier' }]),
        awjNumber('Gamma ×10', SE(dim, i, 'curve/@props/gamma'), 1, 100, { cls: 'num' }),
        awjNumber('Black offset', SE(dim, i, 'blackLevel/@props/offset'), 0, 255, { cls: 'num' }),
        ...['red', 'green', 'blue'].map(ch => awjNumber(ch[0].toUpperCase(), SE(dim, i, `blackLevel/@props/${ch}`), 0, 255, { cls: 'num' })))),
      el('div', { class: 'row' },
        awjTrigger(MNG.screenGrid(n, 'xSoftedgeUpdate'), 'Apply soft edge', { cls: 'primary', after: 800 }),
        el('span', { class: 'hint', text: 'Set the gap negative for the overlap, enable the blend on it and apply. Only an Eikos 4K blends; the others carry the settings and do nothing with them.' })));
  }

  function render() {
    settle();
    const screens = [1, 2, 3, 4].filter(n => store.pval(MNG.screenEnabled(n)) === true);
    return el('div', {},
      el('div', { class: 'view-head' }, el('h1', { text: 'Setup' }), el('span', { class: 'hint', text: 'The device’s configuration — outputs to screens, layers to screens — and each screen’s canvas and test pattern' })),
      el('div', { class: 'panel' }, awjLiveRow('configuration changes'),
        el('div', { class: 'row' }, el('div', { class: 'seg' },
          el('button', { class: tab === 'config' ? 'on recall' : '', onclick: () => { tab = 'config'; store.notify(); } }, 'Configuration'),
          el('button', { class: tab === 'canvas' ? 'on recall' : '', onclick: () => { tab = 'canvas'; store.notify(); } }, 'Canvases and patterns'),
          el('button', { class: tab === 'luts' ? 'on recall' : '', onclick: () => { tab = 'luts'; store.notify(); } }, 'LUTs')))),
      tab === 'config' ? configPanel()
        : tab === 'luts' ? mngLuts.panel()
        : screens.length ? el('div', {}, ...screens.map(canvasPanel)) : el('div', { class: 'panel' }, el('div', { class: 'hint pad', text: 'No screen is in service in the applied configuration.' })));
  }
  return { enter, render };
})();

// ---------- Midra 4K / Alta 4K: output extras (canvas, HDR, plug, custom formats) ----------
// Called from the Outputs view for the selected output. The area of interest
// and the pitch are staged and applied with their own update triggers; the
// plug carries HDCP, pixel encoding and the display's EDID.
const MNG_CUSTOM_FORMATS = 16;
const MNG_LUT_SLOTS = 20;   // the enum's bound; a Pulse 4K on 3.3.10 carries four, so slots past five are read only if five answers
const MNG_LUT_RESOURCES = 4;
const mngOutputExtras = (() => {
  const read = new Set();
  let cfRead = false;
  let cfSlot = 1;
  let edidLabel = '';
  const HDCP_POLICY = [{ v: 'DISABLE', text: 'off' }, { v: 'AUTO', text: 'auto' }, { v: 'HDCP_1X', text: '1.x' }, { v: 'HDCP_2X_TYPE_0', text: '2.x type 0' }, { v: 'HDCP_2X_TYPE_1', text: '2.x type 1' }];
  const NITS = ['AUTO', '100_NITS', '200_NITS', '300_NITS', '400_NITS', '500_NITS', '600_NITS', '700_NITS', '800_NITS', '900_NITS', '1000_NITS', '1200_NITS', '1400_NITS', '1600_NITS', '1800_NITS', '2000_NITS', '3000_NITS', '4000_NITS', '5000_NITS', '6000_NITS', '7000_NITS', '8000_NITS', '9000_NITS', '10000_NITS'];
  const CF_FIELDS = [['fullHsync', 'H sync', 1, 4096], ['fullHbackPorch', 'H back porch', 0, 4096], ['fullHfrontPorch', 'H front porch', 0, 4096], ['fullCvtHutil', 'Active width', 64, 8192],
    ['fullVsync', 'V sync', 1, 4096], ['fullVbackPorch', 'V back porch', 0, 4096], ['fullVfrontPorch', 'V front porch', 0, 4096], ['fullCvtVutil', 'Active height', 64, 8192]];
  function fetch(k) {
    if (read.has(k)) return;
    read.add(k);
    for (const p of ['mode', 'overscan', 'top', 'left', 'width', 'height']) store.pget(MNG.outputAoi(k, p));
    for (const p of ['pitchRatioH', 'pitchRatioV']) store.pget(MNG.outputPitch(k, p));
    for (const p of ['aoiWidth', 'aoiHeight', 'pitchedWidth', 'pitchedHeight', 'maxWidth', 'maxHeight', 'isUsedInScreen']) store.pget(MNG.outputCanvasStatus(k, p));
    for (const p of ['mode', 'nitLevel']) { store.pget(MNG.outputHdr(k, p)); store.pget(MNG.outputHdrStatus(k, p)); }
    store.pget(MNG.outputSetting(k, 'colorSpace'));
    for (const p of ['enableHdcp', 'pixelEncoding', 'sdiTransport', 'forceDviMode']) store.pget(MNG.outputPlugControl(k, 1, p));
    for (const p of ['pixelEncodingFormatValidity', 'hdcpValidity', 'sdiValidity', 'isHdcp', 'hasHdcpWarning', 'isMonitorDetected', 'monitorName', 'colorSpace', 'colorDepth']) store.pget(MNG.outputPlugStatus(k, 1, p));
    store.pget(MNG.outputPlugAudioMode(k, 1)); store.pget(MNG.outputPlugAudioValidity(k, 1));
    for (const prop of ['mode', 'source']) { store.pget(MNG.outputConversionLut(k, prop)); store.pget(MNG.outputCorrectionLut(k, prop)); }
    for (const prop of ['isEnabled', 'state', 'sourceValidity']) { store.pget(MNG.outputConversionLutStatus(k, prop)); store.pget(MNG.outputCorrectionLutStatus(k, prop)); }
    mngLuts.fetch();
    store.pget(MNG.outputPlugEdid(k, 1, 'isAvailable')); store.pget(MNG.outputPlugEdid(k, 1, 'data'));
  }
  function fetchCustomFormats() {
    if (cfRead) return;
    cfRead = true;
    for (let n = 1; n <= MNG_CUSTOM_FORMATS; n++) { store.pget(MNG.cfBank(n, 'userName')); for (const p of ['displayName', 'isValid', 'hUtil', 'vUtil', 'rate', 'mode']) store.pget(MNG.cfBankStatus(n, p)); }
    for (const p of ['mode', 'userName', 'cvtReducedBlk', 'fullHsyncPol', 'fullVsyncPol', 'fullCvtRate', ...CF_FIELDS.map(f => f[0])]) store.pget(MNG.cfSetting(p));
    for (const p of ['checkResult', 'checkStatus', 'displayName', 'hTotal', 'vTotal', 'pixelFrequency', 'lineFrequency']) store.pget(MNG.cfStatus(p));
  }
  function reset() { read.clear(); cfRead = false; }

  function canvas(k) {
    fetch(k);
    const aoiReads = ['mode', 'overscan', 'top', 'left', 'width', 'height'].map(p => MNG.outputAoi(k, p)).concat(['aoiWidth', 'aoiHeight', 'pitchedWidth', 'pitchedHeight'].map(p => MNG.outputCanvasStatus(k, p)));
    const custom = store.pval(MNG.outputAoi(k, 'mode')) === 'CUSTOM';
    const pct = (v) => (v / 1000).toFixed(1) + '%';
    return el('details', { class: 'group' }, el('summary', {}, 'Area of interest and pitch ', awjChip(custom ? 'on' : 'off', `${store.pval(MNG.outputCanvasStatus(k, 'aoiWidth')) ?? '·'}×${store.pval(MNG.outputCanvasStatus(k, 'aoiHeight')) ?? '·'} of ${store.pval(MNG.outputCanvasStatus(k, 'maxWidth')) ?? '·'}×${store.pval(MNG.outputCanvasStatus(k, 'maxHeight')) ?? '·'}`)),
      el('div', { class: 'row wrap' },
        awjSelect('Area', MNG.outputAoi(k, 'mode'), [{ v: 'FIT_FORMAT', text: 'the whole format' }, { v: 'CUSTOM', text: 'custom' }]),
        awjNumber('Overscan ‰', MNG.outputAoi(k, 'overscan'), 0, 100000, { cls: 'num', step: 100 })),
      custom ? el('div', { class: 'row wrap' },
        ...[['left', 'Left'], ['top', 'Top'], ['width', 'Width'], ['height', 'Height']].map(([p, l]) => awjNumber(`${l} (${pct(store.pval(MNG.outputAoi(k, p)) ?? 0)})`, MNG.outputAoi(k, p), 0, 100000, { cls: 'num', step: 100 }))) : null,
      el('div', { class: 'row' },
        awjTrigger(MNG.outputAoi(k, 'xUpdate'), 'Apply area', { cls: 'primary', reads: aoiReads, after: 800 }),
        el('span', { class: 'hint', text: 'The part of the format the screen’s canvas fills — in thousandths of the format, so 25000 is a quarter. Applied with the device’s own trigger.' })),
      el('div', { class: 'row wrap' },
        awjNumber('Pitch H ×1000', MNG.outputPitch(k, 'pitchRatioH'), 1, 4000, { cls: 'num' }),
        awjNumber('Pitch V ×1000', MNG.outputPitch(k, 'pitchRatioV'), 1, 4000, { cls: 'num' }),
        awjTrigger(MNG.outputPitch(k, 'xUpdate'), 'Apply pitch', { reads: aoiReads, after: 800 }),
        el('span', { class: 'hint', text: `Pitched ${store.pval(MNG.outputCanvasStatus(k, 'pitchedWidth')) ?? '·'}×${store.pval(MNG.outputCanvasStatus(k, 'pitchedHeight')) ?? '·'} — for LED walls whose pixel pitch differs from the format’s.` })));
  }
  function signal(k) {
    fetch(k);
    const pe = store.pval(MNG.outputPlugStatus(k, 1, 'pixelEncodingFormatValidity')) || [];
    const audioModes = store.pval(MNG.outputPlugAudioValidity(k, 1)) || [];
    const hdcpOk = store.pval(MNG.outputPlugStatus(k, 1, 'hdcpValidity')) || [];
    const sdiOk = store.pval(MNG.outputPlugStatus(k, 1, 'sdiValidity')) || [];
    const hdcpOn = store.pval(MNG.outputPlugStatus(k, 1, 'isHdcp')) === true, hdcpWarn = store.pval(MNG.outputPlugStatus(k, 1, 'hasHdcpWarning')) === true;
    return el('details', { class: 'group' }, el('summary', { text: 'Signal, HDR and HDCP' }),
      el('div', { class: 'row wrap' },
        awjSelect('HDR', MNG.outputHdr(k, 'mode'), ['AUTO', 'SDR', 'HDR10', 'HLG']),
        awjSelect('Nits', MNG.outputHdr(k, 'nitLevel'), NITS.map(v => ({ v, text: v === 'AUTO' ? 'auto' : v.replace('_NITS', '') }))),
        awjChip('off', `sending ${awjWords(store.pval(MNG.outputHdrStatus(k, 'mode')))} ${store.pval(MNG.outputHdrStatus(k, 'nitLevel')) || ''}`)),
      el('div', { class: 'row wrap' },
        awjSelect('Colorimetry', MNG.outputSetting(k, 'colorSpace'), [{ v: 'AUTO', text: 'auto' }, { v: 'ITU_BT709', text: 'BT.709' }, { v: 'ITU_BT2020', text: 'BT.2020' }]),
        awjSelect('Pixel encoding', MNG.outputPlugControl(k, 1, 'pixelEncoding'), pe.map(v => ({ v, text: v === 'AUTO' ? 'auto' : v.replace(/_/g, ' ').replace('8B', '8-bit').replace('10B', '10-bit').replace('12B', '12-bit').toLowerCase() })), { disabled: !pe.length }),
        awjSelect('HDCP', MNG.outputPlugControl(k, 1, 'enableHdcp'), (hdcpOk.length ? HDCP_POLICY.filter(o => hdcpOk.includes(o.v)) : HDCP_POLICY)),
        awjChip(hdcpWarn ? 'bad' : hdcpOn ? 'on' : 'off', hdcpWarn ? 'HDCP refused by the display' : hdcpOn ? 'HDCP on the link' : 'no HDCP on the link'),
        awjChip('off', `${awjWords(store.pval(MNG.outputPlugStatus(k, 1, 'colorSpace')))} ${awjWords(store.pval(MNG.outputPlugStatus(k, 1, 'colorDepth')))}`.trim())),
      el('div', { class: 'row wrap' },
        awjSelect('Embedded audio', MNG.outputPlugAudioMode(k, 1), audioModes.map(v => ({ v, text: v === 'DISABLE' ? 'off' : v === 'AUTO' ? 'auto' : v.replace('_CHANNELS', ' channels') })), { disabled: !audioModes.length }),
        sdiOk.length ? awjSelect('SDI', MNG.outputPlugControl(k, 1, 'sdiTransport'), sdiOk.map(v => ({ v, text: awjWords(v) }))) : null,
        awjToggle(MNG.outputPlugControl(k, 1, 'forceDviMode'), 'Force DVI', { small: true })));
  }
  function luts(k) {
    fetch(k);
    return el('details', { class: 'group' }, el('summary', { text: 'LUTs' }),
      el('div', { class: 'row wrap' },
        awjSelect('Conversion', MNG.outputConversionLut(k, 'mode'), [{ v: 'AUTO', text: 'auto' }, { v: 'CUSTOM', text: 'custom' }]),
        awjSelect('Conversion LUT', MNG.outputConversionLut(k, 'source'), mngLuts.options('conversion', store.pval(MNG.outputConversionLutStatus(k, 'sourceValidity')))),
        awjChip(store.pval(MNG.outputConversionLutStatus(k, 'isEnabled')) === true ? 'on' : 'off', awjWords(store.pval(MNG.outputConversionLutStatus(k, 'state'))))),
      el('div', { class: 'row wrap' },
        awjSelect('Correction', MNG.outputCorrectionLut(k, 'mode'), [{ v: 'MANUAL', text: 'manual' }, { v: 'AUTO', text: 'auto' }]),
        awjSelect('Correction LUT', MNG.outputCorrectionLut(k, 'source'), mngLuts.options('correction', store.pval(MNG.outputCorrectionLutStatus(k, 'sourceValidity')))),
        awjChip(store.pval(MNG.outputCorrectionLutStatus(k, 'isEnabled')) === true ? 'on' : 'off', awjWords(store.pval(MNG.outputCorrectionLutStatus(k, 'state'))))),
      el('div', { class: 'hint', text: 'A conversion LUT changes colour space or HDR on the way out; a correction LUT is applied after it. The lists offer what the libraries hold.' }));
  }
  function display(k) {
    fetch(k);
    const data = store.pval(MNG.outputPlugEdid(k, 1, 'data'));
    const avail = store.pval(MNG.outputPlugEdid(k, 1, 'isAvailable'));
    const e = avail === true ? mngEdidSummary(data) : null;
    const mon = store.pval(MNG.outputPlugStatus(k, 1, 'monitorName')), monOn = store.pval(MNG.outputPlugStatus(k, 1, 'isMonitorDetected'));
    return el('details', { class: 'group' }, el('summary', {}, 'Connected display ', monOn === true ? awjChip('on', mon || 'detected') : monOn === false ? awjChip('off', 'none detected') : null),
      e && !e.bad ? el('div', { class: 'hint', text: `${e.mfr} ${e.name || '(unnamed)'} — preferred ${e.pw}×${e.ph}${e.rate ? ' at ' + e.rate + ' Hz' : ''}, ${e.year}, ${e.ext} extension block${e.ext === 1 ? '' : 's'}.` })
        : el('div', { class: 'hint', text: avail === false ? 'No display EDID on this plug.' : 'No EDID read yet.' }),
      e && !e.bad ? el('div', { class: 'row wrap' },
        el('label', { class: 'field' }, 'Save it to the library as ', el('input', { type: 'text', maxlength: 32, value: edidLabel, oninput: (ev) => { edidLabel = ev.target.value; } })),
        el('label', { class: 'field' }, 'in slot ', el('input', { class: 'num', type: 'number', min: 1, max: MNG_EDID_SLOTS, value: cfSlot, onchange: (ev) => { cfSlot = Math.max(1, Math.min(MNG_EDID_SLOTS, Math.round(+ev.target.value || 1))); } })),
        el('button', { class: 'btn primary', onclick: () => {
          // The editor takes the bytes and a label; the save trigger files
          // them in a user slot, from where an input plug can load them.
          store.pset(MNG.edidEdit('data'), data);
          store.pset(MNG.edidEdit('label'), edidLabel || `${e.mfr} ${e.name}`.trim());
          setTimeout(() => store.pset(MNG.edidSave(cfSlot), true), 200);
          setTimeout(() => { for (const p of ['isAvailable', 'prefFormatName', 'productName']) store.pget(MNG.edidBankStatus(String(cfSlot), p)); store.pget(MNG.edidBank(String(cfSlot), 'label')); }, 900);
        } }, 'Save EDID')) : null,
      el('div', { class: 'hint', text: 'What the display on this output declares. Saved into the EDID library it can be presented by any input, so a source sees the same monitor the wall does.' }));
  }
  function customFormats() {
    fetchCustomFormats();
    const mode = store.pval(MNG.cfSetting('mode'));
    const checkReads = ['checkResult', 'checkStatus', 'displayName', 'hTotal', 'vTotal', 'pixelFrequency', 'lineFrequency'].map(p => MNG.cfStatus(p));
    const result = store.pval(MNG.cfStatus('checkResult')), status = store.pval(MNG.cfStatus('checkStatus'));
    const slotReads = (n) => [MNG.cfBank(n, 'userName'), ...['displayName', 'isValid', 'hUtil', 'vUtil', 'rate', 'mode'].map(p => MNG.cfBankStatus(n, p))];
    return el('div', { class: 'panel' }, el('h2', 'Custom formats'),
      el('table', { class: 'grid' },
        el('thead', {}, el('tr', {}, ...['Slot', 'Name', 'Timing', ''].map(h => el('th', { text: h })))),
        el('tbody', {}, ...Array.from({ length: MNG_CUSTOM_FORMATS }, (_, i) => i + 1).map(n => {
          const valid = store.pval(MNG.cfBankStatus(n, 'isValid')) === true;
          return el('tr', { class: valid ? '' : 'dim' },
            el('td', { text: String(n) }),
            el('td', {}, valid ? awjText(null, MNG.cfBank(n, 'userName'), 32) : el('span', { class: 'hint', text: 'empty' })),
            el('td', { class: 'val', text: valid ? `${store.pval(MNG.cfBankStatus(n, 'displayName')) || ''} ${store.pval(MNG.cfBankStatus(n, 'hUtil')) ?? ''}×${store.pval(MNG.cfBankStatus(n, 'vUtil')) ?? ''} @ ${((store.pval(MNG.cfBankStatus(n, 'rate')) ?? 0) / 1000).toFixed(3)} Hz ${awjWords(store.pval(MNG.cfBankStatus(n, 'mode')))}`.trim() : '' }),
            el('td', { class: 'acts' }, valid ? awjTrigger(MNG.cfBank(n, 'xDelete'), 'Erase', { reads: slotReads(n), after: 500 }) : null));
        }))),
      el('div', { class: 'hint pad', text: 'A saved custom format is offered in every output’s format list, after the device’s own.' }),
      el('h2', 'New custom format'),
      el('div', { class: 'row wrap' },
        awjText('Name', MNG.cfSetting('userName'), 32),
        awjSelect('Timing', MNG.cfSetting('mode'), [{ v: 'CVT', text: 'CVT (from size and rate)' }, { v: 'FULL', text: 'full (every porch typed)' }]),
        awjNumber('Width', MNG.cfSetting('fullCvtHutil'), 64, 8192, { cls: 'num' }),
        awjNumber('Height', MNG.cfSetting('fullCvtVutil'), 64, 8192, { cls: 'num' }),
        awjNumber('Rate mHz', MNG.cfSetting('fullCvtRate'), 23000, 240000, { cls: 'num', step: 1 }),
        mode === 'CVT' ? awjToggle(MNG.cfSetting('cvtReducedBlk'), 'Reduced blanking', { small: true }) : null),
      mode === 'FULL' ? el('div', { class: 'row wrap' },
        ...CF_FIELDS.filter(f => !f[0].includes('Cvt')).map(([p, l, min, max]) => awjNumber(l, MNG.cfSetting(p), min, max, { cls: 'num' })),
        awjToggle(MNG.cfSetting('fullHsyncPol'), 'H sync +', { small: true }),
        awjToggle(MNG.cfSetting('fullVsyncPol'), 'V sync +', { small: true })) : null,
      el('div', { class: 'row wrap' },
        awjTrigger(MNG.cfControl('xCheck'), 'Check', { cls: 'primary', reads: checkReads, after: 500 }),
        awjStatusChip(status === 'NEVER_CHECKED' ? 'NEVER_CHECKED' : result),
        el('span', { class: 'hint', text: status && status !== 'NEVER_CHECKED' ? `${store.pval(MNG.cfStatus('displayName')) || ''} — total ${store.pval(MNG.cfStatus('hTotal')) ?? '·'}×${store.pval(MNG.cfStatus('vTotal')) ?? '·'}, ${((store.pval(MNG.cfStatus('pixelFrequency')) ?? 0) / 1e6).toFixed(3)} MHz pixel clock, ${((store.pval(MNG.cfStatus('lineFrequency')) ?? 0) / 1000).toFixed(2)} kHz lines` : 'The device checks the timing before it can be saved.' }),
        el('div', { class: 'grow' }),
        el('label', { class: 'field' }, 'Save to slot ', el('input', { class: 'num', type: 'number', min: 1, max: MNG_CUSTOM_FORMATS, value: cfSlot, onchange: (ev) => { cfSlot = Math.max(1, Math.min(MNG_CUSTOM_FORMATS, Math.round(+ev.target.value || 1))); } })),
        el('button', { class: 'btn ' + (result === 'VALID' ? 'primary' : 'ghost'), disabled: result !== 'VALID', onclick: () => { const n = cfSlot; store.pset(MNG.cfSave(n), true); setTimeout(() => { for (const p of slotReads(n)) store.pget(p); }, 600); } }, 'Save'),
        awjTrigger(MNG.cfControl('xReset'), 'Reset editor', { reads: [...checkReads, ...['mode', 'userName', 'cvtReducedBlk', 'fullCvtRate', ...CF_FIELDS.map(f => f[0])].map(p => MNG.cfSetting(p))], after: 400 })));
  }
  return { reset, canvas, signal, luts, display, customFormats };
})();

/** The base-block facts of an EDID: manufacturer, product name, preferred timing. */
function mngEdidSummary(data) {
  if (!Array.isArray(data) || data.length < 128) return null;
  if (data[0] !== 0 || data[1] !== 255 || data[7] !== 0) return { bad: true };
  const id = (data[8] << 8) | data[9];
  const mfr = String.fromCharCode(64 + ((id >> 10) & 31), 64 + ((id >> 5) & 31), 64 + (id & 31));
  let name = '';
  for (let d = 54; d <= 108; d += 18) {
    if (data[d] === 0 && data[d + 1] === 0 && data[d + 3] === 0xFC) name = String.fromCharCode(...data.slice(d + 5, d + 18)).replace(/[\n\0][^]*$/, '').trim();
  }
  const pw = ((data[58] & 0xF0) << 4) | data[56], ph = ((data[61] & 0xF0) << 4) | data[59];
  const clock = ((data[55] << 8) | data[54]) / 100;
  const hb = ((data[58] & 0x0F) << 8) | data[57], vb = ((data[61] & 0x0F) << 8) | data[60];
  const rate = clock && pw && ph ? (clock * 1e6) / ((pw + hb) * (ph + vb)) : 0;
  return { mfr, name, pw, ph, rate: rate ? rate.toFixed(2) : '', year: 1990 + data[17], ext: data[126] };
}

// ---------- Midra 4K / Alta 4K: configuration slots and streaming (System) ----------
const mngSystemExtras = (() => {
  let read = false;
  let armed = null;       // 'delete-1' | 'delete-2' | 'restore-1' | 'restore-2'
  let exportLabel = '';
  let exportSlot = 1;
  const MODULES = ['GENERAL', 'FRONTPANEL', 'DEVICE_CFG', 'INPUT', 'PRESET', 'QUICK_PRESET', 'SCREEN', 'PRESET_BANK', 'OUTPUT', 'CUSTOM_FORMAT', 'INPUT_EDID', 'EDID_BANK', 'AUDIO', 'WEBAPP_SETTINGS', 'LOG', 'STREAMING', 'HDR_INFO_BANK', 'MTVW', 'MTVW_BANK'];
  const PROFILES = ['1920_1080_30HZ', '1920_1080_25HZ', '1280_720_60HZ', '1280_720_50HZ', '1280_720_30HZ', '1280_720_25HZ', '640_480_30HZ', '480_272_30HZ'];
  function fetch() {
    if (read) return;
    read = true;
    for (const s of [1, 2]) { store.pget(MNG.cfgSlotLabel(s)); for (const p of ['status', 'timestamp', 'versionUpdater', 'module']) store.pget(MNG.cfgSlotStatus(s, p)); }
    for (const p of ['status', 'progress']) { store.pget(MNG.cfgExportStatus(p)); store.pget(MNG.cfgExtractStatus(p)); store.pget(MNG.cfgApplyStatus(p)); }
    store.pget(MNG.cfgExtractStatus('module'));
    store.pget(MNG.cfgApply('stillOption'));
    for (let n = 1; n <= 10; n++) for (const p of ['label', 'url', 'key']) store.pget(MNG.streamSlot(n, p));
    store.pget(MNG.streamRememberKeys());
    for (const p of ['start', 'mode']) store.pget(MNG.streamControl(p));
    store.pget(MNG.streamTarget());
    for (const p of ['source', 'profile', 'quality', 'customBitrate']) store.pget(MNG.streamVideo(p));
    for (const p of ['mode', 'directRoutingSource', 'quality', 'customBitrate']) store.pget(MNG.streamAudio(p));
    for (const p of ['mute', 'directRoutingPair', 'followContentPair']) store.pget(MNG.streamAudioLive(p));
    for (const p of ['status', 'mode', 'urlAndKey']) store.pget(MNG.streamStatus(p));
    for (const p of ['source', 'sourceValidity', 'profile', 'bitrate', 'hdcpWarning']) store.pget(MNG.streamVideoStatus(p));
    for (const p of ['source', 'sourcePair', 'bitrate']) store.pget(MNG.streamAudioStatus(p));
  }
  function reset() { read = false; armed = null; }
  const arm = (key, ms = 5000) => { armed = key; store.notify(); setTimeout(() => { if (armed === key) { armed = null; store.notify(); } }, ms); };
  const slotReads = (s) => [MNG.cfgSlotLabel(s), ...['status', 'timestamp', 'versionUpdater', 'module'].map(p => MNG.cfgSlotStatus(s, p))];

  function slots() {
    fetch();
    const exp = store.pval(MNG.cfgExportStatus('status')), ext = store.pval(MNG.cfgExtractStatus('status')), app = store.pval(MNG.cfgApplyStatus('status'));
    return el('div', {},
      el('h2', 'Configuration slots'),
      el('table', { class: 'grid' },
        el('thead', {}, el('tr', {}, ...['Slot', 'Label', 'Saved', 'Firmware', ''].map(h => el('th', { text: h })))),
        el('tbody', {}, ...[1, 2].map(s => {
          const st = store.pval(MNG.cfgSlotStatus(s, 'status'));
          const empty = st === 'EMPTY' || st == null;
          return el('tr', { class: empty ? 'dim' : '' },
            el('td', { text: `Slot ${s}` }),
            el('td', {}, empty ? el('span', { class: 'hint', text: 'empty' }) : awjText(null, MNG.cfgSlotLabel(s), 32)),
            el('td', { class: 'val', text: empty ? '' : `${store.pval(MNG.cfgSlotStatus(s, 'timestamp')) || '·'}` }),
            el('td', { class: 'val', text: empty ? '' : `${store.pval(MNG.cfgSlotStatus(s, 'versionUpdater')) || '·'}` }),
            el('td', { class: 'acts' }, empty ? null : [
              el('button', { class: 'btn ' + (armed === `restore-${s}` ? 'pgm' : 'ghost'), onclick: () => {
                if (armed !== `restore-${s}`) { arm(`restore-${s}`); return; }
                armed = null;
                // Restore is two steps on the device: unpack the slot, then
                // apply the modules it holds. The second waits for the first.
                store.pset(MNG.cfgExtract('source'), 'BANK'); store.pset(MNG.cfgExtract('slot'), `SLOT_${s}`);
                setTimeout(() => store.pset(MNG.cfgExtract('xRequest'), true), 100);
                const tryApply = (n) => { store.pget(MNG.cfgExtractStatus('status')); store.pget(MNG.cfgExtractStatus('module'));
                  setTimeout(() => {
                    const stx = store.pval(MNG.cfgExtractStatus('status'));
                    if (stx === 'DONE' || stx === 'DONE_VERSION_WARNING') { store.pset(MNG.cfgApply('xRequest'), store.pval(MNG.cfgExtractStatus('module')) || MODULES); setTimeout(() => { store.pget(MNG.cfgApplyStatus('status')); store.pget(MNG.cfgApplyStatus('progress')); }, 1500); }
                    else if (n < 20 && (stx === 'IN_PROGRESS' || stx === 'NO_REQUEST')) tryApply(n + 1);
                    store.notify();
                  }, 300); };
                setTimeout(() => tryApply(0), 800);
              } }, armed === `restore-${s}` ? 'Tap again to restore — the device reboots' : 'Restore'),
              el('button', { class: 'btn ' + (armed === `delete-${s}` ? 'pgm' : 'ghost'), onclick: () => {
                if (armed !== `delete-${s}`) { arm(`delete-${s}`); return; }
                armed = null; store.pset(MNG.cfgSlotDelete(s), true); setTimeout(() => { for (const p of slotReads(s)) store.pget(p); }, 600);
              } }, armed === `delete-${s}` ? 'Tap again to erase' : 'Erase')]));
        }))),
      el('div', { class: 'row wrap' },
        el('label', { class: 'field' }, 'Back up the whole configuration as ', el('input', { type: 'text', maxlength: 32, value: exportLabel, oninput: (e) => { exportLabel = e.target.value; } })),
        el('label', { class: 'field' }, 'into slot ', el('select', { onchange: (e) => { exportSlot = +e.target.value; } }, ...[1, 2].map(s => el('option', { value: s, selected: s === exportSlot, text: `slot ${s}` })))),
        el('button', { class: 'btn primary', onclick: () => {
          store.pset(MNG.cfgExport('destination'), 'BANK'); store.pset(MNG.cfgExport('slot'), `SLOT_${exportSlot}`); store.pset(MNG.cfgExport('label'), exportLabel);
          setTimeout(() => store.pset(MNG.cfgExport('xRequest'), MODULES), 100);
          const s = exportSlot, label = exportLabel;
          // The export's own label did not reach the slot on the simulator;
          // the slot's label is written once the backup has landed.
          for (const ms of [800, 2500, 6000]) setTimeout(() => { store.pget(MNG.cfgExportStatus('status')); store.pget(MNG.cfgExportStatus('progress')); for (const p of slotReads(s)) store.pget(p); }, ms);
          setTimeout(() => { if (label && store.pval(MNG.cfgSlotStatus(s, 'status')) !== 'EMPTY') store.pset(MNG.cfgSlotLabel(s), label); }, 3000);
        } }, 'Back up'),
        awjStatusChip(exp), ext && ext !== 'NO_REQUEST' ? awjStatusChip(ext) : null, app && app !== 'NO_REQUEST' ? awjStatusChip(app) : null),
      el('div', { class: 'hint pad', text: 'Two slots on the device itself hold a full backup each — every module the device lists, stills included. Export to a file and import from USB stay with the Web RCS, which has the file dialogs for them.' }));
  }
  function streaming() {
    fetch();
    const st = store.pval(MNG.streamStatus('status'));
    const running = st === 'RUNNING' || st === 'IN_PROGRESS';
    const target = store.pval(MNG.streamTarget());
    const sources = store.pval(MNG.streamVideoStatus('sourceValidity')) || [];
    const srcName = (v) => v === 'NONE' ? '— none —' : /^INPUT_/.test(v) ? mngInputs.name(v) : v === 'OUTPUT_MTVW' ? 'Multiviewer' : v.replace('OUTPUT_', 'OUT ');
    const statusReads = ['status', 'mode', 'urlAndKey'].map(p => MNG.streamStatus(p)).concat(['source', 'profile', 'bitrate', 'hdcpWarning'].map(p => MNG.streamVideoStatus(p)), ['source', 'sourcePair', 'bitrate'].map(p => MNG.streamAudioStatus(p)), [MNG.streamControl('start')]);
    return el('div', {},
      el('h2', {}, 'Streaming ', awjStatusChip(st)),
      el('div', { class: 'row wrap' },
        awjSelect('Destination', MNG.streamTarget(), Array.from({ length: 10 }, (_, i) => i + 1).map(n => ({ v: n, text: `${n} · ${store.pval(MNG.streamSlot(n, 'label')) || store.pval(MNG.streamSlot(n, 'url')) || 'empty'}` })), { write: (path, v) => awjWrite(path, +v) }),
        awjSelect('Video', MNG.streamVideo('source'), sources.map(v => ({ v, text: srcName(v) }))),
        awjSelect('Profile', MNG.streamVideo('profile'), PROFILES.map(v => ({ v, text: v.replace(/_(\d+)HZ$/, ' @ $1').replace('_', '×') }))),
        awjSelect('Quality', MNG.streamVideo('quality'), ['LOW', 'MEDIUM', 'HIGH', 'CUSTOM']),
        store.pval(MNG.streamVideo('quality')) === 'CUSTOM' ? awjNumber('kbit/s', MNG.streamVideo('customBitrate'), 100, 20000, { cls: 'num' }) : null),
      el('div', { class: 'row wrap' },
        awjSelect('Audio', MNG.streamAudio('mode'), [{ v: 'FOLLOW_CONTENT', text: 'follows the picture' }, { v: 'DIRECT_ROUTING', text: 'direct' }]),
        store.pval(MNG.streamAudio('mode')) === 'DIRECT_ROUTING'
          ? awjSelect('Source', MNG.streamAudio('directRoutingSource'), mngAudioSourceOptions(store.pval(MNG.streamAudio('directRoutingSource'))))
          : null,
        awjSelect('Pair', store.pval(MNG.streamAudio('mode')) === 'DIRECT_ROUTING' ? MNG.streamAudioLive('directRoutingPair') : MNG.streamAudioLive('followContentPair'), MNG_AUDIO_PAIRS.map(p => ({ v: p, text: 'channels ' + p.replace('CHANNEL_', '').replace('_', '–') }))),
        awjSelect('Audio quality', MNG.streamAudio('quality'), ['LOW', 'MEDIUM', 'HIGH', 'CUSTOM']),
        awjToggle(MNG.streamAudioLive('mute'), (on) => on ? 'Muted' : 'Mute', { small: true, cls: 'bad' })),
      el('div', { class: 'row wrap' },
        el('button', { class: 'btn ' + (running ? 'pgm' : 'primary'), onclick: () => { store.pset(MNG.streamControl('start'), !running); for (const ms of [500, 2500]) setTimeout(() => { for (const p of statusReads) store.pget(p); }, ms); } }, running ? 'Stop streaming' : 'Start streaming'),
        el('span', { class: 'hint', text: running ? `${awjWords(store.pval(MNG.streamVideoStatus('source')))} at ${store.pval(MNG.streamVideoStatus('bitrate')) ?? '·'} kbit/s${store.pval(MNG.streamVideoStatus('hdcpWarning')) === true ? ' — HDCP content, the stream carries black' : ''}` : 'RTMP out to the chosen destination.' })),
      el('details', { class: 'group' }, el('summary', { text: 'Destinations' }),
        el('table', { class: 'grid' },
          el('thead', {}, el('tr', {}, ...['', 'Label', 'URL', 'Stream key'].map(h => el('th', { text: h })))),
          el('tbody', {}, ...Array.from({ length: 10 }, (_, i) => i + 1).map(n => el('tr', { class: n === target ? 'sel' : '' },
            el('td', { text: String(n) }),
            el('td', {}, awjText(null, MNG.streamSlot(n, 'label'), 32)),
            el('td', {}, awjText(null, MNG.streamSlot(n, 'url'), 256, { cls: 'wide' })),
            el('td', {}, el('input', { type: 'password', class: 'wide', maxlength: 256, value: store.pval(MNG.streamSlot(n, 'key')) ?? '', placeholder: 'stream key', onchange: (e) => awjWrite(MNG.streamSlot(n, 'key'), e.target.value) })))))),
        el('div', { class: 'row' },
          awjToggle(MNG.streamRememberKeys(), (on) => on ? 'Keys kept on the device' : 'Keys forgotten at power-off', { small: true, cls: 'primary' }),
          el('span', { class: 'hint', text: 'Ten destinations; the first four come from the factory.' }))));
  }
  return { reset, slots, streaming };
})();

// ---------- Midra 4K / Alta 4K: what a bank save records (Presets) ----------
// The device stores a memory through a filter set before the save: which
// categories of each layer, which live layers, and whether the background and
// top layers go in. The filter belongs to the destination (or the master
// bank), so it stays until changed.
const MNG_PRESET_CATEGORIES = ['SOURCE', 'POS', 'SIZE', 'OPACITY', 'CROPPING', 'MASK', 'BORDER', 'TRANSITIONS', 'EFFECTS', 'FLYING_CURVE', 'TIMING', 'SPEED', 'AUDIO'];
const MNG_AUX_PRESET_CATEGORIES = ['SOURCE', 'ASPECT', 'TRANSITIONS', 'AUDIO'];
const mngSaveFilters = (() => {
  const read = new Set();
  function fetch(bank, d) {
    const k = bank.kind + (d ? d.id : '');
    if (read.has(k)) return;
    read.add(k);
    if (bank.kind === 'master') { for (const p of ['screenFilter', 'screenCategoryFilter', 'screenLayerTopFilter', 'screenLayerBackFilter', 'screenLayerLiveFilter', 'auxFilter', 'auxCategoryFilter']) store.pget(MNG.masterSaveFilter(p)); return; }
    if (!d) return;
    store.pget(MNG.saveFilter(bank.root, d, 'categoryFilter'));
    if (d.kind === 'screen') for (const p of ['layerFilter', 'layerTopFilter', 'layerBackFilter']) store.pget(MNG.saveFilter(bank.root, d, p));
  }
  function reset() { read.clear(); }
  const layers = ['1', '2', '3', '4', '5', '6', '7', '8'];
  const catText = (c) => ({ POS: 'position', CROPPING: 'crop', FLYING_CURVE: 'flying curve' }[c] || awjWords(c));
  function panel(bank, d) {
    fetch(bank, d);
    if (bank.kind === 'master') {
      return el('details', { class: 'group' }, el('summary', { text: 'What a master save records' }),
        el('div', { class: 'field' }, el('span', { text: 'Screens' }), awjFlagRow(MNG.masterSaveFilter('screenFilter'), ['1', '2', '3', '4'], { text: (s) => 'S' + s })),
        el('div', { class: 'field' }, el('span', { text: 'Auxiliaries' }), awjFlagRow(MNG.masterSaveFilter('auxFilter'), ['1', '2', '3', '4'], { text: (s) => 'A' + s })),
        el('div', { class: 'field' }, el('span', { text: 'Of each screen' }), awjFlagRow(MNG.masterSaveFilter('screenCategoryFilter'), MNG_PRESET_CATEGORIES, { text: catText })),
        el('div', { class: 'field' }, el('span', { text: 'Live layers' }), el('div', { class: 'row wrap' }, awjFlagRow(MNG.masterSaveFilter('screenLayerLiveFilter'), layers, { text: (l) => 'L' + l }),
          awjToggle(MNG.masterSaveFilter('screenLayerBackFilter'), 'background', { small: true }), awjToggle(MNG.masterSaveFilter('screenLayerTopFilter'), 'top', { small: true }))),
        el('div', { class: 'field' }, el('span', { text: 'Of each auxiliary' }), awjFlagRow(MNG.masterSaveFilter('auxCategoryFilter'), MNG_AUX_PRESET_CATEGORIES, { text: catText })),
        el('div', { class: 'hint', text: 'A master memory records the destinations ticked here, and of each only the ticked parts; the rest is left as it is on recall.' }));
    }
    if (!d) return el('div', { class: 'hint pad', text: 'Pick one destination to see what its saves record.' });
    return el('details', { class: 'group' }, el('summary', { text: `What a save of ${d.id} records` }),
      el('div', { class: 'field' }, el('span', { text: 'Categories' }), awjFlagRow(MNG.saveFilter(bank.root, d, 'categoryFilter'), d.kind === 'aux' ? MNG_AUX_PRESET_CATEGORIES : MNG_PRESET_CATEGORIES, { text: catText })),
      d.kind === 'screen' ? el('div', { class: 'field' }, el('span', { text: 'Layers' }), el('div', { class: 'row wrap' }, awjFlagRow(MNG.saveFilter(bank.root, d, 'layerFilter'), layers, { text: (l) => 'L' + l }),
        awjToggle(MNG.saveFilter(bank.root, d, 'layerBackFilter'), 'background', { small: true }), awjToggle(MNG.saveFilter(bank.root, d, 'layerTopFilter'), 'top', { small: true }))) : null,
      el('div', { class: 'hint', text: 'The filter is the device’s own and stays set for this destination; a memory saved through it recalls only what it recorded, and the slot reports the filter it was saved with.' }));
  }
  return { reset, panel };
})();

// ---------- Midra 4K / Alta 4K: the screen canvas, shared by Layers and Show ----------
// One screen's buffer drawn at the applied canvas size with the unit's own
// pictures on the layers: drag to move (snapping), corners to resize, the
// background set or colour as the ground, the top frame over everything. A
// context `c` is `{ n, buf }` — the screen number and the buffer (UP / DOWN)
// drawn — so the same code serves one screen at a time on the Layers page and
// every screen at once on the Show page. Selection and re-rendering belong
// to the view; the canvas reports through `onSelect`.
const mngCanvas = (() => {
  const seen = new Set();   // "n:buf" whose layers were read
  const P = (c, l, tail) => MNG.layerProp(c.n, c.buf, l, tail);
  const gv = (c, l, key) => store.pval(P(c, l, MNG_GEOM[key]));
  const BG = (c, tail) => MNG.bgProp(c.n, c.buf, tail);
  const TOP = (c, tail) => MNG.topProp(c.n, c.buf, tail);

  /** The live layer slots the applied configuration gives screen `n`. */
  function fitted(n) {
    const out = [];
    for (let l = 1; l <= 8; l++) {
      const m = store.pval(MNG.layerMode(n, l));
      if (m !== undefined && m !== 'DISABLE') out.push(l);
    }
    return out;
  }
  /** The canvas size the applied configuration built, or 1920×1080 until it answers. */
  function size(n) {
    const w = store.pval(MNG.canvasW(n)), h = store.pval(MNG.canvasH(n));
    return { w: w > 0 ? w : 1920, h: h > 0 ? h : 1080, reported: w > 0 && h > 0 };
  }
  /** Read a buffer's layers, background and top frame once per buffer seen. */
  function fetch(n, buf) {
    const k = `${n}:${buf}`;
    if (seen.has(k)) return;
    seen.add(k);
    for (const l of fitted(n)) {
      for (const tail of Object.values(MNG_GEOM)) store.pget(MNG.layerProp(n, buf, l, tail));
      store.pget(MNG.layerFreeze(n, l));
      store.pget(MNG.layerFader(n, l));
    }
    for (const tail of ['source/@props/set', 'opacity/@props/opacity', 'color/@props/red', 'color/@props/green', 'color/@props/blue', 'status/@props/state']) store.pget(MNG.bgProp(n, buf, tail));
    for (const tail of ['source/@props/frame', 'opacity/@props/opacity', 'position/@props/posH', 'position/@props/posV', 'status/@props/state']) store.pget(MNG.topProp(n, buf, tail));
    for (let s = 1; s <= 8; s++) store.pget(MNG.bgSetContent(n, s));
    for (let f = 1; f <= 4; f++) for (const tail of ['status/@props/isValid', 'control/@props/label', 'control/@props/librarySlot', 'control/@props/sizeH', 'control/@props/sizeV']) store.pget(MNG.frame(n, 'top', f, tail));
  }
  /** Every property the panel holds for one layer. */
  function fetchProps(c, l) {
    for (const g of MNG_LAYER_PROPS) for (const it of g.items) store.pget(P(c, l, it.tail));
  }
  function forget() { seen.clear(); }

  // ---- geometry: the device keeps a layer's CENTRE; the canvas works in edges.
  function rect(c, l) {
    const w = gv(c, l, 'sizeH') ?? 0, h = gv(c, l, 'sizeV') ?? 0;
    const cx = gv(c, l, 'posH') ?? 0, cy = gv(c, l, 'posV') ?? 0;
    return { left: cx - w / 2, top: cy - h / 2, w, h };
  }
  function setGeom(c, l, r) {
    pthrottledSet(P(c, l, MNG_GEOM.sizeH), Math.max(0, Math.round(r.w)));
    pthrottledSet(P(c, l, MNG_GEOM.sizeV), Math.max(0, Math.round(r.h)));
    pthrottledSet(P(c, l, MNG_GEOM.posH), Math.round(r.left + r.w / 2));
    pthrottledSet(P(c, l, MNG_GEOM.posV), Math.round(r.top + r.h / 2));
  }
  // Reads after a write, since the device answers a replace with nothing and
  // pushes only while Live updates is on.
  function readBack(c, l) {
    if (awjLive) return;
    setTimeout(() => { for (const tail of Object.values(MNG_GEOM)) store.pget(P(c, l, tail)); }, 120);
  }

  // Snap a dragged edge or centre to the canvas edges and centre lines and to
  // the other layers' edges and centres, within eight screen pixels. Alt held
  // while dragging switches it off. A resize snaps only the edges that move.
  function snap(c, r, l, scale, corner = null) {
    const cs = size(c.n), tol = 8 / scale;
    const xs = [0, cs.w / 2, cs.w], ys = [0, cs.h / 2, cs.h];
    for (const o of fitted(c.n)) { if (o === l) continue; const q = rect(c, o); xs.push(q.left, q.left + q.w, q.left + q.w / 2); ys.push(q.top, q.top + q.h, q.top + q.h / 2); }
    const near = (v, arr) => { let best = null; for (const a of arr) { const dd = Math.abs(v - a); if (dd <= tol && (best === null || dd < Math.abs(v - best))) best = a; } return best; };
    if (!corner) {
      for (const [v, off] of [[r.left, 0], [r.left + r.w, r.w], [r.left + r.w / 2, r.w / 2]]) { const s = near(v, xs); if (s !== null) { r.left = s - off; break; } }
      for (const [v, off] of [[r.top, 0], [r.top + r.h, r.h], [r.top + r.h / 2, r.h / 2]]) { const s = near(v, ys); if (s !== null) { r.top = s - off; break; } }
      return r;
    }
    if (corner.includes('w')) { const s = near(r.left, xs); if (s !== null) { r.w += r.left - s; r.left = s; } } else { const s = near(r.left + r.w, xs); if (s !== null) r.w = s - r.left; }
    if (corner.includes('n')) { const s = near(r.top, ys); if (s !== null) { r.h += r.top - s; r.top = s; } } else { const s = near(r.top + r.h, ys); if (s !== null) r.h = s - r.top; }
    return r;
  }
  // Arrow keys move a layer a pixel, ten with Shift, once the canvas has focus.
  function nudge(e, c, l) {
    if (typeof l !== 'number') return;
    const step = e.shiftKey ? 10 : 1;
    const dx = e.key === 'ArrowLeft' ? -step : e.key === 'ArrowRight' ? step : 0, dy = e.key === 'ArrowUp' ? -step : e.key === 'ArrowDown' ? step : 0;
    if (!dx && !dy) return;
    e.preventDefault();
    const r = rect(c, l);
    setGeom(c, l, { ...r, left: r.left + dx, top: r.top + dy });
    readBack(c, l);
  }

  function dragMove(e, c, l, scale) {
    e.preventDefault(); e.stopPropagation();
    beginDrag();
    const box = e.currentTarget;
    const sx = e.clientX, sy = e.clientY, r0 = rect(c, l);
    const move = (ev) => {
      const dx = (ev.clientX - sx) / scale, dy = (ev.clientY - sy) / scale;
      let r = { ...r0, left: r0.left + dx, top: r0.top + dy };
      if (!ev.altKey) r = snap(c, r, l, scale);
      box.style.left = r.left * scale + 'px'; box.style.top = r.top * scale + 'px';
      setGeom(c, l, r);
    };
    const up = () => { document.removeEventListener('pointermove', move); document.removeEventListener('pointerup', up); endDrag(); readBack(c, l); };
    document.addEventListener('pointermove', move); document.addEventListener('pointerup', up);
  }
  function dragResize(e, c, l, scale, corner, box) {
    e.preventDefault(); e.stopPropagation();
    beginDrag();
    const sx = e.clientX, sy = e.clientY, r0 = rect(c, l);
    const west = corner.includes('w'), north = corner.includes('n');
    const move = (ev) => {
      const dx = (ev.clientX - sx) / scale, dy = (ev.clientY - sy) / scale;
      let left = r0.left, right = r0.left + r0.w, top = r0.top, bot = r0.top + r0.h;
      if (west) left = Math.min(right - 16, r0.left + dx); else right = Math.max(left + 16, right + dx);
      if (north) top = Math.min(bot - 16, r0.top + dy); else bot = Math.max(top + 16, bot + dy);
      let r = { left, top, w: right - left, h: bot - top };
      if (!ev.altKey) r = snap(c, r, l, scale, corner);
      box.style.left = r.left * scale + 'px'; box.style.top = r.top * scale + 'px';
      box.style.width = r.w * scale + 'px'; box.style.height = r.h * scale + 'px';
      setGeom(c, l, r);
    };
    const up = () => { document.removeEventListener('pointermove', move); document.removeEventListener('pointerup', up); endDrag(); readBack(c, l); };
    document.addEventListener('pointermove', move); document.addEventListener('pointerup', up);
  }
  function dragTop(e, c, scale) {
    e.preventDefault(); e.stopPropagation();
    beginDrag();
    const box = e.currentTarget;
    const sx = e.clientX, sy = e.clientY, r0 = topRect(c);
    if (!r0) { endDrag(); return; }
    const move = (ev) => {
      const dx = (ev.clientX - sx) / scale, dy = (ev.clientY - sy) / scale;
      box.style.left = (r0.left + dx) * scale + 'px'; box.style.top = (r0.top + dy) * scale + 'px';
      pthrottledSet(TOP(c, 'position/@props/posH'), Math.round(r0.left + dx + r0.w / 2));
      pthrottledSet(TOP(c, 'position/@props/posV'), Math.round(r0.top + dy + r0.h / 2));
    };
    const up = () => { document.removeEventListener('pointermove', move); document.removeEventListener('pointerup', up); endDrag(); if (!awjLive) setTimeout(() => { store.pget(TOP(c, 'position/@props/posH')); store.pget(TOP(c, 'position/@props/posV')); }, 120); };
    document.addEventListener('pointermove', move); document.addEventListener('pointerup', up);
  }

  // Layout presets over the fitted layers, in slot order. Only the geometry
  // moves; sources stay where they are. Cells are fractions of the canvas.
  const T = 1 / 3;
  const LAYOUTS = {
    fill: { label: 'Fill', cells: [[0, 0, 1, 1]] },
    two: { label: '2-up', cells: [[0, 0.25, 0.5, 0.5], [0.5, 0.25, 0.5, 0.5]] },
    three: { label: '3-up', cells: [[0, T, T, T], [T, T, T, T], [2 * T, T, T, T]] },
    quad: { label: 'Quad', cells: [[0, 0, 0.5, 0.5], [0.5, 0, 0.5, 0.5], [0, 0.5, 0.5, 0.5], [0.5, 0.5, 0.5, 0.5]] },
    pip: { label: 'PiP', cells: [[0, 0, 1, 1], [0.66, 0.66, 0.3, 0.3]] },
    pip2: { label: 'PiP ×2', cells: [[0, 0, 1, 1], [0.7, 0.04, 0.27, 0.27], [0.7, 0.69, 0.27, 0.27]] },
    onetwo: { label: '1 + 2', cells: [[0, 0, 2 * T, 1], [2 * T, 0, T, 0.5], [2 * T, 0.5, T, 0.5]] },
    onethree: { label: '1 + 3', cells: [[0, 0, 0.75, 1], [0.75, 0, 0.25, T], [0.75, T, 0.25, T], [0.75, 2 * T, 0.25, T]] },
    six: { label: '3×2', cells: [[0, 0, T, 0.5], [T, 0, T, 0.5], [2 * T, 0, T, 0.5], [0, 0.5, T, 0.5], [T, 0.5, T, 0.5], [2 * T, 0.5, T, 0.5]] },
    eight: { label: '4×2', cells: [[0, 0, 0.25, 0.5], [0.25, 0, 0.25, 0.5], [0.5, 0, 0.25, 0.5], [0.75, 0, 0.25, 0.5], [0, 0.5, 0.25, 0.5], [0.25, 0.5, 0.25, 0.5], [0.5, 0.5, 0.25, 0.5], [0.75, 0.5, 0.25, 0.5]] },
    columns: { label: 'Columns', cells: null },   // one column per fitted layer
    rows: { label: 'Rows', cells: null },         // one row per fitted layer
  };
  function layout(c, name) {
    const cs = size(c.n), ls = fitted(c.n);
    let cells = LAYOUTS[name]?.cells;
    if (name === 'columns') cells = ls.map((_, i) => [i / ls.length, 0, 1 / ls.length, 1]);
    if (name === 'rows') cells = ls.map((_, i) => [0, i / ls.length, 1, 1 / ls.length]);
    if (!cells) return;
    cells.forEach(([x, y, w, h], i) => {
      const l = ls[i]; if (!l) return;
      setGeom(c, l, { left: x * cs.w, top: y * cs.h, w: w * cs.w, h: h * cs.h });
      readBack(c, l);
    });
  }

  // The background layer: a set (whose content the screen names) or, with no
  // set, the colour. Drawn as the canvas ground.
  function bgStyle(c) {
    const set = store.pval(BG(c, 'source/@props/set'));
    const rgb = ['red', 'green', 'blue'].map(k => store.pval(BG(c, `color/@props/${k}`)) ?? 0);
    if (!set || set === 'NONE') return `background: rgb(${rgb.join(',')})`;
    return 'background: repeating-linear-gradient(45deg, #1b2230 0 12px, #141a24 12px 24px)';
  }
  function bgLabel(c) {
    const set = store.pval(BG(c, 'source/@props/set'));
    if (!set || set === 'NONE') return 'colour';
    const content = store.pval(MNG.bgSetContent(c.n, +set));
    return `set ${set}${content && content !== 'NONE' ? ' · ' + String(content).toLowerCase().replace(/_/g, ' ') : ''}`;
  }
  function topRect(c) {
    const f = store.pval(TOP(c, 'source/@props/frame'));
    if (!f || f === 'NONE') return null;
    const w = store.pval(MNG.frame(c.n, 'top', +f, 'control/@props/sizeH')) ?? 0;
    const h = store.pval(MNG.frame(c.n, 'top', +f, 'control/@props/sizeV')) ?? 0;
    const cx = store.pval(TOP(c, 'position/@props/posH')) ?? 0, cy = store.pval(TOP(c, 'position/@props/posV')) ?? 0;
    return { left: cx - w / 2, top: cy - h / 2, w, h, frame: f };
  }

  /**
   * The canvas element. `sel` is the view's selection (a layer number, 'bg'
   * or 'top'); `onSelect(s)` is called before a drag starts and when the
   * ground is clicked, and decides whether to re-render. `width` is the
   * element's width in CSS pixels; `tags` false hides the layer labels.
   */
  function element({ c, sel, width, onSelect, tags = true }) {
    const cs = size(c.n);
    const CW = width, scale = CW / cs.w, CH = cs.h * scale;
    const cv = el('div', { class: 'screen-canvas' + (sel === 'bg' ? ' bg-sel' : '') + (tags ? '' : ' small'), style: `width:${CW}px;height:${Math.round(CH)}px;${bgStyle(c)}`, tabindex: 0,
      onpointerdown: (e) => { e.currentTarget.focus(); onSelect('bg', true); }, onkeydown: (e) => nudge(e, c, sel) });
    if (tags) cv.append(el('span', { class: 'lrect-tag bg-tag', text: `background · ${bgLabel(c)}` }));
    for (const l of fitted(c.n)) {
      const src = gv(c, l, 'source');
      const on = src && src !== 'NONE';
      const st = gv(c, l, 'state');
      const r = rect(c, l);
      const shot = on ? mngSnapshotUrl('inputs', +String(src).replace('INPUT_', '')) : null;
      const box = el('div', {
        class: 'lrect' + (l === sel ? ' sel' : '') + (on ? '' : ' off') + (shot ? ' shot' : ''),
        style: `left:${r.left * scale}px;top:${r.top * scale}px;width:${r.w * scale}px;height:${r.h * scale}px;z-index:${l};` +
          (shot ? `background-image:url(${shot})` : on ? `background:color-mix(in srgb, ${mngSourceColor(src)} 55%, transparent)` : ''),
        onpointerdown: (e) => { e.currentTarget.parentNode.focus(); onSelect(l, false); dragMove(e, c, l, scale); },
      },
        el('span', { class: 'lrect-tag', text: tags ? `L${l}${on ? ' · ' + mngInputs.name(src) : ''}${st && st !== 'OFF' && st !== 'OPEN' ? ' · ' + st.toLowerCase() : ''}` : `L${l}` }));
      cv.append(box);
      if (l === sel) selectionChrome(cv, box, (e, k, b) => { onSelect(l, false); dragResize(e, c, l, scale, k, b); });
    }
    const tr = topRect(c);
    if (tr) {
      const shot = mngSnapshotUrl(`screens/${c.n}/top`, +tr.frame);
      const box = el('div', {
        class: 'lrect top' + (sel === 'top' ? ' sel' : '') + (shot ? ' shot' : ''),
        style: `left:${tr.left * scale}px;top:${tr.top * scale}px;width:${tr.w * scale}px;height:${tr.h * scale}px;z-index:99;` + (shot ? `background-image:url(${shot})` : ''),
        onpointerdown: (e) => { onSelect('top', false); dragTop(e, c, scale); },
      }, el('span', { class: 'lrect-tag', text: tags ? `top · frame ${tr.frame}` : 'top' }));
      cv.append(box);
      // the top frame has a position but no size, so an outline and no handles
      if (sel === 'top') selectionChrome(cv, box, null);
    }
    return el('div', { class: 'canvas-wrap' }, cv);
  }

  return { P, gv, BG, TOP, fitted, size, fetch, fetchProps, forget, rect, setGeom, readBack, snap, layout, LAYOUTS, bgStyle, bgLabel, topRect, element };
})();

// ---------- AWJ: Show (Midra 4K / Alta 4K) ----------
// Every screen and auxiliary in service side by side — each screen's program
// or preview on its own canvas, editable in place (drag, resize, snap, a
// quick source and opacity for the picked layer), each auxiliary's source —
// with take and cut per destination and for all of them. Show mode makes
// the canvases and the take buttons big enough for a front-of-house table.
let mngShowHandoff = null;   // {dest, sel, which} for the Layers page, set by Show's "Open in Layers"
VIEWS.lpshow = (() => {
  let which = 'preview';   // 'program' | 'preview'
  let big = false;         // Show mode: one column, big targets
  let picked = null;       // { dest, sel } — the layer (or 'bg' / 'top') last touched
  let read = false;
  const D = () => awj();

  function settle() {
    if (read || !store.meta || !store.connected) return;
    const used = D().destinations();
    if (!used.length) return;
    read = true;
    mngCanvas.forget();
    mngInputs.refresh();
    for (const d of used) {
      D().refresh(d); D().refreshExtras?.(d);
      if (d.kind === 'aux') { for (const b of ['UP', 'DOWN']) store.pget(MNG.auxSource(d.n, b)); continue; }
      for (const b of ['UP', 'DOWN']) mngCanvas.fetch(d.n, b);
    }
    awjViewSubs = () => [...D().destinations().map(d => MNG.subDestination(d))];
    awjApplySubs();
    startMngSnapshots();
    setTimeout(mngEnableSnapshots, 600);
  }
  function enter() { if (awjDialect() !== 'mng') return; read = false; picked = null; settle(); }

  const bufferOf = (d) => D().buffers(d)[which];

  function quickPanel(d) {
    if (!picked || picked.dest !== d.id || typeof picked.sel !== 'number') return null;
    const c = { n: d.n, buf: bufferOf(d) }, l = picked.sel;
    const src = mngCanvas.gv(c, l, 'source');
    const opacity = store.pval(mngCanvas.P(c, l, 'opacity/@props/opacity'));
    const srcSel = el('select', { onchange: (e) => { store.pset(mngCanvas.P(c, l, MNG_GEOM.source), e.target.value); mngCanvas.readBack(c, l); } });
    for (const o of mngInputs.sourceOptions(src)) srcSel.append(el('option', { value: o.v, selected: o.v === src, text: o.text }));
    return el('div', { class: 'row wrap quick' },
      el('b', { text: `L${l}` }),
      srcSel,
      el('label', { class: 'field slider' },
        el('span', {}, 'Opacity', el('b', { class: 'sv', text: opacity == null ? '·' : pct256(opacity) })),
        el('input', { type: 'range', min: 0, max: 256, step: 1, value: opacity ?? 256,
          onpointerdown: beginDrag, onpointerup: endDrag, onpointercancel: endDrag,
          oninput: (e) => { pthrottledSet(mngCanvas.P(c, l, 'opacity/@props/opacity'), +e.target.value); e.target.parentNode.querySelector('.sv').textContent = pct256(+e.target.value); } })),
      el('button', { class: 'btn ghost small', onclick: () => { mngShowHandoff = { dest: d.id, sel: l, which }; location.hash = '#lplayers'; } }, 'Open in Layers'));
  }

  function card(d, width) {
    const t = D().transition(d), moving = D().inFlight(d);
    const { program, preview } = D().buffers(d);
    // A take is silent and the transition runs for the take time, so the
    // destination is read back twice: once for the in-flight state, once at rest.
    const after = (ds) => { for (const ms of [300, 1500]) setTimeout(() => { for (const x of ds) D().refresh(x); }, ms); };
    const takeBtns = el('div', { class: 'row' },
      el('button', { class: 'btn pgm' + (big ? ' big' : ''), onclick: () => { D().take(d); after([d]); } }, 'Take'),
      el('button', { class: 'btn ghost' + (big ? ' big' : ''), onclick: () => { D().cut(d); after([d]); } }, 'Cut'),
      moving ? awjChip('on', moving) : null);
    const head = el('div', { class: 'row' },
      el('h2', { text: `${d.id} ${D().label(d) || ''}`.trim() }),
      el('span', { class: 'hint', text: `${which} · ${which === 'program' ? program : preview}${t ? ' · ' + String(t).toLowerCase().replace(/_/g, ' ') : ''}` }),
      el('div', { class: 'grow' }),
      D().showsMemory ? el('span', { class: 'hint', text: ['program', 'preview'].map(w => { const m = D().memoryOn(d, w); return `${w === 'program' ? 'PGM' : 'PRW'} ${m == null ? '—' : 'M' + m}`; }).join(' · ') }) : null);
    if (d.kind === 'aux') {
      const path = MNG.auxSource(d.n, bufferOf(d));
      const src = store.pval(path);
      const s = el('select', { onchange: (e) => { store.pset(path, e.target.value); if (!awjLive) setTimeout(() => store.pget(path), 120); } });
      for (const o of mngInputs.sourceOptions(src)) s.append(el('option', { value: o.v, selected: o.v === src, text: o.text }));
      const shot = src && /^INPUT_/.test(src) ? mngSnapshotUrl('inputs', +String(src).replace('INPUT_', '')) : null;
      return el('div', { class: 'panel show-card' }, head,
        el('div', { class: 'aux-canvas' + (shot ? ' shot' : ''), style: `width:${width}px;height:${Math.round(width * 9 / 16)}px;` + (shot ? `background-image:url(${shot})` : `background:color-mix(in srgb, ${mngSourceColor(src)} 55%, transparent)`) },
          el('span', { class: 'lrect-tag', text: mngInputs.name(src) })),
        el('div', { class: 'row wrap' }, el('label', { class: 'field' }, 'Source', s), el('div', { class: 'grow' }), takeBtns));
    }
    const c = { n: d.n, buf: bufferOf(d) };
    const sel = picked && picked.dest === d.id ? picked.sel : null;
    return el('div', { class: 'panel show-card' }, head,
      mngCanvas.element({ c, sel, width, tags: true,
        onSelect: (s, rerender) => { picked = { dest: d.id, sel: s }; if (typeof s === 'number') mngCanvas.fetchProps(c, s); if (rerender) store.notify(); } }),
      el('div', { class: 'row wrap' },
        el('div', { class: 'seg' }, ...Object.entries(mngCanvas.LAYOUTS).slice(0, 5).map(([k, v]) => el('button', { onclick: () => mngCanvas.layout(c, k) }, v.label))),
        el('div', { class: 'grow' }), takeBtns),
      quickPanel(d));
  }

  function render() {
    settle();
    const used = D().destinations();
    const cols = big ? 1 : Math.max(1, Math.min(3, Math.floor(((window.innerWidth || 1200) - 260) / 520)));
    const width = Math.max(300, Math.min(big ? 1100 : 640, Math.floor(((window.innerWidth || 1200) - 260 - 24 * cols) / cols) - 40));
    return el('div', { class: big ? 'show-big' : '' },
      el('div', { class: 'view-head' }, el('h1', { text: 'Show' }), el('span', { class: 'hint', text: 'Every screen and auxiliary in service, edited side by side and taken together' })),
      el('div', { class: 'panel' },
        el('div', { class: 'row wrap' },
          el('div', { class: 'seg' },
            el('button', { class: which === 'program' ? 'on take' : '', onclick: () => { which = 'program'; picked = null; store.notify(); } }, 'Program'),
            el('button', { class: which === 'preview' ? 'on recall' : '', onclick: () => { which = 'preview'; picked = null; store.notify(); } }, 'Preview')),
          D().takeMany && used.length ? el('button', { class: 'btn pgm' + (big ? ' big' : ''), onclick: () => { D().takeMany(used); for (const ms of [300, 1500]) setTimeout(() => { for (const d of used) D().refresh(d); }, ms); } }, `Take all (${used.length})`) : null,
          used.length ? el('button', { class: 'btn ghost' + (big ? ' big' : ''), onclick: () => { for (const d of used) D().cut(d); for (const ms of [300, 1500]) setTimeout(() => { for (const d of used) D().refresh(d); }, ms); } }, 'Cut all') : null,
          el('div', { class: 'grow' }),
          el('button', { class: 'btn ' + (big ? 'primary' : 'ghost'), onclick: () => { big = !big; store.notify(); } }, big ? 'Show mode on' : 'Show mode'),
          el('button', { class: awjLive ? 'btn primary' : 'btn', onclick: () => setAwjLive(!awjLive) }, awjLive ? 'Live updates on' : 'Live updates off')),
        el('div', { class: 'hint pad', text: `Editing ${which}. Drag a layer to move it, its corners to resize; a click on a layer offers its source and opacity here, Layers has the rest. Show mode is one big column with large take buttons for a front-of-house table.` })),
      used.length
        ? el('div', { class: 'show-grid', style: `grid-template-columns: repeat(${cols}, minmax(0, 1fr));` }, ...used.map(d => card(d, width)))
        : el('div', { class: 'panel' }, el('div', { class: 'hint pad', text: store.connected ? 'No screen or auxiliary on this device is in service.' : 'Waiting for the processor.' })));
  }
  return { enter, render };
})();

// ---------- AWJ: Cues (LivePremier, Midra 4K / Alta 4K) ----------
// A cue list over the preset banks: each cue recalls a memory — a master, or
// a screen's or auxiliary's — to preview and takes it, or cuts it straight to
// program; per-cue autofollow with a wait chains them. Neither Web RCS has a
// sequencer, so this is the surface's own; it lives in this browser, keyed by
// the processor it was written for.
VIEWS.lpcues = (() => {
  const key = () => `openrcs.lpcues.${store.meta?.host || 'device'}`;
  let loadedFor = null;
  let cues = [];      // { id, label, bank, slot, dest, follow, wait, notes }
  let cur = -1;       // index of the last cue fired
  function load() {
    if (loadedFor === key()) return;
    loadedFor = key(); cues = []; cur = -1;
    try { const saved = JSON.parse(localStorage.getItem(key()) || '{}'); cues = saved.cues || []; cur = saved.cur ?? -1; } catch { /* first run */ }
  }
  const persist = () => { try { localStorage.setItem(key(), JSON.stringify({ cues, cur })); } catch { /* quota */ } };
  const D = () => awj();

  // Draft for the add row.
  let dBank = null, dSlot = 1, dDest = null, dLabel = '', dFollow = false, dWait = 3000;

  // Autofollow: after a cue with follow, a timer fires the next. Any manual
  // action cancels it, so a hold is just leaving follow off.
  let followTimer = null, followFrom = -1;
  function clearFollow() { if (followTimer) { clearTimeout(followTimer); followTimer = null; followFrom = -1; } }

  const bankOf = (c) => D().banks.find(b => b.kind === c.bank) || D().banks[0];
  const destsOf = (c) => {
    const b = bankOf(c);
    if (b.targets === 'none') return D().destinations();
    const d = awjDest(c.dest);
    return d && D().destinations().some(x => x.id === d.id) ? [d] : [];
  };
  /** Recall the cue's memory: to preview and take it (`take`), or straight to program. */
  function fire(c, take) {
    const b = bankOf(c), dests = destsOf(c);
    if (!dests.length) return;
    if (b.targets === 'none') D().recall(b, c.slot, null, take ? 'PREVIEW' : 'PROGRAM');
    else for (const d of dests) D().recall(b, c.slot, d, take ? 'PREVIEW' : 'PROGRAM');
    // The recall is silent and lands a few tens of milliseconds later; the
    // take waits for it, and every touched destination is read back after.
    if (take) setTimeout(() => { for (const d of dests) D().take(d); }, 250);
    const re = () => { for (const d of dests) D().refresh(d); };
    setTimeout(re, 400); setTimeout(re, 1500);
  }
  function go(i) {
    if (i < 0 || i >= cues.length) return;
    clearFollow();
    fire(cues[i], true); cur = i; persist();
    const c = cues[i];
    if (c.follow && cur + 1 < cues.length) {
      followFrom = i;
      followTimer = setTimeout(() => { followTimer = null; followFrom = -1; goNext(); }, Math.max(0, c.wait || 0));
    }
    store.notify();
  }
  function goNext() { go(cur + 1 < cues.length ? cur + 1 : cur); }
  function hold() { clearFollow(); store.notify(); }
  function arm(i) { clearFollow(); const c = cues[i]; const b = bankOf(c); for (const d of destsOf(c)) { if (b.targets === 'none') { D().recall(b, c.slot, null, 'PREVIEW'); break; } D().recall(b, c.slot, d, 'PREVIEW'); } setTimeout(() => { for (const d of destsOf(c)) D().refresh(d); }, 400); store.notify(); }
  function addCue() {
    const b = D().banks.find(x => x.kind === dBank) || D().banks[0];
    const label = dLabel.trim() || (b.targets === 'none' ? `Master ${dSlot}` : `${dDest || ''} · ${b.label.toLowerCase()} ${dSlot}`);
    cues.push({ id: Date.now(), label, bank: b.kind, slot: dSlot, dest: b.targets === 'none' ? null : dDest, follow: dFollow, wait: dWait, notes: '' });
    dLabel = ''; persist(); store.notify();
  }
  function move(i, d) { const j = i + d; if (j < 0 || j >= cues.length) return; clearFollow(); [cues[i], cues[j]] = [cues[j], cues[i]]; if (cur === i) cur = j; else if (cur === j) cur = i; persist(); store.notify(); }
  function del(i) { clearFollow(); cues.splice(i, 1); if (cur >= cues.length) cur = cues.length - 1; persist(); store.notify(); }
  const patch = (c, k, v) => { c[k] = v; persist(); store.notify(); };

  function enter() { load(); clearFollow(); }

  function cueRow(c, i) {
    const b = bankOf(c);
    const valid = D().presetValid(b, c.slot);
    const target = `${b.label} ${c.slot}${b.targets === 'none' ? '' : ' on ' + (c.dest || '?')}${valid === false ? ' (empty)' : ''}`;
    return el('div', { class: 'cue' + (i === cur ? ' current' : '') + (followFrom === i ? ' following' : '') },
      el('span', { class: 'cue-n', text: i + 1 }),
      el('div', { class: 'cue-main' },
        el('input', { class: 'cue-label-in', type: 'text', value: c.label, onchange: (e) => patch(c, 'label', e.target.value) }),
        el('div', { class: 'cue-target', text: target + (c.follow ? ` · auto ${(c.wait / 1000).toFixed(1)} s` : '') }),
        el('input', { class: 'cue-notes-in', type: 'text', placeholder: 'notes', value: c.notes || '', onchange: (e) => patch(c, 'notes', e.target.value) })),
      el('label', { class: 'cue-follow', title: 'Autofollow to the next cue after the wait' },
        el('input', { type: 'checkbox', checked: !!c.follow, onchange: (e) => patch(c, 'follow', e.target.checked) }), ' auto ',
        el('input', { class: 'num', type: 'number', min: 0, max: 600, step: 0.5, value: (c.wait / 1000).toFixed(1), onchange: (e) => patch(c, 'wait', Math.round((+e.target.value || 0) * 1000)) }), ' s'),
      el('div', { class: 'cue-acts' },
        el('button', { class: 'btn ghost small', title: 'Load to preview only', onclick: () => arm(i) }, 'Arm'),
        el('button', { class: 'btn pgm small', title: 'Load to preview and take', onclick: () => go(i) }, 'Go'),
        el('button', { class: 'btn ghost small', title: 'Straight to program, no transition', onclick: () => { clearFollow(); fire(c, false); cur = i; persist(); store.notify(); } }, 'Cut'),
        el('button', { class: 'btn ghost small', onclick: () => move(i, -1) }, '▲'),
        el('button', { class: 'btn ghost small', onclick: () => move(i, 1) }, '▼'),
        el('button', { class: 'btn ghost small', onclick: () => del(i) }, '✕')));
  }

  function render() {
    load();
    const banks = D().banks;
    if (!dBank || !banks.some(b => b.kind === dBank)) dBank = banks[0].kind;
    const b = banks.find(x => x.kind === dBank);
    const cands = D().destinations().filter(d => d.kind === b.targets);
    if (b.targets !== 'none' && (!dDest || !cands.some(d => d.id === dDest))) dDest = cands[0]?.id ?? null;
    const next = cur + 1 < cues.length ? cues[cur + 1] : null;
    return el('div', {},
      el('div', { class: 'view-head' }, el('h1', { text: 'Cues' }), el('span', { class: 'hint', text: 'A cue list over the memory banks — recall to preview and take, cue by cue, with autofollow' })),
      el('div', { class: 'panel' },
        el('div', { class: 'row wrap' },
          el('button', { class: 'btn pgm big', disabled: !next, onclick: goNext }, next ? `GO  ${cur + 2} · ${next.label}` : 'GO (end of list)'),
          el('button', { class: 'btn ghost', disabled: !followTimer, onclick: hold }, 'Hold'),
          el('button', { class: 'btn ghost', onclick: () => { clearFollow(); cur = -1; persist(); store.notify(); } }, 'Reset to top'),
          el('span', { class: 'hint', text: cur >= 0 ? `Last fired: ${cur + 1} · ${cues[cur]?.label ?? ''}` : 'Nothing fired yet.' })),
        cues.length ? el('div', { class: 'cue-list' }, ...cues.map(cueRow)) : el('div', { class: 'hint pad', text: 'No cues yet. Add one below: a master memory, or a screen or auxiliary memory on one destination.' })),
      el('div', { class: 'panel' }, el('h2', 'Add a cue'),
        el('div', { class: 'row wrap' },
          el('label', { class: 'field' }, 'Bank', el('select', { onchange: (e) => { dBank = e.target.value; store.notify(); } }, ...banks.map(k => el('option', { value: k.kind, selected: k.kind === dBank, text: k.label })))),
          el('label', { class: 'field' }, 'Slot', el('input', { class: 'num', type: 'number', min: 1, max: b.slots, value: dSlot, onchange: (e) => { dSlot = Math.max(1, Math.min(b.slots, Math.round(+e.target.value || 1))); } })),
          b.targets === 'none' ? null : el('label', { class: 'field' }, 'On', el('select', { onchange: (e) => { dDest = e.target.value; } }, ...cands.map(d => el('option', { value: d.id, selected: d.id === dDest, text: `${d.id} ${D().label(d) || ''}`.trim() })))),
          el('label', { class: 'field' }, 'Label', el('input', { type: 'text', maxlength: 48, value: dLabel, oninput: (e) => { dLabel = e.target.value; } })),
          el('label', { class: 'field' }, 'Autofollow', el('input', { type: 'checkbox', checked: dFollow, onchange: (e) => { dFollow = e.target.checked; } })),
          el('label', { class: 'field' }, 'Wait s', el('input', { class: 'num', type: 'number', min: 0, max: 600, step: 0.5, value: (dWait / 1000).toFixed(1), onchange: (e) => { dWait = Math.round((+e.target.value || 0) * 1000); } })),
          el('button', { class: 'btn primary', onclick: addCue }, 'Add')),
        el('div', { class: 'hint pad', text: 'Go loads the memory to preview and takes it a quarter of a second later, over the destination’s own take time; Cut loads it straight to program. The list is kept in this browser for this processor; the device has no sequencer of its own.' })));
  }
  return { enter, render };
})();

// ---------- AWJ: Plan (any AWJ family) ----------
// Plan mode over paths: with it on, every write the AWJ views make is staged
// in this browser instead of sent, reads show the staged values, and the
// lot is pushed when a processor is there. Triggers (`x…` properties — a
// take, a recall) are never staged: they are actions, not state.
VIEWS.lpplan = (() => {
  let busy = null;
  async function push() {
    if (!store.connected) { store.notify(); return; }
    busy = { frac: 0 }; store.notify();
    await store.pushPlan(f => { busy = { frac: f }; store.notify(); });
    busy = null; store.notify();
  }
  function render() {
    const list = store.planPathList();
    return el('div', {},
      el('div', { class: 'view-head' }, el('h1', { text: 'Plan' }), el('span', { class: 'hint', text: 'Build a look with no processor — every edit is staged, then pushed on connect' })),
      el('div', { class: 'panel' },
        el('div', { class: 'row wrap' },
          el('button', { class: 'btn ' + (store.plan ? 'pgm' : 'ghost'), onclick: () => store.setPlan(!store.plan) }, store.plan ? 'Plan mode ON — edits are staged' : 'Plan mode off — edits go to the processor'),
          el('div', { class: 'grow' }),
          awjChip(store.connected ? 'on' : 'off', store.connected ? 'processor online' : 'no processor')),
        el('div', { class: 'hint pad', text: 'While on, what you set on Screens, Layers, Show, Audio, Inputs, Outputs, Setup and the rest is collected here instead of being written. Reads show your staged values, so the look previews as you build it. Takes, recalls and every other trigger still go straight to the processor — they are actions, not state, and cannot be planned.' })),
      el('div', { class: 'panel' },
        el('div', { class: 'row' },
          el('h2', `Staged changes (${list.length})`),
          el('div', { class: 'grow' }),
          el('button', { class: 'btn pgm', onclick: push, disabled: (!list.length || !store.connected || busy) ? true : undefined }, store.connected ? 'Push to processor' : 'Push (no processor)'),
          list.length ? el('button', { class: 'btn ghost', onclick: () => store.clearPlan() }, 'Discard') : null),
        busy ? el('div', { class: 'show-prog' }, el('div', { class: 'show-prog-bar', style: `width:${Math.round(busy.frac * 100)}%` }), el('span', { class: 'show-prog-label', text: 'Pushing…' })) : null,
        list.length
          ? el('table', { class: 'grid' }, el('thead', {}, el('tr', {}, el('th', { text: 'Path' }), el('th', { text: 'Value' }), el('th'))),
              el('tbody', {}, ...list.slice(0, 400).map(e => el('tr', {},
                el('td', { class: 'path', text: e.path.replace(/^DeviceObject\//, '') }),
                el('td', { class: 'val', text: JSON.stringify(e.v) }),
                el('td', {}, el('button', { class: 'btn ghost small', onclick: () => store.unplanPath(e.path) }, '✕'))))))
          : el('div', { class: 'hint pad', text: store.plan ? 'No staged changes yet. Go build a look — every edit lands here.' : 'Turn plan mode on to start staging changes.' })));
  }
  return { render };
})();

// ---------- AWJ: Layers (Midra 4K / Alta 4K) ----------
// One screen at a time, program or preview, its fitted live layers on a canvas
// drawn to the applied configuration's size. Drag to move, corners to resize;
// the panel on the right edits everything else the device holds for a layer.
// An auxiliary has no layers — its preset is one background source — so it
// gets a picker and nothing to drag.
VIEWS.lplayers = (() => {
  let dest = null;         // destination id
  let which = 'preview';   // 'program' | 'preview'
  let sel = 1;             // selected layer: 1..8, or 'bg' / 'top' for the two fixed layers
  const seen = new Set();  // destination+buffer whose layers were read
  const BG_SETS = ['NONE', '1', '2', '3', '4', '5', '6', '7', '8'];
  const TOP_FRAMES = ['NONE', '1', '2', '3', '4'];
  const BG = (tail) => MNG.bgProp(cur().n, buffer(), tail);
  const TOP = (tail) => MNG.topProp(cur().n, buffer(), tail);

  const D = () => awj();
  const cur = () => (dest ? awjDest(dest) : null);
  const buffer = () => cur() ? D().buffers(cur())[which] : 'UP';

  const ctx = () => ({ n: cur().n, buf: buffer() });
  const fitted = (d) => (d && d.kind === 'screen' ? mngCanvas.fitted(d.n) : []);
  const canvasPx = (d) => mngCanvas.size(d.n);
  const P = (l, tail) => mngCanvas.P(ctx(), l, tail);
  const gv = (l, key) => mngCanvas.gv(ctx(), l, key);

  function fetchSelected() {
    const d = cur();
    if (!d || d.kind !== 'screen' || typeof sel !== 'number') return;
    mngCanvas.fetchProps(ctx(), sel);
  }
  function refetch() {
    mngCanvas.forget();
    const d = cur();
    if (!d) return;
    D().refresh(d);
    if (d.kind === 'aux') { for (const b of ['UP', 'DOWN']) store.pget(MNG.auxSource(d.n, b)); return; }
    for (const b of ['UP', 'DOWN']) mngCanvas.fetch(d.n, b);
    fetchSelected();
  }
  // Settle on a destination and read it. Split from enter() because a view
  // opened from a bookmark runs enter() before the processor has answered
  // anything — so render() calls this too, and it only acts when something
  // changed. No notify here: a render in progress picks the result up.
  function settle() {
    const used = D().destinations();
    if (!used.length) return false;
    if (dest && used.some(d => d.id === dest)) return false;
    dest = used[0].id;
    const d = cur();
    if (d && typeof sel === 'number' && !fitted(d).includes(sel)) sel = fitted(d)[0] ?? 1;
    awjViewSubs = () => (cur() ? [MNG.subDestination(cur())] : []);
    awjApplySubs();
    mngInputs.refresh();
    refetch();
    startMngSnapshots();
    return true;
  }
  function pick(id) {
    dest = id;
    const d = cur();
    if (d && typeof sel === 'number' && !fitted(d).includes(sel)) sel = fitted(d)[0] ?? 1;
    awjViewSubs = () => (cur() ? [MNG.subDestination(cur())] : []);
    awjApplySubs();
    refetch();
    store.notify();
  }

  function enter() {
    if (awjDialect() !== 'mng') return;
    // The Show page hands a destination and layer over when it sends the
    // operator here for the full panel.
    const h = mngShowHandoff; mngShowHandoff = null;
    dest = null;
    if (!settle()) awjViewSubs = () => [];
    if (h && D().destinations().some(d => d.id === h.dest)) { which = h.which; sel = h.sel; pick(h.dest); }
    setTimeout(mngEnableSnapshots, 600);
  }

  const rectPx = (l) => mngCanvas.rect(ctx(), l);
  const setGeom = (l, r) => mngCanvas.setGeom(ctx(), l, r);
  const readBack = (l) => mngCanvas.readBack(ctx(), l);
  const layout = (name) => { if (cur()) mngCanvas.layout(ctx(), name); };

  // A copied layer: every property the panel holds, source included, held in
  // this page until pasted onto any layer of any screen or buffer.
  let clip = null;
  const layerTails = () => [...Object.values(MNG_GEOM).filter(tl => !tl.startsWith('status')), ...MNG_LAYER_PROPS.flatMap(g => g.items.map(it => it.tail))];
  function copyLayer(l) {
    const values = layerTails().map(tl => [tl, store.pval(P(l, tl))]).filter(([, v]) => v !== undefined);
    clip = { from: `${cur().id} ${which} L${l}`, values };
    store.notify();
  }
  function pasteLayer(l) {
    if (!clip) return;
    for (const [tl, v] of clip.values) store.pset(P(l, tl), v);
    setTimeout(() => { for (const [tl] of clip.values) store.pget(P(l, tl)); }, 300);
  }

  function canvas(d) {
    const CW = Math.min(720, Math.max(360, (window.innerWidth || 1200) - 620));
    return mngCanvas.element({ c: { n: d.n, buf: buffer() }, sel, width: CW,
      // A click on the ground re-renders (the panel changes); a drag does
      // not — the drag's own read-back does, once it ends.
      onSelect: (s, rerender) => { sel = s; if (typeof s === 'number') fetchSelected(); if (rerender) store.notify(); } });
  }

  // A range/number/select bound to an arbitrary path, for the two fixed layers.
  function pathRange(label, path, min, max, fmt) {
    const v = store.pval(path);
    return el('label', { class: 'field slider' },
      el('span', {}, label, el('b', { class: 'sv', text: v == null ? '·' : fmt(v) })),
      el('input', { type: 'range', min, max, step: 1, value: v ?? min,
        onpointerdown: beginDrag, onpointerup: endDrag, onpointercancel: endDrag,
        oninput: (e) => { pthrottledSet(path, +e.target.value); e.target.parentNode.querySelector('.sv').textContent = fmt(+e.target.value); } }));
  }
  function pathNumber(label, path, min, max) {
    return el('label', { class: 'field' }, label,
      el('input', { type: 'number', min, max, step: 1, value: store.pval(path) ?? '',
        onchange: (e) => { store.pset(path, Math.round(+e.target.value || 0)); if (!awjLive) setTimeout(() => store.pget(path), 120); } }));
  }
  function pathSelect(label, path, options) {
    const v = store.pval(path);
    const s = el('select', { onchange: (e) => { store.pset(path, e.target.value); if (!awjLive) setTimeout(() => store.pget(path), 150); } });
    for (const o of options) s.append(el('option', { value: o.v, selected: o.v === v, text: o.text }));
    if (v != null && !options.some(o => o.v === v)) s.append(el('option', { value: v, selected: true, text: String(v) }));
    return el('label', { class: 'field' }, label, s);
  }
  function bgPanel(d) {
    const st = store.pval(BG('status/@props/state'));
    const rgb = ['red', 'green', 'blue'].map(c => (store.pval(BG(`color/@props/${c}`)) ?? 0) & 255);
    const hex = '#' + rgb.map(x => x.toString(16).padStart(2, '0')).join('');
    return el('div', { class: 'editor' },
      el('h2', {}, 'Background ', el('span', { class: 'chip ' + (st && st !== 'OFF' ? 'on' : 'off') }, el('span', { class: 'dot' }), String(st ?? '·').toLowerCase())),
      pathSelect('Source', BG('source/@props/set'), BG_SETS.map(s => ({ v: s, text: s === 'NONE' ? 'colour' : `set ${s}${(() => { const c = store.pval(MNG.bgSetContent(d.n, +s)); return c && c !== 'NONE' ? ' · ' + String(c).toLowerCase().replace(/_/g, ' ') : ''; })()}` }))),
      el('label', { class: 'field' }, 'Colour',
        el('input', { type: 'color', class: 'swatch', value: hex, oninput: (e) => {
          const h = e.target.value;
          [['red', 1], ['green', 3], ['blue', 5]].forEach(([c, i]) => pthrottledSet(BG(`color/@props/${c}`), parseInt(h.slice(i, i + 2), 16)));
        } })),
      pathRange('Opacity', BG('opacity/@props/opacity'), 0, 256, pct256),
      el('div', { class: 'hint', text: 'A set is what Preconfig \u203a Background built: an input, a frame or nothing, shown unscaled under every live layer. With no set, the colour shows.' }));
  }
  function topPanel(d) {
    const st = store.pval(TOP('status/@props/state'));
    const frames = TOP_FRAMES.map(f => {
      if (f === 'NONE') return { v: f, text: '— none —' };
      const valid = store.pval(MNG.frame(d.n, 'top', +f, 'status/@props/isValid'));
      const lbl = store.pval(MNG.frame(d.n, 'top', +f, 'control/@props/label'));
      const lib = store.pval(MNG.frame(d.n, 'top', +f, 'control/@props/librarySlot'));
      return { v: f, text: `frame ${f}${lbl ? ' · ' + lbl : ''}${lib ? ' · library ' + lib : ''}${valid === false ? ' (empty)' : ''}` };
    });
    return el('div', { class: 'editor' },
      el('h2', {}, 'Top frame ', el('span', { class: 'chip ' + (st && st !== 'OFF' ? 'on' : 'off') }, el('span', { class: 'dot' }), String(st ?? '·').toLowerCase())),
      pathSelect('Frame', TOP('source/@props/frame'), frames),
      el('div', { class: 'nrow' }, pathNumber('Centre X', TOP('position/@props/posH'), -67268, 67268), pathNumber('Centre Y', TOP('position/@props/posV'), -67268, 67268)),
      pathRange('Opacity', TOP('opacity/@props/opacity'), 0, 256, pct256),
      el('div', { class: 'hint', text: 'One of the screen\u2019s four top-frame slots (Preconfig \u203a Screens), drawn over every live layer at the slot\u2019s own size.' }));
  }

  // ---- the properties panel, driven by the table above
  function field(it, l) {
    const path = P(l, it.tail);
    const v = store.pval(path);
    if (it.type === 'range') {
      return el('label', { class: 'field slider' },
        el('span', {}, it.label, el('b', { class: 'sv', text: v == null ? '·' : it.fmt(v) })),
        el('input', { type: 'range', min: it.min, max: it.max, step: 1, value: v ?? it.min,
          onpointerdown: beginDrag, onpointerup: endDrag, onpointercancel: endDrag,
          oninput: (e) => { pthrottledSet(path, +e.target.value); e.target.parentNode.querySelector('.sv').textContent = it.fmt(+e.target.value); } }));
    }
    if (it.type === 'int') {
      return el('label', { class: 'field' }, it.label,
        el('input', { type: 'number', min: it.min, max: it.max, step: 1, value: v ?? '',
          onchange: (e) => { const n = Math.max(it.min, Math.min(it.max, Math.round(+e.target.value || 0))); store.pset(path, n); readBack(l); } }));
    }
    if (it.type === 'bool') {
      return el('button', { class: 'btn ' + (v === true ? 'pgm' : 'ghost'), onclick: () => { store.pset(path, v !== true); if (!awjLive) setTimeout(() => store.pget(path), 120); } }, it.label);
    }
    if (it.type === 'enum') {
      const s = el('select', { onchange: (e) => { store.pset(path, e.target.value); if (!awjLive) setTimeout(() => store.pget(path), 120); } });
      for (const o of it.values) s.append(el('option', { value: o, selected: o === v, text: o.toLowerCase().replace(/_/g, ' ') }));
      if (v != null && !it.values.includes(v)) s.append(el('option', { value: v, selected: true, text: String(v) }));
      return el('label', { class: 'field' }, it.label, s);
    }
    if (it.type === 'flags') {
      const set = new Set(Array.isArray(v) ? v : []);
      return el('div', { class: 'field' }, el('span', { text: it.label }),
        el('div', { class: 'row wrap' }, ...it.values.map(f =>
          el('button', { class: 'btn small ' + (set.has(f) ? 'pgm' : 'ghost'),
            onclick: () => { const n = new Set(set); n.has(f) ? n.delete(f) : n.add(f); store.pset(path, [...n]); if (!awjLive) setTimeout(() => store.pget(path), 120); } },
            f.toLowerCase().replace(/_/g, ' ')))));
    }
    return null;
  }

  function panel(d) {
    const l = sel;
    const src = gv(l, 'source');
    const frozen = store.pval(MNG.layerFreeze(d.n, l)) === true;
    const fader = store.pval(MNG.layerFader(d.n, l));
    const srcSel = el('select', { onchange: (e) => { store.pset(P(l, MNG_GEOM.source), e.target.value); readBack(l); } });
    for (const o of mngInputs.sourceOptions(src)) srcSel.append(el('option', { value: o.v, selected: o.v === src, text: o.text }));
    const num = (key, label) => el('label', { class: 'field' }, label,
      el('input', { type: 'number', step: 1, value: gv(l, key) ?? '',
        onchange: (e) => { store.pset(P(l, MNG_GEOM[key]), Math.round(+e.target.value || 0)); readBack(l); } }));
    return el('div', { class: 'editor' },
      el('h2', {}, `Layer ${l}`, ' ',
        el('span', { class: 'chip ' + (gv(l, 'state') && gv(l, 'state') !== 'OFF' ? 'on' : 'off') }, el('span', { class: 'dot' }), String(gv(l, 'state') ?? '·').toLowerCase())),
      el('label', { class: 'field' }, 'Source', srcSel),
      el('div', { class: 'nrow' }, num('posH', 'Centre X'), num('posV', 'Centre Y')),
      el('div', { class: 'nrow' }, num('sizeH', 'Width'), num('sizeV', 'Height')),
      el('div', { class: 'row' },
        el('button', { class: 'btn ' + (frozen ? 'pgm' : 'ghost'), onclick: () => { store.pset(MNG.layerFreeze(d.n, l), !frozen); if (!awjLive) setTimeout(() => store.pget(MNG.layerFreeze(d.n, l)), 120); } }, frozen ? 'Frozen' : 'Freeze'),
        el('span', { class: 'hint', text: 'Freeze is on the screen, not the buffer: it holds through a take.' })),
      el('label', { class: 'field slider' },
        el('span', {}, 'Fader', el('b', { class: 'sv', text: fader == null ? '·' : Math.round(fader / 255 * 100) + '%' })),
        el('input', { type: 'range', min: 0, max: 255, step: 1, value: fader ?? 255,
          onpointerdown: beginDrag, onpointerup: endDrag, onpointercancel: endDrag,
          oninput: (e) => { pthrottledSet(MNG.layerFader(d.n, l), +e.target.value); e.target.parentNode.querySelector('.sv').textContent = Math.round(+e.target.value / 255 * 100) + '%'; } })),
      el('div', { class: 'row' },
        el('button', { class: 'btn ghost', onclick: () => store.pset(MNG.layerFadeIn(d.n, l), true) }, 'Fade in'),
        el('button', { class: 'btn ghost', onclick: () => store.pset(MNG.layerFadeOut(d.n, l), true) }, 'Fade out'),
        el('span', { class: 'hint', text: 'over the take time; a master over the layer’s own opacity' })),
      el('div', { class: 'row' },
        el('button', { class: 'btn ghost', onclick: () => copyLayer(l) }, 'Copy layer'),
        el('button', { class: 'btn ghost', disabled: !clip, onclick: () => pasteLayer(l) }, clip ? `Paste ${clip.from} onto L${l}` : 'Paste'),
        el('span', { class: 'hint', text: 'Every property the panel holds, source included, onto any layer of any screen or buffer. Drags snap to edges and centres (Alt to free them); arrow keys nudge.' })),
      ...MNG_LAYER_PROPS.map(g => el('details', { class: 'group' },
        el('summary', { text: g.g }),
        ...g.items.map(it => field(it, l)))));
  }

  function auxPanel(d) {
    const b = buffer();
    const path = MNG.auxSource(d.n, b);
    const src = store.pval(path);
    const s = el('select', { onchange: (e) => { store.pset(path, e.target.value); if (!awjLive) setTimeout(() => store.pget(path), 120); } });
    for (const o of mngInputs.sourceOptions(src)) s.append(el('option', { value: o.v, selected: o.v === src, text: o.text }));
    return el('div', { class: 'editor' },
      el('h2', { text: `${d.id} ${which} — background` }),
      el('label', { class: 'field' }, 'Source', s),
      el('div', { class: 'hint', text: 'An auxiliary has no layers on this platform: its preset is one background source.' }));
  }

  function render() {
    settle();
    const used = D().destinations();
    const d = cur();
    const bufs = d ? D().buffers(d) : null;
    return el('div', {},
      el('div', { class: 'view-head' },
        el('h1', { text: 'Layers' }),
        el('span', { class: 'hint', text: 'A screen’s live layers on its canvas — drag to move, corners to resize; an auxiliary is one background source' })),
      el('div', { class: 'panel' },
        awjLiveRow('layer changes'),
        el('div', { class: 'row' },
          el('label', { text: 'Destination ' }),
          el('select', { onchange: (e) => pick(e.target.value) },
            ...used.map(u => el('option', { value: u.id, selected: u.id === dest, text: `${u.id} ${D().label(u) || ''}`.trim() }))),
          el('div', { class: 'seg' },
            el('button', { class: which === 'program' ? 'on take' : '', onclick: () => { which = 'program'; if (d && d.kind === 'screen') fetchSelected(); store.notify(); } }, `Program${bufs ? ' · ' + bufs.program : ''}`),
            el('button', { class: which === 'preview' ? 'on recall' : '', onclick: () => { which = 'preview'; if (d && d.kind === 'screen') fetchSelected(); store.notify(); } }, `Preview${bufs ? ' · ' + bufs.preview : ''}`)),
          d && d.kind === 'screen' ? el('div', { class: 'seg' },
            ...Object.entries(mngCanvas.LAYOUTS).map(([k, v]) => el('button', { onclick: () => layout(k) }, v.label))) : null,
          el('button', { class: 'btn ghost', onclick: () => { refetch(); store.notify(); } }, 'Re-read'))),
      !d ? el('div', { class: 'panel' }, el('div', { class: 'hint pad', text: store.connected ? 'No screen or auxiliary on this device is in service.' : 'Waiting for the processor.' }))
        : d.kind === 'aux'
          ? el('div', { class: 'panel' }, auxPanel(d))
          : el('div', { class: 'split-wide' },
              el('div', { class: 'panel' },
                el('div', { class: 'row' },
                  el('span', { class: 'hint', text: (() => { const c = canvasPx(d); return `${c.w}×${c.h}${c.reported ? '' : ' (assumed)'} · ${fitted(d).length} layer${fitted(d).length === 1 ? '' : 's'} fitted · editing ${which} (${buffer()})`; })() }),
                  el('div', { class: 'grow' }),
                  el('div', { class: 'seg' },
                    el('button', { class: sel === 'bg' ? 'on recall' : '', onclick: () => { sel = 'bg'; store.notify(); } }, 'BG'),
                    ...fitted(d).map(l => el('button', { class: l === sel ? 'on recall' : '', onclick: () => { sel = l; fetchSelected(); store.notify(); } }, `L${l}`)),
                    el('button', { class: sel === 'top' ? 'on recall' : '', onclick: () => { sel = 'top'; store.notify(); } }, 'Top'))),
                canvas(d)),
              el('div', { class: 'panel' },
                sel === 'bg' ? bgPanel(d)
                  : sel === 'top' ? topPanel(d)
                  : fitted(d).length ? panel(d) : el('div', { class: 'hint pad', text: 'The applied configuration gives this screen no live layers.' }))));
  }

  return { enter, render };
})();

// ---------- Midra 4K / Alta 4K: the EDID library ----------
// Sixty-four user slots and the factory entries, keyed by name; a slot is
// offered where the device says it holds something.
const MNG_EDID_SLOTS = 64;
const MNG_EDID_DEFAULTS = ['DEFAULT_DP_UHD60', 'DEFAULT_HDMI_2_0', 'DEFAULT_DP_UHD60_RB', 'DEFAULT_HDMI_2_0_RB', 'DEFAULT_DP_1080P', 'DEFAULT_HDMI_2_0_1080P', 'DEFAULT_DP_UHD50', 'DEFAULT_HDMI_2_0_50',
  'DEFAULT_DP_UHD50_RB', 'DEFAULT_HDMI_2_0_50_RB', 'DEFAULT_DP_1080P_50', 'DEFAULT_HDMI_2_0_1080P_50', 'DEFAULT_HDMI_1080P', 'DEFAULT_HDMI_1080P_50', 'DEFAULT_DP_1080P_120', 'DEFAULT_HDMI_2_0_1080P_120',
  'DEFAULT_HDMI_1080P_120', 'DEFAULT_DP_1080P_240', 'DEFAULT_HDMI_2_0_1080P_240', 'DEFAULT_DP_HDR_1080P_60', 'DEFAULT_HDMI_HDR_1080P_60'];
const mngEdidKeys = () => [...Array.from({ length: MNG_EDID_SLOTS }, (_, i) => String(i + 1)), ...MNG_EDID_DEFAULTS];
function mngEdidName(k) {
  const pref = store.pval(MNG.edidBankStatus(k, 'prefFormatName'));
  if (/^\d+$/.test(k)) return `${k} · ${store.pval(MNG.edidBank(k, 'label')) || store.pval(MNG.edidBankStatus(k, 'productName')) || 'unnamed'}${pref ? ' · ' + pref : ''}`;
  return `${k.replace(/^DEFAULT_/, '').replace(/_/g, ' ').replace('2 0', '2.0').replace(' RB', ' (reduced blanking)')}${pref ? ' · ' + pref : ''} (factory)`;
}

// ---------- AWJ: Inputs (Midra 4K / Alta 4K) ----------
// Every input the unit has, then one input's active plug in full: the plug
// itself, its signal, HDCP and HDR, picture, aspect and cropping, the keyer
// (chroma, luma, cut and fill) and the EDID it presents.
VIEWS.lpinputs = (() => {
  let read = false;    // whether the inputs were read since this view was entered
  let sel = 1;
  const plugRead = new Set();
  let edidRead = false;
  let edidPick = '';
  const COLOR = [['brightness', 'Brightness', -128, 127], ['contrast', 'Contrast', -128, 127], ['saturation', 'Saturation', -128, 127], ['hue', 'Hue', -90, 90],
    ['gainR', 'Gain R', -128, 127], ['gainG', 'Gain G', -128, 127], ['gainB', 'Gain B', -128, 127], ['offsetR', 'Offset R', -128, 127], ['offsetG', 'Offset G', -128, 127], ['offsetB', 'Offset B', -128, 127]];
  const SIGNAL_ASPECTS = ['NATIVE', '5_4', '4_3', '16_10', '15_9', '16_9', '21_9', '256_135', '64_27'];
  const CONTENT_ASPECTS = ['SIGNAL', '5_4', '4_3', '16_10', '15_9', '16_9', '21_9', 'CUSTOM'];
  const LAYER_FILL = ['LAYER_SETTING', '1_1', 'CENTERED', 'FULLSCREEN', 'CROPPED'];
  const PREDEF_CROP = ['NONE', 'LETTERBOX_1_78', 'LETTERBOX_1_85', 'LETTERBOX_2_35', 'PILLARBOX_1_33'];
  const HDR_MODES = ['AUTO', 'SDR', 'HDR10', 'HLG'];
  const NITS = ['AUTO', '100_NITS', '200_NITS', '300_NITS', '400_NITS', '500_NITS', '600_NITS', '700_NITS', '800_NITS', '900_NITS', '1000_NITS', '1200_NITS', '1400_NITS', '1600_NITS', '1800_NITS', '2000_NITS', '3000_NITS', '4000_NITS', '5000_NITS', '6000_NITS', '7000_NITS', '8000_NITS', '9000_NITS', '10000_NITS'];
  const ratio = (v) => v.replace(/^(\d+)_(\d+)$/, '$1:$2').replace(/^LETTERBOX_(\d)_(\d+)$/, 'letterbox $1.$2').replace(/^PILLARBOX_(\d)_(\d+)$/, 'pillarbox $1.$2');

  function settle() {
    if (read || !store.meta || !store.connected) return;
    read = true;
    mngInputs.refresh();
    for (let i = 1; i <= MNG_INPUTS; i++) { for (let p = 1; p <= 4; p++) store.pget(MNG.plugAvailable(i, p)); store.pget(MNG.inputKeyingAvailable(i)); store.pget(MNG.inputCutFillAvailable(i)); }
    awjViewSubs = () => [MNG.SUB_INPUTS, MNG.SUB_TALLIES];
    awjApplySubs();
    startMngSnapshots();
    setTimeout(mngEnableSnapshots, 600);
  }
  function enter() {
    if (awjDialect() !== 'mng') return;
    read = false; plugRead.clear(); edidRead = false;
    settle();
  }
  // The selected input's plug is read in full once per plug seen.
  function fetchPlug(i, p) {
    const k = `${i}:${p}`;
    if (plugRead.has(k)) return;
    plugRead.add(k);
    for (const prop of ['signalType', 'enableHdcp', 'enableCropFinder', 'label']) store.pget(MNG.plugControl(i, p, prop));
    for (const prop of ['signalTypeValidity', 'hdcpValidity', 'type', 'canUseLutProcessing']) store.pget(MNG.plugStatusProp(i, p, prop));
    for (const prop of ['isValid', 'formatName', 'scanType', 'formatWidth', 'formatHeight', 'fieldFrequency', 'colorSpace', 'supportStatus']) store.pget(MNG.plugSignal(i, p, prop));
    for (const prop of ['mode', 'nitLevel']) { store.pget(MNG.plugHdr(i, p, prop)); store.pget(MNG.plugHdrStatus(i, p, prop)); }
    for (const prop of ['mode', 'source']) { store.pget(MNG.plugConversionLut(i, p, prop)); store.pget(MNG.plugCorrectionLut(i, p, prop)); }
    for (const prop of ['isEnabled', 'state', 'sourceValidity']) { store.pget(MNG.plugConversionLutStatus(i, p, prop)); store.pget(MNG.plugCorrectionLutStatus(i, p, prop)); }
    mngLuts.fetch();
    for (const [prop] of COLOR) store.pget(MNG.plugSetting(i, p, `color/@props/${prop}`));
    for (const prop of ['sharpness', 'pulldown22', 'pulldown32']) store.pget(MNG.plugSetting(i, p, `processing/@props/${prop}`));
    for (const prop of ['signal', 'transformTo', 'customRatio', 'layerFill']) store.pget(MNG.plugSetting(i, p, `aspect/@props/${prop}`));
    for (const prop of ['predefined', 'top', 'bottom', 'left', 'right']) store.pget(MNG.plugSetting(i, p, `cropping/control/@props/${prop}`));
    for (const prop of ['mode', 'displayMask']) store.pget(MNG.plugSetting(i, p, `keying/control/@props/${prop}`));
    for (const prop of ['hue', 'transparency', 'colorCorrection', 'foreground', 'background']) store.pget(MNG.plugSetting(i, p, `keying/chroma/@props/${prop}`));
    for (const prop of ['luma', 'foreground', 'transparency', 'invert']) store.pget(MNG.plugSetting(i, p, `keying/luma/@props/${prop}`));
    store.pget(MNG.plugSetting(i, p, 'keying/cutNFill/control/@props/curve'));
    for (const prop of ['status', 'source', 'phaseShift']) store.pget(MNG.plugSetting(i, p, `keying/cutNFill/status/@props/${prop}`));
    for (const prop of ['enable', 'top', 'bottom', 'left', 'right']) store.pget(MNG.plugSetting(i, p, `keying/assistant/@props/${prop}`));
    store.pget(MNG.plugEdidStatus(i, p));
    for (let b = 1; b <= 3; b++) for (const prop of ['extensionType', 'isHdmiCompatible', 'isAudioCompatible', 'isHdrCompatible', 'prefFormatName']) store.pget(MNG.plugEdidExt(i, p, b, prop));
  }
  function fetchEdidLibrary() {
    if (edidRead) return;
    edidRead = true;
    for (const k of mngEdidKeys()) for (const prop of ['isAvailable', 'isProtected', 'prefFormatName', 'productName']) store.pget(MNG.edidBankStatus(k, prop));
    for (let n = 1; n <= MNG_EDID_SLOTS; n++) store.pget(MNG.edidBank(n, 'label'));
  }

  function row(i) {
    const t = mngInputs.tally(i.key);
    const flag = (path, on, label) => el('button', { class: 'btn small ' + (on ? 'pgm' : 'ghost'),
      onclick: (e) => { e.stopPropagation(); store.pset(path, !on); if (!awjLive) setTimeout(() => store.pget(path), 120); } }, label);
    const shot = i.available !== false ? mngSnapshotUrl('inputs', i.n) : null;
    return el('tr', { class: (i.available === false ? 'dim' : '') + (i.n === sel ? ' sel' : ''), onclick: () => { sel = i.n; store.notify(); } },
      el('td', {}, shot ? el('img', { class: 'thumb', src: shot, alt: '', width: 96, height: 54 }) : null),
      el('td', { text: `IN ${i.n}` }),
      el('td', { text: i.label || '—' }),
      el('td', { class: 'val', text: i.plug ?? '·' }),
      el('td', { class: 'val', text: i.type ? i.type.replace('DISPLAY_PORT', 'DP') : '·' }),
      el('td', {}, i.available === false
        ? el('span', { class: 'chip off' }, el('span', { class: 'dot' }), 'not fitted')
        : el('span', { class: 'chip ' + (i.signal === true ? 'on' : 'off') }, el('span', { class: 'dot' }), i.format || (i.signal === true ? 'signal' : i.signal === false ? 'no signal' : '·'))),
      el('td', {},
        t.pgm ? el('span', { class: 'chip pgm' }, el('span', { class: 'dot' }), 'program') : null, ' ',
        t.pvw ? el('span', { class: 'chip pvw' }, el('span', { class: 'dot' }), 'preview') : null),
      el('td', {}, flag(MNG.inputFreeze(i.n), i.frozen, i.frozen ? 'Frozen' : 'Freeze'), ' ', flag(MNG.inputBlack(i.n), i.black, i.black ? 'Black' : 'Black')));
  }

  function editor(i) {
    const inp = mngInputs.get(i);
    if (inp.available === false) return el('div', { class: 'editor' }, el('h2', { text: `Input ${i}` }), el('div', { class: 'hint', text: 'Not fitted on this unit.' }));
    const p = inp.plug;
    if (p == null) return el('div', { class: 'editor' }, el('h2', { text: `Input ${i}` }), el('div', { class: 'hint', text: 'Waiting for the input’s active plug.' }));
    fetchPlug(i, p);
    const S = (tail) => MNG.plugSetting(i, p, tail);
    const plugs = [1, 2, 3, 4].filter(k => store.pval(MNG.plugAvailable(i, k)) === true);
    const keyMode = store.pval(S('keying/control/@props/mode'));
    const keyerOk = store.pval(MNG.inputKeyingAvailable(i)), cutFillOk = store.pval(MNG.inputCutFillAvailable(i));
    const hdcpOpts = store.pval(MNG.plugStatusProp(i, p, 'hdcpValidity')) || [];
    const sigOpts = store.pval(MNG.plugStatusProp(i, p, 'signalTypeValidity')) || [];
    const edid = mngEdidSummary(store.pval(MNG.plugEdidStatus(i, p)));
    const cropReads = ['top', 'bottom', 'left', 'right', 'predefined'].map(k => S(`cropping/control/@props/${k}`));
    return el('div', { class: 'editor' },
      el('h2', {}, `Input ${i}`, ' ', el('span', { class: 'chip ' + (inp.signal === true ? 'on' : 'off') }, el('span', { class: 'dot' }), inp.format || (inp.signal === false ? 'no signal' : '·'))),
      el('div', { class: 'row wrap' },
        el('label', { class: 'field' }, 'Active plug', awjSelect(null, MNG.inputPlug(i), plugs.map(k => ({ v: String(k), text: `plug ${k} · ${(store.pval(MNG.plugType(i, k)) || '').replace('DISPLAY_PORT', 'DP').toLowerCase() || '?'}` })),
          { write: (path, v) => { awjWrite(path, v); mngInputs.refresh(); } })),
        awjText('Label', MNG.plugControl(i, p, 'label'), 32)),
      el('div', { class: 'row wrap' },
        awjSelect('Signal', MNG.plugControl(i, p, 'signalType'), sigOpts.map(v => ({ v, text: v === 'AUTO' ? 'auto' : v.replace(/^(YUV|RGB)_(\d+)_(\d+)$/, '$1 $2–$3') }))),
        awjSelect('HDCP', MNG.plugControl(i, p, 'enableHdcp'), hdcpOpts.map(v => ({ v, text: { NONE: 'refused', DEFAULT: 'accepted', HDCP_1X_ONLY: '1.x only', HDCP_1X_AND_2X: '1.x and 2.x' }[v] || awjWords(v) })), { disabled: !hdcpOpts.length }),
        awjSelect('HDR', MNG.plugHdr(i, p, 'mode'), HDR_MODES),
        awjSelect('Nits', MNG.plugHdr(i, p, 'nitLevel'), NITS.map(v => ({ v, text: v === 'AUTO' ? 'auto' : v.replace('_NITS', '') })))),
      el('div', { class: 'hint', text: `Signal: ${awjWords(store.pval(MNG.plugSignal(i, p, 'scanType')))}, ${store.pval(MNG.plugSignal(i, p, 'formatWidth')) || '·'}×${store.pval(MNG.plugSignal(i, p, 'formatHeight')) || '·'} at ${store.pval(MNG.plugSignal(i, p, 'fieldFrequency')) || '·'} Hz, ${awjWords(store.pval(MNG.plugSignal(i, p, 'colorSpace')))}; HDR seen: ${awjWords(store.pval(MNG.plugHdrStatus(i, p, 'mode')))} ${store.pval(MNG.plugHdrStatus(i, p, 'nitLevel')) || ''} nits.` }),
      el('details', { class: 'group' }, el('summary', { text: 'Picture' }),
        ...COLOR.map(([prop, label, min, max]) => awjRange(label, S(`color/@props/${prop}`), min, max)),
        el('div', { class: 'row wrap' },
          awjSelect('Sharpness', S('processing/@props/sharpness'), ['LOW', 'MEDIUM', 'HIGH']),
          awjToggle(S('processing/@props/pulldown22'), '2:2 pulldown', { small: true }),
          awjToggle(S('processing/@props/pulldown32'), '3:2 pulldown', { small: true }))),
      el('details', { class: 'group' }, el('summary', { text: 'Aspect and cropping' }),
        el('div', { class: 'row wrap' },
          awjSelect('Signal is', S('aspect/@props/signal'), SIGNAL_ASPECTS.map(v => ({ v, text: v === 'NATIVE' ? 'as reported' : ratio(v) }))),
          awjSelect('Show as', S('aspect/@props/transformTo'), CONTENT_ASPECTS.map(v => ({ v, text: v === 'SIGNAL' ? 'the signal’s' : v === 'CUSTOM' ? 'custom' : ratio(v) }))),
          store.pval(S('aspect/@props/transformTo')) === 'CUSTOM' ? awjNumber('Custom ×1000', S('aspect/@props/customRatio'), 100, 10000, { cls: 'num' }) : null,
          awjSelect('In a layer', S('aspect/@props/layerFill'), LAYER_FILL.map(v => ({ v, text: v === 'LAYER_SETTING' ? 'as the layer says' : v === '1_1' ? '1:1' : awjWords(v) })))),
        el('div', { class: 'row wrap' },
          awjSelect('Crop', S('cropping/control/@props/predefined'), PREDEF_CROP.map(v => ({ v, text: v === 'NONE' ? 'custom / none' : ratio(v) })), { extra: cropReads }),
          ...['top', 'bottom', 'left', 'right'].map(k => awjNumber(k[0].toUpperCase() + k.slice(1), S(`cropping/control/@props/${k}`), 0, 8192, { cls: 'num' })),
          awjTrigger(S('cropping/control/@props/xUpdate'), 'Apply crop', { cls: 'primary', reads: cropReads })),
        awjToggle(MNG.plugControl(i, p, 'enableCropFinder'), 'Crop finder', { small: true, title: 'The device looks for black borders and proposes a crop' })),
      el('details', { class: 'group', open: keyMode && keyMode !== 'DISABLE' }, el('summary', {}, 'Keying ', keyerOk === false && cutFillOk !== true ? awjChip('off', 'not on this input') : keyMode && keyMode !== 'DISABLE' ? awjChip('on', awjWords(keyMode)) : null),
        el('div', { class: 'row wrap' },
          awjSelect('Keyer', S('keying/control/@props/mode'), [{ v: 'DISABLE', text: 'off' }, ...(keyerOk !== false ? [{ v: 'CHROMA', text: 'chroma' }, { v: 'LUMA', text: 'luma' }] : []), ...(cutFillOk === true ? [{ v: 'CUT_AND_FILL', text: 'cut and fill' }] : [])]),
          awjSelect('Show mask', S('keying/control/@props/displayMask'), [{ v: 'NONE', text: 'no' }, { v: 'BLACK_N_WHITE', text: 'black and white' }, { v: 'COLOR', text: 'colour' }])),
        keyMode === 'CHROMA' ? el('div', {},
          awjRange('Hue', S('keying/chroma/@props/hue'), 0, 359, v => v + '°'),
          awjRange('Transparency', S('keying/chroma/@props/transparency'), 0, 100),
          awjRange('Colour correction', S('keying/chroma/@props/colorCorrection'), 0, 100),
          awjRange('Foreground', S('keying/chroma/@props/foreground'), 0, 100),
          awjRange('Background', S('keying/chroma/@props/background'), 0, 100)) : null,
        keyMode === 'LUMA' ? el('div', {},
          awjRange('Luma', S('keying/luma/@props/luma'), 0, 255),
          awjRange('Foreground', S('keying/luma/@props/foreground'), 0, 100),
          awjRange('Transparency', S('keying/luma/@props/transparency'), 0, 100),
          awjToggle(S('keying/luma/@props/invert'), 'Invert', { small: true })) : null,
        keyMode === 'CUT_AND_FILL' ? el('div', {},
          el('div', { class: 'row wrap' },
            awjChip(store.pval(S('keying/cutNFill/status/@props/status')) === 'SYNCED_AND_PHASED' ? 'on' : 'bad', awjWords(store.pval(S('keying/cutNFill/status/@props/status')))),
            el('span', { class: 'hint', text: `Cut from ${mngInputs.name(store.pval(S('keying/cutNFill/status/@props/source')))} · phase ${store.pval(S('keying/cutNFill/status/@props/phaseShift')) ?? '·'}` })),
          el('div', { class: 'hint', text: 'The fill is this input; the cut (the alpha) is the next input, which the device names above. Both must be the same format and locked together.' })) : null,
        keyMode && keyMode !== 'DISABLE' ? el('div', { class: 'row wrap' },
          awjToggle(S('keying/assistant/@props/enable'), 'Assistant', { small: true, title: 'Sample a region of the picture to set the key' }),
          ...['top', 'bottom', 'left', 'right'].map(k => awjNumber(k, S(`keying/assistant/@props/${k}`), 0, 65535, { cls: 'num' })),
          awjTrigger(S('keying/assistant/@props/xGrab'), 'Grab', { reads: ['hue', 'transparency', 'foreground', 'background'].map(k => S(`keying/chroma/@props/${k}`)) })) : null),
      el('details', { class: 'group' }, el('summary', { text: 'LUTs' }),
        el('div', { class: 'row wrap' },
          awjSelect('Conversion', MNG.plugConversionLut(i, p, 'mode'), [{ v: 'AUTO', text: 'auto' }, { v: 'CUSTOM', text: 'custom' }]),
          awjSelect('Conversion LUT', MNG.plugConversionLut(i, p, 'source'), mngLuts.options('conversion', store.pval(MNG.plugConversionLutStatus(i, p, 'sourceValidity')))),
          awjChip(store.pval(MNG.plugConversionLutStatus(i, p, 'isEnabled')) === true ? 'on' : 'off', awjWords(store.pval(MNG.plugConversionLutStatus(i, p, 'state'))))),
        el('div', { class: 'row wrap' },
          awjSelect('Correction', MNG.plugCorrectionLut(i, p, 'mode'), [{ v: 'MANUAL', text: 'manual' }, { v: 'AUTO', text: 'auto' }]),
          awjSelect('Correction LUT', MNG.plugCorrectionLut(i, p, 'source'), mngLuts.options('correction', store.pval(MNG.plugCorrectionLutStatus(i, p, 'sourceValidity')))),
          awjChip(store.pval(MNG.plugCorrectionLutStatus(i, p, 'isEnabled')) === true ? 'on' : 'off', awjWords(store.pval(MNG.plugCorrectionLutStatus(i, p, 'state'))))),
        el('div', { class: 'hint', text: store.pval(MNG.plugStatusProp(i, p, 'canUseLutProcessing')) === false ? 'No LUT resource is allocated to this input (Setup › LUTs).' : 'A conversion LUT changes colour space or HDR on the way in; a correction LUT is applied after it. The lists offer what the libraries hold.' })),
      el('details', { class: 'group' }, el('summary', { text: 'EDID' }),
        edid ? (edid.bad ? el('div', { class: 'hint', text: 'The plug reports no EDID (blank).' })
          : el('div', { class: 'hint', text: `Presenting ${edid.mfr} ${edid.name || '(unnamed)'} — preferred ${edid.pw}×${edid.ph}${edid.rate ? ' at ' + edid.rate + ' Hz' : ''}, ${edid.year}, ${edid.ext} extension block${edid.ext === 1 ? '' : 's'}` + [1, 2, 3].map(b => store.pval(MNG.plugEdidExt(i, p, b, 'extensionType'))).filter(t => t && t !== 'UNKNOWN').map(t => ' · ' + awjWords(t)).join('') + '.' }))
          : el('div', { class: 'hint', text: 'No EDID read yet.' }),
        el('div', { class: 'row wrap' },
          el('label', { class: 'field' }, 'From the library', (() => {
            fetchEdidLibrary();
            const s = el('select', { onchange: (e) => { edidPick = e.target.value; store.notify(); } });
            s.append(el('option', { value: '', selected: !edidPick, text: '— pick an EDID —' }));
            for (const k of mngEdidKeys()) {
              if (store.pval(MNG.edidBankStatus(k, 'isAvailable')) !== true) continue;
              s.append(el('option', { value: k, selected: k === edidPick, text: mngEdidName(k) }));
            }
            return s;
          })()),
          el('button', { class: 'btn primary', disabled: !edidPick, onclick: () => {
            // The library entry's bytes go to the plug as they are; the
            // device answers with nothing, so the plug is read back after it
            // has had time to re-present itself.
            const go = () => { const d = store.pval(MNG.edidBankStatus(edidPick, 'data')); if (!Array.isArray(d)) return; store.pset(MNG.plugEdidCmd(i, p), d); setTimeout(() => { store.pget(MNG.plugEdidStatus(i, p)); for (let b = 1; b <= 3; b++) store.pget(MNG.plugEdidExt(i, p, b, 'extensionType')); }, 800); };
            if (Array.isArray(store.pval(MNG.edidBankStatus(edidPick, 'data')))) go(); else { store.pget(MNG.edidBankStatus(edidPick, 'data')); setTimeout(go, 600); }
          } }, 'Load onto this plug'),
          el('button', { class: 'btn ghost', onclick: () => store.pget(MNG.plugEdidStatus(i, p)) }, 'Re-read')),
        el('div', { class: 'hint', text: 'The library holds the device’s factory EDIDs and any saved from its editor; loading one writes its 256 bytes to the plug. Editing EDIDs byte by byte is the Web RCS’s job, not this page’s.' })),
      el('div', { class: 'row' },
        awjTrigger(S('@props/xReset'), 'Reset plug settings', { title: 'Every setting of this plug back to the device’s defaults', then: () => { plugRead.delete(`${i}:${p}`); setTimeout(() => { fetchPlug(i, p); store.notify(); }, 400); } })));
  }

  function render() {
    settle();
    const rows = [];
    for (let i = 1; i <= MNG_INPUTS; i++) rows.push(mngInputs.get(i));
    const fitted = rows.filter(r => r.available !== false);
    if (!fitted.some(r => r.n === sel) && fitted.length) sel = fitted[0].n;
    return el('div', {},
      el('div', { class: 'view-head' },
        el('h1', { text: 'Inputs' }),
        el('span', { class: 'hint', text: 'Every input the unit has, its active plug and signal, where it is on air — and, for one at a time, everything its plug can be set to' })),
      el('div', { class: 'panel' }, awjLiveRow('input and tally changes')),
      el('div', { class: 'split-wide' },
        el('div', { class: 'panel' },
          el('table', { class: 'grid rows' },
            el('thead', {}, el('tr', {}, ...['', 'Input', 'Label', 'Plug', 'Type', 'Signal', 'On air', ''].map(h => el('th', { text: h })))),
            el('tbody', {}, ...fitted.map(row))),
          rows.length > fitted.length ? el('div', { class: 'hint pad', text: `${rows.length - fitted.length} of the model’s ${MNG_INPUTS} inputs are not fitted on this unit. Tap an input to set it up.` }) : el('div', { class: 'hint pad', text: 'Tap an input to set it up.' })),
        el('div', { class: 'panel' }, fitted.length ? editor(sel) : el('div', { class: 'hint pad', text: store.connected ? 'No input has answered yet.' : 'Waiting for the processor.' }))));
  }
  return { enter, render };
})();

// ---------- AWJ: Screens ----------
VIEWS.lpscreens = (() => {
  let picked = new Set();   // destination ids ticked for a grouped take
  function enter() {
    // The server inventories on connect; this covers a view opened later, or
    // after a device has been away.
    const D = awj();
    for (const d of D.destinations()) { D.refresh(d); D.refreshExtras?.(d); }
    D.quickPreset?.refresh(D.destinations());
    awjViewSubs = () => [];
    awjApplySubs();
  }

  // The device's emergency key: fade to black, a library image or a master
  // memory, on the destinations its filter covers, on and off from one switch.
  function quickPresetRow(D, used) {
    const Q = D.quickPreset;
    const on = Q.isOn(), mode = Q.mode();
    const what = { NULL: 'fade to black', FRAME: 'library image', MASTER: `master memory ${Q.masterSlot() ?? ''}`.trim() }[mode] || String(mode ?? '·');
    return el('div', { class: 'row wrap' },
      el('button', { class: 'btn ' + (on ? 'pgm' : 'ghost'), onclick: () => Q.set(!Q.wanted()) },
        on ? `Quick preset ON \u2014 ${what}` : `Quick preset: ${what}`),
      el('select', { onchange: (e) => Q.setMode(e.target.value) },
        ...[['NULL', 'fade to black'], ['FRAME', 'library image'], ['MASTER', 'master memory']].map(([v, tx]) => el('option', { value: v, selected: v === mode, text: tx }))),
      el('span', { class: 'hint', text: 'on:' }),
      ...used.map(d => el('button', { class: 'btn small ' + (Q.covers(d) ? (Q.onDest(d) ? 'pgm' : 'primary') : 'ghost'),
        title: Q.covers(d) ? 'Covered by the quick preset (tap to exclude)' : 'Not covered (tap to include)',
        onclick: () => Q.setCovers(d, !Q.covers(d)) }, d.id)),
      el('span', { class: 'hint', text: 'The emergency key: what the mode says goes on every covered program output, and off again with the same switch.' }));
  }

  // What is not in the transition status: a take time typed in seconds, a
  // T-bar, and the flags. Only where the dialect has them.
  function takeTimeField(D, d) {
    if (!D.setTakeTime) return el('td', { class: 'val', text: `${D.takeTimes(d).map(awjSeconds).join(' / ')} s` });
    const v = D.takeTimes(d)[0];
    return el('td', {}, el('input', { class: 'num', type: 'number', min: 0, max: 300, step: 0.1, value: v == null ? '' : (v / 10).toFixed(1),
      onchange: (e) => D.setTakeTime(d, Math.round((+e.target.value || 0) * 10)) }), ' s');
  }
  function tbarField(D, d) {
    if (!D.setTbar) return null;
    const v = D.tbar(d);
    return el('td', {}, el('input', { class: 'tbar', type: 'range', min: 0, max: 65535, step: 1, value: v ?? 0, title: 'T-bar',
      onpointerdown: beginDrag, onpointerup: endDrag, onpointercancel: endDrag,
      oninput: (e) => D.setTbar(d, +e.target.value) }));
  }

  function row(d) {
    const D = awj();
    const t = D.transition(d);
    const moving = D.inFlight(d);
    const { program, preview } = D.buffers(d);
    const times = D.takeTimes(d).map(awjSeconds).join(' / ');
    const mem = ['program', 'preview'].map(w => D.memoryOn(d, w));
    return el('tr', { class: picked.has(d.id) ? 'sel' : '' },
      D.takeMany ? el('td', {}, el('input', { type: 'checkbox', checked: picked.has(d.id), title: 'Include in the grouped take',
        onchange: (e) => { if (e.target.checked) picked.add(d.id); else picked.delete(d.id); store.notify(); } })) : null,
      el('td', { text: d.id }),
      el('td', { text: D.label(d) || '—' }),
      el('td', { class: 'val', text: t == null ? '·' : String(t) }),
      el('td', { class: 'val', text: `${program} / ${preview}` }),
      D.showsMemory
        ? el('td', { class: 'val', text: mem.map(m => (m == null ? '—' : `M${m}`)).join(' / ') })
        : null,
      takeTimeField(D, d),
      el('td', {},
        moving
          ? el('span', { class: 'chip on' }, el('span', { class: 'dot' }), moving)
          : el('span', { class: 'chip off' }, el('span', { class: 'dot' }), 'idle')),
      tbarField(D, d),
      el('td', { class: 'acts' },
        el('button', { class: 'btn pgm', onclick: () => D.take(d) }, 'Take'),
        el('button', { class: 'btn ghost', onclick: () => D.cut(d) }, 'Cut'),
        D.stepBack ? el('button', { class: 'btn ghost', title: 'Revert the last change to layer settings (the device\u2019s own Step Back — an edit undo, not a return to the previous look)', onclick: () => D.stepBack(d) }, 'Step back') : null,
        D.copyToPreview ? el('button', { class: 'btn ghost', title: 'Copy program to preview', onclick: () => D.copyToPreview(d) }, 'PGM \u2192 PRW') : null,
        D.frozen ? el('button', { class: 'btn ' + (D.frozen(d) ? 'pgm' : 'ghost'), onclick: () => D.setFrozen(d, !D.frozen(d)) }, D.frozen(d) ? 'Frozen' : 'Freeze') : null,
        D.presetToggle ? el('button', { class: 'btn small ' + (D.presetToggle(d) === true ? 'primary' : 'ghost'),
          title: 'Preset toggle: swap program and preview on a take (on), or copy preview to program and keep it (off)',
          onclick: () => D.setPresetToggle(d, D.presetToggle(d) !== true) }, 'swap') : null));
  }

  function render() {
    const D = awj();
    const used = D.destinations();
    const mismatch = awjMismatch();
    const heads = [...(D.takeMany ? [''] : []), 'Screen', 'Label', 'Transition', 'PGM / PRW',
      ...(D.showsMemory ? ['Memory'] : []), D.takeTimesHead, 'State', ...(D.setTbar ? ['T-bar'] : []), ''];
    return el('div', {},
      el('div', { class: 'view-head' },
        el('h1', { text: 'Screens' }),
        el('span', { class: 'hint', text: awjDialect() === 'mng'
          ? 'Screens and auxiliaries in service, and the transition each is holding'
          : 'Screens in use, and the transition each is holding' })),
      mismatch ? el('div', { class: 'panel' }, el('div', { class: 'hint bad pad', text: mismatch })) : null,
      el('div', { class: 'panel' },
        awjLiveRow('transition changes'),
        D.takeMany && used.length ? (() => {
          const sel = used.filter(d => picked.has(d.id));
          const pick = (ds) => { picked = new Set(ds.map(d => d.id)); store.notify(); };
          return el('div', { class: 'row wrap' },
            el('button', { class: 'btn pgm', onclick: () => D.takeMany(used) }, `Take all (${used.length})`),
            el('button', { class: 'btn pgm', disabled: !sel.length, onclick: () => D.takeMany(sel) }, `Take selected (${sel.length})`),
            el('button', { class: 'btn ghost', disabled: !sel.length, onclick: () => { for (const d of sel) D.cut(d); } }, 'Cut selected'),
            D.setTbar ? el('input', { class: 'tbar', type: 'range', min: 0, max: 65535, step: 1, value: sel.length ? (D.tbar(sel[0]) ?? 0) : 0, disabled: !sel.length, title: 'T-bar over the selected destinations',
              onpointerdown: beginDrag, onpointerup: endDrag, onpointercancel: endDrag,
              oninput: (e) => { for (const d of sel) D.setTbar(d, +e.target.value); } }) : null,
            el('div', { class: 'seg' },
              el('button', { onclick: () => pick(used) }, 'All'),
              el('button', { onclick: () => pick(used.filter(d => d.kind === 'screen')) }, 'Screens'),
              el('button', { onclick: () => pick(used.filter(d => d.kind === 'aux')) }, 'Auxes'),
              el('button', { onclick: () => pick([]) }, 'None')),
            el('span', { class: 'hint', text: 'Tick destinations to take, cut or T-bar them as one group; each keeps its own take time.' }));
        })() : null,
        D.quickPreset && used.length ? quickPresetRow(D, used) : null,
        used.length
          ? el('table', { class: 'grid' },
              el('thead', {}, el('tr', {}, ...heads.map(h => el('th', { text: h })))),
              el('tbody', {}, ...used.map(row)))
          : el('div', { class: 'hint pad', text: store.connected
              ? (mismatch ? 'Nothing this surface can drive answered.' : 'No screen on this device is in use.')
              : 'Waiting for the processor.' })));
  }

  return { enter, render };
})();

// ---------- AWJ: Presets ----------
VIEWS.lppresets = (() => {
  let pages = {};                // bank kind -> how much of it has been asked for
  let bankKind = 'screen';
  let target = 'PREVIEW';
  let dest = null;               // destination id; null = every one in service of the bank's kind
  let mode = 'recall';           // 'recall' | 'save' | 'erase' | 'label' — the last three only where the dialect writes
  let armed = null;              // slot awaiting a second tap (erase) or a label (label)
  let labelDraft = '';

  const bank = () => awj().banks.find(b => b.kind === bankKind) || awj().banks[0];
  const pagesOf = (b) => pages[b.kind] ?? (b.kind === 'screen' ? 1 : 0);
  const candidates = (b) => awj().destinations().filter(d => d.kind === b.targets);

  function fetchPage(b, page) {
    const from = page * AWJ_PRESET_PAGE + 1;
    for (let n = from; n < from + AWJ_PRESET_PAGE && n <= b.slots; n++) awj().fetchSlot(b, n);
  }

  function pickBank(kind) {
    bankKind = kind;
    dest = null;
    blocked = '';
    const b = bank();
    // The screen bank's first page comes with the connect-time inventory;
    // the others are read when first shown. The master bank's occupancy
    // check needs the aux bank's first page too.
    if (pagesOf(b) === 0) { fetchPage(b, 0); pages[b.kind] = 1; }
    if (b.targets === 'none') for (const o of awj().banks) if (pagesOf(o) === 0) { fetchPage(o, 0); pages[o.kind] = 1; }
    store.notify();
  }

  function enter() {
    if (!awj().banks.some(b => b.kind === bankKind)) bankKind = awj().banks[0].kind;
    if (awjDialect() === 'mng') mngSaveFilters.reset();
  }

  function recall(slot) {
    const b = bank();
    const D = awj();
    if (b.targets === 'none') {
      D.recall(b, slot, null, target);
      const all = D.destinations();
      for (const d of all) D.refresh(d);
      setTimeout(() => { for (const d of all) D.refresh(d); }, 300);
      return;
    }
    const dests = dest === null ? candidates(b) : [awjDest(dest)];
    // Recalls are silent — the device answers a write with nothing — so the
    // surface reads the affected destination back rather than assuming it
    // landed. Twice: the load takes a few tens of milliseconds, and a read
    // that arrives inside that window sees the buffer's old memory.
    for (const d of dests) {
      D.recall(b, slot, d, target);
      D.refresh(d);
    }
    setTimeout(() => { for (const d of dests) D.refresh(d); }, 300);
  }

  // A write is silent, so the slot and the destinations it touches are read
  // back — after a beat, as the recall does.
  function afterWrite(b, n) {
    const D = awj();
    const re = () => { D.fetchSlot(b, n); for (const d of D.destinations()) D.refresh(d); };
    re(); setTimeout(re, 300);
  }
  let blocked = '';              // why the last master save did not fire
  function save(n) {
    const b = bank(), D = awj();
    if (b.targets === 'none') {
      blocked = '';
      if (target !== 'EXISTING' && D.masterSaveTouches) {
        const busy = D.masterSaveTouches(n).filter(x => x.occupied);
        if (busy.length) {
          blocked = `Not saved: a master save from ${target.toLowerCase()} also stores each destination into its own bank at slot ${n}, and ${busy.map(x => `${x.bank.label.toLowerCase()} slot ${n}`).filter((v, i, arr) => arr.indexOf(v) === i).join(' and ')} already hold${busy.length === 1 ? 's' : ''} something. Pick a master slot whose screen and aux slots are free, erase them, or save from existing memories.`;
          store.notify();
          return;
        }
      }
      D.save(b, n, null, target); afterWrite(b, n);
      // The bank slots it wrote too, so the marks and labels follow — after
      // the same beat, since the device fills them as part of the save.
      if (target !== 'EXISTING') setTimeout(() => { for (const x of D.masterSaveTouches?.(n) ?? []) D.fetchSlot(x.bank, n); }, 300);
      return;
    }
    const dests = dest === null ? candidates(b) : [awjDest(dest)];
    // One buffer of ONE destination goes into a slot; saving "every screen"
    // into one slot would just be the last one written.
    const d = dests.length === 1 ? dests[0] : null;
    if (!d) return;
    D.save(b, n, d, target);
    afterWrite(b, n);
  }
  function tap(n) {
    const b = bank(), D = awj();
    const valid = D.presetValid(b, n) === true;
    if (mode === 'recall') { if (valid) recall(n); return; }
    if (mode === 'save') { save(n); return; }
    if (mode === 'label') { armed = n; labelDraft = D.presetLabel(b, n) || ''; store.notify(); return; }
    if (mode === 'erase') {
      if (!valid) return;
      if (armed !== n) { armed = n; store.notify(); return; }
      D.erase(b, n); armed = null; afterWrite(b, n); store.notify();
    }
  }

  function slotTile(b, n) {
    const D = awj();
    const valid = D.presetValid(b, n) === true;
    const label = D.presetLabel(b, n);
    // Which buffers of the chosen destination hold this memory, where the
    // model says so.
    const d = dest !== null ? awjDest(dest) : null;
    const on = d ? ['program', 'preview'].filter(w => D.memoryOn(d, w) === n) : [];
    const saveable = mode === 'save' && (b.targets === 'none' || dest !== null);
    const titles = {
      recall: valid ? `Recall ${n} to ${target.toLowerCase()}` : `Slot ${n} is empty`,
      save: saveable ? `Save ${target.toLowerCase()} into slot ${n}${valid ? ' (overwrites)' : ''}` : 'Pick one destination to save from',
      erase: valid ? (armed === n ? `Tap again to erase slot ${n}` : `Erase slot ${n}`) : `Slot ${n} is empty`,
      label: `Label slot ${n}`,
    };
    return el('button', {
      class: 'slot' + (valid ? ' valid' : '') + (on.includes('program') ? ' pgm' : on.includes('preview') ? ' pvw' : '') + (armed === n ? ' sel' : ''),
      disabled: mode === 'recall' || mode === 'erase' ? !valid : mode === 'save' ? !saveable : false,
      title: titles[mode],
      onclick: () => tap(n),
    },
      el('span', { class: 'num', text: String(n) }),
      valid ? el('span', { class: 'lbl', text: label || 'preset' }) : null);
  }

  function render() {
    const D = awj();
    const b = bank();
    const shown = Math.min(b.slots, Math.max(1, pagesOf(b)) * AWJ_PRESET_PAGE);
    const slots = [];
    for (let n = 1; n <= shown; n++) slots.push(slotTile(b, n));
    const cands = candidates(b);
    const kindWord = b.targets === 'aux' ? 'auxiliary' : 'screen';
    return el('div', {},
      el('div', { class: 'view-head' },
        el('h1', { text: 'Presets' }),
        el('span', { class: 'hint', text: 'Preset banks — a slot the device reports as empty cannot be recalled' })),
      el('div', { class: 'panel' },
        D.banks.length > 1
          ? el('div', { class: 'row' },
              el('div', { class: 'seg' },
                ...D.banks.map(k => el('button', { class: k.kind === b.kind ? 'on recall' : '', onclick: () => pickBank(k.kind) }, `${k.label} · ${k.slots}`))))
          : null,
        D.save ? el('div', { class: 'row' },
          el('div', { class: 'seg' },
            ...[['recall', 'Recall', 'recall'], ['save', 'Save', 'save'], ['erase', 'Erase', 'take'], ['label', 'Label', 'recall']].map(([m, t, cls]) =>
              el('button', { class: mode === m ? 'on ' + cls : '', onclick: () => { mode = m; armed = null; blocked = ''; if (m !== 'save' && target === 'EXISTING') target = 'PREVIEW'; store.notify(); } }, t))),
          el('span', { class: 'hint', text: {
            recall: 'Tap a slot to recall it.',
            save: b.targets === 'none' ? 'Tap a slot to record every screen and auxiliary from ' + target.toLowerCase() + '.' : 'Tap a slot to save the chosen destination\u2019s ' + target.toLowerCase() + ' into it.',
            erase: 'Tap a slot, then tap it again to erase it.',
            label: 'Tap a slot to name it.',
          }[mode] })) : null,
        el('div', { class: 'row' },
          el('label', { text: mode === 'save' ? 'From ' : 'To ' }),
          el('select', {
            onchange: (e) => { target = e.target.value; blocked = ''; store.notify(); },
          }, ...['PREVIEW', 'PROGRAM', ...(mode === 'save' && b.targets === 'none' ? ['EXISTING'] : [])].map(v =>
            el('option', { value: v, selected: v === target, text: v === 'EXISTING' ? 'the memories each buffer already holds' : v.toLowerCase() }))),
          b.targets === 'none'
            ? el('span', { class: 'hint', text: 'A master preset recalls every screen and auxiliary it recorded.' })
            : el('label', { text: ' on ' }),
          b.targets === 'none' ? null : el('select', {
            onchange: (e) => { dest = e.target.value === 'all' ? null : e.target.value; store.notify(); },
          },
            el('option', { value: 'all', selected: dest === null, text: `every ${kindWord} in service` }),
            ...cands.map(d => el('option', { value: d.id, selected: d.id === dest, text: `${d.id} ${D.label(d) || ''}`.trim() })))),
        mode === 'save' && b.targets === 'none' && target !== 'EXISTING'
          ? el('div', { class: 'hint pad', text: `A master save from ${target.toLowerCase()} also stores every screen and auxiliary in service into its own bank, at the same slot number as the master. Slots already in use block the save.` })
          : null,
        blocked ? el('div', { class: 'hint bad pad', text: blocked }) : null,
        mode === 'save' && awjDialect() === 'mng' ? mngSaveFilters.panel(b, dest !== null ? awjDest(dest) : null) : null,
        mode === 'recall' && awjDialect() === 'mng' && b.targets !== 'aux' ? (() => {
          const screens = D.destinations().filter(d => d.kind === 'screen');
          if (!screens.length) return null;
          for (const d of screens) if (store.pval(MNG.presetAutoScale(d.n)) === undefined) store.pget(MNG.presetAutoScale(d.n));
          return el('div', { class: 'row wrap' },
            el('span', { class: 'hint', text: 'Autoscale on load:' }),
            ...screens.map(d => awjToggle(MNG.presetAutoScale(d.n), (on) => `${d.id} ${on ? 'fit' : 'as saved'}`, { small: true, cls: 'primary', title: 'Rescale the memory’s layers to this screen’s canvas on load, or keep them as saved' })),
            el('span', { class: 'hint', text: 'the device’s own flag per screen; a master load honours it for each screen it covers' }));
        })() : null,
        el('div', { class: 'mem-grid' }, ...slots),
        mode === 'label' && armed !== null ? el('div', { class: 'row' },
          el('label', { text: `Slot ${armed} ` }),
          el('input', { type: 'text', maxlength: 64, value: labelDraft, oninput: (e) => { labelDraft = e.target.value; } }),
          el('button', { class: 'btn primary', onclick: () => { D.setLabel(b, armed, labelDraft); afterWrite(b, armed); armed = null; store.notify(); } }, 'Set label'),
          el('button', { class: 'btn ghost', onclick: () => { armed = null; store.notify(); } }, 'Cancel')) : null,
        shown < b.slots
          ? el('div', { class: 'row' },
              el('button', {
                class: 'btn',
                onclick: () => { const p = pagesOf(b); fetchPage(b, p); pages[b.kind] = p + 1; store.notify(); },
              }, `Read slots ${shown + 1}–${Math.min(b.slots, shown + AWJ_PRESET_PAGE)}`),
              el('span', { class: 'hint', text: `The bank holds ${b.slots} slots and each costs two reads, so it is paged rather than read whole.` }))
          : null));
  }

  return { enter, render };
})();

// ---------- Screens ----------
VIEWS.screens = (() => {
  let sel = 0;
  function enter() {
    for (const m of ['SCmly', 'OSsou', 'OUava', 'SCsih', 'SCsiv', 'SCssh', 'SCssv']) if (store.byMnem.has(m)) store.scan(m);
    for (let o = 0; o < outputCount(); o++) fetchLabel('LBOut', [o]);
  }
  // OSsou is indexed by output and names the screen it carries — so the
  // outputs feeding screen s are the ones that answer s, not entry s.
  function outputsFeeding(s) {
    if (!store.byMnem.has('OSsou')) return '·';
    const o = [];
    for (let i = 0; i < outputCount(); i++) if (store.val('OSsou', i) === s && store.val('OUava', i) !== 0) o.push(outputLabel(i));
    return o.length ? o.join(' · ') : '—';
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
        el('td', { class: 'val', text: outputsFeeding(i) }),
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
  // TAopr/TAopw are indexed by SOURCE NUMBER — the same 0..41 space as a
  // layer's PRinp: 0 none, 1–24 inputs, 25–32 stills, 33–40 reduced stills,
  // 41 colour. Confirmed on a NeXtage 16 with inputs 1–4 on air: entries 1–4
  // lit, not 0–3. Index 0 is "no source" and never lights.
  const N = () => store.byMnem.get('TAopr')?.dims[0] || 42;
  const hasTally = () => store.byMnem.has('TAopr');
  function enter() { if (hasTally()) { store.scan('TAopr'); store.scan('TAopw'); } store.scan('INava'); }
  function tile(n) {
    const pgm = store.val('TAopr', n) === 1;
    const pvw = store.val('TAopw', n) === 1;
    const cls = 'tally-tile' + (pgm ? ' pgm' : pvw ? ' pvw' : '') + (sourceAvailable(n) ? '' : ' dim');
    return el('div', { class: cls },
      el('span', { class: 'tally-src', text: sourceName(n) }),
      el('span', { class: 'tally-state', text: pgm ? 'PGM' : pvw ? 'PVW' : '' }));
  }
  function render() {
    if (!hasTally())
      return el('div', {},
        el('div', { class: 'view-head' }, el('h1', { text: 'Tally' })),
        el('div', { class: 'panel' }, el('div', { class: 'empty-state', text: 'This device does not report a tally bus.' })));
    const n = N();
    const nums = Array.from({ length: n - 1 }, (_, i) => i + 1);
    const onPgm = nums.filter(i => store.val('TAopr', i) === 1).length;
    const onPvw = nums.filter(i => store.val('TAopw', i) === 1).length;
    const inputs = nums.filter(i => sourceKind(i) === 'input');
    const others = nums.filter(i => sourceKind(i) !== 'input');
    return el('div', {},
      el('div', { class: 'view-head' }, el('h1', { text: 'Tally' }),
        el('span', { class: 'hint', text: `${onPgm} on program · ${onPvw} on preview` })),
      el('div', { class: 'panel' }, el('h2', 'Inputs'),
        el('div', { class: 'tally-grid' }, ...inputs.map(tile))),
      others.length ? el('div', { class: 'panel' }, el('h2', 'Stills and generators'),
        el('div', { class: 'tally-grid' }, ...others.map(tile))) : null);
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
  // set the output format (and, on Midra, fire the update trigger to apply it). The
  // options are the device's own list — the device's max decides how many there are,
  // and enumLabels pads with plain numbers if a firmware ever offers more than we name.
  function formatSelect() {
    const cur = store.val('OUfor', sel) ?? 0;
    const s = el('select', { onchange: (e) => { store.set('OUfor', [sel], +e.target.value); if (store.byMnem.has('OUfru')) store.set('OUfru', [sel], 1); } });
    outputFormatNames().forEach((name, i) => { const o = el('option', { value: i, text: name }); if (i === cur) o.selected = true; s.append(o); });
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
      el('td', { class: 'val', text: outputFormatName(store.val('OUfst', i)) }),
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
        store.byMnem.has('OUrat') ? el('label', { class: 'field' }, 'Rate', enumSelect('OUrat', i, outputRateNames())) : null,
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
// VOfor / VOfst 0..13 — RCS2's ENUM_VIDEO_OUT_FORMAT, which is what it declares VIDOUT_FORMAT
// over (SDTV_PAL … EDTV_576P_16_9, default SDTV_PAL). The first ten entries are the output
// format list's own first ten, which is why VOfst tracks OUfor[0] index for index in the
// mirror modes. Not the SD-standards list this once carried: that was an input enumeration.
const VIDEO_OUT_FORMATS = ['SDTV PAL 4/3', 'SDTV NTSC 4/3', 'EDTV 480p 4/3', 'EDTV 576p 4/3',
  'HDTV 720p', 'HDTV 1035i', 'HDTV 1080i', 'HDTV 1080p', 'HDTV 1080sF', 'DCDM 2048×1080',
  'SDTV PAL 16/9', 'SDTV NTSC 16/9', 'EDTV 480p 16/9', 'EDTV 576p 16/9'];

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
        // VIDOUT_RATE is declared 23.97…60 Hz (the first ten Midra rates), default 50 Hz.
        store.byMnem.has('VOrat') ? el('label', { class: 'field' }, 'Rate', enumSelect('VOrat', [], enumLabels('VOrat', MIDRA_OUTPUT_RATES.slice(0, 10)))) : null,
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
        const mark = store.errCount;
        store.get('PSlov', [0]);
        setTimeout(() => {
          const failed = store.errCount > mark;
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
      (store.val('Slval', sel) || 0) > 0 ? confirmBtn(`still-erase-${sel}`, 'Erase', 'Tap again to erase', () => { store.set('SLera', [sel], 1); store.scan('Slval'); }, 'btn') : null) : null;
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
    store.scan('INava'); store.scan('SCmly');
    for (let s = 0; s < screenCount(); s++) fetchLabel('LBScr', [s]);
  }
  // STcso is the device's STILLS_CAPTURE_SOURCE list — 0–23 inputs 1–24, 24–31
  // screens 1–8 — not the layer source numbering (which starts at "none").
  const capName = n => n < 24 ? (inputLabel(n) || 'IN ' + (n + 1)) : n < 32 ? screenLabel(n - 24) : 'Src ' + n;
  function captureSourceSelect(max) {
    const cur = store.val('STcso') ?? 0;
    const s = el('select', { onchange: (e) => store.set('STcso', [], +e.target.value) });
    for (let i = 0; i <= max; i++) {
      if (i < 24 && store.val('INava', i) === 0 && i !== cur) continue;
      if (i >= 24 && !(store.val('SCmly', i - 24) > 0) && i !== cur) continue;
      const o = el('option', { value: i, text: capName(i) }); if (i === cur) o.selected = true; s.append(o);
    }
    return s;
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
            el('label', { class: 'field' }, 'Source', captureSourceSelect(srcMax)),
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
    // for the source names: which inputs are fitted, which screens are in use, and their labels
    for (const m of ['INava', 'SCmly', 'INplg']) if (store.byMnem.has(m)) store.scan(m);
    for (let s = 0; s < screenCount(); s++) fetchLabel('LBScr', [s]);
    for (let i = 0; i < inputCount(); i++) if (store.val('INava', i) !== 0) fetchLabel('LBInp', [i, store.val('INplg', i) ?? 0]);
    for (let mem = 0; mem < 8; mem++) { store.get('MMouw', [mem]); store.get('MMouh', [mem]); }
  }
  const outSize = () => [store.val('MOshs', out) || 1920, store.val('MOsvs', out) || 1080];
  // MONITORING_ELEMENT_SOURCES, the device's own list: 0–23 inputs 1–24 (there
  // is no "none" — 0 is input 1), 24–31 frames, 32–39 logos, 40–47 each
  // screen's program, 48–55 each screen's preview.
  const monName = n => n == null ? '·'
    : n < 24 ? (inputLabel(n) || 'IN ' + (n + 1))
    : n < 32 ? (stillLabel(n - 24) || 'Frame ' + (n - 23))
    : n < 40 ? (rstillLabel(n - 32) || 'Logo ' + (n - 31))
    : n < 48 ? screenLabel(n - 40) + ' program'
    : n < 56 ? screenLabel(n - 48) + ' preview'
    : 'Src ' + n;
  function monSource(mnem, idx) {
    const cur = store.val(mnem, ...idx) ?? 0;
    const s = el('select', { onchange: (e) => { store.set(mnem, idx, +e.target.value); } });
    for (let i = 0; i <= 55; i++) {
      if (i < 24 && store.val('INava', i) === 0 && i !== cur) continue;   // no card in that slot
      if (i >= 40 && i < 56 && !(store.val('SCmly', i < 48 ? i - 40 : i - 48) > 0) && i !== cur) continue;   // screen not in use
      const o = el('option', { value: i, text: monName(i) }); if (i === cur) o.selected = true; s.append(o);
    }
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
        el('span', { class: 'lrect-tag', text: `${w + 1}${src ? ' · ' + monName(src) : ''}` }));
      cv.append(box);
      if (w === sel) selectionChrome(cv, box, (e, c, b) => dragResize(e, w, scale, c, b));
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
  function dragResize(e, w, scale, corner, box) {
    e.preventDefault(); e.stopPropagation(); beginDrag(); sel = w;
    const sx = e.clientX, sy = e.clientY, r0 = rectPx(w);
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
    midraEditMode();
    // a Midra's frame layer shows the loaded frames, so their validity is what makes a number usable there
    if (isMidra()) { store.get('CTpmu', []); store.scan('GCtba'); store.scan('GCtav'); if (store.byMnem.has('PSfrv')) store.scan('PSfrv'); }
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
            flash(`${sourceNameFor(src, l)} did not go on ${layerName(l)} — ${why}`);
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
  function dragResize(e, s, c, l, cv, sw, sh, corner, box) {
    e.preventDefault(); e.stopPropagation(); beginDrag(); select(s, c, l);
    const sx = e.clientX, sy = e.clientY;
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
        // background-color, not the shorthand: `background:` also resets size and
        // repeat inline, which outranks .shot's `cover` and tiles the thumbnail
        style: `background-color:${n === 0 ? 'var(--line-hi)' : srcColor(n)}`
             + (snap ? `;background-image:url("${snap}")` : ''),
      }),
      el('span', { class: 'src-nm', text: name }),
      n ? el('span', { class: 'src-ix', text: srcBadge(n, kind) }) : null);
  }
  function srcBadge(n, kind) {
    if (isMidra()) return n >= srcMaxOf() ? 'COL' : 'IN' + n;
    if (kind === 'still') return 'FR' + (n - 24);
    if (kind === 'rstill') return 'LG' + (n - 32);
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
        el('div', { class: 'ws-rail-foot hint', text: armed != null ? `${sourceName(armed)} armed` : 'Drag onto a layer' }),
        el('div', { class: 'ws-rail-foot hint', text: 'On the Frame layer a number is the loaded frame of that number; on a PiP it is the input.' }));
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
        // background-color, not the shorthand — see srcTile
        style: `background-color:${srcColor(src)};z-index:${l + 1};opacity:${Math.max(0.15, alpha)}`
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
        el('span', { class: 'lrect-tag' + (missing ? ' bad' : ''), text: `${layerName(l)}${src ? ' · ' + sourceNameFor(src, l) : ''}${missing ? ' ⚠' : ''}` }));
      asPct(box, r, sw, sh);
      cv.append(box);
      if (isSel) selectionChrome(cv, box, (e, cn, b) => dragResize(e, s, c, l, cv, sw, sh, cn, b));
    }
    const broken = assignedLayers(s, c).filter(l => !sourceAvailable(store.val('PRinp', s, c, l)));
    return el('div', { class: 'ws-ctx ws-ctx-' + role },
      el('div', { class: 'ws-ctx-head' },
        el('span', { class: 'ws-ctx-tag ' + role }, ctxName(s, c)),
        role === 'pgm' ? el('span', { class: 'ws-onair', text: 'ON AIR' }) : null,
        broken.length ? el('button', {
          class: 'ws-warn',
          title: `${broken.map(l => layerName(l) + ' · ' + sourceNameFor(store.val('PRinp', s, c, l), l)).join(', ')} — the source is not available, so a take will not land. Click to clear them.`,
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
        title: src ? `${layerName(l)} · ${sourceNameFor(src, l)}` : `${layerName(l)} — empty`,
        ...dropTarget((e) => {
          const n = droppedSource(e);
          if (n == null || Number.isNaN(n)) return;
          assign(s, c, l, n);
        }),
        onclick: () => { if (armed != null) assign(s, c, l, armed); else select(s, c, l); },
      }, isMidra() ? layerName(l).replace('PiP ', 'P').replace('Frame', 'FR').replace('Logo ', 'LG') : `L${l + 1}`));
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
        el('h2', layerName(l)),
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
      // saving over a memory that is in use is as final as erasing it
      valid ? confirmBtn(`ws-save-${isMaster ? 'm' : 's'}-${i}`, 'Save here', 'Tap again to overwrite', () => isMaster ? saveMaster(i) : saveScreenMem(i), 'btn save')
            : el('button', { class: 'btn save', onclick: () => isMaster ? saveMaster(i) : saveScreenMem(i) }, 'Save here'),
      valid ? confirmBtn(`ws-erase-${isMaster ? 'm' : 's'}-${i}`, 'Erase', 'Tap again to erase', () => eraseMem(i, isMaster)) : null);
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
        used ? confirmBtn(`ws-midra-save-${memSel}`, 'Save here', 'Tap again to overwrite', () => saveMidra(memSel), 'btn save')
             : el('button', { class: 'btn save', onclick: () => saveMidra(memSel) }, 'Save here'),
        used && store.byMnem.has('CTpmr') ? confirmBtn(`ws-midra-erase-${memSel}`, 'Erase', 'Tap again to erase',
          () => { store.set('CTpmr', [memSel], 1); setTimeout(() => store.get('PMpst', [memSel]), 400); flash(`Erased preset ${memSel + 1}`); }) : null) : null);
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
    midraEditMode();
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
      const mark = store.errCount;
      store.get('AUile', [0]);
      setTimeout(() => {
        inputs = store.errCount === mark;
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
// ================= Pulse PLS300 =================
// The generation before Midra, on the same port with the same framing and
// one- or two-letter mnemonics. One screen, two outputs (main and preview),
// ten inputs numbered 1–6 and 9–12, and a preset grid: every PE_* variable is
// indexed [preset, layer], the presets being 0 = current (on air), 1 = next
// (preview), 2 = previous and 3–6 = the four user presets. A TAKE makes next
// current. Everything below is spelled from the published Programmer's Guide
// and has been driven only against a table-derived fixture — no PLS300 has
// answered openrcs yet. See docs/NOTES.md before trusting any of it live.
const isPls = () => store.meta?.platform === 'pls300';
const PLS_MODELS = { 78: 'PLS300' };
const PLS = { CUR: 0, NEXT: 1, PREV: 2, MEM: 3 };     // preset slots on index 1
const PLS_PRESET_NAMES = ['Current', 'Next', 'Previous', 'Preset 1', 'Preset 2', 'Preset 3', 'Preset 4'];
// Layer slots on index 2, mixer mode. Slots 4 and 5 are unassigned on this
// model and 8 and 9 carry the two audio outputs, so none of those is drawn.
// Matrix mode re-labels slot 1 and 3 as output 2's frame and live layer; the
// table carries no variable that says which mode the unit is in, so the
// surface draws the mixer layout and says so.
const PLS_LAYERS = [
  { l: 0, tag: 'FRAME', name: 'Background frame', kind: 'frame' },
  { l: 2, tag: 'BG', name: 'Background live', kind: 'live' },
  { l: 3, tag: 'PIP', name: 'PiP 1', kind: 'live' },
  { l: 6, tag: 'LOGO 1', name: 'Logo 1', kind: 'logo' },
  { l: 7, tag: 'LOGO 2', name: 'Logo 2', kind: 'logo' },
];
const plsLayer = (l) => PLS_LAYERS.find(x => x.l === l);
// The twelve-wide input tables have no input 7 or 8: the unit has ten.
const PLS_INPUT_SLOTS = [0, 1, 2, 3, 4, 5, 8, 9, 10, 11];
const plsInputNo = (slot) => slot + 1;      // what the operator sees, and IN's value
const PLS_POS_BIAS = 32768;                  // pH/pV: 32768 = the output's left/top edge
// The guide's own value tables, as [value, label] pairs because several skip
// numbers. Labels are the guide's words with its typos and French corrected.
const PLS_ENUMS = {
  iK: [[0, 'SDTV composite'], [1, 'SDTV Y/C'], [2, 'RGBS TTL/analog'], [3, 'RGB SOG'], [4, 'YUV'], [5, 'Computer SOG'], [6, 'Computer H&V or composite'], [7, 'Computer B&W'], [8, 'DVI-D video RGB 16–235'], [9, 'DVI-D video YUV'], [10, 'DVI-D computer RGB 0–255'], [11, 'DVI-D computer RGB 16–235'], [12, 'SDI'], [13, 'Analog computer, H&V'], [14, 'Analog computer, composite TTL'], [15, 'Analog computer, composite analog'], [16, 'Analog RGB video, composite TTL'], [17, 'Analog RGB video, composite analog']],
  sF: [[0, 'None'], [1, 'Invalid'], [2, 'Unknown'], [3, 'NTSC'], [4, 'PAL'], [5, 'SECAM'], [6, 'B&W'], [7, '480i'], [8, '576i'], [9, '480p'], [10, '576p'], [11, '720p'], [12, '1035i'], [13, '1080i'], [14, '1080p'], [15, '1080sF'], [16, 'VGA'], [17, '800×480'], [18, 'WVGA'], [19, 'SVGA'], [20, '1280×600'], [21, '720p RGB'], [22, 'XGA'], [23, 'WXGA'], [24, 'SWXGA'], [25, '800p RGB'], [26, 'SWXGA+'], [27, '1152×864'], [28, '900p RGB'], [29, '1600×900'], [30, '960p RGB'], [31, 'SXGA'], [32, '1360×1024'], [33, 'D-ILA 4:3'], [34, 'SXGA+'], [35, 'WSXGA+'], [36, '1080p RGB'], [37, '2K'], [38, 'UXGA'], [39, 'WUXGA'], [40, '1920×1440'], [41, 'QXGA'], [42, '1366×768']],
  OF: [[0, 'PAL'], [1, 'NTSC'], [2, '480p'], [3, '576p'], [4, '720p (SMPTE 296M)'], [5, '1035i (SMPTE 260M)'], [6, '1080i (SMPTE 274M)'], [7, '1080p (SMPTE 274M)'], [8, '1080sF (SMPTE 274M)'], [9, '640×480'], [10, '848×480'], [11, '800×600'], [12, '1024×768'], [13, '1360×768'], [14, '1280×800'], [15, '1280×1024'], [16, '1400×1050'], [17, '1680×1050'], [18, '1600×1200'], [19, '1920×1200'], [20, '2048×1080'], [21, '1280×720'], [22, '1920×1080'], [23, '1920×1080 HD'], [24, '1920×1080 B'], [25, '1920×1080 C'], [26, '1440×900'], [27, '1280×768'], [28, '1366×800'], [29, '1366×768'], [30, 'Custom 1'], [31, 'Custom 2'], [32, 'Custom 3'], [33, 'Custom 4'], [34, 'Custom 5'], [35, 'Custom 6'], [36, 'Custom 7'], [37, 'Custom 8']],
  OR: [[0, 'Custom'], [1, '23.97 Hz'], [2, '24 Hz'], [3, '25 Hz'], [4, '29.97 Hz'], [5, '30 Hz'], [6, '50 Hz'], [7, '59.94 Hz'], [8, '60 Hz'], [9, '72 Hz'], [10, '75 Hz'], [11, '85 Hz'], [12, '100 Hz']],
  OC: [[0, 'Black'], [1, 'Navy blue'], [2, 'Blue'], [3, 'Green blue'], [4, 'Water blue'], [5, 'Turquoise'], [6, 'Dark green'], [7, 'Green'], [8, 'Lime'], [9, 'Light green'], [10, 'Dark red'], [11, 'Red'], [12, 'Tomato'], [13, 'Bordeaux'], [14, 'Brown'], [15, 'Chocolate'], [16, 'Orange'], [17, 'Gold'], [18, 'Yellow'], [19, 'Indigo'], [20, 'Purple'], [21, 'Light red'], [22, 'Fuchsia'], [23, 'Salmon'], [24, 'Rose'], [25, 'Olive green'], [26, 'Grey'], [27, 'Silver'], [28, 'Lavender'], [29, 'Beige'], [30, 'Azure'], [31, 'White'], [32, 'Custom (HSL below)']],
  OP: [[0, 'No pattern'], [1, 'Vertical grey scale'], [2, 'Horizontal grey scale'], [3, 'Vertical colour bars'], [4, 'Horizontal colour bars'], [5, 'Grid'], [6, 'SMPTE'], [7, 'Burst'], [8, 'Centering']],
  OA: [[0, 'RGBs'], [1, 'RGsB (SOG)'], [2, 'RGB H&V'], [3, 'YUV']],
  OD: [[0, 'RGB 0–255 (full)'], [1, 'RGB 16–235 (reduced)'], [2, 'YUV']],
  OS: [[0, 'H− V−'], [1, 'H− V+'], [2, 'H+ V−'], [3, 'H+ V+']],
  oT: [[0, 'Cut'], [1, 'Clean cut'], [2, 'Fade'], [3, 'Slide'], [4, 'Wipe']],
  oW: [[0, 'Left → right'], [1, 'Right → left'], [2, 'Bottom → top'], [3, 'Top → bottom'], [4, 'Vertical from/to centre'], [5, 'Horizontal from/to centre'], [6, 'Both from/to centre'], [7, 'SW → NE'], [8, 'SE → NW'], [9, 'NW → SE'], [10, 'NE → SW']],
  EF: [[0, 'VGA'], [1, '800×480'], [2, 'WVGA'], [3, 'SVGA'], [4, '720p RGB'], [5, 'XGA'], [6, 'WXGA'], [7, 'SWXGA'], [8, '800p RGB'], [9, '1152×864'], [10, '900p RGB'], [11, '1600×900'], [12, '960p RGB'], [13, 'SXGA'], [14, '1360×1024'], [15, 'SXGA+'], [16, 'WSXGA+'], [17, '1080p RGB'], [18, '2K'], [19, 'UXGA'], [20, 'WUXGA'], [21, 'Custom']],
  ER: [[0, '50 Hz'], [1, '60 Hz'], [2, '72 Hz'], [3, '75 Hz'], [4, '85 Hz'], [5, 'Custom']],
  KT: [[0, 'No keying'], [1, 'Luma key'], [2, 'Chroma key'], [3, 'Luma key + DSK'], [4, 'Chroma key + DSK']],
  PM: [[0, 'Normal'], [1, 'Recall'], [2, 'Record logo'], [3, 'Record animated logo'], [4, 'Record frame'], [5, 'Delete']],
  PE: [[0, 'Free'], [1, 'Recalling'], [2, 'Storing'], [3, 'Format not compliant with the output'], [4, 'Deleting'], [5, 'Flash access error']],
  PX: [[0, 'None'], [1, 'Logo 1'], [2, 'Logo 2'], [3, 'Logo 3'], [4, 'Logo 4'], [5, 'Logo 5'], [6, 'Logo 6'], [9, 'Frame 1'], [10, 'Frame 2'], [11, 'Frame 3'], [12, 'Frame 4'], [13, 'Frame 5'], [14, 'Frame 6']],
  Xr: [[0, 'Analog input 1'], [1, 'Analog input 2'], [2, 'Analog input 3'], [3, 'Analog input 4'], [4, 'Analog input 5'], [5, 'Analog input 6'], [8, 'DVI input 1'], [9, 'DVI input 2'], [10, 'SDI input 1'], [11, 'SDI input 2'], [14, 'Back end 1'], [15, 'Back end 2']],
  Xm: [[0, 'Internal'], [1, 'Follow ×½'], [2, 'Follow ×1'], [3, 'Follow ×2'], [4, 'Follow ×3'], [5, 'Asynchronous follow']],
  si: [[0, '4:3 full screen'], [1, '4:3 carrying 16:9, letterboxed'], [2, '4:3 carrying 2.35, letterboxed'], [3, '4:3 carrying 16:9, no bars'], [4, '16:9 carrying 4:3, pillarboxed']],
  so: [[0, 'Stretch to fit'], [1, 'Keep aspect, add bars'], [2, 'Keep aspect, crop'], [3, 'Keep aspect, no scaling']],
  iS: [[0, 'Auto'], [1, 'NTSC (M, J)'], [2, 'PAL (B, D, G, H, I, N)'], [3, 'PAL (M)'], [4, 'PAL (N combination)'], [5, 'NTSC 4.43'], [6, 'SECAM'], [7, 'PAL 60']],
  CK: [[0, 'None'], [1, 'Auto centering'], [2, 'Auto setting'], [3, 'Standby'], [4, 'Picture recording'], [5, 'Factory reset'], [6, 'User settings reset']],
  TI: [[0, 'One-shot take'], [1, 'Two-shot take'], [2, 'Sequenced take']],
  NQ: [[14, 'Live + PiP top left'], [15, 'Live + PiP top right'], [16, 'Live + PiP bottom left'], [17, 'Live + PiP bottom right'], [18, 'Frame + 2 PiPs side by side'], [19, 'Frame + 2 PiPs stacked']],
  bS: [[0, 'None'], [1, 'Coloured edge']],
  wR: [[0, '1200 baud'], [1, '2400 baud'], [2, '9600 baud'], [3, '19200 baud']],
  nt: [[0, 'UDP'], [1, 'TCP'], [2, 'AMX']],
  YK: [[0, 'Unlocked'], [1, 'Menu locked'], [2, 'Front panel locked']],
};
const plsEnumLabel = (m, v) => v == null ? '·' : (PLS_ENUMS[m]?.find(([n]) => n === v)?.[1] ?? String(v));
// A <select> over one of the gapped enums above.
function plsEnumSelect(mnem, idx, pairs = PLS_ENUMS[mnem]) {
  const cur = store.val(mnem, ...idx);
  const s = el('select', { onchange: (e) => store.set(mnem, idx, +e.target.value) });
  for (const [v, label] of pairs) {
    const opt = el('option', { value: v, text: label });
    if (v === cur) opt.selected = true;
    s.append(opt);
  }
  // A value the table names nowhere is still shown rather than snapped to the
  // first option, which would write a different one back on the next change.
  if (cur != null && !pairs.some(([v]) => v === cur)) s.append(el('option', { value: cur, text: String(cur), selected: true }));
  return s;
}
const plsKv = (label, value) => el('div', { class: 'kv' }, el('span', { class: 'k', text: label }), typeof value === 'string' ? el('span', { class: 'v val', text: value }) : value);
const plsHz = (v) => v == null || v === 0 ? '·' : (v / 100).toFixed(2) + ' Hz';
const plsInputHasSignal = (slot) => store.val('sc', slot) === 1 && (store.val('sF', slot) ?? 0) > 2;
// The choices for a layer's IN, by what the slot carries: an input number for
// a live layer, a frame or logo number otherwise (their validity bitfields
// PF / PZ say which exist).
function plsSourceOptions(kind, cur) {
  const out = [[0, '— none —']];
  if (kind === 'live') {
    for (const slot of PLS_INPUT_SLOTS) {
      const n = plsInputNo(slot);
      const off = store.val('iu', slot) === 0;
      out.push([n, `IN ${n}` + (off ? ' — disabled' : plsInputHasSignal(slot) ? '' : ' — no signal')]);
    }
  } else {
    const bits = store.val(kind === 'frame' ? 'PF' : 'PZ') ?? 0;
    for (let n = 1; n <= 6; n++) out.push([n, `${kind === 'frame' ? 'Frame' : 'Logo'} ${n}` + (flagOn(bits, n - 1) ? '' : ' — empty')]);
  }
  if (cur != null && !out.some(([v]) => v === cur)) out.push([cur, String(cur)]);
  return out;
}
function plsSourceName(kind, v) {
  if (v == null) return '·';
  if (v === 0) return '— none —';
  return kind === 'live' ? `IN ${v}` : `${kind === 'frame' ? 'Frame' : 'Logo'} ${v}`;
}
// Every writable per-layer variable, off the table: the PE_* group is exactly
// the [7, 10] grid, so a preset copy or a fixture covers a newly added leaf
// without a list to maintain.
function plsPresetVars() {
  const out = [];
  for (const [m, def] of store.byMnem) if (def.group === 'GRP_PRESET_ELEMENT' && !def.ro) out.push(m);
  return out;
}
function plsFetchPreset(p) { for (const m of plsPresetVars()) for (const { l } of PLS_LAYERS) store.get(m, [p, l]); }
// Preset copy is the unit's memory verb: COPY_FROM, COPY_TO, then COPY_CTRL
// fires it. Recall is a copy into next; save is a copy out of current or next.
function plsCopy(from, to) { store.set('Nf', [], from); store.set('Nt', [], to); store.set('Nc', [], 1); }
function plsTake() { CONFIDENCE.autoSnapshot('before take'); store.set('TK', [], 1); }
// Position and size, in output pixels, of one layer of one preset.
function plsRect(p, l) {
  return {
    left: (store.val('pH', p, l) ?? PLS_POS_BIAS) - PLS_POS_BIAS,
    top: (store.val('pV', p, l) ?? PLS_POS_BIAS) - PLS_POS_BIAS,
    w: store.val('pW', p, l) ?? 0,
    h: store.val('pS', p, l) ?? 0,
  };
}
function plsSetRect(p, l, r) {
  throttledSet('pH', [p, l], Math.round(r.left + PLS_POS_BIAS));
  throttledSet('pV', [p, l], Math.round(r.top + PLS_POS_BIAS));
  throttledSet('pW', [p, l], Math.max(0, Math.round(r.w)));
  throttledSet('pS', [p, l], Math.max(0, Math.round(r.h)));
}
const plsOutputPx = (o = 0) => ({ w: store.val('OH', o) || 1600, h: store.val('OV', o) || 1200 });

// A preview of one preset: the layer rectangles over the main output, to scale.
function plsPresetCanvas(p, width, opts = {}) {
  const s = plsOutputPx(0);
  const scale = width / s.w, height = Math.round(s.h * scale);
  const cv = el('div', { class: 'screen-canvas', style: `width:${width}px;height:${height}px` });
  PLS_LAYERS.forEach((L, z) => {
    const src = store.val('IN', p, L.l);
    const on = (src ?? 0) > 0;
    if (!on && opts.sel !== L.l) return;
    const r = plsRect(p, L.l);
    const box = el('div', {
      class: 'lrect' + (opts.sel === L.l ? ' sel' : '') + (on ? '' : ' off'),
      style: `left:${r.left * scale}px;top:${r.top * scale}px;width:${r.w * scale}px;height:${r.h * scale}px;z-index:${z + 1}`,
      onpointerdown: opts.onMove ? (e) => opts.onMove(e, L.l, scale) : null,
      onclick: opts.onSelect ? () => opts.onSelect(L.l) : null,
    }, el('span', { class: 'lrect-tag', text: `${L.tag}${on ? ' · ' + plsSourceName(L.kind, src) : ''}` }));
    cv.append(box);
    if (opts.sel === L.l) selectionChrome(cv, box, opts.onResize ? (e, c, b) => opts.onResize(e, L.l, scale, c, b) : null);
  });
  return cv;
}

// ---------- PLS300 Live ----------
VIEWS.plslive = (() => {
  function enter() {
    for (const m of ['TA', 'TI', 'NT', 'NC', 'YT', 'Ys', 'YD', 'Ym', 'OB', 'PF', 'PZ', 'OH', 'OV']) store.scan(m);
    for (const m of ['IN', 'pH', 'pV', 'pW', 'pS']) for (const p of [PLS.CUR, PLS.NEXT]) for (const { l } of PLS_LAYERS) store.get(m, [p, l]);
    for (const m of ['Sf', 'iu', 'sc', 'sF']) store.scan(m);
  }
  function layerRow(L) {
    const cur = store.val('IN', PLS.CUR, L.l), next = store.val('IN', PLS.NEXT, L.l);
    return el('div', { class: 'layer' + ((next ?? 0) > 0 ? ' on' : '') },
      el('span', { class: 'tag', text: L.tag }),
      el('div', { class: 'row' },
        el('span', { class: 'src', title: 'On air now', text: plsSourceName(L.kind, cur) }),
        el('span', { class: 'hint', text: '→' }),
        plsEnumSelect('IN', [PLS.NEXT, L.l], plsSourceOptions(L.kind, next))),
      el('span', { class: 'hint', text: L.name }));
  }
  function presets() {
    return el('div', { class: 'mem-grid' }, ...[0, 1, 2, 3].map(n => {
      const p = PLS.MEM + n;
      const used = PLS_LAYERS.some(L => (store.val('IN', p, L.l) ?? 0) > 0);
      return el('button', { class: 'slot' + (used ? ' valid' : ''), title: 'Recall into Next', onclick: () => plsCopy(p, PLS.NEXT) },
        el('span', { class: 'num', text: String(n + 1) }), el('span', { class: 'lbl', text: used ? 'recall' : 'empty' }));
    }));
  }
  function render() {
    const ready = store.val('TA');
    const tbar = store.val('NT');
    return el('div', {},
      el('div', { class: 'view-head' }, el('h1', { text: 'Live' }),
        el('span', { class: 'hint', text: 'Next → Current. From the Programmer’s Guide; not yet driven against a PLS300.' })),
      el('div', { class: 'split-wide' },
        el('div', {},
          el('div', { class: 'panel' },
            el('div', { class: 'row' }, el('h2', 'Take'), el('div', { class: 'spacer' }),
              boolChip(ready, 'take ready', 'take busy'),
              el('span', { class: 'hint', text: plsEnumLabel('TI', store.val('TI')) })),
            el('div', { class: 'takebar' },
              el('div', { class: 'tbar' },
                el('label', { class: 'field slider' },
                  el('span', {}, 'T-bar', el('b', { class: 'sv', text: tbar == null ? '·' : (tbar / 100).toFixed(0) + '%' })),
                  el('input', { type: 'range', min: 0, max: 10000, step: 50, value: tbar ?? 0, disabled: store.val('YD') === 0,
                    onpointerdown: beginDrag, onpointerup: endDrag, onpointercancel: endDrag,
                    oninput: (e) => { throttledSet('NT', [], +e.target.value); e.target.parentNode.querySelector('.sv').textContent = (e.target.value / 100).toFixed(0) + '%'; } }))),
              el('button', { class: 'btn pgm take-btn', onclick: plsTake }, 'TAKE')),
            el('div', { class: 'row', style: 'margin-top:10px' },
              // The RCS's Stepback: the look before the last take, back on air.
              // The unit keeps it as preset 2, so this is a copy into next and a take.
              el('button', { class: 'btn ghost', onclick: () => { plsCopy(PLS.PREV, PLS.NEXT); plsTake(); } }, 'Step back'),
              toggleBtn('Auto-take on source change', 'YT', []),
              toggleBtn('Preset toggle after take', 'Ys', []),
              toggleBtn('T-bar enabled', 'YD', [], 'pvw'))),
          el('div', { class: 'panel' },
            el('div', { class: 'row' }, el('h2', 'Layers'), el('div', { class: 'spacer' }),
              el('span', { class: 'hint', text: 'current → next' })),
            el('div', { class: 'layers' }, ...PLS_LAYERS.map(layerRow)),
            el('div', { class: 'row', style: 'margin-top:10px' },
              el('span', { class: 'hint', text: 'Quick layout:' }),
              ...PLS_ENUMS.NQ.map(([v, label]) => el('button', { class: 'btn ghost', onclick: () => store.set('NQ', [], v) }, label)))),
          el('div', { class: 'panel' },
            el('h2', 'Preview output shows'),
            el('div', { class: 'seg' }, ...PLS_LAYERS.map(L => el('button', { class: store.val('NC') === L.l ? 'on recall' : '', onclick: () => store.set('NC', [], L.l) }, L.name))),
            el('div', { class: 'hint pad', text: 'PREVIEWED_LAYER: the preview output carries one layer of the next preset at a time.' }))),
        el('div', {},
          el('div', { class: 'panel' }, el('h2', 'Next preset'),
            el('div', { class: 'canvas-wrap' }, plsPresetCanvas(PLS.NEXT, 340)),
            el('div', { class: 'hint pad', text: 'Main output, to scale. Edit geometry in Layers.' })),
          el('div', { class: 'panel' }, el('h2', 'User presets'), presets(),
            el('div', { class: 'hint pad', text: 'Tap to recall into Next, then TAKE. Save and inspect them in Memories.' })),
          el('div', { class: 'panel' }, el('h2', 'Freeze'),
            el('div', { class: 'seg' },
              el('button', { class: store.val('Ym') === 0 ? 'on recall' : '', onclick: () => store.set('Ym', [], 0) }, 'By input'),
              el('button', { class: store.val('Ym') === 1 ? 'on take' : '', onclick: () => store.set('Ym', [], 1) }, 'All inputs')),
            el('div', { class: 'row', style: 'margin-top:8px' },
              ...PLS_INPUT_SLOTS.map(slot => el('button', {
                class: 'btn ghost' + (store.val('Sf', slot) === 1 ? ' pgm' : ''),
                onclick: () => store.set('Sf', [slot], store.val('Sf', slot) === 1 ? 0 : 1),
              }, String(plsInputNo(slot)))))),
          el('div', { class: 'panel' }, el('h2', 'Output black'),
            el('div', { class: 'row' }, toggleBtn('Main', 'OB', [0]), toggleBtn('Preview', 'OB', [1]))))));
  }
  return { enter, render };
})();

// ---------- PLS300 Layers ----------
VIEWS.plslayers = (() => {
  let preset = PLS.NEXT;
  let sel = 3;                                   // the PiP, the layer that moves
  function enter() {
    store.scan('OH'); store.scan('OV'); store.scan('PF'); store.scan('PZ');
    for (const m of ['iu', 'sc', 'sF']) store.scan(m);
    plsFetchPreset(preset);
  }
  function dragMove(e, l, scale) {
    e.preventDefault(); e.stopPropagation();
    beginDrag(); sel = l;
    const box = e.currentTarget;
    const sx = e.clientX, sy = e.clientY, r0 = plsRect(preset, l);
    const move = (ev) => {
      const r = { ...r0, left: r0.left + (ev.clientX - sx) / scale, top: r0.top + (ev.clientY - sy) / scale };
      box.style.left = r.left * scale + 'px'; box.style.top = r.top * scale + 'px';
      plsSetRect(preset, l, r);
    };
    const up = () => { document.removeEventListener('pointermove', move); document.removeEventListener('pointerup', up); endDrag(); };
    document.addEventListener('pointermove', move); document.addEventListener('pointerup', up);
  }
  function dragResize(e, l, scale, corner, box) {
    e.preventDefault(); e.stopPropagation();
    beginDrag(); sel = l;
    const sx = e.clientX, sy = e.clientY, r0 = plsRect(preset, l);
    const west = corner.includes('w'), north = corner.includes('n');
    const move = (ev) => {
      const dx = (ev.clientX - sx) / scale, dy = (ev.clientY - sy) / scale;
      let left = r0.left, right = r0.left + r0.w, top = r0.top, bot = r0.top + r0.h;
      if (west) left = Math.min(right - 16, r0.left + dx); else right = Math.max(left + 16, right + dx);
      if (north) top = Math.min(bot - 16, r0.top + dy); else bot = Math.max(top + 16, bot + dy);
      const r = { left, top, w: right - left, h: bot - top };
      box.style.left = r.left * scale + 'px'; box.style.top = r.top * scale + 'px';
      box.style.width = r.w * scale + 'px'; box.style.height = r.h * scale + 'px';
      plsSetRect(preset, l, r);
    };
    const up = () => { document.removeEventListener('pointermove', move); document.removeEventListener('pointerup', up); endDrag(); };
    document.addEventListener('pointermove', move); document.addEventListener('pointerup', up);
  }
  function fill() { const s = plsOutputPx(0); plsSetRect(preset, sel, { left: 0, top: 0, w: s.w, h: s.h }); store.notify(); }
  function quad(ix) {
    const s = plsOutputPx(0), w = s.w / 2, h = s.h / 2;
    plsSetRect(preset, sel, { left: (ix % 2) * w, top: (ix < 2 ? 0 : 1) * h, w, h }); store.notify();
  }
  function stack() {
    return el('div', { class: 'layers' }, ...[...PLS_LAYERS].reverse().map(L => {
      const src = store.val('IN', preset, L.l);
      return el('div', { class: 'layer' + ((src ?? 0) > 0 ? ' on' : '') + (sel === L.l ? ' sel' : ''), onclick: () => { sel = L.l; store.notify(); } },
        el('span', { class: 'tag', text: L.tag }),
        el('span', { class: 'src', text: plsSourceName(L.kind, src) }),
        el('span', { class: 'hint', text: L.name }));
    }));
  }
  function editor() {
    const L = plsLayer(sel), i = [preset, sel];
    const s = plsOutputPx(0);
    return el('div', { class: 'editor' },
      el('div', { class: 'row' },
        el('label', { class: 'field' }, 'Source', plsEnumSelect('IN', i, plsSourceOptions(L.kind, store.val('IN', ...i)))),
        el('label', { class: 'field' }, 'Smooth move', checkbox(store.val('ps', ...i) === 1, v => store.set('ps', i, v ? 1 : 0)))),
      el('div', { class: 'row' },
        el('span', { class: 'hint', text: 'Snap:' }),
        el('button', { class: 'btn ghost', onclick: fill }, 'Full'),
        ...['◰', '◳', '◱', '◲'].map((g, k) => el('button', { class: 'btn ghost', onclick: () => quad(k) }, g))),
      el('div', { class: 'grid2' },
        bind('Left', 'pH', i, PLS_POS_BIAS - s.w, PLS_POS_BIAS + s.w, 1, v => (v - PLS_POS_BIAS) + ' px'),
        bind('Top', 'pV', i, PLS_POS_BIAS - s.h, PLS_POS_BIAS + s.h, 1, v => (v - PLS_POS_BIAS) + ' px'),
        bind('Width', 'pW', i, 0, s.w, 1, v => v + ' px'),
        bind('Height', 'pS', i, 0, s.h, 1, v => v + ' px'),
        bind('Opacity', 'pA', i, 0, 255, 1, v => Math.round(v / 255 * 100) + '%')),
      el('div', { class: 'sub-head' }, 'Crop'),
      el('div', { class: 'grid2' },
        bind('Left', 'CH', i, null, null, 256, v => Math.round(v / 655.35) + '%'),
        bind('Top', 'CV', i, null, null, 256, v => Math.round(v / 655.35) + '%'),
        bind('Width', 'CW', i, null, null, 256, v => Math.round(v / 655.35) + '%'),
        bind('Height', 'CS', i, null, null, 256, v => Math.round(v / 655.35) + '%')),
      el('div', { class: 'sub-head' }, 'Border'),
      el('div', { class: 'row' },
        el('label', { class: 'field' }, 'Style', plsEnumSelect('bS', i)),
        el('label', { class: 'field' }, 'Colour', el('input', { type: 'number', class: 'num', min: 0, max: 544, value: store.val('bC', ...i) ?? 33,
          onchange: (e) => store.set('bC', i, Math.max(0, Math.min(544, +e.target.value || 0))) })),
        el('span', { class: 'hint', text: 'a colour number from the unit’s own palette' })),
      el('div', { class: 'grid2' },
        bind('Border opacity', 'bA', i, 0, 255, 1, v => Math.round(v / 255 * 100) + '%'),
        bind('Border width', 'bH', i, 0, 127, 1, v => v + ' px'),
        bind('Border height', 'bV', i, 0, 127, 1, v => v + ' px')),
      el('div', { class: 'sub-head' }, 'Opening'),
      el('div', { class: 'row' },
        el('label', { class: 'field' }, 'Effect', plsEnumSelect('oT', i)),
        el('label', { class: 'field' }, 'Direction', plsEnumSelect('oW', i))),
      bind('Duration', 'oD', i, 0, 255, 1, v => (v / 10).toFixed(1) + ' s'),
      el('div', { class: 'sub-head' }, 'Closing'),
      el('div', { class: 'row' },
        el('label', { class: 'field' }, 'Effect', plsEnumSelect('cT', i, PLS_ENUMS.oT)),
        el('label', { class: 'field' }, 'Direction', plsEnumSelect('cW', i, PLS_ENUMS.oW))),
      bind('Duration', 'cD', i, 0, 255, 1, v => (v / 10).toFixed(1) + ' s'));
  }
  function render() {
    const L = plsLayer(sel);
    return el('div', {},
      el('div', { class: 'view-head' }, el('h1', { text: 'Layers' }),
        el('span', { class: 'hint', text: 'Drag to move, corners to resize. Mixer layout; matrix mode re-labels the slots.' })),
      el('div', { class: 'panel' },
        el('div', { class: 'row' },
          el('label', { class: 'field' }, 'Preset',
            el('select', { onchange: (e) => { preset = +e.target.value; enter(); store.notify(); } },
              ...PLS_PRESET_NAMES.map((n, p) => { const o = el('option', { value: p, text: n }); if (p === preset) o.selected = true; return o; }))),
          preset === PLS.CUR ? el('span', { class: 'hint', text: 'Editing the current preset changes the picture on air at once.' }) : null,
          el('div', { class: 'spacer' }),
          preset === PLS.NEXT ? el('button', { class: 'btn pgm', onclick: plsTake }, 'TAKE') : null)),
      el('div', { class: 'split-wide' },
        el('div', {},
          el('div', { class: 'panel' },
            el('div', { class: 'canvas-wrap' }, plsPresetCanvas(preset, 720, { sel, onMove: dragMove, onResize: dragResize, onSelect: (l) => { sel = l; store.notify(); } })),
            el('div', { class: 'hint pad', text: `Main output ${plsOutputPx(0).w}×${plsOutputPx(0).h}. Position is the layer’s top-left corner; the guide gives no z-order control.` })),
          el('div', { class: 'panel' }, el('h2', `${L.name} · ${PLS_PRESET_NAMES[preset]}`), editor())),
        el('div', { class: 'panel' }, el('h2', 'Stack'), stack())));
  }
  return { enter, render };
})();

// ---------- PLS300 Memories ----------
VIEWS.plsmemories = (() => {
  let mode = 'recall';        // 'recall' | 'take' | 'save'
  let saveFrom = PLS.CUR;
  let inspect = PLS.MEM;
  let copyFrom = PLS.CUR, copyTo = PLS.MEM;
  const presetSelect = (val, on) => el('select', { onchange: (e) => on(+e.target.value) },
    ...PLS_PRESET_NAMES.map((n, p) => { const o = el('option', { value: p, text: n }); if (p === val) o.selected = true; return o; }));
  function enter() {
    for (const p of [PLS.CUR, PLS.NEXT, PLS.PREV, 3, 4, 5, 6]) for (const { l } of PLS_LAYERS) store.get('IN', [p, l]);
    plsFetchPreset(inspect);
    store.scan('OH'); store.scan('OV');
  }
  function tap(p) {
    if (mode === 'save') { plsCopy(saveFrom, p); return; }
    plsCopy(p, PLS.NEXT);
    // The copy is the unit's own verb and answers with the changed variables;
    // the take goes after it on the same link, in order.
    if (mode === 'take') plsTake();
  }
  function slot(p, label) {
    const used = PLS_LAYERS.some(L => (store.val('IN', p, L.l) ?? 0) > 0);
    return el('button', { class: 'slot' + (used ? ' valid' : '') + (inspect === p ? ' sel' : ''),
      onclick: () => tap(p), oncontextmenu: (e) => { e.preventDefault(); inspect = p; enter(); store.notify(); } },
      el('span', { class: 'num', text: label }), el('span', { class: 'lbl', text: used ? PLS_LAYERS.filter(L => (store.val('IN', p, L.l) ?? 0) > 0).map(L => L.tag).join(' ') : 'empty' }));
  }
  function render() {
    return el('div', { class: 'mode-' + mode },
      el('div', { class: 'view-head' }, el('h1', { text: 'Memories' }),
        el('span', { class: 'hint', text: 'Four user presets in the unit, plus the previous look. Recall lands in Next.' })),
      el('div', { class: 'panel' },
        el('div', { class: 'row' },
          el('div', { class: 'seg' },
            el('button', { class: mode === 'recall' ? 'on recall' : '', onclick: () => { mode = 'recall'; store.notify(); } }, 'Recall'),
            el('button', { class: mode === 'take' ? 'on take' : '', onclick: () => { mode = 'take'; store.notify(); } }, 'Recall + take'),
            el('button', { class: mode === 'save' ? 'on save' : '', onclick: () => { mode = 'save'; store.notify(); } }, 'Save')),
          mode === 'save' ? el('label', { class: 'field' }, 'Save from',
            el('div', { class: 'seg' },
              el('button', { class: saveFrom === PLS.CUR ? 'on take' : '', onclick: () => { saveFrom = PLS.CUR; store.notify(); } }, 'Current'),
              el('button', { class: saveFrom === PLS.NEXT ? 'on recall' : '', onclick: () => { saveFrom = PLS.NEXT; store.notify(); } }, 'Next'))) : null,
          el('div', { class: 'spacer' }),
          el('span', { class: 'hint', text: 'right-click a slot to inspect it' })),
        el('div', { class: 'mem-grid', style: 'margin-top:10px' },
          ...[0, 1, 2, 3].map(n => slot(PLS.MEM + n, String(n + 1))),
          mode === 'save' ? null : slot(PLS.PREV, 'PREV'))),
      el('div', { class: 'split-wide' },
        el('div', { class: 'panel' }, el('h2', `${PLS_PRESET_NAMES[inspect]}`),
          el('div', { class: 'canvas-wrap' }, plsPresetCanvas(inspect, 480)),
          el('div', { class: 'layers', style: 'margin-top:10px' }, ...PLS_LAYERS.map(L => el('div', { class: 'layer' + ((store.val('IN', inspect, L.l) ?? 0) > 0 ? ' on' : '') },
            el('span', { class: 'tag', text: L.tag }), el('span', { class: 'src', text: plsSourceName(L.kind, store.val('IN', inspect, L.l)) }), el('span', { class: 'hint', text: L.name }))))),
        el('div', { class: 'panel' }, el('h2', 'Copy any preset'),
          el('div', { class: 'hint pad', text: 'COPY_FROM, COPY_TO, then COPY_CTRL — the verb every recall and save above is made of. A copy into Current changes the picture on air.' }),
          el('div', { class: 'row' },
            el('label', { class: 'field' }, 'From', presetSelect(copyFrom, v => { copyFrom = v; })),
            el('label', { class: 'field' }, 'To', presetSelect(copyTo, v => { copyTo = v; })),
            el('button', { class: 'btn', onclick: () => plsCopy(copyFrom, copyTo) }, 'Copy')))));
  }
  return { enter, render };
})();

// ---------- PLS300 Inputs ----------
VIEWS.plsinputs = (() => {
  let sel = null;
  const STATUS = ['sc', 'sF', 'sw', 'st', 'sf', 'sl', 'ss', 'sn', 'sK'];
  const SETTINGS = ['SH', 'SV', 'Sw', 'Sh', 'Sg', 'Sc', 'Sr', 'Su', 'SS', 'ST', 'si', 'so', 'sO', 'SF', 'Sn', 'Sp', 'Sm', 'iS', 'iV', 'il', 'iH', 'iC', 'KT', 'KR', 'KG', 'KB', 'KH', 'KL', 'KM', 'KA', 'KI', 'SI', 'SJ', 'SK', 'SL'];
  function enter() {
    for (const m of ['iu', 'iK', 'Sf', ...STATUS]) store.scan(m);
    for (const m of ['EF', 'ER', 'ES']) store.scan(m);
    store.scan('Yf'); store.scan('YL'); store.scan('Kg');
    if (sel != null) for (const m of SETTINGS) store.get(m, [sel]);
  }
  function row(slot) {
    const on = store.val('iu', slot) !== 0;
    const locked = plsInputHasSignal(slot);
    const w = store.val('sw', slot), h = store.val('st', slot);
    return el('tr', { class: (on ? '' : 'dim') + (sel === slot ? ' sel-row' : ''), style: 'cursor:pointer', onclick: () => { sel = slot; enter(); store.notify(); } },
      el('td', { text: 'IN ' + plsInputNo(slot) }),
      el('td', {}, el('button', { class: 'btn ghost' + (on ? '' : ' pgm'), onclick: (e) => { e.stopPropagation(); store.set('iu', [slot], on ? 0 : 1); } }, on ? 'Enabled' : 'Disabled')),
      el('td', { text: plsEnumLabel('iK', store.val('iK', slot)) }),
      el('td', {}, boolChip(store.val('sc', slot) == null ? null : locked ? 1 : 0, plsEnumLabel('sF', store.val('sF', slot)), 'no signal')),
      el('td', { class: 'val', text: (w && h) ? `${w}×${h}` : '·' }),
      el('td', { class: 'val', text: plsHz(store.val('sf', slot)) }),
      el('td', {},
        el('button', { class: 'btn ghost' + (store.val('Sf', slot) === 1 ? ' pgm' : ''), onclick: (e) => { e.stopPropagation(); store.set('Sf', [slot], store.val('Sf', slot) === 1 ? 0 : 1); } }, 'Freeze'),
        el('button', { class: 'btn ghost', style: 'margin-left:6px', onclick: (e) => { e.stopPropagation(); store.set('Ii', [slot], 1); } }, 'Autoset')));
  }
  function settings() {
    const i = [sel];
    const n = plsInputNo(sel);
    // The guide gives HDCP to inputs 11 and 12 and, two pages on, names inputs
    // 9 and 10 as the DVI ones; the manual's rear panel agrees with the latter.
    // Go by what the input reports itself to be, and let a real unit answer
    // E11 if the slot turns out not to carry it.
    const dvi = (store.val('iK', sel) ?? 0) >= 8 && store.val('iK', sel) <= 11;
    const kt = store.val('KT', sel) ?? 0;
    return el('div', { class: 'panel' },
      el('div', { class: 'row' }, el('h2', `Input ${n}`), el('div', { class: 'spacer' }),
        el('button', { class: 'btn ghost', onclick: () => store.set('Sa', i, 1) }, 'Auto-centre'),
        el('button', { class: 'btn ghost', onclick: () => store.set('Ss', i, 1) }, 'Reset settings')),
      el('div', { class: 'row' },
        el('label', { class: 'field' }, 'Signal type', plsEnumSelect('iK', i)),
        el('label', { class: 'field' }, 'SD standard', plsEnumSelect('iS', i)),
        el('label', { class: 'field' }, 'Source', enumSelect('iV', i, ['Stable (DVD)', 'VCR'])),
        el('label', { class: 'field' }, 'Sync load', enumSelect('il', i, ['Hi-Z', '75 Ω']))),
      el('div', { class: 'sub-head' }, 'Picture'),
      el('div', { class: 'grid2' },
        bind('Brightness', 'Sg', i), bind('Contrast', 'Sc', i), bind('Colour', 'Sr', i), bind('Hue', 'Su', i),
        bind('Sharpness / motion', 'Sm', i, 0, 15, 1, v => v === 15 ? 'min correction' : v === 0 ? 'max correction' : String(v))),
      el('div', { class: 'sub-head' }, 'Geometry'),
      el('div', { class: 'grid2' },
        bind('H position', 'SH', i, 0, 2048, 1, v => (v - 1024) + ''), bind('V position', 'SV', i, 0, 2048, 1, v => (v - 1024) + ''),
        bind('H size', 'Sw', i, 0, 4096, 1, v => (v - 2048) + ''), bind('V size', 'Sh', i, 0, 4096, 1, v => (v - 2048) + ''),
        bind('Phase', 'SS', i, 0, 31), bind('Total pixels per line', 'ST', i, 0, 4095)),
      el('div', { class: 'row' },
        el('label', { class: 'field' }, 'Input aspect', plsEnumSelect('si', i)),
        el('label', { class: 'field' }, 'Shown as', plsEnumSelect('so', i)),
        el('label', { class: 'field' }, 'Overscan', checkbox(store.val('sO', sel) === 1, v => store.set('sO', i, v ? 1 : 0))),
        el('label', { class: 'field' }, 'Force 4:3 on PAL/NTSC', checkbox(store.val('SF', sel) === 1, v => store.set('SF', i, v ? 1 : 0))),
        el('label', { class: 'field' }, '2:2 pulldown', checkbox(store.val('Sn', sel) === 1, v => store.set('Sn', i, v ? 1 : 0))),
        el('label', { class: 'field' }, '3:2 pulldown', checkbox(store.val('Sp', sel) === 1, v => store.set('Sp', i, v ? 1 : 0)))),
      el('div', { class: 'sub-head' }, 'Crop'),
      el('div', { class: 'grid2' },
        bind('Left', 'SI', i, null, null, 256, v => Math.round(v / 655.35) + '%'), bind('Top', 'SJ', i, null, null, 256, v => Math.round(v / 655.35) + '%'),
        bind('Width', 'SK', i, null, null, 256, v => Math.round(v / 655.35) + '%'), bind('Height', 'SL', i, null, null, 256, v => Math.round(v / 655.35) + '%')),
      el('div', { class: 'sub-head' }, 'Keying'),
      el('div', { class: 'row' },
        el('label', { class: 'field' }, 'Type', plsEnumSelect('KT', i)),
        kt ? el('label', { class: 'field' }, 'Invert', checkbox(store.val('KI', sel) === 1, v => store.set('KI', i, v ? 1 : 0))) : null,
        kt ? toggleBtn('Colour grabber', 'Kg', []) : null,
        kt && store.val('Kg') === 1 ? el('button', { class: 'btn', onclick: () => store.set('Kc', [], 1) }, 'Grab colour') : null),
      kt ? el('div', { class: 'grid2' },
        bind('Red level', 'KR', i), bind('Green level', 'KG', i), bind('Blue level', 'KB', i), bind('Tolerance', 'KH', i),
        bind('Luma low', 'KL', i), bind('Luma high', 'KM', i), bind('DSK background', 'KA', i)) : null,
      kt && store.val('Kg') === 1 ? el('div', { class: 'grid2' },
        bind('Grabber H', 'Kh', [], 0, 65535, 256, v => Math.round(v / 655.35) + '%'), bind('Grabber V', 'Kv', [], 0, 65535, 256, v => Math.round(v / 655.35) + '%')) : null,
      dvi ? el('div', {}, el('div', { class: 'sub-head' }, 'HDCP'),
        el('div', { class: 'row' },
          toggleBtn('HDCP support', 'iH', i, 'pvw'),
          el('label', { class: 'field' }, 'Cable length', enumSelect('iC', i, ['under 10 m', '5–20 m', 'over 15 m'])))) : null);
  }
  function edid() {
    // Four plugs carry an EDID: analog 1 and 2, DVI-D 1 and 2 (index 2 is unused).
    const plugs = [[0, 'Analog 1'], [1, 'Analog 2'], [3, 'DVI-D 1'], [4, 'DVI-D 2']];
    return el('div', { class: 'panel', style: 'overflow:auto' }, el('h2', 'EDID'),
      el('table', { class: 'grid' },
        el('thead', el('tr', ...['Plug', 'Preferred format', 'Rate', 'State', ''].map(h => el('th', { text: h })))),
        el('tbody', ...plugs.map(([k, name]) => el('tr', {},
          el('td', { text: name }),
          el('td', {}, plsEnumSelect('EF', [k])),
          el('td', {}, plsEnumSelect('ER', [k])),
          el('td', { text: ['ready', 'saving', 'reading'][store.val('ES', k)] ?? '·' }),
          el('td', {}, el('button', { class: 'btn ghost', onclick: () => store.set('ES', [k], 1) }, 'Write')))))));
  }
  function render() {
    const rows = PLS_INPUT_SLOTS.map(row);
    const withSignal = PLS_INPUT_SLOTS.filter(plsInputHasSignal).length;
    return el('div', {},
      el('div', { class: 'view-head' }, el('h1', { text: 'Inputs' }),
        el('span', { class: 'hint', text: `${withSignal} of 10 with signal · click a row to adjust it` })),
      sel != null ? settings() : null,
      el('div', { class: 'panel', style: 'overflow:auto' },
        el('table', { class: 'grid' },
          el('thead', {}, el('tr', {}, ...['Input', 'State', 'Type', 'Signal', 'Size', 'Rate', ''].map(h => el('th', { text: h })))),
          el('tbody', {}, ...rows))),
      el('div', { class: 'split' },
        el('div', { class: 'panel' }, el('h2', 'Backup'),
          el('label', { class: 'field' }, 'When an input loses signal, show', plsEnumSelect('Yf', [], [[0, 'nothing'], ...PLS_INPUT_SLOTS.map(s => [plsInputNo(s), 'IN ' + plsInputNo(s)])])),
          el('label', { class: 'field' }, 'Refuse a signal-less input on a layer', checkbox(store.val('YL') === 1, v => store.set('YL', [], v ? 1 : 0)))),
        edid()));
  }
  return { enter, render };
})();

// ---------- PLS300 Outputs ----------
VIEWS.plsoutputs = (() => {
  const OUT = ['Main', 'Preview'];
  function enter() {
    for (const m of ['OF', 'OR', 'OA', 'OD', 'OS', 'OC', 'OG', 'OJ', 'OI', 'OP', 'OB', 'OH', 'OV', 'OT', 'OO', 'Oh', 'On', 'Rf', 'Rg', 'Rs', 'Xr', 'Xe', 'Xm', 'Xc', 'Xt', 'Xl']) store.scan(m);
    store.scan('Om');
  }
  function card(o) {
    const i = [o];
    return el('div', { class: 'panel' },
      el('div', { class: 'row' }, el('h2', OUT[o]), el('div', { class: 'spacer' }),
        el('span', { class: 'hint val', text: `${store.val('OH', o) ?? '·'}×${store.val('OV', o) ?? '·'} @ ${plsHz(store.val('OT', o))}` }),
        toggleBtn('Black', 'OB', i)),
      el('div', { class: 'row' },
        el('label', { class: 'field' }, 'Format', plsEnumSelect('OF', i)),
        el('label', { class: 'field' }, 'Rate', plsEnumSelect('OR', i)),
        el('label', { class: 'field' }, 'Pattern', plsEnumSelect('OP', i))),
      el('div', { class: 'row' },
        el('label', { class: 'field' }, 'Analog', plsEnumSelect('OA', i)),
        el('label', { class: 'field' }, 'Sync', plsEnumSelect('OS', i)),
        el('label', { class: 'field' }, 'Digital', plsEnumSelect('OD', i)),
        el('label', { class: 'field' }, 'Overscan', checkbox(store.val('OO', o) === 1, v => store.set('OO', i, v ? 1 : 0)))),
      el('div', { class: 'sub-head' }, 'Background'),
      el('div', { class: 'row' }, el('label', { class: 'field' }, 'Colour', plsEnumSelect('OC', i))),
      store.val('OC', o) === 32 ? el('div', { class: 'grid2' }, bind('Hue', 'OG', i), bind('Saturation', 'OJ', i), bind('Brightness', 'OI', i)) : null,
      el('div', { class: 'sub-head' }, 'Picture'),
      el('div', { class: 'grid2' },
        bind('Anti-flicker', 'Rf', i, 0, 7, 1, v => v === 0 ? 'off' : String(v)),
        bind('Gamma', 'Rg', i, 5, 40, 1, v => (v / 10).toFixed(1)),
        bind('Sharpness', 'Rs', i)),
      el('div', { class: 'sub-head' }, 'HDCP'),
      el('div', { class: 'row' },
        el('label', { class: 'field' }, 'Detection', enumSelect('Oh', i, ['Off', 'Automatic', 'Configuration 1', 'Configuration 2', 'Configuration 3'])),
        boolChip(store.val('On', o), 'HDCP on', 'HDCP off')),
      el('div', { class: 'sub-head' }, 'Frame lock'),
      el('div', { class: 'row' },
        el('label', { class: 'field' }, 'Reference', plsEnumSelect('Xr', i)),
        el('label', { class: 'field' }, 'Mode', plsEnumSelect('Xm', i)),
        boolChip(store.val('Xl', o), 'locked', 'free'),
        el('span', { class: 'hint', text: `now ${plsEnumLabel('Xm', store.val('Xc', o)).toLowerCase()} on ${plsEnumLabel('Xr', store.val('Xe', o)).toLowerCase()} · ${plsHz(store.val('Xt', o))}` })));
  }
  function render() {
    return el('div', {},
      el('div', { class: 'view-head' }, el('h1', { text: 'Outputs' }),
        el('span', { class: 'hint', text: 'Main and preview' })),
      el('div', { class: 'panel' }, el('div', { class: 'row' },
        toggleBtn('Preview follows the main output’s format and rate', 'Om', [], 'pvw'))),
      el('div', { class: 'split-wide' }, card(0), card(1)));
  }
  return { enter, render };
})();

// ---------- PLS300 Audio ----------
VIEWS.plsaudio = (() => {
  const OUT = ['Main', 'Preview'];
  function enter() {
    for (const m of ['AV', 'Au', 'Am', 'AD', 'Ae', 'Af', 'Al', 'AB', 'AL', 'Ab', 'Ai', 'Ac', 'AC', 'As', 'iu']) store.scan(m);
  }
  const bal = (v) => v == null ? '·' : v === 45 ? 'C' : v < 45 ? 'L' + (45 - v) : 'R' + (v - 45);
  function outCard(o) {
    return el('div', { class: 'panel' },
      el('div', { class: 'row' }, el('h2', OUT[o]), el('div', { class: 'spacer' }), toggleBtn('Mute', 'Au', [o])),
      // The guide gives three points on the scale (0 = mute, 32 = −18 dB,
      // 255 = 0 dB) and no curve, so anything else is shown as the raw step.
      bind('Master volume', 'AV', [o], 0, 255, 1, v => v === 0 ? 'mute' : v === 255 ? '0 dB' : v === 32 ? '−18 dB' : String(v)),
      el('div', { class: 'grid2' },
        bind('Delay', 'AD', [o], 0, 80, 1, v => store.val('Ae') === 1 ? 'auto' : Math.round(v * 6.25) + ' ms'),
        el('label', { class: 'field' }, 'Stereo', checkbox(store.val('Am', o) === 1, v => store.set('Am', [o], v ? 1 : 0)))));
  }
  function inRow(slot) {
    const n = plsInputNo(slot);
    return el('tr', { class: store.val('iu', slot) === 0 ? 'dim' : '' },
      el('td', { text: 'IN ' + n }),
      el('td', {}, plsEnumSelect('Ai', [slot], [[0, 'none'], ...PLS_INPUT_SLOTS.map(s => [plsInputNo(s), 'audio in ' + plsInputNo(s)])])),
      el('td', { style: 'min-width:200px' }, bind('', 'AL', [slot], 0, 255, 1, v => v === 45 ? '0 dB' : String(v))),
      el('td', { style: 'min-width:160px' }, bind('', 'Ab', [slot], 0, 90, 1, bal)),
      // De-embedding belongs to the SDI inputs; which slots those are is the
      // same disagreement the Inputs view notes, so the reported type decides.
      store.val('iK', slot) === 12 ? el('td', {}, el('div', { class: 'row' },
        el('label', { class: 'field' }, 'L', enumSelect('Ac', [slot], Array.from({ length: 16 }, (_, k) => `${'ABCD'[k >> 2]}${(k & 3) + 1}`))),
        el('label', { class: 'field' }, 'R', enumSelect('AC', [slot], Array.from({ length: 16 }, (_, k) => `${'ABCD'[k >> 2]}${(k & 3) + 1}`))),
        boolChip(store.val('As', slot), 'locked', 'no audio'))) : el('td', { text: '—' }));
  }
  function render() {
    return el('div', {},
      el('div', { class: 'view-head' }, el('h1', { text: 'Audio' }),
        el('span', { class: 'hint', text: 'Two outputs, ten input channels and an auxiliary' })),
      el('div', { class: 'panel' }, el('div', { class: 'row' },
        el('label', { class: 'field' }, 'Audio follows', enumSelect('Af', [], ['a free choice of input', 'the top layer'])),
        el('label', { class: 'field' }, 'Automatic delay', checkbox(store.val('Ae') === 1, v => store.set('Ae', [], v ? 1 : 0))))),
      el('div', { class: 'split-wide' }, outCard(0), outCard(1)),
      el('div', { class: 'panel' }, el('h2', 'Auxiliary input'),
        el('div', { class: 'grid2' }, bind('Level', 'Al', [], 0, 255, 1, v => v === 45 ? '0 dB' : String(v)), bind('Balance', 'AB', [], 0, 90, 1, bal))),
      el('div', { class: 'panel', style: 'overflow:auto' }, el('h2', 'Input channels'),
        el('table', { class: 'grid' },
          el('thead', el('tr', ...['Input', 'Audio from', 'Level', 'Balance', 'SDI de-embed'].map(h => el('th', { text: h })))),
          el('tbody', ...PLS_INPUT_SLOTS.map(inRow)))));
  }
  return { enter, render };
})();

// ---------- PLS300 Pictures (logos and frames) ----------
VIEWS.plspictures = (() => {
  function enter() {
    for (const m of ['PF', 'PZ', 'PE', 'PM', 'PX', 'PS', 'PL', 'PT', 'PW', 'PH', 'PB', 'PN', 'PI', 'Pt', 'Pm', 'Pc', 'Pw', 'Ph', 'Ps', 'Pn', 'OH', 'OV']) store.scan(m);
  }
  // Frames are pictures 9–14 and logos 1–6 in the status tables; their
  // validity is a bit each in PF (frames) and PZ (logos).
  function tile(kind, n) {
    const idx = kind === 'frame' ? 8 + n : n;
    const valid = flagOn(store.val(kind === 'frame' ? 'PF' : 'PZ') ?? 0, n - 1);
    const w = store.val('Pw', idx), h = store.val('Ph', idx);
    const frames = store.val('Pn', idx);
    return el('button', { class: 'slot still' + (valid ? ' valid' : '') + (store.val('PX') === idx ? ' sel' : ''), onclick: () => store.set('PX', [], idx) },
      el('span', { class: 'num', text: `${kind === 'frame' ? 'F' : 'L'}${n}` }),
      el('span', { class: 'lbl', text: valid ? `${w || '?'}×${h || '?'}` : 'empty' }),
      valid && frames > 1 ? el('span', { class: 'lbl', text: `${frames} frames` }) : null);
  }
  function capture() {
    const st = store.val('PE');
    const busy = st != null && st !== 0;
    const s = plsOutputPx(store.val('PS') ?? 0);
    const run = (mode) => { store.set('PM', [], mode); store.set('PG', [], 1); };
    return el('div', { class: 'panel' },
      el('div', { class: 'row' }, el('h2', 'Capture'), el('div', { class: 'spacer' }),
        boolChip(st == null ? null : busy ? 0 : 1, 'free', plsEnumLabel('PE', st)),
        el('span', { class: 'hint', text: `${plsEnumLabel('CK', store.val('CK'))}${store.val('CP') ? ' ' + store.val('CP') + '%' : ''}` })),
      el('div', { class: 'row' },
        el('label', { class: 'field' }, 'Into', plsEnumSelect('PX', [])),
        el('label', { class: 'field' }, 'From', enumSelect('PS', [], ['Main output', 'Preview output'])),
        el('label', { class: 'field' }, 'Cut-out colour', bind('', 'Pc', [], 0, 7))),
      el('div', { class: 'grid2' },
        bind('Left', 'PL', [], PLS_POS_BIAS, PLS_POS_BIAS + s.w, 1, v => (v - PLS_POS_BIAS) + ' px'),
        bind('Top', 'PT', [], PLS_POS_BIAS, PLS_POS_BIAS + s.h, 1, v => (v - PLS_POS_BIAS) + ' px'),
        bind('Width', 'PW', [], 0, s.w, 1, v => v + ' px'),
        bind('Height', 'PH', [], 0, s.h, 1, v => v + ' px')),
      el('div', { class: 'row' },
        el('label', { class: 'field' }, 'Keying', enumSelect('PB', [], ['None', 'Luma key', 'Chroma key'])),
        el('label', { class: 'field' }, 'Animated: frames', el('input', { type: 'number', class: 'num', min: 1, max: store.val('Pm') ?? 255, value: store.val('PN') ?? 1,
          onchange: (e) => store.set('PN', [], Math.max(1, +e.target.value || 1)) })),
        bind('Interval', 'PI', [], 1, 1000, 1, v => v + ' ms')),
      el('div', { class: 'row', style: 'margin-top:8px' },
        el('button', { class: 'btn', disabled: busy || !store.val('PX') || store.val('PX') > 6, onclick: () => run(2) }, 'Record logo'),
        el('button', { class: 'btn', disabled: busy || !store.val('PX') || store.val('PX') > 6, onclick: () => run(3) }, 'Record animated logo'),
        el('button', { class: 'btn', disabled: busy || (store.val('PX') ?? 0) < 9, onclick: () => run(4) }, 'Record frame'),
        el('div', { class: 'spacer' }),
        el('button', { class: 'btn ghost', disabled: busy || !store.val('PX'), onclick: () => run(5) }, 'Delete')),
      el('div', { class: 'hint pad', text: 'Pictures are captured from an output, so put the wanted source on air (or on preview) first. A logo can key on luma or chroma; a frame fills the background layer.' }));
  }
  function render() {
    return el('div', {},
      el('div', { class: 'view-head' }, el('h1', { text: 'Pictures' }),
        el('span', { class: 'hint', text: 'Six frames and six logos, stored in the unit' })),
      el('div', { class: 'split' },
        el('div', {},
          el('div', { class: 'panel' }, el('h2', 'Frames'), el('div', { class: 'mem-grid' }, ...[1, 2, 3, 4, 5, 6].map(n => tile('frame', n)))),
          el('div', { class: 'panel' }, el('h2', 'Logos'), el('div', { class: 'mem-grid' }, ...[1, 2, 3, 4, 5, 6].map(n => tile('logo', n))))),
        capture()));
  }
  return { enter, render };
})();

// ---------- PLS300 System ----------
VIEWS.plssystem = (() => {
  let armed = false;
  function enter() {
    for (const m of ['?', 'xV', 'xU', 'xR', 'yo', 'xK', 'xi', 'xj', 'xk', 'xl', 'nw', 'np', 'nk', 'nt', 'ne', 'YK', 'YB', 'Yb', 'YD', 'YL', 'wS', 'wR', 'wC', 'CK', 'CP', 'YS', 'yA']) store.scan(m);
  }
  const OPTIONS = ['LAN module', 'SDI board 1', 'Recording board', 'CF Caecina', 'CF Fannia', 'CF Thrasea', 'SDI board 2', 'Audio evolution', 'HDCP DVI evolution'];
  const COMPONENTS = ['', 'Main micro', 'Front panel micro', 'FPGA Caecina', 'FPGA Fannia', 'FPGA Thrasea', 'Sync CPLD'];
  const ip = () => { const o = [0, 1, 2, 3].map(k => store.val('nw', 0, k)); return o.every(x => x != null) ? o.join('.') : '·'; };
  const id = () => { const p = ['xi', 'xj', 'xk', 'xl'].map(m => store.val(m)); return p.every(x => x != null) ? p.map(v => v.toString(16).padStart(4, '0')).join('') : '·'; };
  function render() {
    const opts = store.val('yo');
    const lock = store.val('YK');
    const busy = (store.val('CK') ?? 0) !== 0;
    return el('div', {},
      el('div', { class: 'view-head' }, el('h1', { text: 'System' }), el('span', { class: 'hint', text: 'Device, network, front panel and standby' })),
      el('div', { class: 'split' },
        el('div', { class: 'panel' }, el('h2', 'Device'),
          plsKv('Model', deviceModel()),
          plsKv('Device ID', id()),
          plsKv('Variable set', fmt(store.val('xV'))),
          plsKv('Updater', fmt(store.val('xU'))),
          plsKv('Board revision', fmt(store.val('xR'))),
          plsKv('Options', opts == null ? '·' : OPTIONS.filter((_, b) => flagOn(opts, b)).join(', ') || 'none'),
          ...COMPONENTS.map((name, k) => name && store.val('xK', k) != null ? plsKv(name, fmt(store.val('xK', k))) : null)),
        el('div', { class: 'panel' }, el('h2', 'Network'),
          plsKv('IP address', ip()),
          plsKv('Netmask', store.val('nk') == null ? '·' : `/${32 - store.val('nk')}`),
          plsKv('Port', fmt(store.val('np', 0))),
          plsKv('Protocol', plsEnumLabel('nt', store.val('nt'))),
          el('div', { class: 'kv' }, el('span', { class: 'k', text: 'LAN' }), boolChip(store.val('ne'), 'enabled', 'RS-232 only')),
          el('div', { class: 'hint pad', text: 'Read only here: LANENABLE off would end this very session, and the address is changed from the front panel with LANSTORE.' }))),
      el('div', { class: 'split' },
        el('div', { class: 'panel' }, el('h2', 'Front panel'),
          el('div', { class: 'row' },
            el('label', { class: 'field' }, 'Lock',
              el('div', { class: 'seg' }, ...PLS_ENUMS.YK.map(([v, label]) => el('button', { class: lock === v ? (v === 0 ? 'on recall' : 'on take') : '', onclick: () => store.set('YK', [], v) }, label))))),
          el('div', { class: 'grid2' },
            bind('Display brightness', 'YB', [], 1, 8, 1, v => Math.round(v * 12.5) + '%'),
            bind('Key brightness', 'Yb', [], 10, 100, 1, v => v + '%')),
          el('div', { class: 'row' }, toggleBtn('T-bar enabled', 'YD', [], 'pvw'),
            el('span', { class: 'hint', text: store.val('yA') === 1 ? 'driven by an Orchestra controller' : '' }))),
        el('div', { class: 'panel' }, el('h2', 'Standby'),
          el('div', { class: 'row' },
            boolChip(store.val('wS') == null ? null : store.val('wS') === 1 ? 0 : 1, 'running', 'standby'),
            el('div', { class: 'spacer' }),
            el('button', { class: 'btn', onclick: () => store.set('wQ', [], 1) }, 'Standby'),
            el('button', { class: 'btn', onclick: () => store.set('wQ', [], 0) }, 'Wake')),
          el('div', { class: 'sub-head' }, 'Display device on the RS-232 port'),
          el('div', { class: 'row' },
            el('label', { class: 'field' }, 'Speed', plsEnumSelect('wR', [])),
            el('button', { class: 'btn ghost', onclick: () => store.set('wC', [], 1) }, 'Wake it'),
            el('button', { class: 'btn ghost', onclick: () => store.set('wC', [], 2) }, 'Sleep it')),
          el('div', { class: 'hint pad', text: 'The wake and sleep strings themselves (STDBYPROJ_ON/OFF) are 50 characters each — set them in the Inspector.' }))),
      el('div', { class: 'panel' },
        el('div', { class: 'row' }, el('h2', 'Maintenance'), el('div', { class: 'spacer' }),
          busy ? el('span', { class: 'chip on' }, el('span', { class: 'dot' }), `${plsEnumLabel('CK', store.val('CK'))} ${store.val('CP') ?? 0}%`) : null,
          store.val('YS') === 1 ? el('span', { class: 'chip bad' }, el('span', { class: 'dot' }), 'writing flash — do not power off') : null),
        el('div', { class: 'row' },
          el('label', { class: 'field' }, 'Arm', checkbox(armed, v => { armed = v; store.notify(); })),
          el('button', { class: 'btn ghost', disabled: !armed, onclick: () => { armed = false; store.set('YE', [], 1); } }, 'Erase stored image settings'),
          el('button', { class: 'btn ghost', disabled: !armed, onclick: () => { armed = false; store.set('YR', [], 1); } }, 'Factory reset'),
          el('button', { class: 'btn ghost', disabled: !armed, onclick: () => { armed = false; store.set('Ia', [], 1); } }, 'Autoset every input'))));
  }
  return { enter, render };
})();

VIEWS.connection = (() => {
  let entry = null;             // keypad buffer; null until seeded from meta
  let plat = null;              // 'livecore' | 'midra' | 'pls300' | 'livepremier' | 'midra4k' | 'alta4k'
  let seeded = false;

  const isDemo = () => !!globalThis.OPENRCS_DEMO_DEVICE;

  // Seeded from what the bridge reports — and, since a view opened from a
  // bookmark runs enter() before the bridge has said anything, seeded again
  // on the first render that has it, unless the operator has typed since.
  function enter() {
    if (seeded) return;
    seed();
  }
  function seed() {
    if (!store.meta) { entry = entry ?? ''; plat = plat ?? 'livecore'; return; }
    seeded = true;
    entry = store.meta.device || '';
    plat = store.meta.platform || 'livecore';
  }

  const tap = (ch) => { if (entry.length < 64) entry += ch; store.notify(); };
  const back = () => { entry = entry.slice(0, -1); store.notify(); };
  const clear = () => { entry = ''; store.notify(); };
  const canConnect = () => entry.trim().length > 0 && !isDemo();
  const connect = () => { if (canConnect()) store.setup(entry.trim(), plat); };

  // The address is typed as readily as tapped: the display is a text field the
  // keypad appends to, so a keyboard, a paste and a finger all land in the same
  // buffer. Its id is what keeps focus and the caret across the re-render every
  // device frame causes (see render()), and the tree is rebuilt only when the
  // Connect button's state changes, not on every keystroke. Enter connects.
  function addrField() {
    return el('input', {
      id: 'conn-addr', class: 'addr-display', type: 'text', value: entry,
      placeholder: 'address', maxlength: 64,
      autocomplete: 'off', autocapitalize: 'off', autocorrect: 'off', spellcheck: 'false',
      oninput: (e) => { const could = canConnect(); entry = e.target.value; if (canConnect() !== could) store.notify(); },
      onkeydown: (e) => { if (e.key === 'Enter') { e.preventDefault(); connect(); } },
    });
  }

  function keypad() {
    const keys = ['1', '2', '3', '4', '5', '6', '7', '8', '9', '.', '0', ':'];
    return el('div', { class: 'keypad' },
      keys.map(k => el('button', { class: 'key', onclick: () => tap(k) }, k)),
      el('button', { class: 'key wide', onclick: back }, '⌫'),
      el('button', { class: 'key wide', onclick: clear }, 'Clear'));
  }

  function platformPicker() {
    const pick = (p) => { plat = p; store.notify(); };
    // "Midra" is the earlier series on TCP 10500 — Pulse2, Eikos2, Saphyr,
    // SmartMatriX2, QuickMatriX, QuickVu — and the PLS300 the one before that,
    // on the same port. The 4K boxes speak the LivePremier protocol on 10606
    // and sit with it.
    return el('div', { class: 'seg big' },
      ...[['livecore', 'LiveCore'], ['midra', 'Midra'], ['pls300', 'PLS300'], ['livepremier', 'LivePremier'], ['midra4k', 'Midra 4K'], ['alta4k', 'Alta 4K']]
        .map(([id, name]) => el('button', { class: plat === id ? 'on recall' : '', onclick: () => pick(id) }, name)));
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
        el('span', { class: 'v val', text: store.configured ? platformName(store.meta?.platform) || '·' : '·' })),
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
    if (!seeded) seed();
    if (entry === null) enter();
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
          addrField(),
          keypad(),
          el('div', { class: 'hint pad', text: 'Type it, or tap it in. A hostname works too. The control port is added automatically.' })),
        el('div', { class: 'panel' }, el('h2', 'Platform'),
          platformPicker(),
          plat === 'midra4k' || plat === 'alta4k' || (isAwj() && awjDialect() === 'mng') ? el('label', { class: 'field' }, 'Thumbnails from (host:port)',
            el('input', { type: 'text', placeholder: 'the processor, port 80', value: (() => { try { return localStorage.getItem('orcs.snapshotOrigin') || ''; } catch { return ''; } })(),
              onchange: (e) => { try { const v = e.target.value.trim(); if (v) localStorage.setItem('orcs.snapshotOrigin', v); else localStorage.removeItem('orcs.snapshotOrigin'); } catch { /* private mode */ } MNG_SNAP_TICK++; store.notify(); } }),
            el('span', { class: 'hint', text: 'A unit serves its snapshots on port 80. Only a simulator, which serves them wherever it was started, needs this.' })) : null,
          el('div', { class: 'hint pad', text: 'LiveCore: Ascender, NeXtage, SmartMatriX Ultra. Midra: Pulse2, Eikos2, Saphyr, SmartMatriX2, QuickMatriX, QuickVu. PLS300: the Pulse PLS300 (LAN must be enabled on its front panel first). LivePremier: Aquilon. Midra 4K: QuickVu 4K, Pulse 4K, Eikos 4K, QuickMatrix 4K. Alta 4K: Zenith 100, Zenith 200.' }),
          store.setupError
            ? el('div', { class: 'hint pad bad', text: `Rejected: ${store.setupError}` })
            : null,
          el('button', {
            class: 'btn primary big', disabled: !canConnect(),
            onclick: connect,
          }, 'Connect'))));
  }

  return { enter, render };
})();

render();
