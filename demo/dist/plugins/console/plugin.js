/*
 * Command line — takes, recalls and layer moves typed rather than clicked.
 *
 * Ported from LivePremier Plus's Console. The grammar is in lang.js and is
 * pure; this file turns a parse into writes, through the same verbs the rest
 * of the surface uses (doTake, recallMemory, the actions) so a typed take is
 * the take the button sends. openrcs's own Tools → Console is still the raw
 * protocol line; this one speaks words, and `!` passes a raw line through.
 *
 * Selection is this page's own (not shared): `Select Screen 1 Layer 1 Thru 3`
 * then `Source 4` acts on those three, in preview unless `Program` is said.
 */

import { parse, keywordTable, EXAMPLES } from './lang.js';

export default {
  id: 'console',
  name: 'Command line',
  description: 'A command line over the processor — Take Screen 1, Recall Master 5, Select Screen 1 Layer 1 Thru 3, Source 4 — with short forms and arithmetic.',
  setup(host) {
    const { el, store } = host;
    let sel = { screens: [], layers: [], mode: 'Preview' };
    const history = [];
    let hIdx = -1;
    const log = [];        // {cmd, ok, text}
    let draft = '';
    let helpOpen = false;
    const say = (cmd, ok, text) => { log.push({ cmd, ok, text }); if (log.length > 200) log.shift(); host.notify(); };

    const idx = (list, n, what) => {
      for (const v of list) if (!Number.isInteger(v) || v < 1 || v > n) throw new Error(`${what} ${v} does not exist here (1–${n})`);
      return list.map(v => v - 1);
    };
    const screensOf = (p) => p.objects.All || !p.objects.Screen ? null : idx(p.objects.Screen, host.screenCount(), 'Screen');
    const ctxFor = (s, mode) => mode === 'Program' ? host.liveCtx(s) : host.editCtx(s);

    function targets(p) {
      if (p.objects.Screen || p.objects.Layer) {
        const screens = screensOf(p) ?? sel.screens;
        if (!screens.length) throw new Error('which screen?');
        const layers = p.objects.Layer ? p.objects.Layer : null;
        const out = [];
        for (const s of screens) {
          const ls = layers ? idx(layers, host.layerCount(s), 'Layer') : sel.layers.length ? sel.layers : null;
          if (!ls) throw new Error('which layer?');
          for (const l of ls) out.push({ s, l });
        }
        return out;
      }
      if (!sel.screens.length || !sel.layers.length) throw new Error('nothing selected — Select Screen 1 Layer 1 first');
      return sel.screens.flatMap(s => sel.layers.map(l => ({ s, l })));
    }

    function applyAttrs(ts, attrs, mode) {
      host.presetEditMode();
      const done = [];
      for (const { s, l } of ts) {
        const c = ctxFor(s, mode);
        const r = host.layerRect(s, c, l);
        let geom = false;
        for (const [a, v] of attrs) {
          if (a === 'Source') {
            if (v !== 0 && !host.sourceAvailable(v)) throw new Error(`source ${v} is not available on this processor`);
            store.set('PRinp', [s, c, l], v);
          } else if (a === 'Opacity') {
            const def = store.byMnem.get('PRalp');
            if (!def) throw new Error('this processor has no layer opacity');
            store.set('PRalp', [s, c, l], Math.round(Math.max(0, Math.min(100, v)) / 100 * def.max));
          } else if (a === 'X') { r.left = v - r.w / 2; geom = true; }
          else if (a === 'Y') { r.top = v - r.h / 2; geom = true; }
          else if (a === 'Width') { const cx = r.left + r.w / 2; r.w = v; r.left = cx - v / 2; geom = true; }
          else if (a === 'Height') { const cy = r.top + r.h / 2; r.h = v; r.top = cy - v / 2; geom = true; }
        }
        if (geom) host.placeLayer(s, c, l, r);
        done.push(`S${s + 1} ${host.layerName(l, s)}`);
      }
      return done;
    }

    function run(line) {
      const p = parse(line);
      if (p.error) throw new Error(p.error);
      const take = p.flags?.has('Take');
      const time = p.attrs?.find(([a]) => a === 'Time')?.[1];
      const fade = time != null ? Math.round(time * 1000) : undefined;
      switch (p.verb) {
        case 'Raw': store.raw(p.raw); return `sent ${p.raw}`;
        case 'Help': helpOpen = true; return 'the word list is open on the right';
        case 'Take': case 'Cut': {
          if (p.objects.Layer || p.flags.has('Alone')) {
            const locks = host.use('locks');
            if (!locks) throw new Error('taking a layer alone needs the Layer Lock plugin');
            const ts = targets(p);
            locks.takeOnly(ts, p.verb === 'Cut');
            return `${p.verb.toLowerCase()} ${ts.length} layer${ts.length === 1 ? '' : 's'} alone`;
          }
          if (p.objects.Group) return groupTake(p);
          const screens = screensOf(p) ?? host.activeScreens();
          for (const s of screens) p.verb === 'Take' ? host.doTake(s, fade) : host.doCut(s);
          return `${p.verb.toLowerCase()} ${screens.map(s => 'S' + (s + 1)).join(' ')}${fade ? ` over ${time}s` : ''}`;
        }
        case 'Stepback': {
          const screens = screensOf(p) ?? host.activeScreens();
          for (const s of screens) host.doStepBack(s);
          return `step back ${screens.map(s => 'S' + (s + 1)).join(' ')}`;
        }
        case 'Recall': {
          const scope = p.objects.Memory ? 'screen' : 'master';
          const slotList = p.objects.Memory || p.objects.Master || p.objects.Preset;
          if (!slotList?.length) throw new Error('which memory? — Recall Master 5, or Recall Screen 1 Memory 5');
          if (scope === 'screen' && host.isMidra()) throw new Error('a Midra has presets, not screen memories — Recall Preset 3');
          const [slot] = idx(slotList.slice(0, 1), host.memorySlots(scope), scope === 'master' ? (host.isMidra() ? 'Preset' : 'Master') : 'Memory');
          const screens = scope === 'screen' ? (screensOf(p) ?? sel.screens) : [0];
          if (scope === 'screen' && !screens.length) throw new Error('which screen?');
          for (const s of screens) host.recallMemory({ scope, slot, screen: s, take, fade });
          return `${take ? 'recall + take' : 'recall to preview'}: ${scope === 'master' ? host.memoryLabel('master', slot) : screens.map(s => host.memoryLabel('screen', slot, s)).join(', ')}`;
        }
        case 'Store': return store_(p);
        case 'Select': {
          const screens = screensOf(p) ?? sel.screens;
          const layers = p.objects.Layer ? idx(p.objects.Layer, Math.max(...screens.map(s => host.layerCount(s)), 1), 'Layer') : [];
          sel = { screens, layers, mode: p.mode || sel.mode };
          return `selected ${screens.map(s => 'S' + (s + 1)).join(' ') || 'no screen'}${layers.length ? ' layer ' + layers.map(l => l + 1).join(', ') : ''}`;
        }
        case 'Set': {
          if (p.objects.Group) return groupSend(p);
          const attrs = p.attrs.filter(([a]) => a !== 'Time');
          if (!attrs.length) throw new Error('set what? — Source, Opacity, X, Y, Width, Height');
          const done = applyAttrs(targets(p), attrs, p.mode || sel.mode);
          return `${attrs.map(([a, v]) => `${a} ${v}`).join(', ')} → ${done.join(', ')} (${(p.mode || sel.mode).toLowerCase()})`;
        }
        case 'Clear': {
          const mode = p.mode || 'Preview';
          const screens = screensOf(p) ?? sel.screens;
          const ts = p.objects.Layer || (!p.objects.Screen && sel.layers.length) ? targets(p)
            : screens.flatMap(s => Array.from({ length: host.layerCount(s) }, (_, l) => ({ s, l })));
          if (!ts.length) throw new Error('clear what?');
          host.presetEditMode();
          for (const { s, l } of ts) store.set('PRinp', [s, ctxFor(s, mode), l], 0);
          return `cleared ${ts.length} layer${ts.length === 1 ? '' : 's'} (${mode.toLowerCase()})`;
        }
        case 'Go': {
          if (p.objects.Cue?.length) { const [c] = idx(p.objects.Cue, host.cues.list().length, 'Cue'); host.cues.go(c); return `GO cue ${c + 1}`; }
          host.cues.goNext(); return 'GO next';
        }
        case 'Hold': host.cues.hold(); return 'hold';
        case 'Back': host.cues.back(); return 'back one cue';
        case 'Run': {
          const [k] = idx(p.objects.Key, host.keys.list().length, 'Key');
          host.keys.run(k); return `key ${k + 1}: ${host.keys.list()[k].name}`;
        }
        case 'Fade': {
          if (!store.byMnem.has('MAmfa')) throw new Error('this processor has no master fade');
          const screens = screensOf(p) ?? host.activeScreens();
          const dir = p.flags.has('In') ? host.FADE_IN : host.FADE_OUT;
          for (const s of screens) store.set('MAmfa', [s], dir);
          return `${dir === host.FADE_IN ? 'fade up' : 'fade to black'} ${screens.map(s => 'S' + (s + 1)).join(' ')}`;
        }
        case 'Freeze': {
          const ins = idx(p.objects.Input || [], host.inputCount(), 'Input');
          if (!ins.length) throw new Error('which input?');
          for (const i of ins) store.set('INfrz', [i], p.flags.has('Off') ? 0 : 1);
          return `${p.flags.has('Off') ? 'unfroze' : 'froze'} input ${ins.map(i => i + 1).join(', ')}`;
        }
        case 'Black': {
          const outs = idx(p.objects.Output || [], host.outputCount(), 'Output');
          if (!outs.length) throw new Error('which output?');
          for (const o of outs) store.set('OUbla', [o], p.flags.has('Off') ? 0 : 1);
          return `${p.flags.has('Off') ? 'unblacked' : 'blacked'} output ${outs.map(o => o + 1).join(', ')}`;
        }
        case 'Lock': case 'Unlock': {
          const ts = targets(p);
          for (const { s, l } of ts) host.actions.run({ type: 'layer-lock', screen: s, layer: l, on: p.verb === 'Lock' });
          if (!host.use('locks')) throw new Error('locking needs the Layer Lock plugin');
          return `${p.verb.toLowerCase()}ed ${ts.length} layer${ts.length === 1 ? '' : 's'}`;
        }
      }
      throw new Error(`${p.verb} is not something this processor does`);
    }

    function store_(p) {
      const over = p.flags.has('Overwrite');
      if (host.isMidra()) {
        const [n] = idx(p.objects.Preset || p.objects.Master || [], 8, 'Preset');
        if (n == null) throw new Error('which preset?');
        if (store.val('PMpst', n) === 1 && !over) throw new Error(`preset ${n + 1} is in use — add Overwrite to replace it`);
        store.set('GCsrq', [2, n], 1);
        setTimeout(() => store.get('PMpst', [n]), 400);
        return `stored program into preset ${n + 1}`;
      }
      if (p.objects.Memory) {
        const [s] = screensOf(p) ?? sel.screens;
        if (s == null) throw new Error('which screen?');
        const [n] = idx(p.objects.Memory, host.memorySlots('screen'), 'Memory');
        if ((store.val('PMscw', n) || 0) > 0 && !over) throw new Error(`memory ${n + 1} is in use — add Overwrite to replace it`);
        store.set('PMcat', [], 4095); store.set('PMscf', [], s); store.set('PMmet', [], n);
        store.set('PMprf', [], p.mode === 'Preview' ? 1 : 0); store.set('PMsav', [], 1);
        setTimeout(() => store.scan('PMscw'), 400);
        return `stored screen ${s + 1} ${p.mode === 'Preview' ? 'preview' : 'program'} into memory ${n + 1}`;
      }
      const [n] = idx(p.objects.Master || [], host.memorySlots('master'), 'Master');
      if (n == null) throw new Error('store what? — Store Master 5, or Store Screen 1 Memory 5');
      if (store.val('PSval', n) === 1 && !over) throw new Error(`master ${n + 1} is in use — add Overwrite to replace it`);
      store.set('PSmet', [], n); store.set('PSprf', [], p.mode === 'Preview' ? 1 : 0); store.set('PSsav', [], 1);
      setTimeout(() => store.scan('PSval'), 400);
      return `stored ${p.mode === 'Preview' ? 'preview' : 'program'} into master ${n + 1}`;
    }

    const findGroup = (p) => {
      const api = host.use('groups');
      if (!api) throw new Error('groups need the Layer Groups plugin');
      const key = p.objects.Group[0];
      const g = typeof key === 'string' ? api.list().find(x => x.name.toLowerCase() === key.toLowerCase()) : api.list()[key - 1];
      if (!g) throw new Error(`no layer group ${typeof key === 'string' ? `“${key}”` : key}`);
      return { api, g };
    };
    function groupSend(p) {
      const { api, g } = findGroup(p);
      const src = p.attrs.find(([a]) => a === 'Source');
      if (!src) throw new Error('a group takes a Source — Group 1 Source 4');
      api.sendTo(g, src[1], p.mode === 'Program' ? 'pgm' : 'pvw');
      return `${host.sourceName(src[1])} → ${g.name}`;
    }
    function groupTake(p) {
      const { g } = findGroup(p);
      const locks = host.use('locks');
      if (!locks) throw new Error('taking a group alone needs the Layer Lock plugin');
      locks.takeOnly(g.members);
      return `took ${g.name} alone`;
    }

    function submit(line) {
      const cmd = line.trim();
      if (!cmd) return;
      history.push(cmd); hIdx = -1; draft = '';
      try { say(cmd, true, run(cmd)); } catch (err) { say(cmd, false, err.message); }
    }

    const preview = () => {
      const t = draft.trim();
      if (!t) return '';
      const p = parse(t);
      if (p.error) return p.error === 'empty' ? '' : '⚠ ' + p.error;
      if (p.verb === 'Raw') return `raw: ${p.raw}`;
      const objs = Object.entries(p.objects).map(([k, v]) => v === true ? k : `${k} ${v.join(',')}`).join(' ');
      return [p.verb, objs, p.mode, ...p.attrs.map(([a, v]) => `${a}=${v}`), ...(p.flags || [])].filter(Boolean).join(' · ');
    };

    function help() {
      return el('div', { class: 'panel cmd-help' },
        el('h2', 'Words'),
        el('div', { class: 'cmd-words' }, ...keywordTable().map(k => el('span', { class: 'cmd-word', title: `${k.word} (${k.kind})` }, el('b', { text: k.short }), k.word.slice(k.short.length)))),
        el('h2', 'Worth knowing'),
        ...EXAMPLES.map(([c, w]) => el('div', { class: 'cmd-ex' }, el('code', { text: c }), el('span', { class: 'hint', text: w }))));
    }

    host.view('commandline', 'Command line', {
      enter() {
        for (const m of ['SCmly', 'SCssh', 'PSval', 'PMscw', 'PMpst']) if (store.byMnem.has(m)) store.scan(m);
        if (host.hasBanks()) store.scan('GCsta');
      },
      render() {
        return el('div', { class: 'cmd-page' },
          el('div', { class: 'view-head' }, el('h1', { text: 'Command line' }),
            el('span', { class: 'hint', text: sel.screens.length ? `Selected: ${sel.screens.map(s => 'S' + (s + 1)).join(' ')}${sel.layers.length ? ' · layer ' + sel.layers.map(l => l + 1).join(', ') : ''} · ${sel.mode.toLowerCase()}` : 'Nothing selected' }),
            el('div', { class: 'spacer' }),
            el('button', { class: 'btn ghost' + (helpOpen ? ' on' : ''), onclick: () => { helpOpen = !helpOpen; host.notify(); } }, 'Words'),
            host.popoutButton('commandline')),
          el('div', { class: helpOpen ? 'split' : '' },
            el('div', { class: 'panel' },
              el('div', { class: 'cmd-log', key: 'cmd-log' }, ...log.slice(-60).map(e => el('div', { class: 'cmd-line' + (e.ok ? '' : ' bad') },
                el('code', { text: '› ' + e.cmd }), el('span', { text: e.text })))),
              el('input', { id: 'cmd-input', class: 'cmd-input', type: 'text', autocomplete: 'off', spellcheck: 'false',
                placeholder: 'Take Screen 1 · Recall Master 5 · Sel Sc 1 La 1 Thru 3 · Source 4', value: draft,
                oninput: (e) => { draft = e.target.value; host.notify(); },
                onkeydown: (e) => {
                  if (e.key === 'Enter') { submit(e.target.value); e.target.value = ''; }
                  else if (e.key === 'ArrowUp' && history.length) { hIdx = hIdx < 0 ? history.length - 1 : Math.max(0, hIdx - 1); draft = e.target.value = history[hIdx]; e.preventDefault(); }
                  else if (e.key === 'ArrowDown' && hIdx >= 0) { hIdx = hIdx + 1 >= history.length ? -1 : hIdx + 1; draft = e.target.value = hIdx < 0 ? '' : history[hIdx]; e.preventDefault(); }
                } }),
              el('div', { class: 'hint cmd-preview', text: preview() })),
            helpOpen ? help() : null));
      },
      afterRender() {
        const logEl = document.querySelector('.cmd-log');
        if (logEl) logEl.scrollTop = logEl.scrollHeight;
      },
    }, { section: 'Program' });

    host.css(`
      .cmd-log { max-height: 50vh; overflow: auto; font-family: var(--mono); font-size: 12px; margin-bottom: 8px; }
      .cmd-line { display: flex; gap: 12px; padding: 3px 0; border-bottom: 1px solid var(--line); }
      .cmd-line code { color: var(--text); min-width: 40%; }
      .cmd-line span { color: var(--muted); }
      .cmd-line.bad span { color: var(--pgm); }
      .cmd-input { width: 100%; font-family: var(--mono); font-size: 15px; padding: 10px; }
      .cmd-preview { min-height: 1.4em; font-family: var(--mono); margin-top: 6px; }
      .cmd-words { display: flex; flex-wrap: wrap; gap: 6px; margin-bottom: 12px; }
      .cmd-word { font-family: var(--mono); font-size: 12px; color: var(--faint); background: var(--panel-2); padding: 2px 6px; border-radius: var(--r); }
      .cmd-word b { color: var(--text); }
    `);
  },
};
