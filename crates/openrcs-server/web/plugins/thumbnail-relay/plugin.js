/*
 * Thumbnail relay — a LiveCore's input thumbnails fetched once by the bridge
 * for every open page, and handed out as JPEG.
 *
 * Ported from LivePremier Plus's `snapshot-relay`. Without it every open page
 * fetches every input's PNG from the processor's own web server every three
 * seconds: five pages, twenty inputs, a hundred requests per tick at a box
 * that is also running the show, and full-size PNGs over whatever link the
 * page is on — a tailnet included. With it, the bridge fetches each picture
 * at most once per tick (`/plus/snap/in/<n>.jpg`, src/plus.rs) and the pages
 * share it.
 *
 * LiveCore only: a Midra serves no pictures at all.
 *
 * It switches itself on only after the bridge has served one picture; until
 * then, and whenever the relay fails, the page fetches from the processor
 * directly as it always has. Never yet run against a processor's pictures —
 * the relay path is unit-tested, the device's own URL is as the core uses it.
 */

export default {
  id: 'thumbnail-relay',
  name: 'Thumbnail relay',
  description: 'A LiveCore’s input thumbnails fetched once by the bridge for every page and re-encoded as JPEG — far fewer requests to the processor, far fewer bytes to each page.',
  requires: (h) => h.isLiveCore() || 'only a LiveCore serves input thumbnails',
  setup(host) {
    let ok = false, tried = false, why = '';
    async function probe() {
      if (tried || !host.bridged() || !host.isLiveCore()) return;
      tried = true;
      try {
        const res = await fetch('/plus/snap/in/1.jpg', { cache: 'no-store' });
        ok = res.ok;
        why = ok ? '' : await res.text();
      } catch (err) { ok = false; why = err.message; }
      host.notify();
    }
    host.on('snapshotUrl', (n, tick) => (ok ? `/plus/snap/in/${n}.jpg?t=${tick}` : null));
    host.store.subscribe(() => { if (!tried && host.store.meta) probe(); });

    host.view('thumbrelay', 'Thumbnail relay', {
      render() {
        return host.el('div', {},
          host.el('div', { class: 'view-head' }, host.el('h1', { text: 'Thumbnail relay' })),
          host.el('div', { class: 'panel' },
            host.el('div', { class: 'row' },
              host.el('span', { class: 'chip ' + (ok ? 'on' : 'off') }, host.el('span', { class: 'dot' }), ok ? 'relaying through the bridge' : 'pages fetch from the processor directly'),
              host.el('button', { class: 'btn ghost', onclick: () => { tried = false; probe(); } }, 'Try again')),
            why ? host.el('div', { class: 'hint pad', text: `The bridge could not relay: ${why}` }) : null,
            host.el('div', { class: 'hint pad', text: 'Thumbnails show on the Workspace. The bridge fetches each input at most once every 2 s for all pages, as a JPEG.' })));
      },
    }, { section: 'Setup' });
  },
};
