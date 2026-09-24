/*
 * HyperDecks — play, cue and record HyperDecks, and decks that emulate one
 * such as Mitti, with rules that play a deck when it goes on air and take
 * when its clip ends.
 *
 * Ported from LivePremier Plus. The protocol is vendored (protocol.js), the
 * link is LivePremier Plus's DeckLink on the bridge's TCP links (link.js), and
 * the rules are Mitti's, from the other side of the cable:
 *
 *   on program   play, or nothing
 *   on preview   rewind to the top of the clip, or nothing
 *   taken off    nothing, pause, rewind, or load the next clip
 *   clip ends    take, cut, or nothing — on the screens it is on air on,
 *                optionally some seconds before the last frame
 *
 * "On air" on a LiveCore or a Midra: the deck's source is on a visible layer
 * of a screen's program bank — and during a take both banks count, so a deck
 * rolls as the take begins. The page running the rules reads those layers
 * once a second (neither platform pushes a change it did not make), so a take
 * from the front panel is seen within a second.
 *
 * Rules run on one page only — the `rules` lease — or a clip ending would
 * take once per open page. Every page can still drive a deck by hand.
 *
 * Never run against a real deck from openrcs. The protocol and link are
 * LivePremier Plus's, proven there against a simulator and against Mitti.
 */

import { DeckLink } from './link.js';
import { PROFILES, profileOf, COMMAND_NAMES, HYPERDECK_PORT, clipPosition } from './protocol.js';

const ON_PROGRAM = [['play', 'Play'], ['none', 'Do nothing']];
const ON_PREVIEW = [['none', 'Do nothing'], ['rewind', 'Rewind to the top of the clip']];
const ON_LEAVE = [['none', 'Do nothing'], ['pause', 'Pause'], ['rewind', 'Stop and rewind'], ['next', 'Stop and load the next clip']];
const ON_END = [['none', 'Do nothing'], ['take', 'Take'], ['cut', 'Cut']];
const DEFAULT_RULES = { automate: false, screens: [], onProgram: 'play', onPreview: 'none', onLeave: 'none', onEnd: 'none', lead: 0 };

export default {
  id: 'hyperdeck',
  name: 'HyperDecks',
  description: 'Play, cue and record HyperDecks and decks that emulate one, such as Mitti — with rules that play a deck when it goes on air and take when its clip ends.',
  setup(host) {
    const { el, store } = host;
    const decks = host.shared('decks', []);   // [{id, name, host, port, profile, source, rules}]
    const links = new Map();                  // deck id -> DeckLink
    const log = [];
    const note = (t) => { log.unshift(`${new Date().toLocaleTimeString()}  ${t}`); log.length = Math.min(log.length, 40); host.notify(); };
    const lease = host.lease('rules');
    lease.onChange(() => host.notify());

    // ---- links follow the list ----
    function sync() {
      const list = decks.get();
      for (const [id, link] of links) {
        const d = list.find(x => x.id === id);
        if (!d || !d.host || d.host !== link.deck.host || d.port !== link.deck.port || d.profile !== link.deck.profile) { link.close(); links.delete(id); }
        else link.deck = d;
      }
      for (const d of list) {
        if (!d.host || links.has(d.id)) continue;
        links.set(d.id, new DeckLink(host, d, { onChange: () => host.notify(), onEnded: (e) => ended(d.id, e) }));
      }
      const wantRules = list.some(d => d.rules?.automate);
      lease.want(wantRules);
      host.notify();
    }
    decks.watch(sync);
    setTimeout(sync, 0);

    const resolve = (ref) => {
      const list = decks.get(), key = String(ref ?? '').trim().toLowerCase();
      if (key === 'all') return list;
      const hit = list.find(d => d.id === key || d.name.toLowerCase() === key);
      if (hit) return [hit];
      const n = Number(key);
      return Number.isInteger(n) && n >= 1 && n <= list.length ? [list[n - 1]] : [];
    };
    async function command(ref, name, args = {}) {
      const targets = resolve(ref);
      if (!targets.length) { note(`no deck “${ref}”`); return; }
      for (const d of targets) {
        const link = links.get(d.id);
        if (!link) { note(`${d.name}: no address`); continue; }
        const r = await link.send(name, args);
        note(r.ok ? `${d.name}: ${name}${args.clip ? ' ' + args.clip : ''}` : r.error);
      }
    }

    host.actions.define('hyperdeck', {
      label: 'HyperDeck command',
      fields: [
        { name: 'deck', label: 'Deck', type: 'select', options: () => [['all', 'All decks'], ...decks.get().map(d => [d.id, d.name])] },
        { name: 'command', label: 'Command', type: 'select', options: COMMAND_NAMES.map(c => [c, c]) },
        { name: 'clip', label: 'Clip', type: 'number', base: 0, min: 1, default: 1 },
      ],
      when: () => decks.get().length > 0,
      desc: a => `${a.deck === 'all' ? 'All decks' : decks.get().find(d => d.id === a.deck)?.name ?? a.deck} ${a.command}${a.command === 'clip' ? ' ' + a.clip : ''}`,
      run: a => command(a.deck, a.command, a.command === 'clip' ? { clip: a.clip } : {}),
    });
    // /openrcs/hyperdeck/<deck>/<command> [argument], over OSC
    host.forwarded('hyperdeck/*', (args, name) => {
      const [, ref, cmd] = name.split('/');
      if (!COMMAND_NAMES.includes(cmd)) { note(`OSC: no command “${cmd}”`); return; }
      if (args[0] === 0 || args[0] === false) return;   // a button's release
      command(decodeURIComponent(ref), cmd, cmd === 'clip' ? { clip: Number(args[0]) } : cmd === 'record' && typeof args[0] === 'string' ? { name: args[0] } : {});
    });

    // ---- where each deck is on air ----
    function airOf(src) {
      const out = { program: new Set(), preview: new Set() };
      if (!src) return out;
      const visible = (s, c, l) => (store.val('PRinp', s, c, l) || 0) === src && (store.val('PRalp', s, c, l) ?? 1) > 0;
      for (const s of host.activeScreens()) {
        const pgm = host.liveCtx(s), pvw = host.editCtx(s);
        const moving = host.hasBanks() && host.midTransition(s);
        for (let l = 0; l < host.layerCount(s); l++) {
          if (visible(s, pgm, l) || (moving && visible(s, pvw, l))) out.program.add(s);
          else if (pvw !== pgm && visible(s, pvw, l)) out.preview.add(s);
        }
      }
      for (const s of out.program) out.preview.delete(s);
      return out;
    }
    const scoped = (r, set) => r.screens?.length ? [...set].filter(s => r.screens.includes(s)) : [...set];
    let lastAir = new Map();
    let pollTimer = null, leadFired = new Map();
    function tick() {
      if (!lease.held()) return;
      const auto = decks.get().filter(d => d.rules?.automate && d.source);
      if (!auto.length) return;
      // Re-read what decides "on air": neither platform pushes a change it
      // did not make itself.
      if (host.hasBanks()) store.scan('GCsta');
      for (const s of host.activeScreens()) for (const c of new Set([host.liveCtx(s), host.editCtx(s)])) for (let l = 0; l < host.layerCount(s); l++) store.get('PRinp', [s, c, l]);
      const next = new Map(auto.map(d => [d.id, airOf(d.source)]));
      for (const d of auto) {
        const r = { ...DEFAULT_RULES, ...d.rules }, was = lastAir.get(d.id), now = next.get(d.id);
        if (was) {
          const onBefore = scoped(r, was.program).length > 0, onNow = scoped(r, now.program).length > 0;
          const pvBefore = scoped(r, was.preview).length > 0, pvNow = scoped(r, now.preview).length > 0;
          if (!onBefore && onNow && r.onProgram === 'play') { note(`${d.name} on air — play`); command(d.id, 'play'); }
          else if (onBefore && !onNow) {
            const seq = { pause: ['stop'], rewind: ['stop', 'rewind'], next: ['stop', 'next'] }[r.onLeave];
            if (seq) { note(`${d.name} off air — ${seq.join(', ')}`); (async () => { for (const c of seq) await command(d.id, c); })(); }
          } else if (!onNow && !pvBefore && pvNow && r.onPreview === 'rewind') { note(`${d.name} in preview — rewind`); command(d.id, 'rewind'); }
        }
        // End early by `lead` seconds: fire once per run when that little is left.
        const link = links.get(d.id);
        if (r.onEnd !== 'none' && r.lead > 0 && link?.transport.status === 'play') {
          const { remaining } = link.position();
          if (remaining != null && remaining <= r.lead && leadFired.get(d.id) !== link.run) {
            leadFired.set(d.id, link.run);
            endOf(d, now, `${r.lead}s before the end`);
          }
        }
      }
      lastAir = next;
    }
    function endOf(d, air, why) {
      const r = { ...DEFAULT_RULES, ...d.rules };
      const screens = scoped(r, air.program);
      if (!screens.length) return;
      note(`${d.name} clip ${why} — ${r.onEnd} ${screens.map(s => 'S' + (s + 1)).join(' ')}`);
      for (const s of screens) r.onEnd === 'cut' ? host.doCut(s) : host.doTake(s);
    }
    function ended(id, e) {
      if (!lease.held()) return;
      const d = decks.get().find(x => x.id === id);
      if (!d?.rules?.automate || !d.source || d.rules.onEnd === 'none') return;
      const link = links.get(id);
      if (d.rules.lead > 0 && leadFired.get(id) === e.run) return;    // already fired early
      endOf(d, airOf(d.source), 'ended');
    }
    pollTimer = setInterval(tick, 1000);

    // ---- the page ----
    let draft = { name: '', host: '', port: HYPERDECK_PORT, profile: 'hyperdeck' };
    const patch = (id, fn) => decks.update(ds => { const d = ds.find(x => x.id === id); if (d) fn(d); });
    function addDeck() {
      if (!draft.host.trim()) return;
      const id = `deck-${Date.now().toString(36)}`;
      decks.update(ds => ds.push({ id, name: draft.name.trim() || `Deck ${ds.length + 1}`, host: draft.host.trim(), port: +draft.port || HYPERDECK_PORT, profile: draft.profile, source: 0, rules: { ...DEFAULT_RULES } }));
      draft = { name: '', host: '', port: HYPERDECK_PORT, profile: draft.profile };
    }
    const fmtS = (s) => s == null ? '·' : `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, '0')}`;
    function deckPanel(d) {
      const link = links.get(d.id);
      const t = link?.transport || {};
      const pos = link ? clipPosition(t, link.clips) : {};
      const r = { ...DEFAULT_RULES, ...d.rules };
      const setRule = (k, v) => patch(d.id, x => { x.rules = { ...DEFAULT_RULES, ...x.rules, [k]: v }; });
      const air = airOf(d.source);
      const prof = profileOf(d.profile);
      return el('div', { class: 'panel' },
        el('div', { class: 'row' },
          el('h2', { style: 'margin:0' }, d.name),
          el('span', { class: 'chip ' + (link?.status === 'connected' ? 'on' : link?.status === 'error' ? 'bad' : 'off') }, el('span', { class: 'dot' }), link?.status || 'no address'),
          el('span', { class: 'hint mono', text: `${d.host}:${d.port} · ${prof.label}${link?.device?.model ? ' · ' + link.device.model : ''}` }),
          el('div', { class: 'spacer' }),
          air.program.size ? el('span', { class: 'chip bad' }, el('span', { class: 'dot' }), `on air S${[...air.program].map(s => s + 1).join(',')}`) : null,
          host.confirmBtn(`hd-del-${d.id}`, 'Remove', 'Tap again to remove', () => decks.update(ds => ds.splice(ds.findIndex(x => x.id === d.id), 1)))),
        link?.error ? el('div', { class: 'hint bad', text: link.error }) : null,
        link?.remoteDisabled ? el('div', { class: 'hint', text: 'Remote control is off on the deck; the first command asks it to allow it.' }) : null,
        el('div', { class: 'row', style: 'flex-wrap:wrap' },
          el('span', { class: 'hd-status', text: `${t.status || '—'} · clip ${t.clip ?? '·'} · ${fmtS(pos.elapsed)} / ${fmtS(pos.length)}${pos.remaining != null ? ` · ${fmtS(pos.remaining)} left` : ''}` }),
          ...['prev', 'rewind', 'play', 'stop', 'next'].map(c => el('button', { class: 'btn ' + (c === 'play' ? 'pvw' : 'ghost'), onclick: () => command(d.id, c) }, { prev: '⏮', rewind: '⏪ top', play: '▶ play', stop: '■ stop', next: '⏭' }[c])),
          prof.record ? host.confirmBtn(`hd-rec-${d.id}`, '● record', 'Tap again to record', () => command(d.id, 'record'), 'btn ghost') : null),
        link?.clips?.length ? el('div', { class: 'hd-clips' }, ...link.clips.map(c => el('button', { class: 'btn ghost' + (c.id === t.clip ? ' on' : ''), title: c.duration || '', onclick: () => command(d.id, 'clip', { clip: c.id }) }, `${c.id}. ${c.name}`))) : null,
        el('div', { class: 'sub-head' }, 'Rules'),
        el('div', { class: 'row', style: 'flex-wrap:wrap' },
          el('label', { class: 'field' }, 'Feeds source', host.enumSelect2(String(d.source || 0), [['0', '— none —'], ...Array.from({ length: host.srcMaxOf() }, (_, i) => [String(i + 1), host.sourceName(i + 1)])], v => patch(d.id, x => { x.source = +v; }))),
          el('label', { class: 'field inline', title: 'Off until you turn it on — a deck added to the list must not start rolling the next time its input is cut to' }, host.checkbox(r.automate, v => setRule('automate', v)), 'Follow the switcher'),
          el('label', { class: 'field' }, 'On program', host.enumSelect2(r.onProgram, ON_PROGRAM, v => setRule('onProgram', v))),
          el('label', { class: 'field' }, 'On preview', host.enumSelect2(r.onPreview, ON_PREVIEW, v => setRule('onPreview', v))),
          el('label', { class: 'field' }, 'Taken off', host.enumSelect2(r.onLeave, ON_LEAVE, v => setRule('onLeave', v))),
          el('label', { class: 'field' }, 'Clip ends', host.enumSelect2(r.onEnd, ON_END, v => setRule('onEnd', v))),
          r.onEnd !== 'none' ? el('label', { class: 'field', title: 'Fire the end action this many seconds before the last frame' }, 'Early by s', el('input', { type: 'number', min: 0, max: 60, step: 0.5, value: r.lead, style: 'width:64px', onchange: e => setRule('lead', Math.max(0, Math.min(60, +e.target.value || 0))) })) : null,
          el('label', { class: 'field', title: 'Screens the rules watch — none ticked means every screen' }, 'Screens',
            el('div', { class: 'seg' }, ...host.activeScreens().map(s => el('button', { class: r.screens.includes(s) ? 'on recall' : '', onclick: () => setRule('screens', r.screens.includes(s) ? r.screens.filter(x => x !== s) : [...r.screens, s]) }, String(s + 1)))))));
    }

    host.view('hyperdeck', 'HyperDecks', {
      render() {
        const list = decks.get();
        const auto = list.some(d => d.rules?.automate);
        return el('div', {},
          el('div', { class: 'view-head' }, el('h1', { text: 'HyperDecks' }),
            el('span', { class: 'hint', text: auto ? (lease.held() ? 'rules run on this page' : 'rules run on another open page') : 'play, cue and record — rules are off on every deck' })),
          !host.bridged() ? el('div', { class: 'panel hint', text: 'The hosted demo has no bridge, so no deck can be reached from here.' }) : null,
          ...list.map(deckPanel),
          el('div', { class: 'panel' }, el('h2', 'Add a deck'),
            el('div', { class: 'row', style: 'flex-wrap:wrap' },
              el('label', { class: 'field' }, 'Name', el('input', { type: 'text', value: draft.name, placeholder: 'Opener', style: 'width:140px', oninput: e => { draft.name = e.target.value; } })),
              el('label', { class: 'field' }, 'Address', el('input', { type: 'text', value: draft.host, placeholder: '192.168.1.50', style: 'width:150px', oninput: e => { draft.host = e.target.value; } })),
              el('label', { class: 'field' }, 'Port', el('input', { type: 'number', value: draft.port, style: 'width:80px', oninput: e => { draft.port = +e.target.value; } })),
              el('label', { class: 'field' }, 'Kind', host.enumSelect2(draft.profile, PROFILES.map(p => [p.id, p.label]), v => { draft.profile = v; host.notify(); })),
              el('button', { class: 'btn', onclick: addDeck }, 'Add')),
            el('div', { class: 'hint pad', text: 'Mitti: switch on HyperDeck control in its preferences; its cues are the clips. Never yet run against a real deck from openrcs — prove it on yours before a show.' })),
          log.length ? el('div', { class: 'panel' }, el('h2', 'Activity'), el('div', { class: 'mono', style: 'font-size:12px;white-space:pre-line', text: log.join('\n') })) : null);
      },
    }, { section: 'Program' });
    host.css(`.hd-status { font-family: var(--mono); font-size: 13px; min-width: 260px; } .hd-clips { display: flex; flex-wrap: wrap; gap: 6px; margin-top: 8px; }`);
  },
};
