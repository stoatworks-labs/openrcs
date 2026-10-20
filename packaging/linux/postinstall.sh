#!/bin/sh
# After the .deb or .rpm is unpacked: load the Speed Editor rule and apply it
# to a panel that's already plugged in, so nobody has to replug it. Never
# fails the install: a container or chroot has udevadm but no udevd to ask.
if command -v udevadm >/dev/null 2>&1; then
  { udevadm control --reload-rules && udevadm trigger --subsystem-match=hidraw; } >/dev/null 2>&1 || true
fi
exit 0
