# Attributions

openrcs is built on other people's work. This file lists what that work is, who did
it, and what it is doing here.

It is generated — the master lists live in the `stoatworks-backend` repo and are
pushed out by `scripts/sync-attributions.py`. Edit it there, not here.

## Code we derived from other people's work

Someone else solved this first, and this project would not exist in its current form without their work.

### blackmagic-misc — Sylvain "tnt" Munaut

<https://github.com/smunaut/blackmagic-misc>  
Licence: Apache-2.0 (SPDX header in bmd.py; the repo has no LICENSE file, so GitHub does not detect it)  
Copyright: 2021 Sylvain Munaut

Blackmagic has never published the DaVinci Resolve Speed Editor's HID protocol, and the panel reports nothing until a challenge-response handshake completes. The handshake, the report formats and the jog modes in the Speed Editor plugin's speed-editor.js come from Munaut's reverse engineering in bmd.py. The file is vendored from awj-surface by way of livepremier-plus.

### node-blackmagic-controller — Julian Waller

<https://github.com/Julusian/node-blackmagic-controller>  
Licence: MIT  
Copyright: 2024 Julian Waller

The Speed Editor's key and LED tables in speed-editor.js follow node-blackmagic-controller, the library Bitfocus Companion drives the panel with.

### Otter EDID editor — Stoatworks otter-edid-editor

<https://github.com/stoatworks-labs/otter-edid-editor>  
Licence: MIT  
Copyright: Stoatworks Labs

Same fleet, copied rather than shared: the EDID Builder plugin's otter-edid-embed.js is otter-edid-editor's embed build, vendored unchanged. It bundles React, React DOM and Scheduler, credited below.

## Third-party code this project uses

Libraries, SDKs and frameworks the project is built on or bundles.

### Tauri

<https://tauri.app>  
Licence: MIT or Apache-2.0  
Copyright: The Tauri Programme within The Commons Conservancy

A Cargo and npm dependency — of the app itself under src-tauri/, or of the desktop launcher under launcher/src-tauri/.

Wraps a web front end in a native desktop app using the platform's own webview rather than a bundled browser, so the binary stays small.

### React, React DOM and Scheduler

<https://react.dev>  
Licence: MIT  
Copyright: Meta Platforms, Inc. and affiliates

Compiled into the vendored Otter EDID editor build, otter-edid-embed.js, with each package's MIT header kept in place (React 19.3.0 at the pinned build).

The UI layer of the embedded EDID editor. The repo does not depend on React itself; it arrives only inside that one vendored file.

### The Rust crate ecosystem

<https://crates.io>  
Licence: predominantly MIT or Apache-2.0  
Copyright: the individual crate authors

Cargo dependencies, resolved and pinned in Cargo.lock.

Async runtimes, protocol codecs, serialisation and GUI toolkits. The exact set and versions for any build are in that repo's Cargo.lock, which is the authoritative list.

The full transitive dependency set for any build is pinned in this repo's lockfile,
which is the authoritative list. What is named above is the layers a reader would
want to know about, not every package that has ever been resolved.

## Work we checked ourselves against

No code was taken from these — but they were how we knew we had it right, and that is worth saying out loud.

### Analog Way LiveCore documentation and a vendor simulator

The control protocol was recovered by reading Analog Way's own published documentation and validating against their simulator. No vendor code was used.

## Getting this wrong

If your work is here and the description is inaccurate, the licence is wrong, or you would rather not be listed — open an issue and it will be fixed.
