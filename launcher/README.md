# openRCS — desktop app

A small menu-bar / system-tray app for openrcs: pick a network interface and
port, Start/Stop the control surface, open it in your browser, and leave it
running in the tray. Built with [Tauri v2](https://tauri.app). The
`openrcs-server` binary is **bundled inside the app** — one download, nothing
to install beside it.

This is the shape for a laptop next to the switcher. For a box in the rack
that only ever runs the server, use the command-line packages from the same
release instead (`.pkg`, `.deb`, `.rpm`, the Windows CLI installer); they need
no tray and no desktop session.

Download the `.dmg` / `.pkg` (macOS, universal), `-setup.exe` (Windows) or
`.deb` / `.rpm` (Linux) from
[Releases](https://github.com/stoatworks-labs/openrcs/releases).

## What it does

- **Network interface** — every bindable IPv4 interface, plus "All interfaces (0.0.0.0)".
- **Port** — persisted between runs (default 8730).
- **Start / Stop** — supervises the bundled `openrcs-server` process.
- **Open** — opens `http://<host>:<port>/` (the control surface) in your browser.
- **Hide** to the tray; **Quit** stops the server and exits.

The panel is themed to match openrcs's own web UI. The launcher only chooses
where the surface listens (`--listen host:port`); which switcher to drive, and
which model it is, are set in the surface's **Connection** view and kept by the
server in its own config file.

## Building from source

The desktop build bundles the release `openrcs-server` binary (git-ignored —
it ships in the Release), so build it first:

```bash
cd launcher
./scripts/prepare.sh          # builds openrcs-server --release, copies it into src-tauri/bin/
npm install
npm run tauri build           # -> src-tauri/target/release/bundle/{macos,dmg}/
```

On a Mac, `TARGET=universal-apple-darwin ./scripts/prepare.sh` followed by
`npm run tauri build -- --target universal-apple-darwin --bundles app` is what
the release workflow does: the server inside the app is lipo'd from both
slices, so the one bundle runs on Apple Silicon and Intel alike.

The panel/tray shell is a copy of the reusable
[av-launcher](https://github.com/stoatworks-labs/av-launcher) (`src/`,
`src-tauri/src/`, `src-tauri/crates/`), taken at av-launcher `f1f95d8`; only
`src-tauri/launcher.toml` (config + theme), `tauri.conf.json`, `Info.plist`,
the icon and the bundled binary are app-specific. Refresh the shell by copying
those files from a newer av-launcher checkout, not by editing them here.
