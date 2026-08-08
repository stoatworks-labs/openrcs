/**
 * openrcs demo — a simulated processor that runs entirely in the page.
 *
 * The hosted demo has no processor to talk to: a browser cannot open a TCP
 * socket, so the control link the real app depends on cannot exist here. This
 * stands in for it, presenting the same surface `Store.connect()` expects from
 * a WebSocket — `readyState`, `send()`, `onmessage`, `onclose` — so the whole
 * control surface runs unmodified above it.
 *
 * Where the state comes from
 * --------------------------
 * `fixtures.json` is a RECORDING, not a hand-written guess: the variable table
 * and every value in it were captured from openrcs-server connected to a real
 * LiveCore device session, after driving it into a show-like state and visiting
 * every view so each one's own requests populated the cache. Hand-authoring
 * 3,745 values would be a guess about what the device does, and guesses drift
 * away from the protocol without anything failing loudly.
 *
 * What this models, and what it doesn't
 * -------------------------------------
 * A processor is, from the control surface's point of view, mostly a large
 * key-value store that echoes what you write to it. So the default behaviour
 * here is exactly that: a set is range-checked and echoed back. On top of that
 * sit the handful of behaviours where the device does something rather than
 * just remember something — take, and memory save/recall/load — because
 * without those the interesting half of the UI would look inert.
 *
 * Everything else is honest echo. Nothing here invents device behaviour that
 * was not observed: where the real device would do something this cannot know
 * about (video actually moving, a signal appearing on an input), it does
 * nothing rather than fake a plausible result.
 */
(() => {
  'use strict';

  // The two identify specials answer under a different mnemonic than the one
  // you send — recovered protocol behaviour, and the only place in the table
  // where command and answer diverge.
  const ANSWER = { '?': 'DEV', '!': 'PDEV' };

  // A scan of a large array is capped the same way the bridge server caps it,
  // so a demo visitor can't wedge the tab by reading a 24-deep variable.
  const SCAN_CAP = 8192;

  const keyOf = (m, idx) => m + '|' + idx.join(',');

  class DemoDevice {
    constructor(fixturesUrl) {
      this.readyState = 0;          // CONNECTING
      this.onmessage = null;
      this.onclose = null;
      this.onerror = null;
      this.state = new Map();       // "MNEM|i,i" -> value
      this.defs = new Map();        // mnemonic -> def
      this.meta = null;
      this.memories = new Map();    // "master|n" / "screen|s,n" -> captured vars
      this.sel = { psmet: 0, pmmet: 0, pmscf: 0 };
      this._pending = [];           // sends that arrived before the fixture did
      this._boot(fixturesUrl);
    }

    async _boot(url) {
      const fx = await fetch(url).then((r) => {
        if (!r.ok) throw new Error(`fixtures ${r.status}`);
        return r.json();
      });
      this.meta = fx.meta;
      for (const v of fx.meta.vars) this.defs.set(v.m, v);
      for (const [m, i, v] of fx.items) this.state.set(keyOf(m, i), v);

      // Ready before the first frame goes out, so anything the app sends from
      // its meta handler is served rather than dropped.
      this.readyState = 1;
      this._emit({ t: 'meta', platform: fx.meta.platform, port: fx.meta.port, vars: fx.meta.vars });
      this._emit({ t: 'status', connected: true });
      this._emit({
        t: 'snap',
        items: [...this.state].map(([k, v]) => {
          const [m, i] = k.split('|');
          return [m, i === '' ? [] : i.split(',').map(Number), v];
        }),
      });
      for (const raw of this._pending.splice(0)) this.send(raw);
    }

    // Frames are delivered asynchronously, as a real socket would: `send()` is
    // called from inside the app's own event handling, and re-entering it
    // synchronously would let a set's echo land mid-render.
    _emit(msg) {
      queueMicrotask(() => this.onmessage && this.onmessage({ data: JSON.stringify(msg) }));
    }

    _val(m, idx) {
      const hit = this.state.get(keyOf(m, idx));
      if (hit !== undefined) return hit;
      const def = this.defs.get(m);
      // Never invent a value: fall back to the bottom of the variable's own
      // declared range, which is what an unreported variable reads as.
      return def ? def.min : 0;
    }

    _put(m, idx, v, emit = true) {
      this.state.set(keyOf(m, idx), v);
      if (emit) this._emit({ t: 'val', m, i: idx, v });
    }

    send(raw) {
      if (this.readyState !== 1) { this._pending.push(raw); return; }
      let msg;
      try { msg = JSON.parse(raw); } catch { return; }
      switch (msg.t) {
        case 'get':  return this._get(msg.m, msg.i || []);
        case 'set':  return this._set(msg.m, msg.i || [], msg.v);
        case 'scan': return this._scan(msg.m);
        case 'raw':  return this._raw(msg.d);
      }
    }

    _get(m, idx) {
      const answer = ANSWER[m] || m;
      const def = this.defs.get(m);
      if (!def) return this._emit({ t: 'err', code: 10 });          // unknown command
      if (idx.length !== def.dims.length) return this._emit({ t: 'err', code: 12 });
      this._emit({ t: 'val', m: answer, i: idx, v: this._val(answer, idx) });
    }

    _set(m, idx, v) {
      const def = this.defs.get(m);
      if (!def) return this._emit({ t: 'err', code: 10 });
      if (idx.length !== def.dims.length) return this._emit({ t: 'err', code: 12 });
      // The bridge server validates locally and drops an out-of-range set
      // without telling the browser; match that rather than inventing a code
      // the device never sends.
      if (def.ro) return;
      if (v < def.min || v > def.max) return;
      for (let a = 0; a < idx.length; a++) if (idx[a] < 0 || idx[a] >= def.dims[a]) return;

      this._put(m, idx, v);
      this._act(m, idx, v);
    }

    _scan(m) {
      const def = this.defs.get(m);
      if (!def) return this._emit({ t: 'err', code: 10 });
      const total = def.dims.reduce((a, b) => a * b, 1);
      if (total > SCAN_CAP) return;
      const answer = ANSWER[m] || m;
      const idx = new Array(def.dims.length).fill(0);
      for (let n = 0; n < total; n++) {
        this._emit({ t: 'val', m: answer, i: [...idx], v: this._val(answer, idx) });
        for (let a = def.dims.length - 1; a >= 0; a--) {
          if (++idx[a] < def.dims[a]) break;
          idx[a] = 0;
        }
      }
    }

    // The raw console speaks the wire format directly. Parse just enough to
    // route it through the same path as a structured set/get.
    _raw(line) {
      const text = String(line).trim();
      if (!text) return;
      const split = text.search(/[0-9,\-]/);
      if (split <= 0) return this._emit({ t: 'err', code: 10 });
      const mnem = text.slice(split).replace(/[0-9,\-\s]/g, '') || text.slice(0, split);
      const nums = text.slice(0, split).split(',').filter(Boolean).map(Number);
      const def = this.defs.get(mnem);
      if (!def) return this._emit({ t: 'err', code: 10 });
      if (nums.length === def.dims.length + 1) this._set(mnem, nums.slice(0, -1), nums[nums.length - 1]);
      else this._get(mnem, nums);
    }

    // ---- the behaviours that are more than an echo ----

    _act(m, idx, v) {
      // Slot selectors: remembered, then acted on by the save/load triggers.
      if (m === 'PSmet') { this.sel.psmet = v; return; }
      if (m === 'PMmet') { this.sel.pmmet = v; return; }
      if (m === 'PMscf') { this.sel.pmscf = v; return; }

      if (m === 'GCtku' && v === 1) return this._take(idx[0]);

      if (m === 'PSsav' && v >= 1) return this._saveMaster(this.sel.psmet);
      if (m === 'PSloa' && v === 1) return this._loadMaster(this.sel.psmet, false);
      if (m === 'PSlot' && v === 1) return this._loadMaster(this.sel.psmet, true);

      if (m === 'PMsav' && v === 1) return this._saveScreen(this.sel.pmscf, this.sel.pmmet);
      if (m === 'PMloa' && v === 1) return this._loadScreen(this.sel.pmscf, this.sel.pmmet, false);
      if (m === 'PMlot' && v === 1) return this._loadScreen(this.sel.pmscf, this.sel.pmmet, true);

      if (m === 'SLera' && v === 1) return this._put('Slval', idx, 0);

      // A still capture on real hardware writes a file and reports done; with
      // no video path here the only honest thing is to report it finished.
      if (m === 'STcen' && v === 1) return this._put('STcdo', [], 1);
    }

    /** Every per-layer and per-background variable, taken from the table
     *  rather than a hardcoded list, so a newly added one is covered too. */
    _layerVars() {
      if (this._lv) return this._lv;
      const layer = [], bg = [];
      for (const [m, d] of this.defs) {
        if (d.ro) continue;
        if (d.dims.length === 3 && d.dims[0] === 8 && d.dims[1] === 3 && d.dims[2] === 24) layer.push(m);
        else if (d.dims.length === 2 && d.dims[0] === 8 && d.dims[1] === 3) bg.push(m);
      }
      return (this._lv = { layer, bg });
    }

    /** Take: preview (context 1) becomes program (context 0) for one screen. */
    _take(screen) {
      const { layer, bg } = this._layerVars();
      const maxLayers = this._val('SCmly', [screen]) || 0;
      for (const m of layer) {
        for (let l = 0; l < maxLayers; l++) {
          this._put(m, [screen, 0, l], this._val(m, [screen, 1, l]));
        }
      }
      for (const m of bg) this._put(m, [screen, 0], this._val(m, [screen, 1]));
      // the trigger is momentary — it falls back on its own
      this._put('GCtku', [screen], 0);
    }

    _capture(screens, ctx) {
      const { layer, bg } = this._layerVars();
      const shot = [];
      for (const s of screens) {
        const maxLayers = this._val('SCmly', [s]) || 0;
        for (const m of layer) {
          for (let l = 0; l < maxLayers; l++) shot.push([m, [s, ctx, l], this._val(m, [s, ctx, l])]);
        }
        for (const m of bg) shot.push([m, [s, ctx], this._val(m, [s, ctx])]);
      }
      return shot;
    }

    _restore(shot, toCtx) {
      for (const [m, idx, v] of shot) {
        const next = [...idx];
        next[1] = toCtx;
        this._put(m, next, v);
      }
    }

    _activeScreens() {
      const out = [];
      for (let s = 0; s < 8; s++) if ((this._val('SCssh', [s]) || 0) > 0) out.push(s);
      return out;
    }

    _saveMaster(slot) {
      this.memories.set('master|' + slot, this._capture(this._activeScreens(), 0));
      this._put('PSval', [slot], 1);
    }

    _loadMaster(slot, andTake) {
      const shot = this.memories.get('master|' + slot);
      if (!shot) return;
      this._restore(shot, 1);                       // memories recall to preview
      if (andTake) for (const s of this._activeScreens()) this._take(s);
    }

    _saveScreen(screen, slot) {
      this.memories.set('screen|' + slot, this._capture([screen], 0));
      this._put('PMscw', [slot], this._val('SCssh', [screen]));
      this._put('PMmly', [slot], this._val('SCmly', [screen]));
    }

    _loadScreen(screen, slot, andTake) {
      const shot = this.memories.get('screen|' + slot);
      if (!shot) return;
      // A screen memory is portable: it restores onto whichever screen is
      // selected now, not the one it was captured from.
      this._restore(shot.map(([m, idx, v]) => [m, [screen, ...idx.slice(1)], v]), 1);
      if (andTake) this._take(screen);
    }

    close() {
      this.readyState = 3;
      if (this.onclose) this.onclose();
    }
  }

  // The seam app.js looks for. Returning a factory (rather than an instance)
  // keeps the app's reconnect path working: it just builds another one.
  // `?device=<name>` selects an alternative fixture (fixtures-<name>.json),
  // e.g. ?device=almost-least-weasel; the name is constrained to a filename.
  const pick = new URLSearchParams(location.search).get('device');
  const url = pick && /^[a-z0-9-]{1,64}$/.test(pick)
    ? `./fixtures-${pick}.json`
    : (document.currentScript && document.currentScript.dataset.fixtures) || './fixtures.json';
  globalThis.OPENRCS_DEMO_DEVICE = () => new DemoDevice(url);
})();
