/*
 * Matrix Routing — patch the frame to a Videohub, Lightware or Turtle AV
 * router, and route through it.
 *
 * Ported from LivePremier Plus. The drivers are its own, unchanged, running on
 * a base class that puts their socket on the bridge (routers/driver.js). The
 * model is its `core/patch.js`: a router port and a processor socket are the
 * two ends of one cable, so the direction inverts —
 *
 *   processor INPUT   <--- cable ---   router OUTPUT     (the router feeds us)
 *   processor OUTPUT   --- cable --->  router INPUT      (we feed the router)
 *
 * — and two operations fall out:
 *
 * - **Feed an input**: choose what a processor input sees, which is one
 *   crosspoint on the router output cabled to it.
 * - **Send an output**: put a processor output on router destinations, one
 *   crosspoint per destination named. A send does not take away.
 *
 * Everything here counts from 1, as every front panel does; the Videohub's
 * 0-based wire is its driver's business alone. The grid only moves when the
 * router says so — a driver never writes its own state.
 *
 * A **placeholder** router has the right size and no socket: patch and route
 * a show before the real frame is on the network, then push the plan to it.
 *
 * Never run against a real router from openrcs; the drivers are proven only
 * as far as LivePremier Plus proved them (Videohub against its simulator,
 * Lightware and Turtle written from their manuals).
 */

import { setTransport } from './routers/driver.js';
import { VideohubDriver } from './routers/videohub.js';
import { LightwareDriver } from './routers/lightware.js';
import { TurtleDriver } from './routers/turtle.js';
import { PlaceholderDriver } from './routers/placeholder.js';

const KINDS = [
  { id: 'videohub', label: 'Blackmagic Videohub', port: 9990, make: (o) => new VideohubDriver(o) },
  { id: 'lightware', label: 'Lightware (LW3 6107 / LW2 10001)', port: 6107, make: (o) => new LightwareDriver(o) },
  { id: 'turtle', label: 'Turtle AV', port: 8000, make: (o) => new TurtleDriver(o) },
  { id: 'placeholder', label: 'Placeholder (no router yet)', port: 0, make: (o) => new PlaceholderDriver(o) },
];

export default {
  id: 'matrix-routing',
  name: 'Matrix routing',
  description: 'Patch the processor to a Videohub, Lightware or Turtle AV router and route through it — feed an input, send an output, or plan on a placeholder and push it later.',
  setup(host) {
    const { el, store } = host;
    setTransport((kind, h, p) => host.link(kind, h, p));
    const routers = host.shared('routers', []);          // [{id, name, kind, host, port, inputs, outputs, plan}]
    const patch = host.shared('patch', { inputs: {}, outputs: {} });
    const drivers = new Map();
    const log = [];
    const note = (t) => { log.unshift(`${new Date().toLocaleTimeString()}  ${t}`); log.length = Math.min(log.length, 30); host.notify(); };

    function sync() {
      const list = routers.get();
      for (const [id, d] of drivers) {
        const r = list.find(x => x.id === id);
        if (!r || r.kind !== d.kind || r.host !== d.host || (r.port || 0) !== (d.port || 0) || (r.kind === 'placeholder' && (r.inputs !== d.inputs || r.outputs !== d.outputs))) { d.close(); drivers.delete(id); }
      }
      for (const r of list) {
        if (drivers.has(r.id) || (r.kind !== 'placeholder' && !r.host)) continue;
        const kind = KINDS.find(k => k.id === r.kind);
        if (!kind) continue;
        const d = kind.make({ id: r.id, name: r.name, host: r.host, port: r.port, inputs: r.inputs, outputs: r.outputs, plan: r.plan, log: note });
        d.on('change', () => {
          // A placeholder's taken crosspoints are its plan: keep them with the show.
          if (d.kind === 'placeholder' && JSON.stringify(d.planned) !== JSON.stringify(routers.get().find(x => x.id === r.id)?.plan || {})) {
            routers.update(rs => { const x = rs.find(y => y.id === r.id); if (x) x.plan = { ...d.planned }; });
          }
          host.notify();
        });
        drivers.set(r.id, d);
        d.connect();
      }
      host.notify();
    }
    routers.watch(sync);
    patch.watch(() => host.notify());
    setTimeout(sync, 0);

    const nameOf = (id) => routers.get().find(r => r.id === id)?.name || 'a removed router';
    const inLabel = (d, n) => d?.state?.inputLabels?.[n] || `In ${n}`;
    const outLabel = (d, n) => d?.state?.outputLabels?.[n] || `Out ${n}`;
    function route(routerId, output, input) {
      const d = drivers.get(routerId);
      if (!d?.state) { note(`${nameOf(routerId)} is not connected`); return false; }
      const ok = d.route(output, input);
      note(ok ? `${d.name}: out ${output} ← in ${input}` : `${d.name}: refused out ${output} ← in ${input}`);
      return ok;
    }
    // Feed processor input i (0-based) from router input `source` (1-based).
    function feed(i, source) {
      const p = patch.get().inputs[i];
      if (!p) { note(`IN ${i + 1} is not patched to a router`); return; }
      route(p.router, p.port, source);
    }
    // Send processor output o (0-based) to router destination `dest` (1-based).
    function send(o, dest) {
      const p = patch.get().outputs[o];
      if (!p) { note(`OUT ${o + 1} is not patched to a router`); return; }
      route(p.router, dest, p.port);
    }

    host.actions.define('matrix-feed', {
      label: 'Router: feed a processor input', fields: ['input', { name: 'source', label: 'Router input', type: 'number', base: 0, min: 1, default: 1 }],
      when: () => Object.keys(patch.get().inputs).length > 0,
      desc: a => `feed IN ${a.input + 1} from router input ${a.source}`,
      run: a => feed(a.input, a.source),
    });
    host.actions.define('matrix-send', {
      label: 'Router: send a processor output', fields: ['output', { name: 'dest', label: 'Router output', type: 'number', base: 0, min: 1, default: 1 }],
      when: () => Object.keys(patch.get().outputs).length > 0,
      desc: a => `send OUT ${a.output + 1} to router output ${a.dest}`,
      run: a => send(a.output, a.dest),
    });
    host.actions.define('matrix-route', {
      label: 'Router: take a crosspoint',
      fields: [{ name: 'router', label: 'Router', type: 'select', options: () => routers.get().map(r => [r.id, r.name]) },
        { name: 'out', label: 'Output', type: 'number', base: 0, min: 1, default: 1 }, { name: 'in', label: 'Input', type: 'number', base: 0, min: 1, default: 1 }],
      when: () => routers.get().length > 0,
      desc: a => `${nameOf(a.router)}: out ${a.out} ← in ${a.in}`,
      run: a => route(a.router, a.out, a.in),
    });
    // /openrcs/matrix/feed <input> <source>, /openrcs/matrix/send <output> <dest>
    host.forwarded('matrix/*', (args, name) => {
      const verb = name.split('/')[1], a = Math.round(Number(args[0])) - 1, b = Math.round(Number(args[1]));
      if (verb === 'feed') feed(a, b); else if (verb === 'send') send(a, b); else note(`OSC: no matrix verb “${verb}”`);
    });

    // ---- the page ----
    let draft = { name: '', kind: 'videohub', host: '', port: 9990, inputs: 16, outputs: 16 };
    let pushFrom = '', pushTo = '';
    function addRouter() {
      const k = KINDS.find(x => x.id === draft.kind);
      if (draft.kind !== 'placeholder' && !draft.host.trim()) return;
      routers.update(rs => rs.push({ id: `mx-${Date.now().toString(36)}`, name: draft.name.trim() || `${k.label.split(' ')[0]} ${rs.length + 1}`, kind: draft.kind,
        host: draft.kind === 'placeholder' ? '' : draft.host.trim(), port: draft.kind === 'placeholder' ? 0 : (+draft.port || k.port),
        inputs: draft.kind === 'placeholder' ? Math.max(1, +draft.inputs || 16) : undefined, outputs: draft.kind === 'placeholder' ? Math.max(1, +draft.outputs || 16) : undefined, plan: {} }));
      draft = { ...draft, name: '', host: '' };
    }

    function grid(r) {
      const d = drivers.get(r.id), st = d?.state;
      if (!st) return el('div', { class: 'hint', text: d?.status === 'connecting' ? 'Connecting…' : d?.describe().error || 'Not connected.' });
      const opts = Array.from({ length: st.inputs }, (_, i) => [String(i + 1), `${i + 1}. ${inLabel(d, i + 1)}`]);
      return el('div', { class: 'mx-grid' }, ...Array.from({ length: st.outputs }, (_, o) => {
        const out = o + 1;
        return el('label', { class: 'field' + (st.locks?.[out] ? ' locked' : '') }, `${out}. ${outLabel(d, out)}`,
          host.enumSelect2(String(st.routing[out] ?? ''), [['', '—'], ...opts], v => { if (v) route(r.id, out, +v); }));
      }));
    }
    function routerPanel(r) {
      const d = drivers.get(r.id);
      const status = d?.status || 'disconnected';
      return el('div', { class: 'panel' },
        el('div', { class: 'row' },
          el('h2', { style: 'margin:0' }, r.name),
          el('span', { class: 'chip ' + (status === 'connected' ? 'on' : 'off') }, el('span', { class: 'dot' }), status),
          el('span', { class: 'hint mono', text: r.kind === 'placeholder' ? `placeholder ${r.inputs}×${r.outputs}` : `${KINDS.find(k => k.id === r.kind)?.label} · ${r.host}:${r.port}${d?.state?.model ? ' · ' + d.state.model : ''}` }),
          el('div', { class: 'spacer' }),
          host.confirmBtn(`mx-del-${r.id}`, 'Remove', 'Tap again to remove', () => routers.update(rs => rs.splice(rs.findIndex(x => x.id === r.id), 1)))),
        grid(r));
    }

    function patchRow(side, i) {
      const p = patch.get()[side][i] || null;
      const setP = (router, port) => patch.update(pt => { if (!router) delete pt[side][i]; else pt[side][i] = { router, port }; });
      const d = p && drivers.get(p.router);
      const portMax = d?.state ? (side === 'inputs' ? d.state.outputs : d.state.inputs) : 64;
      let now = '';
      if (p && d?.state) {
        if (side === 'inputs') { const src = d.state.routing[p.port]; now = src ? `showing ${src}. ${inLabel(d, src)}` : ''; }
        else { const dests = Object.entries(d.state.routing).filter(([, v]) => v === p.port).map(([k]) => k); now = dests.length ? `on router out ${dests.join(', ')}` : 'on no router output'; }
      }
      return el('tr', {},
        el('td', { text: side === 'inputs' ? `IN ${i + 1}${host.inputLabel(i) ? ' · ' + host.inputLabel(i) : ''}` : `OUT ${i + 1}` }),
        el('td', {}, host.enumSelect2(p?.router || '', [['', '— not patched —'], ...routers.get().map(r => [r.id, r.name])], v => setP(v, p?.port || 1))),
        el('td', {}, p ? el('input', { type: 'number', min: 1, max: portMax, value: p.port, style: 'width:70px', onchange: e => setP(p.router, Math.max(1, Math.min(portMax, +e.target.value || 1))) }) : null),
        el('td', { class: 'hint', text: now }),
        el('td', {}, p && d?.state ? (side === 'inputs'
          ? host.enumSelect2('', [['', 'Feed from…'], ...Array.from({ length: d.state.inputs }, (_, k) => [String(k + 1), `${k + 1}. ${inLabel(d, k + 1)}`])], v => { if (v) feed(i, +v); })
          : host.enumSelect2('', [['', 'Send to…'], ...Array.from({ length: d.state.outputs }, (_, k) => [String(k + 1), `${k + 1}. ${outLabel(d, k + 1)}`])], v => { if (v) send(i, +v); })) : null));
    }

    function pushPlan() {
      const from = routers.get().find(r => r.id === pushFrom), d = drivers.get(pushTo);
      if (!from || !d?.state) { note('choose a placeholder with a plan and a connected router'); return; }
      let n = 0;
      for (const [out, inp] of Object.entries(from.plan || {})) if (d.route(+out, +inp)) n++;
      note(`pushed ${n} planned crosspoint${n === 1 ? '' : 's'} from ${from.name} to ${d.name}`);
    }

    host.view('matrix', 'Matrix routing', {
      render() {
        const rs = routers.get();
        const placeholders = rs.filter(r => r.kind === 'placeholder' && Object.keys(r.plan || {}).length);
        const live = rs.filter(r => r.kind !== 'placeholder');
        return el('div', {},
          el('div', { class: 'view-head' }, el('h1', { text: 'Matrix routing' }),
            el('span', { class: 'hint', text: 'External routers, patched to the processor’s own sockets' })),
          !host.bridged() ? el('div', { class: 'panel hint', text: 'The hosted demo has no bridge, so only a placeholder router works here.' }) : null,
          rs.length ? el('div', { class: 'panel' }, el('h2', 'Patch'),
            el('div', { class: 'hint', text: 'Which router port is cabled to each processor socket. A router OUTPUT feeds a processor input; a processor output feeds a router INPUT.' }),
            el('table', { class: 'grid' },
              el('thead', el('tr', ...['Processor', 'Router', 'Port', 'Now', ''].map(t => el('th', { text: t })))),
              el('tbody', ...Array.from({ length: host.inputCount() }, (_, i) => patchRow('inputs', i)),
                ...Array.from({ length: host.outputCount() }, (_, o) => patchRow('outputs', o))))) : null,
          ...rs.map(routerPanel),
          placeholders.length && live.length ? el('div', { class: 'panel' }, el('h2', 'Push a plan'),
            el('div', { class: 'row' },
              el('label', { class: 'field' }, 'From placeholder', host.enumSelect2(pushFrom, [['', '—'], ...placeholders.map(r => [r.id, `${r.name} (${Object.keys(r.plan).length})`])], v => { pushFrom = v; host.notify(); })),
              el('label', { class: 'field' }, 'To router', host.enumSelect2(pushTo, [['', '—'], ...live.map(r => [r.id, r.name])], v => { pushTo = v; host.notify(); })),
              host.confirmBtn('mx-push', 'Push', 'Tap again — takes every planned crosspoint', pushPlan, 'btn take'))) : null,
          el('div', { class: 'panel' }, el('h2', 'Add a router'),
            el('div', { class: 'row', style: 'flex-wrap:wrap' },
              el('label', { class: 'field' }, 'Kind', host.enumSelect2(draft.kind, KINDS.map(k => [k.id, k.label]), v => { draft.kind = v; draft.port = KINDS.find(k => k.id === v).port; host.notify(); })),
              el('label', { class: 'field' }, 'Name', el('input', { type: 'text', value: draft.name, style: 'width:140px', oninput: e => { draft.name = e.target.value; } })),
              draft.kind !== 'placeholder' ? el('label', { class: 'field' }, 'Address', el('input', { type: 'text', value: draft.host, placeholder: '192.168.1.60', style: 'width:150px', oninput: e => { draft.host = e.target.value; } })) : null,
              draft.kind !== 'placeholder' ? el('label', { class: 'field' }, 'Port', el('input', { type: 'number', value: draft.port, style: 'width:80px', oninput: e => { draft.port = +e.target.value; } })) : null,
              draft.kind === 'placeholder' ? el('label', { class: 'field' }, 'Inputs', el('input', { type: 'number', min: 1, max: 288, value: draft.inputs, style: 'width:70px', oninput: e => { draft.inputs = +e.target.value; } })) : null,
              draft.kind === 'placeholder' ? el('label', { class: 'field' }, 'Outputs', el('input', { type: 'number', min: 1, max: 288, value: draft.outputs, style: 'width:70px', oninput: e => { draft.outputs = +e.target.value; } })) : null,
              el('button', { class: 'btn', onclick: addRouter }, 'Add'))),
          log.length ? el('div', { class: 'panel' }, el('h2', 'Activity'), el('div', { class: 'mono', style: 'font-size:12px;white-space:pre-line', text: log.join('\n') })) : null);
      },
    }, { section: 'Setup' });
    host.css(`.mx-grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(180px, 1fr)); gap: 8px; } .mx-grid label.field { font-size: 11px; } .mx-grid label.locked { opacity: .6; }`);
  },
};
