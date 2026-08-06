/**
 * openrcs demo — the standing banner and the limitations footer.
 *
 * Two pieces, and both are deliberate:
 *
 *  - A banner that is always on screen. A control surface that looks exactly
 *    like the real one is exactly the thing someone could mistake for live
 *    equipment, so the demo says what it is without being scrolled to.
 *  - A footer below the app spelling out what this build cannot do. The app
 *    itself is a 100vh grid, so the demo stylesheet lets the page scroll and
 *    the footer sits underneath it.
 *
 * The limitations here are the real ones, taken from what the recording
 * actually contains — not a hedge. Where the demo cannot show something, it
 * says which of the three reasons is why: the browser has no socket, the
 * recorded session had no signal, or the behaviour simply isn't modelled.
 */
(() => {
  'use strict';

  const REPO = 'https://github.com/stoatworks-labs/openrcs';

  const LIMITS = [
    [
      'There is no processor',
      `Every value you see was recorded from a real LiveCore device session, but nothing
       here is connected to anything. A browser cannot open a TCP socket, so the control
       link this app normally depends on cannot exist on a hosted page. A simulated device
       runs in the tab instead: it range-checks what you send, echoes it back, and models
       take and memory save/recall. Everything else is an echo, so a control here may
       accept a value that real hardware would refuse for reasons only it knows.`,
    ],
    [
      'There is no video, and there never is',
      `openrcs is a control surface — even driving real hardware it shows no pictures.
       The rectangles in Stage and Layers are layer geometry read back from the device,
       not thumbnails of the sources. Live source thumbnails would need the processor's
       own HTTP snapshot endpoint, which needs a processor.`,
    ],
    [
      'No input signals, no stills, no GPIO',
      `The recorded session had nothing plugged into it, so every input reads as available
       but unlocked and the signal format readouts stay blank. The still library is empty
       and GPIO reports no hardware present. Those aren't gaps in the app — they're what
       the device honestly reported with nothing connected. The controls still round-trip.`,
    ],
    [
      'This is the LiveCore side only',
      `The variable table loaded here is the LiveCore set — 1,014 variables, as read from
       a NeXtage 16. openrcs also covers the Midra series (Pulse2, Eikos2, Saphyr,
       SmartMatriX2 and siblings) with its own 562-variable table, but a build can only
       hold one at a time and this one is LiveCore.`,
    ],
    [
      'Nothing is saved and nothing is sent',
      `The whole simulation lives in the tab. No account, no upload, no persistence —
       reload the page and it returns to the recorded state.`,
    ],
  ];

  const CSS = `
.demo-banner {
  display: flex; align-items: center; gap: 12px; flex-wrap: wrap;
  height: var(--demo-banner-h);
  padding: 0 16px;
  background: #2a1f0a;
  border-bottom: 1px solid #4a3a12;
  color: #f0c469;
  font: 600 12px/1 var(--sans, system-ui, sans-serif);
}
.demo-banner__tag {
  padding: 3px 8px; border-radius: 100px;
  background: #f0a020; color: #1a1206;
  font-size: 10px; letter-spacing: .8px; text-transform: uppercase;
}
.demo-banner__text { font-weight: 500; }
.demo-banner__more {
  margin-left: auto;
  color: #f0c469; text-decoration: underline; text-underline-offset: 3px;
  background: none; border: 0; font: inherit; cursor: pointer;
}
.demo-limits {
  background: var(--panel, #151a21);
  border-top: 1px solid var(--line, #242c37);
  color: var(--text, #e6ebf2);
  padding: 32px 24px 8px;
  font-family: var(--sans, system-ui, sans-serif);
}
.demo-limits__inner { max-width: 62rem; margin: 0 auto; }
.demo-limits h2 { margin: 0 0 6px; font-size: 17px; }
.demo-limits__lede { margin: 0 0 22px; color: var(--muted, #8b96a5); font-size: 13px; max-width: 46rem; }
.demo-limits__grid { display: grid; gap: 18px; grid-template-columns: repeat(auto-fit, minmax(17rem, 1fr)); }
.demo-limits__item h3 {
  margin: 0 0 5px; font-size: 12px; font-weight: 700;
  letter-spacing: .4px; text-transform: uppercase; color: var(--armed, #f0a020);
}
.demo-limits__item p { margin: 0; font-size: 13px; line-height: 1.55; color: var(--muted, #8b96a5); }
.demo-limits__real {
  margin: 26px 0 0; padding-top: 18px;
  border-top: 1px solid var(--line, #242c37);
  font-size: 13px; color: var(--muted, #8b96a5);
}
.demo-limits__real a { color: var(--accent, #22b8cf); }
`;

  function el(tag, cls, text) {
    const n = document.createElement(tag);
    if (cls) n.className = cls;
    if (text) n.textContent = text;
    return n;
  }

  function banner(footer) {
    const b = el('div', 'demo-banner');
    b.append(el('span', 'demo-banner__tag', 'Demo'));
    b.append(el('span', 'demo-banner__text',
      'Simulated device — this is not connected to a processor.'));
    const more = el('button', 'demo-banner__more', 'What this can’t do ↓');
    more.addEventListener('click', () => footer.scrollIntoView({ behavior: 'smooth' }));
    b.append(more);
    return b;
  }

  function limits() {
    const wrap = el('section', 'demo-limits');
    const inner = el('div', 'demo-limits__inner');
    inner.append(el('h2', null, 'What this demo can and cannot show'));
    inner.append(el('p', 'demo-limits__lede',
      'This is the real openrcs control surface, unmodified, running against a device '
      + 'that only exists in your browser. The interface, the variable table and the '
      + 'state it starts in are all real. The processor is not.'));

    const grid = el('div', 'demo-limits__grid');
    for (const [title, body] of LIMITS) {
      const item = el('div', 'demo-limits__item');
      item.append(el('h3', null, title));
      item.append(el('p', null, body.replace(/\s+/g, ' ').trim()));
      grid.append(item);
    }
    inner.append(grid);

    const real = el('p', 'demo-limits__real');
    real.append(document.createTextNode('To drive real hardware you run the bridge server on the same network as the processor — it holds the one control connection and serves this same interface to any number of browsers. '));
    const a = el('a', null, 'Source, docs and the protocol reference are on GitHub');
    a.href = REPO;
    a.target = '_blank';
    a.rel = 'noopener';
    real.append(a);
    real.append(document.createTextNode('.'));
    inner.append(real);

    wrap.append(inner);
    return wrap;
  }

  function mount() {
    if (document.querySelector('.demo-limits')) return;
    const style = document.createElement('style');
    style.textContent = CSS;
    document.head.append(style);

    const footer = limits();
    document.body.prepend(banner(footer));
    // after the app, before the shared support footer
    const support = document.querySelector('.sw-support');
    if (support) support.before(footer);
    else document.body.append(footer);
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', mount);
  } else {
    mount();
  }
})();
