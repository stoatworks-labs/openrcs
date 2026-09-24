/*
 * Setup file — the show's own setup as one JSON file, and back.
 *
 * Ported from LivePremier Plus. A Show file (Tools → Shows) is the
 * processor's state; this is everything around it that is openrcs's: the cue
 * list, the keys, and every plugin's shared data — layer groups and names,
 * locks, HyperDecks, routers and their patch, MIDI maps, Companion triggers,
 * OSC and remote-access settings.
 *
 * Restoring writes the plugins' data to the bridge, so every open page has it
 * at once. The cue list and keys are this browser's (as they always have
 * been in openrcs) and are restored here; another open page keeps its own
 * until it is reloaded from the same file.
 */

const FORMAT = 'openrcs-setup';

export default {
  id: 'setup-file',
  name: 'Setup file',
  description: 'Cue list, keys and every plugin’s data — groups, names, locks, decks, routers, maps — as one JSON file, and back.',
  setup(host) {
    const { el } = host;
    let msg = '';

    function capture() {
      return {
        format: FORMAT, version: 1, created: new Date().toISOString(),
        platform: host.platform(),
        cues: host.cues.snapshot?.() ?? null,
        keys: host.keys.snapshot?.() ?? null,
        plugins: host.sharedAll(),
      };
    }
    function download() {
      const blob = new Blob([JSON.stringify(capture(), null, 2)], { type: 'application/json' });
      const a = el('a', { href: URL.createObjectURL(blob), download: `openrcs-setup-${new Date().toISOString().slice(0, 10)}.json` });
      document.body.append(a); a.click(); a.remove();
      setTimeout(() => URL.revokeObjectURL(a.href), 1000);
      msg = 'Saved.'; host.notify();
    }
    async function restore(file) {
      try {
        const data = JSON.parse(await file.text());
        if (data.format !== FORMAT) throw new Error('not an openrcs setup file');
        let n = 0;
        for (const [k, v] of Object.entries(data.plugins || {})) { if (/^[a-z0-9-]+\.[A-Za-z0-9_-]+$/.test(k)) { host.sharedSet(k, v); n++; } }
        if (data.cues) host.cues.restore?.(data.cues);
        if (data.keys) host.keys.restore?.(data.keys);
        const other = data.platform && data.platform !== host.platform() ? ` It was saved on a ${data.platform}; groups, names and patches name screens, layers and sources by number, so check them here.` : '';
        msg = `Restored ${n} plugin setting${n === 1 ? '' : 's'}${data.cues ? `, ${data.cues.cues?.length ?? 0} cues` : ''}${data.keys ? `, ${data.keys.length} keys` : ''}.${other}`;
      } catch (err) { msg = `Not restored: ${err.message}`; }
      host.notify();
    }

    host.view('setupfile', 'Setup file', {
      render() {
        const keys = Object.keys(host.sharedAll());
        return el('div', {},
          el('div', { class: 'view-head' }, el('h1', { text: 'Setup file' }),
            el('span', { class: 'hint', text: 'openrcs’s own setup, beside the processor’s (Shows)' })),
          el('div', { class: 'panel' },
            el('div', { class: 'row' },
              el('button', { class: 'btn primary', onclick: download }, 'Save setup file'),
              el('label', { class: 'btn ghost' }, 'Restore from a file…', el('input', { type: 'file', accept: '.json,application/json', style: 'display:none', onchange: e => { const f = e.target.files?.[0]; if (f) restore(f); e.target.value = ''; } }))),
            msg ? el('div', { class: 'hint pad', text: msg }) : null,
            el('div', { class: 'hint pad', text: `Holds the cue list (${host.cues.list().length}), the keys (${host.keys.list().length}) and ${keys.length} plugin setting${keys.length === 1 ? '' : 's'}${keys.length ? ': ' + keys.join(', ') : ''}.` })));
      },
    }, { section: 'Tools' });
  },
};
