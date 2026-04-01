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
        if (channel === 'parsed' && this.columns.length > 0) {
            return { data: this.data, columns: this.columns };
        }
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
                // Rebuild from columnar data if available (multi-trace), else single
                if (this._columnarData) {
                    this._buildFromColumnar();
                } else if (this._rawData) {
                    this._buildAndRender([{ vals: this._rawData, label: 'data', color: this._TRACE_COLORS[0] }]);
                }
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

    // Phosphor palette for multi-trace
    _TRACE_COLORS: ['#4ade80','#22d3ee','#f59e0b','#a78bfa','#f87171','#fb923c','#e879f9','#38bdf8','#84cc16','#fbbf24'],

    receive(inputName, data, fromUnit) {
        if (!data) return;
        this._source = fromUnit || '?';

        const viewport = document.getElementById(this.id + '-viewport');
        const empty = document.getElementById(this.id + '-empty');
        if (!viewport) return;

        // Already a ChartSpec — render directly
        if (data.traces || data.chart_type) {
            this._renderSpec(viewport, data);
            if (empty) empty.style.display = 'none';
            this._updateSettingsCRT(data);
            return;
        }

        // ANALYST result — display as text in the CRT
        if (data.title && data.lines) {
            if (empty) empty.style.display = 'none';
            viewport.innerHTML = '';
            var pre = document.createElement('div');
            pre.style.cssText = 'padding:10px 14px;font:11px/1.6 "JetBrains Mono",monospace;color:rgba(74,222,128,0.4);overflow-y:auto;height:100%;';
            var title = document.createElement('div');
            title.textContent = data.title;
            title.style.cssText = 'color:#4ade80;font-weight:700;margin-bottom:4px;';
            pre.appendChild(title);
            (data.lines || []).forEach(function(line) {
                var el = document.createElement('div');
                el.textContent = line;
                if (line.indexOf('\u2705') !== -1) el.style.color = 'rgba(34,197,94,0.7)';
                else if (line.indexOf('\u274c') !== -1) el.style.color = 'rgba(239,68,68,0.7)';
                pre.appendChild(el);
            });
            viewport.appendChild(pre);
            FR.LED(document.getElementById(this.id + '-led')).set('green');
            return;
        }

        // Columnar data — populate column selector and build multi-trace
        if (data.data && data.columns) {
            this._columnarData = data;
            this._populateColSelector(data);
            this._buildFromColumnar();
            if (empty) empty.style.display = 'none';
            return;
        }

        // Simple array
        if (Array.isArray(data)) {
            var vals = data.filter(function(v) { return typeof v === 'number'; });
            if (vals.length > 0) {
                this._rawData = vals;
                this._columnarData = null;
                this._buildAndRender([{ vals: vals, label: 'data', color: this._TRACE_COLORS[0] }]);
                if (empty) empty.style.display = 'none';
            }
        }
    },

    _populateColSelector(data) {
        var sel = document.getElementById(this.id + '-col-select');
        if (!sel) return;
        var prev = Array.from(sel.selectedOptions).map(function(o) { return o.value; });
        sel.innerHTML = '<option value="__ALL__">All numeric</option>';
        var self = this;
        data.columns.forEach(function(c) {
            var vals = data.data[c] || [];
            var isNum = vals.some(function(v) { return typeof v === 'number'; });
            if (!isNum) return;
            var opt = document.createElement('option');
            opt.value = c; opt.textContent = c;
            if (prev.indexOf(c) !== -1 || prev.indexOf('__ALL__') !== -1 || prev.length === 0) opt.selected = true;
            sel.appendChild(opt);
        });
        // Wire change handler (once)
        if (!sel._wired) {
            sel._wired = true;
            sel.addEventListener('change', function() { self._buildFromColumnar(); });
        }
    },

    _buildFromColumnar() {
        if (!this._columnarData) return;
        var sel = document.getElementById(this.id + '-col-select');
        var selected = sel ? Array.from(sel.selectedOptions).map(function(o) { return o.value; }) : ['__ALL__'];
        var data = this._columnarData;
        var self = this;

        var traces = [];
        var cols;

        if (selected.indexOf('__ALL__') !== -1) {
            // All numeric columns
            cols = data.columns.filter(function(c) {
                return (data.data[c] || []).some(function(v) { return typeof v === 'number'; });
            });
        } else {
            cols = selected;
        }

        cols.forEach(function(col, i) {
            var vals = (data.data[col] || []).map(function(v) { return typeof v === 'number' ? v : null; });
            var nums = vals.filter(function(v) { return v !== null; });
            if (nums.length === 0) return;
            traces.push({
                vals: vals,
                label: col,
                color: self._TRACE_COLORS[i % self._TRACE_COLORS.length]
            });
        });

        if (traces.length === 0) return;

        // Store for raw rebuild on chart type change
        this._rawData = traces[0].vals.filter(function(v) { return v !== null; });
        this._multiTraces = traces;

        this._buildAndRender(traces);
    },

    _buildAndRender(traces) {
        const viewport = document.getElementById(this.id + '-viewport');
        if (!viewport) return;

        // traces is [{vals, label, color}]
        var firstVals = traces[0].vals;
        const n = firstVals.length;
        const x = firstVals.map(function(_, i) { return i + 1; });
        var traceInput = document.getElementById(this.id + '-color-trace');
        var singleColor = (traceInput && traceInput.value) || '#4ade80';
        // Use single color only if 1 trace, otherwise use per-trace colors
        var usePerColor = traces.length > 1;
        let spec;

        // Build multi-trace or single-trace spec
        var allTraces = [];

        switch (this.chartType) {
            case 'line':
                traces.forEach(function(t, i) {
                    allTraces.push({ x: x, y: t.vals, trace_type: 'line', color: usePerColor ? t.color : singleColor, width: 1.5, marker_size: traces.length > 3 ? 0 : 3, name: t.label });
                });
                spec = { traces: allTraces };
                break;

            case 'scatter':
                traces.forEach(function(t, i) {
                    allTraces.push({ x: x, y: t.vals, trace_type: 'scatter', color: usePerColor ? t.color : singleColor, marker_size: 5, opacity: 0.7, name: t.label });
                });
                spec = { traces: allTraces };
                break;

            case 'bar':
                traces.forEach(function(t, i) {
                    allTraces.push({ x: x, y: t.vals, trace_type: 'bar', color: usePerColor ? t.color : singleColor, opacity: 0.8, name: t.label });
                });
                spec = { traces: allTraces };
                break;

            case 'hist': {
                traces.forEach(function(t, ti) {
                    var vals = t.vals.filter(function(v) { return v !== null; });
                    var bins = Math.max(5, Math.min(30, Math.ceil(Math.sqrt(vals.length))));
                    var mn = Math.min.apply(null, vals), mx = Math.max.apply(null, vals);
                    var bw = (mx - mn) / bins || 1;
                    var counts = new Array(bins).fill(0);
                    var edges = [];
                    for (var i = 0; i <= bins; i++) edges.push(mn + i * bw);
                    vals.forEach(function(v) { var b = Math.min(bins - 1, Math.floor((v - mn) / bw)); counts[b]++; });
                    var centers = edges.slice(0, bins).map(function(e, i) { return (e + edges[i + 1]) / 2; });
                    allTraces.push({ x: centers, y: counts, trace_type: 'bar', color: usePerColor ? t.color : singleColor, opacity: 0.7, name: t.label });
                });
                spec = { traces: allTraces };
                break;
            }

            case 'box':
                traces.forEach(function(t, i) {
                    var clean = t.vals.filter(function(v) { return v !== null; });
                    allTraces.push({
                        type: 'box', name: t.label,
                        q1: _quantile(clean, 0.25), median: _quantile(clean, 0.5), q3: _quantile(clean, 0.75),
                        whisker_low: Math.min.apply(null, clean), whisker_high: Math.max.apply(null, clean),
                        outliers: [], color: usePerColor ? t.color : singleColor, x_position: i
                    });
                });
                spec = { traces: allTraces };
                break;

            case 'control': {
                // I-chart: first trace only (SPC is single-column)
                var vals = traces[0].vals.filter(function(v) { return v !== null; });
                var cN = vals.length;
                var cX = vals.map(function(_, i) { return i + 1; });
                var cColor = usePerColor ? traces[0].color : singleColor;
                var mean = vals.reduce(function(a, b) { return a + b; }, 0) / cN;
                var mr = [];
                for (var i = 1; i < cN; i++) mr.push(Math.abs(vals[i] - vals[i - 1]));
                var mrBar = mr.length > 0 ? mr.reduce(function(a, b) { return a + b; }, 0) / mr.length : 0;
                var sigma = mrBar / 1.128;
                var ucl = mean + 3 * sigma, lcl = mean - 3 * sigma;
                spec = {
                    traces: [{ x: cX, y: vals, trace_type: 'line', color: cColor, width: 1.5, marker_size: 3, name: traces[0].label }],
                    reference_lines: [
                        { axis: 'y', value: ucl, color: '#f87171', width: 1, dash: 'dashed', label: 'UCL ' + ucl.toFixed(2) },
                        { axis: 'y', value: mean, color: '#4ade80', width: 1, label: 'CL ' + mean.toFixed(2) },
                        { axis: 'y', value: lcl, color: '#f87171', width: 1, dash: 'dashed', label: 'LCL ' + lcl.toFixed(2) },
                    ],
                    markers: []
                };
                var ooc = [];
                vals.forEach(function(v, i) { if (v > ucl || v < lcl) ooc.push(i); });
                if (ooc.length) spec.markers.push({ indices: ooc, color: '#f87171', size: 6 });
                break;
            }

            case 'heatmap':
                traces.forEach(function(t) {
                    allTraces.push({ x: x, y: t.vals, trace_type: 'line', color: usePerColor ? t.color : singleColor, width: 1.5, name: t.label });
                });
                spec = { traces: allTraces };
                break;

            default:
                traces.forEach(function(t) {
                    allTraces.push({ x: x, y: t.vals, trace_type: 'line', color: usePerColor ? t.color : singleColor, width: 1.5, marker_size: 3, name: t.label });
                });
                spec = { traces: allTraces };
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
        var modeEl = document.getElementById(this.id + '-mode-label');
        var ptsEl = document.getElementById(this.id + '-pts');
        var srcEl = document.getElementById(this.id + '-src');
        var traceCountEl = document.getElementById(this.id + '-trace-count');
        if (modeEl) modeEl.textContent = this.chartType.toUpperCase();
        if (ptsEl) ptsEl.textContent = this._rawData ? this._rawData.length : (spec && spec.traces && spec.traces[0] && spec.traces[0].y ? spec.traces[0].y.length : 0);
        if (traceCountEl) traceCountEl.textContent = this._multiTraces ? this._multiTraces.length : (spec && spec.traces ? spec.traces.length : 0);
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
        var meterEl = document.getElementById(this.id + '-pass-meter');

        if (rowsEl) rowsEl.textContent = rowsOut;
        if (passEl) passEl.textContent = passCount;
        if (rejectEl) rejectEl.textContent = rejectCount;

        if (meterEl) {
            var total = passCount + rejectCount;
            var pct = total > 0 ? Math.round(100 * passCount / total) : 100;
            meterEl.style.width = pct + '%';
            // Color: green > 80%, amber 50-80%, red < 50%
            meterEl.style.background = pct >= 80 ? '#22c55e' : pct >= 50 ? '#f59e0b' : '#ef4444';
        }
    }
});


// ═══════════════════════════════════════════════════════════
// REGISTER RD-04 — numeric display panel
// ═══════════════════════════════════════════════════════════

FR.registerUnit('readout', {
    init(el, id) {
        this.el = el;
        this.id = id;
        this._data = null;
        this._selectedCol = '';

        var self = this;
        var colSelect = document.getElementById(id + '-col');
        if (colSelect) {
            colSelect.addEventListener('change', function() {
                self._selectedCol = colSelect.value;
                if (self._data) self._computeStats();
            });
        }
    },

    receive(inputName, data) {
        if (!data) return;
        this._data = data;

        // Columnar data — auto-compute descriptive stats
        if (data.data && data.columns) {
            // Populate column selector
            var colSelect = document.getElementById(this.id + '-col');
            if (colSelect) {
                var prev = colSelect.value;
                colSelect.innerHTML = '<option value="">auto</option>';
                data.columns.forEach(function(c) {
                    var opt = document.createElement('option');
                    opt.value = c; opt.textContent = c;
                    colSelect.appendChild(opt);
                });
                if (prev && data.columns.indexOf(prev) !== -1) colSelect.value = prev;
            }
            this._computeStats();
            return;
        }

        // Legacy: array of {value, label} or plain numbers or object
        var items = [];
        if (Array.isArray(data)) {
            data.slice(0, 4).forEach(function(d, i) {
                if (typeof d === 'object' && d.value !== undefined) {
                    items.push(d);
                } else {
                    items.push({ value: d, label: 'ch' + (i + 1) });
                }
            });
        } else if (typeof data === 'object') {
            var keys = Object.keys(data);
            keys.slice(0, 4).forEach(function(k) {
                items.push({ value: data[k], label: k });
            });
        }
        this._showItems(items);
    },

    _computeStats() {
        if (!this._data || !this._data.data || !this._data.columns) return;

        // Pick column: selected or first numeric
        var col = this._selectedCol;
        if (!col) {
            for (var i = 0; i < this._data.columns.length; i++) {
                var c = this._data.columns[i];
                var vals = this._data.data[c] || [];
                if (vals.some(function(v) { return typeof v === 'number'; })) { col = c; break; }
            }
        }
        if (!col) return;

        var vals = (this._data.data[col] || []).filter(function(v) { return typeof v === 'number' && !isNaN(v); });
        if (vals.length === 0) {
            this._showItems([
                { value: '—', label: 'mean' },
                { value: '—', label: 'std' },
                { value: '—', label: 'min' },
                { value: '—', label: 'max' }
            ]);
            return;
        }

        var n = vals.length;
        var sum = 0; for (var i = 0; i < n; i++) sum += vals[i];
        var mean = sum / n;

        var ss = 0; for (var i = 0; i < n; i++) ss += (vals[i] - mean) * (vals[i] - mean);
        var std = n > 1 ? Math.sqrt(ss / (n - 1)) : 0;

        var sorted = vals.slice().sort(function(a, b) { return a - b; });
        var min = sorted[0];
        var max = sorted[n - 1];

        this._showItems([
            { value: mean, label: 'mean' },
            { value: std, label: 'std' },
            { value: min, label: 'min' },
            { value: max, label: 'max' }
        ]);
    },

    _showItems(items) {
        items.forEach(function(item, i) {
            var vEl = document.getElementById(this.id + '-v' + i);
            var lEl = document.getElementById(this.id + '-l' + i);
            if (vEl) {
                var v = item.value;
                if (typeof v === 'number') {
                    vEl.textContent = v.toFixed(2);
                } else {
                    vEl.textContent = String(v);
                }
                vEl.style.color = '';
                if (item.status === 'good') vEl.style.color = '#22c55e';
                else if (item.status === 'bad') vEl.style.color = '#ef4444';
                else if (item.status === 'warn') vEl.style.color = '#f59e0b';
            }
            if (lEl) lEl.textContent = item.label || '';
        }.bind(this));
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
        this._data = null;
        this._healthy = false;
    },

    // Called by wiring system when cables connect/disconnect
    onConnectionChange() {
        var channels = ['a', 'b', 'c', 'd'];
        var self = this;
        channels.forEach(function(ch) {
            var led = document.getElementById(self.id + '-led-' + ch);
            var key = self.id + ':' + ch;
            var hasListener = FR._listeners[key] && FR._listeners[key].length > 0;
            if (hasListener) {
                FR.LED(led).set(self._healthy ? 'green' : 'amber');
            } else {
                FR.LED(led).off();
            }
        });
    },

    receive(inputName, data) {
        this._data = data;

        // Determine health
        var healthy = false;
        var shapeText = '—';
        var meterPct = 0;

        if (data && data.data && data.columns) {
            var cols = data.columns.length;
            var rows = data.data[data.columns[0]] ? data.data[data.columns[0]].length : 0;
            healthy = cols > 0 && rows > 0;
            shapeText = rows + ' \u00d7 ' + cols;
            meterPct = Math.min(100, Math.round(rows / 10)); // scale: 1000 rows = full
        } else if (Array.isArray(data) && data.length > 0) {
            healthy = true;
            shapeText = data.length + ' vals';
            meterPct = Math.min(100, Math.round(data.length / 10));
        } else if (data) {
            healthy = true;
            shapeText = typeof data === 'string' ? data.length + ' ch' : 'obj';
            meterPct = 50;
        }

        this._healthy = healthy;

        // Main input LED
        FR.LED(document.getElementById(this.id + '-led')).set(healthy ? 'green' : 'red');

        // Signal meter
        var meter = document.getElementById(this.id + '-meter');
        if (meter) {
            meter.style.width = meterPct + '%';
            meter.style.background = healthy ? '#4ade80' : '#ef4444';
        }

        // Shape LCD
        var shape = document.getElementById(this.id + '-shape');
        if (shape) shape.textContent = shapeText;

        // Fan out to all outputs + per-channel LEDs
        var channels = ['a', 'b', 'c', 'd'];
        var self = this;
        channels.forEach(function(ch) {
            FR.emit(self.id, ch, data);
            var led = document.getElementById(self.id + '-led-' + ch);
            var key = self.id + ':' + ch;
            var hasListener = FR._listeners[key] && FR._listeners[key].length > 0;
            if (hasListener) {
                FR.LED(led).set(healthy ? 'green' : 'red');
            } else {
                FR.LED(led).off();
            }
        });
    },

    getOutput(channel) {
        return this._data || null;
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
            // Compute quick stats for tooltip
            var vals = data[col] || [];
            var nums = vals.filter(function(v) { return typeof v === 'number' && !isNaN(v); });
            var nulls = vals.filter(function(v) { return v === null || v === undefined || v === ''; }).length;
            var tip = col + '\n';
            if (nums.length > 0) {
                var sum = 0; for (var si = 0; si < nums.length; si++) sum += nums[si];
                var mn = nums[0], mx = nums[0];
                for (var si = 1; si < nums.length; si++) { if (nums[si] < mn) mn = nums[si]; if (nums[si] > mx) mx = nums[si]; }
                tip += 'n=' + vals.length + '  nulls=' + nulls + '\n';
                tip += 'mean=' + (sum / nums.length).toFixed(3) + '\n';
                tip += 'min=' + mn + '  max=' + mx;
            } else {
                var unique = {};
                vals.forEach(function(v) { if (v !== null && v !== undefined && v !== '') unique[v] = 1; });
                tip += 'n=' + vals.length + '  nulls=' + nulls + '\n';
                tip += 'unique=' + Object.keys(unique).length + ' (text)';
            }
            html += '<th style="padding:4px 8px;text-align:left;background:#0e1520;' +
                'color:rgba(124,160,196,0.6);border-bottom:1px solid rgba(124,160,196,0.15);' +
                'font-weight:700;letter-spacing:0.04em;white-space:nowrap;cursor:pointer;' +
                'border-right:1px solid rgba(124,160,196,0.04);" data-col="' + col + '" title="' + tip.replace(/"/g, '&quot;') + '">' + col + '</th>';
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

        // Action grip selector + Go button
        self._actionMode = 'clean';
        var gripEl = document.getElementById(id + '-action-grip');
        if (gripEl && ForgeRack.GripSelector) {
            ForgeRack.GripSelector(gripEl, { onChange: function(i, val) { self._actionMode = val; } });
        } else if (gripEl) {
            // Fallback: manual click handling
            gripEl.querySelectorAll('.grip-selector-option').forEach(function(opt, i) {
                opt.addEventListener('click', function() {
                    self._actionMode = opt.dataset.value || 'clean';
                    gripEl.setAttribute('data-pos', i);
                    gripEl.querySelectorAll('.grip-selector-option').forEach(function(o,j) { o.classList.toggle('active', j===i); });
                });
            });
        }
        var goBtn = document.getElementById(id + '-btn-go');
        if (goBtn) goBtn.addEventListener('click', function() {
            if (!self._data) return;
            if (self._actionMode === 'pass') {
                self._log('PASS THROUGH — no cleaning applied');
                FR.emit(self.id, 'clean', self._data);
                self._updateRowCounts(self._data);
                FR.LED(document.getElementById(self.id + '-led')).set('green');
            } else {
                self._runClean();
            }
        });
        // Legacy compat: keep btn-clean/btn-pass working if present
        var cleanBtn = document.getElementById(id + '-btn-clean');
        if (cleanBtn) cleanBtn.addEventListener('click', function() { if (self._data) self._runClean(); });
        var passBtn = document.getElementById(id + '-btn-pass');
        if (passBtn) passBtn.addEventListener('click', function() {
            if (self._data) { self._log('PASS THROUGH'); FR.emit(self.id, 'clean', self._data); }
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


// ═══════════════════════════════════════════════════════════
// CALC TX-01 — transform processor
// ═══════════════════════════════════════════════════════════

FR.registerUnit('calc', {
    _TWO_COL_OPS: { ratio: 1, col_diff: 1, col_sum: 1, col_prod: 1 },

    init(el, id) {
        this.el = el;
        this.id = id;
        this._data = null;
        this._chain = [];
        this._chainMode = false;

        var self = this;

        // Apply button
        var applyBtn = document.getElementById(id + '-btn-apply');
        if (applyBtn) {
            applyBtn.addEventListener('click', function() { self._apply(); });
        }

        // Chain toggle
        var chainBtn = document.getElementById(id + '-btn-chain');
        if (chainBtn) {
            chainBtn.addEventListener('click', function() {
                self._chainMode = !self._chainMode;
                chainBtn.style.color = self._chainMode ? '#d4884a' : 'rgba(212,136,74,0.25)';
                chainBtn.style.borderColor = self._chainMode ? 'rgba(212,136,74,0.3)' : 'rgba(212,136,74,0.1)';
                self._log(self._chainMode ? 'CHAIN mode ON — transforms stack' : 'CHAIN mode OFF — single transform', 'rgba(212,136,74,0.5)');
            });
        }

        // Transform selector — toggle Col B visibility
        var transformSelect = document.getElementById(id + '-transform');
        if (transformSelect) {
            transformSelect.addEventListener('change', function() {
                self._updateColBState();
            });
        }
    },

    _updateColBState() {
        var transformSelect = document.getElementById(this.id + '-transform');
        var colBPanel = document.getElementById(this.id + '-colb-panel');
        var colBSelect = document.getElementById(this.id + '-col-b');
        if (!transformSelect || !colBPanel || !colBSelect) return;

        var isTwoCol = this._TWO_COL_OPS[transformSelect.value];
        colBPanel.style.opacity = isTwoCol ? '1' : '0.3';
        colBSelect.disabled = !isTwoCol;
    },

    receive(inputName, data) {
        if (!data || !data.data || !data.columns) return;
        this._data = JSON.parse(JSON.stringify(data));
        this._chain = [];

        FR.LED(document.getElementById(this.id + '-led')).set('amber');

        // Populate both column selectors
        var colSelect = document.getElementById(this.id + '-col');
        var colBSelect = document.getElementById(this.id + '-col-b');

        if (colSelect) {
            var prev = colSelect.value;
            colSelect.innerHTML = '<option value="">—</option><option value="__ALL__">\u2605 All numeric</option>';
            data.columns.forEach(function(c) {
                var opt = document.createElement('option');
                opt.value = c; opt.textContent = c;
                colSelect.appendChild(opt);
            });
            if (prev && data.columns.indexOf(prev) !== -1) colSelect.value = prev;
        }

        if (colBSelect) {
            var prevB = colBSelect.value;
            colBSelect.innerHTML = '<option value="">—</option>';
            data.columns.forEach(function(c) {
                var opt = document.createElement('option');
                opt.value = c; opt.textContent = c;
                colBSelect.appendChild(opt);
            });
            if (prevB && data.columns.indexOf(prevB) !== -1) colBSelect.value = prevB;
        }

        var firstCol = data.columns[0];
        var n = firstCol ? (data.data[firstCol] || []).length : 0;
        var rowEl = document.getElementById(this.id + '-row-count');
        if (rowEl) rowEl.textContent = n;
        // Nixie tube row display
        var nStr = String(n).padStart(4, ' ');
        for (var ni = 0; ni < 4; ni++) {
            var nxEl = document.getElementById(this.id + '-nix-' + ni);
            if (nxEl) nxEl.textContent = nStr[ni] === ' ' ? '' : nStr[ni];
        }

        this._log('Received ' + data.columns.length + ' columns, ' + n + ' rows', 'rgba(212,136,74,0.5)');
        this._updateChainCount();
        this._updateColBState();

        // Thru-jack: pass original data unchanged for parallel routing
        FR.emit(this.id, 'thru', data);
    },

    _apply() {
        if (!this._data) { this._log('No data — wire a source first', '#ef4444'); return; }

        var colSelect = document.getElementById(this.id + '-col');
        var colBSelect = document.getElementById(this.id + '-col-b');
        var transformSelect = document.getElementById(this.id + '-transform');
        var paramInput = document.getElementById(this.id + '-param');

        var col = colSelect ? colSelect.value : '';
        var colB = colBSelect ? colBSelect.value : '';
        var transform = transformSelect ? transformSelect.value : 'mavg';
        var param = paramInput ? parseInt(paramInput.value) || 5 : 5;
        var isTwoCol = this._TWO_COL_OPS[transform];

        if (!col) { this._log('Select a column first', '#ef4444'); return; }

        // Two-column operation
        if (isTwoCol) {
            if (!colB) { this._log('Two-column op — select Col B', '#ef4444'); return; }
            this._applyTwoCol(col, colB, transform);
            return;
        }

        // "All numeric" batch mode
        if (col === '__ALL__') {
            this._applyAll(transform, param);
            return;
        }

        // Single column
        this._applySingle(col, transform, param);
    },

    _applySingle(col, transform, param) {
        var vals = this._data.data[col];
        if (!vals) { this._log('Column not found: ' + col, '#ef4444'); return; }

        var nums = vals.map(function(v) { return typeof v === 'number' ? v : NaN; });
        var result = this._compute(transform, nums, param);
        if (!result) { this._log('Transform failed on ' + col, '#ef4444'); return; }

        var outputName = col + '_' + transform + (this._needsParam(transform) ? param : '');
        this._addResult(outputName, result, transform + '(' + col + (this._needsParam(transform) ? ', w=' + param : '') + ')');
    },

    _applyAll(transform, param) {
        var self = this;
        var applied = 0;

        // If not chain mode, clear previous chain
        if (!this._chainMode && this._chain.length > 0) {
            this._chain.forEach(function(prev) {
                var idx = self._data.columns.indexOf(prev.outputCol);
                if (idx !== -1) { self._data.columns.splice(idx, 1); delete self._data.data[prev.outputCol]; }
            });
            this._chain = [];
        }

        // Find all numeric columns (from original data, not computed)
        var numericCols = this._data.columns.filter(function(c) {
            var v = self._data.data[c] || [];
            return v.some(function(x) { return typeof x === 'number'; });
        });

        numericCols.forEach(function(col) {
            // Skip columns that are themselves computed (contain _)
            var vals = self._data.data[col];
            if (!vals) return;
            var nums = vals.map(function(v) { return typeof v === 'number' ? v : NaN; });
            var result = self._compute(transform, nums, param);
            if (!result) return;

            var outputName = col + '_' + transform + (self._needsParam(transform) ? param : '');
            self._data.columns.push(outputName);
            self._data.data[outputName] = result;
            self._chain.push({ transform: transform, col: col, param: param, outputCol: outputName });
            applied++;
        });

        if (applied === 0) { this._log('No numeric columns to transform', '#ef4444'); return; }

        this._log(transform.toUpperCase() + ' applied to ' + applied + ' columns', '#d4884a');
        this._refreshColSelectors();
        this._showPreview(this._chain[this._chain.length - 1].outputCol, this._data.data[this._chain[this._chain.length - 1].outputCol]);
        this._updateChainCount();

        FR.emit(this.id, 'result', this._data);
        FR.LED(document.getElementById(this.id + '-led-chain')).set('amber');
    },

    _applyTwoCol(colA, colB, transform) {
        var a = this._data.data[colA];
        var b = this._data.data[colB];
        if (!a || !b) { this._log('Column not found', '#ef4444'); return; }

        var n = Math.min(a.length, b.length);
        var result = [];
        var label = '';

        for (var i = 0; i < n; i++) {
            var va = typeof a[i] === 'number' ? a[i] : NaN;
            var vb = typeof b[i] === 'number' ? b[i] : NaN;
            if (isNaN(va) || isNaN(vb)) { result.push(null); continue; }

            switch (transform) {
                case 'ratio':    result.push(vb === 0 ? null : va / vb); label = colA + '/' + colB; break;
                case 'col_diff': result.push(va - vb); label = colA + '-' + colB; break;
                case 'col_sum':  result.push(va + vb); label = colA + '+' + colB; break;
                case 'col_prod': result.push(va * vb); label = colA + '*' + colB; break;
            }
        }

        var outputName = label;
        this._addResult(outputName, result, transform.toUpperCase() + '(' + colA + ', ' + colB + ')');
    },

    _addResult(outputName, result, logMsg) {
        // If not chain mode, remove previous
        if (!this._chainMode && this._chain.length > 0) {
            var prev = this._chain[this._chain.length - 1];
            var idx = this._data.columns.indexOf(prev.outputCol);
            if (idx !== -1) { this._data.columns.splice(idx, 1); delete this._data.data[prev.outputCol]; }
            this._chain = [];
        }

        this._data.columns.push(outputName);
        this._data.data[outputName] = result;
        this._chain.push({ transform: logMsg, col: '', param: 0, outputCol: outputName });

        this._log(logMsg + ' \u2192 ' + outputName, '#d4884a');
        this._refreshColSelectors();
        this._showPreview(outputName, result);
        this._updateChainCount();

        FR.emit(this.id, 'result', this._data);
        FR.emit(this.id, 'column', result);  // just the computed column array
        FR.LED(document.getElementById(this.id + '-led-chain')).set('amber');
    },

    _refreshColSelectors() {
        var colSelect = document.getElementById(this.id + '-col');
        var colBSelect = document.getElementById(this.id + '-col-b');
        var cols = this._data.columns;

        if (colSelect) {
            var prev = colSelect.value;
            colSelect.innerHTML = '<option value="">—</option><option value="__ALL__">\u2605 All numeric</option>';
            cols.forEach(function(c) {
                var opt = document.createElement('option');
                opt.value = c; opt.textContent = c;
                colSelect.appendChild(opt);
            });
            if (prev && cols.indexOf(prev) !== -1) colSelect.value = prev;
            else if (prev === '__ALL__') colSelect.value = '__ALL__';
        }

        if (colBSelect) {
            var prevB = colBSelect.value;
            colBSelect.innerHTML = '<option value="">—</option>';
            cols.forEach(function(c) {
                var opt = document.createElement('option');
                opt.value = c; opt.textContent = c;
                colBSelect.appendChild(opt);
            });
            if (prevB && cols.indexOf(prevB) !== -1) colBSelect.value = prevB;
        }
    },

    _compute(transform, vals, param) {
        var n = vals.length;
        var result;

        switch (transform) {
            case 'mavg':
                result = [];
                for (var i = 0; i < n; i++) {
                    if (i < param - 1 || isNaN(vals[i])) { result.push(null); continue; }
                    var sum = 0, cnt = 0;
                    for (var j = i - param + 1; j <= i; j++) {
                        if (!isNaN(vals[j])) { sum += vals[j]; cnt++; }
                    }
                    result.push(cnt > 0 ? sum / cnt : null);
                }
                return result;

            case 'zscore':
            case 'std':
                var clean = vals.filter(function(v) { return !isNaN(v); });
                if (clean.length < 2) return null;
                var sum = 0; for (var i = 0; i < clean.length; i++) sum += clean[i];
                var mean = sum / clean.length;
                var ss = 0; for (var i = 0; i < clean.length; i++) ss += (clean[i] - mean) * (clean[i] - mean);
                var std = Math.sqrt(ss / (clean.length - 1));
                if (std === 0) return vals.map(function() { return 0; });
                return vals.map(function(v) { return isNaN(v) ? null : (v - mean) / std; });

            case 'log':
                return vals.map(function(v) { return isNaN(v) || v <= 0 ? null : Math.log(v); });

            case 'diff':
                result = [null];
                for (var i = 1; i < n; i++) {
                    result.push(isNaN(vals[i]) || isNaN(vals[i - 1]) ? null : vals[i] - vals[i - 1]);
                }
                return result;

            case 'lag':
                result = [];
                for (var i = 0; i < n; i++) {
                    result.push(i >= param ? vals[i - param] : null);
                }
                return result;

            case 'cumsum':
                result = []; var run = 0;
                for (var i = 0; i < n; i++) {
                    if (!isNaN(vals[i])) run += vals[i];
                    result.push(isNaN(vals[i]) ? null : run);
                }
                return result;

            case 'rank':
                var indexed = vals.map(function(v, i) { return { v: v, i: i }; });
                indexed.sort(function(a, b) {
                    if (isNaN(a.v)) return 1; if (isNaN(b.v)) return -1;
                    return a.v - b.v;
                });
                result = new Array(n);
                for (var i = 0; i < n; i++) result[indexed[i].i] = isNaN(indexed[i].v) ? null : i + 1;
                return result;

            case 'pctile':
                var sorted = vals.filter(function(v) { return !isNaN(v); }).slice().sort(function(a, b) { return a - b; });
                if (sorted.length === 0) return vals.map(function() { return null; });
                return vals.map(function(v) {
                    if (isNaN(v)) return null;
                    var below = 0;
                    for (var j = 0; j < sorted.length; j++) { if (sorted[j] < v) below++; }
                    return Math.round(100 * below / sorted.length);
                });

            case 'abs':
                return vals.map(function(v) { return isNaN(v) ? null : Math.abs(v); });

            case 'sqrt':
                return vals.map(function(v) { return isNaN(v) || v < 0 ? null : Math.sqrt(v); });

            case 'pct_change':
                result = [null];
                for (var i = 1; i < n; i++) {
                    if (isNaN(vals[i]) || isNaN(vals[i - 1]) || vals[i - 1] === 0) { result.push(null); }
                    else { result.push(100 * (vals[i] - vals[i - 1]) / Math.abs(vals[i - 1])); }
                }
                return result;

            default:
                return null;
        }
    },

    _needsParam(transform) {
        return transform === 'mavg' || transform === 'lag';
    },

    _showPreview(colName, vals) {
        var nameEl = document.getElementById(this.id + '-out-name');
        if (nameEl) nameEl.textContent = colName;

        var previewEl = document.getElementById(this.id + '-preview');
        if (!previewEl) return;

        var lines = [];
        var show = Math.min(vals.length, 12);
        for (var i = 0; i < show; i++) {
            var v = vals[i];
            var formatted = v === null ? '<span style="color:rgba(212,136,74,0.1);">null</span>' :
                typeof v === 'number' ? '<span style="color:#d4884a;">' + v.toFixed(2) + '</span>' : v;
            lines.push(formatted);
        }
        if (vals.length > 12) lines.push('<span style="color:rgba(212,136,74,0.12);">... ' + (vals.length - 12) + ' more</span>');
        previewEl.innerHTML = lines.join('<br>');
    },

    _updateChainCount() {
        var el = document.getElementById(this.id + '-chain-count');
        if (el) el.textContent = this._chain.length;
    },

    _log(msg, color) {
        var logEl = document.getElementById(this.id + '-log');
        if (!logEl) return;
        if (logEl.querySelector('span')) logEl.innerHTML = '';
        var line = document.createElement('div');
        line.textContent = msg;
        if (color) line.style.color = color;
        logEl.appendChild(line);
        logEl.scrollTop = logEl.scrollHeight;
    },

    getOutput(channel) {
        if (channel === 'result' && this._data) return this._data;
        if (channel === 'thru' && this._data) return this._data;
        return null;
    }
});


// ═══════════════════════════════════════════════════════════
// ANALYST AN-01 — statistical analysis engine (TOKAMAK)
// ═══════════════════════════════════════════════════════════

FR.registerUnit('analyst', {
    // Full analysis catalog — {package: {category: [{value, label, needsB, needsSpec}]}}
    _CATALOG: {
        forgestat: {
            'Hypothesis Tests': [
                { value: 'one_sample_t', label: 'One-Sample t-Test', needsB: false },
                { value: 'two_sample_t', label: 'Two-Sample t-Test', needsB: true },
                { value: 'paired_t', label: 'Paired t-Test', needsB: true },
                { value: 'one_proportion', label: 'One Proportion', needsB: false },
                { value: 'two_proportions', label: 'Two Proportions', needsB: true },
                { value: 'f_test', label: 'F-Test (Variance)', needsB: true },
                { value: 'variance_test', label: 'Levene/Bartlett', needsB: true },
            ],
            'ANOVA': [
                { value: 'one_way_anova', label: 'One-Way ANOVA', needsB: true },
                { value: 'two_way_anova', label: 'Two-Way ANOVA', needsB: true },
                { value: 'repeated_measures', label: 'Repeated Measures', needsB: true },
                { value: 'split_plot', label: 'Split-Plot ANOVA', needsB: true },
                { value: 'one_way_manova', label: 'MANOVA', needsB: true },
                { value: 'anom', label: 'Analysis of Means', needsB: true },
            ],
            'Nonparametric': [
                { value: 'mann_whitney', label: 'Mann-Whitney U', needsB: true },
                { value: 'kruskal_wallis', label: 'Kruskal-Wallis', needsB: true },
                { value: 'wilcoxon', label: 'Wilcoxon Signed-Rank', needsB: true },
                { value: 'friedman', label: 'Friedman', needsB: true },
                { value: 'mood_median', label: "Mood's Median", needsB: true },
                { value: 'sign_test', label: 'Sign Test', needsB: true },
                { value: 'runs_test', label: 'Runs Test', needsB: false },
            ],
            'Regression': [
                { value: 'ols', label: 'OLS Regression', needsB: true },
                { value: 'polynomial', label: 'Polynomial', needsB: true },
                { value: 'logistic', label: 'Logistic Regression', needsB: true },
                { value: 'robust', label: 'Robust Regression', needsB: true },
                { value: 'stepwise', label: 'Stepwise Selection', needsB: true },
                { value: 'curve_fit', label: 'Curve Fitting', needsB: true },
            ],
            'Correlation': [
                { value: 'pearson', label: 'Pearson r', needsB: true },
                { value: 'spearman', label: 'Spearman rho', needsB: true },
                { value: 'kendall', label: 'Kendall tau', needsB: true },
            ],
            'Chi-Square': [
                { value: 'chi_sq_indep', label: 'Independence', needsB: true },
                { value: 'chi_sq_gof', label: 'Goodness of Fit', needsB: false },
                { value: 'fisher_exact', label: "Fisher's Exact", needsB: true },
            ],
            'Post-Hoc': [
                { value: 'tukey_hsd', label: 'Tukey HSD', needsB: true },
                { value: 'games_howell', label: 'Games-Howell', needsB: true },
                { value: 'dunnett', label: 'Dunnett', needsB: true },
                { value: 'dunn', label: 'Dunn', needsB: true },
                { value: 'scheffe', label: 'Scheffé', needsB: true },
            ],
            'Bayesian': [
                { value: 'bayes_t_one', label: 'Bayesian t (1-sample)', needsB: false },
                { value: 'bayes_t_two', label: 'Bayesian t (2-sample)', needsB: true },
                { value: 'bayes_proportion', label: 'Bayesian Proportion', needsB: false },
                { value: 'bayes_correlation', label: 'Bayesian Correlation', needsB: true },
            ],
            'Exploratory': [
                { value: 'descriptive', label: 'Descriptive Stats', needsB: false },
                { value: 'normality', label: 'Normality Test', needsB: false },
                { value: 'bootstrap_ci', label: 'Bootstrap CI', needsB: false },
                { value: 'tolerance', label: 'Tolerance Interval', needsB: false },
                { value: 'pca', label: 'PCA', needsB: false },
                { value: 'outliers', label: 'Outlier Detection', needsB: false },
            ],
            'Power Analysis': [
                { value: 'power_t', label: 'Power: t-Test', needsB: false },
                { value: 'power_anova', label: 'Power: ANOVA', needsB: false },
                { value: 'power_prop', label: 'Power: Proportion', needsB: false },
                { value: 'power_chi', label: 'Power: Chi-Square', needsB: false },
                { value: 'sample_size_ci', label: 'Sample Size for CI', needsB: false },
            ],
            'Reliability': [
                { value: 'weibull', label: 'Weibull Fit', needsB: false },
                { value: 'kaplan_meier', label: 'Kaplan-Meier', needsB: false },
                { value: 'log_rank', label: 'Log-Rank Test', needsB: true },
                { value: 'cox_ph', label: 'Cox PH Regression', needsB: true },
            ],
            'Time Series': [
                { value: 'adf_test', label: 'ADF Stationarity', needsB: false },
                { value: 'kpss_test', label: 'KPSS Test', needsB: false },
                { value: 'acf_pacf', label: 'ACF/PACF', needsB: false },
                { value: 'arima', label: 'ARIMA', needsB: false },
                { value: 'granger', label: 'Granger Causality', needsB: true },
                { value: 'changepoint', label: 'Changepoint (PELT)', needsB: false },
                { value: 'anomaly', label: 'Anomaly Detection', needsB: false },
            ],
        },
        // forgespc → SENTINEL SpX-481
        // forgedoe → CRUCIBLE (future)
        // MSA → CALIBER (future)
    },

    init(el, id) {
        this.el = el;
        this.id = id;
        this._data = null;
        this._lastResult = null;

        var self = this;

        // Wire up cascading selectors (package is always forgestat now)
        var catSel = document.getElementById(id + '-cat');
        var analysisSel = document.getElementById(id + '-analysis');

        if (catSel) catSel.addEventListener('change', function() { self._populateAnalyses(); });
        if (analysisSel) analysisSel.addEventListener('change', function() { self._onAnalysisChange(); });

        // Format toggle
        var fmtSel = document.getElementById(id + '-data-fmt');
        if (fmtSel) fmtSel.addEventListener('change', function() {
            self._updateColBLabel();
            // Re-populate Col B with appropriate columns (numeric vs all)
            if (self._data) self._populateColSelectors(self._data);
        });

        // Run button
        var runBtn = document.getElementById(id + '-btn-run');
        if (runBtn) runBtn.addEventListener('click', function() { self._run(); });

        // Init first cascade
        this._populateCategories();
    },

    _populateCategories() {
        var catSel = document.getElementById(this.id + '-cat');
        if (!catSel) return;

        var pkg = 'forgestat';
        var cats = this._CATALOG[pkg] || {};
        catSel.innerHTML = '';
        Object.keys(cats).forEach(function(cat) {
            var opt = document.createElement('option');
            opt.value = cat; opt.textContent = cat;
            catSel.appendChild(opt);
        });
        this._populateAnalyses();
    },

    _populateAnalyses() {
        var catSel = document.getElementById(this.id + '-cat');
        var analysisSel = document.getElementById(this.id + '-analysis');
        if (!catSel || !analysisSel) return;

        var pkg = 'forgestat';
        var cat = catSel.value;
        var analyses = (this._CATALOG[pkg] || {})[cat] || [];
        analysisSel.innerHTML = '';
        analyses.forEach(function(a) {
            var opt = document.createElement('option');
            opt.value = a.value; opt.textContent = a.label;
            analysisSel.appendChild(opt);
        });
        this._onAnalysisChange();
    },

    _onAnalysisChange() {
        var info = this._getSelectedAnalysis();
        if (!info) return;

        // Toggle Factor/Col B panel
        var colBPanel = document.getElementById(this.id + '-colb-panel');
        var colBSel = document.getElementById(this.id + '-col-b');
        var colBLabel = document.getElementById(this.id + '-colb-label');
        if (colBPanel) colBPanel.style.opacity = info.needsB ? '1' : '0.3';
        if (colBSel) colBSel.disabled = !info.needsB;

        // Toggle format selector for two-sample tests
        var fmtPanel = document.getElementById(this.id + '-fmt-panel');
        var fmtSel = document.getElementById(this.id + '-data-fmt');
        var showFmt = info.needsB && !info.needsSpec;
        if (fmtPanel) fmtPanel.style.opacity = showFmt ? '1' : '0.3';
        if (fmtSel) fmtSel.disabled = !showFmt;

        // Update Col B label based on format
        this._updateColBLabel();

        // Toggle spec limits
        var lslPanel = document.getElementById(this.id + '-lsl-panel');
        var uslPanel = document.getElementById(this.id + '-usl-panel');
        if (lslPanel) lslPanel.style.opacity = info.needsSpec ? '1' : '0.3';
        if (uslPanel) uslPanel.style.opacity = info.needsSpec ? '1' : '0.3';
    },

    _updateColBLabel() {
        var colBLabel = document.getElementById(this.id + '-colb-label');
        var fmtSel = document.getElementById(this.id + '-data-fmt');
        if (!colBLabel) return;
        var fmt = fmtSel ? fmtSel.value : 'factor';
        colBLabel.textContent = fmt === 'factor' ? 'Factor' : 'Col B';
    },

    _getSelectedAnalysis() {
        var catSel = document.getElementById(this.id + '-cat');
        var analysisSel = document.getElementById(this.id + '-analysis');
        if (!catSel || !analysisSel) return null;

        var pkg = 'forgestat', cat = catSel.value, val = analysisSel.value;
        var analyses = (this._CATALOG[pkg] || {})[cat] || [];
        for (var i = 0; i < analyses.length; i++) {
            if (analyses[i].value === val) return analyses[i];
        }
        return null;
    },

    receive(inputName, data) {
        if (!data || !data.data || !data.columns) return;
        this._data = data;

        FR.LED(document.getElementById(this.id + '-led-power')).set('red');

        this._populateColSelectors(data);

        var n = data.data[data.columns[0]] ? data.data[data.columns[0]].length : 0;
        this._log('Received ' + data.columns.length + ' cols, ' + n + ' rows');
    },

    _populateColSelectors(data) {
        var colA = document.getElementById(this.id + '-col-a');
        var colB = document.getElementById(this.id + '-col-b');
        var fmtSel = document.getElementById(this.id + '-data-fmt');
        var fmt = fmtSel ? fmtSel.value : 'factor';

        // Classify columns
        var numericCols = [];
        var factorCols = [];
        data.columns.forEach(function(c) {
            var vals = data.data[c] || [];
            var hasNum = vals.some(function(v) { return typeof v === 'number'; });
            var hasStr = vals.some(function(v) { return typeof v === 'string'; });
            if (hasNum && !hasStr) numericCols.push(c);
            else if (hasStr) factorCols.push(c);
            else numericCols.push(c); // default to numeric
        });

        // Response: always numeric columns
        if (colA) {
            var prevA = colA.value;
            colA.innerHTML = '<option value="">—</option>';
            numericCols.forEach(function(c) {
                var opt = document.createElement('option');
                opt.value = c; opt.textContent = c;
                colA.appendChild(opt);
            });
            if (prevA && numericCols.indexOf(prevA) !== -1) colA.value = prevA;
            // Smart pre-select: first column matching response/y/value/measurement
            if (!colA.value) {
                var hints = /response|^y$|output|result|measure|value|yield|strength|weight/i;
                for (var i = 0; i < numericCols.length; i++) {
                    if (hints.test(numericCols[i])) { colA.value = numericCols[i]; break; }
                }
            }
        }

        // Col B: factor columns when stacked, numeric when "2 Cols" mode
        if (colB) {
            var prevB = colB.value;
            colB.innerHTML = '<option value="">—</option>';
            var bCols = fmt === 'factor' ? factorCols.concat(numericCols) : numericCols;
            // In factor mode, show factor columns first
            if (fmt === 'factor') {
                factorCols.forEach(function(c) {
                    var opt = document.createElement('option');
                    opt.value = c; opt.textContent = c + ' \u2022';  // dot = factor
                    colB.appendChild(opt);
                });
                numericCols.forEach(function(c) {
                    var opt = document.createElement('option');
                    opt.value = c; opt.textContent = c;
                    colB.appendChild(opt);
                });
            } else {
                numericCols.forEach(function(c) {
                    var opt = document.createElement('option');
                    opt.value = c; opt.textContent = c;
                    colB.appendChild(opt);
                });
            }
            if (prevB && data.columns.indexOf(prevB) !== -1) colB.value = prevB;
            // Smart pre-select factor
            if (!colB.value && fmt === 'factor' && factorCols.length > 0) {
                var fHints = /factor|group|treatment|category|type|machine|operator|batch/i;
                for (var i = 0; i < factorCols.length; i++) {
                    if (fHints.test(factorCols[i])) { colB.value = factorCols[i]; break; }
                }
                if (!colB.value) colB.value = factorCols[0];
            }
        }
    },

    _run() {
        if (!this._data) { this._log('No data — wire a source', '#ef4444'); return; }

        var analysisSel = document.getElementById(this.id + '-analysis');
        var colASel = document.getElementById(this.id + '-col-a');
        var colBSel = document.getElementById(this.id + '-col-b');
        var alphaInput = document.getElementById(this.id + '-alpha');
        var muInput = document.getElementById(this.id + '-mu');
        var fmtSel = document.getElementById(this.id + '-data-fmt');

        var analysis = analysisSel ? analysisSel.value : '';
        var colA = colASel ? colASel.value : '';
        var colB = colBSel ? colBSel.value : '';
        var alpha = alphaInput ? parseFloat(alphaInput.value) || 0.05 : 0.05;
        var mu = muInput ? parseFloat(muInput.value) || 0 : 0;
        var dataFmt = fmtSel ? fmtSel.value : 'factor';

        if (!colA) { this._log('Select Response column', '#ef4444'); return; }

        // Extract data based on format
        var valsA, valsB;
        var info = this._getSelectedAnalysis();
        var needsB = info && info.needsB;

        if (needsB && dataFmt === 'factor' && colB) {
            // STACKED: colA = response (numeric), colB = factor (grouping)
            var extracted = this._extractStacked(colA, colB);
            if (extracted.error) { this._log(extracted.error, '#ef4444'); return; }
            valsA = extracted.group1;
            valsB = extracted.group2;
            // Override labels for display
            colA = extracted.label1;
            colB = extracted.label2;
        } else if (needsB && dataFmt === 'columns' && colB) {
            // UNSTACKED: two separate numeric columns
            valsA = (this._data.data[colA] || []).filter(function(v) { return typeof v === 'number' && !isNaN(v); });
            valsB = (this._data.data[colB] || []).filter(function(v) { return typeof v === 'number' && !isNaN(v); });
        } else {
            // Single column analysis
            valsA = (this._data.data[colA] || []).filter(function(v) { return typeof v === 'number' && !isNaN(v); });
            valsB = [];
        }

        if (valsA.length < 2) { this._log('Response has < 2 numeric values', '#ef4444'); return; }

        var result = null;

        // Client-side implementations
        switch (analysis) {
            case 'descriptive': result = this._descriptive(valsA, colA); break;
            case 'normality': result = this._normality(valsA, colA); break;
            case 'one_sample_t': result = this._oneSampleT(valsA, mu, alpha, colA); break;
            case 'two_sample_t': result = this._twoSampleT(valsA, valsB, alpha, colA, colB); break;
            case 'paired_t': result = this._pairedT(valsA, valsB, alpha, colA, colB); break;
            case 'pearson': case 'spearman': case 'kendall':
                result = this._correlation(valsA, valsB, analysis, alpha, colA, colB); break;
            case 'mann_whitney': result = this._mannWhitney(valsA, valsB, alpha, colA, colB); break;
            // process_cap → SENTINEL SpX-481
            case 'outliers': result = this._outliers(valsA, colA); break;
            case 'runs_test': result = this._runsTest(valsA, colA, alpha); break;
            default:
                result = this._emitServerRequest(analysis, colA, colB, alpha, mu);
                break;
        }

        if (result) this._displayResult(result);
    },

    // Extract two groups from stacked data (response + factor columns)
    _extractStacked(responseCol, factorCol) {
        var response = this._data.data[responseCol] || [];
        var factor = this._data.data[factorCol] || [];
        var n = Math.min(response.length, factor.length);

        // Find unique levels
        var levelSet = {};
        for (var i = 0; i < n; i++) {
            var f = factor[i];
            if (f !== null && f !== undefined && f !== '') levelSet[f] = true;
        }
        var levels = Object.keys(levelSet);

        if (levels.length < 2) {
            return { error: 'Factor "' + factorCol + '" has < 2 levels (found: ' + levels.join(', ') + ')' };
        }
        if (levels.length > 2) {
            // For two-sample tests, use first two levels. ANOVA would use all.
            // Show what we found so user knows
        }

        var groups = {};
        for (var i = 0; i < n; i++) {
            var f = factor[i];
            var v = response[i];
            if (f === null || f === undefined || f === '') continue;
            if (typeof v !== 'number' || isNaN(v)) continue;
            if (!groups[f]) groups[f] = [];
            groups[f].push(v);
        }

        // For two-sample: use first two levels
        var g1 = groups[levels[0]] || [];
        var g2 = groups[levels[1]] || [];

        if (g1.length < 2 || g2.length < 2) {
            return { error: 'Groups too small: ' + levels[0] + ' (n=' + g1.length + '), ' + levels[1] + ' (n=' + g2.length + ')' };
        }

        return {
            group1: g1,
            group2: g2,
            label1: levels[0],
            label2: levels[1],
            allLevels: levels,
            allGroups: groups
        };
    },

    // ── Client-side analysis implementations ──

    _descriptive(vals, col) {
        var n = vals.length;
        var sorted = vals.slice().sort(function(a, b) { return a - b; });
        var sum = 0; for (var i = 0; i < n; i++) sum += vals[i];
        var mean = sum / n;
        var ss = 0; for (var i = 0; i < n; i++) ss += (vals[i] - mean) * (vals[i] - mean);
        var std = Math.sqrt(ss / (n - 1));
        var se = std / Math.sqrt(n);
        var median = n % 2 === 0 ? (sorted[n / 2 - 1] + sorted[n / 2]) / 2 : sorted[Math.floor(n / 2)];
        var q1 = sorted[Math.floor(n * 0.25)];
        var q3 = sorted[Math.floor(n * 0.75)];
        var skew = 0, kurt = 0;
        for (var i = 0; i < n; i++) {
            var z = (vals[i] - mean) / std;
            skew += z * z * z; kurt += z * z * z * z;
        }
        skew /= n; kurt = kurt / n - 3;

        return {
            title: 'Descriptive Statistics: ' + col,
            statistic: mean, pValue: null, effect: std,
            n: n, verdict: 'info',
            lines: [
                'n          = ' + n,
                'Mean       = ' + mean.toFixed(4),
                'Std Dev    = ' + std.toFixed(4),
                'Std Error  = ' + se.toFixed(4),
                'Median     = ' + median.toFixed(4),
                'Q1         = ' + q1.toFixed(4),
                'Q3         = ' + q3.toFixed(4),
                'IQR        = ' + (q3 - q1).toFixed(4),
                'Min        = ' + sorted[0].toFixed(4),
                'Max        = ' + sorted[n - 1].toFixed(4),
                'Range      = ' + (sorted[n - 1] - sorted[0]).toFixed(4),
                'Skewness   = ' + skew.toFixed(4),
                'Kurtosis   = ' + kurt.toFixed(4),
            ],
            summary: 'Descriptive statistics for ' + col + ': mean=' + mean.toFixed(2) + ', std=' + std.toFixed(2) + ', n=' + n
        };
    },

    _normality(vals, col) {
        // Simplified normality: D'Agostino skewness + kurtosis
        var n = vals.length;
        var sum = 0; for (var i = 0; i < n; i++) sum += vals[i];
        var mean = sum / n;
        var ss = 0; for (var i = 0; i < n; i++) ss += (vals[i] - mean) * (vals[i] - mean);
        var std = Math.sqrt(ss / (n - 1));
        var skew = 0, kurt = 0;
        for (var i = 0; i < n; i++) {
            var z = (vals[i] - mean) / std;
            skew += z * z * z; kurt += z * z * z * z;
        }
        skew /= n; kurt = kurt / n - 3;
        // Jarque-Bera
        var jb = n / 6 * (skew * skew + kurt * kurt / 4);
        // Approximate p-value (chi-sq 2df)
        var p = Math.exp(-jb / 2);
        var verdict = p >= 0.05 ? 'pass' : 'fail';

        return {
            title: 'Normality Test (Jarque-Bera): ' + col,
            statistic: jb, pValue: p, effect: null, n: n, verdict: verdict,
            lines: [
                'Jarque-Bera Statistic = ' + jb.toFixed(4),
                'p-value               = ' + p.toFixed(6),
                'Skewness              = ' + skew.toFixed(4),
                'Excess Kurtosis       = ' + kurt.toFixed(4),
                '',
                p >= 0.05 ? '\u2705 Cannot reject normality at \u03b1=0.05' : '\u274c Data is NOT normally distributed (p < 0.05)',
            ],
            summary: 'Normality test for ' + col + ': JB=' + jb.toFixed(2) + ', p=' + p.toFixed(4) + (p >= 0.05 ? ' (normal)' : ' (non-normal)')
        };
    },

    _oneSampleT(vals, mu, alpha, col) {
        var n = vals.length;
        var sum = 0; for (var i = 0; i < n; i++) sum += vals[i];
        var mean = sum / n;
        var ss = 0; for (var i = 0; i < n; i++) ss += (vals[i] - mean) * (vals[i] - mean);
        var std = Math.sqrt(ss / (n - 1));
        var se = std / Math.sqrt(n);
        var t = (mean - mu) / se;
        var df = n - 1;
        // Approximate p-value using normal for large n
        var p = 2 * (1 - this._normalCdf(Math.abs(t)));
        var d = (mean - mu) / std;
        var dSize = Math.abs(d) < 0.2 ? 'negligible' : Math.abs(d) < 0.5 ? 'small' : Math.abs(d) < 0.8 ? 'medium' : 'large';
        var verdict = p < alpha ? 'fail' : 'pass';

        return {
            title: 'One-Sample t-Test: ' + col + ' vs \u03bc\u2080=' + mu,
            statistic: t, pValue: p, effect: d, n: n, verdict: verdict,
            lines: [
                'H\u2080: \u03bc = ' + mu,
                'H\u2081: \u03bc \u2260 ' + mu,
                '',
                't-statistic  = ' + t.toFixed(4),
                'df           = ' + df,
                'p-value      = ' + p.toFixed(6),
                '',
                'Sample Mean  = ' + mean.toFixed(4),
                'Sample Std   = ' + std.toFixed(4),
                'Std Error    = ' + se.toFixed(4),
                "Cohen's d    = " + d.toFixed(4) + ' (' + dSize + ')',
                '',
                p < alpha ? '\u274c Reject H\u2080 — mean differs from ' + mu + ' (p < ' + alpha + ')' :
                    '\u2705 Fail to reject H\u2080 — no significant difference (p = ' + p.toFixed(4) + ')',
            ],
            summary: 'One-sample t-test: t=' + t.toFixed(2) + ', p=' + p.toFixed(4) + ', d=' + d.toFixed(2) + ' — ' + (p < alpha ? 'significant' : 'not significant')
        };
    },

    _twoSampleT(a, b, alpha, colA, colB) {
        if (b.length < 2) return { title: 'Error', lines: ['Col B needs \u2265 2 numeric values'], verdict: 'fail', statistic: null, pValue: null, effect: null, n: a.length + b.length };
        var nA = a.length, nB = b.length;
        var sumA = 0, sumB = 0;
        for (var i = 0; i < nA; i++) sumA += a[i];
        for (var i = 0; i < nB; i++) sumB += b[i];
        var meanA = sumA / nA, meanB = sumB / nB;
        var ssA = 0, ssB = 0;
        for (var i = 0; i < nA; i++) ssA += (a[i] - meanA) * (a[i] - meanA);
        for (var i = 0; i < nB; i++) ssB += (b[i] - meanB) * (b[i] - meanB);
        var varA = ssA / (nA - 1), varB = ssB / (nB - 1);
        // Welch's t-test
        var se = Math.sqrt(varA / nA + varB / nB);
        var t = (meanA - meanB) / se;
        var dfNum = (varA / nA + varB / nB) * (varA / nA + varB / nB);
        var dfDen = (varA / nA) * (varA / nA) / (nA - 1) + (varB / nB) * (varB / nB) / (nB - 1);
        var df = dfNum / dfDen;
        var p = 2 * (1 - this._normalCdf(Math.abs(t)));
        var pooledStd = Math.sqrt(((nA - 1) * varA + (nB - 1) * varB) / (nA + nB - 2));
        var d = pooledStd > 0 ? (meanA - meanB) / pooledStd : 0;
        var verdict = p < alpha ? 'fail' : 'pass';

        return {
            title: 'Two-Sample t-Test (Welch): ' + colA + ' vs ' + colB,
            statistic: t, pValue: p, effect: d, n: nA + nB, verdict: verdict,
            lines: [
                'H\u2080: \u03bcA = \u03bcB',
                'H\u2081: \u03bcA \u2260 \u03bcB',
                '',
                colA + ': mean=' + meanA.toFixed(4) + ', std=' + Math.sqrt(varA).toFixed(4) + ', n=' + nA,
                colB + ': mean=' + meanB.toFixed(4) + ', std=' + Math.sqrt(varB).toFixed(4) + ', n=' + nB,
                '',
                't-statistic  = ' + t.toFixed(4),
                'df (Welch)   = ' + df.toFixed(1),
                'p-value      = ' + p.toFixed(6),
                "Cohen's d    = " + d.toFixed(4),
                '',
                p < alpha ? '\u274c Reject H\u2080 — means differ significantly' : '\u2705 Fail to reject H\u2080 — no significant difference',
            ],
            summary: 'Two-sample t: t=' + t.toFixed(2) + ', p=' + p.toFixed(4) + ', d=' + d.toFixed(2)
        };
    },

    _pairedT(a, b, alpha, colA, colB) {
        if (b.length < 2) return { title: 'Error', lines: ['Col B needs \u2265 2 values'], verdict: 'fail', statistic: null, pValue: null, effect: null, n: 0 };
        var n = Math.min(a.length, b.length);
        var diffs = [];
        for (var i = 0; i < n; i++) diffs.push(a[i] - b[i]);
        var sum = 0; for (var i = 0; i < n; i++) sum += diffs[i];
        var mean = sum / n;
        var ss = 0; for (var i = 0; i < n; i++) ss += (diffs[i] - mean) * (diffs[i] - mean);
        var std = Math.sqrt(ss / (n - 1));
        var se = std / Math.sqrt(n);
        var t = mean / se;
        var p = 2 * (1 - this._normalCdf(Math.abs(t)));
        var d = std > 0 ? mean / std : 0;
        var verdict = p < alpha ? 'fail' : 'pass';

        return {
            title: 'Paired t-Test: ' + colA + ' - ' + colB,
            statistic: t, pValue: p, effect: d, n: n, verdict: verdict,
            lines: [
                'Mean difference = ' + mean.toFixed(4),
                'Std of diffs    = ' + std.toFixed(4),
                't-statistic     = ' + t.toFixed(4),
                'df              = ' + (n - 1),
                'p-value         = ' + p.toFixed(6),
                "Cohen's d       = " + d.toFixed(4),
                '', p < alpha ? '\u274c Significant difference' : '\u2705 No significant difference',
            ],
            summary: 'Paired t: t=' + t.toFixed(2) + ', p=' + p.toFixed(4) + ', d=' + d.toFixed(2)
        };
    },

    _correlation(a, b, method, alpha, colA, colB) {
        if (b.length < 3) return { title: 'Error', lines: ['Need \u2265 3 paired values'], verdict: 'fail', statistic: null, pValue: null, effect: null, n: 0 };
        var n = Math.min(a.length, b.length);
        // Pearson
        var sumA = 0, sumB = 0;
        for (var i = 0; i < n; i++) { sumA += a[i]; sumB += b[i]; }
        var mA = sumA / n, mB = sumB / n;
        var ssAB = 0, ssAA = 0, ssBB = 0;
        for (var i = 0; i < n; i++) {
            ssAB += (a[i] - mA) * (b[i] - mB);
            ssAA += (a[i] - mA) * (a[i] - mA);
            ssBB += (b[i] - mB) * (b[i] - mB);
        }
        var r = ssAB / Math.sqrt(ssAA * ssBB);
        var t = r * Math.sqrt((n - 2) / (1 - r * r));
        var p = 2 * (1 - this._normalCdf(Math.abs(t)));
        var r2 = r * r;
        var verdict = p < alpha ? (r > 0 ? 'pass' : 'warn') : 'pass';

        return {
            title: method.charAt(0).toUpperCase() + method.slice(1) + ' Correlation: ' + colA + ' vs ' + colB,
            statistic: t, pValue: p, effect: r, n: n, verdict: p < alpha ? 'pass' : 'warn',
            lines: [
                'r            = ' + r.toFixed(6),
                'R\u00b2           = ' + r2.toFixed(6),
                't-statistic  = ' + t.toFixed(4),
                'df           = ' + (n - 2),
                'p-value      = ' + p.toFixed(6),
                '',
                'Strength: ' + (Math.abs(r) < 0.1 ? 'negligible' : Math.abs(r) < 0.3 ? 'weak' : Math.abs(r) < 0.5 ? 'moderate' : Math.abs(r) < 0.7 ? 'strong' : 'very strong'),
                'Direction: ' + (r > 0 ? 'positive' : 'negative'),
                '', p < alpha ? '\u2705 Significant correlation (p < ' + alpha + ')' : '\u26a0 Not significant',
            ],
            summary: method + ' r=' + r.toFixed(3) + ', p=' + p.toFixed(4) + ' — ' + (Math.abs(r) < 0.3 ? 'weak' : Math.abs(r) < 0.7 ? 'moderate' : 'strong')
        };
    },

    _mannWhitney(a, b, alpha, colA, colB) {
        if (b.length < 2) return { title: 'Error', lines: ['Col B needs \u2265 2 values'], verdict: 'fail', statistic: null, pValue: null, effect: null, n: 0 };
        var nA = a.length, nB = b.length;
        // Count U statistic
        var U = 0;
        for (var i = 0; i < nA; i++) {
            for (var j = 0; j < nB; j++) {
                if (a[i] > b[j]) U++;
                else if (a[i] === b[j]) U += 0.5;
            }
        }
        var mU = nA * nB / 2;
        var sigU = Math.sqrt(nA * nB * (nA + nB + 1) / 12);
        var z = (U - mU) / sigU;
        var p = 2 * (1 - this._normalCdf(Math.abs(z)));
        var rbs = (2 * U) / (nA * nB) - 1; // rank-biserial
        var verdict = p < alpha ? 'fail' : 'pass';

        return {
            title: 'Mann-Whitney U: ' + colA + ' vs ' + colB,
            statistic: U, pValue: p, effect: rbs, n: nA + nB, verdict: verdict,
            lines: [
                'U-statistic   = ' + U.toFixed(1),
                'z             = ' + z.toFixed(4),
                'p-value       = ' + p.toFixed(6),
                'Rank-biserial = ' + rbs.toFixed(4),
                '',
                colA + ': n=' + nA + ', median=' + this._median(a).toFixed(4),
                colB + ': n=' + nB + ', median=' + this._median(b).toFixed(4),
                '', p < alpha ? '\u274c Distributions differ significantly' : '\u2705 No significant difference',
            ],
            summary: 'Mann-Whitney U=' + U.toFixed(0) + ', p=' + p.toFixed(4) + ', r=' + rbs.toFixed(2)
        };
    },

    _capability(vals, col) {
        var lslInput = document.getElementById(this.id + '-lsl');
        var uslInput = document.getElementById(this.id + '-usl');
        var lsl = lslInput && lslInput.value !== '' ? parseFloat(lslInput.value) : null;
        var usl = uslInput && uslInput.value !== '' ? parseFloat(uslInput.value) : null;

        if (lsl === null && usl === null) return { title: 'Error', lines: ['Set LSL and/or USL in the parameter strip'], verdict: 'fail', statistic: null, pValue: null, effect: null, n: vals.length };

        var n = vals.length;
        var sum = 0; for (var i = 0; i < n; i++) sum += vals[i];
        var mean = sum / n;
        var ss = 0; for (var i = 0; i < n; i++) ss += (vals[i] - mean) * (vals[i] - mean);
        var std = Math.sqrt(ss / (n - 1));

        var cp = null, cpk = null, cpu = null, cpl = null;
        if (lsl !== null && usl !== null) cp = (usl - lsl) / (6 * std);
        if (usl !== null) cpu = (usl - mean) / (3 * std);
        if (lsl !== null) cpl = (mean - lsl) / (3 * std);
        if (cpu !== null && cpl !== null) cpk = Math.min(cpu, cpl);
        else if (cpu !== null) cpk = cpu;
        else if (cpl !== null) cpk = cpl;

        var sigma = cpk !== null ? cpk * 3 : null;
        var dpmo = sigma !== null ? Math.round(1000000 * (1 - this._normalCdf(sigma * Math.sqrt(1)))) : null;
        var yield_pct = dpmo !== null ? ((1000000 - dpmo) / 10000).toFixed(2) : null;

        var verdict = cpk !== null ? (cpk >= 1.33 ? 'pass' : cpk >= 1.0 ? 'warn' : 'fail') : 'warn';

        var lines = [
            'Process Capability: ' + col,
            '',
            'n     = ' + n,
            'Mean  = ' + mean.toFixed(4),
            'Std   = ' + std.toFixed(4),
        ];
        if (lsl !== null) lines.push('LSL   = ' + lsl);
        if (usl !== null) lines.push('USL   = ' + usl);
        lines.push('');
        if (cp !== null) lines.push('Cp    = ' + cp.toFixed(4));
        if (cpl !== null) lines.push('Cpl   = ' + cpl.toFixed(4));
        if (cpu !== null) lines.push('Cpu   = ' + cpu.toFixed(4));
        if (cpk !== null) lines.push('Cpk   = ' + cpk.toFixed(4));
        if (sigma !== null) lines.push('Sigma = ' + sigma.toFixed(2));
        if (dpmo !== null) lines.push('DPMO  = ' + dpmo);
        if (yield_pct !== null) lines.push('Yield = ' + yield_pct + '%');
        lines.push('');
        if (cpk !== null) {
            lines.push(cpk >= 1.33 ? '\u2705 Capable (Cpk \u2265 1.33)' : cpk >= 1.0 ? '\u26a0 Marginal (1.0 \u2264 Cpk < 1.33)' : '\u274c Not capable (Cpk < 1.0)');
        }

        return {
            title: 'Process Capability', statistic: cpk, pValue: null, effect: cp, n: n, verdict: verdict, lines: lines,
            summary: 'Capability: Cpk=' + (cpk !== null ? cpk.toFixed(2) : '—') + ', Cp=' + (cp !== null ? cp.toFixed(2) : '—')
        };
    },

    _outliers(vals, col) {
        var n = vals.length;
        var sorted = vals.slice().sort(function(a, b) { return a - b; });
        var q1 = sorted[Math.floor(n * 0.25)], q3 = sorted[Math.floor(n * 0.75)];
        var iqr = q3 - q1;
        var lower = q1 - 1.5 * iqr, upper = q3 + 1.5 * iqr;
        var outliers = vals.filter(function(v) { return v < lower || v > upper; });

        return {
            title: 'Outlier Detection (IQR): ' + col,
            statistic: outliers.length, pValue: null, effect: null, n: n, verdict: outliers.length === 0 ? 'pass' : 'warn',
            lines: [
                'Q1     = ' + q1.toFixed(4), 'Q3     = ' + q3.toFixed(4), 'IQR    = ' + iqr.toFixed(4),
                'Lower  = ' + lower.toFixed(4), 'Upper  = ' + upper.toFixed(4), '',
                'Outliers found: ' + outliers.length + ' of ' + n + ' (' + (100 * outliers.length / n).toFixed(1) + '%)',
                outliers.length > 0 ? 'Values: ' + outliers.slice(0, 10).map(function(v) { return v.toFixed(2); }).join(', ') + (outliers.length > 10 ? '...' : '') : '',
            ],
            summary: outliers.length + ' outliers in ' + n + ' observations'
        };
    },

    _runsTest(vals, col, alpha) {
        var n = vals.length;
        var sum = 0; for (var i = 0; i < n; i++) sum += vals[i];
        var median = this._median(vals);
        var runs = 1, n1 = 0, n2 = 0;
        var above = vals[0] >= median;
        if (above) n1++; else n2++;
        for (var i = 1; i < n; i++) {
            var a = vals[i] >= median;
            if (a !== above) { runs++; above = a; }
            if (a) n1++; else n2++;
        }
        var eR = 1 + 2 * n1 * n2 / (n1 + n2);
        var vR = 2 * n1 * n2 * (2 * n1 * n2 - n1 - n2) / ((n1 + n2) * (n1 + n2) * (n1 + n2 - 1));
        var z = (runs - eR) / Math.sqrt(vR);
        var p = 2 * (1 - this._normalCdf(Math.abs(z)));

        return {
            title: 'Runs Test for Randomness: ' + col,
            statistic: z, pValue: p, effect: null, n: n, verdict: p >= alpha ? 'pass' : 'fail',
            lines: [
                'Runs observed = ' + runs, 'Runs expected = ' + eR.toFixed(1),
                'z             = ' + z.toFixed(4), 'p-value       = ' + p.toFixed(6), '',
                p >= alpha ? '\u2705 Data appears random' : '\u274c Non-random pattern detected',
            ],
            summary: 'Runs test: z=' + z.toFixed(2) + ', p=' + p.toFixed(4)
        };
    },

    _emitServerRequest(analysis, colA, colB, alpha, mu) {
        var info = this._getSelectedAnalysis();
        var pkgSel = document.getElementById(this.id + '-pkg');
        var pkg = pkgSel ? pkgSel.value : 'forgestat';

        return {
            title: (info ? info.label : analysis) + ' (server-side)',
            statistic: null, pValue: null, effect: null, n: null,
            verdict: 'info',
            lines: [
                'This analysis requires the ' + pkg + ' backend.',
                'Request queued:',
                '',
                '  package:  ' + pkg,
                '  analysis: ' + analysis,
                '  col_a:    ' + colA,
                '  col_b:    ' + (colB || '—'),
                '  alpha:    ' + alpha,
                '  mu:       ' + mu,
                '',
                'Wire result jack to HERALD for narrative output.',
            ],
            summary: 'Server request: ' + pkg + '.' + analysis,
            serverRequest: { package: pkg, analysis: analysis, colA: colA, colB: colB, alpha: alpha, mu: mu }
        };
    },

    // ── Display result ──

    _displayResult(result) {
        this._lastResult = result;

        // CRT output
        var resultsEl = document.getElementById(this.id + '-results');
        if (resultsEl) {
            resultsEl.innerHTML = '';
            var titleLine = document.createElement('div');
            titleLine.textContent = result.title;
            titleLine.style.color = '#f43f5e';
            titleLine.style.fontWeight = '700';
            titleLine.style.marginBottom = '4px';
            resultsEl.appendChild(titleLine);

            (result.lines || []).forEach(function(line) {
                var el = document.createElement('div');
                if (line.indexOf('\u2705') !== -1) el.style.color = 'rgba(34,197,94,0.7)';
                else if (line.indexOf('\u274c') !== -1) el.style.color = 'rgba(239,68,68,0.7)';
                else if (line.indexOf('\u26a0') !== -1) el.style.color = 'rgba(245,158,11,0.7)';
                else el.style.color = 'rgba(244,63,94,0.45)';
                el.textContent = line;
                resultsEl.appendChild(el);
            });
        }

        // LCD gauges
        var statEl = document.getElementById(this.id + '-stat-val');
        var pEl = document.getElementById(this.id + '-p-val');
        var effectEl = document.getElementById(this.id + '-effect-val');
        var nEl = document.getElementById(this.id + '-n-val');

        if (statEl) statEl.textContent = result.statistic !== null ? (typeof result.statistic === 'number' ? result.statistic.toFixed(3) : result.statistic) : '—';
        if (pEl) pEl.textContent = result.pValue !== null ? result.pValue.toFixed(4) : '—';
        if (effectEl) effectEl.textContent = result.effect !== null ? (typeof result.effect === 'number' ? result.effect.toFixed(3) : result.effect) : '—';
        if (nEl) nEl.textContent = result.n !== null ? result.n : '—';

        // Verdict LEDs
        FR.LED(document.getElementById(this.id + '-led-pass')).off();
        FR.LED(document.getElementById(this.id + '-led-warn')).off();
        FR.LED(document.getElementById(this.id + '-led-fail')).off();
        if (result.verdict === 'pass') FR.LED(document.getElementById(this.id + '-led-pass')).set('green');
        else if (result.verdict === 'warn' || result.verdict === 'info') FR.LED(document.getElementById(this.id + '-led-warn')).set('amber');
        else if (result.verdict === 'fail') FR.LED(document.getElementById(this.id + '-led-fail')).set('red');

        // Confidence bar (1 - pValue as percentage)
        var confBar = document.getElementById(this.id + '-conf-bar');
        if (confBar && result.pValue !== null) {
            var conf = Math.round((1 - result.pValue) * 100);
            confBar.style.width = conf + '%';
            confBar.style.background = conf >= 95 ? '#f43f5e' : conf >= 90 ? '#f59e0b' : '#6b7280';
        }

        // Emit result on output jack
        FR.emit(this.id, 'result', result);
        if (result.summary) FR.emit(this.id, 'summary', { text: result.summary, narrative: result.lines.join('\n') });

        this._log(result.title + ' — ' + (result.verdict === 'pass' ? 'PASS' : result.verdict === 'fail' ? 'FAIL' : 'INFO'));
    },

    // ── Utilities ──

    _normalCdf(x) {
        var a1 = 0.254829592, a2 = -0.284496736, a3 = 1.421413741, a4 = -1.453152027, a5 = 1.061405429, p = 0.3275911;
        var sign = x < 0 ? -1 : 1;
        x = Math.abs(x) / Math.sqrt(2);
        var t = 1 / (1 + p * x);
        var y = 1 - (((((a5 * t + a4) * t) + a3) * t + a2) * t + a1) * t * Math.exp(-x * x);
        return 0.5 * (1 + sign * y);
    },

    _median(vals) {
        var s = vals.slice().sort(function(a, b) { return a - b; });
        var n = s.length;
        return n % 2 === 0 ? (s[n / 2 - 1] + s[n / 2]) / 2 : s[Math.floor(n / 2)];
    },

    _log(msg, color) {
        // Log to CRT preamble
        var el = document.getElementById(this.id + '-results');
        if (!el) return;
        if (el.querySelector('span')) return; // Don't overwrite placeholder
        console.log('[ANALYST]', msg);
    },

    getOutput(channel) {
        if (channel === 'result' && this._lastResult) return this._lastResult;
        if (channel === 'summary' && this._lastResult && this._lastResult.summary) {
            return { text: this._lastResult.summary, narrative: (this._lastResult.lines || []).join('\n') };
        }
        return null;
    }
});


// ═══════════════════════════════════════════════════════════
// SENTINEL SpX-481 — SPC Process Monitor (GUARDIAN)
// ═══════════════════════════════════════════════════════════

FR.registerUnit('sentinel', {
    init(el, id) {
        this.el = el;
        this.id = id;
        this._data = null;
        this._lastResult = null;

        var self = this;
        var runBtn = document.getElementById(id + '-btn-run');
        if (runBtn) runBtn.addEventListener('click', function() { self._run(); });

        // Export buttons
        var viewport = document.getElementById(id + '-viewport');
        var copyBtn = document.getElementById(id + '-btn-copy');
        var svgBtn = document.getElementById(id + '-btn-svg');
        var pngBtn = document.getElementById(id + '-btn-png');

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
                var a = document.createElement('a'); a.href = url; a.download = 'sentinel-chart.svg'; a.click();
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
                        var a = document.createElement('a'); a.href = url; a.download = 'sentinel-chart.png'; a.click();
                        URL.revokeObjectURL(url);
                    });
                };
                img.src = 'data:image/svg+xml;base64,' + btoa(unescape(encodeURIComponent(data)));
            }
        });
    },

    receive(inputName, data) {
        if (!data || !data.data || !data.columns) return;
        this._data = data;

        FR.LED(document.getElementById(this.id + '-led-power')).set('amber');
        FR.emit(this.id, 'thru', data);

        // Populate column selectors
        var colSel = document.getElementById(this.id + '-col');
        var subSel = document.getElementById(this.id + '-subgroup');

        var numericCols = [], factorCols = [];
        data.columns.forEach(function(c) {
            var vals = data.data[c] || [];
            var hasNum = vals.some(function(v) { return typeof v === 'number'; });
            var hasStr = vals.some(function(v) { return typeof v === 'string'; });
            if (hasNum && !hasStr) numericCols.push(c);
            else if (hasStr) factorCols.push(c);
            else numericCols.push(c);
        });

        if (colSel) {
            var prev = colSel.value;
            colSel.innerHTML = '<option value="">—</option>';
            numericCols.forEach(function(c) {
                var opt = document.createElement('option');
                opt.value = c; opt.textContent = c;
                colSel.appendChild(opt);
            });
            if (prev && numericCols.indexOf(prev) !== -1) colSel.value = prev;
            else if (numericCols.length > 0) colSel.value = numericCols[0];
        }

        if (subSel) {
            var prevS = subSel.value;
            subSel.innerHTML = '<option value="">none</option>';
            factorCols.concat(numericCols).forEach(function(c) {
                var opt = document.createElement('option');
                opt.value = c; opt.textContent = c;
                subSel.appendChild(opt);
            });
            if (prevS && data.columns.indexOf(prevS) !== -1) subSel.value = prevS;
        }

        var n = data.data[data.columns[0]] ? data.data[data.columns[0]].length : 0;
        var nEl = document.getElementById(this.id + '-n-val');
        if (nEl) nEl.textContent = n;

        // Auto-run chart if a measurement column is selected
        var colSel = document.getElementById(this.id + '-col');
        if (colSel && colSel.value) {
            this._run();
        }
    },

    _run() {
        if (!this._data) return;

        var colSel = document.getElementById(this.id + '-col');
        var chartSel = document.getElementById(this.id + '-chart-type');
        var rulesSel = document.getElementById(this.id + '-rules');
        var lslInput = document.getElementById(this.id + '-lsl');
        var uslInput = document.getElementById(this.id + '-usl');

        var col = colSel ? colSel.value : '';
        var chartType = chartSel ? chartSel.value : 'imr';
        var rules = rulesSel ? rulesSel.value : 'nelson';
        var lsl = lslInput && lslInput.value !== '' ? parseFloat(lslInput.value) : null;
        var usl = uslInput && uslInput.value !== '' ? parseFloat(uslInput.value) : null;

        if (!col) return;

        var rawVals = this._data.data[col] || [];
        var vals = [];
        for (var i = 0; i < rawVals.length; i++) {
            var v = parseFloat(rawVals[i]);
            if (!isNaN(v)) vals.push(v);
        }
        if (vals.length < 3) return;

        var self = this;
        var csrf = document.querySelector('[name=csrfmiddlewaretoken]');
        var payload = { op: 'control_chart', data: { values: vals, chart_type: chartType, rules: rules } };
        if (lsl !== null) payload.data.lsl = lsl;
        if (usl !== null) payload.data.usl = usl;

        fetch('/api/rack/compute/', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', 'X-CSRFToken': csrf ? csrf.value : document.cookie.replace(/.*csrftoken=([^;]*).*/, '$1') },
            body: JSON.stringify(payload)
        })
        .then(function(resp) { return resp.json(); })
        .then(function(json) {
            if (json.error) { console.warn('sentinel compute error:', json.error); return; }
            var r = json.result;
            self._renderChart(vals, r, col, chartType, lsl, usl);
        })
        .catch(function(e) { console.warn('sentinel fetch error:', e); });
    },

    _renderChart(vals, r, col, chartType, lsl, usl) {
        var n = vals.length;
        var mean = r.mean, ucl = r.ucl, lcl = r.lcl;

        // Build OOC index set from server results
        var seen = {};
        var allViolations = (r.out_of_control || []).concat(r.violations || []);
        allViolations.forEach(function(v) { seen[v.index] = true; });
        var oocCount = Object.keys(seen).length;
        var inControl = oocCount === 0;

        // Status LEDs
        FR.LED(document.getElementById(this.id + '-led-ic')).set(inControl ? 'green' : 'off');
        FR.LED(document.getElementById(this.id + '-led-ooc')).set(inControl ? 'off' : 'red');

        // Capability readouts
        var cpkEl = document.getElementById(this.id + '-cpk');
        var ppmEl = document.getElementById(this.id + '-ppm');
        if (cpkEl) cpkEl.textContent = r.cpk != null ? r.cpk.toFixed(2) : '—';
        if (ppmEl) ppmEl.textContent = r.ppm != null ? r.ppm : '—';

        // Build SVG chart
        var viewport = document.getElementById(this.id + '-viewport');
        var empty = document.getElementById(this.id + '-empty');
        if (empty) empty.style.display = 'none';

        if (viewport) {
            var w = viewport.clientWidth || 600;
            var h = viewport.clientHeight || 200;
            var pad = { top: 15, right: 20, bottom: 25, left: 50 };
            var pw = w - pad.left - pad.right;
            var ph = h - pad.top - pad.bottom;

            var sigma = (ucl - mean) / 3;
            var yMin = Math.min(lcl, Math.min.apply(null, vals)) - sigma;
            var yMax = Math.max(ucl, Math.max.apply(null, vals)) + sigma;
            if (lsl !== null) yMin = Math.min(yMin, lsl - sigma);
            if (usl !== null) yMax = Math.max(yMax, usl + sigma);
            var yRange = yMax - yMin || 1;

            function sx(i) { return pad.left + (i / (n - 1 || 1)) * pw; }
            function sy(v) { return pad.top + (1 - (v - yMin) / yRange) * ph; }

            var svg = '<svg xmlns="http://www.w3.org/2000/svg" width="' + w + '" height="' + h + '" style="font-family:JetBrains Mono,monospace;">';

            // Grid
            for (var g = 0; g <= 5; g++) {
                var gy = pad.top + (g / 5) * ph;
                var gv = yMax - (g / 5) * yRange;
                svg += '<line x1="' + pad.left + '" y1="' + gy + '" x2="' + (w - pad.right) + '" y2="' + gy + '" stroke="rgba(217,119,6,0.04)" stroke-width="0.5"/>';
                svg += '<text x="' + (pad.left - 4) + '" y="' + (gy + 3) + '" fill="rgba(217,119,6,0.2)" font-size="8" text-anchor="end">' + gv.toFixed(1) + '</text>';
            }

            // UCL/CL/LCL
            svg += '<line x1="' + pad.left + '" y1="' + sy(ucl) + '" x2="' + (w - pad.right) + '" y2="' + sy(ucl) + '" stroke="#ef4444" stroke-width="1" stroke-dasharray="4,3" opacity="0.6"><title>UCL = ' + ucl.toFixed(3) + '</title></line>';
            svg += '<text x="' + (w - pad.right + 3) + '" y="' + (sy(ucl) + 3) + '" fill="#ef4444" font-size="7" opacity="0.6">UCL</text>';
            svg += '<line x1="' + pad.left + '" y1="' + sy(mean) + '" x2="' + (w - pad.right) + '" y2="' + sy(mean) + '" stroke="#4ade80" stroke-width="1" opacity="0.5"><title>CL = ' + mean.toFixed(3) + '</title></line>';
            svg += '<text x="' + (w - pad.right + 3) + '" y="' + (sy(mean) + 3) + '" fill="#4ade80" font-size="7" opacity="0.5">CL</text>';
            svg += '<line x1="' + pad.left + '" y1="' + sy(lcl) + '" x2="' + (w - pad.right) + '" y2="' + sy(lcl) + '" stroke="#ef4444" stroke-width="1" stroke-dasharray="4,3" opacity="0.6"><title>LCL = ' + lcl.toFixed(3) + '</title></line>';
            svg += '<text x="' + (w - pad.right + 3) + '" y="' + (sy(lcl) + 3) + '" fill="#ef4444" font-size="7" opacity="0.6">LCL</text>';

            // Spec limits
            if (lsl !== null) {
                svg += '<line x1="' + pad.left + '" y1="' + sy(lsl) + '" x2="' + (w - pad.right) + '" y2="' + sy(lsl) + '" stroke="#f59e0b" stroke-width="1" stroke-dasharray="2,2" opacity="0.4"/>';
                svg += '<text x="' + (w - pad.right + 3) + '" y="' + (sy(lsl) + 3) + '" fill="#f59e0b" font-size="7" opacity="0.4">LSL</text>';
            }
            if (usl !== null) {
                svg += '<line x1="' + pad.left + '" y1="' + sy(usl) + '" x2="' + (w - pad.right) + '" y2="' + sy(usl) + '" stroke="#f59e0b" stroke-width="1" stroke-dasharray="2,2" opacity="0.4"/>';
                svg += '<text x="' + (w - pad.right + 3) + '" y="' + (sy(usl) + 3) + '" fill="#f59e0b" font-size="7" opacity="0.4">USL</text>';
            }

            // Data line
            var pathD = '';
            for (var i = 0; i < n; i++) { pathD += (i === 0 ? 'M' : 'L') + sx(i).toFixed(1) + ',' + sy(vals[i]).toFixed(1); }
            svg += '<path d="' + pathD + '" fill="none" stroke="#d97706" stroke-width="1.5" opacity="0.8"/>';

            // Data points
            for (var i = 0; i < n; i++) {
                var isOOC = seen[i];
                var ptR = isOOC ? 4 : 2.5;
                var color = isOOC ? '#ef4444' : '#d97706';
                var tip = '#' + (i + 1) + ': ' + vals[i].toFixed(3) + (isOOC ? ' \u26A0 OOC' : '');
                svg += '<circle cx="' + sx(i).toFixed(1) + '" cy="' + sy(vals[i]).toFixed(1) + '" r="' + ptR + '" fill="' + color + '" opacity="0.9" style="cursor:pointer;"><title>' + tip + '</title></circle>';
                if (isOOC) svg += '<circle cx="' + sx(i).toFixed(1) + '" cy="' + sy(vals[i]).toFixed(1) + '" r="7" fill="none" stroke="#ef4444" stroke-width="1" opacity="0.3"/>';
            }

            svg += '<text x="' + (pad.left + 4) + '" y="' + (pad.top - 4) + '" fill="rgba(217,119,6,0.4)" font-size="9" font-weight="700">' +
                chartType.toUpperCase() + ' \u2014 ' + col + '  (n=' + n + ', OOC=' + oocCount + ')</text>';
            svg += '</svg>';
            viewport.innerHTML = svg;
        }

        // Emit
        this._lastResult = r;
        this._lastResult.column = col;
        this._lastResult.chartType = chartType;
        FR.emit(this.id, 'result', this._lastResult);
        if (allViolations.length > 0) FR.emit(this.id, 'violations', allViolations);
    },

    getOutput(channel) {
        if (channel === 'result' && this._lastResult) return this._lastResult;
        if (channel === 'thru' && this._data) return this._data;
        return null;
    }
});


// ═══════════════════════════════════════════════════════════
// BLANK PANELS — no behavior, pure rack filler
// ═══════════════════════════════════════════════════════════

FR.registerUnit('blank-1u', {
    init() {},
    receive() {}
});

FR.registerUnit('blank-2u', {
    init() {},
    receive() {}
});

// ═══════════════════════════════════════════════════════════
// SCRIBBLE STRIP SC-01 — editable label module
// ═══════════════════════════════════════════════════════════

FR.registerUnit('scribble', {
    init(el, id) {
        this.el = el;
        this.id = id;
    },
    receive() {}
});

// ═══════════════════════════════════════════════════════════
// JUNCTION MX-04 — Multi-Source Signal Mixer
// ═══════════════════════════════════════════════════════════

FR.registerUnit('mixer', {
    init(el, id) {
        this.el = el; this.id = id;
        this.mode = 'append';
        this.buffers = { a: null, b: null, c: null, d: null };
    },

    setMode(mode) {
        this.mode = mode;
        const el = this.el;
        el.querySelectorAll('.segment-btn').forEach(b => b.classList.remove('active'));
        const btn = el.querySelector(`#${this.id}-mode-${mode}`);
        if (btn) btn.classList.add('active');
        const joinCfg = el.querySelector(`#${this.id}-join-cfg`);
        if (joinCfg) joinCfg.style.display = mode === 'join' ? 'flex' : 'none';
        this._mix();
    },

    receive(inputName, data) {
        if (!['a','b','c','d'].includes(inputName)) return;
        this.buffers[inputName] = data;
        const led = document.getElementById(`${this.id}-led-${inputName}`);
        if (led) FR.LED(led).set('accent');
        this._mix();
    },

    _mix() {
        const filled = Object.entries(this.buffers).filter(([,v]) => v && v.data);
        if (!filled.length) return;

        let merged;
        if (this.mode === 'append') {
            // Row-append: stack all data vertically
            const allCols = new Set();
            filled.forEach(([,d]) => (d.columns || Object.keys(d.data)).forEach(c => allCols.add(c)));
            const cols = [...allCols];
            const data = {};
            cols.forEach(c => { data[c] = []; });
            filled.forEach(([,d]) => {
                const len = d.data[Object.keys(d.data)[0]]?.length || 0;
                cols.forEach(c => {
                    const src = d.data[c] || [];
                    for (let i = 0; i < len; i++) data[c].push(src[i] ?? null);
                });
            });
            merged = { data, columns: cols };
        } else {
            // Join mode — join on key column
            const key = (document.getElementById(`${this.id}-join-key`)?.value || '').trim();
            if (!key) { merged = this.buffers[filled[0][0]]; }
            else {
                // Simple left join on first buffer
                const base = filled[0][1];
                const data = {};
                (base.columns || Object.keys(base.data)).forEach(c => { data[c] = [...(base.data[c] || [])]; });
                for (let i = 1; i < filled.length; i++) {
                    const other = filled[i][1];
                    const otherCols = (other.columns || Object.keys(other.data)).filter(c => c !== key && !data[c]);
                    otherCols.forEach(c => { data[c] = new Array(data[key]?.length || 0).fill(null); });
                    const keyVals = other.data[key] || [];
                    const baseKeyVals = data[key] || [];
                    baseKeyVals.forEach((bk, idx) => {
                        const matchIdx = keyVals.indexOf(bk);
                        if (matchIdx >= 0) {
                            otherCols.forEach(c => { data[c][idx] = other.data[c]?.[matchIdx] ?? null; });
                        }
                    });
                }
                merged = { data, columns: Object.keys(data) };
            }
        }

        const rowCount = merged.data[Object.keys(merged.data)[0]]?.length || 0;
        const countEl = document.getElementById(`${this.id}-count`);
        if (countEl) countEl.textContent = rowCount;
        FR.LED(document.getElementById(`${this.id}-led`)).set('green');
        FR.emit(this.id, 'mixed', merged);
    }
});


// ═══════════════════════════════════════════════════════════
// RELAY RT-02 — Conditional Signal Router
// ═══════════════════════════════════════════════════════════

FR.registerUnit('router', {
    init(el, id) {
        this.el = el; this.id = id;
        this.op = '>';
        this.data = null;
    },

    setOp(op) {
        this.op = op;
        this.el.querySelectorAll('.segment-btn').forEach(b => b.classList.remove('active'));
        const opMap = { '>': 'gt', '<': 'lt', '==': 'eq', '!=': 'ne' };
        const btn = this.el.querySelector(`#${this.id}-op-${opMap[op]}`);
        if (btn) btn.classList.add('active');
        if (this.data) this._route(this.data);
    },

    receive(inputName, data) {
        if (inputName !== 'data') return;
        this.data = data;
        // Populate column selector
        const sel = document.getElementById(`${this.id}-col`);
        if (sel && sel.options.length <= 1 && data.columns) {
            data.columns.forEach(c => {
                const opt = document.createElement('option');
                opt.value = c; opt.textContent = c;
                sel.appendChild(opt);
            });
        }
        this._route(data);
    },

    _route(data) {
        const col = document.getElementById(`${this.id}-col`)?.value;
        const threshStr = document.getElementById(`${this.id}-threshold`)?.value;
        if (!col || !threshStr || !data?.data?.[col]) return;

        const thresh = parseFloat(threshStr);
        if (isNaN(thresh)) return;

        const vals = data.data[col];
        const passIdx = [], failIdx = [];
        const op = this.op;

        vals.forEach((v, i) => {
            const n = parseFloat(v);
            if (isNaN(n)) { failIdx.push(i); return; }
            let pass = false;
            if (op === '>') pass = n > thresh;
            else if (op === '<') pass = n < thresh;
            else if (op === '==') pass = n === thresh;
            else if (op === '!=') pass = n !== thresh;
            (pass ? passIdx : failIdx).push(i);
        });

        const cols = data.columns || Object.keys(data.data);
        const passData = {}, failData = {};
        cols.forEach(c => {
            passData[c] = passIdx.map(i => data.data[c]?.[i]);
            failData[c] = failIdx.map(i => data.data[c]?.[i]);
        });

        document.getElementById(`${this.id}-count-a`).textContent = passIdx.length;
        document.getElementById(`${this.id}-count-b`).textContent = failIdx.length;

        if (passIdx.length) FR.LED(document.getElementById(`${this.id}-led-a`)).set('green');
        else FR.LED(document.getElementById(`${this.id}-led-a`)).off();
        if (failIdx.length) FR.LED(document.getElementById(`${this.id}-led-b`)).set('amber');
        else FR.LED(document.getElementById(`${this.id}-led-b`)).off();

        FR.LED(document.getElementById(`${this.id}-led`)).set('accent');
        FR.emit(this.id, 'pass', { data: passData, columns: cols });
        FR.emit(this.id, 'fail', { data: failData, columns: cols });
    }
});


// ═══════════════════════════════════════════════════════════
// TRIPWIRE TW-01 — Threshold Alarm Gate
// ═══════════════════════════════════════════════════════════

FR.registerUnit('threshold', {
    init(el, id) {
        this.el = el; this.id = id;
        this.armed = false;
        this.direction = 'above';
        this.tripCount = 0;
    },

    setDir(dir) {
        this.direction = dir;
        this.el.querySelectorAll('.segment-btn').forEach(b => b.classList.remove('active'));
        const btn = this.el.querySelector(`#${this.id}-dir-${dir}`);
        if (btn) btn.classList.add('active');
    },

    toggleArm() {
        this.armed = !this.armed;
        const btn = document.getElementById(`${this.id}-arm`);
        if (btn) { btn.classList.toggle('on', this.armed); btn.textContent = this.armed ? 'Armed' : 'Disarmed'; }
        FR.LED(document.getElementById(`${this.id}-led-arm`)).set(this.armed ? 'amber' : undefined);
        if (!this.armed) FR.LED(document.getElementById(`${this.id}-led-arm`)).off();
    },

    receive(inputName, data) {
        if (inputName !== 'data') return;
        // Pass data through regardless
        FR.emit(this.id, 'thru', data);

        if (!this.armed) return;

        const col = document.getElementById(`${this.id}-col`)?.value;
        const limitStr = document.getElementById(`${this.id}-limit`)?.value;
        if (!col || !limitStr || !data?.data?.[col]) return;

        const limit = parseFloat(limitStr);
        if (isNaN(limit)) return;

        const vals = data.data[col];
        let tripped = false;

        vals.forEach(v => {
            const n = parseFloat(v);
            if (isNaN(n)) return;
            if (this.direction === 'above' && n > limit) tripped = true;
            if (this.direction === 'below' && n < limit) tripped = true;
        });

        if (tripped) {
            this.tripCount++;
            document.getElementById(`${this.id}-trips`).textContent = this.tripCount;
            FR.LED(document.getElementById(`${this.id}-led-alarm`)).set('red');
            FR.emit(this.id, 'alarm', {
                type: 'threshold_violation',
                column: col,
                limit: limit,
                direction: this.direction,
                timestamp: new Date().toISOString(),
                unit_id: this.id,
            });
        } else {
            FR.LED(document.getElementById(`${this.id}-led-alarm`)).off();
        }
    }
});


// ═══════════════════════════════════════════════════════════
// PULSE CK-01 — System Clock & Refresh Timer
// ═══════════════════════════════════════════════════════════

FR.registerUnit('clock', {
    init(el, id) {
        this.el = el; this.id = id;
        this.interval = 30;
        this.running = true;
        this.tickCount = 0;
        this._timer = null;
        this._countdownTimer = null;
        this._start();
    },

    setInterval(secs) {
        this.interval = secs;
        this.el.querySelectorAll('.segment-btn').forEach(b => b.classList.remove('active'));
        const btn = this.el.querySelector(`#${this.id}-int-${secs}`);
        if (btn) btn.classList.add('active');
        if (this.running) { this._stop(); this._start(); }
    },

    toggleRun() {
        this.running = !this.running;
        const btn = document.getElementById(`${this.id}-run`);
        if (btn) { btn.classList.toggle('on', this.running); btn.textContent = this.running ? 'Running' : 'Stopped'; }
        FR.LED(document.getElementById(`${this.id}-led-run`)).set(this.running ? 'green' : undefined);
        if (!this.running) { FR.LED(document.getElementById(`${this.id}-led-run`)).off(); this._stop(); }
        else this._start();
    },

    manualTick() {
        this._tick();
    },

    _start() {
        if (this._timer) clearInterval(this._timer);
        this._timer = setInterval(() => this._tick(), this.interval * 1000);
        FR.LED(document.getElementById(`${this.id}-led-run`)).set('green');
        // Countdown animation
        this._resetCountdown();
    },

    _stop() {
        if (this._timer) { clearInterval(this._timer); this._timer = null; }
        if (this._countdownTimer) { clearInterval(this._countdownTimer); this._countdownTimer = null; }
    },

    _tick() {
        this.tickCount++;
        document.getElementById(`${this.id}-ticks`).textContent = this.tickCount;
        // Flash tick LED
        const tickLed = document.getElementById(`${this.id}-led-tick`);
        if (tickLed) {
            FR.LED(tickLed).set('accent');
            setTimeout(() => FR.LED(tickLed).off(), 200);
        }
        FR.emit(this.id, 'tick', { tick: this.tickCount, timestamp: new Date().toISOString() });
        this._resetCountdown();
    },

    _resetCountdown() {
        if (this._countdownTimer) clearInterval(this._countdownTimer);
        const bar = document.getElementById(`${this.id}-countdown`);
        if (!bar) return;
        let remaining = this.interval;
        bar.style.transition = 'none';
        bar.style.width = '100%';
        this._countdownTimer = setInterval(() => {
            remaining--;
            const pct = Math.max(0, (remaining / this.interval) * 100);
            bar.style.transition = 'width 1s linear';
            bar.style.width = pct + '%';
            if (remaining <= 0) clearInterval(this._countdownTimer);
        }, 1000);
    }
});

// ═══════════════════════════════════════════════════════════
// FORMULA FX-01 — Programmable Expression Evaluator
// Safe expression parser — NO eval(), NO Function().
// Tokenizes → parses → evaluates with whitelisted ops only.
// ═══════════════════════════════════════════════════════════

// Safe math expression evaluator (module-scoped, not global)
var _formulaSafe = (function() {
    var FUNCS = {
        abs: Math.abs, log: Math.log, sqrt: Math.sqrt,
        round: Math.round, floor: Math.floor, ceil: Math.ceil,
        min: Math.min, max: Math.max, pow: Math.pow,
        sin: Math.sin, cos: Math.cos, tan: Math.tan,
        exp: Math.exp, log10: Math.log10, sign: Math.sign
    };
    var CONSTS = { pi: Math.PI, e: Math.E };

    function tokenize(expr) {
        var tokens = [];
        var i = 0;
        while (i < expr.length) {
            var ch = expr[i];
            if (ch === ' ' || ch === '\t') { i++; continue; }
            if ('+-*/%()^,'.indexOf(ch) !== -1) { tokens.push({type:'op',value:ch}); i++; continue; }
            if (ch >= '0' && ch <= '9' || ch === '.') {
                var num = '';
                while (i < expr.length && ((expr[i] >= '0' && expr[i] <= '9') || expr[i] === '.')) { num += expr[i]; i++; }
                tokens.push({type:'num',value:parseFloat(num)});
                continue;
            }
            if ((ch >= 'a' && ch <= 'z') || (ch >= 'A' && ch <= 'Z') || ch === '_') {
                var name = '';
                while (i < expr.length && ((expr[i] >= 'a' && expr[i] <= 'z') || (expr[i] >= 'A' && expr[i] <= 'Z') || (expr[i] >= '0' && expr[i] <= '9') || expr[i] === '_')) { name += expr[i]; i++; }
                tokens.push({type:'name',value:name});
                continue;
            }
            throw new Error('Unexpected character: ' + ch);
        }
        return tokens;
    }

    function parse(tokens) {
        var pos = 0;
        function peek() { return pos < tokens.length ? tokens[pos] : null; }
        function eat(type, value) {
            var t = peek();
            if (!t || (type && t.type !== type) || (value && t.value !== value)) throw new Error('Expected ' + (value||type) + ' at position ' + pos);
            pos++; return t;
        }

        function parseExpr() { return parseAdd(); }
        function parseAdd() {
            var left = parseMul();
            while (peek() && peek().type === 'op' && (peek().value === '+' || peek().value === '-')) {
                var op = eat('op').value;
                var right = parseMul();
                left = {type:'bin',op:op,left:left,right:right};
            }
            return left;
        }
        function parseMul() {
            var left = parsePow();
            while (peek() && peek().type === 'op' && (peek().value === '*' || peek().value === '/' || peek().value === '%')) {
                var op = eat('op').value;
                var right = parsePow();
                left = {type:'bin',op:op,left:left,right:right};
            }
            return left;
        }
        function parsePow() {
            var left = parseUnary();
            if (peek() && peek().type === 'op' && peek().value === '^') {
                eat('op');
                var right = parseUnary();
                left = {type:'bin',op:'^',left:left,right:right};
            }
            return left;
        }
        function parseUnary() {
            if (peek() && peek().type === 'op' && peek().value === '-') {
                eat('op');
                return {type:'neg',child:parseAtom()};
            }
            return parseAtom();
        }
        function parseAtom() {
            var t = peek();
            if (!t) throw new Error('Unexpected end of expression');
            if (t.type === 'num') { eat('num'); return {type:'num',value:t.value}; }
            if (t.type === 'op' && t.value === '(') {
                eat('op','(');
                var inner = parseExpr();
                eat('op',')');
                return inner;
            }
            if (t.type === 'name') {
                var name = eat('name').value;
                // Function call?
                if (peek() && peek().type === 'op' && peek().value === '(') {
                    eat('op','(');
                    var args = [];
                    if (!(peek() && peek().type === 'op' && peek().value === ')')) {
                        args.push(parseExpr());
                        while (peek() && peek().type === 'op' && peek().value === ',') {
                            eat('op',',');
                            args.push(parseExpr());
                        }
                    }
                    eat('op',')');
                    return {type:'call',name:name,args:args};
                }
                // Constant or column reference
                return {type:'ref',name:name};
            }
            throw new Error('Unexpected token: ' + t.value);
        }

        var ast = parseExpr();
        if (pos < tokens.length) throw new Error('Unexpected token after expression: ' + tokens[pos].value);
        return ast;
    }

    function evaluate(ast, vars) {
        switch(ast.type) {
            case 'num': return ast.value;
            case 'neg': return -evaluate(ast.child, vars);
            case 'ref':
                if (CONSTS[ast.name] !== undefined) return CONSTS[ast.name];
                if (vars[ast.name] !== undefined) return vars[ast.name];
                throw new Error('Unknown variable: ' + ast.name);
            case 'call':
                if (!FUNCS[ast.name]) throw new Error('Unknown function: ' + ast.name + ' (allowed: ' + Object.keys(FUNCS).join(', ') + ')');
                var argVals = ast.args.map(function(a) { return evaluate(a, vars); });
                return FUNCS[ast.name].apply(null, argVals);
            case 'bin':
                var l = evaluate(ast.left, vars);
                var r = evaluate(ast.right, vars);
                switch(ast.op) {
                    case '+': return l + r;
                    case '-': return l - r;
                    case '*': return l * r;
                    case '/': return r === 0 ? NaN : l / r;
                    case '%': return l % r;
                    case '^': return Math.pow(l, r);
                }
        }
        throw new Error('Invalid AST node');
    }

    return {
        compile: function(expr) {
            var tokens = tokenize(expr);
            var ast = parse(tokens);
            return function(vars) { return evaluate(ast, vars); };
        },
        FUNCS: FUNCS,
        CONSTS: CONSTS
    };
})();


FR.registerUnit('formula', {
    init(el, id) {
        this.el = el;
        this.id = id;
        this._data = null;
        this._compiled = null;
        this._exprText = '';

        var self = this;
        var exprInput = document.getElementById(id + '-expr');
        var outNameInput = document.getElementById(id + '-out-name');
        var evalBtn = document.getElementById(id + '-btn-eval');

        if (evalBtn) evalBtn.addEventListener('click', function() { self._evaluate(); });
        // Also eval on Enter
        if (exprInput) exprInput.addEventListener('keydown', function(e) {
            if (e.key === 'Enter') { e.preventDefault(); self._evaluate(); }
        });
    },

    _log(msg, color) {
        var logEl = document.getElementById(this.id + '-log');
        if (!logEl) return;
        var line = document.createElement('div');
        line.style.color = color || 'rgba(212,136,74,0.5)';
        line.textContent = msg;
        logEl.appendChild(line);
        logEl.scrollTop = logEl.scrollHeight;
    },

    _updateNixie(n) {
        var s = String(n).padStart(4, ' ');
        for (var i = 0; i < 4; i++) {
            var el = document.getElementById(this.id + '-nix-' + i);
            if (el) el.textContent = s[i] === ' ' ? '' : s[i];
        }
    },

    _updateColRef() {
        var refEl = document.getElementById(this.id + '-col-ref');
        if (!refEl || !this._data) return;
        refEl.innerHTML = '';
        var self = this;
        this._data.columns.forEach(function(col) {
            var chip = document.createElement('span');
            chip.style.cssText = 'font:700 8px/1 "JetBrains Mono",monospace;color:#d4884a;background:rgba(212,136,74,0.08);border:1px solid rgba(212,136,74,0.12);padding:1px 4px;border-radius:1px;cursor:pointer;';
            chip.textContent = col;
            chip.title = 'Click to insert column name';
            chip.addEventListener('click', function() {
                var input = document.getElementById(self.id + '-expr');
                if (input) {
                    var pos = input.selectionStart || input.value.length;
                    input.value = input.value.slice(0, pos) + col + input.value.slice(pos);
                    input.focus();
                }
            });
            refEl.appendChild(chip);
        });
    },

    _evaluate() {
        if (!this._data) { this._log('ERROR: no data connected', 'rgba(239,68,68,0.6)'); return; }

        var exprInput = document.getElementById(this.id + '-expr');
        var outNameInput = document.getElementById(this.id + '-out-name');
        var expr = exprInput ? exprInput.value.trim() : '';
        var outName = outNameInput ? outNameInput.value.trim() || 'result' : 'result';

        if (!expr) { this._log('ERROR: empty expression', 'rgba(239,68,68,0.6)'); return; }

        // Compile
        var compiled;
        try {
            compiled = _formulaSafe.compile(expr);
        } catch(e) {
            this._log('PARSE ERROR: ' + e.message, 'rgba(239,68,68,0.6)');
            FR.LED(document.getElementById(this.id + '-led')).set('red');
            return;
        }

        // Evaluate row by row
        var data = this._data;
        var n = data.data[data.columns[0]] ? data.data[data.columns[0]].length : 0;
        var results = [];
        var errors = 0;

        for (var i = 0; i < n; i++) {
            var vars = {};
            data.columns.forEach(function(col) {
                vars[col] = data.data[col] ? parseFloat(data.data[col][i]) : NaN;
            });
            try {
                var val = compiled(vars);
                results.push(typeof val === 'number' ? val : NaN);
            } catch(e) {
                results.push(NaN);
                errors++;
            }
        }

        // Build output
        var outData = { data: {}, columns: data.columns.slice() };
        data.columns.forEach(function(col) { outData.data[col] = data.data[col]; });
        outData.data[outName] = results;
        if (outData.columns.indexOf(outName) === -1) outData.columns.push(outName);

        // Log
        var validCount = results.filter(function(v) { return !isNaN(v); }).length;
        this._log(outName + ' = ' + expr, 'rgba(212,136,74,0.7)');
        this._log('  ' + validCount + '/' + n + ' rows computed' + (errors > 0 ? ', ' + errors + ' errors' : ''), errors > 0 ? 'rgba(245,158,11,0.6)' : 'rgba(34,197,94,0.5)');

        // Preview
        var prevEl = document.getElementById(this.id + '-preview');
        if (prevEl) {
            var preview = results.slice(0, 12).map(function(v, i) {
                return '<div style="color:rgba(212,136,74,' + (isNaN(v) ? '0.15' : '0.4') + ')">' + (isNaN(v) ? 'NaN' : v.toFixed(4)) + '</div>';
            }).join('');
            if (n > 12) preview += '<div style="color:rgba(212,136,74,0.15);">...' + (n - 12) + ' more</div>';
            prevEl.innerHTML = preview;
        }

        this._updateNixie(n);
        FR.LED(document.getElementById(this.id + '-led')).set(errors > 0 ? 'amber' : 'green');

        // Emit
        FR.emit(this.id, 'result', outData);
        FR.emit(this.id, 'column', { data: outData.data, columns: [outName] });
        FR.emit(this.id, 'thru', data);
    },

    receive(inputName, data, fromUnit) {
        if (!data) return;
        this._source = fromUnit || '?';
        if (data.columns && data.data) {
            this._data = { columns: data.columns.slice(), data: {} };
            data.columns.forEach(function(c) { this._data.data[c] = data.data[c] ? data.data[c].slice() : []; }.bind(this));
        } else if (Array.isArray(data)) {
            this._data = { columns: ['x'], data: { x: data.slice() } };
        }

        var n = this._data.data[this._data.columns[0]] ? this._data.data[this._data.columns[0]].length : 0;
        this._updateNixie(n);
        this._updateColRef();
        this._log('Received ' + this._data.columns.length + ' columns, ' + n + ' rows', 'rgba(212,136,74,0.5)');
        FR.LED(document.getElementById(this.id + '-led')).set('green');
        FR.emit(this.id, 'thru', data);
    },

    getOutput(channel) { return null; }
});

// ═══════════════════════════════════════════════════════════
// PROBE PR-01 — Spot-Check Multimeter
// Rotary selector, single stat, one number.
// ═══════════════════════════════════════════════════════════

FR.registerUnit('probe', {
    _MODES: [
        { name: 'mean',   label: 'MEAN',   angle: 0    },
        { name: 'median', label: 'MED',    angle: 45   },
        { name: 'stdev',  label: 'STD',    angle: 90   },
        { name: 'min',    label: 'MIN',    angle: 135  },
        { name: 'max',    label: 'MAX',    angle: 180  },
        { name: 'range',  label: 'RNG',    angle: 225  },
        { name: 'n',      label: 'n',      angle: 270  },
        { name: 'sum',    label: 'SUM',    angle: 315  }
    ],

    init(el, id) {
        this.el = el;
        this.id = id;
        this._data = null;
        this._statIdx = 0;
        this._lastResult = null;

        var self = this;
        var selector = document.getElementById(id + '-selector');
        var colSelect = document.getElementById(id + '-col');

        if (selector) {
            selector.addEventListener('click', function() {
                self._statIdx = (self._statIdx + 1) % self._MODES.length;
                self._updateSelector();
                self._showFromCache();
            });
        }

        if (colSelect) {
            colSelect.addEventListener('change', function() { self._compute(); });
        }

        this._updateSelector();
    },

    _updateSelector() {
        var mode = this._MODES[this._statIdx];
        var selector = document.getElementById(this.id + '-selector');
        if (selector) selector.style.transform = 'rotate(' + mode.angle + 'deg)';
        var label = document.getElementById(this.id + '-stat-label');
        if (label) label.textContent = mode.label;
    },

    _showFromCache() {
        if (!this._lastResult) { this._setDisplay('—'); return; }
        var r = this._lastResult;
        var mode = this._MODES[this._statIdx];
        var val = r[mode.name];
        if (val === undefined || val === null) { this._setDisplay('—'); return; }
        this._setDisplay(mode.name === 'n' ? String(Math.round(val)) :
            Math.abs(val) >= 1000 ? val.toFixed(1) :
            Math.abs(val) >= 1 ? val.toFixed(3) : val.toFixed(4));
    },

    _compute() {
        if (!this._data) return;
        var colSelect = document.getElementById(this.id + '-col');
        var col = colSelect ? colSelect.value : '';
        if (!col || !this._data.data[col]) { this._setDisplay('—'); return; }

        var raw = this._data.data[col];
        var vals = [];
        for (var i = 0; i < raw.length; i++) {
            var v = parseFloat(raw[i]);
            if (!isNaN(v)) vals.push(v);
        }
        if (vals.length === 0) {
            this._setDisplay('NaN');
            FR.LED(document.getElementById(this.id + '-led')).set('red');
            return;
        }

        var self = this;
        var csrf = document.querySelector('[name=csrfmiddlewaretoken]');
        fetch('/api/rack/compute/', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', 'X-CSRFToken': csrf ? csrf.value : document.cookie.replace(/.*csrftoken=([^;]*).*/, '$1') },
            body: JSON.stringify({ op: 'descriptive', data: { values: vals } })
        })
        .then(function(resp) { return resp.json(); })
        .then(function(json) {
            if (json.error) { self._setDisplay('ERR'); FR.LED(document.getElementById(self.id + '-led')).set('red'); return; }
            self._lastResult = json.result;
            self._showFromCache();
            FR.LED(document.getElementById(self.id + '-led')).set('green');
        })
        .catch(function() { self._setDisplay('ERR'); FR.LED(document.getElementById(self.id + '-led')).set('red'); });
    },

    _setDisplay(text) {
        var el = document.getElementById(this.id + '-value');
        if (el) el.textContent = text;
    },

    receive(inputName, data, fromUnit) {
        if (!data) return;
        if (data.columns && data.data) {
            this._data = data;
        } else if (Array.isArray(data)) {
            this._data = { columns: ['x'], data: { x: data } };
        } else return;

        // Populate column selector
        var colSelect = document.getElementById(this.id + '-col');
        if (colSelect) {
            var prev = colSelect.value;
            colSelect.innerHTML = '<option value="">column</option>';
            this._data.columns.forEach(function(c) {
                var opt = document.createElement('option');
                opt.value = c; opt.textContent = c;
                colSelect.appendChild(opt);
            });
            // Auto-select first numeric column
            if (!prev || this._data.columns.indexOf(prev) === -1) {
                for (var i = 0; i < this._data.columns.length; i++) {
                    var c = this._data.columns[i];
                    var v = this._data.data[c];
                    if (v && v.length > 0 && !isNaN(parseFloat(v[0]))) {
                        colSelect.value = c;
                        break;
                    }
                }
            } else {
                colSelect.value = prev;
            }
        }

        this._compute();
        FR.LED(document.getElementById(this.id + '-led')).set('green');
        FR.emit(this.id, 'thru', data);
    },

    getOutput(channel) { return null; }
});

// ═══════════════════════════════════════════════════════════
// COMPARATOR CMP-01 — Dual-Input Comparison Meter
// Two inputs, four modes: Δ (difference), A/B (ratio), t, p
// Welch's t-test (unequal variance, unequal n)
// ═══════════════════════════════════════════════════════════

FR.registerUnit('comparator', {
    init(el, id) {
        this.el = el;
        this.id = id;
        this._dataA = null;
        this._dataB = null;
        this._mode = 'diff';

        var self = this;
        // Mode segment
        var modeContainer = document.getElementById(id + '-mode-seg');
        if (modeContainer) {
            modeContainer.querySelectorAll('.segment-btn').forEach(function(btn) {
                btn.addEventListener('click', function() {
                    modeContainer.querySelectorAll('.segment-btn').forEach(function(b) { b.classList.remove('active'); });
                    btn.classList.add('active');
                    self._mode = btn.dataset.mode;
                    self._compute();
                });
            });
        }

        // Column selectors
        var colA = document.getElementById(id + '-col-a');
        var colB = document.getElementById(id + '-col-b');
        if (colA) colA.addEventListener('change', function() { self._compute(); });
        if (colB) colB.addEventListener('change', function() { self._compute(); });
    },

    _getNumeric(data, col) {
        if (!data || !col || !data.data[col]) return [];
        var vals = [];
        var raw = data.data[col];
        for (var i = 0; i < raw.length; i++) {
            var v = parseFloat(raw[i]);
            if (!isNaN(v)) vals.push(v);
        }
        return vals;
    },

    // Client-side helpers for display only (means, counts)
    _mean(v) { return v.reduce(function(a,b){return a+b},0)/v.length; },

    _compute() {
        var colASelect = document.getElementById(this.id + '-col-a');
        var colBSelect = document.getElementById(this.id + '-col-b');
        var colA = colASelect ? colASelect.value : '';
        var colB = colBSelect ? colBSelect.value : '';

        var valsA = this._getNumeric(this._dataA, colA);
        var valsB = this._getNumeric(this._dataB, colB);

        // Update secondary readouts (client-side, just means and counts)
        var meanAEl = document.getElementById(this.id + '-mean-a');
        var meanBEl = document.getElementById(this.id + '-mean-b');
        var nAEl = document.getElementById(this.id + '-n-a');
        var nBEl = document.getElementById(this.id + '-n-b');
        if (meanAEl) meanAEl.textContent = valsA.length > 0 ? this._mean(valsA).toFixed(3) : '—';
        if (meanBEl) meanBEl.textContent = valsB.length > 0 ? this._mean(valsB).toFixed(3) : '—';
        if (nAEl) nAEl.textContent = valsA.length || '—';
        if (nBEl) nBEl.textContent = valsB.length || '—';

        if (valsA.length < 2 || valsB.length < 2) {
            this._setMain('—');
            this._setLabel(this._modeLabel());
            this._setVerdict(null);
            return;
        }

        // Diff and ratio are trivial — compute client-side
        var mA = this._mean(valsA), mB = this._mean(valsB);
        if (this._mode === 'diff') {
            this._setMain((mA - mB).toFixed(4));
            this._setLabel(this._modeLabel());
            this._setVerdict(null);
            FR.LED(document.getElementById(this.id + '-led')).set('green');
            FR.emit(this.id, 'result', { mode: 'diff', value: mA - mB, mean_a: mA, mean_b: mB });
            return;
        }
        if (this._mode === 'ratio') {
            var r = mB !== 0 ? mA / mB : NaN;
            this._setMain(isNaN(r) ? 'DIV/0' : r.toFixed(4));
            this._setLabel(this._modeLabel());
            this._setVerdict(null);
            FR.LED(document.getElementById(this.id + '-led')).set('green');
            FR.emit(this.id, 'result', { mode: 'ratio', value: r, mean_a: mA, mean_b: mB });
            return;
        }

        // t-stat and p-value — call server (forgestat)
        var self = this;
        var csrf = document.querySelector('[name=csrfmiddlewaretoken]');
        fetch('/api/rack/compute/', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'X-CSRFToken': csrf ? csrf.value : document.cookie.replace(/.*csrftoken=([^;]*).*/, '$1')
            },
            body: JSON.stringify({ op: 'ttest_2sample', data: { a: valsA, b: valsB } })
        })
        .then(function(resp) { return resp.json(); })
        .then(function(json) {
            if (json.error) {
                self._setMain('ERR');
                self._setVerdict(null);
                FR.LED(document.getElementById(self.id + '-led')).set('red');
                return;
            }
            var r = json.result;
            if (self._mode === 'tstat') {
                self._setMain(r.t.toFixed(3));
                self._setVerdict(r.significant);
            } else {
                self._setMain(r.p < 0.001 ? r.p.toExponential(2) : r.p.toFixed(4));
                self._setVerdict(r.significant);
            }
            self._setLabel(self._modeLabel());
            FR.LED(document.getElementById(self.id + '-led')).set('green');
            FR.emit(self.id, 'result', r);
        })
        .catch(function(err) {
            self._setMain('ERR');
            self._setVerdict(null);
            FR.LED(document.getElementById(self.id + '-led')).set('red');
        });

        FR.emit(this.id, 'result', {
            mode: this._mode,
            mean_a: mA, mean_b: mB,
            n_a: valsA.length, n_b: valsB.length
        });
    },

    _modeLabel() {
        var labels = { diff: 'DIFFERENCE', ratio: 'RATIO A/B', tstat: 'T-STATISTIC', pval: 'P-VALUE' };
        return labels[this._mode] || '';
    },

    _setMain(text) {
        var el = document.getElementById(this.id + '-main-value');
        if (el) el.textContent = text;
    },
    _setLabel(text) {
        var el = document.getElementById(this.id + '-mode-label');
        if (el) el.textContent = text;
    },
    _setVerdict(sig) {
        // sig: true = significant (red LED), false = not significant (green LED), null/string = off
        var led = document.getElementById(this.id + '-led-sig');
        if (!led) return;
        if (sig === true) FR.LED(led).set('red');
        else if (sig === false) FR.LED(led).set('green');
        else FR.LED(led).off();
    },

    _populateSelect(selectId, data) {
        var sel = document.getElementById(selectId);
        if (!sel || !data) return;
        var prev = sel.value;
        sel.innerHTML = '<option value="">column</option>';
        data.columns.forEach(function(c) {
            var opt = document.createElement('option');
            opt.value = c; opt.textContent = c;
            sel.appendChild(opt);
        });
        if (prev && data.columns.indexOf(prev) !== -1) sel.value = prev;
        else {
            for (var i = 0; i < data.columns.length; i++) {
                var v = data.data[data.columns[i]];
                if (v && v.length > 0 && !isNaN(parseFloat(v[0]))) { sel.value = data.columns[i]; break; }
            }
        }
    },

    receive(inputName, data, fromUnit) {
        if (!data || (!data.columns && !Array.isArray(data))) return;
        var normalized = data;
        if (Array.isArray(data)) normalized = { columns: ['x'], data: { x: data } };

        this._dataA = normalized;
        this._dataB = normalized;
        this._populateSelect(this.id + '-col-a', normalized);
        this._populateSelect(this.id + '-col-b', normalized);
        FR.LED(document.getElementById(this.id + '-led-a')).set('green');
        FR.LED(document.getElementById(this.id + '-led-b')).set('green');

        this._compute();
        FR.emit(this.id, 'thru', data);
    },

    getOutput(channel) { return null; }
});

// ═══════════════════════════════════════════════════════════
// CORRELATOR SC-01 — Scatter & Correlation Analyzer
// Scope-grid scatter plot. Pearson, Spearman, R², regression.
// ═══════════════════════════════════════════════════════════

FR.registerUnit('correlator', {
    init(el, id) {
        this.el = el;
        this.id = id;
        this._data = null;
        this._showRegr = true;
        this._showLabels = false;

        var self = this;
        var colX = document.getElementById(id + '-col-x');
        var colY = document.getElementById(id + '-col-y');
        if (colX) colX.addEventListener('change', function() { self._render(); });
        if (colY) colY.addEventListener('change', function() { self._render(); });

        var regrBtn = document.getElementById(id + '-btn-regr');
        if (regrBtn) regrBtn.addEventListener('click', function() {
            self._showRegr = !self._showRegr;
            regrBtn.classList.toggle('active', self._showRegr);
            self._render();
        });
        var labelsBtn = document.getElementById(id + '-btn-labels');
        if (labelsBtn) labelsBtn.addEventListener('click', function() {
            self._showLabels = !self._showLabels;
            labelsBtn.classList.toggle('active', self._showLabels);
            self._render();
        });
    },

    _getNumeric(col) {
        if (!this._data || !col || !this._data.data[col]) return [];
        return this._data.data[col].map(function(v) { return parseFloat(v); });
    },

    _fetchCompute(op, data, callback) {
        var csrf = document.querySelector('[name=csrfmiddlewaretoken]');
        fetch('/api/rack/compute/', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', 'X-CSRFToken': csrf ? csrf.value : document.cookie.replace(/.*csrftoken=([^;]*).*/, '$1') },
            body: JSON.stringify({ op: op, data: data })
        }).then(function(r) { return r.json(); }).then(function(j) { if (j.result) callback(j.result); else console.warn('rack compute error:', op, j.error); }).catch(function(e) { console.warn('rack compute fetch error:', op, e); });
    },

    _render() {
        var colXSel = document.getElementById(this.id + '-col-x');
        var colYSel = document.getElementById(this.id + '-col-y');
        var colX = colXSel ? colXSel.value : '';
        var colY = colYSel ? colYSel.value : '';
        var viewport = document.getElementById(this.id + '-viewport');
        var empty = document.getElementById(this.id + '-empty');

        if (!colX || !colY || !this._data) {
            if (viewport) viewport.innerHTML = '';
            if (empty) empty.style.display = 'flex';
            this._setReadouts('—','—','—','—');
            return;
        }

        var rawX = this._getNumeric(colX);
        var rawY = this._getNumeric(colY);
        var x = [], y = [];
        for (var i = 0; i < Math.min(rawX.length, rawY.length); i++) {
            if (!isNaN(rawX[i]) && !isNaN(rawY[i])) { x.push(rawX[i]); y.push(rawY[i]); }
        }

        if (x.length < 3) {
            if (viewport) viewport.innerHTML = '';
            if (empty) { empty.style.display = 'flex'; empty.querySelector('span').textContent = 'Need 3+ paired points'; }
            this._setReadouts('—','—','—', x.length);
            return;
        }

        if (empty) empty.style.display = 'none';
        var self = this;

        // Fetch stats from server (forgestat)
        this._fetchCompute('pearson', { x: x, y: y }, function(r) {
            var pEl = document.getElementById(self.id + '-pearson');
            var rEl = document.getElementById(self.id + '-rsq');
            var nEl = document.getElementById(self.id + '-n');
            if (pEl) pEl.textContent = r.r.toFixed(3);
            if (rEl) rEl.textContent = r.r_squared.toFixed(3);
            if (nEl) nEl.textContent = r.n;
            FR.emit(self.id, 'result', r);
        });
        this._fetchCompute('spearman', { x: x, y: y }, function(r) {
            var el = document.getElementById(self.id + '-spearman');
            if (el) el.textContent = r.rho.toFixed(3);
        });

        // Render scatter SVG (UI only — no math)
        var rect = viewport.getBoundingClientRect();
        var w = rect.width || 300, h = rect.height || 180;
        var pad = { top: 8, right: 8, bottom: 8, left: 8 };

        var xMin = Math.min.apply(null,x), xMax = Math.max.apply(null,x);
        var yMin = Math.min.apply(null,y), yMax = Math.max.apply(null,y);
        var xRng = (xMax-xMin) || 1; var yRng = (yMax-yMin) || 1;
        xMin -= xRng*0.05; xMax += xRng*0.05;
        yMin -= yRng*0.05; yMax += yRng*0.05;

        function sx(v) { return pad.left + (v-xMin)/(xMax-xMin) * (w-pad.left-pad.right); }
        function sy(v) { return h - pad.bottom - (v-yMin)/(yMax-yMin) * (h-pad.top-pad.bottom); }

        var svg = '<svg width="'+w+'" height="'+h+'" xmlns="http://www.w3.org/2000/svg">';

        // Regression line — fetch from server
        if (this._showRegr) {
            this._fetchCompute('regression', { x: x, y: y }, function(reg) {
                var rx0 = xMin, ry0 = reg.slope*xMin + reg.intercept;
                var rx1 = xMax, ry1 = reg.slope*xMax + reg.intercept;
                var line = document.createElementNS('http://www.w3.org/2000/svg','line');
                line.setAttribute('x1', sx(rx0).toFixed(1)); line.setAttribute('y1', sy(ry0).toFixed(1));
                line.setAttribute('x2', sx(rx1).toFixed(1)); line.setAttribute('y2', sy(ry1).toFixed(1));
                line.setAttribute('stroke','#fde68a'); line.setAttribute('stroke-width','1.5');
                line.setAttribute('opacity','0.5'); line.setAttribute('stroke-dasharray','4,3');
                var title = document.createElementNS('http://www.w3.org/2000/svg','title');
                title.textContent = 'y = '+reg.slope.toFixed(3)+'x + '+reg.intercept.toFixed(3);
                line.appendChild(title);
                var svgEl = viewport.querySelector('svg');
                if (svgEl) svgEl.insertBefore(line, svgEl.firstChild);
            });
        }

        // Data points
        for (var i = 0; i < x.length; i++) {
            var px = sx(x[i]).toFixed(1), py = sy(y[i]).toFixed(1);
            svg += '<circle cx="'+px+'" cy="'+py+'" r="2.5" fill="#38bdf8" opacity="0.7" style="cursor:pointer;">';
            svg += '<title>'+colX+': '+x[i].toFixed(3)+', '+colY+': '+y[i].toFixed(3)+'</title></circle>';
        }

        if (this._showLabels) {
            svg += '<text x="'+(w/2)+'" y="'+(h-1)+'" text-anchor="middle" fill="rgba(56,189,248,0.25)" font-size="8" font-family="Helvetica,Arial">'+colX+'</text>';
            svg += '<text x="4" y="'+(h/2)+'" text-anchor="middle" fill="rgba(56,189,248,0.25)" font-size="8" font-family="Helvetica,Arial" transform="rotate(-90,4,'+(h/2)+')">'+colY+'</text>';
        }

        svg += '</svg>';
        viewport.innerHTML = svg;

        FR.LED(document.getElementById(this.id + '-led')).set('green');
        FR.emit(this.id, 'thru', this._data);
    },

    _setReadouts(pearson, spearman, rsq, n) {
        var pEl = document.getElementById(this.id + '-pearson');
        var sEl = document.getElementById(this.id + '-spearman');
        var rEl = document.getElementById(this.id + '-rsq');
        var nEl = document.getElementById(this.id + '-n');
        if (pEl) pEl.textContent = pearson;
        if (sEl) sEl.textContent = spearman;
        if (rEl) rEl.textContent = rsq;
        if (nEl) nEl.textContent = n;
    },

    receive(inputName, data, fromUnit) {
        if (!data) return;
        if (data.columns && data.data) {
            this._data = data;
        } else if (Array.isArray(data)) {
            this._data = { columns: ['x'], data: { x: data } };
        } else return;

        // Populate selectors
        var self = this;
        ['col-x','col-y'].forEach(function(selId, idx) {
            var sel = document.getElementById(self.id + '-' + selId);
            if (!sel) return;
            var prev = sel.value;
            sel.innerHTML = '<option value="">column</option>';
            var numCols = self._data.columns.filter(function(c) {
                var v = self._data.data[c];
                return v && v.length > 0 && !isNaN(parseFloat(v[0]));
            });
            numCols.forEach(function(c) {
                var opt = document.createElement('option');
                opt.value = c; opt.textContent = c;
                sel.appendChild(opt);
            });
            // Auto-select first two numeric columns
            if (!prev || numCols.indexOf(prev) === -1) {
                if (numCols[idx]) sel.value = numCols[idx];
            } else {
                sel.value = prev;
            }
        });

        this._render();
        FR.emit(this.id, 'thru', data);
    },

    getOutput(channel) { return null; }
});

// ═══════════════════════════════════════════════════════════
// SPECTRUM SP-01 — Distribution Analyzer (Tektronix)
// Histogram + normal overlay. All math server-side.
// ═══════════════════════════════════════════════════════════

FR.registerUnit('spectrum', {
    init(el, id) {
        this.el = el; this.id = id;
        this._data = null; this._bins = 15; this._showNormal = true; this._showRug = false;

        var self = this;
        var colSel = document.getElementById(id + '-col');
        if (colSel) colSel.addEventListener('change', function() { self._render(); });

        // Bin buttons
        [8,15,25].forEach(function(b) {
            var btn = document.getElementById(id + '-bin-' + b);
            if (btn) btn.addEventListener('click', function() {
                self._bins = b;
                el.querySelectorAll('.tek-btn-row .tek-btn').forEach(function(t) { t.classList.remove('active'); });
                btn.classList.add('active');
                self._render();
            });
        });
        var autoBtn = document.getElementById(id + '-bin-auto');
        if (autoBtn) autoBtn.addEventListener('click', function() {
            self._bins = 0;
            el.querySelectorAll('.tek-btn-row .tek-btn').forEach(function(t) { t.classList.remove('active'); });
            autoBtn.classList.add('active');
            self._render();
        });

        // Overlay toggles
        var normalBtn = document.getElementById(id + '-btn-normal');
        if (normalBtn) normalBtn.addEventListener('click', function() {
            self._showNormal = !self._showNormal;
            normalBtn.classList.toggle('active', self._showNormal);
            self._render();
        });
        var rugBtn = document.getElementById(id + '-btn-rug');
        if (rugBtn) rugBtn.addEventListener('click', function() {
            self._showRug = !self._showRug;
            rugBtn.classList.toggle('active', self._showRug);
            self._render();
        });
    },

    _render() {
        if (!this._data) return;
        var colSel = document.getElementById(this.id + '-col');
        var col = colSel ? colSel.value : '';
        var viewport = document.getElementById(this.id + '-viewport');
        var empty = document.getElementById(this.id + '-empty');

        if (!col || !this._data.data[col]) {
            if (viewport) viewport.innerHTML = '';
            if (empty) empty.style.display = 'flex';
            return;
        }

        var raw = this._data.data[col] || [];
        var vals = [];
        for (var i = 0; i < raw.length; i++) { var v = parseFloat(raw[i]); if (!isNaN(v)) vals.push(v); }
        if (vals.length < 2) return;

        var self = this;
        var csrf = document.querySelector('[name=csrfmiddlewaretoken]');
        fetch('/api/rack/compute/', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', 'X-CSRFToken': csrf ? csrf.value : document.cookie.replace(/.*csrftoken=([^;]*).*/, '$1') },
            body: JSON.stringify({ op: 'histogram', data: { values: vals, bins: self._bins } })
        })
        .then(function(resp) { return resp.json(); })
        .then(function(json) {
            if (json.error) { console.warn('spectrum error:', json.error); return; }
            self._drawHistogram(json.result, vals, col);
        })
        .catch(function(e) { console.warn('spectrum fetch error:', e); });
    },

    _drawHistogram(r, vals, col) {
        var viewport = document.getElementById(this.id + '-viewport');
        var empty = document.getElementById(this.id + '-empty');
        if (empty) empty.style.display = 'none';

        // Update readouts
        var ids = { mean: r.mean, std: r.std, skew: r.skewness, kurt: r.kurtosis, n: r.n };
        for (var k in ids) {
            var el = document.getElementById(this.id + '-' + k);
            if (el) el.textContent = k === 'n' ? String(r.n) : ids[k].toFixed(3);
        }

        if (!viewport) return;
        var w = viewport.clientWidth || 400, h = viewport.clientHeight || 250;
        var pad = { top: 10, right: 10, bottom: 25, left: 10 };
        var pw = w - pad.left - pad.right, ph = h - pad.top - pad.bottom;

        var maxCount = Math.max.apply(null, r.bins) || 1;
        var nBins = r.bins.length;
        var barW = pw / nBins;

        function sx(i) { return pad.left + i * barW; }
        function sy(count) { return pad.top + ph * (1 - count / maxCount); }

        var svg = '<svg width="'+w+'" height="'+h+'" xmlns="http://www.w3.org/2000/svg">';

        // Histogram bars
        for (var i = 0; i < nBins; i++) {
            var bh = (r.bins[i] / maxCount) * ph;
            var bx = sx(i);
            var by = pad.top + ph - bh;
            svg += '<rect x="'+(bx+0.5)+'" y="'+by.toFixed(1)+'" width="'+(barW-1)+'" height="'+bh.toFixed(1)+'" fill="#38bdf8" opacity="0.6" rx="1">';
            svg += '<title>'+r.edges[i].toFixed(2)+' – '+r.edges[i+1].toFixed(2)+': '+r.bins[i]+'</title></rect>';
        }

        // Normal curve overlay
        if (this._showNormal && r.std > 0) {
            var mean = r.mean, std = r.std;
            var totalArea = vals.length * r.bin_width;
            var pathD = '';
            for (var px = 0; px <= pw; px += 2) {
                var xVal = r.min + (px / pw) * (r.max - r.min);
                var z = (xVal - mean) / std;
                var density = Math.exp(-0.5 * z * z) / (std * Math.sqrt(2 * Math.PI));
                var yPx = Math.max(pad.top, pad.top + ph * (1 - (density * totalArea) / maxCount));
                pathD += (px === 0 ? 'M' : 'L') + (pad.left + px) + ',' + yPx.toFixed(1);
            }
            svg += '<path d="'+pathD+'" fill="none" stroke="#fde68a" stroke-width="1.5" opacity="0.7"/>';
        }

        // Rug plot
        if (this._showRug) {
            for (var i = 0; i < vals.length; i++) {
                var rx = pad.left + ((vals[i] - r.min) / (r.max - r.min || 1)) * pw;
                svg += '<line x1="'+rx.toFixed(1)+'" y1="'+(h-pad.bottom)+'" x2="'+rx.toFixed(1)+'" y2="'+(h-pad.bottom+4)+'" stroke="#38bdf8" stroke-width="0.5" opacity="0.3"/>';
            }
        }

        // X axis labels
        var labelStep = Math.max(1, Math.floor(nBins / 6));
        for (var i = 0; i <= nBins; i += labelStep) {
            svg += '<text x="'+sx(i).toFixed(1)+'" y="'+(h-pad.bottom+14)+'" fill="rgba(56,189,248,0.25)" font-size="7" text-anchor="middle" font-family="Helvetica,Arial">'+r.edges[i].toFixed(1)+'</text>';
        }

        svg += '</svg>';
        viewport.innerHTML = svg;
        FR.LED(document.getElementById(this.id + '-led')).set('green');
        FR.emit(this.id, 'result', r);
        FR.emit(this.id, 'thru', this._data);
    },

    receive(inputName, data, fromUnit) {
        if (!data) return;
        if (data.columns && data.data) { this._data = data; }
        else if (Array.isArray(data)) { this._data = { columns: ['x'], data: { x: data } }; }
        else return;

        var self = this;
        var colSel = document.getElementById(this.id + '-col');
        if (colSel) {
            var prev = colSel.value;
            colSel.innerHTML = '<option value="">column</option>';
            var self2 = this;
            this._data.columns.forEach(function(c) {
                var v = self2._data.data[c];
                if (!v || v.length === 0 || isNaN(parseFloat(v[0]))) return; // skip non-numeric
                var opt = document.createElement('option'); opt.value = c; opt.textContent = c;
                colSel.appendChild(opt);
            });
            if (prev && colSel.querySelector('option[value="'+prev+'"]')) colSel.value = prev;
            else if (colSel.options.length > 1) colSel.selectedIndex = 1;
        }
        this._render();
        FR.emit(this.id, 'thru', data);
    },

    getOutput(channel) { return null; }
});

// ═══════════════════════════════════════════════════════════
// COUNTER CT-01 — Event Accumulator (Kosmos)
// Mechanical digit wheels. Counts rows, triggers, events.
// ═══════════════════════════════════════════════════════════

FR.registerUnit('counter', {
    init(el, id) {
        this.el = el; this.id = id;
        this._count = 0;

        var self = this;
        var resetBtn = document.getElementById(id + '-btn-reset');
        if (resetBtn) resetBtn.addEventListener('click', function() {
            self._count = 0;
            self._updateWheel();
            FR.LED(document.getElementById(self.id + '-led')).off();
            FR.emit(self.id, 'count', { count: 0 });
        });

        this._updateWheel();
    },

    _updateWheel() {
        var s = String(this._count).padStart(6, '0');
        for (var i = 0; i < 6; i++) {
            var el = document.getElementById(this.id + '-d' + (5 - i));
            if (el) {
                var newDigit = s[i];
                if (el.textContent !== newDigit) {
                    el.textContent = newDigit;
                    // Quick flash animation — digit just rolled
                    el.style.transition = 'none';
                    el.style.transform = 'translateY(-3px)';
                    setTimeout(function(e) {
                        e.style.transition = 'transform 0.15s cubic-bezier(0.4,0,0.2,1)';
                        e.style.transform = 'translateY(0)';
                    }, 10, el);
                }
            }
        }
    },

    receive(inputName, data, fromUnit) {
        if (inputName === 'trigger') {
            // Trigger input — increment by 1 per event
            this._count++;
            this._updateWheel();
            FR.LED(document.getElementById(this.id + '-led')).set('green');
            // Brief flash
            var self = this;
            setTimeout(function() { FR.LED(document.getElementById(self.id + '-led')).set('amber'); }, 200);
            FR.emit(this.id, 'count', { count: this._count });
        } else if (inputName === 'data') {
            // Data input — count rows
            if (data && data.columns && data.data) {
                var col = data.columns[0];
                var n = col ? (data.data[col] || []).length : 0;
                this._count += n;
            } else if (Array.isArray(data)) {
                this._count += data.length;
            } else {
                this._count++;
            }
            this._updateWheel();
            FR.LED(document.getElementById(this.id + '-led')).set('green');
            FR.emit(this.id, 'count', { count: this._count });
            FR.emit(this.id, 'thru', data);
        }
    },

    getOutput(channel) {
        if (channel === 'count') return { count: this._count };
        return null;
    }
});

// ═══════════════════════════════════════════════════════════
// PRECISION GA-01 — Gage R&R / MSA (Apothecary)
// All computation via forgespc.gage.gage_rr_crossed on server.
// ═══════════════════════════════════════════════════════════

FR.registerUnit('precision', {
    init(el, id) {
        this.el = el; this.id = id;
        this._data = null;

        var self = this;
        var runBtn = document.getElementById(id + '-btn-run');
        if (runBtn) runBtn.addEventListener('click', function() { self._run(); });
    },

    _run() {
        if (!this._data) return;
        var partSel = document.getElementById(this.id + '-col-part');
        var opSel = document.getElementById(this.id + '-col-op');
        var measSel = document.getElementById(this.id + '-col-meas');
        var tolInput = document.getElementById(this.id + '-tolerance');

        var partCol = partSel ? partSel.value : '';
        var opCol = opSel ? opSel.value : '';
        var measCol = measSel ? measSel.value : '';
        var tol = tolInput && tolInput.value.trim() ? parseFloat(tolInput.value) : null;

        if (!partCol || !opCol || !measCol) {
            this._showResult('Select Part, Operator, and Measurement columns.', 'rgba(180,40,40,0.5)');
            return;
        }

        var d = this._data.data;
        var parts = d[partCol] || [];
        var operators = d[opCol] || [];
        var measurements = d[measCol] || [];

        if (parts.length < 4) {
            this._showResult('Need at least 4 data rows for Gage R&R.', 'rgba(180,40,40,0.5)');
            return;
        }

        var self = this;
        var csrf = document.querySelector('[name=csrfmiddlewaretoken]');
        var payload = { op: 'gage_rr', data: { parts: parts, operators: operators, measurements: measurements } };
        if (tol !== null && !isNaN(tol)) payload.data.tolerance = tol;

        this._showResult('Analyzing...', 'rgba(74,90,74,0.4)');

        fetch('/api/rack/compute/', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', 'X-CSRFToken': csrf ? csrf.value : document.cookie.replace(/.*csrftoken=([^;]*).*/, '$1') },
            body: JSON.stringify(payload)
        })
        .then(function(resp) { return resp.json(); })
        .then(function(json) {
            if (json.error) {
                self._showResult('ERROR: ' + json.error, 'rgba(180,40,40,0.6)');
                FR.LED(document.getElementById(self.id + '-led')).set('red');
                return;
            }
            self._displayResults(json.result);
        })
        .catch(function(e) {
            self._showResult('Fetch error: ' + e, 'rgba(180,40,40,0.6)');
            FR.LED(document.getElementById(self.id + '-led')).set('red');
        });
    },

    _showResult(msg, color) {
        var el = document.getElementById(this.id + '-results');
        if (el) { el.innerHTML = '<span style="color:' + (color || 'rgba(74,90,74,0.4)') + ';">' + msg + '</span>'; }
    },

    _displayResults(r) {
        // GRR% gauge
        var grrEl = document.getElementById(this.id + '-grr-pct');
        if (grrEl) grrEl.textContent = r.grr_percent.toFixed(1);

        // NDC
        var ndcEl = document.getElementById(this.id + '-ndc');
        if (ndcEl) ndcEl.textContent = r.ndc;

        // Assessment verdict
        var verdictEl = document.getElementById(this.id + '-verdict');
        var verdictLed = document.getElementById(this.id + '-led-verdict');
        if (verdictEl) verdictEl.textContent = r.assessment;
        if (verdictLed) {
            if (r.assessment === 'Acceptable') FR.LED(verdictLed).set('green');
            else if (r.assessment === 'Marginal') FR.LED(verdictLed).set('amber');
            else FR.LED(verdictLed).set('red');
        }

        // Design info
        var npEl = document.getElementById(this.id + '-n-parts');
        var noEl = document.getElementById(this.id + '-n-ops');
        var nrEl = document.getElementById(this.id + '-n-reps');
        if (npEl) npEl.textContent = r.n_parts;
        if (noEl) noEl.textContent = r.n_operators;
        if (nrEl) nrEl.textContent = r.n_replicates;

        // Bubble level — centered if good, off-center if bad
        var bubble = document.getElementById(this.id + '-bubble');
        if (bubble) {
            var offset = r.assessment === 'Acceptable' ? 0 : r.assessment === 'Marginal' ? 4 : 8;
            bubble.style.left = 'calc(50% - 3px + ' + offset + 'px)';
        }

        FR.LED(document.getElementById(this.id + '-led')).set('green');

        // Detailed results in glass panel
        var html = '<div style="font:11px/1.6 Georgia,serif;color:rgba(74,90,74,0.6);">';
        html += '<div style="font:700 12px/1 Georgia,serif;color:rgba(74,90,74,0.7);margin-bottom:6px;">Gage R&R Results</div>';
        html += '<div style="border-bottom:1px solid rgba(74,90,74,0.08);padding:2px 0;"><span style="display:inline-block;width:110px;color:rgba(74,90,74,0.4);">Repeatability</span> <span style="font-family:JetBrains Mono,monospace;font-size:10px;">' + (r.repeatability * 1e6).toFixed(1) + ' \u00D710\u207B\u2076</span></div>';
        html += '<div style="border-bottom:1px solid rgba(74,90,74,0.08);padding:2px 0;"><span style="display:inline-block;width:110px;color:rgba(74,90,74,0.4);">Reproducibility</span> <span style="font-family:JetBrains Mono,monospace;font-size:10px;">' + (r.reproducibility * 1e6).toFixed(1) + ' \u00D710\u207B\u2076</span></div>';
        html += '<div style="border-bottom:1px solid rgba(74,90,74,0.08);padding:2px 0;"><span style="display:inline-block;width:110px;color:rgba(74,90,74,0.4);">GRR</span> <span style="font-family:JetBrains Mono,monospace;font-size:10px;">' + (r.grr * 1e6).toFixed(1) + ' \u00D710\u207B\u2076</span></div>';
        html += '<div style="border-bottom:1px solid rgba(74,90,74,0.08);padding:2px 0;"><span style="display:inline-block;width:110px;color:rgba(74,90,74,0.4);">Part Variation</span> <span style="font-family:JetBrains Mono,monospace;font-size:10px;">' + (r.part_variation * 1e6).toFixed(1) + ' \u00D710\u207B\u2076</span></div>';
        html += '<div style="border-bottom:1px solid rgba(74,90,74,0.08);padding:2px 0;"><span style="display:inline-block;width:110px;color:rgba(74,90,74,0.4);">Total Variation</span> <span style="font-family:JetBrains Mono,monospace;font-size:10px;">' + (r.total_variation * 1e6).toFixed(1) + ' \u00D710\u207B\u2076</span></div>';
        html += '<div style="margin-top:6px;padding:4px 6px;background:rgba(74,90,74,0.04);border-radius:2px;">';
        html += '<span style="font:700 9px/1 Georgia,serif;color:rgba(74,90,74,0.5);">GRR% = ' + r.grr_percent.toFixed(1) + '% &nbsp; NDC = ' + r.ndc + '</span>';
        html += '<div style="font:10px/1.4 Georgia,serif;color:rgba(74,90,74,0.35);margin-top:2px;">';
        if (r.grr_percent < 10) html += 'Measurement system is adequate.';
        else if (r.grr_percent < 30) html += 'Measurement system may be acceptable depending on application.';
        else html += 'Measurement system needs improvement. NDC \u2265 5 required.';
        html += '</div></div>';
        html += '</div>';

        var resultsEl = document.getElementById(this.id + '-results');
        if (resultsEl) resultsEl.innerHTML = html;

        FR.emit(this.id, 'result', r);
    },

    receive(inputName, data, fromUnit) {
        if (!data) return;
        if (data.columns && data.data) { this._data = data; }
        else return;

        // Populate all three selectors
        var self = this;
        ['col-part', 'col-op', 'col-meas'].forEach(function(selId) {
            var sel = document.getElementById(self.id + '-' + selId);
            if (!sel) return;
            var prev = sel.value;
            sel.innerHTML = '<option value="">column</option>';
            self._data.columns.forEach(function(c) {
                var opt = document.createElement('option');
                opt.value = c; opt.textContent = c;
                sel.appendChild(opt);
            });
            if (prev && self._data.columns.indexOf(prev) !== -1) sel.value = prev;
        });

        FR.LED(document.getElementById(this.id + '-led')).set('green');
        FR.emit(this.id, 'thru', data);
    },

    getOutput(channel) { return null; }
});

})(ForgeRack);
