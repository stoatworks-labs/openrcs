# AGENTS.md — openrcs

Onboarding for LLM agents working in this repo.

## What this is

A Rust library for controlling Analog Way Midra series (Pulse2, Eikos2, Saphyr,
SmartMatriX2, QuickMatriX, QuickVu) and LiveCore series (Ascender 16/32/48,
NeXtage 8/16, SmartMatriX Ultra) video processors over their TCP control
protocol, and LivePremier series (Aquilon) processors over theirs.

**Two families, not two dialects.** Midra/LiveCore exchange terse ASCII
mnemonics addressed by index on TCP 10500; LivePremier exchanges JSON addressed
by path on TCP 10606. They share a company name and nothing else. Everything
that differs hangs off `hub::Family`, and the two surfaces share the shell —
header, nav, Connection — but no views.

Not affiliated with Analog Way. Device and product names appear only to state
compatibility.

## Layout

```
crates/openrcs-proto/   Midra/LiveCore engine: codec, tables, validation (no_std)
  src/codec.rs          encode/decode; the only place the wire format lives
  src/tables.rs         GENERATED from protocol/*.json — never hand-edit
crates/openrcs-awj/     LivePremier engine (no_std, serde_json on alloc)
  src/codec.rs          0x04-framed JSON messages
  src/paths.rs          path builders for the documented command set
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
- **The LivePremier paths exist twice** — `crates/openrcs-awj/src/paths.rs` and
  the `LP` table in `web/app.js` — because the browser builds the paths it
  writes. Change one, change the other: a stale path fails as an `E12` at
  runtime, not as a build error.
- **Only reads are hardware-verified on LivePremier.** The inventory, screen
  state and preset bank have been read from an Aquilon C on 6.2.73; take, cut,
  preset recall and the subscription list have not been fired at a device. Do
  not describe them as verified.
- **Use vendor names nominatively only** — to state compatibility, never as
  branding or in a way implying endorsement.

## LivePremier protocol facts worth not regressing

- **Messages end with `0x04`, not a newline** — a label is free text and may
  contain one. The decoder splits on `0x04` alone.
- **A write is answered with nothing at all.** No ack, no echo. Confirm a write
  by reading the property back; `Hub::awj_set` does exactly that.
- **Subscriptions start empty**, so a client is told nothing about state changes
  until it writes a list. That write is what the surface's "Live updates" toggle
  does, and why it is off until asked for.
- **A container read returns `{}`.** The model cannot be enumerated from the
  device, so there is no discovering what a processor has — only asking for
  named leaves and seeing which answer. `E12` is the ordinary answer for a path
  a firmware build does not carry, and the connect-time inventory provokes it by
  design.
- **Layer parameters are addressed by preset letter**, and which letter is on
  air moves as the device is used. Every transition state names the end the
  T-bar is at or came from, so the rule is the DOWN/UP suffix — testing only for
  `AT_UP` gets the four in-flight states backwards, invisibly, for exactly the
  length of a transition.

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
