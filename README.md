# openrcs

> **AI-assisted project.** This codebase was created with [Claude](https://claude.com/claude-code)
> (Anthropic), directed and reviewed by a human author. The protocol was
> reverse-engineered rather than taken from a published specification (the
> LivePremier, Midra 4K and Alta 4K side is the exception — it follows the
> vendor's published protocol guide and what the devices themselves report).
> Both the LiveCore and Midra sides have since been validated against real
> hardware, but device behaviour varies with model, firmware and signal state —
> check against your own processor before a show. See [Status](#status).

A Rust library for controlling **Analog Way Midra, LiveCore, LivePremier,
Midra 4K and Alta 4K** video processors over their native TCP control
protocols.

It targets the Midra family (Pulse2, Eikos2, Saphyr, SmartMatriX2, QuickMatriX,
QuickVu) and the LiveCore family (Ascender 16/32/48, NeXtage 8/16, SmartMatriX
Ultra) — a modern, dependency-light control surface for hardware whose original
software is long out of date — and has an early mode for the current range,
**LivePremier** (Aquilon), **Midra 4K** (QuickVu 4K, Pulse 4K, Eikos 4K,
QuickMatrix 4K) and **Alta 4K** (Zenith 100/200), built on those families' own
published protocol.

![The openrcs Workspace — the source palette, every screen editable side by side in program and preview, and memories, on one page](docs/screenshots/workspace.png)

**[Try the control surface in your browser →](https://openrcs-demo.stoatworks-labs.com)**
— the real UI, unmodified, running against a simulated device. No processor is
involved and nothing can reach hardware: a browser has no raw TCP socket, so the
demo replaces the transport and keeps the app. See [demo/](demo/) for how it
works and what it can't show.

Not affiliated with or endorsed by Analog Way. Product names are used only to
describe compatibility.

<!-- downloads:start -->

## Download

**[v0.5.2](https://github.com/stoatworks-labs/openrcs/releases/tag/v0.5.2)** — prebuilt for macOS, Windows and Linux. Pick your platform:

<details>
<summary><b>macOS</b> — Apple Silicon, Intel</summary>

| Build | Download | Size |
| --- | --- | --- |
| Apple Silicon · .dmg disk image (CLI) | [`openrcs-server-0.5.2-macos-aarch64-cli.dmg`](https://github.com/stoatworks-labs/openrcs/releases/download/v0.5.2/openrcs-server-0.5.2-macos-aarch64-cli.dmg) | 1.7 MB |
| Intel · .dmg disk image (CLI) | [`openrcs-server-0.5.2-macos-x86_64-cli.dmg`](https://github.com/stoatworks-labs/openrcs/releases/download/v0.5.2/openrcs-server-0.5.2-macos-x86_64-cli.dmg) | 1.7 MB |
| Apple Silicon · .pkg installer (CLI) | [`openrcs-server-0.5.2-macos-aarch64-cli.pkg`](https://github.com/stoatworks-labs/openrcs/releases/download/v0.5.2/openrcs-server-0.5.2-macos-aarch64-cli.pkg) | 1.2 MB |
| Intel · .pkg installer (CLI) | [`openrcs-server-0.5.2-macos-x86_64-cli.pkg`](https://github.com/stoatworks-labs/openrcs/releases/download/v0.5.2/openrcs-server-0.5.2-macos-x86_64-cli.pkg) | 1.2 MB |
| Apple Silicon · .tar.gz archive | [`openrcs-server-macos-aarch64.tar.gz`](https://github.com/stoatworks-labs/openrcs/releases/latest/download/openrcs-server-macos-aarch64.tar.gz) | 1.2 MB |
| Intel · .tar.gz archive | [`openrcs-server-macos-x86_64.tar.gz`](https://github.com/stoatworks-labs/openrcs/releases/latest/download/openrcs-server-macos-x86_64.tar.gz) | 1.2 MB |

</details>

<details>
<summary><b>Windows</b> — x64, ARM64</summary>

| Build | Download | Size |
| --- | --- | --- |
| x64 · .exe installer | [`openrcs-server-0.5.2-windows-x86_64-setup.exe`](https://github.com/stoatworks-labs/openrcs/releases/download/v0.5.2/openrcs-server-0.5.2-windows-x86_64-setup.exe) | 933 KB |
| ARM64 · .exe installer | [`openrcs-server-0.5.2-windows-aarch64-setup.exe`](https://github.com/stoatworks-labs/openrcs/releases/download/v0.5.2/openrcs-server-0.5.2-windows-aarch64-setup.exe) | 851 KB |
| x64 · .zip archive | [`openrcs-server-windows-x86_64.zip`](https://github.com/stoatworks-labs/openrcs/releases/latest/download/openrcs-server-windows-x86_64.zip) | 1.0 MB |
| ARM64 · .zip archive | [`openrcs-server-windows-aarch64.zip`](https://github.com/stoatworks-labs/openrcs/releases/latest/download/openrcs-server-windows-aarch64.zip) | 991 KB |

</details>

<details>
<summary><b>Linux</b> — x64, ARM64</summary>

| Build | Download | Size |
| --- | --- | --- |
| x64 · .deb package (Debian/Ubuntu) | [`openrcs-server_0.5.2_amd64.deb`](https://github.com/stoatworks-labs/openrcs/releases/download/v0.5.2/openrcs-server_0.5.2_amd64.deb) | 1.4 MB |
| ARM64 · .deb package (Debian/Ubuntu) | [`openrcs-server_0.5.2_arm64.deb`](https://github.com/stoatworks-labs/openrcs/releases/download/v0.5.2/openrcs-server_0.5.2_arm64.deb) | 1.4 MB |
| x64 · .rpm package (Fedora/RHEL) | [`openrcs-server-0.5.2-1.x86_64.rpm`](https://github.com/stoatworks-labs/openrcs/releases/download/v0.5.2/openrcs-server-0.5.2-1.x86_64.rpm) | 1.4 MB |
| ARM64 · .rpm package (Fedora/RHEL) | [`openrcs-server-0.5.2-1.aarch64.rpm`](https://github.com/stoatworks-labs/openrcs/releases/download/v0.5.2/openrcs-server-0.5.2-1.aarch64.rpm) | 1.4 MB |
| x64 · .tar.gz archive | [`openrcs-server-linux-x86_64.tar.gz`](https://github.com/stoatworks-labs/openrcs/releases/latest/download/openrcs-server-linux-x86_64.tar.gz) | 1.3 MB |
| ARM64 · .tar.gz archive | [`openrcs-server-linux-aarch64.tar.gz`](https://github.com/stoatworks-labs/openrcs/releases/latest/download/openrcs-server-linux-aarch64.tar.gz) | 1.4 MB |

</details>

All builds, checksums and release notes: [github.com/stoatworks-labs/openrcs/releases](https://github.com/stoatworks-labs/openrcs/releases).

macOS builds are signed and notarised and open normally. The Windows builds are unsigned, so SmartScreen warns once.

<!-- downloads:end -->

## Status

`openrcs-proto`, the protocol engine, is implemented and tested. The LiveCore
command table (1014 variables) and the Midra table (562) are complete with
per-variable dimensions, ranges, and read-only flags. Both have been validated
against real hardware — a **NeXtage 16** (LiveCore) and a **Pulse2** (Midra):
device identity, framing, live layer control and takes, memories, EDID and the
per-platform quirks are all confirmed on the wire. Per-variable ranges are still
strong guidance rather than a guarantee, and a few behaviours depend on model,
firmware or a live input signal.

Two things this release added are worth calling out for what is and is not proven.
The Midra **video out** — its three plug modes, its screen sources, and its area of
interest — is confirmed on a Pulse2, including watching the SDI plug move between
outputs as the mode changes. The LiveCore **per-output area of interest** is not:
the values stage and the apply is accepted, but the device's own status readback
never moved off a fixed size on a NeXtage 16, so the panel shows that readback
rather than the numbers typed into it, and warns when it sees it.

**LivePremier (Aquilon) is in field testing.** `openrcs-awj` implements the AWJ
protocol — JSON over TCP 10606, from Analog Way's published Programmer's Guide
rather than from reverse engineering — and the surface gains two views for it:
screens in use with their transition state and take times, and the screen preset
bank. Reading has been exercised against **two different Aquilon C frames** on
firmware 6.2.73 — most recently 2026-09-09 — with `openrcs-awj`'s own `awjprobe`
example: model, labels, transition, preset letters and bank validity all come
back clean on both.

The controls that write — take, cut, preset recall, and the subscription list
behind "Live updates" — have been exercised end to end against the **LivePremier
simulator**, and **the AWJ operations underneath them are now confirmed on real
hardware**: a TAKE measured at 1.07 s against a configured 1.0 s fade, a preset
saved and recalled onto preview, a recall of an empty slot passing silently, and
a second socket receiving a push for a write made on the first — the exact
mechanism behind "Live updates". Those hardware writes were sent by a separate
test harness rather than by this code, so what is proven is the protocol, not
yet `openrcs`'s own write path. Treat the plumbing between the surface and the
wire as still simulator-only, and the wire itself as settled.

Two hardware facts worth carrying into any AWJ client: an `x…` trigger property
stays `true` after firing, so reading one back is never confirmation; and a
preset recall overwrites the screen's `takeUpTime`, so any fade must be written
*after* the load, not before.

**Midra 4K and Alta 4K are the same protocol over a different object model**,
and `openrcs-awj` spells that model too (`openrcs_awj::mng`): four screens and
four auxiliaries keyed by number in two lists, one `takeTime`, preset buffers
literally named `UP` and `DOWN`, three banks (screen, auxiliary and master —
the auxiliaries have one of their own), and "in service" read from the applied
configuration rather than the destination. Every path was read off a **Pulse 4K
on firmware 3.3.10** on 2026-09-12 — and the LivePremier spellings were read
off the same box as a control: every one answers `E12` there, which is why the
two are separate modules and why the surface tells you when it has been pointed
at the wrong one. The take, cut, recall and subscription operations underneath
were fired at that Pulse 4K by a separate test harness and behaved as the
LivePremier ones do (a subscribed second socket saw a write within 40 ms).
`openrcs`'s own surface for these goes further than the LivePremier one:
**Screens** with a T-bar, take time, freeze, copy-to-preview, step back, the
preset toggle, Take all and the device's **quick preset** (fade to black, a
library image or a master memory, on and off from one switch); a **Layers**
editor — drag and resize a screen's live layers on its canvas with the unit's
own pictures on them, set their sources, opacity, freeze and fader, and every
other property the device declares, plus the preset's **background** (a set or
a colour) and **top frame**, or an auxiliary's background source; **Presets**
that save, label and erase as well as recall, with a master save that refuses
to overwrite the screen and aux slots the device would otherwise write
silently; **Inputs** with thumbnails, plug, signal, freeze, black and the
device's own tally lists; **Multiviewer** — the monitoring output's windows
on a canvas, drag and resize, sources, twenty layout memories and the three
timers; **Outputs** — role, format (applied through the device's own update
trigger), plug, test pattern and picture settings; **Stills** — the fifty-slot
library, a capture into it, and each screen's frame slots; **System** —
identity, network, temperatures, fans, the front panel and a reboot; and an
**Inspector** over any AWJ path with the wire log, which LivePremier gets too.
All of it has been driven end to end against the vendor's **Midra 4K (3.2.29)
and Alta 4K (1.3.7) simulators** only — and three things the simulators do not
do are written but unproven: a timer never leaves `IDLE`, a capture never
completes, and the tally lists never fill. The paths
behind the newer views were spelled from the Pulse 4K's own store dump rather
than answered over AWJ by the unit — the simulators answer every one — so a
`get` of those on a real unit is still owed. One difference from the LivePremier
simulator is worth knowing: these two *do* reproduce the
recall-overwrites-the-take-time behaviour, so what you see on them is what the
hardware does.

`openrcs-server` adds a browser control surface over that engine (see below).
Roadmap: package it as a system-tray app, then a standalone gateway (Pi or
ESP32) between the processor and its clients. The protocol engine is
`no_std`-friendly so the same code backs all of them.

How all of this compares with the vendor's own control software — the RCS²
for Midra, the Web RCS for LiveCore, LivePremier and Midra 4K — feature by
feature, with what is full, partial, missing or beyond stock on each family:
[docs/COMPARISON.md](docs/COMPARISON.md).

## Web control surface

`openrcs-server` bridges a browser control panel to a processor: it holds one
TCP connection to the device, caches state, and relays a small JSON protocol
over a websocket to any number of browsers.

**Prefer not to touch the command line?** Grab the
**[tray launcher](https://github.com/stoatworks-labs/openrcs/releases/tag/launcher-v0.1.0)**
(macOS, Windows, Linux) — a menu-bar app that bundles the server: enter the
switcher's IP, pick the model, click **Start**, then **Open**. The macOS builds
are signed and notarized.

Otherwise grab a prebuilt `openrcs-server` binary from the
[latest release](https://github.com/stoatworks-labs/openrcs/releases/latest)
(macOS, Linux and Windows; the UI is embedded, so it's a single self-contained
file), or run it from source:

```bash
cargo run -p openrcs-server -- --device <processor-ip> --platform livecore
# ...or --platform midra, --platform livepremier for an Aquilon,
# --platform midra4k for a QuickVu/Pulse/Eikos/QuickMatrix 4K,
# --platform alta4k for a Zenith 100/200
# then open http://127.0.0.1:8730/
```

The port is optional — each family has its own (10500 for LiveCore and Midra,
10606 for LivePremier, Midra 4K and Alta 4K) and it is filled in from
`--platform`.

`--device` is optional: without it the server starts unconfigured and the
**Connection** view sets the processor from the UI — keypad or network scan —
remembering it for next time. That makes the server usable on a machine with no
convenient command line, such as a dedicated control panel.

### Running it on a dedicated panel

`--tailnet` adds one more view, and it is **off unless you ask for it**. It
shows what the *host running the server* is called on your
[Tailscale](https://tailscale.com) tailnet, whether it is connected, and lets
you connect, disconnect and rename it — from the touchscreen, with an on-screen
keyboard.

That is only useful, and only appropriate, on a box the control surface owns:
an appliance with no keyboard and no shell, where "why can't I reach this panel"
is otherwise unanswerable without carrying a laptop to it. On an ordinary
install the flag is off, the view does not exist, and the server ignores the
messages behind it — the gate is enforced at the server, not by a UI that hides
a button.

```bash
openrcs-server --tailnet --listen 127.0.0.1:8730
```

Two things worth knowing before turning it on:

- **The surface has no authentication.** Anyone who can reach the UI can take
  that host off the tailnet. Pair `--tailnet` with a loopback `--listen`, which
  is the default, unless you have a reason not to.
- **The server does not need to be root, but it does need to be the operator.**
  `tailscale up --operator=<user>` grants the account the server runs as; without
  it the view renders and every button returns "access denied".

The UI is **platform-aware** — it reads the variable table the device advertises
and shows only the views that processor supports. It centres on a **Workspace**
working page — sources (inputs and stills), every screen editable side by side
in program, preview or both at once, one-click layout presets, and memories on a
single window-filling page — backed by a **Stage** overview and a **Wall** map
that places each screen at its real output position; a graphical **Layers**
editor (drag/resize, source, opacity, border, crop, layer transitions, built-in
layouts); **Destinations** that take, cut and T-bar whole screen groups at once;
**Memories** — master, screen and **layer** banks, with each slot's device label,
the processor's own twelve-category record filter on every recall, and a layer
bank that captures one layer's whole property set and verifies each recall by
reading the layer back; **Cues** (a show script with per-cue autofollow), **Keys**
(one-tap macros) and **Live**; a big-target **Show mode** for front-of-house; and
**Shows** — capture the device's whole state to a portable file and restore it,
with an instant **Confidence** undo and an offline **Plan** mode that stages a
look with no device attached and pushes it on connect. Setup covers **Inputs**,
**Outputs** (with a per-output area of interest on LiveCore), **Video out** on a
Midra — the frame's second output, with its own format and a draggable crop of a
screen — **Screens** with a **working area** that keeps layers inside the part of
a screen that is actually seen, **Stills**, a live **Tally**, **Capture**,
**Multiviewer** and **Soft edge** designers, **EDID** management with a
custom-EDID writer, **GPIO** and **System**; **Tools** add an **Inspector** over
every device variable and a raw-protocol **Console**. It's a dependency-free
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

## Drive it from a control surface

**[companion-module-openrcs](https://github.com/stoatworks-labs/companion-module-openrcs)**
is a [Bitfocus Companion](https://bitfocus.io/companion) module built on the same
protocol — take and cut screens and groups, run the T-bar, recall memories,
freeze and black, with on-air tally — for driving the switcher from a Stream Deck
or other control surface.

<!-- attributions:start -->
This project is built on other people's work — see [ATTRIBUTIONS.md](ATTRIBUTIONS.md).
<!-- attributions:end -->

## Licence

MIT.
