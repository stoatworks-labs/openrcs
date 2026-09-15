# AGENTS.md — openrcs

Onboarding for LLM agents working in this repo.

## What this is

A Rust library for controlling Analog Way Midra series (Pulse2, Eikos2, Saphyr,
SmartMatriX2, QuickMatriX, QuickVu) and LiveCore series (Ascender 16/32/48,
NeXtage 8/16, SmartMatriX Ultra) video processors over their TCP control
protocol, and LivePremier (Aquilon), Midra 4K (QuickVu 4K, Pulse 4K, Eikos 4K,
QuickMatrix 4K) and Alta 4K (Zenith 100/200) processors over theirs.

**Two families, not two dialects.** Midra/LiveCore exchange terse ASCII
mnemonics addressed by index on TCP 10500; LivePremier, Midra 4K and Alta 4K
exchange JSON addressed by path on TCP 10606. They share a company name and
nothing else. Everything that differs hangs off `hub::Family`, and the two
surfaces share the shell — header, nav, Connection — but no views.

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
crates/openrcs-proto/   Midra/LiveCore engine: codec, tables, validation (no_std)
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
- **The two platforms differ.** Midra terminates commands with `\r\n`, LiveCore
  with `\n`. This is not cosmetic and is easy to regress.
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
- **Tallies have never been seen populated.** `tallies/inputs/@props/*` reads
  as four empty lists on the simulator whatever is on a layer, and the real
  unit had nothing on its layers when dumped. The Inputs view shows them; do
  not describe them as verified.
- **A view opened from a bookmark runs `enter()` before the processor has
  answered.** Reads sent then go nowhere and destinations are empty, so the
  AWJ views settle themselves on render (`settle()`) and everything the
  Screens view shows per destination is in the hub's connect-time inventory.
- **Web RCS refs go stale on every render** — the surface rebuilds its tree on
  each store notify, so a browser-driven test must re-find an element after
  any action that changes state.

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
