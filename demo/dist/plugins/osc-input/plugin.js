/*
 * OSC input — QLab, TouchOSC or a lighting desk driving the processor over
 * UDP.
 *
 * Ported from LivePremier Plus. A browser has no UDP, so the listener is the
 * bridge's (`src/plus.rs`); this plugin turns it on, shows what it hears, and
 * runs the verbs the bridge hands back. The split:
 *
 *   /openrcs/set/<MNEM> idx… value   written by the bridge itself — no page
 *   /openrcs/raw "line"              needed. A LiveCore preset write gets its
 *                                    GCupd, as from the surface.
 *   everything else below            forwarded to ONE open page (the one
 *                                    holding the `actions` lease) and run
 *                                    there, through the same take and recall
 *                                    code the buttons use.
 *
 * So a take, a recall or a cue GO over OSC needs an openrcs page open
 * somewhere — a tablet, the FOH laptop. With none open the bridge drops the
 * message and says so in the status line. That is deliberate: the take logic
 * carries hardware-proven details (a Midra's T-bar must be seen to travel, a
 * LiveCore holds edits until GCupd) and a second copy in Rust would drift.
 *
 * Numbers are as an operator counts them — screen 1, memory 1 — not indices.
 */

const DEFAULT_PORT = 8733;

export const ADDRESSES = [
  ['/openrcs/take [screen] [seconds]', 'Take one screen, or every screen with no argument. A time takes with a T-bar sweep.'],
  ['/openrcs/cut [screen]', 'Cut.'],
  ['/openrcs/master <slot> [take]', 'Recall a master memory (a Midra preset) to preview; 1 as the second argument takes it.'],
  ['/openrcs/screen <screen> <slot> [take]', 'Recall a screen memory (LiveCore).'],
  ['/openrcs/tbar <screen> <0–1>', 'Move a screen’s T-bar.'],
  ['/openrcs/source <screen> <layer> <input> [program]', 'Put an input on a layer — preview, or program with 1.'],
  ['/openrcs/fade <screen> <0|1>', 'Master fade: 0 to black, 1 up.'],
  ['/openrcs/freeze <input> <0|1>', 'Freeze an input.'],
  ['/openrcs/black <output> <0|1>', 'Black an output.'],
  ['/openrcs/cue/go', 'GO the next cue.  /openrcs/cue/<n> — GO cue n.  /openrcs/cue/hold, /openrcs/cue/back.'],
  ['/openrcs/key/<n>', 'Run key n.'],
  ['/openrcs/timecode "HH:MM:SS:FF"', 'Feed the Timecode plugin, when its input is set to OSC.'],
  ['/openrcs/set/<MNEM> <idx…> <value>', 'Write any variable, as the Inspector does. Indices from 0. Runs with no page open.'],
  ['/openrcs/raw "<line>"', 'Send a raw protocol line. Runs with no page open.'],
];

export default {
  id: 'osc-input',
  name: 'OSC input',
  description: 'QLab, TouchOSC or a lighting desk driving the processor over UDP. The bridge listens; takes and cues run on an open page.',
  setup(host) {
    const { el } = host;
    const cfg = host.shared('config', { enabled: false, port: DEFAULT_PORT, lan: false });
    cfg.watch(() => host.notify());
    let status = { listening: false };
    const heard = [];
    host.onBridge((m) => {
      if (m.what !== 'osc') return;
      status = m.status || {};
      if (status.last && heard[0] !== status.last) { heard.unshift(status.last); heard.length = Math.min(heard.length, 40); }
      host.notify();
    });
    const lease = host.lease('actions');
    lease.onChange(() => host.notify());
    lease.want(true);

    const n1 = (v, what) => { const n = Math.round(Number(v)); if (!Number.isFinite(n) || n < 1) throw new Error(`${what} ${v}`); return n - 1; };
    const on = (v) => v === true || Number(v) >= 1;
    host.forwarded('*', (args, name) => {
      const [head, sub] = name.split('/');
      switch (head) {
        case 'take': {
          const fade = args[1] != null ? Math.round(Number(args[1]) * 1000) : undefined;
          if (args[0] == null || Number(args[0]) === 0) host.activeScreens().forEach(s => host.doTake(s, fade));
          else host.doTake(n1(args[0], 'screen'), fade);
          return;
        }
        case 'cut':
          if (args[0] == null || Number(args[0]) === 0) host.activeScreens().forEach(s => host.doCut(s));
          else host.doCut(n1(args[0], 'screen'));
          return;
        case 'master': return host.recallMemory({ scope: 'master', slot: n1(args[0], 'slot'), take: on(args[1]) });
        case 'screen': return host.recallMemory({ scope: 'screen', screen: n1(args[0], 'screen'), slot: n1(args[1], 'slot'), take: on(args[2]) });
        case 'tbar': {
          const def = host.store.byMnem.get('GCtba');
          if (def) host.setTbar(n1(args[0], 'screen'), Math.round(Math.max(0, Math.min(1, Number(args[1]) || 0)) * def.max));
          return;
        }
        case 'source': return host.actions.run({ type: 'source', screen: n1(args[0], 'screen'), layer: n1(args[1], 'layer'), input: Math.max(0, Math.round(Number(args[2]) || 0)), bus: on(args[3]) ? 'pgm' : 'pvw' });
        case 'fade': return host.actions.run({ type: 'ftb', screen: n1(args[0], 'screen'), dir: on(args[1]) ? host.FADE_IN : host.FADE_OUT });
        case 'freeze': return host.actions.run({ type: 'freeze', input: n1(args[0], 'input'), on: on(args[1] ?? 1) });
        case 'black': return host.actions.run({ type: 'black', output: n1(args[0], 'output'), on: on(args[1] ?? 1) });
        case 'cue':
          if (sub === 'go' || sub == null) return host.cues.goNext();
          if (sub === 'hold') return host.cues.hold();
          if (sub === 'back') return host.cues.back();
          return host.cues.go(n1(sub, 'cue'));
        case 'key': return host.keys.run(n1(sub ?? args[0], 'key'));
      }
      console.warn('OSC: nothing answers', name);
    });

    const set = (patch) => cfg.set({ ...cfg.get(), ...patch });
    host.view('osc', 'OSC input', {
      render() {
        const c = cfg.get();
        return el('div', {},
          el('div', { class: 'view-head' }, el('h1', { text: 'OSC input' }),
            el('span', { class: 'hint', text: host.bridged() ? (status.listening ? `listening on ${status.addr} · ${status.count || 0} heard` : status.error || 'off') : 'the hosted demo has no bridge to listen on' })),
          el('div', { class: 'panel' },
            el('div', { class: 'row', style: 'flex-wrap:wrap' },
              el('label', { class: 'field inline' }, host.checkbox(!!c.enabled, v => set({ enabled: v })), 'Listen for OSC'),
              el('label', { class: 'field' }, 'UDP port', el('input', { type: 'number', min: 1024, max: 65535, value: c.port, style: 'width:90px', onchange: e => set({ port: Math.max(1024, Math.min(65535, +e.target.value || DEFAULT_PORT)) }) })),
              el('label', { class: 'field inline', title: 'Off: only this machine can send (127.0.0.1). On: anything on the network can.' }, host.checkbox(!!c.lan, v => set({ lan: v })), 'Accept from the network'),
              el('span', { class: 'chip ' + (lease.held() ? 'on' : 'off') }, el('span', { class: 'dot' }), lease.held() ? 'this page runs OSC takes and cues' : 'another page runs OSC takes and cues')),
            el('div', { class: 'hint pad', text: 'The bridge listens, so OSC keeps arriving with every page closed — but a take, a recall or a cue runs on an open openrcs page, and is dropped when none is open. /set and /raw need no page.' })),
          el('div', { class: 'panel' }, el('h2', 'Heard'),
            heard.length ? el('div', { class: 'mono', style: 'font-size:12px;white-space:pre-line', text: heard.join('\n') }) : el('div', { class: 'empty-state', text: 'Nothing yet.' })),
          el('div', { class: 'panel' }, el('h2', 'Addresses'),
            ...ADDRESSES.map(([a, w]) => el('div', { class: 'cmd-ex' }, el('code', { text: a }), el('span', { class: 'hint', text: w })))));
      },
    }, { section: 'Setup' });
  },
};
