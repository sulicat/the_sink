# The Sink

A webapp that ingests timestamped, labelled data from external sources and visualises it live in a 3D scene.

- Exposes simple HTTP endpoints to receive data (label + value + optional timestamp)
- Stores up to 10 minutes of data locally (SQLite, rolling window)
- Hosts a website where the user picks a 3D scene, then binds data labels to object properties (e.g. `motor_position` → `rotation.y` of a cylinder)

# For Claude

- Hosted in Docker — easy to start/stop with `docker compose up --build`
- Data endpoints are intentionally simple; keep the protocol simple too
- 3D scene controls should feel like Blender (MMB orbit, Shift+MMB pan, scroll zoom, numpad presets)
- Scene definitions are simple JSON files — only spheres, cubes, planes, cylinders to start
- GUI should be easy to understand; data easy to categorise
- The 3D scene always reflects the **latest** value of any bound label — do not replay history
  - History is stored only so slower-rate data is still viewable/attachable in the data panel
- Selecting "None" for a binding resets that object property to 0 immediately
- Bindings are persisted in `localStorage` (key: `sink_bindings`)
- Do not rebuild UI panels unnecessarily — only rebuild dropdowns when the label list actually changes, to avoid disrupting user interaction

# Tech Stack

- nginx + PHP 8.1 + SQLite (via PDO) inside Docker (ubuntu:22.04)
- Plain HTML / CSS / JS — no Node, no build tools, no frameworks
- Three.js r128 (loaded from CDN) for 3D
- Minimal dependencies — only what is necessary

# File Structure

```
the_sink/
├── Dockerfile
├── docker-compose.yml
├── start.sh                  # starts php-fpm then nginx
├── nginx/
│   └── default.conf
├── tests/
│   ├── send_single.sh        # curl one data point
│   ├── simulate_motor.sh     # bash motor sim
│   ├── simulate_motor.py     # python motor sim (preferred)
│   └── simulate_solar.py     # python solar system orbit sim
└── www/
    ├── index.html            # single-page app, all CSS inline
    ├── js/
    │   ├── viewport.js       # class Viewport — Three.js scene + Blender controls
    │   └── main.js           # app logic, polling, bindings, UI
    ├── scenes/
    │   ├── motor_demo.json
    │   └── solar_system.json
    └── api/
        ├── db.php            # shared SQLite connection + table init
        ├── ingest.php        # POST (or GET) to push a data point
        ├── data.php          # GET ?label=X — full history (up to 200 pts, 10 min)
        ├── labels.php        # GET — all labels active in last 10 min
        └── latest.php        # GET — single most-recent value per label (used by scene)
```

# Data Protocol

**Ingest** — POST `/api/ingest.php` with JSON body:
```json
{ "label": "motor_position", "value": 1.57, "timestamp": 1234567890 }
```
Timestamp is optional (defaults to `time()`). Also accepts GET params for easy testing:
```
GET /api/ingest.php?label=motor_position&value=1.57
```

**Latest values** — `GET /api/latest.php` returns one entry per label:
```json
[{ "label": "motor_position", "value": 1.57, "timestamp": 1234567890 }, ...]
```

**History** — `GET /api/data.php?label=motor_position` returns up to 200 points (10 min window), oldest first.

# Scene JSON Format

```json
{
  "name": "Scene Name",
  "objects": [
    {
      "id": "unique_id",
      "name": "Display Name",
      "type": "cube | sphere | plane | cylinder",
      "position": [x, y, z],
      "rotation": [x, y, z],
      "scale":    [x, y, z],
      "color": "#4488ff"
    }
  ]
}
```

Bindable properties per object: `rotation.x/y/z`, `position.x/y/z`, `scale.x/y/z`

# Expression Bindings

Each object property is driven by a JS expression string (not a simple label dropdown). The expression is evaluated via `new Function` with two variables in scope:

- `data` — a Proxy; `data.label_name` returns the latest value of that label (0 if unknown)
- `Math` — the standard JS Math object

Examples:
```js
data.motor_position                   // direct value
data.motor_position * 2               // scaled
Math.sin(data.motor_position)         // trig
(data.speed - 30) / 100              // offset + scale
data.x * Math.cos(data.angle)        // combining multiple labels
```

- Bindings are stored in `localStorage` under key `sink_bindings_v2` as `{ "sceneId:objId:prop": "expression string" }`
- Clearing the expression (empty input) resets the property to 0
- Status dot per row: grey = empty, green = valid (shows current value), red = error/NaN
- Label chips at the top of the bindings panel are clickable — they insert `data.labelname` at the cursor position in the focused input

# Polling Architecture (main.js)

- `pollLabels()` — every 2s — refreshes available label list; only rebuilds binding dropdowns when the list actually changes
- `pollAllLatest()` — every 500ms — single call to `latest.php`; updates `latestByLabel` map and drives `applyBindingsToViewport()`
- `applyBindingsToViewport()` — every 50ms — pushes cached values into Three.js at ~20fps; no I/O
- `fetchHistory(label)` — on-demand only — called when user opens the Data tab; hits `data.php`

# Running

```bash
docker compose up --build   # first run
docker compose up           # subsequent runs
docker compose down         # stop
```

Test scripts (no pip install needed for Python ones):
```bash
./tests/send_single.sh motor_position 1.57
python3 tests/simulate_motor.py --rpm 45
python3 tests/simulate_solar.py
```
Set `SINK_HOST=http://...` env var to point at a non-localhost instance.
