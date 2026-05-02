/* graph.js — 2D time-series graph renderer for The Sink */

/**
 * renderGraph(canvas, buffer, plotLines, evalExprWithSnap)
 *
 * canvas            — HTMLCanvasElement
 * buffer            — [{ ts: number (unix seconds), snap: { label: value } }]
 * plotLines         — [{ id, name, expr, color }]
 * evalExprWithSnap  — function(expr, snap) -> number|null
 */
function renderGraph(canvas, buffer, plotLines, evalExprWithSnap) {
    const ctx = canvas.getContext('2d');
    const W   = canvas.width;
    const H   = canvas.height;

    const PAD = { top: 20, right: 16, bottom: 40, left: 58 };

    const gx = PAD.left;
    const gy = PAD.top;
    const gw = W - PAD.left - PAD.right;
    const gh = H - PAD.top  - PAD.bottom;

    // ------------------------------------------------------------------
    // Background
    // ------------------------------------------------------------------
    ctx.fillStyle = '#1a1a1a';
    ctx.fillRect(0, 0, W, H);

    if (gw <= 0 || gh <= 0) return;

    // ------------------------------------------------------------------
    // Time window: 60-second rolling window, right edge = now
    // ------------------------------------------------------------------
    const nowSec  = Date.now() / 1000;
    const tMin    = nowSec - 60;
    const tMax    = nowSec;

    // ------------------------------------------------------------------
    // Evaluate all plot lines over the visible buffer
    // ------------------------------------------------------------------
    // series[i] = [{ ts, value }] for plotLines[i]
    const series = plotLines.map(pl => {
        return buffer
            .filter(e => e.ts >= tMin && e.ts <= tMax)
            .map(e => {
                const v = evalExprWithSnap(pl.expr, e.snap);
                return v !== null ? { ts: e.ts, value: v } : null;
            })
            .filter(Boolean);
    });

    // ------------------------------------------------------------------
    // Y axis auto-scale
    // ------------------------------------------------------------------
    let allValues = [];
    series.forEach(s => s.forEach(p => allValues.push(p.value)));

    let yMin, yMax;
    if (allValues.length === 0) {
        yMin = -1; yMax = 1;
    } else {
        yMin = Math.min(...allValues);
        yMax = Math.max(...allValues);
        if (yMax - yMin < 0.001) {
            const mid = (yMin + yMax) / 2;
            yMin = mid - 0.5;
            yMax = mid + 0.5;
        } else {
            const pad = (yMax - yMin) * 0.08;
            yMin -= pad;
            yMax += pad;
        }
    }

    // ------------------------------------------------------------------
    // Nice ticks
    // ------------------------------------------------------------------
    function niceTicks(min, max, targetCount) {
        const range = max - min;
        if (range === 0) return [min];
        const rough     = range / targetCount;
        const mag       = Math.pow(10, Math.floor(Math.log10(rough)));
        const mults     = [1, 2, 2.5, 5, 10];
        let step = mag;
        for (const m of mults) {
            const s = mag * m;
            if (range / s <= targetCount + 1) { step = s; break; }
        }
        const first = Math.ceil(min / step) * step;
        const ticks  = [];
        for (let v = first; v <= max + step * 0.001; v += step) {
            ticks.push(parseFloat(v.toPrecision(12)));
        }
        return ticks;
    }

    const yTicks = niceTicks(yMin, yMax, 6);
    const xTicks = [-60, -50, -40, -30, -20, -10, 0]; // seconds relative to now

    // ------------------------------------------------------------------
    // Coordinate helpers
    // ------------------------------------------------------------------
    function toCanvasX(ts) {
        return gx + ((ts - tMin) / (tMax - tMin)) * gw;
    }
    function toCanvasY(v) {
        return gy + gh - ((v - yMin) / (yMax - yMin)) * gh;
    }

    // ------------------------------------------------------------------
    // Grid lines — horizontal (Y ticks)
    // ------------------------------------------------------------------
    ctx.strokeStyle = '#252525';
    ctx.lineWidth   = 1;
    yTicks.forEach(v => {
        if (v < yMin || v > yMax) return;
        const cy = toCanvasY(v);
        ctx.beginPath();
        ctx.moveTo(gx, cy);
        ctx.lineTo(gx + gw, cy);
        ctx.stroke();
    });

    // Grid lines — vertical (every 10 s)
    xTicks.forEach(rel => {
        if (rel === 0) return; // "now" — skip, we'll draw the axis
        const cx = toCanvasX(tMax + rel);
        ctx.beginPath();
        ctx.moveTo(cx, gy);
        ctx.lineTo(cx, gy + gh);
        ctx.stroke();
    });

    // ------------------------------------------------------------------
    // Axes
    // ------------------------------------------------------------------
    ctx.strokeStyle = '#3a3a3a';
    ctx.lineWidth   = 1;

    // Bottom axis
    ctx.beginPath();
    ctx.moveTo(gx, gy + gh);
    ctx.lineTo(gx + gw, gy + gh);
    ctx.stroke();

    // Left axis
    ctx.beginPath();
    ctx.moveTo(gx, gy);
    ctx.lineTo(gx, gy + gh);
    ctx.stroke();

    // ------------------------------------------------------------------
    // Y axis labels
    // ------------------------------------------------------------------
    ctx.fillStyle    = '#666666';
    ctx.font         = '10px Consolas, "Courier New", monospace';
    ctx.textAlign    = 'right';
    ctx.textBaseline = 'middle';

    yTicks.forEach(v => {
        if (v < yMin || v > yMax) return;
        const cy  = toCanvasY(v);
        const abs = Math.abs(v);
        let label;
        if (v === 0) {
            label = '0';
        } else if (abs > 9999 || (abs < 0.001 && v !== 0)) {
            label = v.toExponential(2);
        } else {
            label = parseFloat(v.toPrecision(4)).toString();
        }
        ctx.fillText(label, gx - 5, cy);
    });

    // ------------------------------------------------------------------
    // X axis labels
    // ------------------------------------------------------------------
    ctx.textAlign    = 'center';
    ctx.textBaseline = 'top';
    ctx.fillStyle    = '#666666';

    xTicks.forEach(rel => {
        const cx    = toCanvasX(tMax + rel);
        const label = rel === 0 ? 'now' : `${rel}s`;
        ctx.fillText(label, cx, gy + gh + 6);
    });

    // ------------------------------------------------------------------
    // Clip to graph area and draw plot lines
    // ------------------------------------------------------------------
    ctx.save();
    ctx.beginPath();
    ctx.rect(gx, gy, gw, gh);
    ctx.clip();

    plotLines.forEach((pl, i) => {
        const pts = series[i];
        if (!pts || pts.length < 1) return;

        ctx.strokeStyle = pl.color || '#4a9eff';
        ctx.lineWidth   = 2;
        ctx.lineJoin    = 'round';
        ctx.lineCap     = 'round';

        ctx.beginPath();
        pts.forEach((p, idx) => {
            const cx = toCanvasX(p.ts);
            const cy = toCanvasY(p.value);
            if (idx === 0) ctx.moveTo(cx, cy);
            else           ctx.lineTo(cx, cy);
        });
        ctx.stroke();
    });

    ctx.restore();

    // ------------------------------------------------------------------
    // Legend (top-left of graph area)
    // ------------------------------------------------------------------
    if (plotLines.length > 0) {
        ctx.font         = '10px "Segoe UI", system-ui, sans-serif';
        ctx.textAlign    = 'left';
        ctx.textBaseline = 'middle';

        const swatchW  = 12;
        const rowH     = 16;
        const legendX  = gx + 6;
        const legendY  = gy + 6;

        plotLines.forEach((pl, i) => {
            const ly = legendY + i * rowH;

            // Color swatch line
            ctx.strokeStyle = pl.color || '#4a9eff';
            ctx.lineWidth   = 2;
            ctx.beginPath();
            ctx.moveTo(legendX, ly);
            ctx.lineTo(legendX + swatchW, ly);
            ctx.stroke();

            // Name
            ctx.fillStyle = '#cccccc';
            ctx.fillText(pl.name || '(unnamed)', legendX + swatchW + 5, ly);
        });
    }
}
