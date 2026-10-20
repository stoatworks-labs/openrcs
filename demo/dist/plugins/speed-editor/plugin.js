/*
 * Speed Editor — a DaVinci Resolve Speed Editor driving the processor.
 *
 * The panel is held by the bridge, not the page (src/speed_editor.rs has the
 * detail). The first port opened it from the page over WebHID, and WebHID
 * cannot complete the panel's handshake: Chrome reads every feature report at
 * the length of the largest one the panel declares, and the panel refuses a
 * read of its 10-byte challenge at that length — found on a real panel by
 * LivePremier Plus, which moved it to its server and proved it there. So the
 * bridge finds the panel, answers its challenge and keeps the answer renewed,
 * finds it again after a replug, and passes its reports through; this page
 * turns them into writes and sends back the lamps. The mapping stays here, as
 * it does in LivePremier Plus, because the store and the take are here.
 *
 * Ported from LivePremier Plus. The protocol tables are awj-surface's,
 * vendored as speed-editor.js (the handshake itself now runs in the bridge).
 * The layout is LivePremier Plus's, on openrcs's verbs:
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
 * One page drives it. Start asks the bridge for the `speed-editor.driver`
 * lease; the bridge opens the panel only while some page holds it, sends its
 * keys to the holder alone and drops lamps from anyone else. A second page
 * that starts waits in line and has the panel when the first stops or closes;
 * Take over moves it at once. The lease lasts as long as the page's socket, so
 * a tab in the background keeps it.
 *
 * Any browser, any address: the page never touches the panel. The panel has
 * to be plugged into the machine openrcs-server runs on. Quit DaVinci Resolve
 * first — both would hear every key.
 *
 * Proven how far: docs/PLUGINS.md. The bridge's half is tested against a fake
 * panel; this file's mapping onto LiveCore/Midra variables is fixture-tested
 * only.
 */

import { KEY_BY_CODE, KEY_BY_NAME, JOG_MODE, decodeReport, ledReport, jogLedReport, jogModeReport } from './speed-editor.js';

const ID = 'speed-editor';
const LAYER_KEYS = ['smart-insert', 'append', 'ripple-owr', 'close-up', 'place-on-top', 'src-owr', 'in', 'out'];
const JOG_FACES = ['jog', 'shtl', 'scrl'];
const UNITS = 512;       // wheel units per step, as awj-surface sizes them
const STARTED_KEY = 'openrcs.speed-editor.started';

export default {
  id: 'speed-editor',
  name: 'Speed Editor',
  description: 'A DaVinci Resolve Speed Editor, plugged into the machine openrcs runs on, driving the surface — CAM keys put inputs on the selected layer, the wheel rides opacity, position, size and the T-bar.',
  setup(host) {
    const { el, store } = host;
    const sel = { screen: 0, layer: 0, bus: 'pvw', shift: false };
    const lease = host.lease('driver');
    // The bridge's word on the panel: { state: {available, present, connected,
    // authed, battery, handshakes, …}, driven }.
    let server = null;
    let started = false, looked = false;
    let held = new Set(), face = 'jog', residue = 0, leds = -1;
    const activity = [];
    const log = (t) => { activity.unshift(`${new Date().toLocaleTimeString()}  ${t}`); activity.length = Math.min(activity.length, 30); host.notify(); };

    const st = () => server?.state ?? null;
    const driving = () => started && lease.held();
    const live = () => driving() && !!st()?.authed;
    // Per tab, not per browser: a reload carries on driving, a second tab of
    // the surface does not join the queue by itself.
    const remember = (on) => { try { if (on) sessionStorage.setItem(STARTED_KEY, '1'); else sessionStorage.removeItem(STARTED_KEY); } catch { /* private mode */ } };
    const remembered = () => { try { return sessionStorage.getItem(STARTED_KEY) === '1'; } catch { return false; } };

    // ---- the bridge ----
    // Output reports, batched: one render can light several lamps at once.
    let outbox = [];
    function send(bytes) {
      if (!live()) return;
      if (!outbox.length) queueMicrotask(flush);
      outbox.push([...bytes]);
    }
    function flush() {
      while (outbox.length) host.bridge({ t: 'hid', id: ID, op: 'write', reports: outbox.splice(0, 16) });
    }
    const watch = () => { if (host.bridged()) host.bridge({ t: 'hid', id: ID, op: 'watch' }); };

    function absorb(next) {
      const was = st(), now = next.state;
      server = next;
      if (was && was.present !== now.present) log(now.present ? `${now.product || 'panel'} plugged in` : 'panel unplugged');
      if (was && now.error && now.error !== was.error) log(now.error);
      if (now.authed && !was?.authed) log(`authenticated (lease ${now.lease} s)`);
      // A fresh handshake: a panel that has been unplugged has forgotten its
      // lamps and its wheel's mode.
      if (driving() && now.authed && now.handshakes !== was?.handshakes) reset();
      // A bridge that restarted is looking for nothing until asked again.
      if (now.available && !now.watching && (started || looked)) watch();
      host.notify();
    }

    host.onBridge((m) => {
      if (m.what === ID) absorb(m);
      else if (m.what === `${ID}.report` && driving()) onReport(Uint8Array.from(m.r || []));
    });

    lease.onChange((isHolder) => {
      if (!started) return;
      if (isHolder) { log('driving the panel from this page'); if (st()?.authed) reset(); }
      else log(server?.driven ? 'another page has the panel' : 'no longer driving the panel');
      host.notify();
    });

    function start() {
      if (!host.bridged()) return;
      started = true;
      remember(true);
      held = new Set();
      residue = 0;
      lease.want(true);
      log('started');
    }
    function stop() {
      // Lamps out while this page may still write them: the bridge drops
      // writes from a page that no longer holds the lease.
      if (live()) { send(ledReport(0)); send(jogLedReport(0)); flush(); }
      started = false;
      remember(false);
      lease.want(false);
      sel.shift = false;
      log('stopped');
    }

    /** The panel as this page wants it: every lamp right, the wheel reporting movement. */
    function reset() {
      leds = -1;
      residue = 0;
      send(jogModeReport(JOG_MODE.RELATIVE));
      send(jogLedReport(1 << KEY_BY_NAME.get(face).jogLed));
      lamps();
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
      if (bits !== leds) { leds = bits; send(ledReport(bits)); }
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

    function onReport(bytes) {
      const r = decodeReport(bytes);
      if (!r || r.type === 'battery') return;   // the bridge keeps the battery level
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
        if (JOG_FACES.includes(name)) { face = name; residue = 0; send(jogLedReport(1 << KEY_BY_NAME.get(name).jogLed)); continue; }
        press(name);
      }
      held = now;
      lamps();
      host.notify();
    }
    store.subscribe(() => { if (live()) lamps(); });

    host.view('speededitor', 'Speed Editor', {
      enter() { looked = true; watch(); },
      render() {
        const s = st();
        const name = s?.product || 'Speed Editor';
        const battery = s?.battery ? `, battery ${s.battery.level}%${s.battery.charging ? ' (charging)' : ''}` : '';
        const status = !host.bridged() ? 'The hosted demo has no bridge, so no panel.'
          : !s ? 'Asking the bridge…'
          : !s.available ? (s.reason || 'This build has no USB panel support.')
          : !s.present && !s.connected ? 'No panel. Plug it into the machine openrcs runs on, by USB.'
          : !s.connected ? (driving() ? `${name} — opening…` : `${name} — found. Press Start to use it.`)
          : !s.authed ? `${name} — waiting for the handshake…`
          : `${name} — connected${battery}.`;
        const elsewhere = !!server?.driven && !lease.held();
        return el('div', {},
          el('div', { class: 'view-head' }, el('h1', { text: 'Speed Editor' }),
            el('span', { class: 'hint', text: status })),
          el('div', { class: 'panel' },
            el('div', { class: 'row' },
              started
                ? el('button', { class: 'btn ghost', onclick: () => stop() }, 'Stop')
                : el('button', { class: 'btn primary', onclick: () => start(), disabled: !host.bridged() || s?.available === false }, 'Start'),
              elsewhere ? el('span', { class: 'chip bad' }, 'Another page is driving it') : null,
              elsewhere && started ? el('button', { class: 'btn', onclick: () => lease.take() }, 'Take over') : null,
              el('span', { class: 'chip on' }, `Screen ${sel.screen + 1}`),
              el('span', { class: 'chip on' }, host.layerName(sel.layer, sel.screen)),
              el('span', { class: 'chip ' + (sel.bus === 'pgm' ? 'bad' : 'on') }, sel.bus === 'pgm' ? 'PROGRAM' : 'preview'),
              sel.shift ? el('span', { class: 'chip bad' }, 'SHIFT') : null,
              el('span', { class: 'hint', text: `wheel: ${face.toUpperCase()}` })),
            s?.error && s.available ? el('div', { class: 'hint pad bad', text: s.error }) : null,
            el('div', { class: 'hint pad', text: 'CAM 1–9: input on the selected layer · the eight keys top left: layer 1–8 · SOURCE / TIMELINE: screen 1 / 2 · CUT: cut · DIS, STOP/PLAY: take · TRANS: edit preview ⇄ program · SNAP: shift · JOG / SHTL / SCRL: opacity / position H / position V — shifted: T-bar / size H / size V.' }),
            el('div', { class: 'hint pad', text: 'The panel plugs into the machine openrcs runs on, not the one this page is on. One page drives it at a time; a second that starts waits its turn, or takes over. Quit DaVinci Resolve first — both would hear every key.' })),
          el('div', { class: 'panel' }, el('h2', 'Activity'),
            activity.length ? el('div', { class: 'mono', style: 'font-size:12px;white-space:pre-line', text: activity.join('\n') }) : el('div', { class: 'empty-state', text: 'Nothing yet.' })));
      },
    }, { section: 'Setup' });

    // A page reloaded while it was driving the panel carries on (a plugin
    // switched on or off reloads it), as the WebHID version reopened a panel
    // the browser remembered.
    if (remembered() && host.bridged()) start();
  },
};
