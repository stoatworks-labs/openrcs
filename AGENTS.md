# AGENTS.md — openrcs

Onboarding for LLM agents working in this repo.

## What this is

A Rust library for controlling Analog Way Midra series (Pulse2, Eikos2, Saphyr,
SmartMatriX2, QuickMatriX, QuickVu), LiveCore series (Ascender 16/32/48,
NeXtage 8/16, SmartMatriX Ultra) and Pulse PLS300 video processors over their
TCP control protocol, and LivePremier (Aquilon), Midra 4K (QuickVu 4K, Pulse
4K, Eikos 4K, QuickMatrix 4K) and Alta 4K (Zenith 100/200) processors over
theirs.

**Two families, not two dialects.** Midra/LiveCore/PLS300 exchange terse ASCII
mnemonics addressed by index on TCP 10500; LivePremier, Midra 4K and Alta 4K
exchange JSON addressed by path on TCP 10606. They share a company name and
nothing else. Everything that differs hangs off `hub::Family`, and the
surfaces share the shell — header, nav, Connection — but no views.

**Inside the mnemonic family, three platforms.** Midra and LiveCore share one
surface, gated per view on the variables the unit advertises. The PLS300 —
the generation before Midra, with 1–2 letter case-sensitive mnemonics and no
outbound terminator — has its own eight `pls*` views over its `[preset,
layer]` grid, and keeps only the table-driven tools (Shows, Plan, Inspector,
Console) of the Midra/LiveCore set; `viewSupported` in `app.js` is where that
is decided. Its table is from the published Programmer's Guide and **no PLS300
has answered openrcs** — the surface has been driven against
`demo/fixtures-pls300.json`, which is derived from the table, not recorded.

**Inside the AWJ family, two object models.** LivePremier and Midra 4K / Alta
4K share the wire — port, framing, verbs, silent writes, subscriptions, the six
transition states — and no path: each answers `E12` to the other's spelling.
`openrcs_awj::Dialect` names the two, `paths.rs` spells LivePremier and
`mng.rs` spells the other (Midra 4K and Alta 4K are one model; the fleet calls
it `mng`). The surface asks `AWJ_DIALECTS[awjDialect()]` for every path and
names a destination `S1`/`A1` on both, so nothing above the dialect object
knows which processor it is on. "Midra" alone means the 10500 series; the 4K
boxes are always written out.

Not affiliated with Analog Way. Device and product names appear only to state
compatibility.

## Layout

```
crates/openrcs-proto/   Midra/LiveCore/PLS300 engine: codec, tables, validation (no_std)
  src/codec.rs          encode/decode; the only place the wire format lives
  src/tables.rs         GENERATED from protocol/*.json — never hand-edit
crates/openrcs-awj/     LivePremier / Midra 4K / Alta 4K engine (no_std, serde_json on alloc)
  src/codec.rs          0x04-framed JSON messages
  src/paths.rs          LivePremier path builders, from the Programmer's Guide
  src/mng.rs            Midra 4K / Alta 4K path builders, read off a Pulse 4K
crates/openrcs-server/  bridge server (tokio/axum) + web control surface
  src/hub.rs            one TCP link to the device + state cache + broadcast
  src/main.rs           HTTP/WS, the browser JSON protocol
  web/                  vanilla ES-module SPA, no build step
protocol/*.json         source of truth for the variable tables
docs/PROTOCOL.md        the wire protocol
docs/comparison.json    feature parity vs the vendor RCS, per family; edit this
docs/COMPARISON.md      GENERATED from it by scripts/gen-comparison.py
```

Only `openrcs-proto` is `no_std` and dependency-free; the server is a normal
std binary and may use crates. Keep the split.

## Hard rules

- **`src/tables.rs` is generated** from `protocol/*.json`. Edit the JSON, not
  the Rust.
- **Do not commit binaries or device firmware.** `.gitignore` covers the
  obvious cases; keep it that way.
- **Be precise about validation.** The LiveCore codec is confirmed against
  device behaviour; the Midra table is not yet exercised against a device. Do
  not overstate this.
- **The platforms differ.** Midra terminates commands with `\r\n`, LiveCore
  with `\n`, the PLS300 with nothing. This is not cosmetic and is easy to
  regress; `tests/pls300.rs` pins the guide's own spellings.
- **The PLS300 is guide-only.** Say "from the Programmer's Guide" and "not yet
  driven against a PLS300" wherever it is described; do not promote any of it
  to verified without a unit answering. The guide contradicts itself on which
  inputs are the DVI pair (11–12 on one page, 9–10 on another), which is why
  the HDCP and SDI de-embed controls go by the input's reported type.
- **The AWJ paths exist twice** — `crates/openrcs-awj/src/paths.rs` and the
  `LP` table in `web/app.js` for LivePremier, `crates/openrcs-awj/src/mng.rs`
  and the `MNG` table for Midra 4K / Alta 4K — because the browser builds the
  paths it writes. Change one, change the other: a stale path fails as an `E12`
  at runtime, not as a build error. `tests/mng.rs` pins the spellings a Pulse 4K
  answered; a change there needs a device to answer the new one.
- **LivePremier reads are hardware-verified; writes are simulator-only.** The
  inventory, screen state and preset bank have been read from an Aquilon C on
  6.2.73. Take, cut, preset recall and the subscription list have been exercised
  end to end against the **LivePremier simulator** only. Do not describe the
  write half as hardware-verified.
- **The simulator does not reproduce every device behaviour.** A preset recall
  on real hardware overwrites the screen's `takeUpTime` with the duration stored
  in the preset; on the LivePremier simulator it does not. Order-of-operations
  for anything that sequences presets cannot be settled there. (The Midra 4K
  and Alta 4K simulators *do* overwrite `takeTime` on a recall.)
- **Midra 4K / Alta 4K paths are hardware-verified; openrcs's surface for them
  is simulator-only.** Every path in `mng.rs` was answered by a Pulse 4K on
  3.3.10, and take, cut, recall and subscription were fired at it by a separate
  harness. The surface itself — the same two views, plus auxiliaries and the
  aux and master banks — has only been driven against the vendor's Midra 4K
  (3.2.29) and Alta 4K (1.3.7) simulators. Do not describe it as more.
- **An `x`-prefixed property is a trigger, not a flag** — `xTake` stays `true`
  after firing, and writing `true` again fires again. Never diff-then-skip a
  write on one.
- **Use vendor names nominatively only** — to state compatibility, never as
  branding or in a way implying endorsement.

## LivePremier protocol facts worth not regressing

- **Messages end with `0x04`, not a newline** — a label is free text and may
  contain one. The decoder splits on `0x04` alone.
- **A write is answered with nothing at all.** No ack, no echo. Confirm a write
  by reading the property back; `Hub::awj_set` does exactly that.
- **Subscriptions start empty**, so a client is told nothing about state changes
  until it writes a list. That write is what the surface's "Live updates" toggle
  does, and why it is off until asked for.
- **A container read returns `{}`.** The model cannot be enumerated from the
  device, so there is no discovering what a processor has — only asking for
  named leaves and seeing which answer. `E12` is the ordinary answer for a path
  a firmware build does not carry, and the connect-time inventory provokes it by
  design.
- **Layer parameters are addressed by preset letter**, and which letter is on
  air moves as the device is used. Every transition state names the end the
  T-bar is at or came from, so the rule is the DOWN/UP suffix — testing only for
  `AT_UP` gets the four in-flight states backwards, invisibly, for exactly the
  length of a transition.

## Midra 4K / Alta 4K facts worth not regressing

- **Screen 1 and auxiliary 1 are both keyed `1`**, in `$screen` and
  `$auxiliaryScreen`. There is no `S1` on the wire; `mng::Dest` carries the
  kind. A screen recalls from `preset/bank`, an auxiliary from
  `preset/auxBank`, and the cross combinations do not exist.
- **"In service" is not on the destination.** It is `enable` (screen) or a
  `mode` other than `DISABLE` (auxiliary) under
  `preconfig/status/$state/@items/CURRENT` — the *applied* configuration. Every
  destination answers every path whether or not it is set up; a disabled screen
  reports a 0×0 canvas.
- **The buffers are `UP` and `DOWN`**, and which is program is the transition
  suffix (`…UP` → program is `UP`). `Buffer::program` is that rule; nothing has
  to be read to learn the names. One `takeTime`, not an up/down pair.
- **There is no `status/take`.** A fade in progress shows only as one of the
  four in-flight transition states.
- **Which memory a buffer holds is on the destination**
  (`$preset/@items/UP/status/@props/memoryId`, `0` when none), not in the bank,
  and a recall lands it some tens of milliseconds after `xRequest` — a read-back
  sent immediately can see the old value, which is why the surface reads twice.
  Slot metadata is under `$slot`, not `$bank`.
- **Each model's identity path answers only on that model** —
  `system/$device/@items/1/@props/dev` on a LivePremier,
  `system/@props/dev` on the others — so the hub reads both on connect and the
  surface can say which processor is really there when the pick was wrong.
- **A master save from a buffer writes bank slots.** In `SAVE_FROM_PGM` /
  `SAVE_FROM_PRW` mode the device first stores every in-service destination's
  buffer into that destination's own bank at
  `preset/masterBank/control/save/$screen/@items/N/@props/bankSlot` (and the
  aux equivalent) — `1` for all of them out of the box, which is how a real
  Pulse 4K lost screen memory 1. The surface writes those to the master's own
  slot number first and refuses when any is occupied; `USE_EXISTING_MEMORIES`
  writes no bank slot. Never fire a master save without handling this.
- **Step Back is an edit undo here**, not LiveCore's return to the previous
  look: `xStepBack` reverts the last change to layer settings and moves nothing
  after a take (simulator, 2026-09-15). Say so wherever it is offered.
- **`xTakeMany` is unproven.** It exists, is accepted and echoed, and does
  nothing on the simulator; the vendor's own TAKE ALL writes one `xTake` per
  screen, back to back. The surface does the same.
- **The store-spelled paths.** Freeze, layer faders, inputs, plugs and tallies
  were spelled from the Pulse 4K's `/api/stores/device` dump (the same
  `xxxList/items/K` → `$xxx/@items/K`, `pp` → `@props` rule as everything else)
  and answer on both simulators; the hardware sweep never asked for them. Keep
  the "simulator-only" wording until a unit answers a `get`.
- **Snapshots come from the unit's own HTTP server**, `/api/device/snapshots/
  <kind>/<id>` with `inputs`, `outputs`, `multiviewer` and `screens/<n>/back|top`
  (the frame slots) — read off the vendor bundle's route table and answered by
  the simulator. Nothing serves a picture of a screen's program or preview.
  Port 80 on a unit; `orcs.snapshotOrigin` in localStorage overrides it for a
  simulator. Each input keeps a snapshot only while its `snapshot/enable` is
  on; the views turn it on where it is off.
- **The quick preset is a flag, not a trigger.** `quickPreset/control/@props/
  enable` true puts the mode's content (`NULL` = fade to black, `FRAME`,
  `MASTER`) on every destination its filter covers and false takes it off;
  `status/@props/isEnabled` answers at once, the per-destination `status/…/
  isEnabled` only after the fade has run.
- **A preset's background is a set, not a source.** `background/source/@props/
  set` is `NONE` (then the colour shows) or `"1"`…`"8"`, a background set the
  screen's `$backgroundSet` list describes; the top layer is one of the
  screen's four `$topFrame` slots and has a position but no size — it is drawn
  at the slot's own `sizeH`/`sizeV`.
- **Widgets are top-left, layers are centre.** A multiviewer widget's `posH`/
  `posV` is its top-left corner on the MTVW output; a live layer's is its
  centre. The object model carries 27 widget slots on an Alta 4K and 20 on a
  Midra 4K (slot 21 is E12 there); `multiviewer/status/@props/widgetValidity`
  says which are usable and is the only list to iterate.
- **An output's format lives on the node its role picks** — `format/screen`,
  `format/auxiliary` or `format/multiviewer` under `$output/@items/<key>`, the
  role being the applied preconfig's `mode` for that output (`SCREEN_FORMAT`,
  `AUX*`, `MULTIVIEWER`, `DISABLE`). Write `format`, then `xUpdate`; the status
  follows within a second. Outputs are keyed `1`…`6` and `MTVW`.
- **The screen canvas is one module, `mngCanvas`, shared by Layers and
  Show.** A context `{n, buf}` names the screen and buffer drawn; selection
  and re-rendering belong to the view, which the canvas reaches through
  `onSelect`. Do not grow a second copy of the drag / snap / layout code in a
  view.
- **Plan mode on AWJ stages by path** (`store.planPaths`, beside the mnemonic
  `planState`) and never stages a trigger — `Store.isTrigger` matches the
  `x…` property at the end of a path — because a take or a recall is an
  action, not state. `pval` prefers the staged value while plan mode is on,
  so every view previews the plan without knowing about it.
- **A list-valued property is spelled like a collection on the wire.** The
  store's `outputList` under a preconfig state is `@props/$output` in the
  device's reply, whichever way it was asked for — a `get` of
  `…/@props/outputList` answers with the path rewritten to `$output`, so the
  hub keys the value under the name you did not ask for. Ask for `$output`.
  Same rule as `xxxList/items/K` → `$xxx/@items/K`, one level lower.
- **Unproven on the simulators (written, never acted on):** timer `xStart`
  (state stays `IDLE`), still `capture/cmd/@props/xRequest` (status stays
  `NO_REQUEST`), the tally lists, `streaming/control/@props/start` (status
  stays `NO_REQUEST`), `customFormats/$bank/@items/N/control/@props/xDelete`
  (the slot stays valid), and a grid `xUpdate` (the canvas size does not
  follow). Keep those words in the docs.
- **The preconfig `xApply` rebuilds the pipeline.** Every output goes dark
  for seconds and layers reset; the surface arms it behind a second tap and
  re-reads everything three seconds later. Never fire it in a test that other
  views depend on without re-checking the applied state afterwards.
- **A backup's `xRequest` is a list of modules, not a flag** — the same for
  the restore's apply step; only the extract step is a boolean. The slot's own
  `control/@props/label` is what names it; the export command's `label` did
  not reach the slot on the simulator.
- **Tallies have never been seen populated.** `tallies/inputs/@props/*` reads
  as four empty lists on the simulator whatever is on a layer, and the real
  unit had nothing on its layers when dumped. The Inputs view shows them; do
  not describe them as verified.
- **A view opened from a bookmark runs `enter()` before the processor has
  answered.** Reads sent then go nowhere and destinations are empty, so the
  AWJ views settle themselves on render (`settle()`) and everything the
  Screens view shows per destination is in the hub's connect-time inventory.
- **A render patches the live tree; it does not rebuild it.** Every store
  notify builds the whole surface and `morphChildren` patches the document to
  match — attributes, handler properties, form state, children — so scroll,
  focus, caret, a picture on screen and an open `<details>` survive a device
  frame. The rules that keep that true: `el()` wires events as handler
  properties (`n.onclick = fn`), never `addEventListener` on an element a view
  builds; a handler must not close over an element built in the same render —
  it reads `e.currentTarget` (the live one) instead; anything sized from
  layout goes in the view's `afterRender()` (Workspace's `fitCanvases`), never
  in a `requestAnimationFrame`; and an element that must never be patched into
  a different one carries a `key` (the selection chrome, every layer box, the
  view root). A browser-driven test should still re-find an element after an
  action: a node whose kind or key changed is replaced.

## Midra (10500) and LiveCore facts worth not regressing

- **Keep the Midra's preset-update mode OFF.** `CTpmu`=1 makes `GCtak` inert
  (accepted, latched at 1, nothing moves, `GCtav` pinned at 0); with it off,
  preview (ctx 1) edits stick and the take lands. Measured on a Pulse2
  2026-09-16. `midraEditMode()` is the one place it is written; a Midra take
  pulses `GCtak` 0 then 1; a Midra cut runs the T-bar through the middle to
  the far end (one write of the far end is ignored).
- **`MAmfa`/`MAnfa`/`MAsfa` are FADE_AUTO: 1 = fade IN (up), 2 = fade OUT (to
  black).** `MAnas`/`MAsas` are ALPHA_STATUS (0 at max, 1 at min, 3/4 in
  transition). Both verified on a NeXtage 16; the constants are `FADE_IN`,
  `FADE_OUT`, `ALPHA_STATUS`.
- **`TAopr`/`TAopw` are indexed by source number** (the `PRinp` space), not
  by input. Entry 0 is "no source".
- **`OS*` (OUTPUT_SCREEN) is indexed by output.** `OSsou[o]` names the screen
  output o carries; never read `OSpoh[s]` as a screen's position.
- **The multiviewer and still-capture source lists start at input 1, not at
  "none"** (`MLces`/`MLfes` 0..55, `STcso` 0..31); the names are the device's
  own enumerations, spelled in `monName`/`capName`.
- **A capability probe compares `store.errCount`**, never a slice of
  `store.log` — the log is a ring.
- **The bridge drops a silent link after 20 s** and the browser re-runs
  `onReady()` when it returns. Do not add a "quiet" code path that stops the
  probe.

## Protocol facts worth not regressing

- The reply format mirrors the command: commands end with the mnemonic, replies
  start with it, and a reply's last comma-separated field is the value.
- The device replies in CRLF even on LiveCore (which sends bare LF outbound),
  pushes unsolicited frames (e.g. `ITcct` on connect), and NAKs bad commands
  with `E<code>` (`E10` unknown, `E12` wrong index count). These are pinned in
  `tests/conformance.rs` — don't break them.
- `max` reaches 4294967295 and `dims` reach 1048577, so those fields are `i64`
  and `u32`, not `i32`/`u16`.
- Partial reply lines must be buffered across reads (the `Decoder` does this).

## The surface's own invariants

- **A canvas draws the layers in the device's order, whatever is selected.**
  The selection's outline and handles are `selectionChrome()`, an element of
  its own above them all. Do not lift the selected `.lrect` with a z-index
  again: a selected full-screen layer then takes every press meant for the
  layers beneath it, and nothing but the selection can be dragged.
- **Layer geometry has exactly two write points** — `setGeom`/`setGeomNow` in the
  Layers view and in Workspace. The working-area clamp lives there so that every
  path is covered by construction, including typed values and memory recalls that
  never touch a canvas. A third write point would silently escape the region.
- **The working area and the layer bank are client-side.** Nothing is written to a
  processor to establish either. Both persist to `localStorage` and travel in a show
  file; neither has a device variable behind it, and neither should grow one.
- **Enum tables in the UI are recovered, not guessed.** `VIDEO_OUT_MODES`,
  `VIDEO_OUT_SOURCES`, `VIDEO_OUT_FORMATS`, `TEST_PATTERNS` and `MEM_FILTERS` each
  came from a device's own string table and were confirmed against hardware by count
  or by refusal. `OUfor` is deliberately still rendered as "Format N" because it has
  not been solved — do not fill it in from a plausible slice of the format table.
- **Draw the device's readback, not the staged value**, wherever the two can differ.
  The LiveCore output area of interest does differ, and the panel says so rather
  than showing the operator their own numbers back.
- **A layer leaf set is derived from the variable table**, not listed. `layerLeaves()`
  filters the preset group by dimensionality, which is what makes the layer bank come
  out at 40 leaves on a LiveCore and 27 on a Midra with no second table to maintain.
  `PRlay` is excluded on purpose: it is the RCS's edit selection, not layer state.

## Verifying

```bash
cargo test
cargo clippy --all-targets        # must be clean
cargo build --no-default-features # no_std must keep building
```

`no_std` is not decoration — a future gateway target may be embedded. Do not
reach for `std` in `openrcs-proto`.

## Notes

`docs/NOTES.md` carries this repo's working notes — current status, decisions
already made, and the traps that have actually bitten. Read it before changing
anything non-obvious. Cross-cutting fleet knowledge lives in
[fleet-notes](https://github.com/stoatworks-labs/fleet-notes).
