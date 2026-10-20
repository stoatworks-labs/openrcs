// node plugins/speed-editor/plugin.test.mjs — the page half, with no panel.
//
// The bridge's half (src/speed_editor.rs) is tested in Rust against a fake
// panel. This drives the page's half through a fake host: the bridge's notes
// and reports in, the writes and the lease out — the way the real bridge
// sends them, as plain JSON on the plugin channel.
import assert from 'node:assert/strict';
import plugin from './plugin.js';

const tick = () => new Promise((r) => setTimeout(r, 0));

globalThis.sessionStorage = {
  data: new Map(),
  getItem(k) { return this.data.has(k) ? this.data.get(k) : null; },
  setItem(k, v) { this.data.set(k, String(v)); },
  removeItem(k) { this.data.delete(k); },
};

function fakeHost() {
  const sent = [];          // everything sent to the bridge, writes and leases alike
  const sets = [];
  const calls = [];
  const values = new Map();
  const leaseState = { held: false, listeners: [] };
  let bridgeListener = null;
  let view = null;
  const host = {
    el: (tag, props = {}, ...kids) => {
      if (props == null || typeof props !== 'object' || Array.isArray(props) || props.tag) { kids = [props, ...kids]; props = {}; }
      return { tag, props, kids: kids.flat().filter((k) => k != null && k !== false) };
    },
    store: {
      val: (m, ...idx) => values.get(`${m}:${idx.join(',')}`),
      set: (m, idx, v) => { sets.push([m, idx, v]); values.set(`${m}:${idx.join(',')}`, v); },
      subscribe: () => {},
      byMnem: new Map([['PRalp', { min: 0, max: 255 }], ['GCtba', { min: 0, max: 255 }]]),
    },
    notify: () => {},
    lease: (name) => {
      assert.equal(name, 'driver');
      return {
        want: (on = true) => sent.push({ t: 'lease', want: on }),
        take: () => sent.push({ t: 'lease', want: true, take: true }),
        held: () => leaseState.held,
        onChange: (fn) => leaseState.listeners.push(fn),
      };
    },
    onBridge: (fn) => { bridgeListener = fn; },
    bridge: (msg) => sent.push(msg),
    bridged: () => true,
    view: (id, label, v) => { view = v; },
    layerName: (l) => `Layer ${l + 1}`,
    layerCount: () => 8,
    screenCount: () => 2,
    sourceAvailable: () => true,
    presetEditMode: () => calls.push('presetEditMode'),
    liveCtx: () => 0,
    editCtx: () => 1,
    doCut: (s) => calls.push(`cut ${s}`),
    doTake: (s) => calls.push(`take ${s}`),
    setTbar: () => {},
    tbarValue: () => 0,
    layerRect: () => ({ left: 0, top: 0, w: 100, h: 100 }),
    placeLayer: () => {},
  };
  return {
    host, sent, sets, calls,
    note: (state, driven = false) => bridgeListener({ t: 'plus', what: 'speed-editor', state, driven }),
    report: (r) => bridgeListener({ t: 'plus', what: 'speed-editor.report', event: true, r }),
    grant: (held) => { leaseState.held = held; for (const fn of leaseState.listeners) fn(held); },
    render: () => view.render(),
    enter: () => view.enter(),
  };
}

const find = (node, test) => {
  if (!node || typeof node !== 'object') return null;
  if (test(node)) return node;
  for (const k of node.kids || []) { const f = find(k, test); if (f) return f; }
  return null;
};
const button = (tree, text) => find(tree, (n) => n.tag === 'button' && n.kids.includes(text));
const writes = (sent) => sent.filter((m) => m.t === 'hid' && m.op === 'write').flatMap((m) => m.reports);
const keys = (...codes) => { const r = new Array(13).fill(0); r[0] = 4; codes.forEach((c, i) => { r[1 + 2 * i] = c; }); return r; };

const PANEL = { available: true, reason: null, watching: true, present: true, connected: false, authed: false, lease: null, product: 'DaVinci Resolve Speed Editor', battery: null, error: null, handshakes: 0 };

// ---- looking, starting, being granted the panel ----
{
  const t = fakeHost();
  plugin.setup(t.host);
  t.enter();
  assert.deepEqual(t.sent.at(-1), { t: 'hid', id: 'speed-editor', op: 'watch' }, 'opening the view looks for the panel');

  t.note(PANEL);
  assert.match(find(t.render(), (n) => n.props?.class === 'hint' && /found/.test(n.props.text)).props.text, /found\. Press Start/);

  button(t.render(), 'Start').props.onclick();
  assert.deepEqual(t.sent.at(-1), { t: 'lease', want: true }, 'Start asks for the driver lease');

  t.grant(true);
  t.note({ ...PANEL, connected: true, authed: true, lease: 600, handshakes: 1 }, true);
  await tick();
  const set = writes(t.sent);
  assert.deepEqual(set[0], [3, 0, 0, 0, 0, 0, 0xff], 'the wheel back to reporting movement');
  assert.deepEqual(set[1], [4, 1], 'the JOG lamp');
  assert.deepEqual(set[2], [2, 0, 0, 0, 0], 'every other lamp as the store says');

  // ---- keys, as the bridge sends them: plain JSON numbers ----
  t.report(keys(0x33));
  t.report(keys());
  assert.deepEqual(t.sets.find(([m]) => m === 'PRinp'), ['PRinp', [0, 1, 0], 1], 'CAM 1 puts input 1 on layer 1 of screen 1, in preview');
  await tick();
  assert.deepEqual(writes(t.sent).at(-1), [2, 0, 1 << 6, 0, 0], 'and lights CAM 1 (lamp 14: byte 2, bit 6)');

  // CUT twice: a trigger fires on every press, not only when it changes.
  t.report(keys(0x0f)); t.report(keys()); t.report(keys(0x0f)); t.report(keys());
  assert.deepEqual(t.calls.filter((c) => c.startsWith('cut')), ['cut 0', 'cut 0']);

  // ---- another page takes over: this one stops acting on the panel ----
  t.grant(false);
  t.note({ ...PANEL, connected: true, authed: true, lease: 600, handshakes: 1 }, true);
  const before = t.calls.length;
  t.report(keys(0x0f));
  assert.equal(t.calls.length, before, 'a page that lost the panel ignores it');
  const tree = t.render();
  assert.ok(find(tree, (n) => n.kids?.includes('Another page is driving it')));
  button(tree, 'Take over').props.onclick();
  assert.deepEqual(t.sent.at(-1), { t: 'lease', want: true, take: true });

  // ---- back again, a replug (a fresh handshake), then Stop ----
  t.grant(true);
  const n = writes(t.sent).length;
  t.note({ ...PANEL, connected: true, authed: true, lease: 600, handshakes: 2 }, true);
  await tick();
  assert.deepEqual(writes(t.sent)[n], [3, 0, 0, 0, 0, 0, 0xff], 'a fresh handshake sets the wheel and lamps again');

  button(t.render(), 'Stop').props.onclick();
  const last = t.sent.slice(-2);
  assert.deepEqual(last[0].reports, [[2, 0, 0, 0, 0], [4, 0]], 'lamps out first, while the page may still write them');
  assert.deepEqual(last[1], { t: 'lease', want: false }, 'then the lease goes');
  assert.equal(globalThis.sessionStorage.getItem('openrcs.speed-editor.started'), null);
}

// ---- a reload carries on driving; a build without HID says so ----
{
  globalThis.sessionStorage.setItem('openrcs.speed-editor.started', '1');
  const t = fakeHost();
  plugin.setup(t.host);
  assert.deepEqual(t.sent.at(-1), { t: 'lease', want: true }, 'a page reloaded while driving asks again');

  const u = fakeHost();
  globalThis.sessionStorage.removeItem('openrcs.speed-editor.started');
  plugin.setup(u.host);
  u.note({ ...PANEL, available: false, reason: 'This build of openrcs-server has no USB panel support.', watching: false, present: false });
  const tree = u.render();
  assert.equal(button(tree, 'Start').props.disabled, true);
  assert.ok(find(tree, (n) => /no USB panel support/.test(n.props?.text || '')));
  assert.ok(!u.sent.some((m) => m.op === 'watch'), 'and nobody asks it to look');
}

console.log('speed editor ok');
