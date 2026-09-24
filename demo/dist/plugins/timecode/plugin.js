/*
 * Timecode — fire cues from MIDI Time Code, LTC on an audio input, or
 * timecode pushed over OSC.
 *
 * Ported from LivePremier Plus. The decoders (`timecode.js`) and the chase
 * (`chase.js`) are vendored from it unchanged; this file opens the inputs and
 * points the chase at openrcs's cue list, where a cue's Timecode field says
 * when it fires.
 *
 * - **MIDI** and **audio** are this page's own inputs — a MIDI port or a
 *   sound card on the machine the browser is on. Both need a secure context:
 *   localhost is one, a LAN address is not (serve the surface over HTTPS with
 *   the Remote access plugin to use them from another machine).
 * - **OSC** is `/openrcs/timecode "HH:MM:SS:FF"` sent to the bridge's OSC
 *   port (OSC input plugin) — a generator, QLab, a script.
 *
 * The chase fires on one page only: whichever page with a running input took
 * the `chase` lease first. Two laptops chasing the same timecode would
 * otherwise take every cue twice.
 */

import { MtcReader, LtcReader, TimecodeClock, formatTimecode } from './timecode.js';
import { TimecodeChase } from './chase.js';

const WORKLET = new URL('./ltc-worklet.js', import.meta.url).href;
const KEY = 'openrcs.timecode';
const RATES = [24, 25, 30];

const insecure = () => typeof window !== 'undefined' && !window.isSecureContext;
const advice = 'This page is not a secure context, so the browser hides MIDI and audio inputs. Open it as http://localhost on this machine, or over HTTPS (Remote access plugin).';

export default {
  id: 'timecode',
  name: 'Timecode',
  description: 'Fire cues from MIDI Time Code, LTC on an audio input, or timecode sent over OSC. Each cue’s Timecode field says when.',
  setup(host) {
    const { el } = host;
    let cfg = { kind: 'none', deviceId: '', rate: 25, armed: false };
    try { cfg = { ...cfg, ...JSON.parse(localStorage.getItem(KEY) || '{}') }; } catch { /* first run */ }
    const persist = () => { try { localStorage.setItem(KEY, JSON.stringify(cfg)); } catch { /* private mode */ } };

    const clock = new TimecodeClock({ rate: cfg.rate, staleAfterMs: 250 });
    const stack = {
      get cues() { return host.cues.list().map(c => ({ id: c.id, timecode: c.tc })); },
      fire(c) { const i = host.cues.list().findIndex(x => x.id === c.id); if (i >= 0 && lease.held()) host.cues.go(i); },
    };
    const chase = new TimecodeChase({ stack, clock, rate: cfg.rate });
    const lease = host.lease('chase');
    lease.onChange(() => host.notify());
    let error = '';
    let stopCurrent = null, poll = null;
    let inputs = [];
    let lastFired = null;
    chase.addEventListener('fired', (e) => { lastFired = { label: e.detail.cue.id, at: Date.now() }; host.notify(); });
    // A display tick, not the chase's clock: the chase fires on arrival.
    let paint = null;

    async function useMidi(deviceId) {
      if (!navigator.requestMIDIAccess) throw new Error(insecure() ? advice : 'This browser has no Web MIDI.');
      const access = await navigator.requestMIDIAccess({ sysex: false });
      const list = [...access.inputs.values()];
      const port = deviceId ? list.find(p => p.id === deviceId) : list[0];
      if (!port) throw new Error(list.length ? 'That MIDI input is not there any more' : 'No MIDI inputs found');
      const reader = new MtcReader();
      const onMessage = (ev) => { const got = reader.push(ev.data); if (got) clock.update(got.timecode, 'midi'); };
      port.addEventListener('midimessage', onMessage);
      port.open?.();
      return () => port.removeEventListener('midimessage', onMessage);
    }
    async function useAudio(deviceId) {
      if (!navigator.mediaDevices) throw new Error(insecure() ? advice : 'This browser will not open an audio input here');
      // Every bit of processing off: echo cancellation and noise suppression
      // are built to remove exactly the square-ish tone LTC is.
      const stream = await navigator.mediaDevices.getUserMedia({ audio: {
        deviceId: deviceId ? { exact: deviceId } : undefined, echoCancellation: false, noiseSuppression: false, autoGainControl: false, channelCount: 1 } });
      const ctx = new AudioContext();
      await ctx.audioWorklet.addModule(WORKLET);
      const reader = new LtcReader({ sampleRate: ctx.sampleRate });
      const node = new AudioWorkletNode(ctx, 'openrcs-ltc-tap');
      node.port.onmessage = (ev) => { for (const tc of reader.push(ev.data)) clock.update(tc, 'audio'); };
      const src = ctx.createMediaStreamSource(stream);
      src.connect(node);                    // not to the speakers — nothing is played back
      return () => { node.port.onmessage = null; try { src.disconnect(); node.disconnect(); } catch { /* gone */ } for (const t of stream.getTracks()) t.stop(); ctx.close(); };
    }
    // OSC-pushed timecode. Only the page holding the OSC actions lease hears
    // it, and only uses it while its source is set to OSC.
    host.forwarded('timecode', (args) => {
      if (cfg.kind !== 'osc') return;
      const tc = parseTc(String(args[0] ?? ''), cfg.rate);
      if (tc) clock.update(tc, 'osc');
    });

    async function use(kind, deviceId = '') {
      stop();
      cfg.kind = kind; cfg.deviceId = deviceId; persist();
      error = '';
      try {
        if (kind === 'midi') stopCurrent = await useMidi(deviceId);
        else if (kind === 'audio') stopCurrent = await useAudio(deviceId);
        else if (kind !== 'osc') { lease.want(false); host.notify(); return; }
        poll = setInterval(() => clock.poll(), 100);
        paint = setInterval(() => { if (host.view && location.hash === '#timecode') host.notify(); }, 200);
        lease.want(true);
        if (cfg.armed) chase.arm();
      } catch (err) {
        error = err.message; cfg.kind = 'none'; persist();
      }
      host.notify();
    }
    function stop() {
      if (stopCurrent) { try { stopCurrent(); } catch { /* best effort */ } stopCurrent = null; }
      clearInterval(poll); poll = null; clearInterval(paint); paint = null;
      chase.disarm(); clock.stop();
    }
    async function listInputs() {
      try {
        if (cfg.kind === 'midi' || !cfg.kind) {
          const a = navigator.requestMIDIAccess ? await navigator.requestMIDIAccess({ sysex: false }) : null;
          inputs = a ? [...a.inputs.values()].map(p => ({ id: p.id, label: p.name || p.id })) : [];
        } else if (cfg.kind === 'audio') {
          const all = navigator.mediaDevices ? await navigator.mediaDevices.enumerateDevices() : [];
          inputs = all.filter(d => d.kind === 'audioinput').map((d, i) => ({ id: d.deviceId, label: d.label || `Input ${i + 1} (allow the microphone to see its name)` }));
        } else inputs = [];
      } catch { inputs = []; }
      host.notify();
    }

    const tcText = () => clock.reading ? formatTimecode(clock.reading) : '--:--:--:--';
    host.view('timecode', 'Timecode', {
      enter() { listInputs(); },
      render() {
        const running = clock.running;
        const next = chase.enabled ? chase.next() : null;
        const timed = host.cues.list().filter(c => c.tc).length;
        return el('div', {},
          el('div', { class: 'view-head' }, el('h1', { text: 'Timecode' }),
            el('span', { class: 'hint', text: `${timed} cue${timed === 1 ? '' : 's'} carry a timecode — set it in Cues, on the ⋯ of each cue` })),
          el('div', { class: 'panel tc-panel' },
            el('div', { class: 'tc-readout' + (running ? ' on' : '') , text: tcText() }),
            el('div', { class: 'row' },
              el('span', { class: 'chip ' + (running ? 'on' : 'off') }, el('span', { class: 'dot' }), running ? `running · ${clock.source}` : cfg.kind === 'none' ? 'no input' : 'waiting for timecode'),
              el('span', { class: 'chip ' + (chase.enabled ? (lease.held() ? 'on' : 'off') : 'off') }, el('span', { class: 'dot' }),
                !chase.enabled ? 'chase off' : lease.held() ? 'chasing — this page fires' : 'chasing on another page'),
              next ? el('span', { class: 'hint', text: `next: cue ${host.cues.list().findIndex(c => c.id === next.cue.id) + 1} in ${next.inSeconds.toFixed(1)} s` } ) : null)),
          el('div', { class: 'panel' },
            el('h2', 'Input'),
            el('div', { class: 'row', style: 'flex-wrap:wrap' },
              el('div', { class: 'seg' }, ...[['none', 'None'], ['midi', 'MIDI (MTC)'], ['audio', 'Audio (LTC)'], ['osc', 'OSC']].map(([k, l]) =>
                el('button', { class: cfg.kind === k ? 'on recall' : '', onclick: () => { cfg.kind = k; use(k, '').then(listInputs); } }, l))),
              (cfg.kind === 'midi' || cfg.kind === 'audio') ? el('label', { class: 'field' }, 'Device', host.enumSelect2(cfg.deviceId, [['', 'First available'], ...inputs.map(i => [i.id, i.label])], v => use(cfg.kind, v))) : null,
              el('label', { class: 'field', title: 'LTC never says its rate, and MTC’s own rate code is used when it has one' }, 'Frame rate',
                host.enumSelect2(String(cfg.rate), RATES.map(r => [String(r), `${r} fps`]), v => { cfg.rate = +v; clock.defaultRate = +v; chase.rate = +v; persist(); host.notify(); }))),
            cfg.kind === 'osc' ? el('div', { class: 'hint pad', text: 'Send /openrcs/timecode "HH:MM:SS:FF" to the bridge’s OSC port (turn it on in OSC input). Only the page receiving OSC actions hears it.' }) : null,
            error ? el('div', { class: 'hint pad bad', text: error }) : insecure() && cfg.kind !== 'osc' ? el('div', { class: 'hint pad', text: advice }) : null),
          el('div', { class: 'panel' },
            el('h2', 'Chase'),
            el('div', { class: 'row' },
              el('label', { class: 'field inline' }, host.checkbox(cfg.armed, v => { cfg.armed = v; persist(); if (v && cfg.kind !== 'none') chase.arm(); else chase.disarm(); host.notify(); }), 'Fire cues from timecode'),
              lastFired ? el('span', { class: 'hint', text: `last fired ${Math.round((Date.now() - lastFired.at) / 1000)} s ago` }) : null),
            el('div', { class: 'hint pad', text: 'Arming catches up silently: cues whose time has already passed are not fired. A jump forward skips what it jumped over; going back re-arms. Nothing fires while the input is stale.' })));
      },
    }, { section: 'Program' });

    host.css(`
      .tc-readout { font-family: var(--mono); font-size: 44px; letter-spacing: 2px; color: var(--faint); margin-bottom: 8px; font-variant-numeric: tabular-nums; }
      .tc-readout.on { color: var(--text); }
    `);

    if (cfg.kind !== 'none') use(cfg.kind, cfg.deviceId);
  },
};

function parseTc(s, rate) {
  const m = /^(\d{1,2}):(\d{1,2}):(\d{1,2})[:;.](\d{1,2})$/.exec(s.trim());
  if (!m) return null;
  return { hours: +m[1], minutes: +m[2], seconds: +m[3], frames: +m[4], rate, dropFrame: s.includes(';') };
}
