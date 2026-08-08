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
