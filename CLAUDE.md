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
    │   ├── graph.js          # renderGraph() — 2D canvas time-series renderer
    │   └── main.js           # app logic, polling, bindings, plots, UI
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

# Binding Configs

A config bar sits above the tab strip in the right panel. Two persistence mechanisms:

**Named presets** (localStorage, key: `sink_presets`):
- Save: prompts for a name, stores `{ bindings }` snapshot
- Load: restores a saved preset's bindings immediately
- Delete: removes a preset after confirmation

**File export/import**:
- Export: downloads current bindings as `sink-config-YYYY-MM-DD.json`
- Import: reads a JSON file; accepts `{ version, saved, bindings }` or a bare `{ key: expr }` object

Config file format:
```json
{
  "version": 2,
  "saved": "2026-05-01T12:00:00.000Z",
  "bindings": {
    "motor_demo:motor_shaft:rotation.y": "data.motor_position",
    "motor_demo:indicator:position.x":   "Math.sin(data.motor_position) * 3"
  }
}
```

# 2D Graph

The center panel has two view tabs: **3D Scene** and **Graph**.

The Graph view is a Canvas 2D time-series plot (`graph.js` / `renderGraph()`):
- 60-second rolling X window, auto-scaling Y axis
- Redraws every time `pollAllLatest` fires (500ms) while visible
- `niceTicks()` generates clean round Y axis labels
- Plot lines are clipped to the graph area; legend shown top-left

**Plot lines** are configured in the **Plots** tab of the right panel:
- Each plot line has a name, a color (click the dot to cycle through the palette), and a JS expression
- Same expression system as bindings: `data.label_name`, `Math.*`, arbitrary arithmetic
- `evalExprWithSnap(expr, snap)` evaluates each expression against a historical snapshot (not just the latest value), so the full 60-second trace is plotted correctly
- Plot lines stored in `localStorage` under key `sink_plot_lines` as `[{ id, name, expr, color }]`
- Label chips at the top of the Plots tab insert `data.labelname` at cursor, same as in Bindings

**Time-series buffer** (`timeSeriesBuffer`):
- Populated by `pollAllLatest` — each call pushes `{ ts, snap: { label: value } }`
- Trimmed to the last 65 seconds
- Only held in memory (not persisted); resets on page refresh

# Polling Architecture (main.js)

- `pollLabels()` — every 2s — refreshes available label list; only rebuilds binding/plot panels when the list actually changes
- `pollAllLatest()` — every 500ms — fetches `latest.php`; updates `latestByLabel`, pushes to `timeSeriesBuffer`, applies viewport bindings, redraws graph if visible
- `applyBindingsToViewport()` — every 50ms — pushes cached values into Three.js at ~20fps; no I/O
- `fetchHistory(label)` — on-demand only — called when user opens the Data tab; hits `data.php`

**Expression evaluators** (both use `new Function` with `data` proxy + `Math` only):
- `evalExpression(expr)` — uses current `latestByLabel` (for live binding status dots)
- `evalExprWithSnap(expr, snap)` — uses an explicit snapshot object (for graph history)

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
