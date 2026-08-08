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
# There is no Tauri launcher in this repo: the tray launcher is a build of
# av-launcher, released separately under its own tag, so RR_LAUNCHER stays unset.
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

source "$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/release-rust.sh"
