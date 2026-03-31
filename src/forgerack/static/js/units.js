/**
 * ForgeRack — Unit Behaviors
 * Each unit registers its init, data handling, and jack I/O.
 */
(function(FR) {
'use strict';

// ═══════════════════════════════════════════════════════════
// INGEST DT-100 — already has unit-csv-input.js, but let's consolidate
// ═══════════════════════════════════════════════════════════

FR.registerUnit('csv-input', {
    init(el, id) {
        this.el = el;
        this.id = id;
        this.data = {};
        this.columns = [];
    },

    parse() {
        const raw = document.getElementById(this.id + '-data').value.trim();
        if (!raw) return;

        const lines = raw.split('\n').map(l => l.trim()).filter(Boolean);
        if (lines.length < 2) {
            const vals = raw.split(/[\n,\s]+/).map(Number).filter(v => !isNaN(v));
            this.data = { data: vals };
            this.columns = ['data'];
        } else {
            const sep = lines[0].includes('\t') ? '\t' : ',';
            const header = lines[0].split(sep).map(h => h.trim());
            const isHeader = header.some(h => isNaN(Number(h)));

            if (isHeader) {
                this.columns = header;
                this.data = {};
                header.forEach(h => this.data[h] = []);
                for (let i = 1; i < lines.length; i++) {
                    const vals = lines[i].split(sep);
                    header.forEach((h, j) => {
                        const v = parseFloat(vals[j]);
                        this.data[h].push(isNaN(v) ? (vals[j] || '').trim() : v);
                    });
                }
            } else {
                const vals = raw.split(/[\n,\s]+/).map(Number).filter(v => !isNaN(v));
                this.data = { data: vals };
                this.columns = ['data'];
            }
        }
        this._render();
        // Emit on each column name — matches back panel jack data-output="colname"
        var self = this;
        this.columns.forEach(function(col) {
            FR.emit(self.id, col, self.data[col]);
        });
        // Also emit full dataset on 'parsed' channel
        FR.emit(this.id, 'parsed', { columns: this.columns, data: this.data });
    },

    demo() {
        const el = document.getElementById(this.id + '-data');
        el.value = '25.02,24.98,25.01,24.97,25.03,25.00,24.99,25.02,24.96,25.01,25.04,24.98,25.00,25.01,24.99,25.03,24.97,25.02,25.00,24.98,25.01,24.99,25.05,25.02,24.96,25.08,25.03,25.01,24.97,25.00';
        this.parse();
    },

    _render() {
        const n = this.columns.length > 0 ? (this.data[this.columns[0]] || []).length : 0;
        document.getElementById(this.id + '-n').textContent = n;
        FR.LED(document.getElementById(this.id + '-led')).set(n > 0 ? 'green' : false);

        const colsEl = document.getElementById(this.id + '-cols');
        if (colsEl) {
            colsEl.style.display = 'block';
            colsEl.innerHTML = this.columns.map(c =>
                '<span style="display:inline-block;padding:1px 6px;margin:1px;background:rgba(156,163,175,0.06);border:1px solid rgba(156,163,175,0.08);border-radius:2px;font:9px \'JetBrains Mono\',monospace;color:rgba(156,163,175,0.35);">' + c + '</span>'
            ).join('');
        }

        // Update back panel jacks
        const backJacks = document.getElementById(this.id + '-back-jacks');
        if (backJacks) {
            backJacks.innerHTML = this.columns.map(c =>
                '<div class="patch-group"><div class="patch-jack connected" data-output="' + c + '" data-unit-id="' + this.id + '"></div><div class="patch-jack-label">' + c + '</div></div>'
            ).join('');
        }

        // Update front jacks too
        const frontJacks = document.getElementById(this.id + '-jacks');
        if (frontJacks) {
            frontJacks.innerHTML = this.columns.map(c =>
                '<div class="patch-group"><div class="jack connected" data-output="' + c + '" data-unit-id="' + this.id + '"></div><span style="font:600 6px/1 \'JetBrains Mono\',monospace;color:rgba(156,163,175,0.2);">' + c + '</span></div>'
            ).join('');
        }
    },

    getOutput(channel) {
        return this.data[channel] || this.data[this.columns[0]] || [];
    },

    getAllData() {
        return this.data;
    }
});


// ═══════════════════════════════════════════════════════════
// SCOPE LS-800 — renders ForgeViz ChartSpec
// ═══════════════════════════════════════════════════════════

FR.registerUnit('chart-panel', {
    init(el, id) {
        this.el = el;
        this.id = id;
        this._spec = null;
        this._rawData = null;
        this._source = null;
        this.chartType = 'line';
        this._annotating = false;
        this._tableVisible = false;

        var self = this;

        // Wire up chart type buttons
        el.querySelectorAll('[data-chart-type]').forEach(btn => {
            btn.addEventListener('click', () => {
                el.querySelectorAll('[data-chart-type]').forEach(b => b.classList.remove('active'));
                btn.classList.add('active');
                this.chartType = btn.dataset.chartType;
                this._updateSettingsCRT();
                if (this._rawData) this._buildAndRender(this._rawData);
            });
        });

        // Wire physical export buttons
        var copyBtn = document.getElementById(id + '-btn-copy');
        var svgBtn = document.getElementById(id + '-btn-svg');
        var pngBtn = document.getElementById(id + '-btn-png');
        var expandBtn = document.getElementById(id + '-btn-expand');
        var annotateSwitch = document.getElementById(id + '-sw-annotate');
        var tableSwitch = document.getElementById(id + '-sw-table');
        var viewport = document.getElementById(id + '-viewport');

        if (copyBtn) copyBtn.addEventListener('click', function() {
            var svg = viewport && viewport.querySelector('svg');
            if (svg) {
                var data = new XMLSerializer().serializeToString(svg);
                navigator.clipboard.writeText(data).then(function() {
                    copyBtn.textContent = 'OK';
                    setTimeout(function() { copyBtn.textContent = 'Copy'; }, 1200);
                });
            }
        });

        if (svgBtn) svgBtn.addEventListener('click', function() {
            var svg = viewport && viewport.querySelector('svg');
            if (svg) {
                var data = new XMLSerializer().serializeToString(svg);
                var blob = new Blob([data], { type: 'image/svg+xml' });
                var url = URL.createObjectURL(blob);
                var a = document.createElement('a');
                a.href = url; a.download = 'scope-chart.svg'; a.click();
                URL.revokeObjectURL(url);
            }
        });

        if (pngBtn) pngBtn.addEventListener('click', function() {
            var svg = viewport && viewport.querySelector('svg');
            if (svg) {
                var data = new XMLSerializer().serializeToString(svg);
                var img = new Image();
                var canvas = document.createElement('canvas');
                canvas.width = svg.clientWidth * 2; canvas.height = svg.clientHeight * 2;
                img.onload = function() {
                    var ctx = canvas.getContext('2d');
                    ctx.scale(2, 2);
                    ctx.drawImage(img, 0, 0);
                    canvas.toBlob(function(blob) {
                        var url = URL.createObjectURL(blob);
                        var a = document.createElement('a');
                        a.href = url; a.download = 'scope-chart.png'; a.click();
                        URL.revokeObjectURL(url);
                    });
                };
                img.src = 'data:image/svg+xml;base64,' + btoa(unescape(encodeURIComponent(data)));
            }
        });

        if (expandBtn) expandBtn.addEventListener('click', function() {
            if (!document.fullscreenElement) {
                (self.el || el).requestFullscreen().catch(function() {});
            } else {
                document.exitFullscreen();
            }
        });

        // Wire color picker inputs on the faceplate
        var colorTrace = document.getElementById(id + '-color-trace');
        var colorBg = document.getElementById(id + '-color-bg');
        var colorGrid = document.getElementById(id + '-color-grid');
        var colorAxis = document.getElementById(id + '-color-axis');

        // Which color controls are active per chart type
        // All types support trace + bg. Grid/axis active for line, scatter, bar, control.
        var GRID_AXIS_TYPES = { line:1, scatter:1, bar:1, control:1, hist:1 };

        function _updateColorLEDs() {
            var ga = GRID_AXIS_TYPES[self.chartType];
            FR.LED(document.getElementById(self.id + '-led-trace')).set('green');
            FR.LED(document.getElementById(self.id + '-led-bg')).set('green');
            FR.LED(document.getElementById(self.id + '-led-grid')).set(ga ? 'green' : 'off');
            FR.LED(document.getElementById(self.id + '-led-axis')).set(ga ? 'green' : 'off');
        }
        _updateColorLEDs();

        // Text color pickers
        var colorTitleText = document.getElementById(id + '-color-title');
        var colorAxisText = document.getElementById(id + '-color-axis-text');

        function _applyColors() {
            if (!self._spec) return;
            // Trace color → all traces
            if (colorTrace) {
                var tc = colorTrace.value;
                (self._spec.traces || []).forEach(function(t) {
                    if (typeof t === 'object') t.color = tc;
                });
            }
            // Background, grid, axis, text colors via style overrides
            if (!self._spec._styleOverrides) self._spec._styleOverrides = {};
            if (colorBg) {
                self._spec._styleOverrides.bg = colorBg.value;
                self._spec._styleOverrides.plotBg = colorBg.value;
            }
            if (colorGrid) self._spec._styleOverrides.grid = colorGrid.value;
            if (colorAxis) self._spec._styleOverrides.axis = colorAxis.value;
            if (colorTitleText) self._spec._styleOverrides.text = colorTitleText.value;
            if (colorAxisText) self._spec._styleOverrides.textSecondary = colorAxisText.value;

            // Re-render
            if (viewport) self._renderSpec(viewport, self._spec);
        }

        [colorTrace, colorBg, colorGrid, colorAxis, colorTitleText, colorAxisText].forEach(function(inp) {
            if (inp) inp.addEventListener('input', _applyColors);
        });

        // Wire label inputs — re-render on change
        var labelTitle = document.getElementById(id + '-label-title');
        var labelX = document.getElementById(id + '-label-x');
        var labelY = document.getElementById(id + '-label-y');

        function _applyLabels() {
            if (!self._spec) return;
            self._spec.title = (labelTitle && labelTitle.value) || '';
            if (!self._spec.x_axis) self._spec.x_axis = {};
            if (!self._spec.y_axis) self._spec.y_axis = {};
            self._spec.x_axis.label = (labelX && labelX.value) || '';
            self._spec.y_axis.label = (labelY && labelY.value) || '';
            if (viewport) self._renderSpec(viewport, self._spec);
        }

        [labelTitle, labelX, labelY].forEach(function(inp) {
            if (inp) inp.addEventListener('change', _applyLabels);
        });

        // Update LEDs when chart type changes
        var _origChartTypeClick = el.querySelectorAll('[data-chart-type]');
        _origChartTypeClick.forEach(function(btn) {
            btn.addEventListener('click', _updateColorLEDs);
        });

        if (annotateSwitch) annotateSwitch.addEventListener('click', function() {
            self._annotating = !self._annotating;
            annotateSwitch.classList.toggle('on', self._annotating);
            if (viewport && self._annotating) {
                // Enable annotation mode — click data points to add notes
                if (ForgeViz.enableAnnotation) {
                    ForgeViz.enableAnnotation(viewport, function(a) {
                        console.log('[SCOPE] Annotation:', a);
                    });
                }
                viewport.style.cursor = 'crosshair';
            } else if (viewport) {
                if (ForgeViz.disableAnnotation) ForgeViz.disableAnnotation(viewport);
                viewport.style.cursor = '';
            }
        });

        if (tableSwitch) tableSwitch.addEventListener('click', function() {
            self._tableVisible = !self._tableVisible;
            tableSwitch.classList.toggle('on', self._tableVisible);
            if (!viewport) return;

            if (self._tableVisible && self._spec) {
                // Show data table below the chart
                if (ForgeViz.showDataTable) {
                    ForgeViz.showDataTable(viewport, self._spec);
                } else {
                    // Fallback: build simple table from spec data
                    var table = document.createElement('div');
                    table.className = 'scope-data-table';
                    table.style.cssText = 'margin-top:4px;max-height:120px;overflow-y:auto;font:11px/1.4 "JetBrains Mono",monospace;color:rgba(74,222,128,0.4);background:rgba(0,0,0,0.3);padding:4px 8px;border:1px solid rgba(0,0,0,0.4);border-radius:1px;';
                    var traces = self._spec.traces || [];
                    if (traces.length > 0 && traces[0].y) {
                        var rows = traces[0].y.map(function(v, i) { return (i+1) + '\t' + (typeof v === 'number' ? v.toFixed(4) : v); });
                        table.textContent = 'IDX\tVALUE\n' + rows.join('\n');
                        table.style.whiteSpace = 'pre';
                    }
                    viewport.appendChild(table);
                }
            } else {
                // Remove data table
                var existing = viewport.querySelector('.scope-data-table, .fv-data-table');
                if (existing) existing.remove();
            }
        });
    },

    receive(inputName, data, fromUnit) {
        if (!data) return;
        this._source = fromUnit || '?';

        const viewport = document.getElementById(this.id + '-viewport');
        const empty = document.getElementById(this.id + '-empty');
        if (!viewport) return;

        // Already a ChartSpec — render directly regardless of mode
        if (data.traces || data.chart_type) {
            this._renderSpec(viewport, data);
            if (empty) empty.style.display = 'none';
            this._updateSettingsCRT(data);
            return;
        }

        // Extract numeric array from various input shapes
        let vals = null;
        if (Array.isArray(data)) {
            vals = data.filter(v => typeof v === 'number');
        } else if (data.data && data.columns) {
            const col = data.columns[0];
            vals = (data.data[col] || []).filter(v => typeof v === 'number');
        }

        if (vals && vals.length > 0) {
            this._rawData = vals;
            this._buildAndRender(vals);
            if (empty) empty.style.display = 'none';
        }
    },

    _buildAndRender(vals) {
        const viewport = document.getElementById(this.id + '-viewport');
        if (!viewport) return;

        const n = vals.length;
        const x = vals.map((_, i) => i + 1);
        // Read trace color from faceplate picker, fall back to default
        var traceInput = document.getElementById(this.id + '-color-trace');
        const c = (traceInput && traceInput.value) || '#4ade80';
        let spec;

        switch (this.chartType) {
            case 'line':
                spec = { traces: [{ x, y: vals, trace_type: 'line', color: c, width: 1.5, marker_size: 3 }] };
                break;

            case 'scatter':
                spec = { traces: [{ x, y: vals, trace_type: 'scatter', color: c, marker_size: 5, opacity: 0.7 }] };
                break;

            case 'bar':
                spec = { traces: [{ x, y: vals, trace_type: 'bar', color: c, opacity: 0.8 }] };
                break;

            case 'hist': {
                // Build histogram bins
                const bins = Math.max(5, Math.min(30, Math.ceil(Math.sqrt(n))));
                const mn = Math.min(...vals), mx = Math.max(...vals);
                const bw = (mx - mn) / bins || 1;
                const counts = new Array(bins).fill(0);
                const edges = [];
                for (let i = 0; i <= bins; i++) edges.push(mn + i * bw);
                vals.forEach(v => { const b = Math.min(bins - 1, Math.floor((v - mn) / bw)); counts[b]++; });
                const centers = edges.slice(0, bins).map((e, i) => (e + edges[i + 1]) / 2);
                spec = { traces: [{ x: centers, y: counts, trace_type: 'bar', color: c, opacity: 0.8 }] };
                break;
            }

            case 'box':
                spec = { traces: [{
                    type: 'box', name: 'data',
                    q1: _quantile(vals, 0.25), median: _quantile(vals, 0.5), q3: _quantile(vals, 0.75),
                    whisker_low: Math.min(...vals), whisker_high: Math.max(...vals),
                    outliers: [], color: c, x_position: 0
                }] };
                break;

            case 'control': {
                // I-chart with ±3σ limits
                const mean = vals.reduce((a, b) => a + b, 0) / n;
                const mr = [];
                for (let i = 1; i < n; i++) mr.push(Math.abs(vals[i] - vals[i - 1]));
                const mrBar = mr.length > 0 ? mr.reduce((a, b) => a + b, 0) / mr.length : 0;
                const sigma = mrBar / 1.128;
                const ucl = mean + 3 * sigma, lcl = mean - 3 * sigma;
                spec = {
                    traces: [{ x, y: vals, trace_type: 'line', color: c, width: 1.5, marker_size: 3 }],
                    reference_lines: [
                        { axis: 'y', value: ucl, color: '#f87171', width: 1, dash: 'dashed', label: 'UCL' },
                        { axis: 'y', value: mean, color: '#4ade80', width: 1, label: 'CL' },
                        { axis: 'y', value: lcl, color: '#f87171', width: 1, dash: 'dashed', label: 'LCL' },
                    ],
                    markers: []
                };
                // Mark OOC points
                const ooc = [];
                vals.forEach((v, i) => { if (v > ucl || v < lcl) ooc.push(i); });
                if (ooc.length) spec.markers.push({ indices: ooc, color: '#f87171', size: 6 });
                break;
            }

            case 'heatmap':
                // Auto-correlogram if enough data
                spec = { traces: [{ x, y: vals, trace_type: 'line', color: c, width: 1.5 }] };
                break;

            default:
                spec = { traces: [{ x, y: vals, trace_type: 'line', color: c, width: 1.5, marker_size: 3 }] };
        }

        // Read labels from faceplate inputs
        var titleInput = document.getElementById(this.id + '-label-title');
        var xInput = document.getElementById(this.id + '-label-x');
        var yInput = document.getElementById(this.id + '-label-y');
        spec.title = (titleInput && titleInput.value) || '';
        spec.x_axis = { label: (xInput && xInput.value) || '' };
        spec.y_axis = { label: (yInput && yInput.value) || '' };
        spec.theme = 'svend_dark';

        this._renderSpec(viewport, spec);
        this._updateSettingsCRT();
    },

    _renderSpec(viewport, spec) {
        viewport.innerHTML = '';
        this._spec = spec;

        // Viewport needs position:relative for color picker / annotation overlays
        viewport.style.position = 'relative';

        if (typeof ForgeViz === 'undefined' || !ForgeViz.render) {
            viewport.innerHTML = '<div style="padding:10px;font:11px monospace;color:rgba(74,222,128,0.2);">ForgeViz not loaded</div>';
            return;
        }

        // Render — no toolbar, faceplate has all controls
        ForgeViz.render(viewport, spec, {
            toolbar: false,
            showThemeToggle: false,
        });

        // Threshold drag for SPC mode
        if (this.chartType === 'control' && ForgeViz.enableThresholdDrag) {
            ForgeViz.enableThresholdDrag(viewport, function(val) {
                console.log('[SCOPE] Threshold dragged:', val);
            });
        }

        FR.LED(document.getElementById(this.id + '-led')).set('green');
    },

    _updateSettingsCRT(spec) {
        const modeEl = document.getElementById(this.id + '-mode-label');
        const ptsEl = document.getElementById(this.id + '-pts');
        const srcEl = document.getElementById(this.id + '-src');
        if (modeEl) modeEl.textContent = this.chartType.toUpperCase();
        if (ptsEl) ptsEl.textContent = this._rawData ? this._rawData.length : (spec && spec.traces ? spec.traces[0]?.y?.length || 0 : 0);
        if (srcEl) srcEl.textContent = this._source || '\u2014';
    },

    clear() {
        const viewport = document.getElementById(this.id + '-viewport');
        const empty = document.getElementById(this.id + '-empty');
        if (viewport) viewport.innerHTML = '';
        if (empty) { empty.style.display = 'flex'; viewport.appendChild(empty); }
        this._rawData = null;
        FR.LED(document.getElementById(this.id + '-led')).off();
        this._updateSettingsCRT();
    }
});

function _quantile(arr, p) {
    const s = [...arr].sort((a, b) => a - b);
    const i = (s.length - 1) * p;
    const lo = Math.floor(i), hi = Math.ceil(i);
    return s[lo] + (s[hi] - s[lo]) * (i - lo);
}


// ═══════════════════════════════════════════════════════════
// SIEVE FG-01 — pass/reject based on condition
// ═══════════════════════════════════════════════════════════

FR.registerUnit('filter', {
    init(el, id) {
        this.el = el;
        this.id = id;
        this.mode = '>';  // >, <, =, ≠
        this.threshold = 0;
        this._inputData = [];

        // Wire up segment buttons
        const btns = el.querySelectorAll('.segment-btn');
        const modes = ['>', '<', '=', '≠'];
        btns.forEach((btn, i) => {
            btn.addEventListener('click', () => {
                btns.forEach(b => b.classList.remove('active'));
                btn.classList.add('active');
                this.mode = modes[i];
                this._apply();
            });
        });
    },

    receive(inputName, data) {
        if (Array.isArray(data)) {
            this._inputData = data;
            this._apply();
        }
    },

    setThreshold(v) {
        this.threshold = v;
        this._apply();
    },

    _apply() {
        if (!this._inputData.length) return;
        const t = this.threshold;
        let pass = [], reject = [];

        this._inputData.forEach(v => {
            let p;
            if (this.mode === '>') p = v > t;
            else if (this.mode === '<') p = v < t;
            else if (this.mode === '=') p = Math.abs(v - t) < 0.001;
            else p = Math.abs(v - t) >= 0.001;

            if (p) pass.push(v); else reject.push(v);
        });

        const passEl = document.getElementById(this.id + '-pass');
        const rejectEl = document.getElementById(this.id + '-reject');
        if (passEl) passEl.textContent = pass.length;
        if (rejectEl) rejectEl.textContent = reject.length;
        FR.LED(document.getElementById(this.id + '-led')).set(reject.length > 0 ? 'amber' : 'green');

        FR.emit(this.id, 'pass', pass);
        FR.emit(this.id, 'reject', reject);
    }
});


// ═══════════════════════════════════════════════════════════
// REGISTER RD-04 — numeric display panel
// ═══════════════════════════════════════════════════════════

FR.registerUnit('readout', {
    init(el, id) {
        this.el = el;
        this.id = id;
    },

    receive(inputName, data) {
        // data can be:
        // - array of {value, label, status} objects
        // - simple array of numbers (uses index as label)
        // - object {label: value, ...}
        if (!data) return;

        let items = [];
        if (Array.isArray(data)) {
            data.slice(0, 4).forEach((d, i) => {
                if (typeof d === 'object' && d.value !== undefined) {
                    items.push(d);
                } else {
                    items.push({ value: d, label: 'ch' + (i + 1) });
                }
            });
        } else if (typeof data === 'object') {
            Object.entries(data).slice(0, 4).forEach(([k, v]) => {
                items.push({ value: v, label: k });
            });
        }

        items.forEach((item, i) => {
            const vEl = document.getElementById(this.id + '-v' + i);
            const lEl = document.getElementById(this.id + '-l' + i);
            if (vEl) {
                const v = item.value;
                vEl.textContent = typeof v === 'number' ? v.toFixed(2) : String(v);
                // Status coloring
                vEl.style.color = '';
                if (item.status === 'good' || item.good) vEl.style.color = '#22c55e';
                else if (item.status === 'bad' || item.bad) vEl.style.color = '#ef4444';
                else if (item.status === 'warn') vEl.style.color = '#f59e0b';
            }
            if (lEl) lEl.textContent = item.label || '';
        });
    }
});


// ═══════════════════════════════════════════════════════════
// HERALD TT-01 — text output
// ═══════════════════════════════════════════════════════════

FR.registerUnit('narrative', {
    init(el, id) {
        this.el = el;
        this.id = id;
    },

    receive(inputName, data) {
        const textEl = document.getElementById(this.id + '-text');
        if (!textEl) return;

        let text = '';
        if (typeof data === 'string') {
            text = data;
        } else if (data && data.summary) {
            text = data.summary;
        } else if (data && data.text) {
            text = data.text;
        } else if (data && data.narrative) {
            text = typeof data.narrative === 'object' ? JSON.stringify(data.narrative, null, 2) : data.narrative;
        } else {
            text = JSON.stringify(data, null, 2);
        }

        textEl.textContent = text;
        FR.LED(document.getElementById(this.id + '-led')).set('green');
    },

    clear() {
        const textEl = document.getElementById(this.id + '-text');
        if (textEl) textEl.innerHTML = '<span style="color:rgba(34,197,94,0.15);">\u25A0 awaiting input_</span>';
        FR.LED(document.getElementById(this.id + '-led')).off();
    }
});


// ═══════════════════════════════════════════════════════════
// CRATE CM-01 — container device
// ═══════════════════════════════════════════════════════════

FR.registerUnit('combinator', {
    init(el, id) {
        this.el = el;
        this.id = id;
        this.isOpen = false;
    },

    toggle() {
        this.isOpen = !this.isOpen;
        const body = document.getElementById(this.id + '-body');
        const btn = document.getElementById(this.id + '-toggleBtn');
        if (body) body.style.display = this.isOpen ? 'block' : 'none';
        if (btn) btn.innerHTML = this.isOpen ? '&#x25B2; Close' : '&#x25BC; Open';
    },

    receive(inputName, data) {
        // Pass through to contained units
        FR.emit(this.id, 'signal', data);
    }
});


// ═══════════════════════════════════════════════════════════
// MANIFOLD SP-04 — passive fan-out (no behavior needed beyond wiring)
// ═══════════════════════════════════════════════════════════

FR.registerUnit('splitter', {
    init(el, id) {
        this.el = el;
        this.id = id;
    },

    receive(inputName, data) {
        // Fan out to all outputs
        FR.emit(this.id, 'a', data);
        FR.emit(this.id, 'b', data);
        FR.emit(this.id, 'c', data);
        FR.emit(this.id, 'd', data);
    }
});

})(ForgeRack);
