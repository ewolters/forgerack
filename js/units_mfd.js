// ═══════════════════════════════════════════════════════════
// PRISM MFD-700 — Multi-Function Display
// Separate file — loaded after units.js
// ═══════════════════════════════════════════════════════════

(function(FR) {
'use strict';

// Right key configs per mode
var RIGHT_KEYS = {
    map: [
        { label: 'REFRESH', action: 'refresh' },
        { label: '', action: null },
        { label: '', action: null },
        { label: '', action: null },
        { label: 'EXPORT', action: 'export' },
    ],
    data: [
        { label: '\u25B2 PAGE', action: 'pageUp' },
        { label: '\u25BC PAGE', action: 'pageDown' },
        { label: '\u25C0 COL', action: 'colPrev' },
        { label: '\u25B6 COL', action: 'colNext' },
        { label: 'SELECT', action: 'select' },
    ],
    chart: [
        { label: '\u25C0 COL', action: 'colPrev' },
        { label: '\u25B6 COL', action: 'colNext' },
        { label: 'LINE', action: 'chartLine' },
        { label: 'BAR', action: 'chartBar' },
        { label: 'SCATTER', action: 'chartScatter' },
    ],
    list: [
        { label: '\u25B2 PAGE', action: 'pageUp' },
        { label: '\u25BC PAGE', action: 'pageDown' },
        { label: '\u25C0 COL', action: 'colPrev' },
        { label: '\u25B6 COL', action: 'colNext' },
        { label: 'SELECT', action: 'select' },
    ],
    stat: [
        { label: '\u25C0 COL', action: 'colPrev' },
        { label: '\u25B6 COL', action: 'colNext' },
        { label: '', action: null },
        { label: '', action: null },
        { label: 'SELECT', action: 'select' },
    ],
};

FR.registerUnit('mfd', {
    init(el, id) {
        this.el = el; this.id = id;
        this.data = null;
        this.mode = 'map';
        this.chartType = 'line';
        this.selectedCol = 0;
        this.page = 0;
        FR.LED(document.getElementById(id + '-led-pwr')).set('accent');
        this._setActiveLeft(0);
        this._updateRightKeys();
    },

    receive(inputName, data) {
        if (inputName !== 'data' || !data) return;
        this.data = data;
        this.page = 0;
        this.selectedCol = 0;
        var cols = data.columns || Object.keys(data.data || {});
        var rows = data.data && data.data[cols[0]] ? data.data[cols[0]].length : 0;
        document.getElementById(this.id + '-src-label').textContent = cols.length + ' COL';
        document.getElementById(this.id + '-row-label').textContent = rows + ' ROWS';
        this._updateColLabel();
        this._render();
    },

    leftKey(idx) {
        var modes = ['map', 'data', 'chart', 'list', 'stat'];
        this.mode = modes[idx] || 'map';
        this.page = 0;
        document.getElementById(this.id + '-mode-label').textContent = this.mode.toUpperCase();
        document.getElementById(this.id + '-page-label').textContent = this.mode.toUpperCase();
        this._setActiveLeft(idx);
        this._updateRightKeys();
        this._render();
    },

    rightKey(idx) {
        var keys = RIGHT_KEYS[this.mode] || RIGHT_KEYS.map;
        var action = keys[idx] ? keys[idx].action : null;
        if (!action) return;
        if (!this.data && action !== 'refresh') return;

        var cols = this.data ? (this.data.columns || Object.keys(this.data.data || {})) : [];
        var rowCount = this.data && this.data.data && cols[0] ? this.data.data[cols[0]].length : 0;
        var pageSize = this.mode === 'list' ? 30 : 20;
        var maxPage = Math.max(0, Math.ceil(rowCount / pageSize) - 1);

        switch (action) {
            case 'pageUp': this.page = Math.max(0, this.page - 1); break;
            case 'pageDown': this.page = Math.min(maxPage, this.page + 1); break;
            case 'colPrev':
                this.selectedCol = Math.max(0, this.selectedCol - 1);
                this._updateColLabel();
                break;
            case 'colNext':
                this.selectedCol = Math.min(cols.length - 1, this.selectedCol + 1);
                this._updateColLabel();
                break;
            case 'select':
                var col = cols[this.selectedCol];
                if (col && this.data.data[col]) {
                    FR.emit(this.id, 'selected', { data: { [col]: this.data.data[col] }, columns: [col] });
                    // Flash the key
                    var btn = document.getElementById(this.id + '-rk4');
                    if (btn) { btn.classList.add('active'); setTimeout(function() { btn.classList.remove('active'); }, 300); }
                }
                break;
            case 'chartLine': this.chartType = 'line'; break;
            case 'chartBar': this.chartType = 'bar'; break;
            case 'chartScatter': this.chartType = 'scatter'; break;
            case 'refresh': this._render(); return;
            case 'export':
                if (this.data) {
                    FR.emit(this.id, 'selected', this.data);
                }
                return;
        }
        this._render();
    },

    softKey(idx) { /* future — context actions */ },

    _setActiveLeft(idx) {
        for (var i = 0; i < 5; i++) {
            var btn = document.getElementById(this.id + '-lk' + i);
            if (btn) btn.classList.toggle('active', i === idx);
        }
    },

    _updateRightKeys() {
        var keys = RIGHT_KEYS[this.mode] || RIGHT_KEYS.map;
        for (var i = 0; i < 5; i++) {
            var label = document.getElementById(this.id + '-rk' + i + '-label');
            var btn = document.getElementById(this.id + '-rk' + i);
            if (label) label.textContent = keys[i] ? keys[i].label : '';
            if (btn) btn.style.visibility = (keys[i] && keys[i].action) ? 'visible' : 'hidden';
        }
    },

    _updateColLabel() {
        if (!this.data) return;
        var cols = this.data.columns || Object.keys(this.data.data || {});
        var name = cols[this.selectedCol] || '\u2014';
        document.getElementById(this.id + '-col-label').textContent = name;
        // Update status bar with column index
        document.getElementById(this.id + '-col-label').textContent = (this.selectedCol + 1) + '/' + cols.length + ' ' + name;
    },

    _render() {
        var el = document.getElementById(this.id + '-content');
        if (!this.data || !this.data.data) {
            el.innerHTML = '<div style="display:flex;align-items:center;justify-content:center;height:100%;"><span style="font:300 12px/1 \'Helvetica Neue\',sans-serif;color:rgba(0,229,255,0.06);">NO DATA</span></div>';
            return;
        }

        var cols = this.data.columns || Object.keys(this.data.data);
        var d = this.data.data;

        if (this.mode === 'data') this._renderData(el, cols, d);
        else if (this.mode === 'chart') this._renderChart(el, cols, d);
        else if (this.mode === 'list') this._renderList(el, cols, d);
        else if (this.mode === 'stat') this._renderStat(el, cols, d);
        else this._renderMap(el, cols, d);
    },

    _renderMap(el, cols, d) {
        var self = this;
        var html = '<div style="padding:8px;display:flex;flex-wrap:wrap;gap:6px;">';
        cols.forEach(function(c, i) {
            var vals = (d[c] || []).filter(function(v) { return typeof v === 'number' || !isNaN(parseFloat(v)); }).map(Number);
            var mn = vals.length ? Math.min.apply(null, vals).toFixed(1) : '\u2014';
            var mx = vals.length ? Math.max.apply(null, vals).toFixed(1) : '\u2014';
            var sel = i === self.selectedCol ? 'border-color:#00e5ff;' : '';
            html += '<div style="background:#0a0a0a;border:1px solid #1a1a1a;padding:4px 8px;min-width:80px;cursor:pointer;' + sel + '" onclick="ForgeRack.units[\'' + self.id + '\'].selectedCol=' + i + ';ForgeRack.units[\'' + self.id + '\']._updateColLabel();ForgeRack.units[\'' + self.id + '\']._renderMap(document.getElementById(\'' + self.id + '-content\'),null,null);">';
            html += '<div style="font:600 8px/1 \'Helvetica Neue\',sans-serif;color:#00e5ff;text-transform:uppercase;letter-spacing:0.04em;">' + c + '</div>';
            html += '<div style="font:400 11px/1 \'JetBrains Mono\',monospace;color:#e0e0e0;margin-top:3px;">' + mn + ' \u2014 ' + mx + '</div>';
            html += '<div style="font:400 8px/1 \'Helvetica Neue\',sans-serif;color:#444;margin-top:2px;">' + vals.length + ' vals</div>';
            html += '</div>';
        });
        html += '</div>';
        el.innerHTML = html;
    },

    _renderData(el, cols, d) {
        var rows = d[cols[0]] ? d[cols[0]].length : 0;
        var start = this.page * 20, end = Math.min(start + 20, rows);
        var self = this;
        var html = '<div style="overflow:auto;height:100%;font:10px/1.4 \'JetBrains Mono\',monospace;">';
        html += '<table style="width:100%;border-collapse:collapse;"><tr>';
        cols.forEach(function(c, i) {
            var sel = i === self.selectedCol ? 'color:#00e5ff;background:rgba(0,229,255,0.03);' : 'color:#555;';
            html += '<th style="padding:2px 6px;text-align:right;font-size:8px;text-transform:uppercase;letter-spacing:0.06em;border-bottom:1px solid #1a1a1a;cursor:pointer;' + sel + '" onclick="ForgeRack.units[\'' + self.id + '\'].selectedCol=' + i + ';ForgeRack.units[\'' + self.id + '\']._updateColLabel();ForgeRack.units[\'' + self.id + '\']._render();">' + c + '</th>';
        });
        html += '</tr>';
        for (var r = start; r < end; r++) {
            html += '<tr>';
            cols.forEach(function(c, i) {
                var sel = i === self.selectedCol ? 'color:#e0e0e0;background:rgba(0,229,255,0.015);' : 'color:#666;';
                var v = d[c] && d[c][r] !== undefined ? d[c][r] : '';
                html += '<td style="padding:1px 6px;text-align:right;border-bottom:1px solid #0a0a0a;' + sel + '">' + v + '</td>';
            });
            html += '</tr>';
        }
        html += '</table>';
        html += '<div style="padding:4px 6px;font:9px/1 \'Helvetica Neue\',sans-serif;color:#333;">Rows ' + (start + 1) + '\u2013' + end + ' of ' + rows + ' | Page ' + (this.page + 1) + '/' + (Math.ceil(rows / 20) || 1) + '</div>';
        html += '</div>';
        el.innerHTML = html;
    },

    _renderChart(el, cols, d) {
        var col = cols[this.selectedCol];
        if (!col) return;
        var vals = (d[col] || []).map(function(v) { return parseFloat(v); }).filter(function(v) { return !isNaN(v); });
        if (!vals.length) { el.innerHTML = '<div style="display:flex;align-items:center;justify-content:center;height:100%;color:rgba(0,229,255,0.06);font:300 11px/1 \'Helvetica Neue\',sans-serif;">No numeric data in ' + col + '</div>'; return; }
        if (typeof ForgeViz !== 'undefined') {
            ForgeViz.render(el, {
                traces: [{ x: vals.map(function(_, i) { return i; }), y: vals, trace_type: this.chartType, color: '#00e5ff', width: 1.5, marker_size: this.chartType === 'scatter' ? 4 : 0 }],
                title: col,
                x_axis: { label: 'Index' }, y_axis: { label: col },
                theme: 'svend_dark',
            }, { toolbar: false });
        }
    },

    _renderList(el, cols, d) {
        var col = cols[this.selectedCol];
        if (!col || !d[col]) return;
        var vals = d[col], start = this.page * 30, end = Math.min(start + 30, vals.length);
        var html = '<div style="padding:4px 8px;overflow:auto;height:100%;">';
        html += '<div style="font:600 8px/1 \'Helvetica Neue\',sans-serif;color:#00e5ff;text-transform:uppercase;letter-spacing:0.06em;margin-bottom:4px;">' + col + ' (' + vals.length + ' values)</div>';
        for (var i = start; i < end; i++) {
            html += '<div style="padding:1px 0;font:10px/1.4 \'JetBrains Mono\',monospace;color:#aaa;border-bottom:1px solid #0a0a0a;display:flex;justify-content:space-between;">';
            html += '<span style="color:#333;min-width:30px;">' + i + '</span><span>' + (vals[i] !== undefined ? vals[i] : '') + '</span></div>';
        }
        html += '<div style="padding:4px 0;font:9px/1 \'Helvetica Neue\',sans-serif;color:#333;">Rows ' + (start + 1) + '\u2013' + end + ' of ' + vals.length + '</div>';
        html += '</div>';
        el.innerHTML = html;
    },

    _renderStat(el, cols, d) {
        var col = cols[this.selectedCol];
        if (!col) return;
        var vals = (d[col] || []).map(function(v) { return parseFloat(v); }).filter(function(v) { return !isNaN(v); });
        if (!vals.length) { el.innerHTML = '<div style="display:flex;align-items:center;justify-content:center;height:100%;color:rgba(0,229,255,0.06);font:300 11px/1 \'Helvetica Neue\',sans-serif;">No numeric data in ' + col + '</div>'; return; }
        var n = vals.length, sum = 0, i;
        for (i = 0; i < n; i++) sum += vals[i];
        var mean = sum / n;
        var sorted = vals.slice().sort(function(a, b) { return a - b; });
        var median = n % 2 ? sorted[Math.floor(n / 2)] : (sorted[n / 2 - 1] + sorted[n / 2]) / 2;
        var variance = 0;
        for (i = 0; i < n; i++) variance += (vals[i] - mean) * (vals[i] - mean);
        variance /= (n - 1 || 1);
        var std = Math.sqrt(variance);
        var min = sorted[0], max = sorted[n - 1];
        var q1 = sorted[Math.floor(n * 0.25)], q3 = sorted[Math.floor(n * 0.75)];

        var stats = [
            ['Column', col], ['N', n], ['Mean', mean.toFixed(4)], ['Median', median.toFixed(4)],
            ['StdDev', std.toFixed(4)], ['Min', min.toFixed(4)], ['Q1', q1.toFixed(4)],
            ['Q3', q3.toFixed(4)], ['Max', max.toFixed(4)], ['Range', (max - min).toFixed(4)],
            ['IQR', (q3 - q1).toFixed(4)], ['Sum', sum.toFixed(2)],
        ];

        var html = '<div style="padding:8px 12px;">';
        stats.forEach(function(s) {
            var isHeader = s[0] === 'Column';
            var labelStyle = isHeader ? 'font:600 9px/1 \'Helvetica Neue\',sans-serif;color:#00e5ff;text-transform:uppercase;letter-spacing:0.06em;' : 'font:500 9px/1 \'Helvetica Neue\',sans-serif;color:#555;text-transform:uppercase;letter-spacing:0.04em;';
            var valStyle = isHeader ? 'font:500 11px/1 \'Helvetica Neue\',sans-serif;color:#00e5ff;' : 'font:400 11px/1 \'JetBrains Mono\',monospace;color:#e0e0e0;';
            html += '<div style="display:flex;justify-content:space-between;padding:3px 0;border-bottom:1px solid #0a0a0a;">';
            html += '<span style="' + labelStyle + '">' + s[0] + '</span>';
            html += '<span style="' + valStyle + '">' + s[1] + '</span>';
            html += '</div>';
        });
        html += '</div>';
        el.innerHTML = html;
    },
});

})(ForgeRack);
