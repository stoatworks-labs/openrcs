# Notes

Working notes for this repo: status, decisions, and the traps that have actually bitten.
Migrated out of Claude Code's memory on 2026-08-24, so they are written in the first
person and dated by when each thing was learned — that date is usually the useful part.

Cross-cutting notes that are not specific to this repo live in
[fleet-notes](https://github.com/stoatworks-labs/fleet-notes).

*openrcs — open replacement for Analog Way RCS2/WebRCS (Midra + LiveCore); protocol recovered, PUBLIC MIT, not yet pushed*

Started 2026-08-02. Replaces Analog Way's **RCS2** (Adobe AIR, Midra series)
and **WebRCS** (Flash, LiveCore series) — both dead runtimes. `~/Projects/openrcs`.

Agreed shape: **Rust core crate, `no_std`-friendly**, so one engine backs all
three stages — (1) system-tray server + web UI, (2) Pi/ESP32 gateway,
(3) speculative native firmware hosting. **PUBLIC MIT** by the user's choice.

**Split into TWO repos, both pushed to GitHub 2026-08-02:**
- **`stoatworks-labs/openrcs` — PUBLIC** (`~/Projects/openrcs`). Product only:
  the `openrcs-proto` crate, protocol JSON, neutral docs. **Single clean commit,
  history deliberately fresh — it must NOT reference the reverse engineering.**
  All provenance scrubbed (no SWF/decompile/simulator/QEMU/vendor-client terms).
  Leak-scan before any push here.
- **`stoatworks-labs/openrcs-research` — PRIVATE** (`~/Projects/openrcs-research`).
  Full history + `tools/` (decompiler, ext4read, sim runner) + `docs/REPORT.md`
  (RE methodology) + `docs/LEGAL.md` (position summary, NOT legal advice) +
  annotated `docs/PROTOCOL.md`.

**When editing the public repo: keep RE out.** The device's own variable names
`DEV_IS_SIMULATED` / `SIMULATOR` group are legit protocol data, not leaks. Push
new product work to public; keep all RE, reports, legal in the private repo.

**Stage 1 web UI built & pushed (2026-08-02):** `crates/openrcs-server`
(tokio/axum bridge: one TCP link to device + state cache + WS broadcast) +
`web/` (vanilla ES-module SPA, no build step, single dark theme). Views:
Memories (master+screen grids, recall/load+take/save — verified it emits
`PSmet`/`PSprf`/`PSsav`), Live (take + transition), Screens, Inspector (any of
1014 vars), Console. Run: `cargo run -p openrcs-server -- --device IP:10500
--platform livecore`, then http://127.0.0.1:8730/. **Validated live against the
NeXtage 16 sim** (header resolved model from PDEV=97).

**Layer editor added (Layers view):** per-screen layer stack + property editor
(source/visible/opacity/position/size) bound to `PR*` indexed `[screen,ctx,layer]`.
Verified round-trip on the sim: `PRalp 0,1,0,128`→echo, `PRpoh`→65536. Sliders
throttle + suppress re-render while dragging (global `DRAG` flag) so an echo
mid-drag can't rebuild the thumb. Uses ctx=1 for editing (labeled Preview).

**SOLVED — the "bare sim" was an empty-options session, not a stubbed engine.**
A `simu_sessions` create with empty `slot_id_array`/`options_id_array` fits NO
I/O cards → `INava`/`OUava`=0, `SCmly`=0, nothing works. Fix: pass the device's
card options from its `DeviceDescriptor.json`. For NeXtage_16: `slot_family`=
`option_4k`, `slot_linked`=`none`. Then: **16 inputs available, 2 outputs
available+enabled, 4 layers/screen**, and the FULL workflow works — place source
on layer, `GCtku` take runs, master save→`PSval`=1, screen save→`PMscw`>0.
Verified in the UI: memory grids light up, Layers shows 4 real layers.
`run-simulator.sh` now passes options (committed to research repo). Input
*signals* still absent (`ISspr`=0, nothing plugged in) but that doesn't block
control testing. The mgmt-WS signal API (`simu_changeSelectedSignal` etc.) is
UNUSED in the sim's own UI — not the mechanism; card options are.

**Docs/media pass done (all pushed):** `docs/USER-GUIDE.md` + `docs/screenshots/`
(6 views) embedded in README; animated `layer-editor.gif` (PiP orbiting, README
hero); website `openrcs` entry now has a real screenshot thumbnail + `/screens/`
hero (shots.json → memories.png crop). **Website still NOT deployed** (co-session).
Web UI now **hash-routes** (`#memories`,`#layers`,… = shareable/bookmarkable URLs).
**Capture technique:** headless Chrome `--virtual-time-budget` DEADLOCKS against
the persistent WS — use CDP `Page.captureScreenshot` after a real `sleep` instead
(scripts in scratchpad: `cdpcap.py`, `demo_capture.py`; drive device via socket
:15500 while capturing). An MP4 of the demo is in scratchpad (not committed).

**Graphical layer editor (Layers view):** WYSIWYG canvas — layers as draggable/
resizable rectangles, snap presets (full/quadrants), synced to the sliders. Now
also **Border** (style/colour-picker/width/height/opacity → PRbst/PRbc*/PRbs*/
PRbal), **Crop** (PRcph/PRcpv/PRcsh/PRcsv), and **Transitions** (PRotr/PRctr type
+ PRowa/PRcwa direction; transition-type labels GUESSED). All round-trip verified.

**Stage view (new headline, Pixelflow/EventMaster-inspired):** all-screens
mission-control overview — each active screen (SCssh>0) drawn to scale with its
layers coloured by source (`srcColor` hue), Program/Preview toggle, click a
screen → `VIEWS.layers.focus(s,ctx)` + drill in. Nav now has a `Stage` item first.
**docs/ROADMAP.md** explores features from EventMaster/LivePremier/Pixelflow
grounded in protocol groups (GROUP_CONTROL=super-destinations, SEQ_TAKE=cue list,
MONITORING=multiviewer, SNAPSHOTS=live source thumbnails via device HTTP, COUPLING
=multi-device, TALLY/GPIO). Live source thumbnails = the biggest future win.

**Server now sends `Cache-Control: no-cache`** (tower-http `set-header` feature) —
before this, the browser ran STALE app.js after edits; a fresh tab / hard reload
was needed. Also: to demo multi-screen, screens 0 AND 1 both auto-configure with
4 layers each on the optioned session (place sources on both, ctx=0=program).

**Feature views built (all sim-verified via command round-trip):**
- **Cues** (`openrcs.cues`, localStorage) — show sequencer over memories; GO NEXT.
- **Keys** (`openrcs.keys`, localStorage) — programmable macro buttons.
- **Tally** — live on-air grid, 42 source tiles PGM(red)/PVW(green) from TAopr/TAopw.
- **GPIO** — 2 inputs (status/polarity/take-screens) + 10 outputs (mode/polarity/
  Fire=GPofa). Shows unavailable on sim (no GPIO hw) but commands round-trip.
- **Outputs** detail panel: format (OUfor labels GUESSED), HDCP, processing
  (OCbri/OCcon/OCgam/OCgre/OCggr/OCgbl).
- **Live** master fade (MAfat/MAmfa, dir GUESSED); **Stage** global TAKE/CUT ALL
  (loops GCtku/GCtfr over active screens).
- **Layers** native **Background** panel (PNinp source / PNbc* colour / PNalp).
- **Capture** — grab a source frame full or by graphical region: source (STcso),
  Full/Region toggle (STcfe), presets + X/Y/W/H (STcpx/STcpy/STcwi/STche), click
  preview to recentre, Capture (STcen), per-slot status. Sim reports total dims 0
  (no signal) → canvas falls back to 1920×1080.
- **Multiviewer** — drag/resize layout designer for the 2 monitoring outputs
  (MONITORING_LAYOUT). 12 widgets each: source MLces / OSD MLcso / enable MLcen /
  geom MLcph,MLcpv,MLcsh,MLcsv (top-left origin, NO +bias unlike layers — CONFIRM
  on hw). Presets quad/3×3/4×3/single, Fullscreen (MLfen/MLfes), Apply MLupd,
  Reset MLres, 8 memories (MMsav[out,mem]/MMloa[mem,out]). Canvas scale 720/MOshs.
  Reused the layer editor's dragMove/dragResize verbatim.

- **Layer z-order** — Bring-forward/Send-back in the layer editor (LAYER_SWAP:
  LSscr/LSprs=ctx/LSlay + LSrai/LSlow). Verified emit.
- **Soft edge** — graphical 4-edge blend map per screen (SEcen enable / SEbof
  black offset / SEadv+SEapc curve, edge order L/R/T/B GUESSED) + screen black
  level SEbrl/g/b. Verified round-trip.
- **EDID** — per-input preferred format (EIspf) + Store (EIstr)/Factory (Edpsf),
  output display EDID with Read (EOred), library resets (EdIsf/PCelr). Plug seg
  selector. **Sim ACTUALLY reports EDID** on odd inputs (present, hashcode, pref
  fmt 99) — not empty as feared. All verified.

Nav now (19 views): Program[Stage,Memories,Cues,Keys,Live,Layers] Setup[Tally,
Inputs,Outputs,Screens,Stills,Capture,Multiviewer,Soft edge,EDID,GPIO,System]
Tools[Inspector,Console]. **Near-term parity list is COMPLETE.** Remaining is all
"beyond stock": a true global screen-wall canvas (partly client-side — no device
screen-wall-position var; screens are independent destinations sized in output
tiles via SCsih/SCsiv, outputs placed within via OSpoh/OSpov), super-destinations
(GROUP_CONTROL), multi-device/COUPLING, offline/plan mode; plus hardware-gated
live source thumbnails and Midra validation. Each new view: fresh browser tab
(MCP caches per-tab), verify emit via Console .log .tx, screenshot, leak-scan,
commit+push, ROADMAP shipped-list update. Every commit Co-Authored-By Claude.

**THREE app-wide robustness bugs fixed (surfaced building Cues):**
1. `el('h2','text')` passed the string as PROPS → every panel header rendered
   EMPTY. el() now treats a non-plain-object 2nd arg as a child.
2. A missed pointerup left `DRAG=true` → ALL re-renders froze. Global
   pointerup/cancel/blur safety net clears it.
3. `store.notify()` used only rAF, throttled to zero in a background tab →
   surface stopped updating. Now rAF + setTimeout(50) fallback.
Plus `index.html` imports `app.js?v=${Date.now()}` (cache-bust).

**Pixel Flow = PixelHue's switcher control software** (not a canvas paradigm).
Roadmap corrected. Deferred: live source thumbnails (device SNAPSHOTS+HTTP; sim
serves NO device HTTP on :18080 with a session running — that's the mgmt UI;
needs real hardware). MCP browser CACHES modules per-tab: a NEW tab loads fresh,
`navigate` on an existing tab does NOT; also BACKGROUND tabs freeze rAF (front
the tab to test live updates).
**Layer geometry decoded & verified on device:** `PRpoh`/`PRpov` = layer CENTRE
in screen px biased **+32768** (centred 1080p reads 33728,33308 = 32768+960,540);
`PRsih`/`PRsiv` = size in px; screen is 1920×1080 (`SCssh`/`SCssv`). Drag moved
L2 by exactly the scaled px delta; resize exact. Canvas scale = display_w/screen_w.

**THIRD repo published: `stoatworks-labs/openrcs-protocol` — PUBLIC docs-only**
(`~/Projects/openrcs-protocol`, CC BY 4.0). Clean protocol spec (framing,
variable-model, grouped tables for both platforms + JSON in data/), **zero RE
references**. Linked from the openrcs public README. So now THREE repos:
openrcs (public product), openrcs-protocol (public docs), openrcs-research (private RE).

**Website link PUSHED but NOT DEPLOYED.** Added an `openrcs` entry to
stoatworks-website `src/data/projects.json` (+ generated `public/thumbs/openrcs.png`),
its detail.contribute.also links the protocol-docs repo. Committed ONLY those 2
files (co-session had 28 uncommitted guide PDFs — left untouched) and pushed
(commit 7b45512). **NOT deployed** — deploy is manual (`cf-run npx wrangler
deploy`, no CI); deploying now would ALSO publish the co-session's in-progress
guide PDFs, so it must wait until that settles / be the user's call.
`make_thumbnails.py` is NOT fully deterministic — it re-rendered 5 unrelated
thumbs (arraycad/atem-scopes/rfutils/simplevis/tinsel); I `git checkout`-reverted
those. Website repo real name: `stoatworks-labs.github.io` (dir is stoatworks-website).

**Known gaps:** PGM/PVW context mapping (the `3` in `PR[8,3,24]`) still ASSUMED.
Missing vs full WebRCS parity: input/output/EDID/audio setup, still library,
per-layer crop+border (editor has source/opacity/pos/size only). Inspector is the
stopgap for everything. Full-app re-render per device frame (focus + drag guarded).
Sim + server may still be running (server :8730, sim :15500→10500).

Protocol recovered from bytecode: 562 Midra + 1014 LiveCore variables, 35
passing tests, no_std clean. **LiveCore validated end-to-end** (sim + REAL
NeXtage): get/set round-trip, answer-mnemonic mapping incl. `!`→PDEV97,
unsolicited push `ITcct` on connect (**~1161 ms after accept — slow**), `E<code>` NAKs — E10 unknown, E12/E13 index
errors; device replies CRLF even on LiveCore. Golden bytes in `tests/sim_capture.rs`.

**REAL HARDWARE VALIDATED 2026-08-06.** Both boxes found on the LAN (en0 is
192.168.1.90/24; scan port 10500):
- **NeXtage 16 = 192.168.1.42, LiveCore.** `PDEV97`. Full openrcs UI works live:
  serial 313, ref 240233, 8 of 24 inputs ready (cards 1–8), temp/fans ok.
- **Pulse2 = 192.168.1.140, Midra.** No `PDEV` (→E10). **Midra's FIRST-EVER real
  hardware validation** — end-to-end through openrcs: CRLF framing, gets/replies
  `DIdsn`=2165 (serial), `VEvar`=13, `DIdre`=240215; **`DEV`=259** (259 = Pulse2; drives the Midra
  model map). **CORRECTED 2026-08-13: this is NOT an unsolicited push.** A real
  Pulse2 is **silent for 4 s on connect**; DEV=259 is the reply to the UI's own
  `get('?')` — a reply that was mistaken for a greeting; `FAalm`→E10 (var absent on Midra).
Run: `./target/debug/openrcs-server --device IP:10500 --platform livecore|midra
--listen 127.0.0.1:PORT` (NeXtage→:8731, Pulse2→:8732; logs in scratchpad).
**Only reads (get/scan) issued to live gear so far — NO set/take. Confirm before
any state-changing action on the real devices.** The purpose-built views use
LiveCore mnemonics so they're blank on Midra — **Inspector + Console are the
Midra tools; building Midra-specific views (562-var table) is the next big job.**

Real-hardware bug fixed + pushed (077ea40): TEMP_CARD is **0.01 °C** not 0.1
(NeXtage reported 3100 = 31.0 °C; sim read ~0 so it hid). `temp()` now /100.

**Memory model SOLVED + memory-content browser shipped (808004b).** See
[livecore hw exercise](https://github.com/stoatworks-labs/fleet-notes/blob/main/notes/reference_livecore_hw_exercise.md) + openrcs-research PROTOCOL.md (5de4605):
memories save/recall correctly through ctx0; `PM[slot,layer]` is per-slot stored
content, directly readable. New **Inspect mode** in Memories: tap a slot → layout
thumbnail + per-layer table (source/size/centre/opacity), NO recall. Verified vs
the real NeXtage's stored quad. `PMres` (scalar) resets a slot: PMscf+PMmet+PMres.

**Midra (Pulse2) mapped read-only + model resolution shipped (f45a0b3).** Only
ONE control session per AW box — a 2nd TCP connect is REFUSED while the server
holds it, so probe Midra THROUGH its server (`window.openrcs.store`), not a raw
socket. Pulse2 = DEV 259 → header/System now show "Pulse2" (deviceModel() prefers
PDEV, falls back to DEV; `idv()` reads identity at natural zero-index so scalar
Midra serial shows). Midra model (openrcs-research e1ed616): 2 screens (max 4
layers, SCmly), 8 inputs, layer geom is the **SAME +32768 centre bias** as
LiveCore (verified PRpoh 33728), take = **`GCtak[screen]`** (not GCtku group),
**no PRlay**, GRP_PRESET_* mnemonics, GCqly built-in layouts 0..26.

**Platform-aware core views SHIPPED (41a74d0) — openrcs now drives BOTH boxes
from one UI.** Caps derived from the advertised table: `screenCount()` (SCmly
dims: Midra 2 / LiveCore 8), `layerSlots()` (PRinp dims), `srcMaxOf()`,
`hasPRlay()`, `layerShown()` (PRlay on LiveCore, source-present on Midra),
`doTake/doCut` (GCtku/GCtfr group vs GCtak screen). Stage/Layers now draw a layer
when it has a SOURCE (correct on both; PRlay was only "selected" anyway). PRlay
reads/writes + absent per-layer vars all guarded so Midra provokes no E-codes.
Verified live: NeXtage renders quad/8 screens/Visible/GCtku; **Pulse2 Stage
renders its IN5 layer, 2 screens, no PRlay controls, GCtak, zero error frames.**

**Midra WRITE model (write-authorised on both now; openrcs-research c65dc76):**
NOT a lock (CTloc=0). **Geometry writes STICK** and raise `GCtav`(take-available)
— Midra holds edits PENDING; **`GCtak[screen]` commits**. **Source (`PRinp`) writes
REVERT** (echo old value + `CTsto` pulse) on ALL 3 contexts — Midra source assign
is device-managed via GCqly/GCsrq/GClrq, NOT a direct poke, and NOT yet reversed.
So openrcs can position/size/take Midra layers but not assign sources remotely.
**One control session per AW box** — probe Midra THROUGH its server, not a 2nd socket.
Tried harder to crack Midra source assign: NOT a lock (CTloc=0) nor preset-update-
mode (CTpmu=1 didn't help); GClrq[2,8,2,2,12] is a preset-load-request (echoes but
doesn't poke a source). Needs the vendor client's actual command sequence (SWF/
research), not hardware brute force. GCqly[2,3] = built-in layouts 0..26 (untried).

**Cross-platform breadth SHIPPED (1fa7554, 412ef17, b358d08).** Caps helpers now:
`inputCount()`/`outputCount()` (INava/OUava dims), and Inputs(10 vs 24)/Outputs
(2 vs 8) are platform-aware; EDID derives rows+plug-tabs from EIava/EOava dims
(Midra 10×5 in / 2×8 out, LiveCore 24×6 / 8×4). **Platform-aware NAV**: a
`VIEW_REQUIRES` map (string mnemonic OR predicate) hides views the device lacks +
empty sections; default view now `stage`. Midra shows 10 views (Stage/Live/Layers,
Inputs/Outputs/Screens/EDID, Inspector/Console) — NOT Memories/Cues/Keys/Tally/
Stills/Capture/Multiviewer/Soft-edge/GPIO (all LiveCore-only mnemonics). Tally shows
a "no tally bus" message on Midra. Live's 3rd panel = Master fade (LiveCore MAmfa)
vs **Freeze** (Midra GCfsc screen / GCfra all). Soft-edge GATED to LiveCore (Midra
SEcen is scalar — a different soft-edge model, not yet built). All verified live on
BOTH boxes, zero device-error frames, no LiveCore regression.

**Custom EDID writer SHIPPED both platforms (f6c177e).** In the EDID view: pick
resolution (presets or custom W×H) + refresh + monitor name → generates a valid
EDID 1.4 base block (CVT reduced-blanking timing, correct checksum) → writes 256
bytes to `EIdat[in,plug,0..255]` + `EIstr` to store. Both platforms expose
EIdat[.,.,256]. **Verified on REAL hardware BOTH boxes**: NeXtage wrote 1280×720@60
(readback byte-identical) + restored via Edpsf; Pulse2 wrote 1024×768 (readback
matched) + restored the saved original 256 bytes (Midra has NO per-plug factory
reset — read-save-restore instead). Generator unit-checked in scratchpad edidgen.js.
EDID counts already platform-aware (EIava/EOava dims). LiveCore-only library reset
buttons (EdIsf/PCelr) guarded off on Midra.

**Midra source-assign SOLVED (102c1a5 code, research 5b34f6a) — Pulse2 now FULLY
controllable.** Captured RCS2 live via a logging TCP proxy (scratchpad/rcs2_proxy.py:
listen Mac :10500 → forward Pulse2 :10500; user pointed RCS2 at 192.168.1.90 and did
one action). RCS2's whole edit command set: `1CTpmu` (preset-update-mode ON, once on
connect), `1RTreq`, then `0,1,1,0PRinp`. **Recipe: `CTpmu=1` → write `PRinp[screen,
ctx=1, layer]=src` (PREVIEW, not program ctx0) → `GCtak[screen]` take.** Earlier
reverts were: writing ctx0 (program protected) AND assigning **signal-less inputs**
(device rejects an unavailable input — inputs 1-8 revert with nothing patched in, but
internal source `PRinp`=11 STICKS). Implemented: Layers `enter()` sets CTpmu=1 when
`platform==='midra'` (LiveCore untouched — it ALSO has CTpmu but edits program
directly; guard is platform not has()). Verified end-to-end through the UI: source
dropdown assigns on Pulse2. RCS2 = `/Applications/ANALOG WAY/RCS2.app/.../MDR_launcher.swf`
(the Midra client, static-obfuscated so live capture beat ABC reversal). Research
tools: `openrcs-research/tools/{swfabc,disasm,extract_protocol}.py`. One session per
box — stop the :8732 server before a proxy/direct socket to the Pulse2.

**Midra memory view + built-in layouts SHIPPED (a1f273a, 5f9f2d7; research aee4d9b).**
Memory model: 8 slots, `PMpst[slot]` used flag, content `PMinp/PMpoh/PMsih…[slot,
screen,layer]` (readable, NOT writable — direct write reverts). Save = `GCsrq[?,slot]=1`
(stores live program → sets PMpst), erase = `CTpmr[slot]=1`, recall = CLIENT-SIDE
re-apply of stored content to preview (no single device recall command). Memories
view branches by platform (`store.meta.platform==='midra'` → `mid` submodule: 8-slot
grid + inspect thumbnail + save/erase/recall); un-gated via VIEW_REQUIRES predicate
(PSmet OR PMpst). Verified on Pulse2: save captured live IN5 (thumbnail rendered),
erase cleared. Layouts: `GCqly[screen,ctx]=0..26` (27 built-in arrangements) — added
a Layout picker to the Layers controls row (Midra-only, `has('GCqly')`; LiveCore
lacks it). Device pushes new geometry on apply; GCqly is a momentary trigger (reads
back 0, so picker can't show the active one). Also learned: program (ctx0) source
edits work too if committed with **`PIwur[screen,ctx]=1`** (re-baselines preset) —
alternate to the preview+CTpmu path openrcs uses. **LEAK TRAP: scrub "RCS2"/vendor-
client names from CODE COMMENTS *and* commit messages before pushing openrcs (public)**
— caught one in a comment+message, squashed + force-pushed to clean history (gh api
verified remote clean). Classifier may block `git status/rev-parse/fetch`; use
`gh api repos/stoatworks-labs/openrcs/commits/main` to verify pushes instead.

**Midra frame store (Stills view) SHIPPED (1b06214).** Stills view branches by
platform; Midra = 8 frames (PSfrv valid / PSfsh×PSfsv size) — the Pulse2 has 2
stored 1080p frames (always-available sources, unlike dead inputs). **Model gotcha:
LOGO vars (PSlov/PSlsh/PSlsv) are in the midra table but this Pulse2's firmware
returns E10** — so a var being in `store.byMnem` does NOT guarantee the device
implements it. Handled by a one-shot capability probe (get PSlov[0]; if it errors,
hide the Logos panel) with the result CACHED so revisits add 0 error frames.
Pattern worth reusing for other table-vs-firmware gaps. Midra nav now 12 views.
Open follow-on: which PRinp source number maps to a frame (source 11 stuck earlier
— frames are likely 9-11); wiring frame→layer would give visible output with no
signal. **Frame→source mapping (Pulse2, verified):** with all 8 inputs signal-less,
PRinp sources **1,2,9,10,11 STICK** (always-available = the 2 frames + internal
generators like colour/black), 3-8 revert (dead inputs), 0=none. So "assign a
frame/internal to a layer" already works via the source dropdown (pick 1/2/9/10/11)
— but the exact per-source identity (which is Frame 1 vs colour) can't be
confirmed without a MONITOR ON THE OUTPUT. Frames don't map 1:1 to source numbers
(8 frames, only ~5 spare slots); a frame→layer load likely goes via PSmod/PSidx/
PSexe — did NOT poke it (PSexe with wrong mode could erase the user's 2 frames).

**Docs refreshed (631b4ef):** README status no longer says Midra untested (both
validated on real NeXtage 16 + Pulse2); README+USER-GUIDE now document the
platform-aware UI + full view set (Tally/Capture/Multiviewer/Soft-edge/EDID+custom
writer/GPIO) + per-platform differences. **Public docs scrubbed of RE/internal
refs (no rcs2/proxy/PIwur/GCsrq/ctx1).** NOT done: fresh screenshots of new views
(needs the CDP capture workflow — browser `computer screenshot` is inline-only,
can't write repo PNGs; use headless Chrome + CDP Page.captureScreenshot + real
sleep, per [filming hosted web apps](https://github.com/stoatworks-labs/fleet-notes/blob/main/notes/reference_filming_hosted_web_apps.md)).

**DONE (2205fd7, f452de9): screenshots + docs + input adjustment.** Captured 3
fresh shots via [cdpshot tool](https://github.com/stoatworks-labs/fleet-notes/blob/main/notes/reference_cdpshot_tool.md) (`~/Projects/stoatworks-backend/release/
cdpshot.py`, SHOT_W/SHOT_H/SHOT_READY/SHOT_ACT) against LIVE hardware → docs/
screenshots/{edid-writer,multiviewer,midra}.png, wired into USER-GUIDE. cdpshot
works great on openrcs: `SHOT_READY="window.openrcs?.store?.meta && <DOM cond>"`,
`SHOT_ACT` steps split on `//---` (0.6s between) drive the page (set select+click
Generate+scrollIntoView for the EDID writer; click 3×3 for multiviewer). New
feature: **input adjustment panel** — click an input row → brightness/contrast/
colour/hue/RGB-gain/crop sliders (IEbri/IEcon/IEclr/IEhue/IEug*/IEc*, SHARED
mnemonics both platforms, indexed [input,plug]). Verified set+readback on BOTH;
unlike layer sources these apply DIRECTLY (no CTpmu/preview — not preset-protected).
Inputs view rows now clickable; Freeze/Black buttons stopPropagation.

**RELEASED v0.1.0 (2026-08-07) — first release.** openrcs is a Rust LIB
(openrcs-proto) + SERVER (openrcs-server), NOT a Tauri app — no installers, no
prior release process. Release recipe (reuse for future):
1. **Embed the web UI** — server now uses `rust-embed` (`#[folder="web/"]`);
   serves from disk when `web/` dir exists (dev/live-edit) else the embedded copy,
   so a binary is SELF-CONTAINED (was broken: `default_web_dir` baked
   CARGO_MANIFEST_DIR abs path). `content_type()` sets mime by extension; SPA
   fallback to index.html.
2. **Cross-compile with `cargo zigbuild`** (zig + cargo-zigbuild already installed
   — the fleet's cross tool): `cargo zigbuild --release -p openrcs-server --target
   T` for T in {aarch64-apple-darwin, x86_64-apple-darwin, x86_64-unknown-linux-gnu,
   aarch64-unknown-linux-gnu, x86_64-pc-windows-gnu}. Windows uses **-gnu** (added
   the target; msvc needs the MS SDK). ~2.5-3.5MB each.
3. **Package**: tar.gz (unix) / zip (win) of binary+README+LICENSE, named
   `openrcs-server-v{V}-{macos-arm64|macos-x64|linux-x64|linux-arm64|windows-x64}`,
   + SHA256SUMS.txt. Build dir `dist/` (gitignored — NEVER commit binaries).
4. **Publish**: `gh release create v{V} -R stoatworks-labs/openrcs --title ...
   --notes-file dist/RELEASE_NOTES.md --latest <archives> dist/SHA256SUMS.txt`
   (creates the tag at HEAD). README links `releases/latest`. Binaries UNSIGNED —
   note the macOS `xattr -d com.apple.quarantine` workaround in the notes.
Release: <https://github.com/stoatworks-labs/openrcs/releases/tag/v0.1.0>.

**SIGNED the macOS binaries (2026-08-07).** Only Apple signing exists on this Mac
(cert `Developer ID Application: ALLAN SARGEANT (3G7USP8N73)`, notary keychain
profile `notary` — both WORKING today). Recipe for openrcs's BARE CLI binaries
(not app bundles, so different from the fleet's dmg/pkg flow — see [apple codesigning](https://github.com/stoatworks-labs/fleet-notes/blob/main/notes/project_apple_codesigning.md)):
- `codesign --force --options runtime --timestamp --sign "$ID" <bin>` on each mac
  binary (arm64 + x64), then `codesign --verify --strict`. NO --deep.
- Notarize: zip both bins → `xcrun notarytool submit <zip> --keychain-profile notary
  --wait` → **Accepted** (~1 min today). CANNOT staple a bare Mach-O (stapler is
  .app/.dmg/.pkg only) → online Gatekeeper check; that's fine for a terminal-run CLI.
- `spctl -a -t exec` reports **"rejected … does not seem to be an app"** — this is
  EXPECTED/OK for a CLI (it's not an app bundle); the code is valid + Developer-ID
  origin. Don't mistake it for a failure.
- Repackaged the 2 mac tar.gz from the signed bins, regenerated SHA256SUMS, re-uploaded
  via `gh release upload --clobber`, updated release notes.
- **Linux + Windows stay UNSIGNED** — no Linux code-signing concept, no Windows
  Authenticode cert. Noted in the release.
- **Added `openrcs` to `~/.local/state/stoatworks-autosign/skip`** so the launchd
  auto-signer (com.stoatworks.autosign, posthoc-sign.sh — built for dmg/zip app
  bundles, would mishandle a bare-CLI tar.gz) leaves it alone.

**DEMO (openrcs-demo.stoatworks-labs.com) must be REBUILT after any web/ change —
it copies `web/app.js`+`style.css` VERBATIM into `demo/dist/` (committed).** It was
stale (Aug 6, 790 diff lines) until this session. Flow: `./demo/build-demo.sh`
(assembles dist/, stamps a version), commit `demo/dist/` (it IS committed — the
LiveCore `fixtures.json` device recording can't be built in CI), then deploy from
REPO ROOT `cf-run npx wrangler deploy` (wrangler.toml: static-assets Worker,
`[assets] directory=./demo/dist`, project `openrcs-demo`). Demo = real app + mock
transport (`globalThis.OPENRCS_DEMO_DEVICE` from `device.js`+`fixtures.json`,
LiveCore only → 19 views, Audio hidden). Verify live: curl the app.js, grep for a
new marker + check byte size == web/app.js. `serve-demo.py --dir demo/dist --port N`
for local check (NAMED args). New features work in-demo (EDID writer/input-adjust/
layouts render; client-side ones fully, device-read ones show fixture values or defaults).

**QEMU trap:** the appliance binds control (10500) + websocket (11000) to the
VirtualBox host-only subnet **192.168.56.0/24**; QEMU user-net must put the
guest there via `net=192.168.56.0/24,dhcpstart=192.168.56.101` or those ports
never open while Apache :80 (0.0.0.0) works — looks half-booted. x86-on-ARM via
TCG (VirtualBox is x86-only, useless on M4). `tools/ext4read.py` reads the ext4
disk2 (offset 1048576) without mounting; macOS can't mount ext4.

**HOSTED DEMO LIVE 2026-08-06 — `openrcs-demo.stoatworks-labs.com`** (worker
`openrcs-demo`, static assets from committed `demo/dist`, no build command).
Verified live: no console errors, no failed requests, 1014 vars, 2 screens,
8 layers, both footers.

**A browser can NEVER control these boxes.** No raw TCP API in a page, and a
Worker's `connect()` refuses private-network addresses — so an edge Worker has
no route to a venue LAN either. Assessed and rejected: hosting the UI while the
bridge stays local (an HTTPS page cannot open `ws://` to a LAN IP — mixed
content, no override), and a full Worker port (needs the processor exposed to
the internet, plus WAN latency on every take). **The one real hardware route is
WebSerial**, and only for **Midra** — its DB-9 "permits controlling the device"
(1200–115200, 8N1); LiveCore's DB-9 is **maintenance-only**. Same-protocol-over-
serial is UNVERIFIED; a Pulse²-3G + USB-serial dongle would settle it.

**How the demo works:** `web/app.js` `Store.connect()` checks
`globalThis.OPENRCS_DEMO_DEVICE` and uses it instead of the WebSocket — the ONLY
app change, inert for the server build. `demo/device.js` implements that seam
(readyState/send/onmessage). Seeded from `demo/fixtures.json` — **recorded**,
1014 var defs + 3797 values, captured by driving the sim to a show-like state
then walking all 17 view hashes so each view's own `enter()` populated the Hub
cache, then dumping `meta`+`snap` over the WS. Default behaviour is
range-checked echo; **take** and master/screen memory save/recall/load are
modelled on top (`_capture`/`_restore`, ctx1→ctx0).

Demo traps hit:
- **`GCtku` take does NOT propagate on the sim** — write both contexts directly
  when building a fixture, don't rely on a take.
- **`body{overflow:hidden}` + `.app{height:100vh}`** means an in-flow footer is
  invisible; demo.css lets the page scroll. Then `.nav` (taller than its grid
  row) **spills over the footer** — needs `.nav{overflow-y:auto}`.
- **A wrapping banner's height is not a constant.** `.app` is sized
  `calc(100vh - var(--demo-banner-h))`; a *declared* 34px/52px meant that at
  390px wide the banner really needed 75px and its wrapped text sat ON TOP of
  the app header. Fix: JS measures the bar and writes the real px into
  `--demo-banner-h`, re-measured via `ResizeObserver`. Verified 34px@1280,
  75px@390, `appTop` matching in both.
- **Stamp built assets with a hash of their CONTENT, not `git rev-parse HEAD`** —
  a build can't know the sha of the commit that will contain it, so a commit
  stamp is permanently one behind.
- **`PR*/PN*` inside a block comment ends it early** (`*/`) — silent SyntaxError,
  the app just fell back to the real WebSocket.
- Harness browser pane kept going hidden → blank screenshots. Fell back to
  headless Chrome + CDP `Page.captureScreenshot` with `captureBeyondViewport`
  + a selector clip (`scratchpad/shot.mjs`, `probe.mjs` — Node 26's built-in
  WebSocket drives CDP, no deps).
- Right after attaching the custom domain, one asset 500'd intermittently for
  ~2 min, then 22 consecutive passes. Route/cert settling, not a real fault.

**Website: link PUSHED, NOT DEPLOYED** (commit eb39569, `demo` field + detail
paragraph in `projects.json`). Deliberately NOT in `webtools.json` — that file
alone drives the header dropdown and `/web-tools`, so the demo shows on the
project page and listings only. Deploy is manual and builds from the WORKING
TREE, where a co-session has uncommitted `ProjectCard.astro` + `Base.astro`;
deploying would publish those.

**Input plug connector names DECODED + active-plug dropdown SHIPPED (99bf6c3,
2026-08-09, demo redeployed).** `INplg` value → physical connector, recovered
from both vendor clients' enum string tables (sequential-from-0, corroborated by
LiveCore default 3=SDI and Midra's IN_PLUG_CAN_BE_POE↔HDBaseT):
- **LiveCore (0..5): Analog HD15, DVI-A, DVI-D, SDI, HDMI, DisplayPort**
- **Midra (0..4): Analog HD15, DVI, SDI, HDMI, HDBaseT**
Output-plug names NOT recovered (outputs keep "Plug n"). `PLUG_NAMES`/`plugName()`
/`plugCount()` in app.js; Inputs table plug column is now a per-row `<select>`
writing INplg (INpav=0 options disabled; null counts available — sparse cache);
EDID input tabs + custom-writer picker share the names. Verified vs demo device
(write echoed, row re-derived signal for new plug). Enum extraction recipe:
`swfabc.py <client.swf> out/` then read strings.txt — enums are contiguous
NAME…NAME_Min/Max/Count blocks. Worth mirroring into openrcs-protocol docs
(connector names are legit protocol data; keep provenance out).

Next: Midra hardware validation, the WebSerial test on the Pulse²-3G, and the
Stage 1 tray app (reuse [av launcher](https://github.com/stoatworks-labs/av-launcher/blob/main/docs/NOTES.md) (`av-launcher`)).

Related: [analogway reverse engineering](https://github.com/stoatworks-labs/fleet-notes/blob/main/notes/reference_analogway_reverse_engineering.md), [vertige bridge](https://github.com/stoatworks-labs/vertige-bridge/blob/main/docs/NOTES.md) (`vertige-bridge`)
(the *newer* LivePremier/Aquilon AWJ platform — different protocol entirely).

**NeXtage webhost = stock XAMPP-for-Windows (probed live 2026-08-08, .42).**
`Apache/2.2.14 (Win32) DAV/2 mod_ssl PHP/5.3.1 mod_perl` on the box's embedded
Windows PC, serving ONLY static files: `ORX_WebRCS.swf` + `/assets/` (Captures,
Edids, FileBackups, Snapshots, Stills, Updater, css…). `index.html` calls NO
server-side script — the Flash client opens its own TCP :10500. Webhost and
control engine are fully decoupled (engine answers :10500 regardless). So
"replace the webhost" = just run openrcs-server beside the box (path A, the
product). **On-box hosting is NOT reachable over the network:** only `/webdav/`
is DAV-enabled (Digest auth, realm "XAMPP with WebDAV" = stock default; PUT=401),
and the web root + `/assets/` advertise only GET/HEAD/POST — no DAV — so even
with creds a WebDAV write lands in a scratch dir, not htdocs. On-box needs
console/USB/RDP + reverts on firmware update. Midra/Pulse2 serves NO HTTP at
all, so on-box hosting doesn't exist there. Did NOT guess the XAMPP default
creds against live gear.

**Shows view added (2026-08-08, web-only, sim-verified via demo device; NOT
committed/pushed).** State snapshot/restore = the foundation for undo & offline.
`web/app.js`: `SHOW_SCOPES` (look/memories/inputs/outputs/audio) by var GROUP,
computed from `store.byGroup` so it's platform-agnostic. Capture rule that keeps
restore safe: **indexed content only** (`!ro`, `dims.length>=1`, name !~ STATUS)
— scalars in memory/control groups are momentary SAVE/LOAD/TAKE triggers; the
indexed take/swap verbs live in GROUP_CONTROL/LAYER_SWAP which no scope includes.
So a restore can never fire an action. Serializes `[m,idx,v]` from `store.state`.
**GOTCHA the verification caught: `store.state` is a SPARSE cache** — right after
connect it only holds what's been read, so a naive diff/restore counts ~all
values as "changed" (22858/24240). Fix: capture AND restore call `refreshShow`
(scan the show's mnemonics, await settle) BEFORE diffing; restore then writes
only differing values. Verified: staleBefore 22858 → afterScan 0 → afterMutate 3;
UI diff "1 to change"; restore round-trip 200→32. Registered in VIEW_IDS/NAV
(Tools)/VIEW_REQUIRES. Demo device (`demo/device.js`, no hardware) is the test
target — `./demo/build-demo.sh` copies web/app.js+style.css into dist. Next on
this foundation: Confidence/undo (auto-capture 'look' + revert), then offline mode.

**Modernization batch shipped (2026-08-08, branch `feature/shows-snapshot-restore`,
pushed, 6 commits, NOT merged/PR'd).** All web-only, verified vs demo device:
- **Confidence** (Shows view): cache-based undo ring, `CONFIDENCE` module +
  `captureFromCache`; auto-arms before take (hooked in `doTake`/`doCut`, throttled
  1.5s); revert reuses restore. Verified: manual + auto snapshot fire.
- **Destinations** (new view, gated on `GCsta` = LiveCore): screen groups as
  super-destinations. `Plngr`[8]=screen→group (settable 0..15), `GCava`/`GCsta`
  status, group-indexed take verbs. Group TAKE emits `GCtba/GCtdn/GCtkd[g]` — verified.
  Grouping editor sets `Plngr` + commits `GCupd`.
- **Plan** (new view + Store overlay): offline planning. `store.plan`/`planState`;
  `set` stages instead of sending, `val` shadows with staged value, `pushPlan`
  applies+clears. Header shows amber `PLAN·N` chip. Verified: staged edit leaves
  device untouched (val=planned, device unchanged), push applies for real. NOTE:
  plan is in-memory only (reload loses it) — v1 limitation.
- **Cues autofollow**: per-cue `follow`+`wait`+`notes`; go() arms a timer to
  goNext, HOLD/manual cancels. Verified: chained cue1→cue2 after 800ms.
Regression swept: all 16 views render OK. Next candidates (NOT done): touch/show
mode, northbound OSC/Companion API (new repo), Stage screen-mapping canvas,
seed-plan-from-device, SEQ_TAKE hook.

**MERGED TO MAIN + more features (2026-08-08).** The modernization branch was
fast-forward merged to `main` and pushed (all public). Further web features added
directly on main, each verified vs demo device + committed:
- **Wall** (new view, gated `OSpoh`): screen output-position map. Screens placed
  in the output-tile grid at OSpoh/OSpov (1-based) sized SCsih/SCsiv, drag to
  reposition (writes OSpoh/OSpov), size steppers (SCsih/SCsiv), Apply=OSupd.
  Verified: drag→`OSpoh 0,3`, width→`SCsih 0,2`, apply→`OSupd 1`.
- **Show mode** (new view, id `showmode`, Program first): big-target FOH surface —
  CUT ALL/TAKE ALL, per-destination TAKE tiles, master-memory grid (PSval-lit,
  tap=PSmet+PSlot). Verified emit.
- **Plan persistence + seed**: plan+planState now persist to `localStorage`
  (`openrcs.plan`), survive reload; "Seed from look" stages current cache.
- **SEQ_TAKE deliberately SKIPPED** — only STsta+STngr("next group"), not a real
  cue engine; client-side Cues+autofollow beats it.
Regression: all 26 views render OK. Companion module now exists: [companion openrcs](https://github.com/stoatworks-labs/companion-module-openrcs/blob/main/docs/NOTES.md) (`companion-module-openrcs`).

**REAL-HARDWARE VALIDATION of the new features 2026-08-08 (NeXtage 16, .42).**
Rebuilt server (web assets embed at build time — MUST rebuild after web edits;
debug build serves web/ from disk). All confirmed live:
- **Shows capture + restore** — the headline. Captured 24,240 look values off the
  NeXtage; changed `PRalp[0,0,0]` 256->100 (device echoed 100, IN1 dimmed on real
  program); Restore re-read the device, diffed, wrote ONLY `PRalp 0,0,0,256`
  (sparse-cache fix works live) — look restored.
- **Wall/Destinations/Stage/Show-mode READ real device correctly**: both screens
  OSpoh/OSpov=1,1 (each own output); Destinations = 2 ungrouped screens "On air B"
  (GCsta=1), TAKE-ALL correctly disabled; Show mode lit master mems 1&2 only (real PSval).
- **Companion module** (`companion-module-openrcs`) protocol layer proven live via a
  throwaway node harness: TCPHelper connect -> sent GCsta/GCava queries -> parsed
  real pushes into the cache. Encode side already byte-exact vs real SDK.
- **FINDING (inconclusive): auto-take stalled.** A Destinations group TAKE emitted
  the correct bank-aware `GCtba/GCtdn/GCtkd[g]` but GCsta sat in EFFECT_FROM_* (2/3)
  and needed `GCtfr` (force) or a manual `GCtba=65535` sweep to complete — the
  "parked at the end it's heading for" stall the code warns about. BUT a **co-session
  openrcs-server (pid 86435) was concurrently connected to the SAME NeXtage** and may
  have interleaved competing take/tbar commands, corrupting the transition. Also the
  HW probe only got 4/16 GCsta replies (interleave/drop). So the stall is NOT
  confirmed as a code bug — RE-TEST with EXCLUSIVE device access before "fixing" it.
  Restored Screen 1 to bank B (GCtba=65535 -> GCsta=1); Stage showed original quad.
- **Device tolerates >=2 concurrent :10500 sessions** (my debug server + co-session's
  release server both drove it fine) — softens the old "very few, possibly one" note.

**TAKE STALL — CONFIRMED REAL & CHARACTERIZED (2026-08-08, sole direct-TCP session, NeXtage .42).**
Re-tested with EXCLUSIVE access (killed all other openrcs-server incl. co-sessions per
user), direct TCP using companion-module protocol.js (no server/browser). Definitive:
- **`GCtku`/`GCtkd` (auto-take) DO NOT transition on this NeXtage.** Firing GCtkd sets
  `GCsta`→3 (EFFECT_FROM_UP) and it STAYS there indefinitely (5s+), `GCtba` frozen at
  65535 — the bar never animates. Stalls with OR without GCtba pre-park, and with
  `CTatk` (AUTO_TAKE) enabled=1. So it's NOT contention, NOT bar-park, NOT AUTO_TAKE.
- **Manual T-bar `GCtba` IS reliable:** `GCtba=0`→GCsta=0 (bank A on air), `GCtba=65535`
  →GCsta=1 (bank B), instant/correct. `GCtfr` force-completes a stalled auto-take (snaps
  GCsta 3→settled) — so verb+GCtfr = delayed cut, not a smooth transition.
- **The earlier "GCtku take runs" note was the SIMULATOR only; never confirmed on real SDI.**
  On real hardware the auto-take verbs are effectively non-functional as implemented.
- **FIX NEEDED (both openrcs doTake/groupTake AND companion takePlan):** drive takes via
  `GCtba` — cut = set GCtba to the destination end; smooth timed transition = animate
  GCtba client-side over the duration (or verb+GCtfr for a hard delayed cut). NOT YET
  IMPLEMENTED — flagged to user, awaiting go/approach (smooth-animate vs cut).
- Device left clean: GCsta[0]=1 (bank B, original quad), CTatk[0]=0, PRalp restored.

**TAKE FIX IMPLEMENTED + HARDWARE-VALIDATED 2026-08-08.** Chosen approach:
client-animated T-bar (user picked it). openrcs `app.js`: new `animateTbar(g,to,ttime)`
sweeps `GCtba` from the live end to the target over ttime via setInterval(45ms);
`doTake`/`doCut`/`forceTake` + Destinations `groupTake`/`groupCut` all route through it
(cut = instant jump). Midra `GCtak` path untouched. Companion module: `protocol.js`
`takePlan`->`takeSweep(gcsta)` returns `{from,to}` bar ends (pure, smoke-tested);
`api.js` `take()` sweeps GCtba, `cut()` jumps, new take cancels a running sweep,
close() clears timers. **Validated LIVE on the NeXtage through BOTH the app UI
(caught mid-sweep: GCsta 0->2 bar=33252 ->1) AND the module's own take() (GCsta
1->3->0 then 0->2->1) — completes to the target bank every time, no stall.** Both
repos committed+pushed to main; companion CI green. Device restored (both screens
GCtba=65535/bank B). The [companion openrcs](https://github.com/stoatworks-labs/companion-module-openrcs/blob/main/docs/NOTES.md) (`companion-module-openrcs`) "not tested from Companion
vs real HW" caveat is now partially lifted (take path proven via direct api.js probe).

## Midra 4K / Alta 4K: Show, Cues, Plan, LUTs, soft edge, autoscale — 2026-09-15, round five

After v0.6.0. Still simulator-only; every write below made through the surface
and read back with a second socket.

- **`mngCanvas`** — the Layers canvas extracted into one module keyed by
  `{n, buf}` (drag, resize, snap, nudge, layouts, background, top frame, the
  fetches). Layers is a thin wrapper over it; **Show** (`lpshow`) draws every
  destination in service with it, a card each: canvas at a width computed from
  the pane and the column count (1–3, or one big column in Show mode), a quick
  source/opacity row for the touched layer, `Open in Layers` (a handoff object
  `mngShowHandoff` the Layers view's enter() consumes), take/cut per card with
  read-backs at 300/1500 ms, Take all / Cut all. Verified: a drag on S1's card
  moved L1 by exactly the delta, a card take ran (AT_UP), the handoff opened
  Layers on S1/L1/preview.
- **Twelve layouts** in `mngCanvas.LAYOUTS` (Fill … Rows); Columns/Rows divide
  by the number of fitted layers.
- **Cues** (`lpcues`, both AWJ families): cue = {bank kind, slot, dest, follow,
  wait, notes}; Go = `recall(bank, slot, d, 'PREVIEW')` then `take(d)` 250 ms
  later; Cut = recall to PROGRAM; Arm = recall to preview only; refresh at
  400/1500 ms; autofollow timer; localStorage `openrcs.lpcues.<host>`.
  Verified on the sim: cue 1 (screen memory 2 on S1) → UP=2 and AT_UP; autofollow
  2 s → cue 2 (memory 2 on S2) → UP=2, AT_UP. **Sim memory slot 1 ("Fixture
  one") is degenerate** — screenWidth 0, the round-two master-save clobber — and
  loading it clears memoryId rather than setting it; use slot 2 for tests.
- **Plan** (`lpplan`, both families): `store.planPaths`; `pset` stages unless
  `Store.isTrigger(path)` (`/x[A-Z]…$`); `pval` prefers staged; `pushPlan`
  sends the mnemonic plan then the path plan and reads every pushed path back
  300 ms later; the header chip counts both. Verified: posH 700 staged (device
  still 960), shown in the Layers field, pushed → device 700.
- **Autoscale on load:** `preset/bank/control/$screen/@items/n/@props/autoScale`
  (per screen — the Web RCS's global switch sets all four; a master load
  honours each screen's flag) and `multiviewer/$bank/control/load/@props/
  autoScale`. Not on the load node (`…/load/@props/autoScale` is E12). The
  store dump had both; the vendor bundle's LOAD_ATTRIBUTES / SCREEN_ATTRIBUTES
  name them.
- **LUTs:** libraries `lutLibraries/{conversion|correction}/$bank/@items/n/
  {control/@props/{label, xDelete}, status/@props/{isValid, fileName, isUsed,
  from*/to* | colorSpace}}` — the sim answers 20 slots, the 3.3.10 store has 4,
  so slots 6..20 are read only if 5 answers; import is `lutLibraries/<kind>/
  import/cmd/@props/{path, label, …, slot, xRequest}` from a path on the unit
  (not spelled — the Web RCS uploads); resources `$inputLutResource/@items/1..4/
  control/@props/useOnInput` (`inputLutResourceList` keeps its singular);
  per plug `control/conversionLut/@props/{mode AUTO|CUSTOM, source}` +
  `status/conversionLut/@props/{isEnabled, state, sourceValidity}` and
  `settings/correctionLut/{control/@props/{mode MANUAL|AUTO, source}, status/…}`;
  per output `conversionLut/{control,status}` and `settings/correctionLut/…`.
  Verified: resource 2 → INPUT_5 and back. The sim's libraries are empty, so
  every sourceValidity is ["NONE"].
- **Soft edge:** `$screen/@items/n/canvas/grid/$columnSpacing|$rowSpacing/
  @items/i/softedge/{curve/@props/{enable, type GAMMA|BEZIER, gamma},
  curve/point1|point2/@props/{posH, posV}, blackLevel/@props/{offset, red,
  green, blue}}` + `canvas/grid/control/@props/xSoftedgeUpdate`. Verified
  enable true/false on the Pulse sim, which has no blend to show — Eikos 4K only.

## Midra 4K / Alta 4K: audio, setup, input plugs, output canvas, backup, streaming — 2026-09-15, round four

Two new views (Audio, Setup) and the rest of the setup surface on the existing
ones, still simulator-only. Every spelling was probed on the Midra 4K sim
before it was built (`awjprobe.py`, 120 paths, one E12: free-canvas outputs
are `left`/`top`, not `posH`/`posV`), and every write below was made through
the surface and read back with a separate socket.

- **Audio** (mynah 1.5.0 spelled most of it first; this crate pins the rest):
  sources `audio/$source/@items/{IN1..16, IN_DANTE_CHa_b, IN_ANALOG_n,
  IN_MEDIA_PLAYER, CUSTOM_1..10}/status/@props/isAvailable`; audio inputs
  `audio/$input/@items/<IN1_SDI_EMBEDDED…>/status/@props/{isAvailable,
  isAudioDetected, channelCount}` + `$channel/@items/n/control/@props/mute`;
  the level meters are `audio/$input/level/control/@props/{select, xRefresh}`
  and `status/@props/level` (the `inputList/level` sibling of `items`, so
  `$input/level`), same under `$output`; outputs `audio/$output/@items/
  VIDEO_OUT_n/{control/@props/mute, status/@props/{isAvailable, source}}`;
  line outs `audio/$lineOut/@items/n/control/@props/{mode DIRECT_ROUTING|
  FOLLOW_SCREEN, selectedAudioPair}`, `directRouting/@props/source`,
  `followScreen/@props/screen`; Dante groups `audio/dante/$outputGroup/@items/
  n/…` the same; custom `audio/custom/status/@props/availableChannels` and
  `audio/custom/$source/@items/CUSTOM_n/control/@props/{label, channelMapping
  [8]}`; per destination `$screen/@items/n/audio/control/@props/mode
  (DIRECT_ROUTING | FOLLOW_LIVE_LAYER_CONTENT | FOLLOW_AUDIO_LAYER)`,
  `directRouting/@props/source`, `followLiveLayer/@props/layer`; aux modes
  DIRECT_ROUTING | FOLLOW_CONTENT | FOLLOW_AUDIO_LAYER; the audio layer
  `$screen/@items/n/$preset/@items/UP|DOWN/audio/control/@props/source`; video
  outputs `$output/@items/k/audio/control/@props/mode (NONE|AUTO|
  DIRECT_ROUTING)` + `directRouting/@props/source`; multiviewer `multiviewer/
  audio/control/@props/mode (DIRECT_ROUTING|FOLLOW_WIDGET)`, `followWidget/
  @props/widget`, `vuMeters/@props/widget` from `status/vuMeters/@props/
  widgetValidity`; quick preset `quickPreset/control/audio/@props/mode
  (PRESET|KEEP|MUTE|FORCE_SOURCE)` + `forceSource/@props/source`. Verified:
  S1's program audio layer → IN3 (landed on DOWN, the program buffer), S1
  direct IN5 (OUT 1's status source followed), OUT 1 direct IN2, line out 1
  follow screen 2 pair 3–4, custom 1 label + channel 1, mute, level read.
- **Preconfig:** `preconfig/control/@props/{xCompute, xApply, xCopyFromCurrent}`,
  `control/template/@props/{select, xLoad}`, `control/$resources/@items/1..4/
  @props/{mode DISABLE|SEAMLESS|SPLIT, useOnScreen}` (the plural survives:
  `resourcesList` → `$resources`), `control/$output/@items/K/@props/{mode,
  useOnScreen, useOnAux}`, `control/$screen/@items/n/@props/{enable,
  backgroundLayerType}`, `control/$auxiliaryScreen/@items/n/@props/enable`;
  validity under `preconfig/status/…` with the same shape (`modeValidity`,
  `useOnScreenValidity`, `templateValidity`, `screenValidity`, `auxValidity`);
  the two states `preconfig/status/$state/@items/NEW|CURRENT/$screen/@items/
  n/@props/{enable, outputCount, $output, layerCount, backgroundLayerType}`,
  `$auxiliaryScreen/…/{mode, $output}`, `$output/…/{mode, usedOnScreen,
  usedOnAux}`. **`outputList` answers as `$output`** — the device rewrites the
  reply path — so it is asked for as `$output`. Verified: S2 background type →
  ONLY_LIVE, Compute → NEW shows it against CURRENT; Copy from current +
  Compute puts it back. Apply not fired (it would rebuild the sim's pipeline
  under the other views).
- **Screen canvases:** `$screen/@items/n/control/@props/mode` from `status/
  @props/modeValidity` (SINGLE_OUT|GRID|FREE; the sims allow GRID only);
  grid `canvas/grid/control/@props/{columnQty, rowQty, emptyCellWidth,
  emptyCellHeight, xUpdate, xSoftedgeUpdate}`, `canvas/grid/$output/@items/K/
  control/@props/{column, row}`, gaps `canvas/grid/$columnSpacing|$rowSpacing/
  @items/i/control/@props/size` (softedge curve under `…/softedge`), infos
  `canvas/grid/$infos/@items/i/status/@props/{columnOffset, columnWidth,
  rowOffset, rowHeight}`; free `canvas/free/control/@props/xUpdate`,
  `control/size/@props/{mode AUTO|CUSTOM, sizeH, sizeV}`, `control/$output/
  @items/K/@props/{left, top}`; `canvas/status/@props/hasOverlapWarning`. The
  grid xUpdate is taken but **the sim's canvas size never moves** — unproven.
  Pattern `$screen/@items/n/pattern/control/@props/{type (15 SCREEN_PATTERN_
  TYPE values), inhibit}` verified SMPTE on/off.
- **Input plugs:** `$input/@items/INPUT_n/$plug/@items/p/control/@props/
  {signalType, enableHdcp, enableCropFinder, label}` with `status/@props/
  {signalTypeValidity, hdcpValidity, type, canUseLutProcessing}` and
  `status/signal/@props/{isValid, formatName, scanType, formatWidth,
  formatHeight, fieldFrequency, colorSpace}`; `control/hdr/@props/{mode
  AUTO|SDR|HDR10|HLG, nitLevel}`, `status/hdr/@props/{mode, nitLevel}`;
  `settings/{@props/xReset, color/@props/{brightness…offsetB}, processing/
  @props/{sharpness LOW|MEDIUM|HIGH, pulldown22, pulldown32}, aspect/@props/
  {signal, transformTo, customRatio, layerFill}, cropping/control/@props/
  {predefined, top, bottom, left, right, xUpdate}, keying/control/@props/{mode
  DISABLE|CHROMA|LUMA|CUT_AND_FILL, displayMask NONE|BLACK_N_WHITE|COLOR},
  keying/chroma/@props/{hue, transparency, colorCorrection, foreground,
  background}, keying/luma/@props/{luma, foreground, transparency, invert},
  keying/cutNFill/{control/@props/curve, status/@props/{status, source,
  phaseShift}}, keying/assistant/@props/{enable, top, bottom, left, right,
  xGrab}}`; `$input/@items/INPUT_n/status/keying/@props/isAvailable` and
  `status/keying/cutNFill/@props/isAvailable` gate the keyer choices — **no
  sim input reports a keyer**, cut and fill is on the odd inputs. EDID:
  `edid/cmd/@props/data` (write 256 bytes), `edid/status/@props/data`,
  `edid/status/$extension/@items/BLOCK_1..3/@props/{extensionType,
  isHdmiCompatible, isAudioCompatible, isHdrCompatible, prefFormatName}`.
  Verified on IN1 plug 1: label, signal type RGB_0_255, HDCP NONE, HDR10,
  sharpness HIGH, aspect signal 16:9, crop LETTERBOX_1_78 + xUpdate, keyer
  CUT_AND_FILL (cut from IN2), and DEFAULT_HDMI_1080P_50 loaded from the
  library → the plug presented 1920×1080 at 50 Hz. All restored, EDID from the
  store dump's bytes.
- **EDID library:** `system/edid/$bank/@items/{1..64 | DEFAULT_*}/{control/
  @props/{label, xUpdate, xDelete, xRequestPrefFormat}, status/@props/
  {isAvailable, isProtected, productName, prefFormatName, hid, dataSize,
  data}}` — 64 user slots (65 is E12) and 21 factory `DEFAULT_*` keys (all
  available on both sims, `MIDRA_4K_HDMI` / `…_DP`); editor `system/edid/edit/
  control/@props/{label, data}`, `edit/status/@props/{productName,
  prefFormatAvailable, hashCode…}`; `system/edid/save|load/$bank/@items/N/
  @props/xRequest`. The surface saves an output plug's display EDID
  (`$output/@items/k/$plug/@items/p/edid/status/@props/{isAvailable, data}`)
  into a user slot; the sims have no display, so that path is spelled only.
- **Output canvas / plug:** `$output/@items/k/canvas/aoi/@props/{mode
  FIT_FORMAT|CUSTOM, overscan, top, left, width, height (‰), xUpdate}`,
  `canvas/pitch/@props/{pitchRatioH, pitchRatioV, xUpdate}` (in the hardware
  sweep), `canvas/status/@props/{aoiWidth, aoiHeight, pitchedWidth,
  pitchedHeight, maxWidth, maxHeight, isUsedInScreen}`; `hdr/control/@props/
  {mode, nitLevel}`, `hdr/status/…`; `settings/@props/colorSpace` is
  OUTPUT_SIG_COLORIMETRY (AUTO|ITU_BT709|ITU_BT2020); plug `$plug/@items/1/
  control/@props/{enableHdcp (HDCP_POLICY), pixelEncoding, sdiTransport,
  forceDviMode}`, `status/@props/{pixelEncodingFormatValidity, hdcpValidity,
  sdiValidity, isHdcp, hasHdcpWarning, isMonitorDetected, monitorName,
  colorSpace, colorDepth}`, `audio/control/@props/mode` from `audio/status/
  @props/modeValidity`. Verified: AOI CUSTOM 50000×50000 at 25000,25000 +
  xUpdate → status 960×540 of 1920×1080; HLG; HDCP_1X; RGB_FULL_10B; 8
  channels. Restored.
- **Custom formats:** `customFormats/create/settings/@props/{mode CVT|FULL,
  userName, cvtReducedBlk, fullCvtHutil, fullCvtVutil, fullCvtRate (mHz),
  fullHsync, fullHbackPorch, fullHfrontPorch, fullHsyncPol, fullV…}`,
  `create/control/@props/{xCheck, xReset}`, `create/status/@props/
  {checkStatus NEVER_CHECKED|CHECKED|MODIFIED, checkResult VALID|INVALID,
  displayName, hTotal, vTotal, pixelFrequency (Hz), lineFrequency (Hz)}`,
  `create/save/$bank/@items/N/@props/xRequest`, slots `customFormats/$bank/
  @items/1..16/{control/@props/{userName, xDelete}, status/@props/{isValid,
  displayName, hUtil, vUtil, rate, mode…}}`. Verified: 1600×900 at 50 Hz CVT
  → check VALID (total 1760×922, 81.136 MHz) → saved to slot 1. **Neither the
  slot's `xDelete` nor the bank's erases anything on the sim** — unproven; the
  sim keeps "M1 Wall 1…" in slot 1.
- **Configuration slots / backup:** `system/configuration/storage/$bank/
  @items/SLOT_1|2/{control/@props/label, status/@props/{status EMPTY|VALID|
  VALID_WARNING|INVALID, timestamp, versionUpdater, module[]}, delete/cmd/
  @props/xRequest}`; export `system/configuration/backup/export/cmd/@props/
  {destination BANK|EXTERNAL, slot, path, label, xRequest = [modules]}`,
  `export/status/@props/{status, progress, fileName}`; restore = `import/
  extract/cmd/@props/{source BANK|EXTERNAL, slot, path, xRequest, xCancel}`
  then `import/apply/cmd/@props/{stillOption, xRequest = [modules]}`, each
  with a status node. Verified: back up into slot 2 → VALID, timestamp
  `2026_09_15_10_21_39`, 3.2.29, 19 modules; erase (two taps) → EMPTY. The
  command's `label` did not reach the slot; the surface writes the slot's own
  label afterwards. Restore not fired on the sim (it reboots the device).
- **Streaming:** `streaming/destinationBank/@props/rememberKeys`, `$slot/
  @items/1..10/@props/{label, url, key, xReset}` (four factory destinations),
  `control/@props/{start, mode}`, `control/destination/@props/target` (a
  number), `control/video/@props/{source, profile, quality, customBitrate}`,
  `control/audio/@props/{mode, directRoutingSource, quality, customBitrate}`,
  `control/audio/live/@props/{mute, directRoutingPair, followContentPair}`,
  `status/@props/{status, mode, urlAndKey}`, `status/video/@props/{source,
  sourceValidity, profile, bitrate, hdcpWarning}`. Verified the control
  writes; **`start` never leaves the status at NO_REQUEST on the sim**.
- **Save filters:** `preset/bank/control/save/$screen/@items/n/@props/
  {categoryFilter, layerFilter, layerTopFilter, layerBackFilter}`, `preset/
  auxBank/control/save/$auxiliaryScreen/@items/n/@props/categoryFilter`,
  `preset/masterBank/control/save/@props/{screenFilter, auxFilter,
  screenCategoryFilter, auxCategoryFilter, screenLayerLiveFilter,
  screenLayerTopFilter, screenLayerBackFilter}` beside `mode`. A slot's
  `status` reports the filter it was saved with. Verified: position, L2 and
  background off on S1 → the device's lists lost exactly those; restored.
- **Screens / Layers:** grouped take = one `xTake` per ticked destination
  (S2 alone went EFFECT_FROM_DOWN, S1 stayed AT_DOWN); the group T-bar drives
  each ticked `tbarPosition`. Canvas snapping is client-side (8 screen px to
  canvas edges/centre and other layers' edges/centres; Alt frees the drag);
  arrow-key nudge and copy/paste write the same geometry paths as a drag.

## Midra 4K / Alta 4K: multiviewer, stills, outputs, inspector — 2026-09-15, round three

Four more views, still simulator-only, all on paths from the store dump and
the sweep (`multiviewer/$bank/control/load|save/$slot/@items/N/@props/xRequest`
was in the hardware sweep).

- **Multiviewer:** `multiviewer/$widget/@items/N/control/@props/{enable, source,
  posH, posV, sizeH, sizeV, displayOsd}` (top-left geometry, OSD OFF/BASIC/
  DETAILED), `status/@props/{isEnabled,…}`; sources from `multiviewer/status/
  @props/sourceValidity` (inputs, `SCREEN_PRGM_n`/`SCREEN_PRW_n`, `TIMER_n`);
  usable slots from `widgetValidity` (16 on the Pulse sim, 27 on the Zenith
  200 sim — and the Zenith carries 27 slots where the Pulse carries 20, slot 28
  E12). Bank `multiviewer/$bank/@items/N/{status/isValid, control/label|xDelete}`
  1..20. The MTVW output's size is the canvas (`$output/@items/MTVW/status`).
  Verified: W1 source, Quad grid (4 widgets at 960×540, rest disabled), memory 3
  recall restored the 4×4.
- **Timers:** `$timer/@items/TIMER_n/control/@props/{type, label, countdownDuration
  (0..86399 s), currentTimeMode, xStart, xPause, xStop}`, `status/@props/state`
  (IDLE/RUNNING/PAUSED/ELAPSED). Type and duration write; **xStart leaves the sim
  at IDLE** — unproven.
- **Stills:** `stillLibrary/$bank/@items/1..50/{status/@props/{isValid, isUsed,
  fileName, fileSize, width, height}, control/@props/{label, xDelete}}`; capture
  `stillLibrary/capture/cmd/@props/{stream, destination LIBRARY|FILE, libraryMode
  AUTO_SLOT|SPECIFIC_SLOT, librarySlot, fileType PNG|BMP|JPEG, mode INCREMENTAL|
  OVERWRITE, xRequest}`, `capture/status/@props/{status, fileName, streamValidity}`.
  **The sim never performs a capture** (status stays NO_REQUEST) — unproven. The
  `images/download/N` HTTP route answers 500 on the sim, so no library thumbnails.
- **Outputs:** keys 1..6 + `MTVW`; role from `CURRENT/$output/@items/K/@props/
  mode` (SCREEN_FORMAT / AUX* / MULTIVIEWER / DISABLE) picks `format/{screen|
  auxiliary|multiviewer}/control/@props/{format, xUpdate}` and `status/@props/
  formatValidity`; `status/@props/{isAvailable, format, rate, sizeH, sizeV,
  ledColor}`; `pattern/control/@props/{type (17 OPATTERN_TYPE values), inhibit}`
  — inhibit=false shows it; `settings/@props/{gamma 5..40 tenths, brightness/
  contrast/saturation −128..127, hue −90..90, gainR/G/B, offsetR/G/B}`;
  `$plug/@items/1/status/@props/{plugStatus, type}`. Verified: SMPTE pattern on/
  off, format HDTV_720P applied via xUpdate (status 1280×720) and back.
- **Inspector:** the AWJ side of the mnemonic Inspector/Console — every path in
  `store.paths`, get/set any path (JSON), the rx/tx/er log (capped at 400
  entries in the store). Offered on LivePremier too.

## Midra 4K / Alta 4K: pictures, background/top layers, quick preset, System — 2026-09-15, round two

Still simulator-only. Grounded the same way as the morning's round (sweep, store
dump, catalogue, vendor bundle); new facts:

- **Snapshots.** The device's own route is `/api/device/snapshots/<type>/<id>`
  — the vendor bundle's route table names `inputs`, `outputs`, `multiviewer`
  and `screens/:screenId/:imageType/:imageId` with `back` / `top`. The sim
  serves 256×144 PNGs (placeholders reading `IN5`, `OUT1`); `screens`/`images`/
  `auxes` as a type are "Invalid parameter type". No program/preview render, as
  on LiveCore. lpp's proxy preserves the path, which is how the fleet already
  fetched them. The unit's HTTP is port 80; the sims put it on 3010/3020, so
  the surface has a per-browser override (Connection → *Thumbnails from*).
- **Quick preset** (`quickPreset/`): `control/@props/enable` is the switch,
  `mode` NULL/FRAME/MASTER (NULL = fade to black — the manual's own words),
  `control/filter/$screen/@items/N/@props/enable` covers destinations,
  `status/@props/isEnabled` immediate, `status/$screen/@items/N/@props/isEnabled`
  true only after the fade (~1 s on the sim). Verified on/off on the Midra sim.
- **Background / top layers** on a preset: `background/source/@props/set`
  (`NONE` or `"1"`…`"8"`), colour, opacity; `top/source/@props/frame` (`NONE`,
  `"1"`…`"4"`), position, opacity; frame slots at `$screen/@items/N/$topFrame|
  $backFrame/@items/K` (`status/isValid`, `control/label|librarySlot|sizeH|
  sizeV`), background sets at `$backgroundSet/@items/K/control/@props/
  singleContent`. All verified read+write on the sim (colour rgb 170/34/51,
  set 2, top frame 1 dragged to 1248/756).
- **System**: `system/temperature/$sensor/@items/<NAME>/@props/temperature` is
  hundredths of °C; `system/fan/$case/@items/N/@props/speed` = 65535 means "not
  reported" (every fan on the real dump); `frontPanel/@props/lock` NONE/MENU/
  ALL, `lcdBrightness` 1..7, `keyBrightness` 0..100; `network/ipv4/status`
  arrays; `shutdown/@props/xReboot`. Lock write verified both ways on the sim.
- The Connection view seeded its picker in `enter()` only, so a reload straight
  onto `#connection` showed LiveCore selected on a Midra 4K bridge; it seeds on
  first render now.

## Midra 4K / Alta 4K: Layers, Inputs, bank writes and the rest of the take node, 2026-09-15

Same day as the landing below, simulator-only (no hardware access). The mng
surface grew from two views to four, and the crate from 30 to ~55 path builders.

**Sources for the new paths, in order of trust:** (1) the fleet's field-test
sweep, 429 paths answered by the real Pulse 4K (`~/dev/pulse-field-test/results/
20-paths-detail-*.json`) — tbarPosition control/status, enablePresetToggle,
xStepBack, xCopyProgramToPreview, every one of the 57 live-layer leaves, canvas
size, master save mode/filters, slot label/xDelete; (2) that unit's full store
dump (`store-device-2026-09-12T12-03-40.json`, the `/api/stores/device` HTTP
endpoint) for what the sweep never asked: `control/@props/freeze` on screens,
auxes, inputs and live layers, the per-layer `fader` (opacity 0..255, xFadeIn,
xFadeOut), `inputList` (16 inputs, `status/@props/{isAvailable, ledColor}`,
`control/@props/{plug, freeze, black}`, labels/type/signal on `plugList/items/N`),
`tallies/inputs/@props/usedOn{Screen,Aux}{Pgm,Prw}`, `quickPreset`,
`stillLibrary`, `multiviewer`; (3) awj-surface's `catalogue-mng.json` for the
ranges/enums (opacity is 0..256; borders 0..255; shadow offsets ±512); (4) the
vendor's own web bundle inside the simulator app (`Midra_Simulator.app/…/
webapp-bundle/dist/client/app.*.js`) for attribute definitions — e.g.
`xTakeMany` is a map of up to 8 `SCREEN_n`/`AUX_n`, `QUICK_PRESET_MODE` is
NULL/FRAME/MASTER, `LED_STATUS_COLOR` OFF/RED/GREEN/ORANGE_BLINK.

**Two things the simulator settled that the docs had wrong or open:**
- `xStepBack` is an EDIT UNDO (posH 779 → 960 after a drag), not a return to
  the previous look; it moved nothing after a take. The crate doc said the
  latter; fixed.
- `xTakeMany` does nothing on the sim. Watching the vendor UI's TAKE with ALL
  selected over a second AWJ socket: it writes `xTake=false, xTake=true` per
  screen, back to back, and both go `EFFECT_FROM_x` together. The surface now
  does that; the crate keeps `take_many()` documented as unproven.

**The master-save trap, reproduced:** my first master save (mode SAVE_FROM_PRW,
bankSlots untouched = 1) overwrote screen slot 1 "Fixture one" on the sim —
both S1 buffers then reported memoryId 1. The guard now writes
`control/save/$screen/@items/N/@props/bankSlot` = the master slot for every
destination in service, refuses if any such screen/aux slot isValid, and
offers USE_EXISTING_MEMORIES. Verified: save into master 12 wrote screen slot
12 (valid on the device, S1 UP memoryId 12); save into master 1 refused.

**Verified end to end on the Midra 4K sim (Pulse, :10610):** T-bar 0→32768→65535
(EFFECT_FROM_DOWN → AT_UP), freeze on/off, Take all (both screens), layer
source INPUT_3, 2-up layout, canvas drag (device read back posH 779/posV 300),
screen save/label/erase (slot 5), master save guard, input freeze. **Alta 4K
sim (Zenith 200, :13021):** A1 preview background INPUT_6 → INPUT_2 → back.
**LivePremier sim:** nav still Screens/Presets only, no extras, no mode
segment. **Not seen working:** tallies (empty on the sim whatever is on a
layer; the real dump had empty layers), the `status/tbarPosition` readback
while a bar is mid-travel (the sim only reports the ends).

**Browser-side shape:** one global `awjLive` flag and `awjApplySubs()` union
the base prefixes with the active view's (`awjViewSubs`), because the device's
subscription list is one replace per connection. `MNG_LAYER_PROPS` is the
catalogue table the properties panel renders from; `mngInputs` fetches plug
labels lazily once an input's active plug is known. The hub inventory grew by
~120 reads (canvas, layer modes, freeze/tbar/toggle per destination, tallies,
input availability/led/plug); layer properties are read when a screen is
opened.

## Midra 4K / Alta 4K as AWJ targets, built 2026-09-13, landed 2026-09-15

The current range's other two families join LivePremier: **Midra 4K** (QuickVu /
Pulse / Eikos / QuickMatrix 4K) and **Alta 4K** (Zenith 100 / 200). Same wire
(port, framing, verbs, silent writes, prefix subscriptions, the six transition
states), **different object model** — `openrcs_awj::Dialect { LivePremier, Mng }`,
spelled by `paths.rs` and the new `mng.rs`. `hub::Family::Awj(AwjSeries)` keeps
the operator's pick (three names, two models) so a Zenith is called an Alta 4K.

**Provenance:** every `mng` path was answered by a real Pulse 4K on 3.3.10 on
2026-09-12 (the fleet's field-test suite, see the livepremier-plus notes), and the
LivePremier spellings were read on the same box as a control — all E12. Take,
cut, recall and subscription were fired at that box by the harness, not by this
code. `tests/mng.rs` pins the spellings.

**The model, in one paragraph:** screen 1 and auxiliary 1 are both keyed `1` in
`$screen` / `$auxiliaryScreen` (no `S1` on the wire; `mng::Dest` carries the
kind); takes live under a top-level `transition` node with ONE `takeTime`; the
buffers are literally `UP` and `DOWN` and program is the transition suffix
(`crate::Buffer::program` is the vendor's own rule); "in service" is `enable` /
`mode != DISABLE` under `preconfig/status/$state/@items/CURRENT` — the APPLIED
config, never `preconfig/control`; which memory a buffer holds is
`$preset/@items/UP/status/@props/memoryId` on the destination (0 = none); banks
are `preset/bank`, `preset/auxBank`, `preset/masterBank` with slot metadata
under `$slot`, not `$bank`; no layer bank; there is no `status/take`.

**Surface:** the same two AWJ views, now dialect-driven (`AWJ_DIALECTS[awjDialect()]`
in `app.js`; nothing above it spells a path). Midra 4K / Alta 4K get a Memory
column (program / preview slot per destination), auxiliaries as destinations,
and three bank chips. The hub's connect-time inventory reads the OTHER model's
identity too, so a wrong pick shows a banner naming the real processor instead
of an empty show. The header now shows the configured device port rather than the
family default (`meta.port`), which lied for anything on a non-default port.

**Verified end to end on the vendor simulators 2026-09-13 and again 2026-09-15**
(Midra 4K 3.2.29 as a Pulse on :10610, Alta 4K 1.3.7 as a Zenith 200 on :13021):
take with the push arriving (`AT_UP → EFFECT_FROM_UP → AT_DOWN`, buffers and
memory column flipping), screen-bank recall to preview with the slot marks
following, master recall, an auxiliary take and an aux-bank recall onto program;
LivePremier regression clean on its simulator. **Two things the simulators
taught:** a recall lands `memoryId` some tens of ms after `xRequest`, so the
surface reads back twice (immediately and at 300 ms); and unlike the LivePremier
simulator these two DO overwrite `takeTime` on a recall (3.3 s → 1.0 s seen),
which matches hardware.

**Status wording that must not drift:** paths hardware-verified; openrcs's OWN
surface for these families simulator-only. README, AGENTS.md and the user guide
say exactly that.

## LivePremier (AWJ) added as a SECOND FAMILY, 2026-08-21 — PR #6, CI green

openrcs is no longer LiveCore/Midra-only. `feature/livepremier-awj` adds
**`crates/openrcs-awj`** (JSON over TCP 10606, `no_std` + serde_json/alloc, 15
conformance tests) and a LivePremier mode in the bridge and surface.

**Provenance is CLEAN here** — built from the vendor's own
`AW_LivePremier_AWJ_ProgrammersGuide_V6.2.pdf` (in `~/Desktop/aw training/
DOCUMENTATION/`), not from RE. v6.2 documents far more than the v4.0 guide:
the preset A/B letters, TAKE, screen/aux/master recall, layer source, `xUpdate`.
No SWF, no decompile, no simulator — so it belongs in the PUBLIC repo without
the usual scrub. (I did still scrub the word "simulator" from two doc comments;
it is on the leak list.)

**Architecture: `hub::Family { Mnemonic(Platform), Awj }`.** Everything that
differs hangs off that enum. Separate caches (`state` keyed mnemonic+indices,
`awj_state` keyed path), separate browser messages (`pget`/`pset`/`psub` ->
`pval`/`psnap`/`perr`), separate views. The two families **share the shell —
header, nav, Connection — and no views**; `viewSupported()` gates on
`id.startsWith('lp')`.

**⚠️ The AWJ paths exist TWICE** — `crates/openrcs-awj/src/paths.rs` and the
`LP` table in `web/app.js`, because the browser builds the paths it writes. A
stale one fails as a runtime E12, not a build error. Recorded in AGENTS.md.

**Writes EXERCISED on the SIMULATOR 2026-08-21** (hardware went away mid-session;
Allan: "we only have the simulator live now, but you can do anything you like on
there"). Subscribe -> push, take, cut, preset save + recall, all driven through
the surface. Three findings:
- **An `x`-prefixed property is a TRIGGER, NOT A FLAG.** `xTake` reads back
  `true` and STAYS true; writing `true` again fires again. A client that diffs
  before writing breaks the SECOND press of Take only.
- **Cut 25 ms vs take ~1050 ms** with a 1.0 s fade — the fade is real. A recall
  pushes `$screenAuxGroup/control/@props/xUpdate` back unprompted.
- **⚠️ The sim does NOT reproduce the takeUpTime clobber on recall** that
  hardware shows ([awj protocol](https://github.com/stoatworks-labs/fleet-notes/blob/main/notes/reference_awj_protocol.md)). Sequencing order-of-operations
  cannot be settled on the sim.

**Configuring the sim's screens** (it ships with NONE in use, so the surface is
empty until you do): stage `preconfig/resources/new/$screen/@items/S1/control/
@props/mode` = `FREESTYLE` over AWJ, then the vendor Web RCS (`:3000`)
**Preconfig -> Screens**: enable, ADD OUTPUTS, add a layer, APPLY. The apply and
validate triggers, sniffed off the vendor UI's own socket, are
`DeviceObject/preconfig/resources/new/control/@props/{xApply,xCheck}` — not
documented anywhere, and `preconfig/resources/**current**` is E12 on this sim
build. `isUsed` stays false until an output is assigned AND applied.

**Verified on the Aquilon C (.142) 2026-08-21: reads only.** 293 properties,
**zero E12**, S1-S4 with labels/transitions/letters A+B/take times, bank paged
to slot 100. **The writes — take, cut, preset recall, and the subscription
list behind the "Live updates" toggle — have NEVER been fired at a device**;
README + AGENTS.md say so. Needs a write window under
**aquilon read only rule** (working-practice note, kept in Claude memory).

**⚠️ .142 was NOT idle** — contrary to the 2026-08-20 note that no layer had a
source, every screen had content: S1 pgm `NATIVE_1` / prw `LIVE_6`, S2 pgm
`SCREEN_1`, S3 `LIVE_6` BOTH sides, S4 pgm `LIVE_7`. S3 was the only screen a
take would not have visibly changed.

**The .142 box now has 2 VALID preset slots** (1 and 2, empty labels) — it had
none on 2026-08-20, so someone stored them. A preset-recall test is now possible
on it.

**Two bugs the build found in existing code:** `--device` was never run through
`normalise_device`, so a bare IP died with "invalid socket address" on every
reconnect (only the Setup path normalised); and a view IIFE's local `render()`
builds a detached tree — handlers must call `store.notify()`, or the UI silently
does not repaint.

Also: **PR #5 (`feature/appliance-setup`, 5 commits) was merged to main** on the
way, after a rebase onto a main that had moved (support footer + a CI workflow);
the only conflict was generated demo cache-busting hashes, fixed by re-running
`demo/build-demo.sh`. **This repo now HAS PR CI** (added in #3) — it did not
before.

## almost-least-weasel (ALW1) platform (2026-08-08)

Third `Platform` on branch `almost-least-weasel` (pushed, NOT merged — owner
must approve merge). Custom LiveCore-family device: 8 inputs / 2 screens /
3 layers / 2 take groups, CRLF terminator, DEV_PLATFORM **87** (value space is
per-MODEL: 97 = NeXtage 16; Midra has no `!` var at all). Table
`protocol/almost_least_weasel.json` = pruned/re-dimensioned LiveCore copy.
Public repo must call it only "a custom LiveCore-family switcher profile" —
the donor connection lives in atem-av-fw (`docs/07-openrcs-device-profile.md`).

**tables.rs codegen is NOT in the public repo**: it's
`openrcs-research/tools/gen_vars.py` (writes into the research tree; the
public copy was carried over with the tool reference stripped from the
header). To regen the public tables.rs, adapt it out-of-repo and diff-verify
byte-identical output for midra+livecore first — this worked exactly.

UI facts: counts derive from dims (`INava`/`SCmly`/`PRinp`/`OUava`), NOT from
DFrpd/DFlpr (never read). `deviceModel()` falls back to decoding
DEVICE_STRING (`DIdst` [2,4] ASCII) via `WIRE_MODELS` ("ALW1" →
"almost-least-weasel"). Demo fixture selection: `?device=<name>` →
`fixtures-<name>.json`; the ALW fixture is table-derived, the LiveCore one
stays recorded-only.

**ALW branch REBASED onto current main + VERIFIED + pushed (2026-08-09, commit 428ebdc,
force-with-lease).** Was 5 behind main (v0.4.0 release + plug-name app.js) with conflicts;
rebased to a single clean commit on `origin/main`. Only conflict was `demo/dist/index.html`
(content-hash cache-bust stamp) — resolved by `bash demo/build-demo.sh` regenerating dist;
`web/app.js` auto-merged carrying BOTH the ALW model-resolution AND main's plug-name feature.
Verified: `cargo test` = 27 unit + 9 conformance pass (incl. `almost_least_weasel_table_matches_its_profile`);
server `--help` lists `--platform ...|almost-least-weasel`; demo `?device=almost-least-weasel`
loads (573 vars, platform resolves, nav reduces to 19 — Tally/Stills/Capture/Soft-edge/GPIO
correctly hidden). Leak-scan of the diff clean (only legit "simulated device" demo copy).
**STILL NOT merged to main — owner's call** (compare main...almost-least-weasel).
**DISCREPANCY to confirm:** the ALW table OMITS `PRESET_MEMORIES` (`PSmet`/`PMpst`/`PSval`/`PSsav`
all ABSENT) so the **Memories view hides**, yet doc-07 lists PRESET_MEMORIES as a group we
implement. Take engine (PRinp/GCsta/GCtba/GCtku) + identity all present. Either deliberate (v1
skips stored memories — needs firmware NVRAM) or a pruning oversight; decide before merge.

**v0.4.0 RELEASED + fully published (2026-08-09).** Harness `scripts/release-local.sh
--version 0.4.0 --upload` cross-built/signed/notarized all 12 artifacts (mac aarch64+x86_64
dmg/pkg/tar via cargo, linux x64+arm64 via zigbuild, windows x64+arm64 zip/nsis via xwin —
win unsigned; NO VM since no launcher) + tagged + `gh release`. `gen-downloads.py --repo
openrcs` (canonical in stoatworks-backend/release/) rewrote the README block AND the site's
downloads.json. README + docs/USER-GUIDE updated for the new views. Website (Astro) openrcs
entry bumped (v0.4.0, new features, Companion module) + deployed via `cf-run npx wrangler
deploy`. **Socials LIVE** via upload-post (profile `me`, only IG + YouTube connected):
IG photo carousel https://www.instagram.com/p/DbzLaS0DKOe/ (6 CDP stills of the new views);
YouTube 30s montage https://www.youtube.com/watch?v=8f5h1v2vCJY. Video = PIL-baked captions
(homebrew ffmpeg has NO drawtext) + ffmpeg static-clip+fade concat (zoompan MANGLES concat
duration → 2406s bug, dropped it). NOTE: release `git add -A` swept .DS_Store + .claude/ into
the repo — cleaned after (now gitignored). Not-yet-done: YouTube/README video EMBED, a
dedicated companion-module website entry.

**Appliance target (SBC hardware panel) — designed 2026-08-12, `openrcs-research/docs/APPLIANCE.md`.**
Stage 2 of the three-stage plan: small aarch64 SBC hosts `openrcs-server`, renders the UI on its
own HDMI, local pointer input. **Nothing built or run** — don't upgrade it to a claim. Cheap
because the server already ships `linux-arm64` with the UI `rust-embed`'d into one file.
**Kept PRIVATE until the platform hits v1.0**, then a public repo — even though the `openrcs`
public repo already exists. The doc is written **public-safe from the start** (no provenance, no
vendor client) so promoting it is a copy, not a rewrite. Test mule is a BirdDog PLAY (bought
cheap in quantity) — that half stays private forever, see [birddog re](https://github.com/stoatworks-labs/birddog-re/blob/main/docs/NOTES.md) (`birddog-re`) note 07.
**Board-selection rule (in the doc, public-safe):** what decides the effort is NOT the SoC but
whether the board has an **upstream device tree** — mainline DT + existing distro target = an
integration job, no DT = a porting project. Check the supported-boards list before the spec
sheet. Corollary, easy to get backwards: **never keep a vendor BSP kernel to preserve hardware
video decode** — openRCS has NO video path, so a BSP kernel buys nothing and costs an old
userland, a GPU blob to match, and an EOL base.

**STANDING UI CONSTRAINT — the UI is pointer-only and touch-safe. Keep it that way.**
Measured 2026-08-12: **zero keyboard handlers anywhere** (only `pointerup`/`pointermove`/
`pointercancel`/`resize`/`hashchange`/`blur`); 22 of 23 `:hover` rules are cosmetic and the
23rd (`.se-edge:hover .se-lbl`, `style.css:368`) pairs with `.se-edge.sel`; **zero `title=`
tooltips**. So a USB touch panel drives it unmodified. A hover-only affordance or a
keyboard-only shortcut silently breaks the appliance — cheap to preserve, expensive to recover.
Also light enough for GLES2-class silicon: no canvas, no WebGL, no `backdrop-filter`/`blur`,
no `@keyframes`, one WebSocket, 3 `requestAnimationFrame`.
Gotcha: input **thumbnails are fetched by the BROWSER direct from the processor's HTTP server**
(`app.js:808-830`), not proxied through `openrcs-server` — an appliance needs a route to the
processor's IP, not just its control port. LiveCore only; Midra serves none.


**APPLIANCE SUPPORT SHIPPED (2026-08-13, branch `feature/appliance-setup`,
pushed, NOT merged — owner's call).** Built for [sable](https://github.com/stoatworks-labs/sable/blob/main/docs/NOTES.md) (`sable`) but entirely
device-agnostic, so it lives in the public repo:
- **`--device` is now OPTIONAL.** Without one the server starts *unconfigured*,
  serves the UI and waits. `Hub`'s target is a `Mutex<Option<Target>>` and the
  device loop watches a **`watch` generation counter** (not a `Notify` — it
  latches, so a retarget raised between `select!`s is still seen), so a retarget
  tears the link down mid-connect, mid-pump or mid-backoff.
- **Runtime retarget + persistence.** WS `setup`/`discover` messages; config at
  `~/.config/openrcs/config.json` (or `--config`). CLI wins for the run, stored
  value fills the gap. Clients are **re-seeded** (fresh meta+snap) on retarget,
  and `app.js` **reloads the page** when meta's device/platform changes — every
  view holds its own cached idea of the device and a reload is the only reset
  that cannot miss one.
- **New `connection` view** (nav "Connection", first in Setup): on-screen
  **keypad** (no keyboard exists on a panel), platform picker, Scan list,
  Connect. `viewSupported()` hides EVERY other view while unconfigured, and
  `effectiveView()` stops a stale hash stranding it. Header shows "no processor
  / not configured" rather than the default table's platform.
- **Discovery sweep**, server-side, /24 from the primary IPv4, both platform
  ports, 64 concurrent, **READ-ONLY** (connect, listen, never write — it can run
  on a venue LAN mid-show).

**GREETING FACTS, MEASURED ON REAL GEAR 2026-08-13 (supersede earlier notes):**
- **LiveCore DOES greet — but at ~1161 ms.** A 700 ms window found the NeXtage
  and then failed to identify it. Window is now **2000 ms**.
- **Midra does NOT greet at all.** Pulse2 silent for 4 s. It scans as
  found-but-unlabelled, and the UI says "pick platform" rather than
  "unidentified". Deliberately NOT probing: a probe would identify everything
  and also mean writing to a possibly-live processor.
- `classify()` must test `PDEV`/`ITcct` BEFORE `DEV` — `PDEV` contains `DEV`.

**Hardware validation 2026-08-13, read-only (gets only, no sets/takes):**
unconfigured start → scan finds BOTH boxes → setup from a **bare address**
(port auto-filled) → live retarget between the two swaps the table 1014↔562
vars, clears the cache, reconnects. Identity matched: **NeXtage PDEV 97, serial
313; Pulse2 DEV 259, serial 2165**. **The NeXtage answered at `192.168.1.43`,
not `.42`** (.42 pinged with 10500 closed) — DHCP appears to have moved it, so
**scan rather than trusting the recorded IP**.
