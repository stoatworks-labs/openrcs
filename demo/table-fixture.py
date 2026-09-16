#!/usr/bin/env python3
"""Derive a demo fixture from a variable table, for a platform nobody has recorded.

    python3 demo/table-fixture.py pls300 > demo/fixtures-pls300.json

`fixtures.json` is a recording of a real LiveCore session, and that is the
standard: a recorded fixture cannot drift from the protocol. This script is
the exception, for the one platform openrcs supports from a published guide
alone — no PLS300 has answered a connection, so there is nothing to record.

What it writes is every variable at the guide's own default value (clamped
into range where the guide's default falls outside it), then a show-like
overlay so the views have something to draw: a few inputs carrying a signal,
a current and a next preset with different sources on the background and PiP
layers, two user presets filled, two frames and two logos stored, and the
network and version facts a real unit would report. Nothing in the overlay is
a measurement, and the fixture says so in its `source`.
"""
import json
import sys
from itertools import product
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
BIAS = 32768


def clamp(v, lo, hi):
    return max(lo, min(hi, v))


def main(platform):
    table = json.load(open(ROOT / 'protocol' / f'{platform}_protocol.json'))
    vs = sorted(table['variables'], key=lambda v: v['request'])
    meta = {
        'platform': platform,
        'port': table['transport']['port'],
        'vars': [{'m': v['request'], 'name': v['name'], 'group': v['group'], 'dims': v['dims'],
                  'min': v['min'], 'max': v['max'], 'ro': v['readOnly']} for v in vs],
    }
    state = {}

    def put(m, idx, val):
        state[(m, tuple(idx))] = val

    # Every index of every variable at its default. Values are keyed by the
    # answer mnemonic, as the bridge's cache is (`?` answers as `DEV`).
    for v in vs:
        key = v['answer']
        dflt = clamp(v['default'], v['min'], v['max'])
        for idx in product(*[range(d) for d in v['dims']]):
            put(key, idx, dflt)

    if platform == 'pls300':
        overlay(put)

    items = [[m, list(idx), val] for (m, idx), val in sorted(state.items())]
    out = {
        'recorded': None,
        'source': f'derived from protocol/{platform}_protocol.json by demo/table-fixture.py — '
                  'the table\'s defaults plus a show-like overlay; not a recording of a unit',
        'meta': meta,
        'items': items,
    }
    json.dump(out, sys.stdout, separators=(',', ':'))
    sys.stdout.write('\n')


def overlay(put):
    """A PLS300 mid-show, as far as the guide lets one be described."""
    put('DEV', [], 78)
    put('*', [], 1)
    put('TA', [], 1)
    put('xV', [], 42)
    put('xU', [], 3)
    put('xR', [], 2)
    put('yo', [], 1 | 2 | 128)                    # LAN module, SDI board 1, audio evolution
    for k, ver in enumerate([6, 1035, 210, 4012, 4007, 4011, 12]):
        put('xK', [k], ver)
    for k, b in enumerate([0x504C, 0x5333, 0x3030, 0x0001]):
        put(['xi', 'xj', 'xk', 'xl'][k], [], b)
    for k, b in enumerate([192, 168, 2, 140]):
        put('nw', [0, k], b)
    put('np', [0], 10500)
    put('nk', [], 8)
    put('nt', [], 1)
    put('ne', [], 1)

    # Outputs: main at 1080p50, preview at XGA 60.
    put('OF', [0], 22); put('OR', [0], 6); put('OH', [0], 1920); put('OV', [0], 1080); put('OT', [0], 5000)
    put('OF', [1], 12); put('OR', [1], 8); put('OH', [1], 1024); put('OV', [1], 768); put('OT', [1], 6000)
    put('Xl', [0], 1); put('Xt', [0], 5000)

    # Inputs 1–4 analog with a signal, 9–10 DVI with a signal, 11 SDI with a
    # signal, the rest silent. Slots are 0-based with 6 and 7 absent.
    live = {0: (13, 22, 1024, 768, 6000), 1: (13, 36, 1920, 1080, 6000), 2: (4, 13, 1920, 1080, 5000),
            3: (13, 31, 1280, 1024, 6000), 8: (10, 36, 1920, 1080, 6000), 9: (10, 22, 1024, 768, 6000),
            10: (12, 13, 1920, 1080, 5000)}
    for slot in [0, 1, 2, 3, 4, 5, 8, 9, 10, 11]:
        if slot in live:
            typ, fmt, w, h, hz = live[slot]
            put('iK', [slot], typ); put('sc', [slot], 1); put('sF', [slot], fmt); put('sD', [slot], fmt)
            put('sw', [slot], w); put('st', [slot], h); put('sf', [slot], hz)
        else:
            put('iK', [slot], 12 if slot >= 10 else 10 if slot >= 8 else 13)
            put('sc', [slot], 0); put('sF', [slot], 0)
    put('As', [10], 1)

    # Presets. Layers: 0 frame, 2 background live, 3 PiP, 6/7 logos.
    def look(p, frame, bg, pip, pip_rect, logo=0):
        put('IN', [p, 0], frame); put('IN', [p, 2], bg); put('IN', [p, 3], pip); put('IN', [p, 6], logo)
        for l in (0, 2):
            put('pH', [p, l], BIAS); put('pV', [p, l], BIAS); put('pW', [p, l], 1920); put('pS', [p, l], 1080)
        left, top, w, h = pip_rect
        put('pH', [p, 3], BIAS + left); put('pV', [p, 3], BIAS + top); put('pW', [p, 3], w); put('pS', [p, 3], h)
        put('pH', [p, 6], BIAS + 40); put('pV', [p, 6], BIAS + 40); put('pW', [p, 6], 320); put('pS', [p, 6], 180)
        put('bS', [p, 3], 1); put('bH', [p, 3], 6); put('bV', [p, 3], 6)

    look(0, 0, 1, 3, (1200, 80, 640, 360))          # current: input 1 full, input 3 in a PiP
    look(1, 0, 2, 4, (80, 640, 640, 360), logo=1)    # next: input 2 full, input 4 PiP, logo 1
    look(2, 0, 1, 0, (1200, 80, 640, 360))           # previous
    look(3, 1, 0, 9, (240, 135, 1440, 810))          # preset 1: frame 1 with input 9 centred
    look(4, 0, 10, 11, (1200, 80, 640, 360), logo=2)  # preset 2
    # presets 3 and 4 stay empty
    put('NC', [], 2)

    # Two frames and two logos stored.
    put('PF', [], 0b11); put('PZ', [], 0b11)
    for px, (w, h) in {9: (1920, 1080), 10: (1920, 1080), 1: (320, 180), 2: (400, 120)}.items():
        put('Pw', [px], w); put('Ph', [px], h); put('Pn', [px], 1); put('Ps', [px], 2 if px >= 9 else 0)


if __name__ == '__main__':
    main(sys.argv[1] if len(sys.argv) > 1 else 'pls300')
