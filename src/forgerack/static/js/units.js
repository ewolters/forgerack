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
        this._inputData = null;
        this._filters = [];       // [{col, mode, value}]
        this._currentMode = '>';

        var self = this;

        // Mode selector
        el.querySelectorAll('[data-sieve-mode]').forEach(function(btn) {
            btn.addEventListener('click', function() {
                el.querySelectorAll('[data-sieve-mode]').forEach(function(b) { b.classList.remove('active'); });
                btn.classList.add('active');
                self._currentMode = btn.dataset.sieveMode;
            });
        });

        // Add filter button
        var addBtn = document.getElementById(id + '-btn-add');
        if (addBtn) addBtn.addEventListener('click', function() { self._addFilter(); });

        // Clear all button
        var clearBtn = document.getElementById(id + '-btn-clear');
        if (clearBtn) clearBtn.addEventListener('click', function() {
            self._filters = [];
            self._renderFilterList();
            self._apply();
        });

        // Enter key on threshold adds filter
        var threshInput = document.getElementById(id + '-threshold');
        if (threshInput) threshInput.addEventListener('keydown', function(e) {
            if (e.key === 'Enter') self._addFilter();
        });

        // Column selector change — swap between numeric input and factor dropdown
        var colSelect = document.getElementById(id + '-col-select');
        if (colSelect) {
            colSelect.addEventListener('change', function() {
                self._updateValueInput(colSelect.value);
            });
        }
    },

    _isNumericCol(col) {
        if (!this._inputData || !this._inputData.data[col]) return true;
        var vals = this._inputData.data[col];
        var numCount = 0, total = 0;
        for (var i = 0; i < vals.length; i++) {
            if (vals[i] !== null && vals[i] !== undefined && vals[i] !== '') {
                total++;
                if (typeof vals[i] === 'number') numCount++;
            }
        }
        return total > 0 && numCount / total > 0.5;
    },

    _updateValueInput(col) {
        var threshInput = document.getElementById(this.id + '-threshold');
        var factorSelect = document.getElementById(this.id + '-factor-select');
        if (!threshInput || !factorSelect) return;

        var isNumeric = !col || this._isNumericCol(col);

        // Enable/disable > and < buttons for factor columns
        this.el.querySelectorAll('[data-sieve-mode]').forEach(function(btn) {
            var mode = btn.dataset.sieveMode;
            if (mode === '>' || mode === '<') {
                if (isNumeric) {
                    btn.disabled = false;
                    btn.style.opacity = '';
                    btn.style.color = '';
                    btn.style.cursor = 'pointer';
                } else {
                    btn.disabled = true;
                    btn.style.opacity = '0.3';
                    btn.style.color = '#f87171';
                    btn.style.cursor = 'not-allowed';
                    // If this mode was active, switch to =
                    if (btn.classList.contains('active')) {
                        btn.classList.remove('active');
                        var eqBtn = btn.parentNode.querySelector('[data-sieve-mode="="]');
                        if (eqBtn) { eqBtn.classList.add('active'); }
                        // Update current mode
                    }
                }
            }
        });

        // If switching to factor and current mode is > or <, force to =
        if (!isNumeric && (this._currentMode === '>' || this._currentMode === '<')) {
            this._currentMode = '=';
        }

        if (isNumeric) {
            // Show numeric input
            threshInput.style.display = '';
            factorSelect.style.display = 'none';
        } else {
            // Show factor dropdown with unique values
            threshInput.style.display = 'none';
            factorSelect.style.display = '';
            factorSelect.innerHTML = '';
            var vals = this._inputData.data[col] || [];
            var unique = [];
            var seen = {};
            for (var i = 0; i < vals.length; i++) {
                var v = vals[i];
                if (v === null || v === undefined || v === '') continue;
                var key = String(v).toLowerCase();
                if (!seen[key]) {
                    seen[key] = true;
                    unique.push(String(v));
                }
            }
            unique.sort();
            unique.forEach(function(u) {
                var opt = document.createElement('option');
                opt.value = u; opt.textContent = u;
                factorSelect.appendChild(opt);
            });
        }
    },

    receive(inputName, data) {
        if (!data) return;

        // Accept both columnar {data, columns} and plain arrays
        if (data.data && data.columns) {
            this._inputData = data;
        } else if (Array.isArray(data)) {
            // Wrap plain array into columnar format
            this._inputData = { data: { value: data }, columns: ['value'] };
        } else {
            return;
        }

        // Populate column selector
        var colSelect = document.getElementById(this.id + '-col-select');
        if (colSelect) {
            var prev = colSelect.value;
            colSelect.innerHTML = '';
            this._inputData.columns.forEach(function(c) {
                var opt = document.createElement('option');
                opt.value = c; opt.textContent = c;
                colSelect.appendChild(opt);
            });
            if (prev && this._inputData.columns.indexOf(prev) !== -1) colSelect.value = prev;
        }

        this._apply();
    },

    getOutput(name) {
        if (name === 'pass') return this._lastPass;
        if (name === 'reject') return this._lastReject;
        return null;
    },

    _addFilter() {
        var colSelect = document.getElementById(this.id + '-col-select');
        var threshInput = document.getElementById(this.id + '-threshold');
        var factorSelect = document.getElementById(this.id + '-factor-select');
        if (!colSelect) return;

        var col = colSelect.value;
        if (!col) return;

        var rawValue;
        if (factorSelect && factorSelect.style.display !== 'none') {
            rawValue = factorSelect.value;
        } else if (threshInput) {
            rawValue = threshInput.value.trim();
        } else {
            return;
        }

        // Store as number if possible, string otherwise (for factor columns)
        var numVal = Number(rawValue);
        var value = (rawValue !== '' && !isNaN(numVal)) ? numVal : rawValue;

        this._filters.push({ col: col, mode: this._currentMode, value: value });
        this._renderFilterList();
        this._apply();
    },

    _removeFilter(index) {
        this._filters.splice(index, 1);
        this._renderFilterList();
        this._apply();
    },

    _renderFilterList() {
        var listEl = document.getElementById(this.id + '-filter-list');
        var countEl = document.getElementById(this.id + '-filter-count');
        if (!listEl) return;

        if (this._filters.length === 0) {
            listEl.innerHTML = '<span style="color:rgba(34,211,238,0.1);">no filters \u2014 all rows pass</span>';
            if (countEl) countEl.textContent = '0';
            return;
        }

        if (countEl) countEl.textContent = this._filters.length;

        var self = this;
        listEl.innerHTML = '';
        this._filters.forEach(function(f, i) {
            var line = document.createElement('div');
            line.style.cssText = 'display:flex;align-items:center;gap:6px;cursor:pointer;padding:2px 4px;border-radius:2px;transition:background 0.1s;';
            line.title = 'Click to remove';
            line.addEventListener('mouseenter', function() { this.style.background = 'rgba(239,68,68,0.08)'; });
            line.addEventListener('mouseleave', function() { this.style.background = ''; });

            var modeSymbol = f.mode;
            var valueDisplay = typeof f.value === 'string' ? '"' + f.value + '"' : f.value;

            line.innerHTML =
                '<span style="color:rgba(34,211,238,0.6);font-weight:700;">' + f.col + '</span>' +
                '<span style="color:rgba(255,255,255,0.3);">' + modeSymbol + '</span>' +
                '<span style="color:rgba(34,211,238,0.5);">' + valueDisplay + '</span>' +
                '<span style="color:rgba(239,68,68,0.5);font-size:11px;margin-left:auto;font-weight:700;">\u00d7</span>';

            line.addEventListener('click', function() { self._removeFilter(i); });
            listEl.appendChild(line);
        });
    },

    _testRow(rowIndex) {
        // All filters must pass (AND logic)
        var data = this._inputData.data;
        for (var fi = 0; fi < this._filters.length; fi++) {
            var f = this._filters[fi];
            var v = data[f.col] ? data[f.col][rowIndex] : null;
            var t = f.value;

            // Handle null/undefined
            if (v === null || v === undefined || v === '') {
                if (f.mode === '=' && (t === '' || t === null)) continue; // null = null
                if (f.mode === '\u2260') continue; // null ≠ anything passes
                return false; // null fails >, <, = non-null
            }

            var isNumeric = typeof v === 'number' && typeof t === 'number';

            if (f.mode === '>') {
                if (!isNumeric || !(v > t)) return false;
            } else if (f.mode === '<') {
                if (!isNumeric || !(v < t)) return false;
            } else if (f.mode === '=') {
                if (isNumeric) {
                    if (Math.abs(v - t) >= 0.001) return false;
                } else {
                    // String equality — case-insensitive
                    if (String(v).toLowerCase() !== String(t).toLowerCase()) return false;
                }
            } else { // ≠
                if (isNumeric) {
                    if (Math.abs(v - t) < 0.001) return false;
                } else {
                    if (String(v).toLowerCase() === String(t).toLowerCase()) return false;
                }
            }
        }
        return true;
    },

    _apply() {
        if (!this._inputData || !this._inputData.columns) return;

        var cols = this._inputData.columns;
        var data = this._inputData.data;
        var rowCount = cols.length > 0 ? (data[cols[0]] || []).length : 0;

        if (this._filters.length === 0) {
            // No filters — pass everything
            this._lastPass = this._inputData;
            this._lastReject = { data: {}, columns: cols };
            this._updateDisplay(rowCount, rowCount, 0);
            FR.emit(this.id, 'pass', this._inputData);
            FR.LED(document.getElementById(this.id + '-led')).set('green');
            return;
        }

        var passIdx = [], rejectIdx = [];
        for (var i = 0; i < rowCount; i++) {
            if (this._testRow(i)) passIdx.push(i);
            else rejectIdx.push(i);
        }

        var passData = {}, rejectData = {};
        cols.forEach(function(c) {
            var arr = data[c] || [];
            passData[c] = passIdx.map(function(i) { return arr[i]; });
            rejectData[c] = rejectIdx.map(function(i) { return arr[i]; });
        });

        this._lastPass = { data: passData, columns: cols };
        this._lastReject = { data: rejectData, columns: cols };

        this._updateDisplay(passIdx.length, passIdx.length, rejectIdx.length);
        FR.emit(this.id, 'pass', this._lastPass);
        FR.emit(this.id, 'reject', this._lastReject);
        FR.LED(document.getElementById(this.id + '-led')).set(rejectIdx.length > 0 ? 'amber' : 'green');
    },

    _updateDisplay(rowsOut, passCount, rejectCount) {
        var rowsEl = document.getElementById(this.id + '-rows-out');
        var passEl = document.getElementById(this.id + '-pass');
        var rejectEl = document.getElementById(this.id + '-reject');

        if (rowsEl) {
            rowsEl.textContent = rowsOut;
        }
        if (passEl) passEl.textContent = passCount;
        if (rejectEl) rejectEl.textContent = rejectCount;
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


// ═══════════════════════════════════════════════════════════
// INTAKE IO-200 — File Loader & Data Viewer
// ═══════════════════════════════════════════════════════════

FR.registerUnit('intake', {
    init(el, id) {
        this.el = el;
        this.id = id;
        this._data = null;      // {data: {col: [vals]}, columns: ['col1',...]}
        this._filename = null;
        this._format = 'auto';

        var self = this;

        // Format selector
        el.querySelectorAll('[data-fmt]').forEach(function(btn) {
            btn.addEventListener('click', function() {
                el.querySelectorAll('[data-fmt]').forEach(function(b) { b.classList.remove('active'); });
                btn.classList.add('active');
                self._format = btn.dataset.fmt;
            });
        });

        // Drop zone
        var dropzone = document.getElementById(id + '-dropzone');
        var fileInput = document.getElementById(id + '-fileinput');

        if (dropzone) {
            dropzone.addEventListener('click', function() { fileInput && fileInput.click(); });

            dropzone.addEventListener('dragover', function(e) {
                e.preventDefault();
                dropzone.style.borderColor = 'rgba(124,160,196,0.5)';
                dropzone.style.background = 'rgba(124,160,196,0.04)';
            });
            dropzone.addEventListener('dragleave', function() {
                dropzone.style.borderColor = 'rgba(124,160,196,0.15)';
                dropzone.style.background = '';
            });
            dropzone.addEventListener('drop', function(e) {
                e.preventDefault();
                dropzone.style.borderColor = 'rgba(124,160,196,0.15)';
                dropzone.style.background = '';
                if (e.dataTransfer.files.length > 0) self._loadFile(e.dataTransfer.files[0]);
            });
        }

        if (fileInput) {
            fileInput.addEventListener('change', function() {
                if (fileInput.files.length > 0) self._loadFile(fileInput.files[0]);
            });
        }

        // Emit button
        var emitBtn = document.getElementById(id + '-btn-emit');
        if (emitBtn) emitBtn.addEventListener('click', function() {
            if (self._data) self._emit();
        });
    },

    getOutput(name) {
        if (!this._data) return null;
        if (name === 'full') return this._data;
        if (name === 'headers') return this._data.columns;
        if (name === 'meta') return {
            filename: this._filename,
            rows: this._data.columns.length > 0 ? (this._data.data[this._data.columns[0]] || []).length : 0,
            columns: this._data.columns.length,
            columnTypes: this._detectTypes()
        };
        // Per-column output
        if (this._data.data[name]) return this._data.data[name];
        return null;
    },

    _loadFile(file) {
        var self = this;
        this._filename = file.name;

        var nameEl = document.getElementById(this.id + '-filename');
        if (nameEl) nameEl.textContent = file.name;

        FR.LED(document.getElementById(this.id + '-led')).set('amber');

        var reader = new FileReader();
        reader.onload = function(e) {
            var text = e.target.result;
            self._parseText(text, file.name);
        };
        reader.readAsText(file);
    },

    _parseText(text, filename) {
        // Detect delimiter
        var delim = ',';
        if (this._format === 'tsv') {
            delim = '\t';
        } else if (this._format === 'auto') {
            var firstLine = text.split('\n')[0] || '';
            var tabs = (firstLine.match(/\t/g) || []).length;
            var commas = (firstLine.match(/,/g) || []).length;
            var semis = (firstLine.match(/;/g) || []).length;
            if (tabs > commas && tabs > semis) delim = '\t';
            else if (semis > commas) delim = ';';
        }

        var lines = text.split('\n').filter(function(l) { return l.trim() !== ''; });
        if (lines.length === 0) return;

        // Parse header
        var headers = this._parseLine(lines[0], delim);

        // Parse rows
        var data = {};
        headers.forEach(function(h) { data[h] = []; });

        for (var i = 1; i < lines.length; i++) {
            var cells = this._parseLine(lines[i], delim);
            for (var j = 0; j < headers.length; j++) {
                var val = cells[j] !== undefined ? cells[j] : null;
                // Try numeric conversion
                if (val !== null && val !== '') {
                    var num = Number(val);
                    if (!isNaN(num) && val.trim() !== '') val = num;
                }
                data[headers[j]].push(val);
            }
        }

        this._data = { data: data, columns: headers };
        var rowCount = lines.length - 1;

        // Update stats
        var rowsEl = document.getElementById(this.id + '-stat-rows');
        var colsEl = document.getElementById(this.id + '-stat-cols');
        if (rowsEl) { rowsEl.textContent = rowCount; rowsEl.style.color = 'rgba(124,160,196,0.6)'; }
        if (colsEl) { colsEl.textContent = headers.length; colsEl.style.color = 'rgba(124,160,196,0.6)'; }

        // Column LEDs
        for (var ci = 0; ci < 8; ci++) {
            var led = document.getElementById(this.id + '-col' + ci);
            if (led) FR.LED(led).set(ci < headers.length ? 'blue' : false);
        }

        // Column badges
        var badgeEl = document.getElementById(this.id + '-col-badges');
        if (badgeEl) {
            var types = this._detectTypes();
            badgeEl.innerHTML = '';
            headers.forEach(function(h, i) {
                var type = types[h] || 'txt';
                var colors = { num: '#60a5fa', txt: '#94a3b8', date: '#fbbf24' };
                var badge = document.createElement('span');
                badge.style.cssText = 'font:700 8px/1 "JetBrains Mono",monospace;padding:1px 4px;border-radius:1px;' +
                    'background:rgba(0,0,0,0.3);border:1px solid ' + (colors[type] || '#94a3b8') + '30;' +
                    'color:' + (colors[type] || '#94a3b8') + ';';
                badge.textContent = h + ' ' + type;
                badgeEl.appendChild(badge);
            });
        }

        // Emit selector
        var emitSel = document.getElementById(this.id + '-emit-col');
        if (emitSel) {
            emitSel.innerHTML = '<option value="all">All Columns</option>';
            headers.forEach(function(h) {
                var opt = document.createElement('option');
                opt.value = h; opt.textContent = h;
                emitSel.appendChild(opt);
            });
        }

        // Back panel jacks
        var backJacks = document.getElementById(this.id + '-back-jacks');
        if (backJacks) {
            backJacks.innerHTML = '';
            headers.forEach(function(h) {
                var group = document.createElement('div');
                group.className = 'patch-group';
                group.innerHTML = '<div class="patch-jack" data-output="' + h + '" data-unit-id="' + self.id + '"></div>' +
                    '<div class="patch-jack-label">' + h + '</div>';
                backJacks.appendChild(group);
            });
        }

        // Render table
        this._renderTable();

        FR.LED(document.getElementById(this.id + '-led')).set('green');
    },

    _parseLine(line, delim) {
        // Simple CSV parse with quote handling
        var cells = [];
        var current = '';
        var inQuotes = false;

        for (var i = 0; i < line.length; i++) {
            var ch = line[i];
            if (ch === '"') {
                if (inQuotes && line[i + 1] === '"') {
                    current += '"';
                    i++;
                } else {
                    inQuotes = !inQuotes;
                }
            } else if (ch === delim && !inQuotes) {
                cells.push(current.trim());
                current = '';
            } else {
                current += ch;
            }
        }
        cells.push(current.trim());
        return cells;
    },

    _detectTypes() {
        if (!this._data) return {};
        var types = {};
        var cols = this._data.columns;
        var data = this._data.data;

        cols.forEach(function(col) {
            var vals = data[col] || [];
            var numCount = 0, total = 0;
            for (var i = 0; i < vals.length; i++) {
                var v = vals[i];
                if (v === null || v === undefined || v === '') continue;
                total++;
                if (typeof v === 'number') numCount++;
            }
            types[col] = (total > 0 && numCount / total > 0.7) ? 'num' : 'txt';
        });
        return types;
    },

    _renderTable() {
        var container = document.getElementById(this.id + '-table-container');
        var empty = document.getElementById(this.id + '-empty');
        if (!container || !this._data) return;

        if (empty) empty.style.display = 'none';
        container.style.display = 'block';

        var cols = this._data.columns;
        var data = this._data.data;
        var rowCount = cols.length > 0 ? (data[cols[0]] || []).length : 0;
        var maxRows = Math.min(rowCount, 500); // Cap for performance

        var html = '<table style="width:100%;border-collapse:collapse;font:11px/1.3 \'JetBrains Mono\',monospace;">';

        // Header
        html += '<thead><tr style="position:sticky;top:0;z-index:1;">';
        html += '<th style="padding:4px 6px;text-align:right;background:#0e1520;color:rgba(124,160,196,0.25);' +
            'border-bottom:1px solid rgba(124,160,196,0.15);font-weight:400;min-width:30px;">#</th>';
        cols.forEach(function(col) {
            html += '<th style="padding:4px 8px;text-align:left;background:#0e1520;' +
                'color:rgba(124,160,196,0.6);border-bottom:1px solid rgba(124,160,196,0.15);' +
                'font-weight:700;letter-spacing:0.04em;white-space:nowrap;cursor:pointer;' +
                'border-right:1px solid rgba(124,160,196,0.04);" data-col="' + col + '">' + col + '</th>';
        });
        html += '</tr></thead><tbody>';

        // Rows
        for (var i = 0; i < maxRows; i++) {
            var bgColor = i % 2 === 0 ? 'transparent' : 'rgba(124,160,196,0.015)';
            html += '<tr style="background:' + bgColor + ';">';
            html += '<td style="padding:3px 6px;text-align:right;color:rgba(124,160,196,0.12);' +
                'border-right:1px solid rgba(124,160,196,0.04);">' + (i + 1) + '</td>';
            cols.forEach(function(col) {
                var val = data[col][i];
                var display = val === null || val === undefined ? '' : val;
                var isNum = typeof val === 'number';
                var color = val === null || val === undefined || val === ''
                    ? 'rgba(124,160,196,0.08)'
                    : isNum ? 'rgba(160,200,230,0.5)' : 'rgba(180,190,200,0.35)';
                var align = isNum ? 'right' : 'left';
                if (isNum && typeof display === 'number') {
                    display = display % 1 !== 0 ? display.toFixed(4) : display;
                }
                html += '<td style="padding:3px 8px;text-align:' + align + ';color:' + color + ';' +
                    'border-right:1px solid rgba(124,160,196,0.02);white-space:nowrap;">' + display + '</td>';
            });
            html += '</tr>';
        }

        if (maxRows < rowCount) {
            html += '<tr><td colspan="' + (cols.length + 1) + '" style="padding:6px;text-align:center;' +
                'color:rgba(124,160,196,0.15);font-style:italic;">... ' + (rowCount - maxRows) + ' more rows</td></tr>';
        }

        html += '</tbody></table>';
        container.innerHTML = html;

        // Sort on header click
        var self = this;
        container.querySelectorAll('th[data-col]').forEach(function(th) {
            th.addEventListener('click', function() {
                self._sortBy(th.dataset.col);
            });
        });
    },

    _sortBy(col) {
        if (!this._data || !this._data.data[col]) return;

        var cols = this._data.columns;
        var data = this._data.data;
        var n = data[col].length;

        // Build index array and sort
        var indices = [];
        for (var i = 0; i < n; i++) indices.push(i);

        // Toggle direction
        if (this._sortCol === col && this._sortDir === 'asc') {
            this._sortDir = 'desc';
        } else {
            this._sortCol = col;
            this._sortDir = 'asc';
        }
        var dir = this._sortDir === 'asc' ? 1 : -1;

        indices.sort(function(a, b) {
            var va = data[col][a], vb = data[col][b];
            if (va === null || va === undefined) return 1;
            if (vb === null || vb === undefined) return -1;
            if (typeof va === 'number' && typeof vb === 'number') return (va - vb) * dir;
            return String(va).localeCompare(String(vb)) * dir;
        });

        // Reorder all columns
        var newData = {};
        cols.forEach(function(c) {
            newData[c] = indices.map(function(i) { return data[c][i]; });
        });
        this._data.data = newData;
        this._renderTable();
    },

    _emit() {
        var emitSel = document.getElementById(this.id + '-emit-col');
        var col = emitSel ? emitSel.value : 'all';

        if (col === 'all') {
            // Emit full dataset
            FR.emit(this.id, 'full', this._data);
            // Also emit per-column for any wired jacks
            var self = this;
            this._data.columns.forEach(function(c) {
                FR.emit(self.id, c, self._data.data[c]);
            });
            console.log('[INTAKE] Emitted full dataset:', this._data.columns.length, 'columns');
        } else {
            // Emit single column
            FR.emit(this.id, col, this._data.data[col]);
            console.log('[INTAKE] Emitted column:', col, this._data.data[col].length, 'values');
        }

        FR.emit(this.id, 'headers', this._data.columns);
        FR.emit(this.id, 'meta', this.getOutput('meta'));
    }
});


// ═══════════════════════════════════════════════════════════
// TRIAGE TR-200 — Data Validation & Cleaning Station
// ═══════════════════════════════════════════════════════════

FR.registerUnit('triage', {
    init(el, id) {
        this.el = el;
        this.id = id;
        this._data = null;       // raw incoming {data, columns}
        this._cleaned = null;    // cleaned output
        this._issues = null;     // scan results
        this._mode = 'auto';     // auto | review
        this._missingAction = 'mean';
        this._outlierAction = 'flag';
        this._source = null;

        var self = this;

        // Mode selector
        el.querySelectorAll('[data-mode]').forEach(function(btn) {
            btn.addEventListener('click', function() {
                el.querySelectorAll('[data-mode]').forEach(function(b) { b.classList.remove('active'); });
                btn.classList.add('active');
                self._mode = btn.dataset.mode;
            });
        });

        // Missing strategy
        el.querySelectorAll('[data-missing]').forEach(function(btn) {
            btn.addEventListener('click', function() {
                el.querySelectorAll('[data-missing]').forEach(function(b) { b.classList.remove('active'); });
                btn.classList.add('active');
                self._missingAction = btn.dataset.missing;
            });
        });

        // Outlier strategy
        el.querySelectorAll('[data-outlier]').forEach(function(btn) {
            btn.addEventListener('click', function() {
                el.querySelectorAll('[data-outlier]').forEach(function(b) { b.classList.remove('active'); });
                btn.classList.add('active');
                self._outlierAction = btn.dataset.outlier;
            });
        });

        // Clean button
        var cleanBtn = document.getElementById(id + '-btn-clean');
        if (cleanBtn) cleanBtn.addEventListener('click', function() {
            if (self._data) self._runClean();
        });

        // Pass-through button
        var passBtn = document.getElementById(id + '-btn-pass');
        if (passBtn) passBtn.addEventListener('click', function() {
            if (self._data) {
                self._log('PASS THROUGH — no cleaning applied');
                FR.emit(self.id, 'clean', self._data);
                self._updateRowCounts(self._data);
                FR.LED(document.getElementById(self.id + '-led')).set('green');
            }
        });
    },

    receive(inputName, data, fromUnit) {
        if (!data) return;
        this._source = fromUnit || '?';
        this._data = data;

        var rowCount = this._countRows(data);
        var el = document.getElementById(this.id + '-rows-in');
        if (el) el.textContent = rowCount;

        FR.LED(document.getElementById(this.id + '-led')).set('amber');
        this._log('Received ' + rowCount + ' rows from ' + this._source);

        // Scan for issues
        this._runScan(data);

        // Auto mode: clean immediately
        if (this._mode === 'auto') {
            this._runClean();
        }
    },

    getOutput(name) {
        if (name === 'clean') return this._cleaned;
        if (name === 'report') return this._issues;
        return null;
    },

    _countRows(data) {
        if (!data) return 0;
        if (data.data && data.columns && data.columns.length > 0) {
            var firstCol = data.columns[0];
            return (data.data[firstCol] || []).length;
        }
        if (Array.isArray(data)) return data.length;
        return 0;
    },

    _runScan(data) {
        var issues = { errors: 0, missing: 0, outliers: 0, types: 0, details: [] };

        if (data && data.data && data.columns) {
            var cols = data.columns;
            for (var ci = 0; ci < cols.length; ci++) {
                var col = cols[ci];
                var vals = data.data[col] || [];

                var missingCount = 0;
                var numericVals = [];
                var hasNonNumeric = false;
                var errorCount = 0;

                for (var i = 0; i < vals.length; i++) {
                    var v = vals[i];

                    // Check for Excel errors
                    if (typeof v === 'string' && /^#(NUM|DIV\/0|VALUE|REF|NAME|N\/A|NULL|ERROR)!?$/i.test(v)) {
                        errorCount++;
                        continue;
                    }

                    // Check for missing
                    if (v === null || v === undefined || v === '' || (typeof v === 'number' && isNaN(v))) {
                        missingCount++;
                        continue;
                    }

                    // Collect numerics
                    var num = Number(v);
                    if (!isNaN(num) && v !== '') {
                        numericVals.push(num);
                    } else if (typeof v === 'string' && v.trim() !== '') {
                        hasNonNumeric = true;
                    }
                }

                if (errorCount > 0) {
                    issues.errors += errorCount;
                    issues.details.push({ type: 'error', col: col, count: errorCount });
                }

                if (missingCount > 0) {
                    issues.missing += missingCount;
                    issues.details.push({ type: 'missing', col: col, count: missingCount,
                        pct: Math.round(100 * missingCount / vals.length) });
                }

                // IQR outlier detection on numeric columns
                if (numericVals.length >= 10) {
                    numericVals.sort(function(a, b) { return a - b; });
                    var q1 = numericVals[Math.floor(numericVals.length * 0.25)];
                    var q3 = numericVals[Math.floor(numericVals.length * 0.75)];
                    var iqr = q3 - q1;
                    if (iqr > 0) {
                        var lo = q1 - 1.5 * iqr, hi = q3 + 1.5 * iqr;
                        var outlierCount = numericVals.filter(function(v) { return v < lo || v > hi; }).length;
                        if (outlierCount > 0) {
                            issues.outliers += outlierCount;
                            issues.details.push({ type: 'outlier', col: col, count: outlierCount,
                                range: '[' + lo.toFixed(1) + ', ' + hi.toFixed(1) + ']' });
                        }
                    }
                }

                // Type detection: text column that's mostly numeric
                if (hasNonNumeric && numericVals.length > 0) {
                    var numPct = numericVals.length / (numericVals.length + (vals.length - missingCount - errorCount - numericVals.length));
                    if (numPct > 0.8) {
                        issues.types++;
                        issues.details.push({ type: 'type', col: col, pct: Math.round(numPct * 100) });
                    }
                }
            }
        }

        this._issues = issues;
        this._updateDisplay(issues);

        // Emit report
        FR.emit(this.id, 'report', issues);
    },

    _updateDisplay(issues) {
        var id = this.id;

        // Update counters
        var errEl = document.getElementById(id + '-err-count');
        var missEl = document.getElementById(id + '-miss-count');
        var outEl = document.getElementById(id + '-out-count');
        var typeEl = document.getElementById(id + '-type-count');

        if (errEl) errEl.textContent = issues.errors || 0;
        if (missEl) missEl.textContent = issues.missing || 0;
        if (outEl) outEl.textContent = issues.outliers || 0;
        if (typeEl) typeEl.textContent = issues.types || 0;

        // Color the counts — dark segments on LCD, slightly tinted when issues found
        var dark = '#0a1208';
        if (errEl) errEl.style.color = issues.errors > 0 ? '#3a0808' : dark;
        if (missEl) missEl.style.color = issues.missing > 0 ? '#2a1a05' : dark;
        if (outEl) outEl.style.color = issues.outliers > 0 ? '#0a1a30' : dark;
        if (typeEl) typeEl.style.color = issues.types > 0 ? '#1a0a28' : dark;

        // LEDs
        FR.LED(document.getElementById(id + '-led-err')).set(issues.errors > 0 ? 'red' : false);
        FR.LED(document.getElementById(id + '-led-miss')).set(issues.missing > 0 ? 'amber' : false);
        FR.LED(document.getElementById(id + '-led-out')).set(issues.outliers > 0 ? 'blue' : false);
        FR.LED(document.getElementById(id + '-led-type')).set(issues.types > 0 ? 'accent' : false);

        // Log details
        var details = issues.details;
        for (var i = 0; i < details.length; i++) {
            var d = details[i];
            switch (d.type) {
                case 'error':
                    this._log('  ERR  ' + d.col + ': ' + d.count + ' Excel error(s)', '#ef4444');
                    break;
                case 'missing':
                    this._log('  MISS ' + d.col + ': ' + d.count + ' (' + d.pct + '%)', '#f59e0b');
                    break;
                case 'outlier':
                    this._log('  OUT  ' + d.col + ': ' + d.count + ' outside ' + d.range, '#60a5fa');
                    break;
                case 'type':
                    this._log('  TYPE ' + d.col + ': ' + d.pct + '% numeric', '#a855f7');
                    break;
            }
        }

        if (details.length === 0) {
            this._log('  CLEAN — no issues detected', '#22c55e');
        }

        this._log('Scan complete: ' + issues.errors + ' err, ' +
            issues.missing + ' miss, ' + issues.outliers + ' out, ' + issues.types + ' type');
    },

    _runClean() {
        if (!this._data || !this._data.data || !this._data.columns) {
            // Simple array — pass through
            this._cleaned = this._data;
            FR.emit(this.id, 'clean', this._data);
            this._updateRowCounts(this._data);
            FR.LED(document.getElementById(this.id + '-led')).set('green');
            return;
        }

        this._log('Cleaning: missing=' + this._missingAction + ', outliers=' + this._outlierAction);

        var data = this._data;
        var cols = data.columns.slice();
        var cleaned = {};
        var rowCount = 0;

        // Deep copy
        for (var ci = 0; ci < cols.length; ci++) {
            cleaned[cols[ci]] = (data.data[cols[ci]] || []).slice();
            rowCount = cleaned[cols[ci]].length;
        }

        // 1. Fix Excel errors → NaN
        for (var ci = 0; ci < cols.length; ci++) {
            var arr = cleaned[cols[ci]];
            for (var i = 0; i < arr.length; i++) {
                if (typeof arr[i] === 'string' && /^#(NUM|DIV\/0|VALUE|REF|NAME|N\/A|NULL|ERROR)!?$/i.test(arr[i])) {
                    arr[i] = null;
                }
            }
        }

        // 2. Type coercion — text→numeric where >80% are numeric
        for (var ci = 0; ci < cols.length; ci++) {
            var arr = cleaned[cols[ci]];
            var numCount = 0, total = 0;
            for (var i = 0; i < arr.length; i++) {
                if (arr[i] !== null && arr[i] !== undefined && arr[i] !== '') {
                    total++;
                    if (!isNaN(Number(arr[i]))) numCount++;
                }
            }
            if (total > 0 && numCount / total > 0.8) {
                for (var i = 0; i < arr.length; i++) {
                    if (arr[i] !== null && arr[i] !== undefined && arr[i] !== '') {
                        var n = Number(arr[i]);
                        if (!isNaN(n)) arr[i] = n;
                    }
                }
            }
        }

        // 3. Handle missing values
        if (this._missingAction === 'mean' || this._missingAction === 'median') {
            for (var ci = 0; ci < cols.length; ci++) {
                var arr = cleaned[cols[ci]];
                var nums = arr.filter(function(v) { return typeof v === 'number' && !isNaN(v); });
                if (nums.length === 0) continue;

                var fill;
                if (this._missingAction === 'mean') {
                    fill = nums.reduce(function(a, b) { return a + b; }, 0) / nums.length;
                } else {
                    nums.sort(function(a, b) { return a - b; });
                    fill = nums[Math.floor(nums.length / 2)];
                }

                for (var i = 0; i < arr.length; i++) {
                    if (arr[i] === null || arr[i] === undefined || arr[i] === '' || (typeof arr[i] === 'number' && isNaN(arr[i]))) {
                        arr[i] = fill;
                    }
                }
            }
        } else if (this._missingAction === 'drop') {
            // Find rows where >80% of values are missing
            var keepRows = [];
            for (var i = 0; i < rowCount; i++) {
                var missing = 0;
                for (var ci = 0; ci < cols.length; ci++) {
                    var v = cleaned[cols[ci]][i];
                    if (v === null || v === undefined || v === '' || (typeof v === 'number' && isNaN(v))) missing++;
                }
                if (missing / cols.length < 0.8) keepRows.push(i);
            }
            for (var ci = 0; ci < cols.length; ci++) {
                var old = cleaned[cols[ci]];
                cleaned[cols[ci]] = keepRows.map(function(ri) { return old[ri]; });
            }
            rowCount = keepRows.length;
        }

        // 4. Handle outliers (numeric columns only)
        for (var ci = 0; ci < cols.length; ci++) {
            var arr = cleaned[cols[ci]];
            var nums = arr.filter(function(v) { return typeof v === 'number' && !isNaN(v); });
            if (nums.length < 10) continue;

            nums.sort(function(a, b) { return a - b; });
            var q1 = nums[Math.floor(nums.length * 0.25)];
            var q3 = nums[Math.floor(nums.length * 0.75)];
            var iqr = q3 - q1;
            if (iqr <= 0) continue;
            var lo = q1 - 1.5 * iqr, hi = q3 + 1.5 * iqr;

            if (this._outlierAction === 'flag') {
                // Add _outlier flag column
                var flagCol = cols[ci] + '_outlier';
                if (cols.indexOf(flagCol) === -1) {
                    cols.push(flagCol);
                    cleaned[flagCol] = arr.map(function(v) {
                        return (typeof v === 'number' && (v < lo || v > hi)) ? 1 : 0;
                    });
                }
            } else if (this._outlierAction === 'clip') {
                for (var i = 0; i < arr.length; i++) {
                    if (typeof arr[i] === 'number') {
                        if (arr[i] < lo) arr[i] = lo;
                        if (arr[i] > hi) arr[i] = hi;
                    }
                }
            }
            // 'drop' handled below
        }

        // Outlier drop — remove rows with any outlier
        if (this._outlierAction === 'drop') {
            var keepRows = [];
            for (var i = 0; i < rowCount; i++) {
                var isOutlier = false;
                for (var ci = 0; ci < cols.length; ci++) {
                    var v = cleaned[cols[ci]][i];
                    if (typeof v !== 'number') continue;
                    var nums2 = (data.data[cols[ci]] || []).filter(function(x) { return typeof x === 'number'; });
                    if (nums2.length < 10) continue;
                    nums2.sort(function(a, b) { return a - b; });
                    var q1 = nums2[Math.floor(nums2.length * 0.25)];
                    var q3 = nums2[Math.floor(nums2.length * 0.75)];
                    var iqr2 = q3 - q1;
                    if (iqr2 > 0 && (v < q1 - 1.5 * iqr2 || v > q3 + 1.5 * iqr2)) { isOutlier = true; break; }
                }
                if (!isOutlier) keepRows.push(i);
            }
            for (var ci = 0; ci < cols.length; ci++) {
                var old = cleaned[cols[ci]];
                cleaned[cols[ci]] = keepRows.map(function(ri) { return old[ri]; });
            }
            rowCount = keepRows.length;
        }

        this._cleaned = { data: cleaned, columns: cols };

        var outRows = rowCount;
        this._updateRowCounts(this._cleaned);
        this._log('Output: ' + outRows + ' rows, ' + cols.length + ' columns', '#22c55e');

        FR.emit(this.id, 'clean', this._cleaned);
        FR.LED(document.getElementById(this.id + '-led')).set('green');
    },

    _updateRowCounts(data) {
        var count = this._countRows(data);
        var el = document.getElementById(this.id + '-rows-out');
        if (el) {
            el.textContent = count;
            el.style.color = 'rgba(34,197,94,0.6)';
        }
    },

    _log(msg, color) {
        var logEl = document.getElementById(this.id + '-log');
        if (!logEl) return;
        // Clear placeholder
        if (logEl.querySelector('span')) logEl.innerHTML = '';
        var line = document.createElement('div');
        line.textContent = msg;
        if (color) line.style.color = color;
        logEl.appendChild(line);
        logEl.scrollTop = logEl.scrollHeight;
    }
});

})(ForgeRack);
