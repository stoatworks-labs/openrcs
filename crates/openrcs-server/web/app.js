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
const MODELS = {
  97: 'NeXtage 16', 96: 'NeXtage 08',
  98: 'Ascender 16', 99: 'Ascender 32', 100: 'Ascender 48',
  101: 'SmartMatriX Ultra', 112: 'VIO 4K',
};

// ---------- store ----------
class Store {
  constructor() {
    this.state = new Map();          // "MNEM|i,i" -> value
    this.byMnem = new Map();         // mnemonic -> def
    this.byGroup = new Map();        // group -> [def]
    this.meta = null;
    this.connected = false;
    this.log = [];                   // {dir, text}
    this.listeners = new Set();
    this._pending = false;
    this.connect();
  }
  connect() {
    this.ws = new WebSocket(`ws://${location.host}/ws`);
    this.ws.onmessage = (e) => this.onMsg(JSON.parse(e.data));
    this.ws.onclose = () => { this.connected = false; this.notify(); setTimeout(() => this.connect(), 1500); };
  }
  onMsg(m) {
    switch (m.t) {
      case 'meta':
        this.meta = m;
        for (const v of m.vars) {
          this.byMnem.set(v.m, v);
          if (!this.byGroup.has(v.group)) this.byGroup.set(v.group, []);
          this.byGroup.get(v.group).push(v);
        }
        onReady();
        break;
      case 'snap':
        for (const [mn, i, v] of m.items) this.state.set(keyOf(mn, i), v);
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
  // value accessor, by answer mnemonic (what the device sends)
  val(m, ...idx) { return this.state.get(keyOf(m, idx)); }
  arr(m, n) { return Array.from({ length: n }, (_, i) => this.val(m, i)); }

  send(o) { if (this.ws.readyState === 1) this.ws.send(JSON.stringify(o)); }
  set(m, idx, v) { this.send({ t: 'set', m, i: idx, v }); this.pushLog('tx', `${m} ${[...idx, v].join(',')}`); }
  get(m, idx = []) { this.send({ t: 'get', m, i: idx }); }
  scan(m) { this.send({ t: 'scan', m }); }
  raw(d) { this.send({ t: 'raw', d: d.endsWith('\n') ? d : d + '\n' }); this.pushLog('tx', d); }

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
const VIEW_IDS = ['stage', 'memories', 'cues', 'live', 'layers', 'inputs', 'outputs', 'screens', 'stills', 'system', 'inspector', 'console'];
const viewFromHash = () => { const h = location.hash.slice(1); return VIEW_IDS.includes(h) ? h : null; };
let currentView = viewFromHash() || 'memories';
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
  store.get('?');            // DEV
  store.get('!');            // DEV_PLATFORM -> PDEV
  VIEWS[currentView].enter?.();
}

function header() {
  const dev = store.val('PDEV');
  const model = dev != null ? (MODELS[dev] || `device ${dev}`) : '—';
  const plat = store.meta ? store.meta.platform : '';
  return el('header', { class: 'head' },
    el('div', { class: 'brand', html: 'open<span>rcs</span>' }),
    el('div', { class: 'dev-id' },
      el('div', { class: 'model', text: model }),
      el('div', { class: 'sub', text: `${plat.toUpperCase()} · :${store.meta?.port ?? ''}` })),
    el('div', { class: 'spacer' }),
    el('div', { class: 'legend' },
      el('span', { class: 'pgm' }, el('b'), 'program'),
      el('span', { class: 'pvw' }, el('b'), 'preview')),
    el('div', { class: 'chip ' + (store.connected ? 'on' : 'off') },
      el('span', { class: 'dot' }), store.connected ? 'ONLINE' : 'OFFLINE'));
}

const NAV = [
  { section: 'Program' },
  ['stage', 'Stage'], ['memories', 'Memories'], ['cues', 'Cues'], ['live', 'Live'], ['layers', 'Layers'],
  { section: 'Setup' },
  ['inputs', 'Inputs'], ['outputs', 'Outputs'], ['screens', 'Screens'],
  ['stills', 'Stills'], ['system', 'System'],
  { section: 'Tools' },
  ['inspector', 'Inspector'], ['console', 'Console'],
];

function nav() {
  const n = el('nav', { class: 'nav' });
  for (const item of NAV) {
    if (item.section) { n.append(el('div', { class: 'nav-sec', text: item.section })); continue; }
    const [id, label] = item;
    n.append(el('button', {
      class: id === currentView ? 'active' : '',
      onclick: () => switchView(id),
    }, label));
  }
  n.append(el('div', { class: 'grow' }));
  n.append(el('div', { class: 'foot', text: store.meta ? `${store.byMnem.size} vars` : 'connecting…' }));
  return n;
}

function render() {
  const root = document.getElementById('app');
  // preserve focus + caret across full re-render (device frames re-render us)
  const act = document.activeElement;
  const fid = act && act.id ? act.id : null;
  const selS = fid ? act.selectionStart : null;
  const selE = fid ? act.selectionEnd : null;

  root.replaceChildren(
    header(),
    nav(),
    el('main', { class: 'main' }, VIEWS[currentView].render()),
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

// ---------- Memories ----------
VIEWS.memories = (() => {
  let scope = 'master';          // 'master' | 'screen'
  let mode = 'recall';           // 'recall' | 'take' | 'save'
  let screen = 0;
  let selected = null;

  function enter() {
    store.scan('PSval');         // master validity
    store.scan('PMscw');         // screen-memory content width (>0 = present)
    store.scan('PMmly');         // stored layer count
    store.scan('SCmly');         // per-screen max layers
  }

  function slotTap(n) {
    selected = n;
    if (scope === 'master') {
      store.set('PSmet', [], n);                       // target slot
      if (mode === 'recall') store.set('PSloa', [], 1);
      else if (mode === 'take') store.set('PSlot', [], 1);
      else if (mode === 'save') { store.set('PSprf', [], 0); store.set('PSsav', [], 1); store.scan('PSval'); }
    } else {
      store.set('PMscf', [], screen);
      store.set('PMmet', [], n);
      if (mode === 'recall') store.set('PMloa', [], 1);
      else if (mode === 'take') store.set('PMlot', [], 1);
      else if (mode === 'save') { store.set('PMprf', [], 0); store.set('PMsav', [], 1); store.scan('PMscw'); }
    }
    store.notify();
  }

  function grid() {
    const g = el('div', { class: `mem-grid mode-${mode}` });
    const N = 144;
    for (let i = 0; i < N; i++) {
      let valid, cls = 'slot';
      if (scope === 'master') valid = store.val('PSval', i) === 1;
      else valid = (store.val('PMscw', i) || 0) > 0;
      if (valid) cls += ' valid';
      if (selected === i) cls += ' sel';
      g.append(el('button', { class: cls, onclick: () => slotTap(i) },
        el('span', { class: 'num', text: i + 1 }),
        valid ? el('span', { class: 'lbl', text: scope === 'screen' ? `${store.val('PMmly', i) ?? 0} lyr` : 'saved' }) : null));
    }
    return g;
  }

  function render() {
    const validCount = scope === 'master'
      ? store.arr('PSval', 144).filter(v => v === 1).length
      : store.arr('PMscw', 144).filter(v => (v || 0) > 0).length;

    return el('div', {},
      el('div', { class: 'view-head' },
        el('h1', { text: 'Memories' }),
        el('span', { class: 'hint', text: `${validCount} saved · tap a slot to ${mode === 'save' ? 'save into' : mode === 'take' ? 'load + take' : 'recall to preview'}` })),

      el('div', { class: 'panel' },
        el('div', { class: 'row' },
          el('div', { class: 'seg' },
            el('button', { class: scope === 'master' ? 'on recall' : '', onclick: () => { scope = 'master'; selected = null; render2(); } }, 'Master'),
            el('button', { class: scope === 'screen' ? 'on recall' : '', onclick: () => { scope = 'screen'; selected = null; render2(); } }, 'Screen')),
          scope === 'screen' ? el('label', { class: 'field' }, 'Screen',
            screenSelect(screen, v => { screen = v; enter(); render2(); })) : null,
          el('div', { class: 'spacer' }),
          el('div', { class: 'seg' },
            el('button', { class: 'recall ' + (mode === 'recall' ? 'on' : ''), onclick: () => { mode = 'recall'; render2(); } }, 'Recall'),
            el('button', { class: 'take ' + (mode === 'take' ? 'on' : ''), onclick: () => { mode = 'take'; render2(); } }, 'Load + Take'),
            el('button', { class: 'save ' + (mode === 'save' ? 'on' : ''), onclick: () => { mode = 'save'; render2(); } }, 'Save')))),

      el('div', { class: 'panel' }, grid()));
  }
  const render2 = () => render && store.notify();

  return { enter, render };
})();

function screenSelect(val, onchange) {
  const s = el('select', { onchange: (e) => onchange(+e.target.value) });
  for (let i = 0; i < 8; i++) {
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

function sourceName(n) { return n == null ? '·' : n === 0 ? '— none —' : 'IN ' + n; }

function sourceSelect(mnem, idx, max = 41) {
  const cur = store.val(mnem, ...idx);
  const s = el('select', { onchange: (e) => store.set(mnem, idx, +e.target.value) });
  for (let i = 0; i <= max; i++) {
    const opt = el('option', { value: i, text: sourceName(i) });
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
  let cues = [];      // { id, label, scope:'master'|'screen', slot, screen }
  let cur = -1;       // index of the last cue taken
  try {
    const saved = JSON.parse(localStorage.getItem(KEY) || '{}');
    cues = saved.cues || []; cur = saved.cur ?? -1;
  } catch { /* first run */ }
  const persist = () => localStorage.setItem(KEY, JSON.stringify({ cues, cur }));

  // draft for the "add cue" row
  let dScope = 'master', dSlot = 1, dScreen = 0, dLabel = '';

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
  function go(i) { if (i < 0 || i >= cues.length) return; recall(cues[i], true); cur = i; persist(); store.notify(); }
  function goNext() { go(cur + 1 < cues.length ? cur + 1 : cur); }
  function arm(i) { recall(cues[i], false); store.notify(); }
  function addCue() {
    const label = dLabel.trim() || (dScope === 'master' ? `Master ${dSlot}` : `Screen ${dScreen + 1} · ${dSlot}`);
    cues.push({ id: Date.now(), label, scope: dScope, slot: dSlot, screen: dScreen });
    dLabel = ''; persist(); store.notify();
  }
  function move(i, d) { const j = i + d; if (j < 0 || j >= cues.length) return; [cues[i], cues[j]] = [cues[j], cues[i]]; if (cur === i) cur = j; else if (cur === j) cur = i; persist(); store.notify(); }
  function del(i) { cues.splice(i, 1); if (cur >= cues.length) cur = cues.length - 1; persist(); store.notify(); }

  function cueRow(c, i) {
    const target = c.scope === 'master' ? `Master ${c.slot + 1}` : `Screen ${c.screen + 1} · slot ${c.slot + 1}`;
    return el('div', { class: 'cue' + (i === cur ? ' current' : '') },
      el('span', { class: 'cue-n', text: i + 1 }),
      el('div', { class: 'cue-main' },
        el('div', { class: 'cue-label', text: c.label }),
        el('div', { class: 'cue-target', text: target })),
      el('button', { class: 'btn ghost', onclick: () => arm(i) }, 'Preview'),
      el('button', { class: 'btn pvw', onclick: () => go(i) }, 'Go'),
      el('div', { class: 'cue-ord' },
        el('button', { class: 'btn ghost', onclick: () => move(i, -1) }, '↑'),
        el('button', { class: 'btn ghost', onclick: () => move(i, 1) }, '↓'),
        el('button', { class: 'btn ghost', onclick: () => del(i) }, '✕')));
  }

  function render() {
    const next = cur + 1 < cues.length ? cues[cur + 1] : null;
    return el('div', {},
      el('div', { class: 'view-head' }, el('h1', { text: 'Cues' }),
        el('span', { class: 'hint', text: 'A show script — each cue recalls a memory and takes it' })),
      el('div', { class: 'panel' },
        el('div', { class: 'takebar' },
          el('div', { class: 'tbar' },
            el('div', { class: 'cue-next-label', text: next ? `Next: ${next.label}` : (cues.length ? 'End of list' : 'No cues yet') })),
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
            el('input', { id: 'cue-label', type: 'text', placeholder: 'optional', value: dLabel, style: 'width:200px',
              oninput: (e) => dLabel = e.target.value })),
          el('button', { class: 'btn', onclick: addCue }, 'Add'))),
      el('div', { class: 'panel' },
        el('h2', `Cue list (${cues.length})`),
        cues.length
          ? el('div', { class: 'cue-list' }, ...cues.map(cueRow))
          : el('div', { class: 'empty-state', text: 'Build a cue list from your saved memories, then run the show with GO NEXT.' })));
  }
  return { render };
})();

// ---------- Live ----------
VIEWS.live = (() => {
  let screen = 0;
  let ttime = 1000;

  function enter() {
    store.scan('SCmly');
    for (let l = 0; l < 24; l++) { store.get('PRinp', [screen, 0, l]); store.get('PRlay', [screen, 0, l]); }
    store.get('GCtup', [screen]); store.get('MAsna', [screen]); store.get('MAfat', []);
  }

  function take() { store.set('GCtup', [screen], ttime); store.set('GCtku', [screen], 1); }
  function cut() { store.set('GCtfr', [screen], 1); }
  // MAmfa (master fade auto): 1 = fade to black, 2 = fade up. Best-effort mapping.
  function fadeToBlack() { store.set('MAmfa', [screen], 1); }
  function fadeUp() { store.set('MAmfa', [screen], 2); }

  function layers() {
    const max = store.val('SCmly', screen) || 0;
    if (max === 0) return el('div', { class: 'empty-state', text: 'This screen has no layers. Configure it in Screens, or on the device, then layers appear here.' });
    const wrap = el('div', { class: 'layers' });
    for (let l = 0; l < max; l++) {
      const src = store.val('PRinp', screen, 0, l);
      const on = store.val('PRlay', screen, 0, l) === 1;
      wrap.append(el('div', { class: 'layer' + (on ? ' on' : '') },
        el('span', { class: 'tag', text: 'L' + (l + 1) }),
        el('span', { class: 'src', text: src != null ? (src === 0 ? '— none —' : 'IN ' + src) : '·' }),
        el('button', { class: 'btn ghost', onclick: () => store.set('PRlay', [screen, 0, l], on ? 0 : 1) }, on ? 'Hide' : 'Show')));
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
      el('div', { class: 'panel' },
        el('h2', 'Master fade'),
        el('div', { class: 'row' },
          bind('Fade time', 'MAfat', [], 0, 100, 1, v => (v / 10).toFixed(1) + 's'),
          el('div', { class: 'spacer' }),
          el('button', { class: 'btn', onclick: fadeUp }, 'Fade Up'),
          el('button', { class: 'btn pgm', onclick: fadeToBlack }, 'Fade to Black'))),
      el('div', { class: 'panel' }, el('h2', `Screen ${screen + 1} layers`), layers()));
  }
  return { enter, render };
})();

// ---------- Layers (graphical arrangement editor) ----------
// Layer geometry on the wire: PRpoh/PRpov are the layer CENTRE in screen pixels
// biased by +POS_BIAS (so a centred full-screen 1080p layer reads 33728,33308 =
// 32768 + 960,540). PRsih/PRsiv are the size in pixels.
const POS_BIAS = 32768;
// transition-type labels are best-effort; 0 is always "cut" (no animation)
const TRANSITIONS = ['Cut', 'Fade', 'Slide', 'Wipe', 'Zoom', 'Rotate', 'Push', 'Effect 7'];

VIEWS.layers = (() => {
  let screen = 0;
  let ctx = 1;             // PRESET context: 0 = program, 1 = preview (edit here)
  let sel = 0;             // selected layer

  const count = () => { const m = store.val('SCmly', screen) || 0; return m > 0 ? m : 8; };
  const screenPx = () => ({
    w: store.val('SCssh', screen) || 1920,
    h: store.val('SCssv', screen) || 1080,
  });

  const LAYER_VARS = ['PRinp', 'PRlay', 'PRalp', 'PRpoh', 'PRpov', 'PRsih', 'PRsiv',
    'PRbst', 'PRbcr', 'PRbcg', 'PRbcb', 'PRbsh', 'PRbsv', 'PRbal',
    'PRcph', 'PRcpv', 'PRcsh', 'PRcsv', 'PRotr', 'PRowa', 'PRctr', 'PRcwa'];
  function enter() {
    store.scan('SCmly'); store.scan('SCssh'); store.scan('SCssv');
    const n = count();
    for (let l = 0; l < n; l++)
      for (const m of LAYER_VARS) store.get(m, [screen, ctx, l]);
  }

  // device layer -> {left,top,w,h} in device pixels
  function rectPx(l) {
    const cx = (store.val('PRpoh', screen, ctx, l) ?? POS_BIAS) - POS_BIAS;
    const cy = (store.val('PRpov', screen, ctx, l) ?? POS_BIAS) - POS_BIAS;
    const w = store.val('PRsih', screen, ctx, l) ?? 0;
    const h = store.val('PRsiv', screen, ctx, l) ?? 0;
    return { left: cx - w / 2, top: cy - h / 2, w, h };
  }
  const setGeom = (l, r) => {
    throttledSet('PRsih', [screen, ctx, l], Math.round(r.w));
    throttledSet('PRsiv', [screen, ctx, l], Math.round(r.h));
    throttledSet('PRpoh', [screen, ctx, l], Math.round(r.left + r.w / 2 + POS_BIAS));
    throttledSet('PRpov', [screen, ctx, l], Math.round(r.top + r.h / 2 + POS_BIAS));
  };

  function canvas() {
    const s = screenPx();
    const CW = 720, scale = CW / s.w, CH = s.h * scale;
    const cv = el('div', { class: 'screen-canvas', style: `width:${CW}px;height:${Math.round(CH)}px` });
    const n = count();
    for (let l = 0; l < n; l++) {
      const on = store.val('PRlay', screen, ctx, l) === 1;
      const src = store.val('PRinp', screen, ctx, l);
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
    const s = screenPx();
    setGeom(sel, { left: 0, top: 0, w: s.w, h: s.h }); store.notify();
  }
  function quad(ix) {
    const s = screenPx(), w = s.w / 2, h = s.h / 2;
    setGeom(sel, { left: (ix % 2) * w, top: (ix < 2 ? 0 : 1) * h, w, h }); store.notify();
  }

  function stack() {
    const n = count();
    const wrap = el('div', { class: 'layers' });
    for (let l = n - 1; l >= 0; l--) {
      const src = store.val('PRinp', screen, ctx, l);
      const on = store.val('PRlay', screen, ctx, l) === 1;
      wrap.append(el('div', { class: 'layer' + (on ? ' on' : '') + (l === sel ? ' sel' : ''), onclick: () => { sel = l; store.notify(); } },
        el('span', { class: 'tag', text: 'L' + (l + 1) }),
        el('span', { class: 'src', text: sourceName(src) }),
        el('button', { class: 'btn ghost', onclick: (e) => { e.stopPropagation(); store.set('PRlay', [screen, ctx, l], on ? 0 : 1); } }, on ? 'Hide' : 'Show')));
    }
    return wrap;
  }

  function editor() {
    const i = [screen, ctx, sel];
    return el('div', { class: 'editor' },
      el('div', { class: 'row' },
        el('label', { class: 'field' }, 'Source', sourceSelect('PRinp', i)),
        el('button', { class: 'btn ' + (store.val('PRlay', ...i) === 1 ? 'pgm' : 'ghost'), onclick: () => store.set('PRlay', i, store.val('PRlay', ...i) === 1 ? 0 : 1) },
          store.val('PRlay', ...i) === 1 ? 'Visible' : 'Hidden')),
      el('div', { class: 'row' },
        el('span', { class: 'hint', text: 'Snap:' }),
        el('button', { class: 'btn ghost', onclick: fit }, 'Full'),
        ...['◰', '◳', '◱', '◲'].map((g, k) => el('button', { class: 'btn ghost', onclick: () => quad(k) }, g))),
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
        el('span', { class: 'hint', text: `Screen ${screen + 1} · ${ctx === 1 ? 'Preview' : 'Program'} · drag to arrange` })),
      el('div', { class: 'panel' },
        el('div', { class: 'row' },
          el('label', { class: 'field' }, 'Screen', screenSelect(screen, v => { screen = v; sel = 0; enter(); store.notify(); })),
          el('div', { class: 'seg' },
            el('button', { class: ctx === 0 ? 'on take' : '', onclick: () => { ctx = 0; enter(); store.notify(); } }, 'Program'),
            el('button', { class: ctx === 1 ? 'on recall' : '', onclick: () => { ctx = 1; enter(); store.notify(); } }, 'Preview')),
          !configured ? el('span', { class: 'hint', text: '⚠ screen not configured — edits are stored but won’t display until a screen is set up' }) : null)),
      el('div', { class: 'split-wide' },
        el('div', { class: 'panel' }, el('h2', 'Arrangement'), canvas()),
        el('div', {},
          el('div', { class: 'panel' }, el('h2', 'Layer stack'), stack()),
          el('div', { class: 'panel' }, el('h2', `Layer ${sel + 1}`), editor()))));
  }
  return { enter, render, focus(s, c) { screen = s; if (c != null) ctx = c; sel = 0; } };
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
  let ctx = 0;   // 0 = program (what's on air), 1 = preview
  const NL = 24;
  const active = () => [0, 1, 2, 3, 4, 5, 6, 7].filter(s => (store.val('SCssh', s) || 0) > 0);

  function enter() {
    for (const m of ['SCssh', 'SCssv', 'SCmly']) store.scan(m);
    for (const s of [0, 1, 2, 3, 4, 5, 6, 7])
      for (let l = 0; l < NL; l++)
        for (const m of ['PRinp', 'PRlay', 'PRpoh', 'PRpov', 'PRsih', 'PRsiv'])
          store.get(m, [s, ctx, l]);
  }

  function screenCard(s) {
    const sw = store.val('SCssh', s) || 1920, sh = store.val('SCssv', s) || 1080;
    const CW = 380, scale = CW / sw, CH = Math.round(sh * scale);
    const cv = el('div', { class: 'stage-screen', style: `width:${CW}px;height:${CH}px` });
    const max = store.val('SCmly', s) || 0;
    for (let l = 0; l < max; l++) {
      if (store.val('PRlay', s, ctx, l) !== 1) continue;
      const src = store.val('PRinp', s, ctx, l);
      const r = layerRectPx(s, ctx, l);
      cv.append(el('div', {
        class: 'stage-layer',
        style: `left:${r.left * scale}px;top:${r.top * scale}px;width:${r.w * scale}px;height:${r.h * scale}px;`
             + `background:${srcColor(src)};z-index:${l + 1}`,
      }, el('span', { text: sourceName(src) })));
    }
    return el('div', { class: 'stage-card', onclick: () => { VIEWS.layers.focus(s, ctx); switchView('layers'); } },
      el('div', { class: 'stage-head' },
        el('span', { class: 'stage-name', text: `Screen ${s + 1}` }),
        el('span', { class: 'stage-dim', text: `${sw}×${sh} · ${store.val('SCmly', s) || 0} layers` })),
      cv);
  }

  function render() {
    const screens = active();
    return el('div', {},
      el('div', { class: 'view-head' }, el('h1', { text: 'Stage' }),
        el('span', { class: 'hint', text: `${screens.length} active screen${screens.length === 1 ? '' : 's'} · click one to edit its layers` })),
      el('div', { class: 'panel' },
        el('div', { class: 'row' },
          el('div', { class: 'seg' },
            el('button', { class: ctx === 0 ? 'on take' : '', onclick: () => { ctx = 0; enter(); store.notify(); } }, 'Program'),
            el('button', { class: ctx === 1 ? 'on recall' : '', onclick: () => { ctx = 1; enter(); store.notify(); } }, 'Preview')))),
      screens.length
        ? el('div', { class: 'stage-grid' }, ...screens.map(screenCard))
        : el('div', { class: 'panel' }, el('div', { class: 'empty-state', text: 'No screens configured yet.' })));
  }
  return { enter, render };
})();

// ---------- Screens ----------
VIEWS.screens = (() => {
  function enter() { store.scan('SCmly'); store.scan('OSsou'); store.scan('SCsih'); store.scan('SCsiv'); }
  function render() {
    const rows = [];
    for (let i = 0; i < 8; i++) {
      const max = store.val('SCmly', i);
      rows.push(el('tr', {},
        el('td', { text: 'Screen ' + (i + 1) }),
        el('td', { class: 'val', text: fmt(store.val('OSsou', i)) }),
        el('td', { class: 'val', text: `${fmt(store.val('SCsih', i))}×${fmt(store.val('SCsiv', i))}` }),
        el('td', { class: 'val', text: fmt(max) }),
        el('td', {}, (max || 0) > 0 ? el('span', { class: 'chip on' }, el('span', { class: 'dot' }), 'active') : el('span', { class: 'chip off' }, el('span', { class: 'dot' }), 'unused'))));
    }
    return el('div', {},
      el('div', { class: 'view-head' }, el('h1', { text: 'Screens' }), el('span', { class: 'hint', text: 'Output screens and their layer capacity' })),
      el('div', { class: 'panel' },
        el('table', { class: 'grid' },
          el('thead', {}, el('tr', {}, ...['Screen', 'Output', 'Size (mode)', 'Max layers', 'State'].map(h => el('th', { text: h })))),
          el('tbody', {}, ...rows))));
  }
  return { enter, render };
})();
const fmt = (v) => v == null ? '·' : String(v);
// alarm truthiness: null stays null, else nonzero = fault
const nz = (v) => v == null ? null : v !== 0;
// card temperature in 0.1 °C units; 0 and 0xFFFF mean "no sensor"
const temp = (v) => (v == null || v === 0 || v === 65535) ? '·' : (v / 10).toFixed(1) + ' °C';

// ---------- Inputs ----------
VIEWS.inputs = (() => {
  const N = 24;
  function enter() {
    for (const m of ['INava', 'INplg', 'INfrz', 'INffz', 'INbla', 'INpat']) store.scan(m);
    for (const m of ['ISspr', 'ISsva', 'IScfo', 'ISswi', 'ISshe']) store.scan(m);
  }
  function row(i) {
    const avail = store.val('INava', i) === 1;
    const plug = store.val('INplg', i) ?? 0;
    const present = store.val('ISspr', i, plug);
    const valid = store.val('ISsva', i, plug);
    const w = store.val('ISswi', i, plug), h = store.val('ISshe', i, plug);
    const frozen = store.val('INfrz', i) === 1;
    const black = store.val('INbla', i) === 1;
    return el('tr', { class: avail ? '' : 'dim' },
      el('td', { text: 'IN ' + (i + 1) }),
      el('td', {}, boolChip(avail ? 1 : 0, 'ready', 'unused')),
      el('td', { class: 'val', text: 'P' + (plug + 1) }),
      el('td', {}, boolChip(valid === 1 ? 1 : present === 1 ? 0 : (present == null ? null : 0), 'valid', present === 1 ? 'unstable' : 'no signal')),
      el('td', { class: 'val', text: (w && h) ? `${w}×${h}` : '·' }),
      el('td', {},
        el('button', { class: 'btn ghost' + (frozen ? ' pgm' : ''), onclick: () => store.set('INfrz', [i], frozen ? 0 : 1) }, 'Freeze'),
        el('button', { class: 'btn ghost' + (black ? ' pgm' : ''), style: 'margin-left:6px', onclick: () => store.set('INbla', [i], black ? 0 : 1) }, 'Black')));
  }
  function render() {
    const ready = Array.from({ length: N }, (_, i) => store.val('INava', i)).filter(v => v === 1).length;
    const rows = Array.from({ length: N }, (_, i) => row(i));
    return el('div', {},
      el('div', { class: 'view-head' }, el('h1', { text: 'Inputs' }), el('span', { class: 'hint', text: `${ready} of ${N} ready` })),
      el('div', { class: 'panel', style: 'overflow:auto' },
        el('table', { class: 'grid' },
          el('thead', {}, el('tr', {}, ...['Input', 'State', 'Plug', 'Signal', 'Size', ''].map(h => el('th', { text: h })))),
          el('tbody', {}, ...rows))));
  }
  return { enter, render };
})();

// ---------- Outputs ----------
VIEWS.outputs = (() => {
  const N = 8;
  let sel = 0;
  const FORMATS = Array.from({ length: 55 }, (_, i) => i === 0 ? 'Auto' : `Format ${i}`);
  function enter() {
    for (const m of ['OUava', 'OUena', 'OUuse', 'OUfst', 'OUfor', 'OUbla', 'OUshs', 'OUsvs', 'OUhdc',
      'OCgam', 'OCbri', 'OCcon', 'OCgre', 'OCggr', 'OCgbl']) store.scan(m);
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
  function detail() {
    const i = [sel];
    return el('div', { class: 'editor' },
      el('div', { class: 'row' },
        el('label', { class: 'field' }, 'Format', enumSelect('OUfor', i, FORMATS)),
        toggleBtn('HDCP', 'OUhdc', i),
        toggleBtn('Black', 'OUbla', i, 'pgm')),
      el('div', { class: 'sub-head' }, 'Output processing'),
      el('div', { class: 'grid2' },
        bind('Brightness', 'OCbri', i, 0, 255, 1),
        bind('Contrast', 'OCcon', i, 0, 255, 1),
        bind('Gamma', 'OCgam', i, 5, 40, 1, v => (v / 10).toFixed(1)),
        bind('Gain R', 'OCgre', i, 0, 255, 1),
        bind('Gain G', 'OCggr', i, 0, 255, 1),
        bind('Gain B', 'OCgbl', i, 0, 255, 1)));
  }
  function render() {
    const rows = Array.from({ length: N }, (_, i) => row(i));
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

// ---------- Stills ----------
VIEWS.stills = (() => {
  const N = 101;
  let sel = null;
  function enter() { for (const m of ['Slval', 'SLusd', 'SLiwd', 'SLihe']) store.scan(m); }
  function render() {
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

// ---------- System ----------
VIEWS.system = (() => {
  function enter() {
    for (const m of ['DIdsn', 'DIdre', 'ITlpo', 'ITldp', 'TEdal', 'FAalm', 'VEvar', 'CTloc', 'CTkbr'])
      store.get(m, store.byMnem.get(m)?.dims.length ? [0] : []);
    for (let k = 0; k < 4; k++) { store.get('ITlip', [0, k]); store.get('ITlnk', [0, k]); store.get('ITlgw', [0, k]); }
    store.get('TEcar', [0, 0]); store.get('VEmic', [0, 0]);
  }
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
          kv('Model', MODELS[store.val('PDEV')] || `dev ${store.val('PDEV') ?? '·'}`),
          kv('Serial', fmt(store.val('DIdsn', 0))),
          kv('Reference', fmt(store.val('DIdre', 0))),
          kv('Firmware var', fmt(store.val('VEvar', 0))),
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

render();
