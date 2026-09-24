/*
 * Layer names — call a layer "Lectern cam" and see that everywhere a layer is
 * drawn: Workspace, Layers, Live, the layer bank.
 *
 * Neither platform has anywhere to keep one. A LiveCore labels inputs, screens,
 * outputs and memories (LBInp, LBScr, LBOut, LBPMe) but not layers; a Midra
 * labels nothing but has fixed layer roles (Frame, PiP 1…). So the names are
 * the show's, not the device's: they live in the bridge's shared data, every
 * open page sees the same ones, and they travel in a setup file.
 *
 * Keyed by screen and layer index — `"s.l"` — on both platforms. A layer
 * name is about the physical layer of a screen, whichever bank it is in.
 */

export default {
  id: 'layer-names',
  name: 'Layer names',
  description: 'Name a layer and the name shows wherever the surface draws it — the processor has nowhere to keep one.',
  setup(host) {
    const { el, store } = host;
    const names = host.shared('names', {});
    host.on('layerLabel', (s, l) => names.get()[`${s}.${l}`] || null);
    names.watch(() => host.notify());

    function row(s, l) {
      const key = `${s}.${l}`;
      const cur = names.get()[key] || '';
      const src = store.val('PRinp', s, host.liveCtx(s), l) || 0;
      return el('tr', {},
        el('td', { class: 'mono', text: `${host.isMidra() ? host.layerName(l) : 'L' + (l + 1)}` }),
        el('td', {}, el('input', { type: 'text', maxlength: 32, value: cur, placeholder: 'unnamed', style: 'width:220px',
          id: `lname-${key}`,
          onchange: (e) => names.update(n => { const v = e.target.value.trim(); if (v) n[key] = v; else delete n[key]; }) })),
        el('td', { class: 'hint', text: src ? `on air: ${host.sourceNameFor(src, l)}` : '' }));
    }

    host.view('layernames', 'Layer names', {
      enter() {
        for (const m of ['SCmly', 'SCssh']) if (store.byMnem.has(m)) store.scan(m);
        if (host.hasBanks()) store.scan('GCsta');
      },
      render() {
        const screens = host.activeScreens();
        const count = Object.keys(names.get()).length;
        return el('div', {},
          el('div', { class: 'view-head' }, el('h1', { text: 'Layer names' }),
            el('span', { class: 'hint', text: `${count} named · shared with every page on this bridge` })),
          screens.length ? null : el('div', { class: 'empty-state', text: 'No screen is set up yet.' }),
          ...screens.map(s => el('div', { class: 'panel' },
            el('h2', host.screenLabel(s)),
            el('table', { class: 'grid' },
              el('tbody', {}, ...Array.from({ length: host.layerCount(s) }, (_, l) => row(s, l)))))));
      },
    }, { section: 'Program' });

  },
};
