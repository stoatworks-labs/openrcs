# Roadmap and feature exploration

Where openrcs is, and where it could go. The second half sketches features drawn
from other professional multi-screen control systems — Barco **Event Master**,
Analog Way's own **LivePremier RCS**, and PixelHue's **Pixel Flow** — noting for
each whether the LiveCore/Midra protocol already exposes what it needs.

## Shipped

- **Show mode** — a big-target front-of-house surface: large CUT ALL / TAKE ALL,
  a TAKE tile per destination, and a master-memory grid that recalls on tap.
- **Stage** — an all-screens overview: every active screen with its layers in
  one canvas, a global TAKE ALL / CUT ALL, click-through to editing.
- **Wall** — a screen output-position map: each screen placed in the output-tile
  grid at its real position (`OSpoh`/`OSpov`), drag to arrange, apply with `OSupd`.
- **Memories** — master and screen memory grids (recall / load+take / save).
- **Cues** — a show script over the memories: an ordered cue list with GO NEXT,
  per-cue autofollow (chain to the next after a wait) with a HOLD, and notes.
- **Destinations** — screen groups as super-destinations: take/cut/T-bar/step-back
  a whole group at once, TAKE ALL GROUPS, and a grouping editor (`Plngr`/`GCupd`).
- **Keys** — programmable one-tap macros (recall + take, freeze, black, fade…).
- **Live** — preview→program take with a transition time, and master fade.
- **Layers** — a graphical arrangement canvas (drag/resize, snap presets, raise/
  lower z-order) plus a full property editor: source, opacity, position, size,
  border, crop, per-layer opening/closing transitions, and the native background.
- **Workspace** — the working page, and the one to drive a show from: drag a
  source from the palette onto a layer, program stacked over preview per screen
  with the on-air bank marked, a properties panel exposing every per-layer
  variable the device holds, per-screen take/cut/T-bar/step-back, and the full
  144-slot screen and master memory system with labels and category filters.
- **Setup** — a live **Tally** grid; Inputs; Outputs with format, HDCP and output
  processing (brightness/contrast/gamma/gain); Screens; Stills; **Capture** (grab
  a source frame — full or a graphical region — into the still library);
  **Multiviewer** (a drag/resize layout designer for the monitoring outputs, with
  layout memories); **Soft edge** (a graphical per-edge blend editor for
  multi-output screens); **EDID** (per-input preferred formats + store/factory,
  and the EDID a connected display reports); GPIO.
- **System** — identity, network, health, front-panel.
- **Shows** — capture the device's writable state to a portable JSON show file
  and restore it. Scoped: the live look (every layer's source, geometry, opacity,
  border, crop and transitions, plus the native background), the memory banks,
  input setup, or outputs & screens. Restore re-reads the device first, shows how
  many values will actually change, then writes only the differences. Shows are
  kept locally and can be downloaded and re-imported. The engine captures only
  indexed content — never a momentary SAVE/LOAD/TAKE trigger — so a restore can't
  fire an action. Also hosts **Confidence** — an instant cache-based undo: a ring
  of lightweight 'look' snapshots, auto-armed before each take, one-click revert.
- **Plan** — offline planning: stage a whole look/config with no device attached
  (reads preview your staged values), then push it to the device on connect.
- **Tools** — Inspector (every variable) and a raw-protocol Console.

## Near-term parity (already in the protocol)

Concrete device capabilities not yet given a dedicated surface:

- **Screen mapping** — place each screen at its real output position for the Stage
  canvas, and the two monitor outputs in a monitoring screen (`MONITORING_SCREEN`).
- **Confidence memories** (`CM*`) and per-screen **Confidential** (`CO*`) — the
  fullscreen/mosaic core is done; these two grids are not yet exposed.

## Open questions on hardware

- **Thumbnails for anything but inputs.** The LiveCore serves `capture_in_N` only;
  screens, outputs and previews 404 even with their snapshot slots enabled, and a
  Midra serves no HTTP at all.
- **Cut & Fill** — `PE_FLAGS_MASK_CUT_N_FILL` and `PRmcv` are known, but the rest of
  the RCS's Cut & Fill panel has no obvious mnemonics.

## Beyond the stock control software

Features the manufacturer's own control software doesn't really offer, that
openrcs is well placed to add because it already sits as a server between the
device and its clients.

### Live source thumbnails — *Event Master, LivePremier* — **shipped, v1**
The device's snapshot system (`SNAPSHOTS`: `SNena` per source, `SNlsz`
resolution) is served over its own HTTP server, and the Workspace now shows the
real picture on each input in the source palette and on the layers themselves.
Confirmed on a NeXtage 16. Two limits found on hardware: the files are named
`.bmp` but are PNGs, and **only inputs** are served — `capture_out_N` and every
other spelling 404 even with the matching snapshot slots enabled, so screens,
outputs and stills still have no thumbnail. A Midra serves no HTTP at all.

### Stage as a true canvas — *Pixelflow* — **shipped, v1 (Wall)**
The Wall view places each screen at its real output position (`OSpoh`/`OSpov`,
size `SCsih`/`SCsiv`) in the output-tile grid, draggable and committed with
`OSupd`. Next: drag a layer from one screen to another, and show soft-edge
overlaps between adjacent screens on the same canvas.

### Super destinations / screen groups — *Event Master* — **shipped, v1**
The Destinations view drives `GROUP_CONTROL`/`GROUP_STATUS`: each group of
screens (mapped via `Plngr`) is a destination with its own T-bar, take, cut and
step-back that move the whole group at once, plus TAKE ALL GROUPS and a grouping
editor that assigns screens and commits with `GCupd`. Next: recall a memory
across a whole group, and per-group transition presets.

### Cue list / show timeline — *LivePremier* — **shipped, v2**
The Cues view is an ordered list of memory recalls with GO NEXT, plus per-cue
**autofollow** (chain to the next cue after a wait) with a HOLD, and per-cue
notes. Next: hooking `SEQ_TAKE` for the device's own sequences.

### User keys / macros — *Event Master, Pixel Flow* — **shipped, v1**
The Keys view runs multi-action macros on one tap. Next: colour/label per key,
and mapping to the device's own shotbox keys where present.

### Multiviewer designer — *LivePremier, Event Master* — **shipped, v1**
The Multiviewer view is a drag/resize layout editor over `MONITORING_LAYOUT`: up
to 12 widgets per monitoring output, each with a source, OSD label and free
geometry, plus grid presets (quad / 3×3 / 4×3 / single), a fullscreen mode, apply
(`MLupd`) and 8 layout memories (`MON_MEM`). Next: per-widget borders/labels and
placing the two monitor outputs in a screen (`MONITORING_SCREEN`).

### Tally & GPIO — *Event Master*
`TALLY` and `GPIO` are exposed — surface tally state, and let GPIO triggers fire
macros or takes. **Feasible.**

### Multi-device / fleet
The server already fronts one device; fronting several turns openrcs into a
control point for a whole rack, with `COUPLING` (34 vars) for linked devices.
Aligns with the Stage/canvas idea across devices. **Feasible; an extension of the
bridge.**

### Operator ergonomics
- **Offline / plan mode** — **shipped, v1.** The Plan view stages every edit into
  a local overlay (reads preview the staged values) so a whole look or config is
  built with no device attached, then pushed on connect. Next: seed a plan from
  the device's current state, and per-scope push.
- **Confidence & undo** — **shipped, v1.** An instant cache-based ring of 'look'
  snapshots in the Shows view, auto-armed before each take, one-click revert.
  Next: snapshot other scopes, and a visible revert countdown.
- **Touch / tablet mode** — **shipped, v1 (Show mode).** A big-target FOH surface
  with TAKE ALL/CUT ALL, per-destination take tiles, and master-memory recall
  tiles. Next: per-screen tiles and a lock so it can't be left accidentally.

## A note on the inspirations

All three are multi-screen presentation switchers whose control software defines
the category — Barco's **Event Master** (destinations, presets, aux, user keys),
Analog Way's **LivePremier RCS** (scenes, multiviewer, image library), and
PixelHue's **Pixel Flow** (a layer-based canvas with a clean touch UI). openrcs
borrows the ideas that its LiveCore/Midra targets can actually execute.

Everything above is gated on hardware access for the features that touch signal
paths (capture, EDID). The enum meanings on both platforms are no longer guesses:
the LiveCore's came from its Web RCS and the Midra's from its updater firmware,
and both are documented in [PROTOCOL.md](PROTOCOL.md).
