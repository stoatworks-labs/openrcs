# openrcs

> **AI-assisted project.** This codebase was created with [Claude](https://claude.com/claude-code)
> (Anthropic), directed and reviewed by a human author. The protocol was
> reverse-engineered rather than taken from a published specification: the codec
> is confirmed against LiveCore device behaviour, but the Midra table has never
> been exercised against a device. Check its output against your own processor
> before a show — see [Status](#status).

A Rust library for controlling **Analog Way Midra and LiveCore series** video
processors over their native TCP control protocol.

It targets the Midra family (Pulse2, Eikos2, Saphyr, SmartMatriX2, QuickMatriX,
QuickVu) and the LiveCore family (Ascender 16/32/48, NeXtage 8/16, SmartMatriX
Ultra) — a modern, dependency-light control surface for hardware whose original
software is long out of date.

![The graphical layer arrangement editor — arrange sources live](docs/screenshots/layer-editor.gif)

Not affiliated with or endorsed by Analog Way. Product names are used only to
describe compatibility.

## Status

`openrcs-proto`, the protocol engine, is implemented and tested. The LiveCore
command table (1014 variables) and the Midra table (562) are complete with
per-variable dimensions, ranges, and read-only flags. The codec is confirmed
against LiveCore device behaviour; the Midra table has not yet been exercised
against a device.

`openrcs-server` adds a browser control surface over that engine (see below).
Roadmap: package it as a system-tray app, then a standalone gateway (Pi or
ESP32) between the processor and its clients. The protocol engine is
`no_std`-friendly so the same code backs all of them.

## Web control surface

`openrcs-server` bridges a browser control panel to a processor: it holds one
TCP connection to the device, caches state, and relays a small JSON protocol
over a websocket to any number of browsers.

```bash
cargo run -p openrcs-server -- --device <processor-ip>:10500 --platform livecore
# then open http://127.0.0.1:8730/
```

The UI covers **Memories** (master and per-screen memory grids — recall, load +
take, save), **Live** (preview→program take with a transition time),
**Screens** (output/layer overview), an **Inspector** over every one of the
device's variables, and a raw-protocol **Console**. It's a dependency-free
vanilla ES-module app served by the server — no build step.

## Using the crate

```rust
use openrcs_proto::{encode_set_checked, Decoder, Frame, Platform};

// Drive screen 1's T-bar to 50% travel.
let cmd = encode_set_checked(Platform::Midra, "GCtba", &[1], 5000)?;
assert_eq!(cmd, "1,5000GCtba\r\n");

// Replies are the mirror image: mnemonic first, value last. The device also
// pushes unsolicited updates, so decode continuously.
let mut dec = Decoder::new();
for frame in dec.feed(b"GCtba1,5000\n") {
    match frame {
        Frame::Value(r) => println!("{} {:?} = {}", r.mnemonic, r.indices, r.value),
        Frame::Error(code) => eprintln!("device error {code}"),
    }
}
```

`encode_set_checked` validates index rank, index bounds, value range, and
read-only status against the variable table. `encode_set` skips the checks when
you want raw control.

```bash
cargo test                        # no hardware needed
cargo build --no-default-features # no_std

# Read-only probe against a device:
cargo run --example probe -- <device-ip>:10500 livecore
```

## The protocol in one paragraph

Both families speak a terse ASCII protocol over TCP 10500. Commands put the
5-character mnemonic last, replies put it first, and a reply's final
comma-separated field is the value. Midra terminates outbound commands with
CRLF, LiveCore with LF. The device pushes unsolicited updates and NAKs bad
commands with `E<code>`. A short summary is in [`docs/PROTOCOL.md`](docs/PROTOCOL.md).

The full protocol reference — framing, the variable model, and every variable
for both platforms — is a companion repository:
**[openrcs-protocol](https://github.com/stoatworks-labs/openrcs-protocol)**.

## Licence

MIT.
