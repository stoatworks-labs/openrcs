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
const VIEW_IDS = ['stage', 'memories', 'cues', 'keys', 'live', 'layers', 'tally', 'inputs', 'outputs', 'screens', 'stills', 'capture', 'multiview', 'gpio', 'system', 'inspector', 'console'];
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
  ['stage', 'Stage'], ['memories', 'Memories'], ['cues', 'Cues'], ['keys', 'Keys'], ['live', 'Live'], ['layers', 'Layers'],
  { section: 'Setup' },
  ['tally', 'Tally'], ['inputs', 'Inputs'], ['outputs', 'Outputs'], ['screens', 'Screens'],
  ['stills', 'Stills'], ['capture', 'Capture'], ['multiview', 'Multiviewer'], ['gpio', 'GPIO'], ['system', 'System'],
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
      case 'take': if (a.screen < 0) { for (let s = 0; s < 8; s++) store.set('GCtku', [s], 1); } else store.set('GCtku', [a.screen], 1); break;
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
    for (const m of ['PNinp', 'PNalp', 'PNbcr', 'PNbcg', 'PNbcb']) store.get(m, [screen, ctx]);
    const n = count();
    for (let l = 0; l < n; l++)
      for (const m of LAYER_VARS) store.get(m, [screen, ctx, l]);
  }

  function background() {
    const i = [screen, ctx];
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
  // reorder the selected layer in the screen's z-stack (LAYER_SWAP)
  function reorder(dir) {
    store.set('LSscr', [], screen);
    store.set('LSprs', [], ctx);       // preset = program/preview context (GUESSED)
    store.set('LSlay', [], sel);
    store.set(dir === 'up' ? 'LSrai' : 'LSlow', [], 1);
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
          el('div', { class: 'panel' }, el('h2', 'Background'), background()),
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
  let ttime = 1000;
  const NL = 24;
  const active = () => [0, 1, 2, 3, 4, 5, 6, 7].filter(s => (store.val('SCssh', s) || 0) > 0);
  function takeAll() { for (const s of active()) { store.set('GCtup', [s], ttime); store.set('GCtku', [s], 1); } }
  function cutAll() { for (const s of active()) store.set('GCtfr', [s], 1); }

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
        el('div', { class: 'takebar' },
          el('div', { class: 'seg' },
            el('button', { class: ctx === 0 ? 'on take' : '', onclick: () => { ctx = 0; enter(); store.notify(); } }, 'Program'),
            el('button', { class: ctx === 1 ? 'on recall' : '', onclick: () => { ctx = 1; enter(); store.notify(); } }, 'Preview')),
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

// ---------- Tally (live on-air indicators) ----------
VIEWS.tally = (() => {
  const N = 42;   // sources: inputs, stills and internal generators
  function enter() { store.scan('TAopr'); store.scan('TAopw'); store.scan('INava'); }
  function tile(i) {
    const pgm = store.val('TAopr', i) === 1;
    const pvw = store.val('TAopw', i) === 1;
    const cls = 'tally-tile' + (pgm ? ' pgm' : pvw ? ' pvw' : '');
    return el('div', { class: cls },
      el('span', { class: 'tally-src', text: 'IN ' + (i + 1) }),
      el('span', { class: 'tally-state', text: pgm ? 'PGM' : pvw ? 'PVW' : '' }));
  }
  function render() {
    const onPgm = Array.from({ length: N }, (_, i) => store.val('TAopr', i)).filter(v => v === 1).length;
    const onPvw = Array.from({ length: N }, (_, i) => store.val('TAopw', i)).filter(v => v === 1).length;
    return el('div', {},
      el('div', { class: 'view-head' }, el('h1', { text: 'Tally' }),
        el('span', { class: 'hint', text: `${onPgm} on program · ${onPvw} on preview` })),
      el('div', { class: 'panel' },
        el('div', { class: 'tally-grid' }, ...Array.from({ length: N }, (_, i) => tile(i)))));
  }
  return { enter, render };
})();

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
