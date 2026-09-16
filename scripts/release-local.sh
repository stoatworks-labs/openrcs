#!/usr/bin/env bash
# release-local.sh — cut a full openrcs release from this Mac.
#
# The heavy lifting lives in scripts/release-rust.sh, shared across the fleet;
# this file only says what openrcs is.
#
#   scripts/release-local.sh                  build into dist-release/
#   scripts/release-local.sh --version 0.3.0  set an explicit version
#   scripts/release-local.sh --upload         tag and publish the GitHub release
#
# Two shapes come out of one release. The command-line packages (.pkg/.dmg,
# .deb/.rpm, the Windows CLI installer, the tarballs) are the appliance
# install: a box in the rack that only runs the server. The launcher/ tray app
# bundles the same openrcs-server for a laptop next to the switcher — see
# launcher/README.md. Locally the launcher is built per Mac architecture; CI
# builds it universal, plus the Windows and Linux bundles Tauri cannot
# cross-compile.
#
# The web control surface needs no prebuild step — rust-embed bakes
# crates/openrcs-server/web/ into the binary at compile time, so a release
# always carries the UI that was in the tree when it was built. If you changed
# anything under web/, re-run demo/build-demo.sh too: the hosted demo is a copy
# of those same files and will otherwise drift from what ships.
set -euo pipefail

RR_NAME="openrcs"
RR_SLUG="openrcs-server"
RR_IDENT="com.stoatworks.openrcs"
RR_EXTRA_FILES=("README.md" "LICENSE" "ATTRIBUTIONS.md")
RR_LAUNCHER="launcher"
RR_APP_NAME="openRCS.app"
RR_SERVER_BIN="openrcs-server"

source "$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/release-rust.sh"
