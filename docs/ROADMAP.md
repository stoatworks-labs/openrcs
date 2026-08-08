# Roadmap and feature exploration

Where openrcs is, and where it could go. The second half sketches features drawn
from other professional multi-screen control systems — Barco **Event Master**,
Analog Way's own **LivePremier RCS**, and PixelHue's **Pixel Flow** — noting for
each whether the LiveCore/Midra protocol already exposes what it needs.

## Shipped

- **Stage** — an all-screens overview: every active screen with its layers in
  one canvas, a global TAKE ALL / CUT ALL, click-through to editing.
- **Memories** — master and screen memory grids (recall / load+take / save).
- **Cues** — a show script over the memories: an ordered cue list with GO NEXT.
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
- **Tools** — Inspector (every variable) and a raw-protocol Console.

## Near-term parity (already in the protocol)

Concrete device capabilities not yet given a dedicated surface:

- **Screen mapping** — place each screen at its real output position for the Stage
  canvas, and the two monitor outputs in a monitoring screen (`MONITORING_SCREEN`).
- **Confidence memories** (`CM*`) and per-screen **Confidential** (`CO*`) — the
  fullscreen/mosaic core is done; these two grids are not yet exposed.
- **Cut & fill** — `PE_FLAGS_MASK_CUT_N_FILL` and `PRmcv` (mask curve) are known,
  but the rest of the RCS's Cut & Fill panel has no obvious mnemonics yet.

## Open questions on hardware

- **Midra layer allocation.** On a Pulse2 only layer slot 0 accepted a `PRinp`
  write; the others are silently dropped, with no `E` code. Whatever the RCS2
  does to open a Midra layer is not yet known, so the Workspace reads back after
  every Midra source write and says so when the device refuses. Capturing RCS2's
  own traffic against a device is the way to settle it.
- **Midra source numbering** above the frame's input count. A Pulse2 with eight
  inputs was found with a layer on source 9, so 9–11 are frame/logo/colour in
  some order. openrcs shows them as "Source n" rather than guess.

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

### Stage as a true canvas — *Pixelflow*
The Stage view is the first step toward a pixel-space model: one canvas, every
screen as a viewport, content arranged across the whole thing rather than
per-screen. Next steps — place screens at their real output positions
(`OSCREEN_OUT_POS`), drag a layer from one screen to another, and show soft-edge
overlaps between adjacent screens. **Feasible on current data.**

### Super destinations / screen groups — *Event Master*
`GROUP_CONTROL` / `GROUP_STATUS` expose screen groups: take, cut and recall
across several screens as one destination. A "destinations" bar that takes a
whole group at once. **Feasible.**

### Cue list / show timeline — *LivePremier* — **shipped, v1**
The Cues view is the first cut: an ordered list of memory recalls with GO NEXT.
Next: autofollow/hold timing, per-cue notes, and hooking `SEQ_TAKE` for the
device's own sequences.

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
- **Touch / tablet mode** — larger targets, a simplified "show" layout for a
  panel at front-of-house.
- **Offline / plan mode** — build memories and layer arrangements against the
  variable model with no device attached, then push on connect.
- **Confidence & undo** — snapshot-and-restore around risky actions, using the
  device's own state as the source of truth.

## A note on the inspirations

All three are multi-screen presentation switchers whose control software defines
the category — Barco's **Event Master** (destinations, presets, aux, user keys),
Analog Way's **LivePremier RCS** (scenes, multiviewer, image library), and
PixelHue's **Pixel Flow** (a layer-based canvas with a clean touch UI). openrcs
borrows the ideas that its LiveCore/Midra targets can actually execute.

Everything above is gated on hardware access for the features that touch signal
paths (capture, EDID). The LiveCore enum meanings are no longer a guess — they
were recovered from the device's own Web RCS and are documented in
[PROTOCOL.md](PROTOCOL.md); the Midra table still has the gaps listed above.
