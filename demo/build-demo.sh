#!/usr/bin/env bash
#
# Assemble the hosted demo into demo/dist.
#
# The demo is the real control surface — app.js and style.css are copied from
# the server's web/ directory untouched, so the hosted build can't drift into
# being a different app. What's added is the simulated device, the recorded
# fixture it starts from, and the banner and footer that say what it is.
#
# dist/ is committed on purpose. Assembling it means recording a real device
# session, which a build container cannot do, so Cloudflare publishes what is
# already here and there is no build command.
#
# Re-run after changing web/app.js, web/style.css, or anything in demo/.
set -euo pipefail

here="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
web="$here/../crates/openrcs-server/web"
dist="$here/dist"

for f in app.js style.css; do
  [ -f "$web/$f" ] || { echo "missing $web/$f" >&2; exit 1; }
done
[ -f "$here/fixtures.json" ] || { echo "missing demo/fixtures.json — record it first" >&2; exit 1; }

# A stable stamp so the CDN can actually cache the assets. The server build
# uses Date.now() to defeat caching while the UI is iterated live; a published
# demo wants the opposite.
#
# Hash the content rather than naming a commit: a build cannot know the sha of
# the commit that will contain it, so a `git rev-parse HEAD` stamp is always one
# commit stale. A content hash changes exactly when the assets change, which is
# the only thing the query string is for.
stamp="$(cat "$web/app.js" "$web/style.css" "$here/device.js" "$here/demo.css" \
              "$here/demo-footer.js" "$here/support-footer.js" "$here/fixtures.json" \
         | shasum -a 256 | cut -c1-8)"

rm -rf "$dist"
mkdir -p "$dist"
cp "$web/app.js" "$web/style.css" "$dist/"
cp "$here/device.js" "$here/demo.css" "$here/demo-footer.js" \
   "$here/support-footer.js" "$here/fixtures.json" "$dist/"

# index.html is generated rather than copied: the demo has to install the
# simulated device BEFORE app.js runs, and wants a fixed asset version.
cat > "$dist/index.html" <<HTML
<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>openrcs — demo</title>
<meta name="description" content="A browsable demo of openrcs, the open control surface for Analog Way Midra and LiveCore video processors. Runs a simulated device in your browser.">
<link rel="icon" href="data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 16 16'%3E%3Crect width='16' height='16' rx='3' fill='%230d1015'/%3E%3Crect x='3' y='4' width='10' height='3' rx='1' fill='%2322b8cf'/%3E%3Crect x='3' y='9' width='6' height='3' rx='1' fill='%233fb950'/%3E%3C/svg%3E">
<link rel="stylesheet" href="style.css?v=$stamp">
<link rel="stylesheet" href="demo.css?v=$stamp">
</head>
<body>
<!-- Installs globalThis.OPENRCS_DEMO_DEVICE. Classic, not deferred: it has to
     exist before app.js constructs its Store and looks for the seam. -->
<script src="device.js?v=$stamp" data-fixtures="./fixtures.json?v=$stamp"></script>
<div id="app" class="app"></div>
<script type="module">import('./app.js?v=$stamp');</script>
<script src="demo-footer.js?v=$stamp" defer></script>
<script src="support-footer.js?v=$stamp" defer
        data-app="openrcs"
        data-repo="https://github.com/stoatworks-labs/openrcs"
        data-note="This is a demo running a simulated device in your browser — no processor is involved, and nothing you do here leaves the tab."
></script>
</body>
</html>
HTML

echo "built $dist"
ls -la "$dist"
