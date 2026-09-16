#!/usr/bin/env bash
# Build the openrcs-server release binary and copy it into the launcher's
# bundled-resources dir. Run before `npm run tauri build`.
#
#   scripts/prepare.sh                                 host arch
#   TARGET=universal-apple-darwin scripts/prepare.sh   both Mac slices, lipo'd
#   TARGET=x86_64-pc-windows-msvc scripts/prepare.sh   one explicit triple
#
# The binary INSIDE the app has to be universal for a universal app: a fat
# wrapper around a thin server launches on an Intel Mac and then fails the
# moment it starts its own server. cargo has no universal-apple-darwin target
# (it is a Tauri bundling target), so that case builds both real triples and
# lipos them.
set -euo pipefail
HERE="$(cd "$(dirname "$0")/.." && pwd)"      # launcher/
REPO="$(cd "$HERE/.." && pwd)"                # repo root
TARGET="${TARGET:-}"
# Where cargo puts the build — honour an override, as cargo itself does.
T="${CARGO_TARGET_DIR:-$REPO/target}"
OUT="$HERE/src-tauri/bin"
mkdir -p "$OUT"

if [[ "$TARGET" == "universal-apple-darwin" ]]; then
  ( cd "$REPO" \
    && cargo build --release --target aarch64-apple-darwin -p openrcs-server \
    && cargo build --release --target x86_64-apple-darwin  -p openrcs-server )
  lipo -create \
    "$T/aarch64-apple-darwin/release/openrcs-server" \
    "$T/x86_64-apple-darwin/release/openrcs-server" \
    -output "$OUT/openrcs-server"
  archs="$(lipo -archs "$OUT/openrcs-server")"
  case "$archs" in *arm64*x86_64*|*x86_64*arm64*) ;;
    *) echo "error: expected a universal openrcs-server, got: $archs" >&2; exit 1 ;;
  esac
elif [[ -n "$TARGET" ]]; then
  ext=""; [[ "$TARGET" == *windows* ]] && ext=".exe"
  ( cd "$REPO" && cargo build --release --target "$TARGET" -p openrcs-server )
  cp "$T/$TARGET/release/openrcs-server${ext}" "$OUT/openrcs-server${ext}"
else
  ext=""; [[ "$(uname -s)" == MINGW* || "$(uname -s)" == MSYS* ]] && ext=".exe"
  ( cd "$REPO" && cargo build --release -p openrcs-server )
  cp "$T/release/openrcs-server${ext}" "$OUT/openrcs-server${ext}"
fi
chmod +x "$OUT"/openrcs-server* || true
echo "prepared src-tauri/bin/openrcs-server"
