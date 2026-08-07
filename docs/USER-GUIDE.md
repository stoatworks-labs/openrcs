# openrcs — user guide

openrcs is a modern control surface for Analog Way **Midra** and **LiveCore**
series video processors. A small bridge server holds one connection to the
processor and serves a web UI to any number of browsers, so you can drive the
device from a laptop, a tablet, or a touch panel — no vendor runtime required.

## Running it

Start the bridge server, pointing it at the processor's control port (TCP
10500), and open the web UI:

```bash
cargo run -p openrcs-server -- --device <processor-ip>:10500 --platform livecore
# then open http://127.0.0.1:8730/
```

Use `--platform midra` for the Midra family. The header shows the device model,
platform and a connection indicator; every view updates live as the device — or
another operator — changes state.

The interface is a single dark theme, chosen deliberately for the blacked-out
environments these processors live in. The left nav is grouped into **Program**
(the things you touch during a show), **Setup** (configuration), and **Tools**.

**It adapts to the device.** openrcs reads the variable table the processor
advertises and shows only the views that hardware actually supports — so a
LiveCore unit exposes the full set below, while a Midra unit shows the subset it
implements (and swaps in its own equivalents, e.g. a per-screen **Freeze** where
LiveCore offers a master fade). The two families model some things differently
— memories especially — and the UI follows each one's model rather than forcing a
single shape.

![openrcs driving a Pulse2 (Midra) — the nav shows only the views this unit supports, and Live offers a per-screen Freeze instead of a master fade](screenshots/midra.png)

## Stage

![All screens at a glance](screenshots/stage.png)

A mission-control overview: every active screen, drawn to scale with its live
layers, in one place. Layers are coloured by source so the same input reads the
same across screens. Toggle **Program / Preview**, and click any screen to jump
straight into its layer editor.

## Memories

![Memory grids](screenshots/memories.png)

Recall, store and take memories. Toggle between **Master** memories (whole-device
presets across all screens) and **Screen** memories (per-screen presets), and
choose what a slot tap does:

- **Recall** — load the memory into preview.
- **Load + Take** — load it and take it to program in one action.
- **Save** — store the current state into the slot you tap.

Saved slots light up, driven by the device's own validity flags, so the grid
always reflects what is actually stored on the hardware. **Inspect** mode shows a
scaled thumbnail of a stored memory's layout — source, size and position of every
layer — without recalling it. On **Midra**, memories follow that family's model
instead: eight preset slots, each captured from the live program, with the same
inspect-thumbnail, recall and erase.

## Cues

![Cue list](screenshots/cues.png)

Turn your memories into a show script. Each cue recalls a master or screen
memory and takes it; **GO NEXT** runs the list step by step. Preview or Go any
cue directly, reorder and rename, and the current cue is highlighted. Cues are
saved in the browser, so your running order survives a reload.

## Keys

![User keys](screenshots/keys.png)

Programmable one-tap buttons. A key runs a sequence of actions — recall a
memory (with take), take a screen or all screens, freeze an input, black an
output, master-fade — so a whole cue-to-air, a panic black, or a freeze is a
single press. Tap **Edit** to build them; they persist in the browser.

## Live

![Live take](screenshots/live.png)

The take bar: choose a screen, set a transition time, and move preview to program
with **TAKE**, or switch instantly with **CUT**.

## Layers

![Graphical layer editor](screenshots/layer-editor.gif)

Arrange sources on the screen visually. Each layer is a rectangle on a canvas
that represents the output: **drag to move, drag the corners to resize**, and use
the snap presets to fill the screen or drop a layer into a quadrant. The layer
stack on the right mirrors the canvas — assign a source and fine-tune position,
size, opacity, border, crop and per-layer transitions, and raise or lower a
layer in the stack. A **Program / Preview** toggle chooses which buffer you are
editing, and each screen has a native **Background** (colour or a background set).

On **Midra**, a **Layout** picker offers the processor's built-in arrangements —
choose one and the device lays the layers out for you, ready for sources.

## Setup

![Inputs](screenshots/inputs.png)

The Setup views cover configuration and monitoring. Which ones appear depends on
the device:

- **Tally** — a live on-air grid: each source lights red on program, green on
  preview, straight from the device's own tally bus.
- **Inputs** — every input with its availability, active plug, live signal status
  and detected size, plus freeze and black.
- **Outputs** — the physical outputs, their connected displays, format, size,
  HDCP and output processing (brightness, contrast, gamma, gain).
- **Screens** — the output screens and their layer capacity.
- **Stills** — the still/logo library as a grid (LiveCore), or the frame store
  (Midra), showing what's stored and its size.
- **Capture** — grab a frame from a live source into the still library: pick a
  source and capture the full frame or a graphical region.
- **Multiviewer** — a drag-and-resize layout designer for the monitoring outputs:
  place up to twelve widgets, pick each one's source, and store layout memories.
- **Soft edge** — a per-edge blend editor for multi-output screens: click an edge
  to feather it into its neighbour and set the black level.
- **EDID** — set an input's preferred format and read the EDID a connected display
  advertises. The **custom-EDID writer** builds a valid EDID for any resolution
  and refresh rate and writes it to an input, so a source outputs exactly what you
  want.
- **Audio** — output volume, balance, delay and mute, plus per-input channel
  levels where the device provides them.
- **GPIO** — trigger inputs and tally/relay outputs.

Inputs and outputs also carry image adjustment: click an input row for
brightness, contrast, colour, hue, RGB gain and crop; each output has its own
processing and a format/rate selector.

![The multiviewer designer — drag widgets onto the monitoring output and store layout memories](screenshots/multiviewer.png)

![Audio — per-output volume, balance, delay and mute (a Midra unit here)](screenshots/audio.png)

![The custom-EDID writer — generate a valid EDID for any resolution and write it to an input](screenshots/edid-writer.png)

## System

![System](screenshots/system.png)

Device identity, network settings, temperature and fan health, and front-panel
lock and brightness.

## Tools — Inspector and Console

- **Inspector** — search, read and set *any* of the device's variables. Useful
  for anything the dedicated views don't yet cover.
- **Console** — the raw protocol, sent and received, for diagnostics.

## Sharing a view

Each view has its own URL (`…/#layers`, `…/#memories`, and so on), so you can
bookmark or link straight to the panel you want.

## Notes

Both families have been driven against real hardware — a NeXtage 16 (LiveCore)
and a Pulse2 (Midra). A few behaviours still depend on the device: assigning a
live input needs a signal present on it, and some capabilities vary by model and
firmware (openrcs hides what a given unit doesn't implement). Per-variable ranges
are the device's declarations — the hardware is always the final authority. The
full protocol is documented in the
[openrcs-protocol](https://github.com/stoatworks-labs/openrcs-protocol)
reference.
