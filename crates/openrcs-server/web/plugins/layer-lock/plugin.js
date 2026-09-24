/*
 * Layer Lock — lock a layer so a take leaves it where it is, or take one
 * layer (or one layer group) alone.
 *
 * Ported from LivePremier Plus's `layer-lock`. Neither the LiveCore nor the
 * Midra has a per-layer take: a take moves the whole preview bank to air. So
 * both halves use the same move LivePremier Plus does — **make preview equal
 * program** for the layers that must not change, just before the take:
 *
 * - **Lock.** Before any take or cut this surface sends (`beforeTake`), every
 *   locked layer on the screens being taken has its program values copied
 *   into preview. The take then puts on air exactly what was already there.
 * - **Take alone.** The same copy for every layer *except* the chosen ones,
 *   then a take. Only the chosen layers change. Anything else waiting in
 *   preview is overwritten by the copy — the panel says so before you press.
 *
 * The copy only writes the properties that differ. On a LiveCore the writes
 * are held until GCupd; the core forces that commit and waits past it before
 * the take leaves (see `afterHooks` in app.js).
 *
 * The limits, stated rather than hidden:
 * - A take from the processor's own front panel, or from another client,
 *   never passes through here, so it is not held.
 * - The copy is made from what this bridge has read. The layers under lock
 *   are re-read when the lock is set, when the page opens, and after every
 *   take, so the cache is as fresh as the bridge can make it; an edit made
 *   at the front panel in the last second before a take can still be missed.
 * - Simulator- and fixture-proven only. Never yet run against a processor.
 */

export default {
  id: 'layer-lock',
  name: 'Layer Lock',
  description: 'Lock a layer so a take leaves it where it is, or take one layer (or one group) alone.',
  setup(host) {
    const { el, store } = host;
    const locks = host.shared('locks', []);   // [{s, l}]
    locks.watch(() => { refresh(); host.notify(); });
    const isLocked = (s, l) => locks.get().some(x => x.s === s && x.l === l);

    function fetchLayer(s, l) {
      for (const ctx of new Set([host.liveCtx(s), host.editCtx(s)]))
        for (const m of host.layerLeaves()) store.get(m, [s, ctx, l]);
    }
    function refresh() { for (const x of locks.get()) fetchLayer(x.s, x.l); }

    // Copy program → preview for one layer; returns the writes made.
    function hold(s, l) {
      const pgm = host.liveCtx(s), pvw = host.editCtx(s);
      if (pgm === pvw) return 0;
      let n = 0;
      // Source last: a Midra refuses a source with no signal and says
      // nothing, so the geometry is in place whatever happens to it.
      const leaves = host.layerLeaves().sort((a, b) => (a === 'PRinp') - (b === 'PRinp'));
      for (const m of leaves) {
        const v = store.val(m, s, pgm, l);
        if (v == null || store.val(m, s, pvw, l) === v) continue;
        // Quietly: a layer group's gang must not carry the hold to the
        // group's other layers.
        host.quietly(() => store.set(m, [s, pvw, l], v));
        n++;
      }
      return n;
    }

    // The gate on every take this surface sends.
    let only = null;           // {s -> Set(l)} while a take-alone is running
    host.on('beforeTake', ({ screens }) => {
      let n = 0;
      for (const s of screens) {
        if (only) {
          const keep = only.get(s);
          if (keep) for (let l = 0; l < host.layerCount(s); l++) if (!keep.has(l)) n += hold(s, l);
          continue;
        }
        for (const x of locks.get()) if (x.s === s) n += hold(s, x.l);
      }
      setTimeout(refresh, 1500);
      return n;
    });

    /** Take just these layers: [{s, l}]. Every other layer on their screens stays. */
    function takeOnly(targets, cut = false) {
      const byScreen = new Map();
      for (const x of targets) { if (!byScreen.has(x.s)) byScreen.set(x.s, new Set()); byScreen.get(x.s).add(x.l); }
      only = byScreen;
      try {
        for (const s of byScreen.keys()) (cut ? host.doCut : host.doTake)(s);
      } finally { only = null; }
    }
    host.provide('locks', { list: () => locks.get(), isLocked, takeOnly });

    host.actions.define('layer-take-alone', {
      label: 'Take one layer alone', fields: ['screen', 'layer'],
      desc: a => `Take ${host.screenLabel(a.screen)} ${host.layerName(a.layer, a.screen)} alone`,
      run: a => takeOnly([{ s: a.screen, l: a.layer }]),
    });
    host.actions.define('layer-lock', {
      label: 'Lock / unlock a layer', fields: ['screen', 'layer', 'on'],
      desc: a => `${a.on ? 'Lock' : 'Unlock'} ${host.screenLabel(a.screen)} ${host.layerName(a.layer, a.screen)}`,
      run: a => setLock(a.screen, a.layer, !!a.on),
    });
    const groupsApi = () => host.use('groups');
    host.actions.define('group-take-alone', {
      label: 'Take a layer group alone',
      fields: [{ name: 'group', label: 'Group', type: 'select', options: () => (groupsApi()?.list() || []).map(g => [g.id, g.name]) }],
      when: () => (groupsApi()?.list() || []).length > 0,
      desc: a => `Take ${(groupsApi()?.list() || []).find(g => g.id === a.group)?.name ?? 'a deleted group'} alone`,
      run: a => { const g = groupsApi()?.list().find(x => x.id === a.group); if (g) takeOnly(g.members); },
    });

    function setLock(s, l, on) {
      locks.update(list => {
        const i = list.findIndex(x => x.s === s && x.l === l);
        if (on && i < 0) list.push({ s, l });
        if (!on && i >= 0) list.splice(i, 1);
      });
      if (on) fetchLayer(s, l);
    }

    function screenPanel(s) {
      const pgm = host.liveCtx(s), pvw = host.editCtx(s);
      return el('div', { class: 'panel' },
        el('h2', host.screenLabel(s)),
        el('table', { class: 'grid' },
          el('thead', {}, el('tr', {}, ...['Layer', 'Program', 'Preview', 'Lock', ''].map(t => el('th', { text: t })))),
          el('tbody', {}, ...Array.from({ length: host.layerCount(s) }, (_, l) => {
            const locked = isLocked(s, l);
            const a = store.val('PRinp', s, pgm, l) || 0, b = store.val('PRinp', s, pvw, l) || 0;
            return el('tr', { class: locked ? 'locked' : '' },
              el('td', { text: host.layerName(l, s) }),
              el('td', { text: a ? host.sourceNameFor(a, l) : '—' }),
              el('td', { text: b ? host.sourceNameFor(b, l) : '—' }),
              el('td', {}, el('button', { class: 'btn ' + (locked ? 'armed' : 'ghost'), title: locked ? 'Locked: a take leaves this layer as it is on program' : 'Lock this layer',
                onclick: () => setLock(s, l, !locked) }, locked ? '🔒 Locked' : 'Lock')),
              el('td', {}, host.confirmBtn(`ll-alone-${s}-${l}`, 'Take alone', 'Tap again — every other layer on this screen keeps program', () => takeOnly([{ s, l }]), 'btn ghost')));
          }))));
    }

    host.view('layerlock', 'Layer lock', {
      enter() {
        host.presetEditMode();
        for (const m of ['SCmly', 'SCssh']) if (store.byMnem.has(m)) store.scan(m);
        if (host.hasBanks()) store.scan('GCsta');
        for (const s of host.activeScreens()) for (let l = 0; l < host.layerCount(s); l++) for (const ctx of [0, 1]) store.get('PRinp', [s, ctx, l]);
        refresh();
      },
      render() {
        const n = locks.get().length;
        return el('div', {},
          el('div', { class: 'view-head' }, el('h1', { text: 'Layer lock' }),
            el('span', { class: 'hint', text: n ? `${n} layer${n === 1 ? '' : 's'} locked — takes from this surface leave ${n === 1 ? 'it' : 'them'} as they are` : 'Lock a layer to keep it through takes, or take one layer alone' })),
          el('div', { class: 'panel hint', text: 'A take from the processor’s front panel or another client is not held. “Take alone” overwrites every other layer’s preview with its program first.' }),
          ...host.activeScreens().map(screenPanel));
      },
    }, { section: 'Program' });

    // Anything already locked is read now, so the first take has values.
    setTimeout(refresh, 1500);
    host.css('tr.locked td { background: rgba(240,160,32,.08); }');
  },
};
