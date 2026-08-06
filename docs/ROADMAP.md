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
- **Setup** — a live **Tally** grid; Inputs; Outputs with format, HDCP and output
  processing (brightness/contrast/gamma/gain); Screens; Stills; **Capture** (grab
  a source frame — full or a graphical region — into the still library);
  **Multiviewer** (a drag/resize layout designer for the monitoring outputs, with
  layout memories); GPIO.
- **System** — identity, network, health, front-panel.
- **Tools** — Inspector (every variable) and a raw-protocol Console.

## Near-term parity (already in the protocol)

Concrete device capabilities not yet given a dedicated surface:

- **EDID** management (`EDID_IN`, `EDID_OUT`, `EDID_LIB`) — the last big Setup gap.
- **Soft edge** (`SOFTEDGE`) and **screen mapping** for blended/multi-output
  screens.

## Beyond the stock control software

Features the manufacturer's own control software doesn't really offer, that
openrcs is well placed to add because it already sits as a server between the
device and its clients.

### Live source thumbnails — *Event Master, LivePremier*
The device has a snapshot system (`SNAPSHOTS`: `SNena` per source, `SNlsz`
resolution) and serves the images over HTTP. The bridge server can fetch and
proxy them, so source pickers, the layer canvas, and the Stage view show the
*actual picture* on each input and layer — the single biggest jump in
day-to-day usability. **Feasible; needs the device's HTTP thumbnail endpoint
confirmed on hardware.**

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
paths (thumbnails, capture, EDID) and on confirming the enum meanings the
Inspector currently shows as raw numbers.
