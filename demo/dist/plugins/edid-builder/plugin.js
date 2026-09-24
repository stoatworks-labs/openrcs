/*
 * EDID builder — the Otter EDID editor, saving straight onto an input.
 *
 * Ported from LivePremier Plus. There the editor saves into the LivePremier's
 * EDID bank; a LiveCore or a Midra has no bank to speak of, but every input
 * plug holds an EDID of its own that can be written byte by byte —
 * EDID_IN_DATA (`EIdat[input, plug, 256]`) and then EDID_IN_STORE (`EIstr`).
 * So the slots Otter offers are the input plugs, and a save is 256 writes and
 * a store, read back to check.
 *
 * - **256 bytes, two blocks.** That is all `EIdat` holds. An EDID with more
 *   than one extension block is refused with a sentence, not truncated —
 *   which is also why the LivePremier's tiled-display (Mosaic) EDIDs, 384
 *   bytes, cannot go onto these inputs.
 * - The editor is Otter's, vendored whole (otter-edid-embed.js). Its
 *   stylesheet styles `body`, so it opens in a window of its own
 *   (editor.html), which reaches back to this page for its host.
 * - Writing an input's EDID changes what every source plugged into it is
 *   offered. The surface's own EDID view has the factory reset.
 */

export default {
  id: 'edid-builder',
  name: 'EDID builder',
  description: 'Build or edit an EDID in the Otter EDID editor and save it straight onto an input plug — 256 bytes, read back to check.',
  requires: (h) => h.store.byMnem.has('EIdat') || 'this processor cannot be sent an EDID',
  setup(host) {
    const { el, store } = host;
    const NIN = () => store.byMnem.get('EIdat')?.dims[0] || 0;
    const NPLUG = () => store.byMnem.get('EIdat')?.dims[1] || 0;
    const listeners = new Set();
    const changed = () => { for (const fn of listeners) { try { fn(); } catch { /* window gone */ } } host.notify(); };
    const status = new Map();          // "i.p" -> text
    let otter = null;
    const loadOtter = () => (otter ??= import('./otter-edid-embed.js'));
    const names = new Map();           // "i.p" -> product name read back

    const plugLabel = (i, p) => `IN ${i + 1} · ${host.plugName(p)}`;
    function plugs() {
      const out = [];
      for (let i = 0; i < NIN(); i++) for (let p = 0; p < NPLUG(); p++) {
        const avail = store.val('EIava', i, p);
        if (avail === 0) continue;
        out.push({ i, p, id: `${i}.${p}` });
      }
      return out;
    }

    async function readBytes(i, p) {
      for (let b = 0; b < 256; b++) store.get('EIdat', [i, p, b]);
      for (let t = 0; t < 30; t++) {
        await host.sleep(100);
        if (store.val('EIdat', i, p, 255) != null) break;
      }
      const bytes = new Uint8Array(256);
      for (let b = 0; b < 256; b++) bytes[b] = store.val('EIdat', i, p, b) ?? 0;
      // A single-block EDID says so in byte 126; the rest is padding.
      const blocks = 1 + Math.min(1, bytes[126] || 0);
      return bytes.slice(0, blocks * 128);
    }

    async function save(slotId, bytes) {
      const [i, p] = slotId.split('.').map(Number);
      if (bytes.length > 256) throw new Error(`This EDID is ${bytes.length} bytes. An input here holds 256 — the base block and one extension — so remove the extension blocks past the first.`);
      if (bytes.length % 128) throw new Error('An EDID is whole 128-byte blocks; this one is not.');
      const padded = new Uint8Array(256);
      padded.set(bytes);
      for (let b = 0; b < 256; b++) store.set('EIdat', [i, p, b], padded[b]);
      store.set('EIstr', [i, p], 1);
      status.set(slotId, 'written — reading back…'); changed();
      await host.sleep(1500);
      const back = await readBytes(i, p);
      const same = back.length >= bytes.length && bytes.every((v, k) => back[k] === v);
      status.set(slotId, same ? `stored and read back identical (${bytes.length} bytes)` : 'written, but the read-back differs — the input may have refused it');
      try { const o = await loadOtter(); names.set(slotId, o.describeEdid(back)?.name || ''); } catch { /* cosmetic */ }
      changed();
      if (!same) throw new Error('The processor did not keep those bytes.');
    }

    let initial = null;
    window.__openrcsEdidHost = {
      host: () => ({
        title: `${host.store.meta?.platform === 'midra' ? 'Midra' : 'LiveCore'} inputs`,
        slots: () => plugs().map(x => ({ id: x.id, label: plugLabel(x.i, x.p), name: names.get(x.id) || '', empty: false, locked: false })),
        subscribe: (fn) => { listeners.add(fn); return () => listeners.delete(fn); },
        save,
        ...(initial ? { initial } : {}),
      }),
    };

    async function openEditor(slot) {
      initial = null;
      if (slot) {
        status.set(slot.id, 'reading…'); host.notify();
        const bytes = await readBytes(slot.i, slot.p);
        status.delete(slot.id);
        initial = { bytes, slotId: slot.id };
      }
      window.open(new URL('./editor.html', import.meta.url).href, 'openrcs-edid', 'width=1280,height=900');
      host.notify();
    }

    host.view('edidbuilder', 'EDID builder', {
      enter() { if (store.byMnem.has('EIava')) store.scan('EIava'); if (store.byMnem.has('EIhcd')) store.scan('EIhcd'); },
      render() {
        const list = plugs();
        return el('div', {},
          el('div', { class: 'view-head' }, el('h1', { text: 'EDID builder' }),
            el('span', { class: 'hint', text: 'The Otter EDID editor, saving onto an input plug' }),
            el('div', { class: 'spacer' }),
            el('button', { class: 'btn primary', onclick: () => openEditor(null) }, 'New EDID…')),
          el('div', { class: 'panel hint', text: 'An input here holds 256 bytes: the base block and one extension. Saving overwrites what that plug offers every source plugged into it — the EDID page has Factory to undo it. Opens in a window of its own.' }),
          el('div', { class: 'panel' },
            el('table', { class: 'grid' },
              el('thead', el('tr', ...['Input', 'Hashcode', 'Name', '', ''].map(t => el('th', { text: t })))),
              el('tbody', ...list.map(x => el('tr', {},
                el('td', { text: plugLabel(x.i, x.p) }),
                el('td', { class: 'val', text: String(store.val('EIhcd', x.i, x.p) ?? '·') }),
                el('td', { text: names.get(x.id) || '' }),
                el('td', {}, el('button', { class: 'btn ghost', onclick: () => openEditor(x) }, 'Edit…')),
                el('td', { class: 'hint', text: status.get(x.id) || '' })))))));
      },
    }, { section: 'Setup' });
  },
};
