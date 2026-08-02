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

The device serves HTTP on port 80 alongside the control socket. Input
thumbnails are BMPs, cache-busted by timestamp:

```
http://<ip>/assets/Snapshots/capture_in_8.bmp?time=1777759289995
```

Useful for source previews.

## The data

The full variable tables are in [`../protocol/`](../protocol) as JSON, and
generated into the crate as `tables.rs`. Each entry carries its mnemonic, reply
mnemonic, symbolic name, group, dimensions, min/max/default, and read-only flag.
