/*
 * Speed Editor — a DaVinci Resolve Speed Editor driving the processor, over
 * WebHID from the page itself.
 *
 * Ported from LivePremier Plus. The panel's protocol — the challenge/answer
 * handshake, the reports, the lamps — is awj-surface's, vendored as
 * speed-editor.js. The layout is LivePremier Plus's, on openrcs's verbs:
 *
 *   CAM 1–9           put that input on the selected layer
 *   SMART INSRT … OUT  (the eight keys top left) select layer 1–8
 *   SOURCE / TIMELINE select screen 1 / 2
 *   CUT               cut the selected screen
 *   DIS, STOP/PLAY    take the selected screen
 *   TRANS             flip between editing preview and program
 *   SNAP (held)       shift
 *   JOG / SHTL / SCRL the wheel moves opacity / position H / position V —
 *                     shifted: the T-bar / size H / size V
 *
 * WebHID: Chromium only, a secure context only (localhost, or HTTPS through
 * the Remote access plugin), and choosing the panel needs a click; after that
 * the browser remembers it. Quit Resolve first — both would hear every key.
 * The handshake lapses; it is redone at half its stated lease.
 *
 * Never yet run against a panel on openrcs. The protocol code is the same
 * that LivePremier Plus runs; this file's mapping onto LiveCore/Midra
 * variables is fixture-tested only.
 */

import { VENDOR_ID, PRODUCT_ID, KEY_BY_CODE, KEY_BY_NAME, authenticate, decodeReport, ledReport, jogLedReport } from './speed-editor.js';

const FILTERS = [{ vendorId: VENDOR_ID, productId: PRODUCT_ID }];
const LAYER_KEYS = ['smart-insert', 'append', 'ripple-owr', 'close-up', 'place-on-top', 'src-owr', 'in', 'out'];
const JOG_FACES = ['jog', 'shtl', 'scrl'];
const UNITS = 512;       // wheel units per step, as awj-surface sizes them

export default {
  id: 'speed-editor',
  name: 'Speed Editor',
  description: 'A DaVinci Resolve Speed Editor driving the surface over WebHID — CAM keys put inputs on the selected layer, the wheel rides opacity, position, size and the T-bar.',
  setup(host) {
    const { el, store } = host;
    const hid = () => navigator.hid;
    const sel = { screen: 0, layer: 0, bus: 'pvw', shift: false };
    let device = null, authed = false, authTimer = null, error = '', held = new Set(), face = 'jog', residue = 0, leds = 0, battery = null;
    const activity = [];
    const log = (t) => { activity.unshift(`${new Date().toLocaleTimeString()}  ${t}`); activity.length = Math.min(activity.length, 30); host.notify(); };

    const io = (d) => ({
      sendFeature: (bytes) => d.sendFeatureReport(bytes[0], bytes.subarray(1)),
      getFeature: async (id, length) => {
        const view = await d.receiveFeatureReport(id);
        const bytes = new Uint8Array(view.buffer, view.byteOffset, view.byteLength);
        if (bytes.length >= length && bytes[0] === id) return bytes;
        const out = new Uint8Array(bytes.length + 1); out[0] = id; out.set(bytes, 1); return out;
      },
    });
    const send = (bytes) => { if (device?.opened) device.sendReport(bytes[0], bytes.subarray(1)).catch(() => {}); };

    async function choose() {
      error = '';
      if (!hid()) { error = window.isSecureContext ? 'This browser has no WebHID — use Chrome or Edge.' : 'This page is not a secure context, so WebHID is hidden. Use http://localhost here, or HTTPS (Remote access plugin).'; host.notify(); return; }
      try { const [d] = await hid().requestDevice({ filters: FILTERS }); if (d) await open(d); } catch (err) { error = `Could not choose the panel: ${err.message}`; host.notify(); }
    }
    async function reconnect() {
      if (!hid() || device) return;
      try { const d = (await hid().getDevices()).find(x => x.vendorId === VENDOR_ID && x.productId === PRODUCT_ID); if (d) await open(d); } catch { /* none granted */ }
    }
    async function open(d) {
      try { if (!d.opened) await d.open(); } catch (err) { error = `Could not open the panel: ${err.message}. Is DaVinci Resolve running? Quit it and try again.`; host.notify(); return; }
      device = d; d.addEventListener('inputreport', onReport); log(`opened ${d.productName || 'Speed Editor'}`);
      await auth();
    }
    async function auth(attempt = 1) {
      clearTimeout(authTimer);
      if (!device) return;
      try {
        const lease = await authenticate(io(device));
        if (!authed) log(`authenticated (lease ${lease} s)`);
        authed = true; error = '';
        send(jogLedReport(1 << (JOG_FACES.indexOf(face) === 1 ? 1 : JOG_FACES.indexOf(face) === 2 ? 2 : 0)));
        lamps();
        authTimer = setTimeout(() => auth(), (lease || 600) * 500);
      } catch (err) {
        authed = false; log(`authentication failed: ${err.message}`);
        if (attempt < 3) authTimer = setTimeout(() => auth(attempt + 1), 15000);
        else error = 'The panel would not authenticate. Unplug it, plug it back in, and choose it again.';
      }
      host.notify();
    }
    function drop() {
      clearTimeout(authTimer);
      if (device) { device.removeEventListener('inputreport', onReport); device.close().catch(() => {}); }
      device = null; authed = false;
    }
    if (hid()) {
      hid().addEventListener('connect', (e) => { if (e.device.vendorId === VENDOR_ID && e.device.productId === PRODUCT_ID && !device) open(e.device); });
      hid().addEventListener('disconnect', (e) => { if (e.device === device) { log('panel unplugged'); drop(); host.notify(); } });
    }

    // ---- what the keys do ----
    const ctx = () => sel.bus === 'pgm' ? host.liveCtx(sel.screen) : host.editCtx(sel.screen);
    function lamps() {
      let bits = 0;
      const on = (name) => { const b = KEY_BY_NAME.get(name)?.led; if (b != null) bits |= 1 << b; };
      if (sel.bus === 'pgm') on('trans');
      if (sel.shift) on('snap');
      const src = store.val('PRinp', sel.screen, ctx(), sel.layer) || 0;
      if (src >= 1 && src <= 9) on(`cam${src}`);
      if (bits !== leds) { leds = bits >>> 0; send(ledReport(leds)); }
    }
    function press(name) {
      const cam = /^cam(\d)$/.exec(name);
      if (cam) {
        const n = +cam[1];
        if (!host.sourceAvailable(n)) { log(`input ${n} is not available`); return; }
        host.presetEditMode();
        store.set('PRinp', [sel.screen, ctx(), sel.layer], n);
        log(`input ${n} → S${sel.screen + 1} ${host.layerName(sel.layer, sel.screen)} (${sel.bus})`);
        return;
      }
      const li = LAYER_KEYS.indexOf(name);
      if (li >= 0) { if (li < host.layerCount(sel.screen)) { sel.layer = li; log(`layer ${li + 1}`); } return; }
      if (name === 'source' || name === 'timeline') { const s = name === 'source' ? 0 : 1; if (s < host.screenCount()) { sel.screen = s; sel.layer = Math.min(sel.layer, host.layerCount(s) - 1); log(`screen ${s + 1}`); } return; }
      if (name === 'cut') { host.doCut(sel.screen); log(`cut S${sel.screen + 1}`); return; }
      if (name === 'dis' || name === 'stop-play') { host.doTake(sel.screen); log(`take S${sel.screen + 1}`); return; }
      if (name === 'trans') { sel.bus = sel.bus === 'pgm' ? 'pvw' : 'pgm'; log(`editing ${sel.bus === 'pgm' ? 'PROGRAM' : 'preview'}`); return; }
      if (name === 'snap') { sel.shift = true; return; }
      log(`${KEY_BY_NAME.get(name)?.label || name} — nothing bound`);
    }
    function wheel(steps) {
      const s = sel.screen, c = ctx(), l = sel.layer;
      if (face === 'jog' && sel.shift) {
        const def = store.byMnem.get('GCtba');
        if (!def) return;
        host.setTbar(s, Math.max(0, Math.min(def.max, host.tbarValue(s) + steps * Math.round(def.max / 64))));
        return;
      }
      if (face === 'jog') {
        const def = store.byMnem.get('PRalp');
        if (!def) return;
        store.set('PRalp', [s, c, l], Math.max(def.min, Math.min(def.max, (store.val('PRalp', s, c, l) ?? def.max) + steps * Math.max(1, Math.round(def.max / 64)))));
        return;
      }
      const r = host.layerRect(s, c, l), px = steps * 8;
      if (face === 'shtl' && !sel.shift) r.left += px;
      else if (face === 'scrl' && !sel.shift) r.top += px;
      else if (face === 'shtl') { r.w = Math.max(0, r.w + px); r.left -= px / 2; }
      else { r.h = Math.max(0, r.h + px); r.top -= px / 2; }
      host.placeLayer(s, c, l, r);
    }

    function onReport(ev) {
      const bytes = new Uint8Array(ev.data.byteLength + 1);
      bytes[0] = ev.reportId;
      bytes.set(new Uint8Array(ev.data.buffer, ev.data.byteOffset, ev.data.byteLength), 1);
      const r = decodeReport(bytes);
      if (!r) return;
      if (r.type === 'battery') { battery = r; host.notify(); return; }
      if (r.type === 'jog') {
        residue += r.value;
        const steps = Math.trunc(residue / UNITS);
        if (steps) { residue -= steps * UNITS; wheel(steps); }
        return;
      }
      const now = new Set(r.codes.map(c => KEY_BY_CODE.get(c)?.name ?? `0x${c.toString(16)}`));
      for (const name of held) if (!now.has(name) && name === 'snap') sel.shift = false;
      for (const name of now) {
        if (held.has(name)) continue;
        if (JOG_FACES.includes(name)) { face = name; residue = 0; send(jogLedReport(1 << [0, 1, 2][JOG_FACES.indexOf(name)])); continue; }
        press(name);
      }
      held = now;
      lamps();
      host.notify();
    }
    store.subscribe(() => { if (authed) lamps(); });

    host.view('speededitor', 'Speed Editor', {
      enter() { reconnect(); },
      render() {
        const status = !device ? 'No panel connected.' : authed
          ? `${device.productName || 'Speed Editor'} — connected${battery ? `, battery ${battery.level}%${battery.charging ? ' (charging)' : ''}` : ''}`
          : `${device.productName || 'Speed Editor'} — waiting for the handshake…`;
        return el('div', {},
          el('div', { class: 'view-head' }, el('h1', { text: 'Speed Editor' }),
            el('span', { class: 'hint', text: status })),
          el('div', { class: 'panel' },
            el('div', { class: 'row' },
              device ? el('button', { class: 'btn ghost', onclick: () => { drop(); host.notify(); } }, 'Disconnect') : el('button', { class: 'btn primary', onclick: choose }, 'Choose panel…'),
              el('span', { class: 'chip on' }, `Screen ${sel.screen + 1}`),
              el('span', { class: 'chip on' }, host.layerName(sel.layer, sel.screen)),
              el('span', { class: 'chip ' + (sel.bus === 'pgm' ? 'bad' : 'on') }, sel.bus === 'pgm' ? 'PROGRAM' : 'preview'),
              sel.shift ? el('span', { class: 'chip bad' }, 'SHIFT') : null,
              el('span', { class: 'hint', text: `wheel: ${face.toUpperCase()}` })),
            error ? el('div', { class: 'hint pad bad', text: error }) : null,
            el('div', { class: 'hint pad', text: 'CAM 1–9: input on the selected layer · the eight keys top left: layer 1–8 · SOURCE / TIMELINE: screen 1 / 2 · CUT: cut · DIS, STOP/PLAY: take · TRANS: edit preview ⇄ program · SNAP: shift · JOG / SHTL / SCRL: opacity / position H / position V — shifted: T-bar / size H / size V. Quit DaVinci Resolve first.' })),
          el('div', { class: 'panel' }, el('h2', 'Activity'),
            activity.length ? el('div', { class: 'mono', style: 'font-size:12px;white-space:pre-line', text: activity.join('\n') }) : el('div', { class: 'empty-state', text: 'Nothing yet.' })));
      },
    }, { section: 'Setup' });

    reconnect();
  },
};
