/* main.js — App logic for The Sink */

// ---------------------------------------------------------------------------
// Constants & globals
// ---------------------------------------------------------------------------

const SCENES = [
    { id: 'motor_demo',   label: 'Motor Demo',    file: '/scenes/motor_demo.json'   },
    { id: 'solar_system', label: 'Solar System',  file: '/scenes/solar_system.json' },
];

const BINDABLE_PROPERTIES = [
    'rotation.x', 'rotation.y', 'rotation.z',
    'position.x', 'position.y', 'position.z',
    'scale.x',    'scale.y',    'scale.z',
];

const STORAGE_KEY = 'sink_bindings';
const POLL_LABELS_MS = 2000;
const POLL_DATA_MS   = 500;

let viewport        = null;
let currentScene    = null;   // scene JSON
let currentSceneId  = null;
let selectedObjId   = null;
let availableLabels = [];
let bindings        = {};     // { "sceneId:objId:prop": "labelName" }
let latestByLabel   = {};     // { "labelName": { value, timestamp } }  — for scene updates
let dataHistory     = {};     // { "labelName": [{value, timestamp}, ...] } — for data panel only
let allLatest       = [];     // [{ label, value, timestamp }, ...]  — for All Data panel
let statusState     = 'init'; // 'ok' | 'nodata' | 'error'
let alldataFilter   = '';

// ---------------------------------------------------------------------------
// DOM helpers
// ---------------------------------------------------------------------------

function el(id) { return document.getElementById(id); }

function setStatus(state) {
    statusState = state;
    const dot  = el('status-dot');
    const text = el('status-text');
    const map  = {
        ok:      { color: '#44cc88', text: 'Connected'  },
        nodata:  { color: '#ffaa22', text: 'No Data'    },
        error:   { color: '#ff4444', text: 'Error'      },
    };
    const s = map[state] || map.error;
    dot.style.background = s.color;
    text.textContent     = s.text;
}

function bindingKey(sceneId, objId, prop) {
    return `${sceneId}:${objId}:${prop}`;
}

function loadBindings() {
    try {
        bindings = JSON.parse(localStorage.getItem(STORAGE_KEY) || '{}');
    } catch (_) {
        bindings = {};
    }
}

function saveBindings() {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(bindings));
}

// ---------------------------------------------------------------------------
// Scene selector
// ---------------------------------------------------------------------------

function initSceneSelector() {
    const sel = el('scene-select');
    SCENES.forEach(s => {
        const opt    = document.createElement('option');
        opt.value    = s.id;
        opt.textContent = s.label;
        sel.appendChild(opt);
    });
    sel.addEventListener('change', () => loadScene(sel.value));
}

async function loadScene(sceneId) {
    const def = SCENES.find(s => s.id === sceneId);
    if (!def) return;

    try {
        const resp = await fetch(def.file);
        if (!resp.ok) throw new Error('Failed to fetch scene');
        const json = await resp.json();

        currentScene   = json;
        currentSceneId = sceneId;
        selectedObjId  = null;

        viewport.loadScene(json);
        renderObjectList(json.objects || []);
        renderBindingsPanel();
        renderDataPanel();

        el('scene-name').textContent = json.name;
    } catch (err) {
        console.error('loadScene error', err);
    }
}

// ---------------------------------------------------------------------------
// Object list panel
// ---------------------------------------------------------------------------

function renderObjectList(objects) {
    const list = el('object-list');
    list.innerHTML = '';

    if (!objects.length) {
        list.innerHTML = '<div class="empty-hint">No objects in scene</div>';
        return;
    }

    objects.forEach(obj => {
        const item = document.createElement('div');
        item.className  = 'obj-item';
        item.dataset.id = obj.id;

        const icon = document.createElement('span');
        icon.className  = 'obj-icon';
        icon.textContent = typeIcon(obj.type);

        const name = document.createElement('span');
        name.textContent = obj.name;

        item.appendChild(icon);
        item.appendChild(name);

        item.addEventListener('click', () => selectObject(obj.id));
        list.appendChild(item);
    });
}

function typeIcon(type) {
    const map = { cube: '▣', sphere: '●', plane: '▬', cylinder: '⬭' };
    return map[type] || '◆';
}

function selectObject(objId) {
    selectedObjId = objId;
    viewport.selectObject(objId);

    // Update list highlight
    document.querySelectorAll('.obj-item').forEach(el => {
        el.classList.toggle('selected', el.dataset.id === objId);
    });

    renderBindingsPanel();
    renderDataPanel();
}

// ---------------------------------------------------------------------------
// Bindings panel
// ---------------------------------------------------------------------------

function renderBindingsPanel() {
    const panel = el('bindings-panel');
    panel.innerHTML = '';

    if (!selectedObjId || !currentSceneId) {
        panel.innerHTML = '<div class="empty-hint">Select an object to configure bindings</div>';
        return;
    }

    const obj = (currentScene?.objects || []).find(o => o.id === selectedObjId);
    if (!obj) return;

    const heading = document.createElement('div');
    heading.className   = 'panel-section-title';
    heading.textContent = obj.name;
    panel.appendChild(heading);

    BINDABLE_PROPERTIES.forEach(prop => {
        const key         = bindingKey(currentSceneId, selectedObjId, prop);
        const boundLabel  = bindings[key] || '';

        const row    = document.createElement('div');
        row.className = 'binding-row';

        const propEl = document.createElement('span');
        propEl.className   = 'prop-name';
        propEl.textContent = prop;

        const sel    = document.createElement('select');
        sel.className = 'label-select';

        // None option
        const noneOpt     = document.createElement('option');
        noneOpt.value     = '';
        noneOpt.textContent = '— None —';
        sel.appendChild(noneOpt);

        availableLabels.forEach(lbl => {
            const opt     = document.createElement('option');
            opt.value     = lbl;
            opt.textContent = lbl;
            if (lbl === boundLabel) opt.selected = true;
            sel.appendChild(opt);
        });

        sel.value = boundLabel;

        sel.addEventListener('change', () => {
            if (sel.value) {
                bindings[key] = sel.value;
            } else {
                delete bindings[key];
                viewport.setBinding(selectedObjId, prop, 0);
            }
            saveBindings();
            renderDataPanel();
            pollAllLatest();
        });

        row.appendChild(propEl);
        row.appendChild(sel);
        panel.appendChild(row);
    });
}

// ---------------------------------------------------------------------------
// Data panel
// ---------------------------------------------------------------------------

function renderDataPanel() {
    const panel = el('data-panel');
    panel.innerHTML = '';

    if (!selectedObjId || !currentSceneId) {
        panel.innerHTML = '<div class="empty-hint">Select an object to view data</div>';
        return;
    }

    // Collect all labels bound to this object
    const boundLabels = new Set();
    BINDABLE_PROPERTIES.forEach(prop => {
        const key = bindingKey(currentSceneId, selectedObjId, prop);
        if (bindings[key]) boundLabels.add(bindings[key]);
    });

    if (!boundLabels.size) {
        panel.innerHTML = '<div class="empty-hint">No bindings configured for this object</div>';
        return;
    }

    boundLabels.forEach(label => {
        const section = document.createElement('div');
        section.className = 'data-section';

        const title = document.createElement('div');
        title.className   = 'panel-section-title';
        title.textContent = label;
        section.appendChild(title);

        const table = document.createElement('table');
        table.className = 'data-table';

        const thead = document.createElement('thead');
        thead.innerHTML = '<tr><th>Time</th><th>Value</th></tr>';
        table.appendChild(thead);

        const tbody = document.createElement('tbody');
        tbody.id    = `data-tbody-${label.replace(/[^a-z0-9]/gi, '_')}`;

        // Fill existing cached data
        fillDataTable(tbody, label);
        table.appendChild(tbody);
        section.appendChild(table);
        panel.appendChild(section);
    });
}

function fillDataTable(tbody, label) {
    const cached = dataHistory[label] || [];
    const rows   = cached.slice(-20).reverse();  // newest first

    tbody.innerHTML = '';
    if (!rows.length) {
        const tr  = document.createElement('tr');
        const td  = document.createElement('td');
        td.colSpan = 2;
        td.className   = 'no-data-row';
        td.textContent = 'No data yet';
        tr.appendChild(td);
        tbody.appendChild(tr);
        return;
    }

    rows.forEach(({ value, timestamp }) => {
        const tr = document.createElement('tr');
        const t  = document.createElement('td');
        const v  = document.createElement('td');

        const d   = new Date(timestamp * 1000);
        t.textContent = d.toLocaleTimeString();
        v.textContent = typeof value === 'number' ? value.toFixed(4) : value;
        v.className   = 'value-cell';

        tr.appendChild(t);
        tr.appendChild(v);
        tbody.appendChild(tr);
    });
}

// ---------------------------------------------------------------------------
// All Data panel
// ---------------------------------------------------------------------------

function initAllDataPanel() {
    const panel = el('alldata-panel');
    panel.innerHTML = `
        <input id="alldata-search" type="text" placeholder="Filter labels…" autocomplete="off">
        <div id="alldata-table-wrap">
          <table id="alldata-table">
            <thead>
              <tr>
                <th>Label</th>
                <th style="text-align:right">Value</th>
                <th style="text-align:right">Age</th>
              </tr>
            </thead>
            <tbody id="alldata-tbody"></tbody>
          </table>
        </div>`;

    el('alldata-search').addEventListener('input', e => {
        alldataFilter = e.target.value.toLowerCase();
        renderAllDataTable();
    });
}

function renderAllDataTable() {
    const tbody = el('alldata-tbody');
    if (!tbody) return;

    const now     = Math.floor(Date.now() / 1000);
    const rows    = alldataFilter
        ? allLatest.filter(r => r.label.toLowerCase().includes(alldataFilter))
        : allLatest;

    if (!rows.length) {
        tbody.innerHTML = `<tr><td colspan="3" style="color:var(--text-muted);font-style:italic;text-align:center;padding:20px">
            ${alldataFilter ? 'No matching labels' : 'No data ingested yet'}</td></tr>`;
        return;
    }

    tbody.innerHTML = rows.map(({ label, value, timestamp }) => {
        const age     = now - timestamp;
        const ageStr  = age < 5   ? 'now'
                      : age < 60  ? `${age}s ago`
                      : age < 120 ? '1m ago'
                      : `${Math.round(age / 60)}m ago`;
        const ageClass = age < 5 ? 'fresh' : age > 30 ? 'stale' : '';
        const valStr  = Number.isFinite(value) ? value.toPrecision(6).replace(/\.?0+$/, '') : value;

        return `<tr>
          <td class="alldata-label">${escHtml(label)}</td>
          <td class="alldata-value">${escHtml(String(valStr))}</td>
          <td class="alldata-age ${ageClass}">${ageStr}</td>
        </tr>`;
    }).join('');
}

function escHtml(s) {
    return s.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
}

async function pollAllLatest() {
    try {
        const resp = await fetch('/api/latest.php');
        if (!resp.ok) return;
        allLatest = await resp.json();
        if (el('tab-alldata').classList.contains('active')) {
            renderAllDataTable();
        }
    } catch (_) { /* silent */ }
}

// ---------------------------------------------------------------------------
// Label polling
// ---------------------------------------------------------------------------

async function pollLabels() {
    try {
        const resp = await fetch('/api/labels.php');
        if (!resp.ok) throw new Error('HTTP ' + resp.status);
        const labels = await resp.json();
        const changed = labels.join(',') !== availableLabels.join(',');
        availableLabels = labels;
        setStatus(labels.length ? 'ok' : 'nodata');
        el('last-update').textContent = 'Updated ' + new Date().toLocaleTimeString();
        // Only rebuild dropdowns when the label list actually changes
        if (changed && selectedObjId) renderBindingsPanel();
    } catch (err) {
        setStatus('error');
    }
}

// ---------------------------------------------------------------------------
// Data polling
// ---------------------------------------------------------------------------

// Push the latest cached values into the 3D scene. No I/O — runs at ~20 fps.
function applyBindingsToViewport() {
    if (!currentSceneId || !currentScene) return;
    (currentScene.objects || []).forEach(obj => {
        BINDABLE_PROPERTIES.forEach(prop => {
            const key   = bindingKey(currentSceneId, obj.id, prop);
            const label = bindings[key];
            if (!label) return;
            const entry = latestByLabel[label];
            if (entry === undefined) return;
            viewport.setBinding(obj.id, prop, entry.value);
        });
    });
}

// Fetch the single latest value for every label in one request, update scene.
async function pollAllLatest() {
    try {
        const resp = await fetch('/api/latest.php');
        if (!resp.ok) return;
        allLatest = await resp.json();

        // Rebuild fast-lookup map
        latestByLabel = {};
        allLatest.forEach(r => { latestByLabel[r.label] = r; });

        applyBindingsToViewport();

        if (el('tab-alldata').classList.contains('active')) renderAllDataTable();
    } catch (_) { /* silent */ }
}

// Fetch full history for a label — only called when the data panel is shown.
async function fetchHistory(label) {
    try {
        const resp = await fetch(`/api/data.php?label=${encodeURIComponent(label)}`);
        if (!resp.ok) return;
        const points = await resp.json();
        if (points.length) dataHistory[label] = points;
    } catch (_) {}
}

async function updateDataTableLive() {
    const boundLabels = new Set();
    BINDABLE_PROPERTIES.forEach(prop => {
        const key = bindingKey(currentSceneId, selectedObjId, prop);
        if (bindings[key]) boundLabels.add(bindings[key]);
    });

    await Promise.all([...boundLabels].map(fetchHistory));

    boundLabels.forEach(label => {
        const safeId = label.replace(/[^a-z0-9]/gi, '_');
        const tbody  = document.getElementById(`data-tbody-${safeId}`);
        if (tbody) fillDataTable(tbody, label);
    });
}

// ---------------------------------------------------------------------------
// Tab switching
// ---------------------------------------------------------------------------

function initTabs() {
    const tabs = document.querySelectorAll('.tab-btn');
    tabs.forEach(btn => {
        btn.addEventListener('click', () => {
            tabs.forEach(b => b.classList.remove('active'));
            btn.classList.add('active');

            const target = btn.dataset.tab;
            document.querySelectorAll('.tab-content').forEach(c => {
                c.classList.toggle('active', c.id === `tab-${target}`);
            });

            if (target === 'data')    { renderDataPanel(); updateDataTableLive(); }
            if (target === 'alldata') renderAllDataTable();
        });
    });
}

// ---------------------------------------------------------------------------
// Boot
// ---------------------------------------------------------------------------

window.addEventListener('DOMContentLoaded', async () => {
    loadBindings();
    initSceneSelector();
    initTabs();
    initAllDataPanel();

    // Set up viewport
    const canvas = el('viewport-canvas');
    viewport     = new Viewport(canvas);

    viewport.onObjectClick(id => selectObject(id));

    // Handle resize
    const resizeObserver = new ResizeObserver(() => viewport.resize());
    resizeObserver.observe(canvas.parentElement);

    // Load default scene
    await loadScene(SCENES[0].id);
    el('scene-select').value = SCENES[0].id;

    // Start polling
    await pollLabels();
    await pollAllLatest();
    setInterval(pollLabels,              POLL_LABELS_MS); // refresh label list
    setInterval(pollAllLatest,           POLL_DATA_MS);   // fetch latest values + update scene
    setInterval(applyBindingsToViewport, 50);             // push cached values to scene at ~20 fps
});
