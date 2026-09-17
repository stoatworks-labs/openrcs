# How openrcs compares with the stock control software

<!-- Generated from docs/comparison.json by scripts/gen-comparison.py. Edit the JSON, not this file. -->

Where openrcs stands against the software Analog Way ships for each processor family — the RCS² for the Midra series, the Web RCS for LiveCore, LivePremier and Midra 4K, and the original RCS for the Pulse PLS300. Every row is a feature; the stock column is the vendor's inventory and the openrcs column is the verdict against it.

This page describes **openrcs v0.8.1** (`1b1bd72`) as of 2026-09-16, read from the views the app actually shows for each family and the device variables each one drives. The vendor columns are read from the current manuals, not from a running unit:

- **Midra** (Pulse², Eikos², Saphyr, SmartMatriX², QuickMatriX, QuickVu) — RCS²: Pulse² user manual, RCS² chapters 6–7
- **LiveCore** (Ascender, NeXtage, SmartMatriX Ultra) — Web RCS: LiveCore user manual, Web RCS chapter 7
- **LivePremier** (Aquilon C / RS) — Web RCS: Aquilon User Manual v6.2, September 2026
- **Midra 4K** (Pulse 4K, Eikos 4K, QuickMatrix 4K, QuickVu 4K) — Web RCS: Midra 4K User Manual V3.2, May 2026
- **PLS300** (Pulse PLS300) — RCS: PLS300 user manual, RCS chapter 5 — openrcs’s column is from the Programmer’s Guide and a table-derived fixture, not a unit

## Standing

58 features. For each family, how many openrcs matches, covers in part, goes past, or lacks.

| Family | Stock tool | Full | Partial | Beyond stock | Missing | n/a |
|---|---|--:|--:|--:|--:|--:|
| Midra | RCS² | 15 | 8 | 16 | 5 | 14 |
| LiveCore | Web RCS | 18 | 13 | 13 | 8 | 6 |
| LivePremier | Web RCS | 2 | 6 | 2 | 45 | 3 |
| Midra 4K | Web RCS | 28 | 18 | 3 | 5 | 4 |
| PLS300 | RCS | 18 | 7 | 7 | 8 | 18 |

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
| Offline planning / simulator | Yes — LivePremier Simulator | **Partial** — plan mode: every value set on Screens or Presets is staged in the browser with no processor attached and pushed on connect; triggers are never staged; not the vendor’s simulator |
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
| Sequencer / cue list | No — none in the Web RCS — webrcs-timeline and livepremier-plus fill this in the fleet | **Beyond stock** — a cue list over the screen bank: a memory per cue on one screen, Go (to preview, then take), Cut and Arm, per-cue autofollow with a wait, Hold; kept in the browser — the device has no sequencer |
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
| Every device variable, raw protocol | No | **Full** — the same Inspector: get/set any AWJ path, the wire log |
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
| Offline planning / simulator | Yes — Midra 4K Simulator | **Partial** — plan mode: every value set on any page is staged in the browser with no processor attached, previewed in place and pushed on connect; triggers are never staged; not the vendor’s simulator, which stays the way to rehearse a whole show |
| Touch / front-of-house surface | Yes — mobile Web RCS; RC400T console | **Partial** — Show mode: every destination in one big column with large take and cut buttons, drawn for a touch screen or a front-of-house table; no phone layout, no console |
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
| Screen groups / destinations | Yes — TAKE ALL / selection | **Full** — tick any set of screens and auxiliaries and take, cut or T-bar them as one group, or Take all; each keeps its own take time |
| Sequencer / cue list | No — none | **Beyond stock** — a cue list over the memory banks: a master, screen or auxiliary memory per cue, Go (to preview, then take), Cut and Arm, per-cue autofollow with a wait, Hold; kept in the browser — the device has no sequencer |
| User keys / macros / quick presets | Yes — Quick Preset on the front panel: fade to black, a library image or a master memory | **Full** — the device's quick preset — fade to black, a library image or a master memory, on and off from one switch, with the destinations it covers and what it does to audio; the Midra 4K has no user keys or macros beyond it |
| Timers (clock, countdown, stopwatch) | Yes — three timers in the multiviewer | **Partial** — the three timers: type, label, countdown duration, start/pause/stop — the transport verbs are written but the simulator never leaves idle |
| Input backup / failover | No | **Missing** |
| Undo | Yes — Step Back; quick overwrite or revert | **Partial** — Step Back (the device's own edit undo, one step) from the Screens view; no revert of a memory |

### Composition

| Feature | Web RCS | openrcs |
|---|---|---|
| Graphical layer editor | Yes | **Full** — every screen’s live layers on a canvas at the applied size with the unit’s own pictures — one screen at a time on Layers with the full panel, all of them on Show — drag to move (snapping), corners to resize, twelve layouts, arrow-key nudge, copy and paste; an auxiliary is one background source |
| All screens editable at once | Yes | **Full** — the Show page: every screen and auxiliary in service side by side, each screen’s program or preview editable on its own canvas, taken alone or all together |
| Layer properties | Yes — opacity, crop/aspect, mask, border, smooth border, shadow, colour filter, flip, transition effect / timing / speed | **Partial** — source, centre/size, opacity, crop, mask, effects, border, shadow, transitions (type/way), flying curve type, speed type, freeze, fader with fade in/out, plus the background set/colour and the top frame; not the timing bars, flying curve points, speed points or a COLOR layer's colour |
| Layout presets | Yes — live-layer layouts | **Full** — twelve layouts over the fitted layers in slot order — Fill, 2-up, 3-up, Quad, PiP, PiP ×2, 1 + 2, 1 + 3, 3×2, 4×2, Columns, Rows — on Layers and on every Show card |
| Snap, align, multi-select | Yes | **Partial** — drags snap to the canvas edges and centre lines and to the other layers’ edges and centres (Alt to drag free), arrow-key nudge (Shift ×10); no multi-select or align commands |
| Native background / background sets | Yes — background sets | **Full** — the preset's background set (or colour) and opacity, and its top frame with position, on the Layers canvas |
| Input keying | Yes — chroma, luma | **Partial** — keyer mode (off / chroma / luma / cut and fill), the chroma and luma parameters, mask display and the sampling assistant, offered only where the device says the input has a keyer — no simulator input does, so written and read back but never seen keying |
| Cut & Fill | Yes — on odd inputs | **Full** — cut-and-fill mode on the inputs the device says can be a fill (the odd ones), with the cut input, sync status and phase it reports; set on the simulator |
| Perspective / 3D layers | — | — |
| Working-area constraint | No — the output AOI serves the need instead | **Missing** |
| Live thumbnails | Yes | **Full** — the unit’s own pictures of inputs, outputs and the multiviewer, and each screen’s program and preview composed from them on the Show and Layers canvases; the device has no program or preview render of its own |

### Memories

| Feature | Web RCS | openrcs |
|---|---|---|
| Screen memories | Yes — 200 screen + 200 aux | **Full** — recall, save (from program or preview), label and erase on the 200-slot screen and aux banks, paged 50 at a time, with a red/green mark on the slot each buffer holds |
| Master memories | Yes — 50, self-contained or from screen memories | **Full** — recall, save, label and erase on the 50-slot master bank; a save from a buffer writes the bank slots the device would otherwise put in slot 1, and refuses when they are in use; or record the memories the buffers already hold |
| Layer memories | No | **Beyond stock** — copy a layer’s whole property set — source, geometry and every property the panel holds — and paste it onto any layer of any screen or buffer (held in the page, not stored on the device) |
| Recall filters (categories) | Yes | **Full** — what a save records, as the device models it: the thirteen categories, which live layers, background and top for a screen; four categories for an auxiliary; which destinations and what of each for a master memory — a slot reports the filter it was saved with |
| Labels, colours, inspect | Yes | **Partial** — labels read and written; no colours, no inspect thumbnail |
| Autoscale on recall | Yes | **Full** — the device’s own autoscale-on-load flag per screen, and the multiviewer’s, switched from the Presets and Multiviewer pages |
| Confidence screens and memories | — | — |
| Aux screens and aux memories | Yes — aux screens, 200 aux memories | **Full** — auxiliaries are destinations — take, cut, T-bar, freeze, memory bookkeeping, background source — and the aux bank recalls, saves, labels and erases |

### Setup

| Feature | Web RCS | openrcs |
|---|---|---|
| Preconfig: outputs → screens, canvas | Yes — system, screens / aux, canvas, background, audio, quick preset | **Full** — template, layer resources (off / seamless / split and their screen), every output’s role and destination, screens and auxiliaries in service, background layer type — from the device’s validity lists — computed and shown against the applied state, applied behind a second tap; each screen’s canvas as a grid of outputs or free placement; background sets, audio and the quick preset on their own pages |
| Output setup | Yes | **Full** — role, format from the device’s allowed list applied through its update trigger, plug state, test pattern, picture and gains, area of interest and pitch, HDR and colorimetry, the plug’s HDCP policy, pixel encoding, embedded audio and SDI level, the connected display’s EDID |
| Midra video out (the second output) | — | — |
| Area of interest (output crop) | Yes | **Full** — the whole format or a custom area in thousandths with overscan, applied with the device’s trigger and read back from its canvas status; pitch compensation beside it |
| Custom output formats | Yes | **Full** — sixteen slots named and erased, an editor that takes a size and rate (CVT) or every porch and sync (full), checks it on the device and saves it into a slot; the erase is written but the simulator keeps the slot |
| Input setup | Yes — plug, LUT allocation, signal, correction, aspect, keying | **Full** — active plug, label, signal type and HDCP from the device’s lists, HDR mode and nits, picture, sharpness and pulldown, aspect (signal / shown as / in a layer), predefined or typed crop applied with the device’s trigger, crop finder, keyer, EDID; no LUT allocation |
| EDID | Yes — same | **Full** — the EDID each input plug presents, decoded (make, name, preferred timing, extensions), replaced from the device’s library of 21 factory and 64 saved EDIDs; a connected display’s EDID saved into that library from the Outputs page; no byte editor |
| Stills / image library | Yes — library, background and foreground image slots | **Partial** — the 50-slot library with names and sizes, erase, a capture of any input/output/multiviewer into it (written, unproven on the simulator), and each screen's frame slots with pictures; no upload from the computer |
| Multiviewer / monitoring | Yes — one multiviewer, audio monitoring, 20 memories | **Full** — drag/resize designer over the usable widgets on the MTVW output, sources from the device's own list, OSD, grid presets, twenty layout memories with recall/save/erase/label; no audio monitoring |
| Soft edge blending | Yes — Eikos 4K blend mode | **Partial** — the blend on each gap of a grid canvas — enable, gamma or Bézier curve, black level — applied with the device’s soft-edge trigger; written on the Pulse simulator, which has no blend to show (Eikos 4K only) |
| Audio | Yes — routing, Dante, VU meters, custom sources | **Full** — the audio layer per preset buffer, every routing point (screens, auxiliaries, outputs, multiviewer, line outs, Dante groups) following a layer, its content, a screen or a widget or routed direct, mutes, the ten custom sources channel by channel, level readings, the clock, the quick preset’s audio; Dante subscriptions are read, not made |
| GPIO and tally | Yes — TSL tally protocol; no GPIO | **Partial** — the device's own on-air lists per input are read and shown; never seen populated on the simulator, so unverified |
| System, network, health, front panel | Yes | **Full** — identity, network, temperature sensors and fans with alarms, front-panel lock and brightness, reboot; no erase or factory reset |
| Firmware update | Yes | **Missing** |
| Backup / restore | Yes — configuration slots, export / import, USB | **Partial** — the two on-device configuration slots: back up every module into one under a label, restore (unpack then apply, the device reboots) or erase behind a second tap; export to a file and import from USB are not offered — restore never fired on the simulator |
| Multi-unit link | — | — |
| LUTs, HDR, colour processing | Yes — LUT libraries, LUT allocation, HDR conversion | **Partial** — HDR mode and nits per input plug and output; the conversion and correction LUT libraries named, erased and allocated to inputs; a conversion and a correction LUT picked per plug and per output from what the device offers; no .cube import — the Web RCS uploads the file |
| AVoIP and streaming | Yes — Dante (optional card); RTMP streaming out to a network or a platform | **Partial** — RTMP: ten destinations with label, URL and key, the picture source, profile and quality, the audio and its pair, start and stop with the device’s status — the simulator never starts a stream; Dante is shown, not configured |

### Diagnostics and beyond

| Feature | Web RCS | openrcs |
|---|---|---|
| Every device variable, raw protocol | No | **Full** — Inspector: every property read so far, get/set any AWJ path as JSON, and the wire log |
| Verified writes | No | **Partial** — every write reads its target back; recalls read the destination twice because the bookkeeping lands late; a master save is refused rather than allowed to overwrite bank slots |
| Control-surface module | Yes — AMX / Crestron drivers, REST API, RC400T | **Missing** — not in the openrcs module |

## PLS300 — against the RCS

*Pulse PLS300.*

### Access & deployment

| Feature | RCS | openrcs |
|---|---|---|
| Control path | Yes — RCS desktop app (Windows only) over LAN or RS-232; LAN is off until enabled on the front panel | **Partial** — openrcs-server + browser; the 222-variable table from the published Programmer's Guide, driven only against a table-derived fixture — no PLS300 has answered yet |
| Works without a discontinued runtime | No — a Windows-only RCS from the 2009–12 support site, gone from the current one | **Beyond stock** — one binary or the tray app, any current browser |
| Login, HTTPS, session lock | No — none | **Missing** — none; loopback listen is the default |
| Offline planning / simulator | No — none in the RCS; the Axion2 controller had an offline mode | **Beyond stock** — Plan mode stages a look with no device and pushes it on connect; browser demo against a fixture derived from the table |
| Touch / front-of-house surface | No — none | **Partial** — Live’s TAKE, preset tiles and freeze buttons; no big-button Show page for this family |
| Appliance use (no keyboard, no shell) | No — type the IP in a desktop app | **Beyond stock** — Connection view (keypad or network scan, remembered) and an opt-in Tailnet view; a scan tells a PLS300 from a Midra by its DEV code |

### Live operation

| Feature | RCS | openrcs |
|---|---|---|
| Take and Cut, per screen and all | Yes — TAKE and Stepback buttons, virtual T-bar | **Partial** — TAKE on the one screen; the unit has no cut verb — each layer runs its own opening and closing effect |
| T-bar | Yes — virtual T-bar in the RCS | **Full** — NT, the unit’s 0.01 % T-bar, with its enable switch |
| Step back | Yes — Stepback button | **Full** — the previous look copied to next and taken |
| Preset toggle, auto-take, dynamic fit | Yes — Control menu: auto-take, preset toggle | **Full** — auto-take and preset toggle on Live; the unit has no dynamic fit |
| Fade to black / master fade | Yes — [BLACK] clears a layer; output black in the Output menu | **Full** — output black for main and preview on Live; a layer goes black by clearing its source |
| Freeze | Yes — Freeze button; freeze mode by input or all inputs | **Full** — per-input freeze and the all-inputs mode, on Live and Inputs |
| Screen groups / destinations | — — one screen | — |
| Sequencer / cue list | No — none in the RCS; the Axion2 controller had a sequence mode | **Missing** — Cues is built on the Midra/LiveCore memory verbs, not yet on the preset copy |
| User keys / macros / quick presets | Yes — the six quadravision layouts on the front panel | **Partial** — the six quick layouts and one-tap preset recalls on Live; no macro keys |
| Timers (clock, countdown, stopwatch) | — | — |
| Input backup / failover | Yes — Frame Alert: a backup input shown when a source drops | **Full** — the backup input (FRAME_ALERT) and the signal-less-input lock, on Inputs |
| Undo | Yes — Stepback | **Beyond stock** — Confidence in Shows: a cache-based undo ring, auto-snapshot before every take, revert through the show-restore path |

### Composition

| Feature | RCS | openrcs |
|---|---|---|
| Graphical layer editor | Yes — Image tab: a preview window with layer buttons, PIP size, position, zoom, border and transparency by value | **Full** — Layers: drag and resize on a to-scale canvas of the main output, for any of the seven presets |
| All screens editable at once | — — one screen | — |
| Layer properties | Yes — size, position, zoom, crop, border, transparency, opening and closing effects | **Full** — every PE_* leaf the guide lists: geometry, opacity, crop, border, both transitions with direction and duration, smooth move |
| Layout presets | Yes — six quadravision layouts | **Full** — the six quick layouts plus Full and quarter snaps |
| Snap, align, multi-select | No | **Partial** — snap presets; no multi-select or align |
| Native background / background sets | Yes — background frame layer; background colour per output | **Full** — the frame layer, and the output background colour |
| Input keying | Yes — luma and chroma key with DSK, colour grabber | **Full** — keying type, levels, tolerance, invert, DSK background and the grabber, per input |
| Cut & Fill | — | — |
| Perspective / 3D layers | — | — |
| Working-area constraint | No | **Missing** — the working area is a Midra/LiveCore surface feature; not on this family |
| Live thumbnails | No — none | **Missing** — none — the unit serves no HTTP |

### Memories

| Feature | RCS | openrcs |
|---|---|---|
| Screen memories | Yes — four user presets, saved from main or preview, loaded to preview | **Full** — the four presets and the previous look: recall, recall + take, save from current or next, inspect |
| Master memories | — — one screen | — |
| Layer memories | No | **Missing** — the browser layer bank is built on the Midra/LiveCore leaves |
| Recall filters (categories) | No — whole presets only | **Missing** |
| Labels, colours, inspect | No — numbered slots | **Beyond stock** — inspect what a slot holds, drawn to scale; the unit stores no labels |
| Autoscale on recall | — | — |
| Confidence screens and memories | — | — |
| Aux screens and aux memories | — | — |

### Setup

| Feature | RCS | openrcs |
|---|---|---|
| Preconfig: outputs → screens, canvas | Yes — mixer or matrix mode from the front panel | **Missing** — the mode has no variable in the guide’s table; the surface draws the mixer layout and says so |
| Output setup | Yes — analog / DVI type, format, rate, test patterns | **Full** — format, rate, analog and digital types, sync polarity, patterns, background colour, overscan, HDCP, frame lock |
| Midra video out (the second output) | — | — |
| Area of interest (output crop) | No | — |
| Custom output formats | Yes — eight custom computer formats | **Partial** — selectable as Custom 1–8; their timings are not in the guide’s table |
| Input setup | Yes — enable, type, autoset, picture, geometry, aspect | **Full** — enable, type, autoset, picture, geometry, phase, aspect, overscan, pulldown, crop, SD standard |
| EDID | Yes — EDID format and rate per plug | **Full** — preferred format and rate on the four plugs, written to the input |
| Stills / image library | Yes — six frames and six logos, recorded from an output | **Full** — Pictures: the twelve slots with their sizes; capture with region and keying; delete |
| Multiviewer / monitoring | — — a preview output, no multiviewer | — |
| Soft edge blending | — | — |
| Audio | Yes — main level, delay, mute; per-input level and balance | **Full** — both outputs’ volume, mute, stereo and delay; the auxiliary; per-input level, balance and audio map; SDI de-embed picks |
| GPIO and tally | — | — |
| System, network, health, front panel | Yes — Control menu: LAN, lock, brightness, standby | **Full** — identity, versions, fitted options, network (read only), lock, brightness, T-bar enable, standby and the display device on RS-232 |
| Firmware update | No — a separate updater application | — |
| Backup / restore | No — no device export in the manual | **Beyond stock** — Shows: the writable state to a JSON file, diff-based restore that writes only what differs |
| Multi-unit link | No — the Axion2, Orchestra and TRK-800 controllers drive several units | — |
| LUTs, HDR, colour processing | — | — |
| AVoIP and streaming | — | — |

### Diagnostics and beyond

| Feature | RCS | openrcs |
|---|---|---|
| Every device variable, raw protocol | No | **Beyond stock** — Inspector searches, reads and sets any of the 222 variables; Console shows the wire |
| Verified writes | No | **Partial** — the unit answers every accepted command with the parameters it changed, so the cache is the readback; nothing re-reads on top of that |
| Control-surface module | Yes — Crestron and AMX; the Bitfocus analogway-pls300 module (fire-and-forget, freezes the input after the one asked for) | **Missing** — companion-module-openrcs speaks the Midra/LiveCore verbs; no PLS300 actions yet |

---

Mnemonics in the cells (`PMcat`, `OSaup`, `GCsta`) name the device variable a view is built on, so a row can be checked against the [protocol reference](https://github.com/stoatworks-labs/openrcs-protocol). Not affiliated with or endorsed by Analog Way; product names are used only to describe compatibility.
