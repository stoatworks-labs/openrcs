/*
 * MIDI mapping — a MIDI control surface driving the processor from this page.
 *
 * Ported from LivePremier Plus. A mapping ties one control — a note, or a
 * controller number, on one channel — to one of the surface's actions (the
 * same verbs Keys and Cues fire), or ties a fader to a screen's T-bar.
 *
 * - **Learn**: press Learn, move the control, and the mapping takes whatever
 *   arrived first.
 * - A note fires on note-on. A CC fires when it crosses the middle (0→127
 *   buttons) — or, mapped to a T-bar, follows the fader all the way.
 * - Web MIDI is this page's: the controller is plugged into the machine the
 *   browser runs on, and the page must be a secure context (localhost, or
 *   HTTPS through the Remote access plugin).
 *
 * The map is the show's and lives in the bridge's shared data; which MIDI
 * input to listen on is this browser's, since port names are per machine.
 */

const KEY = 'openrcs.midi';

export default {
  id: 'midi',
  name: 'MIDI mapping',
  description: 'A MIDI controller driving the surface — notes and buttons fire any action, a fader rides a screen’s T-bar. Learn a control by moving it.',
  setup(host) {
    const { el, store } = host;
    const maps = host.shared('maps', []);   // [{id, kind:'note'|'cc', ch, num, target:'action'|'tbar', action, screen}]
    // Open the port as soon as there is a map to play, not only when this
    // page is visited — a controller should work from any page.
    maps.watch(() => { if (!access && maps.get().length && navigator.requestMIDIAccess && window.isSecureContext) open(); host.notify(); });
    let local = { input: '' };
    try { local = { ...local, ...JSON.parse(localStorage.getItem(KEY) || '{}') }; } catch { /* first run */ }
    const persist = () => { try { localStorage.setItem(KEY, JSON.stringify(local)); } catch { /* private */ } };

    let access = null, port = null, error = '', learning = null, last = null;
    const draft = { type: 'take', screen: -1 };
    const ccHigh = new Map();      // "ch.num" -> above the middle last time

    async function open() {
      error = '';
      if (!navigator.requestMIDIAccess) { error = window.isSecureContext ? 'This browser has no Web MIDI.' : 'This page is not a secure context, so the browser hides MIDI. Use http://localhost here, or HTTPS (Remote access plugin).'; host.notify(); return; }
      try { access ??= await navigator.requestMIDIAccess({ sysex: false }); } catch (err) { error = `MIDI refused: ${err.message}`; host.notify(); return; }
      access.onstatechange = () => { bind(); host.notify(); };
      bind();
    }
    function bind() {
      if (port) port.onmidimessage = null;
      const list = [...access.inputs.values()];
      port = (local.input && list.find(p => p.id === local.input)) || (local.input ? null : list[0]) || null;
      if (port) { port.onmidimessage = onMessage; port.open?.(); }
      host.notify();
    }

    function onMessage(ev) {
      const [st, a, b = 0] = ev.data;
      const type = st & 0xf0, ch = (st & 0x0f) + 1;
      let msg = null;
      if (type === 0x90 && b > 0) msg = { kind: 'note', ch, num: a, val: b };
      else if (type === 0xb0) msg = { kind: 'cc', ch, num: a, val: b };
      if (!msg) return;
      last = msg;
      if (learning != null) {
        const id = learning; learning = null;
        maps.update(ms => { const m = ms.find(x => x.id === id); if (m) Object.assign(m, { kind: msg.kind, ch: msg.ch, num: msg.num }); });
        return;
      }
      for (const m of maps.get()) {
        if (m.kind !== msg.kind || m.ch !== msg.ch || m.num !== msg.num) continue;
        if (m.target === 'tbar' && msg.kind === 'cc') {
          const def = store.byMnem.get('GCtba');
          if (!def) continue;
          host.setTbar(m.screen ?? 0, Math.round(msg.val / 127 * def.max));
          continue;
        }
        if (msg.kind === 'cc') {
          const k = `${msg.ch}.${msg.num}`, hi = msg.val >= 64;
          const was = ccHigh.get(k) || false;
          ccHigh.set(k, hi);
          if (!hi || was) continue;          // fire on the upward crossing only
        }
        host.actions.run(m.action);
      }
      host.notify();
    }

    const label = (m) => m.num == null ? 'not learned' : `${m.kind === 'note' ? 'Note' : 'CC'} ${m.num} · ch ${m.ch}`;
    function row(m) {
      return el('div', { class: 'action-item' },
        el('button', { class: 'btn ' + (learning === m.id ? 'armed' : 'ghost'), style: 'min-width:140px', onclick: () => { learning = learning === m.id ? null : m.id; host.notify(); } },
          learning === m.id ? 'Move a control…' : label(m)),
        el('span', { class: 'action-desc', text: m.target === 'tbar' ? `T-bar, screen ${(m.screen ?? 0) + 1}` : host.actions.describe(m.action) }),
        el('button', { class: 'btn ghost', onclick: () => maps.update(ms => ms.splice(ms.findIndex(x => x.id === m.id), 1)) }, '✕'));
    }
    let tbarScreen = 0;

    host.view('midi', 'MIDI', {
      enter() { if (!access) open(); },
      render() {
        const list = access ? [...access.inputs.values()] : [];
        return el('div', {},
          el('div', { class: 'view-head' }, el('h1', { text: 'MIDI mapping' }),
            el('span', { class: 'hint', text: port ? `Listening on ${port.name}` : 'No MIDI input' })),
          el('div', { class: 'panel' },
            el('div', { class: 'row' },
              el('label', { class: 'field' }, 'Input', host.enumSelect2(local.input, [['', 'First available'], ...list.map(p => [p.id, p.name || p.id])], v => { local.input = v; persist(); bind(); })),
              el('div', { class: 'spacer' }),
              el('span', { class: 'hint mono', text: last ? `last: ${last.kind === 'note' ? 'Note' : 'CC'} ${last.num} ch ${last.ch} = ${last.val}` : '' })),
            error ? el('div', { class: 'hint pad bad', text: error }) : null),
          el('div', { class: 'panel' },
            el('h2', `Mappings (${maps.get().length})`),
            maps.get().length ? el('div', { class: 'action-list' }, ...maps.get().map(row)) : el('div', { class: 'empty-state', text: 'No mappings yet. Add an action below, then press its Learn button and move a control.' }),
            el('div', { class: 'sub-head' }, 'Map a control to an action'),
            host.actions.form(draft, (a) => { const id = Date.now(); maps.update(ms => ms.push({ id, target: 'action', action: a, kind: null, ch: null, num: null })); learning = id; host.notify(); }, { addLabel: 'Add and learn' }),
            el('div', { class: 'sub-head' }, 'Or a fader to a T-bar'),
            el('div', { class: 'row' },
              el('label', { class: 'field' }, 'Screen', host.screenSelect(tbarScreen, v => { tbarScreen = v; host.notify(); })),
              el('button', { class: 'btn', onclick: () => { const id = Date.now(); maps.update(ms => ms.push({ id, target: 'tbar', screen: tbarScreen, kind: null, ch: null, num: null })); learning = id; host.notify(); } }, 'Add and learn'))));
      },
    }, { section: 'Setup' });

  },
};
