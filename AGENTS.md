# AGENTS.md — openrcs

Onboarding for LLM agents working in this repo.

## What this is

A Rust library for controlling Analog Way Midra series (Pulse2, Eikos2, Saphyr,
SmartMatriX2, QuickMatriX, QuickVu) and LiveCore series (Ascender 16/32/48,
NeXtage 8/16, SmartMatriX Ultra) video processors over their TCP control
protocol.

Not affiliated with Analog Way. Device and product names appear only to state
compatibility.

## Layout

```
crates/openrcs-proto/   protocol engine: codec, tables, validation (no_std)
  src/codec.rs          encode/decode; the only place the wire format lives
  src/tables.rs         GENERATED from protocol/*.json — never hand-edit
crates/openrcs-server/  bridge server (tokio/axum) + web control surface
  src/hub.rs            one TCP link to the device + state cache + broadcast
  src/main.rs           HTTP/WS, the browser JSON protocol
  web/                  vanilla ES-module SPA, no build step
protocol/*.json         source of truth for the variable tables
docs/PROTOCOL.md        the wire protocol
```

Only `openrcs-proto` is `no_std` and dependency-free; the server is a normal
std binary and may use crates. Keep the split.

## Hard rules

- **`src/tables.rs` is generated** from `protocol/*.json`. Edit the JSON, not
  the Rust.
- **Do not commit binaries or device firmware.** `.gitignore` covers the
  obvious cases; keep it that way.
- **Be precise about validation.** The LiveCore codec is confirmed against
  device behaviour; the Midra table is not yet exercised against a device. Do
  not overstate this.
- **The two platforms differ.** Midra terminates commands with `\r\n`, LiveCore
  with `\n`. This is not cosmetic and is easy to regress.
- **Use vendor names nominatively only** — to state compatibility, never as
  branding or in a way implying endorsement.

## Protocol facts worth not regressing

- The reply format mirrors the command: commands end with the mnemonic, replies
  start with it, and a reply's last comma-separated field is the value.
- The device replies in CRLF even on LiveCore (which sends bare LF outbound),
  pushes unsolicited frames (e.g. `ITcct` on connect), and NAKs bad commands
  with `E<code>` (`E10` unknown, `E12` wrong index count). These are pinned in
  `tests/conformance.rs` — don't break them.
- `max` reaches 4294967295 and `dims` reach 1048577, so those fields are `i64`
  and `u32`, not `i32`/`u16`.
- Partial reply lines must be buffered across reads (the `Decoder` does this).

## Verifying

```bash
cargo test
cargo clippy --all-targets        # must be clean
cargo build --no-default-features # no_std must keep building
```

`no_std` is not decoration — a future gateway target may be embedded. Do not
reach for `std` in `openrcs-proto`.
