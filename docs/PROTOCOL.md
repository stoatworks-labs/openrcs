# Analog Way Midra and LiveCore control protocol

Reference for the wire protocol `openrcs-proto` implements. Per-variable ranges
and dimensions are declarations — the crate validates against them, but the
device is the final authority.

| | Midra series | LiveCore series |
|---|---|---|
| Devices | Pulse2, Eikos2, Saphyr, SmartMatriX2, QuickMatriX, QuickVu | Ascender 16/32/48, NeXtage 8/16, SmartMatriX Ultra |
| Variables | 562 | 1014 |
| Groups | 49 | 88 |
| Outbound terminator | `\r\n` | `\n` |
| Port | TCP 10500 | TCP 10500 |

The device replies with CRLF on both platforms.

## Framing

A terse ASCII protocol over TCP 10500, **asymmetric** — outbound puts the
mnemonic last, inbound puts it first:

```
set:    idx0,idx1,…,<value><MNEMONIC><terminator>
get:    idx0,idx1,…,<MNEMONIC><terminator>
reply:  <MNEMONIC>idx0,idx1,…,<value>
```

Each index is emitted followed by a comma. On a set the value is appended bare;
on a get nothing follows the final comma. Examples:

```
1,2,5PMinp\r\n     set preset-memory input, indices (1,2), to 5
1,2,PMinp\r\n      request the same variable
PMinp1,2,5         the device's reply
```

### Decoding

Scan past the leading alphabetic mnemonic and split the numeric tail on `,`:
**the last field is the value, everything before it is indices.** Replies are
separated by `\n`; a receiver must buffer a trailing partial line across reads,
since the device may split replies across packets. In practice every reply is
CRLF-terminated even on LiveCore (which sends bare LF outbound), so trim a
trailing `\r`.

### Errors

A rejected command is answered with `E<code>\r\n`:

| Code | Meaning |
|---|---|
| `E10` | unknown command |
| `E12` | wrong number of indices |

An empty line draws no response. Client-side validation
(`encode_*_checked`) catches the wrong-rank case before it reaches the wire.

### Push

The device sends unsolicited value frames. On connect it immediately pushes
`ITcct0,1` (`INTERFACE_CONNECTED_CONTROLLERS`). A client must accept value
frames at any time, not only in response to a request.

## Variable model

Each parameter has a 5-character mnemonic (a few 1-character specials), a group,
an index-dimension list, and min/max/default. The request and reply mnemonics
are identical except for three Midra debug specials: `?`→`DEV`, `@`→`ADBG`,
`>`→`DDBG`.

Mnemonics are `<2-letter subsystem><3-char parameter>`. Midra subsystems: `SY`
system, `IT` LAN, `CT` control, `DF` device flags, `DI` device info, `SB`
standby, `VE` version, `IN` input, `IS` input signal, `IE` input settings, `SM`
settings memories, `PI`/`PR`/`PU`/`PM` presets, `GC` global & take control,
`OU`/`OC` output, `VO` video out, `SC`/`SG` screen, `SE` soft edge, `EI`/`EO`
EDID, `AU` audio, `PS`/`PC` still & capture, `OS` OSD, `RT` clock, `TE`
temperature, `FA` fan.

### Worked example — the T-bar

```json
{ "name": "TBAR", "group": "GRP_TAKE_CONTROL", "request": "GCtba",
  "dims": [2], "min": 0, "max": 10000, "readOnly": false }
```

One index (screen, 0–1), value 0–10000. Screen 1 to 50 % travel:

```
1,5000GCtba\r\n
```

`TAKE` is `GCtak` (dims `[2]`), `TAKE_ALL` is `GCtal` (no index).

## Device HTTP surface

A LiveCore serves HTTP on port 80 alongside the control socket. Input
thumbnails are cache-busted by timestamp:

```
http://<ip>/assets/Snapshots/capture_in_8.bmp?time=1777759289995
```

Confirmed on a NeXtage 16, with these caveats:

- The file is named `.bmp` but the body is a **PNG** (128 px wide, RGBA).
- It only carries a picture once `SNAPSHOTS` is enabled for that source —
  `SNdis` (global disable) clear and `SNena[i]` set. Until then the request
  still returns 200, with a blank image.
- **Inputs only.** `capture_out_N`, `capture_prw_N` and every other spelling
  tried return 404, even with the matching output and preview snapshot slots
  enabled. There is no thumbnail for a screen, output or still.
- A Midra (Pulse2) serves no HTTP at all — the port refuses the connection.

`openrcs-server` reports the device host to the browser in its `meta` frame so
the control surface can fetch these directly from the device.

## Preset banks and the take (LiveCore)

`PRinp[screen, preset, layer]` addresses three fixed preset buffers — PA, PB and
PC. A take does **not** swap their contents; it changes which one the screen is
showing, and `GCsta[group]` reports that:

| `GCsta` | meaning | live bank |
|---|---|---|
| 0 | `AT_DOWN` | PA |
| 1 | `AT_UP` | PB |
| 2 | `EFFECT_FROM_DOWN` | mid-transition, leaving PA |
| 3 | `EFFECT_FROM_UP` | mid-transition, leaving PB |

So "program" is the bank the device names, not a constant index. A take is
therefore directional: `GCtku[group]` transitions to the UP bank over
`GCtup[group]` ms, `GCtkd`/`GCtdn` to the DOWN bank. Firing the direction the
screen is already at does nothing. `GCtba[group]` is the T-bar (0 = DOWN,
65535 = UP) and drives the same engine; `GCtfr[group]` completes a transition
immediately.

`GC*` is indexed by **group**, not screen — `Plngr[screen]` maps one to the
other (identity unless screens have been grouped, which is why the difference is
easy to miss).

Two traps worth knowing:

- A layer pointed at a source the frame does not have (an input with no card)
  never opens, and the take waiting on it **never lands** — the group sits in
  `EFFECT_FROM_*` indefinitely. `GCtfr` is the way out.
- `PRlay` is the RCS's multi-layer *edit selection*, not layer visibility. A
  layer shows because it has a source.

To ask the device which bank is live rather than inferring it: set `PMscf`
(screen), `PMprf` = 0 (`PRESET_MODE` MAIN), `PMmet` (slot), `PMsav` = 1, then
read `PMinp[slot, layer]` — the device saves whichever bank is on air.

## Preset elements differ between the platforms

LiveCore packs its per-layer booleans into one bitfield, `PRflg` (`PE_FLAGS`):

| bit | meaning | bit | meaning |
|---|---|---|---|
| 0 | force transition | 10 | black & white |
| 1 | smooth move | 11 | negative |
| 2 | flip H | 12 | sepia |
| 3 | flip V | 13 | solarise |
| 4/5/6 | flying bezier 1pt / 2pt / parabolic | 14 | depth cut start |
| 7/8 | depth cut middle / end | 15 | mask cut & fill |
| 9 | force cross-transition | 16–19 | anchor slice 0–3 |
| 20 | rounded border corner | | |

Midra spells the same ideas out as ordinary variables instead — `PRftr`,
`PRsmm`, `PRfli` — and gives each layer its own `PRodu`/`PRcdu` duration in
tenths of a second, where LiveCore slides a layer's window inside the screen's
take with `PRoso`/`PRoeo`/`PRcso`/`PRceo`.

`PMcat` (`PEMEM_CATEGORY`) is the preset-memory load/save filter, one bit each
for source, pos/size, transparency, crop, border, transitions, effects, timing,
speed, flying curve, native background and mask — 4095 for all of them.

These names come from the enumerations in the device's own Web RCS rather than
from guesswork; see the note on recovering them in the research repository.

## Midra sources and the silent write

A Midra's live-layer source list is contiguous: index 0 is black, then one entry per
input in order, and colour last. On a Pulse2 that is exactly the `PRinp` range 0…11 —
`Black, Input1-4, HDMI1-2, SDI1-4, Color` — so **source n is input n**, and there is
nothing exotic above the input count. Separate lists exist for the other layer kinds
(`Black, Frame1-8` and `Black, Logo1-8`), and the layer slots themselves are named
`Frame, LayerA, LayerB, LayerC, Win.1-4, Logo1, Logo2`.

These names come from the MIDRA updater's own firmware image rather than guesswork:
the installer is Inno Setup, and `app/MICRO/Firmware/Calimero_AppliMain_Data.hex`
converted from Intel HEX to a flat binary carries the device's UI string table.
`Device.xml` in the same installer also gives the model map — device type 259 is the
PLS350, sold as the Pulse². It is the Midra counterpart of the Web RCS `.swf` that
supplies the LiveCore enumerations.

**A `PRinp` write the device will not honour is dropped with no `E` code.** The cause
is not layer allocation — every one of the eight slots accepts a write, verified by
setting them all to colour. It is the **source**: a Midra refuses to put a live layer
on an input with no signal, and colour, being generated internally, always lands. So
a client must read `PRinp` back after writing it; the absence of a NAK means nothing.
`ISfwi`/`ISfhe` report the signal, and are the right thing to check first.

## The Midra video out, and what `CTvom` actually does

Most Midra frames carry a second output beside the numbered ones, in `GRP_VIDEO_OUT`.
It has its own format (`VOfor`/`VOrat`/`VOfru`), its own image controls, and — unlike
either platform's numbered outputs on this family — an **area of interest**:
`VOpoh`/`VOpov` for the centre with the usual +32768 bias, and `VOsih`/`VOsiv` for the
size in plain pixels. A device that has never been given one parks all four at the bias
value, which is "unset" rather than a rectangle.

`CTvom` (`VIDEO_OUT_CFGMODE`, 0…2) is the interesting one, and it is not a display
setting. **It assigns the SDI plug to an output.** Watching `OUpls` while it changes on
a Pulse2, the fourth plug moves:

| `CTvom` | `OUpls[0]` (output 1) | `OUpls[1]` (output 2) | `VOpls` | video-out raster |
|---|---|---|---|---|
| 1 | `[1,1,1,1]` | `[1,1,1,0]` | idle | 1920×1080 |
| 2 | `[1,1,1,0]` | `[1,1,1,3]` | idle | 1920×1080 |
| 0 | `[1,1,1,0]` | `[1,1,1,0]` | `[0,0,1]` | 720×576 |

So mode 1 and 2 are not mirroring in any processing sense — the plug becomes a further
plug of that output, carrying its full raster, which is why a frame with two physical
connectors on output 1 reports four plugs there. Mode 0 takes the plug back for the
video out's own recording feed. The two present-values (1 against 3) are not understood.

The order of the three modes is not inferred from the strings: the device advertises one
capability flag per value, in the same order — `DFmvo` (recording), `DFmoa` (output 1),
`DFmob` (output 2) — and reports 0 for a mode the frame cannot offer. `DFvdo` says
whether there is a video out at all and `DFvso` whether it exists only on the SDI plug.

**The recording feed is standard definition, and that is a hard limit.** `VOfor` runs
0…13 and every name in it is an SD format — `Auto, PAL, PAL 4/3, PAL 16/9, NTSC,
NTSC 4/3, NTSC 16/9, PAL-M, PAL-N combi, NTSC 4.43, PAL 60, SECAM, 480i, 576i`. Writing
14 is refused, with the readback holding at the last accepted value and no `E` code.
Entering recording mode drops the raster to 720×576 and changes `VOkin` from 2 to 0.
Consequently the area of interest, which exists only in that mode, cannot be had at HD.

In the mirror modes `VOfst` reads on the **output** format enumeration rather than the
video out's own 0…13 one, which is why `VOfor=0` sitting beside `VOfst=7` is not a
contradiction. Changing `OUfor[0]` to 4 moved `VOfst` to 4 and the reported size to
1280×720, tracking output 1 exactly.

`VOmod` (0…3) chooses which screen the recording feed is a view of — `Screen 1`,
`Screen 2`, `Screen H-tiled`, `Screen V-tiled` — and 4 is refused, so the list is
complete. **There is no way to point the video out at an input.** `VOovc` is
`Underscan`/`Overscan`, and `OUpat`/`VOpat` (0…9) are `Off, V grey scale, H grey scale,
V colour bar, H colour bar, Grid, SMPTE, V burst, Centring, Soft-edge centring`.

`SGswm` (`SCREEN_CFG_SWITCHER_MODE`, 0…3) follows the same flag-per-value pattern with
`DFmix`/`DFmat`/`DFqua`/`DFseb`: `Mixer`, `Matrix`, `Quadravision`, `Embedded SEB`.

`OUfor` (0…45) is **not** solved. Probing a Pulse2 gave 4 → 1280×720 and 7 → 1920×1080,
but `OUfor` does not equal `OUfst` (0 → 28, 3 → 14), so it is not a simple slice of the
frame's format table. Two readings fit both anchors; neither is shipped.

## Neither platform crops an output at HD

LiveCore has a real per-output area of interest — `OUTPUT_AOI_SIZE` (`OSaoi` mode,
`OSash`/`OSasv`/`OSaph`/`OSapv`, `OSocp` overscan compensation, `OSaup` to apply) with
an `OUTPUT_AOI_STATUS` readback. It is **plain pixels with no bias**, and it is
**staged**: nothing happens until `OSaup` fires. An output that has never been given a
custom size leaves those variables at the range ceiling, 100000, which is not a size.

It is also unconfirmed. On a NeXtage 16 the staged values echoed and `OSaup` was
accepted, but `OUT_AOI_STATUS` stayed at 200×200 whatever was staged — 1280×720 and
960×540 both — with `OSfmh`/`OSfmv` reporting 1720,880, which is the format size minus
that 200. Position did not track either. Either the crop needs something else enabled
first or the status group means something other than it appears to.

Midra has no per-output area of interest at all: `GRP_OUTPUT` carries format, rate,
pattern, HDCP, HDBaseT long reach, force-DVI, gamma and flicker, and `OUpoh`
(`OUT_POS`, 1…8) is the output's slot in a screen's tile grid rather than a crop.

Together these are why openrcs carries a **working area**: a client-side region a
screen is composed inside, enforced where layer geometry is written so that no path can
escape it. Nothing is sent to the processor to establish one.
