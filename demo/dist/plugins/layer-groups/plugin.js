/*
 * Layer Groups and Send to — several layers, across screens, driven as one.
 *
 * Ported from LivePremier Plus's `layer-groups` and `send-to` plugins. A group
 * is a list of (screen, layer) members. Two things act on it:
 *
 * - **The gang.** With the gang on, a change to one member's property — from
 *   any view, by any route through the store — is made to every other member
 *   too, on the same bus: program follows program, preview follows preview,
 *   whichever bank that is on each member's screen. Position and size follow
 *   by the same *difference* rather than to the same value, so three PiPs in a
 *   row move together instead of landing on top of each other. Which property
 *   families follow is per group (the memory filter's own categories).
 * - **Send to.** Put one source on every member at once, on preview or
 *   program — from this page, or as an action (a key, a cue, a MIDI pad).
 *
 * What the gang cannot see: a change made at the processor's front panel or
 * by another client. It follows the store's writes (`afterSet`), which is
 * everything this bridge's pages send; the device does not report who moved
 * what.
 */

const CATS = [['Source', 0], ['Pos/size', 1], ['Transparency', 2], ['Crop', 3], ['Border', 4], ['Transitions', 5], ['Effects', 6]];
const DELTA = new Set(['PRpoh', 'PRpov', 'PRsih', 'PRsiv']);

export default {
  id: 'layer-groups',
  name: 'Layer Groups',
  description: 'Several layers, across screens, driven as one — a gang that follows a change to any of them, and Send to: one source onto every member in a tap.',
  setup(host) {
    const { el, store } = host;
    const groups = host.shared('groups', []);   // [{ id, name, members:[{s,l}], gang, cats:[bit] }]
    groups.watch(() => host.notify());
    const list = () => groups.get();
    const ctxFor = (s, bus) => bus === 'pgm' ? host.liveCtx(s) : host.editCtx(s);

    // ---- the gang ----
    host.on('afterSet', (m, idx, v, prev) => {
      if (!/^PR/.test(m) || idx.length !== 3) return;
      const cat = host.LAYER_CAT[m];
      if (cat == null) return;
      const [s, ctx, l] = idx;
      const bus = ctx === host.liveCtx(s) ? 'pgm' : 'pvw';
      const def = store.byMnem.get(m);
      for (const g of list()) {
        if (!g.gang || !(g.cats || []).includes(cat)) continue;
        if (!g.members.some(x => x.s === s && x.l === l)) continue;
        for (const x of g.members) {
          if (x.s === s && x.l === l) continue;
          const c2 = ctxFor(x.s, bus);
          if (DELTA.has(m)) {
            // Geometry moves by the difference, and through the working-area
            // clamp — the gang is a write point like any other.
            if (prev == null || store.val(m, x.s, c2, x.l) == null) continue;   // nothing to move it from yet
            const d = v - prev, r = host.layerRect(x.s, c2, x.l);
            if (m === 'PRpoh') r.left += d;
            else if (m === 'PRpov') r.top += d;
            else if (m === 'PRsih') { r.w += d; r.left -= d / 2; }
            else { r.h += d; r.top -= d / 2; }
            host.placeLayer(x.s, c2, x.l, r);
            continue;
          }
          store.set(m, [x.s, c2, x.l], def ? Math.max(def.min, Math.min(def.max, v)) : v);
        }
      }
    });

    // Read what the gang moves from, for every member on both buses.
    function fetchMembers(g) {
      for (const x of g.members)
        for (const ctx of new Set([host.liveCtx(x.s), host.editCtx(x.s)]))
          for (const m of ['PRinp', 'PRpoh', 'PRpov', 'PRsih', 'PRsiv']) if (store.byMnem.has(m)) store.get(m, [x.s, ctx, x.l]);
    }

    // ---- Send to ----
    function sendTo(g, input, bus) {
      host.presetEditMode();
      // Every member is written here, so the gang has nothing to add.
      host.quietly(() => { for (const x of g.members) store.set('PRinp', [x.s, ctxFor(x.s, bus), x.l], input); });
    }
    host.actions.define('group-send', {
      label: 'Send a source to a layer group',
      fields: [
        { name: 'group', label: 'Group', type: 'select', options: () => list().map(g => [g.id, g.name]) },
        'input', 'bus'],
      when: () => list().length > 0,
      desc: a => `${host.sourceName(a.input)} → ${list().find(g => g.id === a.group)?.name ?? 'a deleted group'} (${a.bus === 'pgm' ? 'program' : 'preview'})`,
      run: a => { const g = list().find(x => x.id === a.group); if (g) sendTo(g, a.input, a.bus); },
    });
    host.actions.define('group-gang', {
      label: 'Layer group gang on/off',
      fields: [{ name: 'group', label: 'Group', type: 'select', options: () => list().map(g => [g.id, g.name]) }, 'on'],
      when: () => list().length > 0,
      desc: a => `${a.on ? 'Gang' : 'Ungang'} ${list().find(g => g.id === a.group)?.name ?? 'a deleted group'}`,
      run: a => groups.update(gs => { const g = gs.find(x => x.id === a.group); if (g) g.gang = !!a.on; }),
    });

    // The service other plugins use (Layer Lock takes a group alone).
    host.provide('groups', { list, sendTo });

    // ---- the page ----
    let open = null;
    let addS = 0, addL = 0;
    let sendInput = 1, sendBus = 'pvw';

    function patch(id, fn) { groups.update(gs => { const g = gs.find(x => x.id === id); if (g) fn(g); }); }

    function editor(g) {
      return el('div', { class: 'panel' },
        el('div', { class: 'row', style: 'flex-wrap:wrap' },
          el('label', { class: 'field' }, 'Name', el('input', { type: 'text', value: g.name, style: 'width:200px', onchange: e => patch(g.id, x => { x.name = e.target.value.trim() || x.name; }) })),
          el('label', { class: 'field', title: 'A change to one member is made to all of them' }, 'Gang', host.checkbox(!!g.gang, v => { patch(g.id, x => { x.gang = v; }); if (v) fetchMembers(g); })),
          el('div', { class: 'spacer' }),
          host.confirmBtn(`lg-del-${g.id}`, 'Delete group', 'Tap again to delete', () => { groups.update(gs => gs.splice(gs.findIndex(x => x.id === g.id), 1)); open = null; })),
        el('div', { class: 'sub-head' }, 'What the gang follows'),
        el('div', { class: 'row', style: 'flex-wrap:wrap' }, ...CATS.map(([label, bit]) =>
          el('label', { class: 'field inline' }, host.checkbox((g.cats || []).includes(bit), v => patch(g.id, x => { x.cats = (x.cats || []).filter(b => b !== bit); if (v) x.cats.push(bit); })), label))),
        el('div', { class: 'sub-head' }, `Members (${g.members.length})`),
        g.members.length ? el('div', { class: 'action-list' }, ...g.members.map((x, i) => el('div', { class: 'action-item' },
          el('span', { class: 'action-n', text: i + 1 }),
          el('span', { class: 'action-desc', text: `${host.screenLabel(x.s)} · ${host.layerName(x.l, x.s)} — ${host.sourceName(store.val('PRinp', x.s, host.liveCtx(x.s), x.l) || 0)} on air` }),
          el('button', { class: 'btn ghost', onclick: () => patch(g.id, y => y.members.splice(i, 1)) }, '✕'))))
          : el('div', { class: 'hint', text: 'No members yet.' }),
        el('div', { class: 'row' },
          el('label', { class: 'field' }, 'Screen', host.screenSelect(addS, v => { addS = v; host.notify(); })),
          el('label', { class: 'field' }, 'Layer', el('select', { onchange: e => { addL = +e.target.value; } },
            ...Array.from({ length: host.layerCount(addS) }, (_, l) => el('option', { value: l, selected: l === addL || undefined }, host.layerName(l, addS))))),
          el('button', { class: 'btn', onclick: () => patch(g.id, x => { if (!x.members.some(y => y.s === addS && y.l === addL)) x.members.push({ s: addS, l: addL }); }) }, 'Add member')),
        el('div', { class: 'sub-head' }, 'Send to'),
        el('div', { class: 'row', style: 'flex-wrap:wrap' },
          el('label', { class: 'field' }, 'Source', srcSelect()),
          el('div', { class: 'seg' },
            el('button', { class: sendBus === 'pvw' ? 'on recall' : '', onclick: () => { sendBus = 'pvw'; host.notify(); } }, 'Preview'),
            el('button', { class: sendBus === 'pgm' ? 'on take' : '', onclick: () => { sendBus = 'pgm'; host.notify(); } }, 'Program')),
          sendBus === 'pgm'
            ? host.confirmBtn(`lg-send-${g.id}`, 'Send to program', 'Tap again — goes on air', () => sendTo(g, sendInput, 'pgm'), 'btn pgm')
            : el('button', { class: 'btn pvw', onclick: () => sendTo(g, sendInput, 'pvw') }, 'Send to preview')));
    }
    function srcSelect() {
      const s = el('select', { onchange: e => { sendInput = +e.target.value; } });
      for (let i = 0; i <= host.srcMaxOf(); i++) {
        if (i && !host.sourceAvailable(i)) continue;
        s.append(el('option', { value: i, selected: i === sendInput || undefined }, i ? host.sourceName(i) : 'None'));
      }
      return s;
    }

    host.view('layergroups', 'Layer groups', {
      enter() {
        for (const m of ['SCmly', 'SCssh']) if (store.byMnem.has(m)) store.scan(m);
        if (host.hasBanks()) store.scan('GCsta');
        for (const g of list()) fetchMembers(g);
      },
      render() {
        const gs = list();
        const cur = gs.find(g => g.id === open);
        return el('div', {},
          el('div', { class: 'view-head' }, el('h1', { text: 'Layer groups' }),
            el('span', { class: 'hint', text: 'Layers across screens driven as one · shared with every page on this bridge' }),
            el('div', { class: 'spacer' }),
            el('button', { class: 'btn', onclick: () => { const id = Date.now(); groups.update(x => x.push({ id, name: `Group ${x.length + 1}`, members: [], gang: false, cats: [1, 2] })); open = id; } }, '+ New group')),
          el('div', { class: 'panel' },
            gs.length ? el('div', { class: 'key-grid' }, ...gs.map(g => el('button', { class: 'user-key' + (g.id === open ? ' sel' : ''), onclick: () => { open = g.id; fetchMembers(g); host.notify(); } },
              el('span', { class: 'user-key-name', text: g.name }),
              el('span', { class: 'user-key-sub', text: `${g.members.length} layer${g.members.length === 1 ? '' : 's'}${g.gang ? ' · ganged' : ''}` }))))
              : el('div', { class: 'empty-state', text: 'No groups yet. A group is a set of layers — on one screen or several — that you can gang together or send one source to.' })),
          cur ? editor(cur) : null);
      },
    }, { section: 'Program' });
  },
};
