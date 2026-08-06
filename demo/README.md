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
there; `device.js` installs one. Everything above the transport — all seventeen
views — is the same code the bridge server serves.

## What's here

| File | What it is |
|---|---|
| `fixtures.json` | The recorded variable table and device state the demo starts from |
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
