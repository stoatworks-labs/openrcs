# Roadmap and feature exploration

Where openrcs is, and where it could go. The second half sketches features drawn
from other professional multi-screen control systems — Barco **Event Master**,
Analog Way's own **LivePremier RCS**, and canvas/pixel-space tools in the vein of
**Pixelflow** — noting for each whether the LiveCore/Midra protocol already
exposes what it needs.

## Shipped

- **Memories** — master and screen memory grids (recall / load+take / save).
- **Live** — preview→program take with a transition time.
- **Layers** — a graphical arrangement canvas (drag/resize, snap presets) plus a
  full property editor: source, opacity, position, size, border, crop, and
  per-layer opening/closing transitions.
- **Stage** — an all-screens overview: every active screen with its layers, in
  one canvas, click-through to editing.
- **Setup** — Inputs, Outputs, Screens, Stills.
- **System** — identity, network, health, front-panel.
- **Tools** — Inspector (every variable) and a raw-protocol Console.

## Near-term parity (already in the protocol)

Concrete device capabilities not yet given a dedicated surface:

- **Output format / resolution** (`OUfor`) and **EDID** management (`EDID_IN`,
  `EDID_OUT`, `EDID_LIB`) — the last big Setup gap.
- **Native backgrounds** (`PRESET_NATIVE`, `NATIVE_SET`) — the full-screen
  background layer beneath the live layers.
- **Soft edge** (`SOFTEDGE`) and **screen mapping** for blended/multi-output
  screens.
- **Still capture** (`STILLS_CAPTURE`) — grab a frame from a source into the
  still library.
- **Master fade / black** (`MASTER_ALPHA`) per screen.
- **Layer swap** (`LAYER_SWAP`) — swap two layers' sources/geometry.

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

### Cue list / show timeline — *LivePremier*
`SEQ_TAKE` gives sequenced takes; memories give the content. A cue list —
ordered steps of "recall memory N, take, wait" with a big **TAKE NEXT** — turns
the memory grid into a show script. Autofollow and per-cue notes on top.
**Feasible; sequencing logic lives in the client.**

### User keys / macros — *Event Master*
One tap that does several protocol actions (recall + take, source + take,
freeze all, black). Stored in the browser, or mapped to the device's own shotbox
keys where present. A programmable button wall. **Feasible; client-side.**

### Multiviewer designer — *LivePremier, Event Master*
`MONITORING_LAYOUT` / `MONITORING__OUTPUTS` control the multiviewer. A drag-drop
layout editor for the monitor output, with monitoring memories (`MON_MEM`).
**Feasible.**

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

Event Master and LivePremier RCS are directly comparable — multi-screen event
switchers whose control software defines the category (destinations, presets,
aux, multiviewer, user keys). "Pixelflow" is taken here as the canvas/pixel-space
paradigm — a single stage you compose across, outputs mapped in as viewports —
which is the model the Stage view is growing toward. If a specific product is
meant by it, point me at it and I'll draw from the real thing.

Everything above is gated on hardware access for the features that touch signal
paths (thumbnails, capture, EDID) and on confirming the enum meanings the
Inspector currently shows as raw numbers.
