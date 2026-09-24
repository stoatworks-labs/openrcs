# Plugins

Everything the surface does past its core views is a plugin: one folder under
`crates/openrcs-server/web/plugins/<id>/`, switchable on the **Plugins** page
(Tools → Plugins). The pattern, and most of the plugins, come from
[LivePremier Plus](https://github.com/stoatworks-labs/livepremier-plus), ported
to the LiveCore and Midra object model.

A plugin that is off does nothing: no view, no hook, no connection. Switching
one reloads the page — a plugin wires itself into the core, and unwiring it in
place is a class of bug not worth having.

## What ships

| Plugin | What it does | LiveCore | Midra |
|---|---|---|---|
| **Field arithmetic** | Type `1080-80` in any numeric field and get 1000. + − × ÷ and brackets; Up/Down still step. | ✓ | ✓ |
| **Layer names** | Name a layer; the name shows wherever a layer is drawn. Neither platform stores one, so the names are the show's, kept by the bridge. | ✓ | ✓ |
| **Layer groups** | Layers across screens driven as one: a *gang* that follows an edit to any member (position and size by the same difference), and *Send to* — one source onto every member. | ✓ | ✓ |
| **Layer lock** | Lock a layer so a take leaves it as it is, or take one layer (or one group) alone. | ✓ | ✓ |
| **Command line** | `Take Screen 1`, `Recall Master 5`, `Sel Sc 1 La 1 Thru 3`, `Source 4`, `Width 1920/2` — short forms, arithmetic, `!` for a raw line. | ✓ | ✓ |
| **Timecode** | Fire cues from MIDI Time Code, LTC on an audio input, or timecode sent over OSC. | ✓ | ✓ |
| **MIDI mapping** | A MIDI controller firing any action; a fader riding a T-bar. Learn by moving the control. | ✓ | ✓ |
| **Speed Editor** | A DaVinci Resolve Speed Editor over WebHID: CAM keys, the wheel on opacity, position, size, T-bar. | ✓ | ✓ |
| **EDID builder** | The Otter EDID editor, saving straight onto an input plug (256 bytes). | ✓ | ✓ |
| **OSC input** | QLab, TouchOSC or a desk driving the processor over UDP. | ✓ | ✓ |
| **HyperDecks** | Play, cue and record HyperDecks (and Mitti), with rules: play when on air, take or cut when the clip ends. | ✓ | ✓ |
| **Matrix routing** | Patch the processor to a Videohub, Lightware or Turtle AV router; feed an input, send an output; plan on a placeholder. | ✓ | ✓ |
| **Companion** | Press Bitfocus Companion buttons from a key, a cue, MIDI, OSC or a memory recall; its tablet page here. | ✓ | ✓ |
| **Thumbnail relay** | Input thumbnails fetched once by the bridge for every page, as JPEG. | ✓ | — a Midra serves no pictures |
| **Remote access** | The surface over Tailscale (HTTPS or the tailnet address) or ZeroTier. | ✓ | ✓ |
| **Setup file** | Cue list, keys and every plugin's data as one JSON file, and back. | ✓ | ✓ |

The PLS300 and the AWJ family (LivePremier, Midra 4K, Alta 4K) get none of
these yet: every plugin here is written against the mnemonic variable table.

### Not ported from LivePremier Plus, and why

- **VPU map** — it draws the LivePremier's own processing units, which neither
  family has.
- **Pitch compensation** — it writes a per-output pitch ratio that exists only
  on the LivePremier and the 4K models.
- **Mosaic inputs** — neither family can join two inputs into one source, and
  a tiled-display EDID is 384 bytes where an input here holds 256.
- **Pixelhue panel** — never yet run against a real console even in
  LivePremier Plus; it waits until it has been.

## Proven how far

Honestly: **none of this has met a processor yet.** Everything was driven
against the demo's recorded NeXtage 16 session (`demo/fixtures.json`, with the
demo device taught the LiveCore bank take), a table-derived Midra fixture, and
— for the bridge half — a real `openrcs-server` talking to throwaway fakes: a
LiveCore answering from the recorded fixture, a two-clip HyperDeck and a 4×4
Videohub. What that proved, end to end through the real bridge:

- shared data reaching a second page and surviving a restart;
- a lease passing to the next page when its holder closes;
- OSC `/set` written by the bridge (with its `GCupd`), `/source` and `/take`
  forwarded to a page and executed there;
- a HyperDeck rule playing a deck as its source went on air and cutting the
  screen when the clip ended;
- a Videohub crosspoint taken through the patch and reported back;
- a cue fired by timecode sent over OSC.

Not exercised at all: a real Companion, a real Speed Editor, MIDI and LTC
input (the Browser pane grants neither), the thumbnail relay against a real
LiveCore's web server, and Tailscale serve / ZeroTier on a real host. Prove
each on your own kit before a show — the take gate in Layer lock in particular.

## Writing one

A plugin is an ES module whose default export is a manifest:

```js
export default {
  id: 'my-plugin',                 // the folder name
  name: 'My plugin',
  description: 'One sentence for the Plugins page.',
  requires: (host) => host.isLiveCore() || 'only a LiveCore has this',  // optional
  setup(host) { … },
};
```

and its folder is added to `PLUGIN_INDEX` in `app.js`. `setup` runs once, and
reaches the core only through `host` — which is the plugin API; anything else
in `app.js` may change without notice. `requires` decides whether the plugin's
views appear on the connected processor; its hooks are wired either way, so a
hook must check the platform itself when it matters.

### The host

- **Views.** `host.view(id, label, { render, enter?, afterRender? }, { section })`
  adds a page to the menu under `Program`, `Setup`, `Tools` or a section of its
  own. A view renders with `host.el` and follows the core's render rules
  (AGENTS.md: handlers as properties, `key` on anything that must not be
  patched into something else). `host.popoutButton(id)` offers a window of its
  own; `host.css(text)` adds a stylesheet.
- **The device.** `host.store` (read with `val`, write with `set`),
  `liveCtx`/`editCtx`, `doTake`/`doCut`, `recallMemory`, `layerLeaves`,
  `layerRect`/`placeLayer` (the one way to move a layer: it honours the
  screen's working area), `presetEditMode`, labels and counts.
- **Actions.** `host.actions.define(id, { label, fields, desc, run, when })`
  adds a verb that Keys, Cues, the command line, MIDI and OSC can all fire.
  `host.actions.form(draft, onAdd)` is the editor for one.
- **Hooks.** `host.on(name, fn)`:
  - `beforeTake({screens, cut})` — just before a take or cut this surface
    sends. Return how many preset writes you made; the take then waits for
    them (a LiveCore holds them until `GCupd`).
  - `afterSet(m, idx, v, prev)` — after an operator's write. **Not** called for
    bulk writes (a recalled memory, a restored show, a lock's hold): those run
    inside `host.quietly(fn)`, and so should yours.
  - `layerLabel(s, l)`, `snapshotUrl(n, tick)`, `midraRecall({slot, take})`.
- **Shared data.** `host.shared(key, init)` → `{ get, set, update, watch }`,
  stored by the bridge in `plugin-data.json` beside its config and handed to
  every open page. In the hosted demo, this browser's localStorage.
- **Leases.** `host.lease(name)` → `{ want, held, onChange }`. The bridge grants
  a lease to one page at a time and hands it on when that page closes. Use one
  for anything that must happen once however many pages are open.
- **Links.** `host.link(kind, host, port)` → `{ open, send, close, onData,
  onStatus }`: a TCP connection the bridge holds for this page (a browser has
  no raw TCP). One per page, deliberately — these protocols pair each reply
  with the command before it.
- **Forwarded actions.** `host.forwarded(name, fn)` — what the bridge hands this
  page from OSC: an exact address (`timecode`), a prefix (`hyperdeck/*`), or `*`.
  Only the page holding the `osc-input.actions` lease receives them.
- **Other plugins.** `host.provide(name, api)` and `host.use(name)` — Layer lock
  uses `groups` from Layer groups. Plugins set up in `PLUGIN_INDEX` order.

## OSC

The bridge listens (off until OSC input turns it on; loopback unless *Accept
from the network* is ticked). Numbers are as an operator counts: screen 1,
memory 1.

| Address | Runs | What |
|---|---|---|
| `/openrcs/set/<MNEM> <idx…> <value>` | bridge | Write any variable. Indices from 0. |
| `/openrcs/raw "<line>"` | bridge | A raw protocol line. |
| `/openrcs/take [screen] [seconds]` | page | Take one screen, or all. |
| `/openrcs/cut [screen]` | page | Cut. |
| `/openrcs/master <slot> [take]` | page | Recall a master memory (a Midra preset). |
| `/openrcs/screen <screen> <slot> [take]` | page | Recall a screen memory (LiveCore). |
| `/openrcs/tbar <screen> <0–1>` | page | Move a T-bar. |
| `/openrcs/source <screen> <layer> <input> [program]` | page | Put an input on a layer. |
| `/openrcs/fade <screen> <0\|1>` · `/freeze <input> <0\|1>` · `/black <output> <0\|1>` | page | |
| `/openrcs/cue/go` · `/cue/<n>` · `/cue/hold` · `/cue/back` · `/key/<n>` | page | Cues and keys. |
| `/openrcs/timecode "HH:MM:SS:FF"` | page | Feeds Timecode when its input is OSC. |
| `/openrcs/hyperdeck/<deck>/<command> [arg]` | page | `play`, `stop`, `record`, `clip N`, `next`, `prev`, `rewind`, `end`, `preview`. |
| `/openrcs/matrix/feed <input> <source>` · `/matrix/send <output> <dest>` | page | Matrix routing. |
| `/openrcs/companion/<page>/<row>/<col>` | page | Press a Companion button. |

"Page" means the verb runs on an open openrcs page, through the same code the
buttons use; with no page open the bridge drops it and says so on the OSC
page. That is a choice, not an omission: a take carries hardware-proven
details (a Midra's T-bar must be seen to travel, a LiveCore holds edits until
`GCupd`) and a second copy of it in the bridge would drift from the first.
