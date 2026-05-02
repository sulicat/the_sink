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

const STORAGE_KEY  = 'sink_bindings_v2'; // v2: expressions instead of label names
const PRESETS_KEY  = 'sink_presets';     // { name: { bindings } }
const POLL_LABELS_MS = 2000;
const POLL_DATA_MS   = 500;

// Abbreviated property names for compact display
const PROP_ABBREV = {
    'rotation.x':'rot.x', 'rotation.y':'rot.y', 'rotation.z':'rot.z',
    'position.x':'pos.x', 'position.y':'pos.y', 'position.z':'pos.z',
    'scale.x':   'scl.x', 'scale.y':   'scl.y', 'scale.z':   'scl.z',
};

let viewport        = null;
let currentScene    = null;   // scene JSON
let currentSceneId  = null;
let selectedObjId   = null;
let availableLabels = [];     // label names active in last 10 min (for chips + status)
let bindings        = {};     // { "sceneId:objId:prop": "js expression string" }
let latestByLabel   = {};     // { "labelName": { value, timestamp } }  — for scene updates
let dataHistory     = {};     // { "labelName": [{value, timestamp}, ...] } — for data panel only
let allLatest       = [];     // [{ label, value, timestamp }, ...]  — for All Data panel
let statusState     = 'init'; // 'ok' | 'nodata' | 'error'
let alldataFilter   = '';

// ---------------------------------------------------------------------------
// Expression evaluator
// ---------------------------------------------------------------------------

// Proxy so data.any_label returns its latest value (0 if unknown)
function makeDataProxy() {
    return new Proxy({}, {
        get(_, label) { return latestByLabel[label]?.value ?? 0; },
    });
}

// Evaluate a JS expression string. Returns a finite number or null on error.
function evalExpression(expr) {
    if (!expr || !expr.trim()) return null;
    try {
        // Expose: data (proxy), Math, and nothing else from global scope
        const fn = new Function('data', 'Math', `"use strict"; return +(${expr});`);
        const result = fn(makeDataProxy(), Math);
        return Number.isFinite(result) ? result : null;
    } catch (_) {
        return null;
    }
}

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

// Track which input was last focused so chips can insert into it
let _focusedExprInput = null;

function renderBindingsPanel() {
    const panel = el('bindings-panel');
    panel.innerHTML = '';

    if (!selectedObjId || !currentSceneId) {
        panel.innerHTML = '<div class="empty-hint">Select an object to configure bindings</div>';
        return;
    }

    const obj = (currentScene?.objects || []).find(o => o.id === selectedObjId);
    if (!obj) return;

    // ---- Object heading ----
    const heading = document.createElement('div');
    heading.className   = 'panel-section-title';
    heading.textContent = obj.name;
    heading.style.padding = '8px 10px 4px';
    panel.appendChild(heading);

    // ---- Label chips ----
    const chipsSection = document.createElement('div');
    chipsSection.className = 'label-chips-section';

    const chipsTitle = document.createElement('div');
    chipsTitle.className   = 'label-chips-title';
    chipsTitle.textContent = 'Available labels';
    chipsSection.appendChild(chipsTitle);

    const chipsWrap = document.createElement('div');
    chipsWrap.className = 'label-chips';

    if (availableLabels.length) {
        availableLabels.forEach(lbl => {
            const chip = document.createElement('span');
            chip.className   = 'label-chip';
            chip.textContent = lbl;
            chip.title       = `Insert: data.${lbl}`;
            chip.addEventListener('mousedown', e => {
                e.preventDefault(); // don't steal focus from the input
                if (!_focusedExprInput) return;
                const inp   = _focusedExprInput;
                const start = inp.selectionStart;
                const end   = inp.selectionEnd;
                const ins   = `data.${lbl}`;
                inp.value   = inp.value.slice(0, start) + ins + inp.value.slice(end);
                inp.selectionStart = inp.selectionEnd = start + ins.length;
                inp.dispatchEvent(new Event('input'));
                inp.focus();
            });
            chipsWrap.appendChild(chip);
        });
    } else {
        const hint = document.createElement('span');
        hint.className   = 'no-labels-hint';
        hint.textContent = 'No data yet';
        chipsWrap.appendChild(hint);
    }

    chipsSection.appendChild(chipsWrap);
    panel.appendChild(chipsSection);

    // ---- Expression rows ----
    BINDABLE_PROPERTIES.forEach(prop => {
        const key  = bindingKey(currentSceneId, selectedObjId, prop);
        const expr = bindings[key] || '';

        const row = document.createElement('div');
        row.className = 'binding-row';

        const propEl = document.createElement('span');
        propEl.className   = 'prop-name';
        propEl.textContent = PROP_ABBREV[prop] || prop;
        propEl.title       = prop;

        const input = document.createElement('input');
        input.type        = 'text';
        input.className   = 'expr-input';
        input.value       = expr;
        input.placeholder = 'expression…';
        input.spellcheck  = false;

        const dot = document.createElement('span');
        dot.className = 'binding-dot';

        // Focus tracking for chip insertion
        input.addEventListener('focus', () => { _focusedExprInput = input; });
        input.addEventListener('blur',  () => {
            if (_focusedExprInput === input) _focusedExprInput = null;
        });

        // Live status update while typing
        input.addEventListener('input', () => {
            const v = evalExpression(input.value.trim());
            if (!input.value.trim()) {
                input.className = 'expr-input';
                dot.style.background = 'var(--text-muted)';
                dot.title = '';
            } else if (v !== null) {
                input.className = 'expr-input expr-ok';
                dot.style.background = 'var(--success)';
                dot.title = '= ' + v;
            } else {
                input.className = 'expr-input expr-err';
                dot.style.background = 'var(--danger)';
                dot.title = 'error';
            }
        });

        // Commit on blur or Enter
        const commit = () => {
            const trimmed = input.value.trim();
            if (trimmed) {
                bindings[key] = trimmed;
            } else {
                delete bindings[key];
                viewport.setBinding(selectedObjId, prop, 0);
            }
            saveBindings();
            renderDataPanel();
            pollAllLatest();
        };
        input.addEventListener('blur',   commit);
        input.addEventListener('keydown', e => { if (e.key === 'Enter') { commit(); input.blur(); } });

        // Set initial dot state
        if (expr) {
            const v = evalExpression(expr);
            if (v !== null) {
                input.className = 'expr-input expr-ok';
                dot.style.background = 'var(--success)';
            } else {
                input.className = 'expr-input expr-err';
                dot.style.background = 'var(--danger)';
            }
        }

        row.appendChild(propEl);
        row.appendChild(input);
        row.appendChild(dot);
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
        // Rebuild bindings panel only when label list changes (refreshes chips)
        if (changed && selectedObjId) renderBindingsPanel();
    } catch (err) {
        setStatus('error');
    }
}

// ---------------------------------------------------------------------------
// Data polling
// ---------------------------------------------------------------------------

// Push evaluated expression values into the 3D scene. No I/O — runs at ~20 fps.
function applyBindingsToViewport() {
    if (!currentSceneId || !currentScene) return;
    (currentScene.objects || []).forEach(obj => {
        BINDABLE_PROPERTIES.forEach(prop => {
            const key  = bindingKey(currentSceneId, obj.id, prop);
            const expr = bindings[key];
            if (!expr) return;
            const val  = evalExpression(expr);
            if (val === null) return;
            viewport.setBinding(obj.id, prop, val);
        });
    });
}

// Refresh the status dot colour/title for all visible expression inputs.
function refreshExprStatus() {
    document.querySelectorAll('.expr-input').forEach(input => {
        const dot  = input.nextElementSibling;
        const expr = input.value.trim();
        if (!dot) return;
        if (!expr) {
            input.className = 'expr-input';
            dot.style.background = 'var(--text-muted)';
            dot.title = '';
            return;
        }
        const val = evalExpression(expr);
        if (val !== null) {
            input.className = 'expr-input expr-ok';
            dot.style.background = 'var(--success)';
            dot.title = '= ' + val.toPrecision(5).replace(/\.?0+$/, '');
        } else {
            input.className = 'expr-input expr-err';
            dot.style.background = 'var(--danger)';
            dot.title = 'error';
        }
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
        refreshExprStatus();

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
// Config: presets (localStorage) + export/import (JSON files)
// ---------------------------------------------------------------------------

function loadPresets() {
    try { return JSON.parse(localStorage.getItem(PRESETS_KEY) || '{}'); }
    catch (_) { return {}; }
}

function savePresets(presets) {
    localStorage.setItem(PRESETS_KEY, JSON.stringify(presets));
}

function refreshPresetDropdown() {
    const sel    = el('preset-select');
    const active = sel.value;
    sel.innerHTML = '<option value="">— Presets —</option>';
    const presets = loadPresets();
    Object.keys(presets).sort().forEach(name => {
        const opt       = document.createElement('option');
        opt.value       = name;
        opt.textContent = name;
        sel.appendChild(opt);
    });
    if (active) sel.value = active;
}

function initConfigBar() {
    refreshPresetDropdown();

    // Save current bindings as a named preset
    el('btn-preset-save').addEventListener('click', () => {
        const name = prompt('Preset name:', el('preset-select').value || '');
        if (!name || !name.trim()) return;
        const presets = loadPresets();
        presets[name.trim()] = { bindings: { ...bindings } };
        savePresets(presets);
        refreshPresetDropdown();
        el('preset-select').value = name.trim();
    });

    // Load selected preset
    el('btn-preset-load').addEventListener('click', () => {
        const name    = el('preset-select').value;
        const presets = loadPresets();
        if (!name || !presets[name]) return;
        bindings = { ...presets[name].bindings };
        saveBindings();
        renderBindingsPanel();
        pollAllLatest();
    });

    // Delete selected preset
    el('btn-preset-delete').addEventListener('click', () => {
        const name = el('preset-select').value;
        if (!name) return;
        if (!confirm(`Delete preset "${name}"?`)) return;
        const presets = loadPresets();
        delete presets[name];
        savePresets(presets);
        refreshPresetDropdown();
    });

    // Export current bindings as a JSON file
    el('btn-export').addEventListener('click', () => {
        const payload = JSON.stringify({ version: 2, saved: new Date().toISOString(), bindings }, null, 2);
        const blob    = new Blob([payload], { type: 'application/json' });
        const url     = URL.createObjectURL(blob);
        const a       = document.createElement('a');
        a.href        = url;
        a.download    = `sink-config-${new Date().toISOString().slice(0, 10)}.json`;
        a.click();
        URL.revokeObjectURL(url);
    });

    // Clear all bindings for the current scene, reset all properties to 0
    el('btn-clear-scene').addEventListener('click', () => {
        if (!currentSceneId) return;
        const prefix = currentSceneId + ':';
        Object.keys(bindings).forEach(key => {
            if (!key.startsWith(prefix)) return;
            // key = "sceneId:objId:prop"  →  rest = "objId:prop"
            const rest      = key.slice(prefix.length);
            const colonIdx  = rest.indexOf(':');
            const objId     = rest.slice(0, colonIdx);
            const prop      = rest.slice(colonIdx + 1);
            viewport.setBinding(objId, prop, 0);
            delete bindings[key];
        });
        saveBindings();
        renderBindingsPanel();
    });

    // Import bindings from a JSON file
    el('import-file-input').addEventListener('change', e => {
        const file = e.target.files[0];
        if (!file) return;
        const reader = new FileReader();
        reader.onload = evt => {
            try {
                const data = JSON.parse(evt.target.result);
                const imported = data.bindings || data; // support bare bindings object too
                if (typeof imported !== 'object') throw new Error('bad format');
                bindings = { ...imported };
                saveBindings();
                renderBindingsPanel();
                pollAllLatest();
            } catch (_) {
                alert('Could not parse config file.');
            }
            e.target.value = ''; // reset so same file can be re-imported
        };
        reader.readAsText(file);
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
    initConfigBar();

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
