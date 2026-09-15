# How openrcs compares with the stock control software

<!-- Generated from docs/comparison.json by scripts/gen-comparison.py. Edit the JSON, not this file. -->

Where openrcs stands against the software Analog Way ships for each processor family — the RCS² for the Midra series, the Web RCS for LiveCore, LivePremier and Midra 4K. Every row is a feature; the stock column is the vendor's inventory and the openrcs column is the verdict against it.

This page describes **openrcs main (after v0.5.2)** as of 2026-09-15, read from the views the app actually shows for each family and the device variables each one drives. The vendor columns are read from the current manuals, not from a running unit:

- **Midra** (Pulse², Eikos², Saphyr, SmartMatriX², QuickMatriX, QuickVu) — RCS²: Pulse² user manual, RCS² chapters 6–7
- **LiveCore** (Ascender, NeXtage, SmartMatriX Ultra) — Web RCS: LiveCore user manual, Web RCS chapter 7
- **LivePremier** (Aquilon C / RS) — Web RCS: Aquilon User Manual v6.2, September 2026
- **Midra 4K** (Pulse 4K, Eikos 4K, QuickMatrix 4K, QuickVu 4K) — Web RCS: Midra 4K User Manual V3.2, May 2026

## Standing

58 features. For each family, how many openrcs matches, covers in part, goes past, or lacks.

| Family | Stock tool | Full | Partial | Beyond stock | Missing | n/a |
|---|---|--:|--:|--:|--:|--:|
| Midra | RCS² | 15 | 8 | 16 | 5 | 14 |
| LiveCore | Web RCS | 18 | 13 | 13 | 8 | 6 |
| LivePremier | Web RCS | 1 | 5 | 1 | 48 | 3 |
| Midra 4K | Web RCS | 10 | 11 | 1 | 32 | 4 |

**Full** — openrcs matches the stock tool. **Partial** — some of it. **Missing** — the stock tool has it, openrcs does not. **Beyond stock** — openrcs offers something the stock tool has no equivalent for; it does not mean the openrcs version wins on every axis. A dash means the platform has no such thing.

## Midra — against the RCS²

*Pulse², Eikos², Saphyr, SmartMatriX², QuickMatriX, QuickVu.*

### Access & deployment

| Feature | RCS² | openrcs |
|---|---|---|
| Control path | Yes — RCS² desktop app (Adobe AIR) on TCP 10500 | **Full** — openrcs-server + browser; 562-variable table, proven on a Pulse2 |
| Works without a discontinued runtime | No — needs Adobe AIR | **Beyond stock** — one binary or the tray app, any current browser |
| Login, HTTPS, session lock | No — none | **Missing** — none; loopback listen is the default |
| Offline planning / simulator | No — presets 9–64 live on the RCS² computer; no simulator | **Beyond stock** — Plan mode stages a look with no device and pushes it on connect; browser demo against a simulated device |
| Touch / front-of-house surface | No — none | **Beyond stock** — Show mode: big CUT ALL / TAKE ALL, a take tile per destination, master-memory tiles |
| Appliance use (no keyboard, no shell) | No — type the IP in a desktop app | **Beyond stock** — Connection view (keypad or network scan, remembered) and an opt-in Tailnet view gated at the server |

### Live operation

| Feature | RCS² | openrcs |
|---|---|---|
| Take and Cut, per screen and all | Yes — TAKE with screen selection, T-bar | **Full** — Take / Cut per screen, Take all / Cut all, one take time |
| T-bar | Yes | **Full** — GCtba per screen |
| Step back | Yes | **Full** |
| Preset toggle, auto-take, dynamic fit | Yes — Misc: preset toggle, autotake, dynamic fit, freeze mode | **Partial** — settings reachable only through the Inspector |
| Fade to black / master fade | Yes — Quick Frame: an emergency still in front of every layer | **Partial** — output Black per output (Outputs, Keys); no quick frame |
| Freeze | Yes — input, layer and screen freeze; freeze mode all-or-one | **Full** — input freeze (Inputs, Keys), layer freeze, screen freeze and freeze all |
| Screen groups / destinations | No — screen selection on TAKE only | — — the Pulse2 advertises no group model (GCsta) |
| Sequencer / cue list | Yes — Sequence: 16 scenes of master memories with durations; play, pause, stop, loop | **Full** — Cues: any length, GO NEXT, per-cue autofollow wait, HOLD, notes; kept in the browser |
| User keys / macros / quick presets | No — none in RCS² | **Beyond stock** — Keys: one-tap macros — recall + take, take, freeze, black, master fade |
| Timers (clock, countdown, stopwatch) | — | — |
| Input backup / failover | No | **Partial** — unusable sources are flagged amber with an offer to clear; no automatic switch |
| Undo | Yes — STEP BACK | **Beyond stock** — Confidence: a cache-based undo ring, auto-snapshot before every take, one-click revert |

### Composition

| Feature | RCS² | openrcs |
|---|---|---|
| Graphical layer editor | Yes — drag sources onto layers, drag/resize, wireframe or thumbnail mode | **Full** — Layers and Workspace: drag/resize, snap presets, arm-then-tap for touch, drop onto bare canvas |
| All screens editable at once | No — Edit shows one screen's program and preview | **Beyond stock** — Workspace: every active screen, program stacked over preview, each canvas editing its own bank; Stage overview |
| Layer properties | Yes — pos/size, keep aspect, transparency, crop, edge/shadow borders, opening and closing transitions, timing, force transition, smooth move, per-group reset | **Full** — every per-layer variable the unit advertises (27 leaves), including opening/closing durations and layer freeze |
| Layout presets | Yes — 1–2 PIP layouts, clear or fade the others; Pos. and size shortcuts | **Full** — Fill / 2-up / 3-up / Quad / PiP / Stack, plus the unit's own Layout picker |
| Snap, align, multi-select | Yes — align two or more layers, keep aspect, trap layers on screen | **Partial** — snap presets and nine-point pad; no multi-select or align |
| Native background / background sets | Yes — Background Frame layer and background colour | **Full** — background frame or colour |
| Input keying | Yes — colour killer, luma killer, grabber, DSK titling | **Missing** — no keying panel — Inspector only; captured in Show files |
| Cut & Fill | — | — |
| Perspective / 3D layers | — | — |
| Working-area constraint | No | **Beyond stock** — a per-screen region that layouts divide and no drag, typed value or recall can escape; the unit never knows |
| Live thumbnails | No — input thumbnails are stored stills, not live | **Missing** — none — the unit serves no HTTP |

### Memories

| Feature | RCS² | openrcs |
|---|---|---|
| Screen memories | Yes — 8 in the unit plus 56 on the RCS² computer (64 slots), labels | **Full** — the unit's eight presets: recall, load + take, save, erase, inspect thumbnail; the computer-side slots have no equivalent |
| Master memories | Yes — master memories in Live, dragged onto screens | **Full** — on this family the eight unit presets are the master bank |
| Layer memories | No | **Beyond stock** — browser-side layer bank: one layer's 27 properties, applied under the category chips, verified by reading the layer back, carried in a show file |
| Recall filters (categories) | No — whole presets only | **Beyond stock** — category chips on layer-bank recalls, applied client-side |
| Labels, colours, inspect | Yes — Shift-click detail window, preset label | **Full** — device label per slot, inspect thumbnail of the stored layout |
| Autoscale on recall | No | — |
| Confidence screens and memories | — | — |
| Aux screens and aux memories | — | — |

### Setup

| Feature | RCS² | openrcs |
|---|---|---|
| Preconfig: outputs → screens, canvas | Yes — Mode (mixer / matrix), Screens status, setup assistant | **Partial** — Screens shows layer capacity and sets a working area; the operating mode is Inspector-only |
| Output setup | Yes — framelock / internal, format, rate, sync type, force DVI, ten patterns, flicker, gamma, HDCP | **Partial** — format / rate, HDCP, black, processing where the unit advertises it; patterns only on the Video out |
| Midra video out (the second output) | Yes — format, status, pattern, flicker, gamma, overscan, sharpness | **Beyond stock** — plug mode (Recording, mirror out 1, mirror out 2), screen source, a draggable area of interest, format, pattern — verified on a Pulse2, SDI plug watched moving |
| Area of interest (output crop) | No — only the SD video out crops | — — the working area stands in |
| Custom output formats | Yes — CVT or full, check, save / load | **Missing** — Inspector only |
| Input setup | Yes — autoset all, plugs, EDID, HDCP, level / contrast / colour / hue / RGB, blanking, aspect / crop / overscan, user format, keying | **Partial** — availability, active plug, signal status and size, freeze, black, pattern, brightness / contrast / colour / hue / RGB gain, crop; no autoset, keying or user format |
| EDID | Yes — EDID choice per plug | **Beyond stock** — preferred format per input, the connected display's EDID, and a custom-EDID writer for any resolution and rate |
| Stills / image library | Yes — capture logos and frames from main or preview, key before saving; frame and logo slots | **Partial** — Stills shows the frame store; Capture grabs a source frame, full or a region |
| Multiviewer / monitoring | — — a preview output, no multiviewer | — |
| Soft edge blending | Yes — Saphyr only | **Missing** — the Midra scalar soft-edge model (SE*) is not modelled |
| Audio | Yes — modes (top layer, breakaway, routing), per-input gain / pan / level, output pan / gain / level / delay | **Full** — output volume, balance, delay, mute; per-input levels |
| GPIO and tally | — — no GPIO on the Midra series | — |
| System, network, health, front panel | Yes — network, temperature alarms, support, erase memories, factory reset | **Full** — identity, network, temperature and fan, front-panel lock and brightness; no erase or factory reset |
| Firmware update | No — a separate updater application | — |
| Backup / restore | No — no device export in the manual | **Beyond stock** — Shows: the writable state to a JSON file, diff-based restore that writes only what differs, import / export |
| Multi-unit link | — | — |
| LUTs, HDR, colour processing | — | — |
| AVoIP and streaming | — | — |

### Diagnostics and beyond

| Feature | RCS² | openrcs |
|---|---|---|
| Every device variable, raw protocol | No | **Beyond stock** — Inspector searches, reads and sets any variable; Console shows the wire |
| Verified writes | No | **Beyond stock** — layer-bank recalls and source drops are read back — the only way to see a Midra refuse a source with no signal |
| Control-surface module | Yes — Crestron and AMX modules | **Beyond stock** — companion-module-openrcs: take / cut, T-bar, memories, freeze, black, on-air tally |

## LiveCore — against the Web RCS

*Ascender, NeXtage, SmartMatriX Ultra.*

### Access & deployment

| Feature | Web RCS | openrcs |
|---|---|---|
| Control path | Yes — Web RCS served by the unit, in AW Browser | **Full** — 1014-variable table, proven on a NeXtage 16 |
| Works without a discontinued runtime | No — needs AW Browser for the Flash-era Web RCS | **Beyond stock** — same |
| Login, HTTPS, session lock | No — none | **Missing** — none |
| Offline planning / simulator | Yes — AW Simulator runs the Web RCS with no unit | **Beyond stock** — Plan mode + demo |
| Touch / front-of-house surface | No — none | **Beyond stock** — same |
| Appliance use (no keyboard, no shell) | No — type the IP in the browser | **Beyond stock** — same |

### Live operation

| Feature | Web RCS | openrcs |
|---|---|---|
| Take and Cut, per screen and all | Yes — TAKE with screen selection, T-bar, FADE TO BLACK, STEP BACK | **Full** — as Midra; on hardware openrcs sweeps the T-bar itself because the device's take verbs stall a group mid-transition |
| T-bar | Yes | **Full** — per screen and per destination group |
| Step back | Yes | **Full** — per screen and per group |
| Preset toggle, auto-take, dynamic fit | Yes — Screens: preset toggle, auto take; Misc: dynamic fit, preview aspect | **Partial** — ON AIR follows the real program bank; the settings themselves are Inspector-only |
| Fade to black / master fade | Yes — FADE TO BLACK, latching, on all layers | **Full** — Master fade (to black / up) in Live and as a Key action; output Black |
| Freeze | Yes — input freeze, ribbon shortcut | **Full** — input freeze in Inputs, Workspace flags, Keys |
| Screen groups / destinations | No — screen selection on TAKE only; no named groups | **Beyond stock** — Destinations: take / cut / T-bar / step-back a screen group, TAKE ALL GROUPS, grouping editor (Plngr, GCupd) |
| Sequencer / cue list | Yes — Sequencer v2: variable-length cue stack, non-memory cue actions (inputs, frame slots…), keypad mode, loop/rewind/step | **Partial** — Cues cover memory recalls; the device's own SEQ_TAKE sequences and non-memory actions are not driven |
| User keys / macros / quick presets | Yes — Emergency presets A–D (four master memories); sequencer keypad mode | **Beyond stock** — Keys; the emergency-preset slots themselves are not exposed |
| Timers (clock, countdown, stopwatch) | — | — |
| Input backup / failover | No | **Partial** — same |
| Undo | Yes — STEP BACK | **Beyond stock** — same |

### Composition

| Feature | Web RCS | openrcs |
|---|---|---|
| Graphical layer editor | Yes — same, with live thumbnails in the layers | **Full** — same |
| All screens editable at once | No — Edit displays and edits only one screen at a time | **Beyond stock** — same |
| Layer properties | Yes — pos/size (+Z on PL), transparency, crop + aspect override, five border styles, transitions, timing bars, speed, Bézier flying curve, flip, B&W / negative / sepia / solarise, strobe, copy-paste per group | **Full** — all 40 leaves: nine-point pad, aspect presets, borders, transitions with direction / timing / speed, flying curve, force transition, smooth move, flip, effects, strobe |
| Layout presets | Yes — 1–6 PIP layouts; perspective layouts on PL | **Full** — Fill / 2-up / 3-up / Quad / PiP / Stack, dividing the working area |
| Snap, align, multi-select | Yes — snap to grid, snap to layer, alignment guides, multi-select, align, copy layer, raise/lower | **Partial** — snap presets, raise/lower; no grid magnet, multi-select or align |
| Native background / background sets | Yes — native background sets (input, frame or colour) with position, transparency, cut or fade | **Full** — background set or colour per screen |
| Input keying | Yes — colour, luma and CremaTTe, assistant with masks, invert, DSK | **Missing** — same |
| Cut & Fill | Yes — a layer keyed by the next layer's content | **Missing** — the mnemonics beyond PRmcv are unknown |
| Perspective / 3D layers | Yes — Ascender 32/48-4K-PL: X/Y/Z, RotX/Y/Z, anchor point, Z mixing, perspective layouts | **Partial** — Depth and Rotate X/Y/Z appear when a screen enables perspective; no anchor point or perspective layouts |
| Working-area constraint | No | **Beyond stock** — same; Fit existing layers across every bank |
| Live thumbnails | Yes — live pictures in layers and the source ribbon | **Partial** — inputs only, refreshed a few times a minute — the unit serves capture_in_N and 404s everything else |

### Memories

| Feature | Web RCS | openrcs |
|---|---|---|
| Screen memories | Yes — 144 per screen bank: save mode, labels, overview, load filters, saved filters, autoscale | **Full** — 144: recall / load + take / save / erase, device labels, inspect thumbnail, preview-or-program target |
| Master memories | Yes — 144, built from screen memories or from PGM/PRW, carrying confidence memories | **Full** — 144: recall / load + take / save / erase, labels, category filter; Show mode tiles |
| Layer memories | No | **Beyond stock** — same, 40 properties |
| Recall filters (categories) | Yes — load filters and filters saved into the memory | **Full** — the device's twelve-category PMcat on every recall, all three banks |
| Labels, colours, inspect | Yes — hover overview, Shift-click label, filter icon | **Full** — device labels (LBPMe / LBPSe), inspect thumbnail |
| Autoscale on recall | Yes | **Missing** — not exposed |
| Confidence screens and memories | Yes — program outputs as confidence monitors, 14 layouts, 16 confidence memories, in master memories | **Missing** — CM* / CO* are not exposed |
| Aux screens and aux memories | — | — |

### Setup

| Feature | Web RCS | openrcs |
|---|---|---|
| Preconfig: outputs → screens, canvas | Yes — assistant: internal rate, link, output resources / dual-link / 4K, rotation, grid and custom-canvas screens, templates, ID pattern, native inputs | **Partial** — Wall places each screen at its real output position (OSpoh / OSpov, OSupd); screen composition, resource moves and rotation are not surfaced |
| Output setup | Yes — rate, format, timing, type / colour, 4K mode, thirteen patterns, flicker, gamma, brightness, contrast, RGB gain, HDCP, optical plug | **Partial** — format / rate, HDCP, black, brightness / contrast / gamma / RGB gain; no timing, type or patterns |
| Midra video out (the second output) | — | — |
| Area of interest (output crop) | Yes — Setup AOI per output | **Partial** — staged and applied (OSaup); a NeXtage 16's readback never moved, so the panel draws the readback and warns |
| Custom output formats | Yes — memories with label, load-from, validity check | **Missing** — Inspector only |
| Input setup | Yes — plug select, signal type, SD options, enable, label, dual-link / dual-head / 4K, identifier, pattern, black, freeze, HDCP, image, clock / phase, sharpness, deinterlacer, aspect / crop, user format, keying | **Partial** — as Midra |
| EDID | Yes — EDID manager: output EDIDs, 32-slot library (10 locked), drag to inputs, file upload, factory reset | **Partial** — per-input preferred format + store / factory, display readout, custom-EDID writer; no library or file import / export |
| Stills / image library | Yes — 100-slot library, upload BMP / JPEG / TIFF / GIF / PNG / ICO, 4 frame + 4 logo slots, 4K and dual frames, live captures, link sync | **Partial** — Stills grid of the library, Capture into it; no upload from the computer, no slot assignment |
| Multiviewer / monitoring | Yes — 12 widgets (8 on NeXtage), templates, no-overlap editor, 8 layout memories, fit screen, load a layout in Live | **Full** — drag / resize designer: up to 12 widgets with source and OSD label, grid presets, fullscreen, apply (MLupd), 8 layout memories (MON_MEM) |
| Soft edge blending | Yes — covering with a centering pattern, black levels and curve per edge | **Full** — per-edge editor: click an edge to feather it into its neighbour, set the black level |
| Audio | — — no audio processing on LiveCore | — |
| GPIO and tally | Yes — GPO free or tally (before / after the take) with polarity, GPI free or take | **Full** — GPIO view (trigger inputs, tally / relay outputs) and a live Tally grid off the device's tally bus |
| System, network, health, front panel | Yes — network / port / protocol, temperature, hardware info, erase, factory reset, auto-calibrate, dashboard | **Full** — same |
| Firmware update | Yes — upload updater or USB | **Missing** |
| Backup / restore | Yes — export / import a backup with config, library, logs, snapshots (400 MB) | **Partial** — Shows cover the look, memory banks, input and output setup; the image library is not carried |
| Multi-unit link | Yes — Additive Modularity links two 4U units; library sync | **Missing** — COUPLING (34 variables) not surfaced |
| LUTs, HDR, colour processing | — | — |
| AVoIP and streaming | — | — |

### Diagnostics and beyond

| Feature | Web RCS | openrcs |
|---|---|---|
| Every device variable, raw protocol | No | **Beyond stock** — same |
| Verified writes | No | **Beyond stock** — same |
| Control-surface module | Yes — Crestron / AMX drivers, third-party protocol | **Beyond stock** — same |

## LivePremier — against the Web RCS

*Aquilon C / RS.*

### Access & deployment

| Feature | Web RCS | openrcs |
|---|---|---|
| Control path | Yes — Web RCS served by the unit over HTTP/HTTPS | **Partial** — AWJ on TCP 10606 from the published guide; reads proven on two Aquilon C frames, openrcs's own write path simulator-only |
| Works without a discontinued runtime | Yes — HTML5, nothing to install | **Full** — parity — nothing to replace |
| Login, HTTPS, session lock | Yes — password, HTTP/HTTPS, custom certificate, session lock | **Missing** — none |
| Offline planning / simulator | Yes — LivePremier Simulator | **Missing** — Plan is not offered in LivePremier mode |
| Touch / front-of-house surface | Yes — mobile Web RCS; RC400T console | **Missing** |
| Appliance use (no keyboard, no shell) | No — type the IP in the browser | **Beyond stock** — Connection + Tailnet views are family-independent |

### Live operation

| Feature | Web RCS | openrcs |
|---|---|---|
| Take and Cut, per screen and all | Yes — Take, Take Cut, T-bar, Fade In/Out, Step Back, screen transition filter, global take time | **Partial** — Take and Cut per screen with take-up/down times shown; no take-all |
| T-bar | Yes | **Missing** |
| Step back | Yes | **Missing** |
| Preset toggle, auto-take, dynamic fit | Yes — Preset Toggle per screen | **Missing** |
| Fade to black / master fade | Yes — Fade Out / Fade In on the selected screens | **Missing** |
| Freeze | Yes — freeze the layer selection on PGM/PRW, freeze an input from its thumbnail | **Missing** |
| Screen groups / destinations | Yes — screen transition filter | **Missing** |
| Sequencer / cue list | No — none in the Web RCS — webrcs-timeline and livepremier-plus fill this in the fleet | **Missing** — Cues are not offered in LivePremier mode |
| User keys / macros / quick presets | Yes — RC400T user keys (hardware); none in the Web RCS | **Missing** |
| Timers (clock, countdown, stopwatch) | Yes — timers as image-slot and multiviewer content | **Missing** |
| Input backup / failover | Yes — Quick Backup set: Backup 1/2 per input, manual or automatic on failure | **Missing** |
| Undo | Yes — Step Back; quick overwrite or revert on a memory | **Missing** |

### Composition

| Feature | Web RCS | openrcs |
|---|---|---|
| Graphical layer editor | Yes — Screens layout editor with box / layer mode | **Missing** — a table, no layer editing |
| All screens editable at once | Yes — all screens and auxes side by side, resizable, with view memories | **Missing** |
| Layer properties | Yes — source, pos/size + anchor, keying, Cut & Fill, opacity, aspect/crop, mask, border, smooth border, shadow, colour filter, flip, strobe, transition effect / timing / speed | **Missing** |
| Layout presets | Yes — align set, ratio presets, box mode | **Missing** |
| Snap, align, multi-select | Yes — snap to borders and grid, align set, box vs layer mode | **Missing** |
| Native background / background sets | Yes — background sets per screen | **Missing** |
| Input keying | Yes — chroma, luma, CremaTTe 3D LUT | **Missing** |
| Cut & Fill | Yes — on inputs and layers | **Missing** |
| Perspective / 3D layers | — | — |
| Working-area constraint | No — the output AOI serves the need instead | **Missing** |
| Live thumbnails | Yes — source, layer and output thumbnails | **Missing** |

### Memories

| Feature | Web RCS | openrcs |
|---|---|---|
| Screen memories | Yes — 1000, labels, slot colours, reorder, record mask, autoscale, quick overwrite/revert | **Partial** — recall only, paged 50 slots at a time with validity and label; no save, label or erase |
| Master memories | Yes — 500, load at startup, edit | **Missing** |
| Layer memories | Yes — 50 layer memories on the device | **Missing** — not exposed |
| Recall filters (categories) | Yes — record mask per memory | **Missing** |
| Labels, colours, inspect | Yes — labels, slot colours, reorder, hide | **Partial** — labels are read, nothing is written |
| Autoscale on recall | Yes | **Missing** |
| Confidence screens and memories | — — aux screens play this role | — |
| Aux screens and aux memories | Yes — aux screens with aux layers, memories in the screen bank | **Missing** — screens only |

### Setup

| Feature | Web RCS | openrcs |
|---|---|---|
| Preconfig: outputs → screens, canvas | Yes — system rate, output groups, screens and auxes, grid / free canvas with covering and bezel, rotation, AOI, pitch, input groups, images, backgrounds, AVoIP | **Missing** |
| Output setup | Yes — format, signal, manual and LUT correction, pattern | **Missing** |
| Midra video out (the second output) | — | — |
| Area of interest (output crop) | Yes — per output, with pitch compensation | **Missing** |
| Custom output formats | Yes | **Missing** |
| Input setup | Yes — signal, aspect / crop, keying, correction, LUT, pattern, NDI source, backup | **Missing** |
| EDID | Yes — EDID bank, save from I/O, template and custom formats, import / export, AW EDID Editor | **Missing** |
| Stills / image library | Yes — library up / download, capture, image slots, timers, downscale to capacity | **Missing** |
| Multiviewer / monitoring | Yes — up to six multiviewers, widgets, timers, preview mode, 50 memories, load at startup | **Missing** |
| Soft edge blending | Yes — covering in grid and free canvas | **Missing** |
| Audio | Yes — Dante / embedded matrix, screen audio follow, custom sets | **Missing** |
| GPIO and tally | Yes — GPIO / tally | **Missing** |
| System, network, health, front panel | Yes — dashboard: device, firmware, network, power, hardware, cooling, remote access and control | **Missing** — model only |
| Firmware update | Yes | **Missing** |
| Backup / restore | Yes — save / load configuration, import / export | **Missing** |
| Multi-unit link | Yes — multi-unit via link cabling and the RC400T | **Missing** |
| LUTs, HDR, colour processing | Yes — 3D LUT library, CremaTTe LUT, HDR conversion, colour processing | **Missing** |
| AVoIP and streaming | Yes — NDI, ST 2110, SDVoE, Dante | **Missing** |

### Diagnostics and beyond

| Feature | Web RCS | openrcs |
|---|---|---|
| Every device variable, raw protocol | No | **Missing** — no Inspector for the AWJ tree here (awj-surface and livepremier-plus's Console cover it) |
| Verified writes | No | **Partial** — preset recalls read the screen back rather than assuming; a wrong platform pick is named by the processor's own identity |
| Control-surface module | Yes — AMX / Crestron drivers, REST API, RC400T | **Missing** — not in the openrcs module |

## Midra 4K — against the Web RCS

*Pulse 4K, Eikos 4K, QuickMatrix 4K, QuickVu 4K.*

### Access & deployment

| Feature | Web RCS | openrcs |
|---|---|---|
| Control path | Yes — Web RCS served by the unit | **Partial** — AWJ on TCP 10606 in the Midra 4K / Alta 4K object model, every path read off a Pulse 4K on 3.3.10; openrcs's own surface driven only against the vendor simulators |
| Works without a discontinued runtime | Yes — HTML5, nothing to install | **Full** — parity — nothing to replace |
| Login, HTTPS, session lock | Yes — password protection, HTTPS | **Missing** — none |
| Offline planning / simulator | Yes — Midra 4K Simulator | **Missing** — Plan is not offered on this family |
| Touch / front-of-house surface | Yes — mobile Web RCS; RC400T console | **Missing** |
| Appliance use (no keyboard, no shell) | No | **Beyond stock** — Connection + Tailnet views are family-independent |

### Live operation

| Feature | Web RCS | openrcs |
|---|---|---|
| Take and Cut, per screen and all | Yes — Take, Take Cut, T-bar, Step Back, TAKE ALL | **Full** — Take / Cut per screen and per auxiliary, the take time typed in seconds, and Take all (one take per destination, as the vendor's own Web RCS does it) |
| T-bar | Yes | **Full** — per destination, on the take node's own control; the device reports the ends |
| Step back | Yes | **Partial** — the device's own xStepBack — an edit undo (the last change to layer settings), which is what the vendor manual means by it here; not a return to the previous look |
| Preset toggle, auto-take, dynamic fit | Yes | **Partial** — the preset toggle (swap) per destination; no auto-take or dynamic fit |
| Fade to black / master fade | Yes — Quick Preset → Fade to Black | **Full** — the device's own quick preset from the Screens view: fade to black, a library image or a master memory on every covered destination, on and off from one switch |
| Freeze | Yes — layer, screen and input freeze | **Full** — destination freeze, per-layer freeze (holds through a take), input freeze |
| Screen groups / destinations | Yes — TAKE ALL / selection | **Missing** |
| Sequencer / cue list | No — none | **Missing** — Cues are not offered on this family |
| User keys / macros / quick presets | Yes — Quick Preset on the front panel: fade to black, a library image or a master memory | **Missing** |
| Timers (clock, countdown, stopwatch) | Yes — three timers in the multiviewer | **Missing** |
| Input backup / failover | No | **Missing** |
| Undo | Yes — Step Back; quick overwrite or revert | **Missing** |

### Composition

| Feature | Web RCS | openrcs |
|---|---|---|
| Graphical layer editor | Yes | **Partial** — one screen at a time on a canvas at the applied size: drag to move, corners to resize, layouts; an auxiliary is one background source |
| All screens editable at once | Yes | **Missing** — one destination at a time |
| Layer properties | Yes — opacity, crop/aspect, mask, border, smooth border, shadow, colour filter, flip, transition effect / timing / speed | **Partial** — source, centre/size, opacity, crop, mask, effects, border, shadow, transitions (type/way), flying curve type, speed type, freeze, fader with fade in/out, plus the background set/colour and the top frame; not the timing bars, flying curve points, speed points or a COLOR layer's colour |
| Layout presets | Yes — live-layer layouts | **Partial** — Fill / 2-up / 3-up / Quad / PiP over the fitted layers, in slot order |
| Snap, align, multi-select | Yes | **Missing** |
| Native background / background sets | Yes — background sets | **Full** — the preset's background set (or colour) and opacity, and its top frame with position, on the Layers canvas |
| Input keying | Yes — chroma, luma | **Missing** |
| Cut & Fill | Yes — on odd inputs | **Missing** |
| Perspective / 3D layers | — | — |
| Working-area constraint | No — the output AOI serves the need instead | **Missing** |
| Live thumbnails | Yes | **Partial** — the unit's own pictures of inputs on the Layers canvas and the Inputs page, and of frame slots; no program or preview render exists to fetch |

### Memories

| Feature | Web RCS | openrcs |
|---|---|---|
| Screen memories | Yes — 200 screen + 200 aux | **Full** — recall, save (from program or preview), label and erase on the 200-slot screen and aux banks, paged 50 at a time, with a red/green mark on the slot each buffer holds |
| Master memories | Yes — 50, self-contained or from screen memories | **Full** — recall, save, label and erase on the 50-slot master bank; a save from a buffer writes the bank slots the device would otherwise put in slot 1, and refuses when they are in use; or record the memories the buffers already hold |
| Layer memories | No | **Missing** |
| Recall filters (categories) | Yes | **Missing** |
| Labels, colours, inspect | Yes | **Partial** — labels read and written; no colours, no inspect thumbnail |
| Autoscale on recall | Yes | **Missing** |
| Confidence screens and memories | — | — |
| Aux screens and aux memories | Yes — aux screens, 200 aux memories | **Full** — auxiliaries are destinations — take, cut, T-bar, freeze, memory bookkeeping, background source — and the aux bank recalls, saves, labels and erases |

### Setup

| Feature | Web RCS | openrcs |
|---|---|---|
| Preconfig: outputs → screens, canvas | Yes — system, screens / aux, canvas, background, audio, quick preset | **Missing** |
| Output setup | Yes | **Missing** |
| Midra video out (the second output) | — | — |
| Area of interest (output crop) | Yes | **Missing** |
| Custom output formats | Yes | **Missing** |
| Input setup | Yes — plug, LUT allocation, signal, correction, aspect, keying | **Partial** — availability, active plug, connector and signal format per input, freeze and black; no plug selection, image, aspect or keying |
| EDID | Yes — same | **Missing** |
| Stills / image library | Yes — library, background and foreground image slots | **Missing** |
| Multiviewer / monitoring | Yes — one multiviewer, audio monitoring, 20 memories | **Missing** |
| Soft edge blending | Yes — Eikos 4K blend mode | **Missing** |
| Audio | Yes — routing, Dante, VU meters, custom sources | **Missing** |
| GPIO and tally | Yes — TSL tally protocol; no GPIO | **Partial** — the device's own on-air lists per input are read and shown; never seen populated on the simulator, so unverified |
| System, network, health, front panel | Yes | **Full** — identity, network, temperature sensors and fans with alarms, front-panel lock and brightness, reboot; no erase or factory reset |
| Firmware update | Yes | **Missing** |
| Backup / restore | Yes — configuration slots, export / import, USB | **Missing** |
| Multi-unit link | — | — |
| LUTs, HDR, colour processing | Yes — LUT libraries, LUT allocation, HDR conversion | **Missing** |
| AVoIP and streaming | Yes — Dante (optional card); RTMP streaming out to a network or a platform | **Missing** |

### Diagnostics and beyond

| Feature | Web RCS | openrcs |
|---|---|---|
| Every device variable, raw protocol | No | **Missing** — no Inspector for the AWJ tree here (livepremier-plus's Console covers it) |
| Verified writes | No | **Partial** — every write reads its target back; recalls read the destination twice because the bookkeeping lands late; a master save is refused rather than allowed to overwrite bank slots |
| Control-surface module | Yes — AMX / Crestron drivers, REST API, RC400T | **Missing** — not in the openrcs module |

---

Mnemonics in the cells (`PMcat`, `OSaup`, `GCsta`) name the device variable a view is built on, so a row can be checked against the [protocol reference](https://github.com/stoatworks-labs/openrcs-protocol). Not affiliated with or endorsed by Analog Way; product names are used only to describe compatibility.
