/*
 * Remote access — this surface over Tailscale (HTTPS, or the tailnet
 * address) or ZeroTier, without binding it to the venue LAN.
 *
 * Ported from LivePremier Plus. The work is the bridge's (src/remote.rs);
 * this page is the switch and the status. HTTPS through `tailscale serve` is
 * the way worth having: it makes a remote page a secure context, which is
 * what Web MIDI, audio (LTC timecode) and WebHID (the Speed Editor) need.
 *
 * Joining or leaving a ZeroTier network changes the host's networking, so it
 * is offered only on a bridge started with --tailnet — the same appliance
 * gate the Tailnet page has. On a laptop those belong to its owner.
 */

const MODES = [['off', 'Off'], ['serve', 'HTTPS (tailscale serve)'], ['bind', 'Tailnet address (http)']];

export default {
  id: 'remote-access',
  name: 'Remote access',
  description: 'This surface served over Tailscale (HTTPS, or the tailnet address) or ZeroTier, without binding it to the venue LAN. Joining and leaving networks only on an appliance.',
  setup(host) {
    const { el } = host;
    const cfg = host.shared('config', { tailscale: 'off', httpsPort: 443, zerotier: false });
    cfg.watch(() => host.notify());
    let status = {}, appliance = false, ztId = '';
    host.onBridge((m) => { if (m.what === 'remote') { status = m.status || {}; if ('appliance' in m) appliance = !!m.appliance; host.notify(); } });
    const set = (p) => cfg.set({ ...cfg.get(), ...p });
    const link = (u) => el('a', { href: u, target: '_blank', rel: 'noopener', class: 'mono' }, u);

    host.view('remote', 'Remote access', {
      render() {
        const c = cfg.get();
        const ts = status.tailscale || {};
        return el('div', {},
          el('div', { class: 'view-head' }, el('h1', { text: 'Remote access' }),
            el('span', { class: 'hint', text: window.isSecureContext ? 'this page is a secure context' : 'this page is not a secure context — MIDI, audio and WebHID are hidden here' })),
          !host.bridged() ? el('div', { class: 'panel hint', text: 'The hosted demo has no bridge.' }) : null,
          el('div', { class: 'panel' }, el('h2', 'Tailscale'),
            el('div', { class: 'row', style: 'flex-wrap:wrap' },
              el('label', { class: 'field' }, 'Serve', host.enumSelect2(c.tailscale, MODES, v => set({ tailscale: v }))),
              c.tailscale === 'serve' ? el('label', { class: 'field' }, 'HTTPS port', host.enumSelect2(String(c.httpsPort), [['443', '443'], ['8443', '8443'], ['10000', '10000']], v => set({ httpsPort: +v }))) : null,
              ts.state ? el('span', { class: 'chip ' + (ts.state === 'Running' ? 'on' : 'off') }, el('span', { class: 'dot' }), `${ts.state}${ts.name ? ' · ' + ts.name : ''}`) : null),
            status.serveUrl ? el('div', { class: 'row pad' }, el('span', { class: 'hint', text: 'Open from any device on the tailnet:' }), link(status.serveUrl)) : null,
            c.tailscale === 'serve' && ts.state === 'Running' && ts.https === false ? el('div', { class: 'hint pad', text: 'HTTPS certificates are off for this tailnet. Turn them on once in the Tailscale admin console (DNS → HTTPS Certificates).' }) : null,
            status.serveError ? el('div', { class: 'hint pad bad', text: status.serveError }) : null,
            ts.error && c.tailscale !== 'off' ? el('div', { class: 'hint pad bad', text: ts.error }) : null,
            status.wildcard ? el('div', { class: 'hint pad', text: 'The bridge already listens on every address (--listen 0.0.0.0), so no extra listener is needed.' }) : null),
          el('div', { class: 'panel' }, el('h2', 'ZeroTier'),
            el('div', { class: 'row' }, el('label', { class: 'field inline' }, host.checkbox(!!c.zerotier, v => set({ zerotier: v })), 'Answer on this host’s ZeroTier addresses')),
            (status.zerotierNetworks || []).length ? el('table', { class: 'grid' },
              el('thead', el('tr', ...['Network', 'Name', 'Status', 'Addresses', ''].map(t => el('th', { text: t })))),
              el('tbody', ...status.zerotierNetworks.map(n => el('tr', {},
                el('td', { class: 'mono', text: n.id }), el('td', { text: n.name }), el('td', { text: n.status }),
                el('td', { class: 'mono', text: (n.addresses || []).join(', ') }),
                el('td', {}, appliance ? host.confirmBtn(`zt-leave-${n.id}`, 'Leave', 'Tap again to leave', () => host.store.tailnet('zt-leave', n.id)) : null))))) : null,
            status.zerotierError ? el('div', { class: 'hint pad bad', text: status.zerotierError }) : null,
            appliance ? el('div', { class: 'row pad' },
              el('label', { class: 'field' }, 'Join network', el('input', { type: 'text', value: ztId, placeholder: '16 hex digits', maxlength: 16, style: 'width:170px', oninput: e => { ztId = e.target.value.trim(); } })),
              el('button', { class: 'btn', onclick: () => host.store.tailnet('zt-join', ztId) }, 'Join'),
              host.store.tailnetErr ? el('span', { class: 'hint bad', text: host.store.tailnetErr }) : null)
              : el('div', { class: 'hint pad', text: 'Joining and leaving networks is for an appliance (a bridge started with --tailnet). Use zerotier-cli on this host.' })),
          (status.doors || []).length ? el('div', { class: 'panel' }, el('h2', 'Also answering on'),
            ...status.doors.map(d => el('div', { class: 'row' }, link(d.url), el('span', { class: 'hint', text: `over ${d.via}` })))) : null,
          (status.doorErrors || []).length ? el('div', { class: 'panel hint bad', text: status.doorErrors.join(' · ') }) : null,
          el('div', { class: 'panel hint', text: 'Neither network is a login for this surface, and it has none: anyone who can reach it can drive the processor. The tailnet’s ACLs or the ZeroTier controller’s rules are the access control.' }));
      },
    }, { section: 'Setup' });
  },
};
