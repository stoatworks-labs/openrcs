/*
 * Companion — Bitfocus Companion's buttons pressed by a key, a cue, MIDI, OSC
 * or a memory recall, and its own tablet page on this surface.
 *
 * Ported from LivePremier Plus, with one deliberate difference. There the
 * buttons are drawn natively over Companion's own tRPC socket, reached
 * through the proxy LivePremier Plus already is. openrcs is not a proxy, and
 * that socket is Companion's private API, so this uses the two surfaces
 * Companion publishes for exactly this:
 *
 * - **TCP remote control** (Settings → Protocols → TCP, port 16759 by
 *   default): `LOCATION <page>/<row>/<column> PRESS`. This is what every
 *   press here sends, through a link the bridge holds.
 * - **The tablet page** (`http://<companion>:8000/tablet`), shown in a frame
 *   so the grid can be pressed by hand from here.
 *
 * Memory triggers press a button when this surface recalls a memory — the
 * recall a key, a cue or the Memories page sends. A recall made at the
 * processor's front panel is not seen. They fire on one page only (the
 * `triggers` lease), so two open pages do not press twice.
 *
 * openrcs's own Companion module (companion-module-openrcs) is the other
 * direction — Companion driving openrcs — and needs nothing from this.
 */

const DEFAULTS = { host: '', tcpPort: 16759, webPort: 8000, frame: 'tablet' };

export default {
  id: 'companion',
  name: 'Companion',
  description: 'Bitfocus Companion buttons pressed by a key, a cue, MIDI, OSC or a memory recall — over Companion’s TCP remote control — and its tablet page here.',
  setup(host) {
    const { el, store } = host;
    const cfg = host.shared('config', DEFAULTS);
    const triggers = host.shared('triggers', []);   // [{id, scope:'master'|'screen', slot, screen, button:'p/r/c'}]
    const lease = host.lease('triggers');
    let link = null, linkKey = '', state = 'off', detail = '', last = '';
    const log = [];
    const note = (t) => { log.unshift(`${new Date().toLocaleTimeString()}  ${t}`); log.length = Math.min(log.length, 30); host.notify(); };

    function connect() {
      const c = { ...DEFAULTS, ...cfg.get() };
      const key = `${c.host}:${c.tcpPort}`;
      if (key === linkKey) return;
      if (link) { link.close(); link = null; }
      linkKey = key;
      if (!c.host) { state = 'off'; host.notify(); return; }
      link = host.link('companion', c.host, c.tcpPort);
      link.onStatus((s, d) => { state = s; detail = d || ''; host.notify(); });
      link.onData((text) => { for (const line of text.split(/\r?\n/)) if (line.trim()) last = line.trim(); host.notify(); });
      link.open();
    }
    cfg.watch(connect);
    triggers.watch(() => { lease.want(triggers.get().length > 0); host.notify(); });
    setTimeout(() => { connect(); lease.want(triggers.get().length > 0); }, 0);

    const valid = (b) => /^\d+\/\d+\/\d+$/.test(String(b || '').trim());
    function press(button, how = 'PRESS') {
      if (!valid(button)) { note(`“${button}” is not page/row/column`); return false; }
      if (!link || state !== 'open') { note(`not connected to Companion — ${button} not pressed`); return false; }
      link.send(`LOCATION ${button.trim()} ${how}\n`);
      note(`pressed ${button}`);
      return true;
    }

    host.actions.define('companion', {
      label: 'Companion: press a button',
      fields: [{ name: 'button', label: 'Page/row/column', type: 'text', default: '1/0/1', width: 90 }],
      desc: a => `Companion ${a.button}`,
      run: a => press(a.button),
    });
    host.forwarded('companion/*', (args, name) => { const b = name.split('/').slice(1).join('/') || String(args[0] ?? ''); if (args[0] !== 0) press(b); });

    // Memory triggers: watch this surface's own recall writes.
    let sel = { psmet: null, pmmet: null, pmscf: null };
    host.on('afterSet', (m, idx, v) => {
      if (m === 'PSmet') sel.psmet = v; else if (m === 'PMmet') sel.pmmet = v; else if (m === 'PMscf') sel.pmscf = v;
      else if ((m === 'PSloa' || m === 'PSlot') && v === 1) fire('master', sel.psmet, null);
      else if ((m === 'PMloa' || m === 'PMlot') && v === 1) fire('screen', sel.pmmet, sel.pmscf);
    });
    host.on('midraRecall', ({ slot }) => fire('master', slot, null));
    function fire(scope, slot, screen) {
      if (!lease.held() || slot == null) return;
      for (const t of triggers.get()) {
        if (t.scope !== scope || t.slot !== slot) continue;
        if (scope === 'screen' && t.screen != null && t.screen >= 0 && t.screen !== screen) continue;
        press(t.button);
      }
    }

    const tdraft = { scope: 'master', slot: 0, screen: -1, button: '1/0/1' };
    host.view('companion', 'Companion', {
      render() {
        const c = { ...DEFAULTS, ...cfg.get() };
        const set = (p) => cfg.set({ ...c, ...p });
        const frameUrl = c.host ? `http://${c.host}:${c.webPort}/${c.frame}` : '';
        return el('div', {},
          el('div', { class: 'view-head' }, el('h1', { text: 'Companion' }),
            el('span', { class: 'chip ' + (state === 'open' ? 'on' : state === 'error' ? 'bad' : 'off') }, el('span', { class: 'dot' }), state === 'open' ? 'TCP connected' : state === 'off' ? 'not set up' : state),
            last ? el('span', { class: 'hint mono', text: `last reply: ${last}` }) : null),
          el('div', { class: 'panel' },
            el('div', { class: 'row', style: 'flex-wrap:wrap' },
              el('label', { class: 'field' }, 'Companion address', el('input', { type: 'text', value: c.host, placeholder: '192.168.1.20', style: 'width:150px', onchange: e => set({ host: e.target.value.trim() }) })),
              el('label', { class: 'field' }, 'TCP port', el('input', { type: 'number', value: c.tcpPort, style: 'width:80px', onchange: e => set({ tcpPort: +e.target.value || 16759 }) })),
              el('label', { class: 'field' }, 'Web port', el('input', { type: 'number', value: c.webPort, style: 'width:80px', onchange: e => set({ webPort: +e.target.value || 8000 }) })),
              el('label', { class: 'field' }, 'Page', host.enumSelect2(c.frame, [['tablet', 'Tablet'], ['emulator', 'Emulator'], ['', 'Admin']], v => set({ frame: v })))),
            detail && state !== 'open' ? el('div', { class: 'hint pad bad', text: detail }) : null,
            el('div', { class: 'hint pad', text: 'Turn on TCP in Companion: Settings → Protocols → TCP (port 16759). Presses go there; the frame below is Companion’s own page.' + (host.bridged() ? '' : ' The hosted demo has no bridge to send them from.') })),
          el('div', { class: 'panel' }, el('h2', 'Memory triggers'),
            el('div', { class: 'hint', text: lease.held() ? 'Triggers fire from this page.' : triggers.get().length ? 'Triggers fire from another open page.' : 'Press a button when this surface recalls a memory.' }),
            triggers.get().length ? el('div', { class: 'action-list' }, ...triggers.get().map(t => el('div', { class: 'action-item' },
              el('span', { class: 'action-desc', text: `${t.scope === 'master' ? host.memoryLabel('master', t.slot) : `Screen memory ${t.slot + 1}${t.screen >= 0 ? ` on screen ${t.screen + 1}` : ''}`} → press ${t.button}` }),
              el('button', { class: 'btn ghost', onclick: () => triggers.update(ts => ts.splice(ts.findIndex(x => x.id === t.id), 1)) }, '✕')))) : null,
            el('div', { class: 'row', style: 'flex-wrap:wrap' },
              el('label', { class: 'field' }, 'On', host.enumSelect2(tdraft.scope, host.memoryScopes().map(s => [s, s === 'master' ? (host.isMidra() ? 'Preset' : 'Master') : 'Screen memory']), v => { tdraft.scope = v; host.notify(); })),
              el('label', { class: 'field' }, 'Slot', el('input', { type: 'number', min: 1, max: host.memorySlots(tdraft.scope), value: tdraft.slot + 1, style: 'width:70px', oninput: e => { tdraft.slot = Math.max(0, (+e.target.value || 1) - 1); } })),
              el('label', { class: 'field' }, 'Button', el('input', { type: 'text', value: tdraft.button, placeholder: 'page/row/col', style: 'width:90px', oninput: e => { tdraft.button = e.target.value; } })),
              el('button', { class: 'btn', onclick: () => { if (valid(tdraft.button)) triggers.update(ts => ts.push({ id: Date.now(), scope: tdraft.scope, slot: tdraft.slot, screen: -1, button: tdraft.button.trim() })); } }, 'Add trigger')),
            host.isMidra() ? el('div', { class: 'hint pad', text: 'A Midra preset is re-applied by this surface, so a trigger fires on a recall from a key, a cue, OSC or the command line — not from the Memories or Workspace pages, which apply presets their own way.' }) : null),
          frameUrl ? el('div', { class: 'panel' },
            el('div', { class: 'row' }, el('h2', { style: 'margin:0' }, 'Buttons'), el('div', { class: 'spacer' }), el('a', { class: 'btn ghost', href: frameUrl, target: '_blank', rel: 'noopener' }, 'Open in a tab')),
            el('iframe', { class: 'companion-frame', src: frameUrl, key: 'companion-frame:' + frameUrl, title: 'Companion' })) : null,
          log.length ? el('div', { class: 'panel' }, el('h2', 'Activity'), el('div', { class: 'mono', style: 'font-size:12px;white-space:pre-line', text: log.join('\n') })) : null);
      },
    }, { section: 'Program' });
    host.css(`.companion-frame { width: 100%; height: 60vh; border: 1px solid var(--line); border-radius: var(--r); background: #000; margin-top: 8px; }`);
  },
};
