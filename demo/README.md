# demo — the browsable openrcs

Live at **<https://openrcs-demo.stoatworks-labs.com>**.

The real control surface, unmodified, running against a device that exists only
in the page. It is a shop window, not a tool: nothing here can reach hardware.

## Why it has to work this way

openrcs normally runs as a bridge server holding one TCP connection to the
processor on port 10500, serving this UI to any number of browsers. A page on
the public internet cannot do that half:

- A browser has no raw TCP API at all. There is no arrangement in which a tab
  opens a socket to a processor.
- A Cloudflare Worker cannot stand in for the bridge either — outbound
  `connect()` refuses private-network addresses, so an edge Worker has no route
  to a switcher on a venue LAN.

So the demo replaces the transport, not the app. `web/app.js` looks for
`globalThis.OPENRCS_DEMO_DEVICE` and uses it in place of the WebSocket if it is
there; `device.js` installs one. Everything above the transport — all nineteen
views — is the same code the bridge server serves.

## What's here

| File | What it is |
|---|---|
| `fixtures.json` | The recorded variable table and device state the demo starts from |
| `fixtures-pls300.json` | The table-derived PLS300 state, loaded by `?device=pls300` |
| `table-fixture.py` | Derives a fixture from a `protocol/*.json` table, for a platform nobody has recorded |
| `device.js` | The simulated device: same message contract as the bridge's websocket |
| `demo-footer.js` | The standing "this is a demo" banner and the limitations footer |
| `demo.css` | The layout changes the hosted build needs (the app is a 100vh grid) |
| `support-footer.js` | Vendored from `stoatworks-backend/support-footer` — edit it there |
| `build-demo.sh` | Assembles `dist/` |
| `serve-demo.py` | Serves `dist/` locally with the headers a static host sends |

## The fixture is recorded, not written

`fixtures.json` holds 1,014 variable definitions and 3,797 values, all captured
from `openrcs-server` connected to a real LiveCore device session — driven into
a show-like state first (two screens, four layers each, six master and five
screen memories), then every view visited so each one's own requests populated
the bridge's cache.

Hand-authoring that would be a guess about what the device does, and guesses
drift away from the protocol without anything failing loudly. If the fixture
needs regenerating, record it again rather than editing it.

**`fixtures-pls300.json` is the one exception**, and says so in its `source`.
No PLS300 has answered openrcs, so there is nothing to record; the PLS300
surface exists from the published Programmer's Guide alone, and this fixture
is derived from that table by `table-fixture.py` — every variable at the
guide's default, plus a show-like overlay so the views have something to draw.
`?device=pls300` on the demo URL loads it instead of the LiveCore recording.
Regenerate it with `python3 demo/table-fixture.py pls300 > demo/fixtures-pls300.json`
after a table change; do not hand-edit it either.

## What the simulated device actually models

From the control surface's point of view a processor is mostly a large
key-value store that echoes what you write to it, so that is the default: a set
is checked against the variable's own declared dimensions and range, then
echoed back. On top of that sit the behaviours where the device *does*
something rather than just remembers something:

- **Take** — preview (context 1) becomes program (context 0) for a screen.
- **Master memories** — save captures program, recall restores into preview,
  load-and-take does both.
- **Screen memories** — the same, per screen, and portable across screens.
- **Still erase** and **capture-done**, which otherwise leave the UI hanging.
- On the PLS300 fixture: **TAKE** (next becomes current, current becomes
  previous), **preset copy** (`Nf`/`Nt`/`Nc`, which is what a recall or a save
  is), a picture record or delete landing in the validity bitfields, and the
  triggers the guide marks "auto reset" falling back to 0.

Everything else is an honest echo. Where the real device would do something
this cannot know about — video actually moving, a signal appearing on an
input — it does nothing rather than invent a plausible result.

## Rebuilding

```sh
demo/build-demo.sh                       # after changing web/ or anything here
python3 demo/serve-demo.py --dir demo/dist --port 4291
```

`dist/` is committed on purpose: assembling it means recording a device
session, which a build container cannot do. Cloudflare publishes what is
already in the repo, with no build command — see `wrangler.toml` at the root.

```sh
cf-run npx wrangler deploy
```
