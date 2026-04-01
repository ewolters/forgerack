// ═══════════════════════════════════════════════════════════
// PRISM MFD-700 — Multi-Function Display
// Separate file — loaded after units.js
// ═══════════════════════════════════════════════════════════

(function(FR) {
'use strict';

FR.registerUnit('mfd', {
    init(el, id) {
        this.el = el; this.id = id;
        this.data = null;
        this.mode = 'map';
        this.selectedCol = 0;
        this.page = 0;
        FR.LED(document.getElementById(id + '-led-pwr')).set('accent');
        this._setActiveLeft(0);
    },

    receive(inputName, data) {
        if (inputName !== 'data' || !data) return;
        this.data = data;
        var cols = data.columns || Object.keys(data.data || {});
        var rows = data.data && data.data[cols[0]] ? data.data[cols[0]].length : 0;
        document.getElementById(this.id + '-src-label').textContent = cols.length + ' COL';
        document.getElementById(this.id + '-row-label').textContent = rows + ' ROWS';
        document.getElementById(this.id + '-col-label').textContent = cols[this.selectedCol] || '\u2014';
        this._render();
    },

    leftKey(idx) {
        var modes = ['map', 'data', 'chart', 'list', 'stat'];
        this.mode = modes[idx] || 'map';
        this.page = 0;
        document.getElementById(this.id + '-mode-label').textContent = this.mode.toUpperCase();
        document.getElementById(this.id + '-page-label').textContent = this.mode.toUpperCase();
        this._setActiveLeft(idx);
        this._render();
    },

    rightKey(idx) {
        if (!this.data) return;
        var cols = this.data.columns || Object.keys(this.data.data || {});
        var maxPage = Math.max(0, Math.ceil((this.data.data && this.data.data[cols[0]] ? this.data.data[cols[0]].length : 0) / 20) - 1);
        if (idx === 0) this.page = Math.min(this.page + 1, maxPage);
        if (idx === 1) this.page = Math.max(0, this.page - 1);
        if (idx === 2) this.selectedCol = Math.min(cols.length - 1, this.selectedCol + 1);
        if (idx === 3) this.selectedCol = Math.max(0, this.selectedCol - 1);
        if (idx === 4 && this.mode === 'data') {
            var col = cols[this.selectedCol];
            if (col) FR.emit(this.id, 'selected', { data: { [col]: this.data.data[col] }, columns: [col] });
        }
        document.getElementById(this.id + '-col-label').textContent = cols[this.selectedCol] || '\u2014';
        this._render();
    },

    softKey(idx) { /* context-dependent — future */ },

    _setActiveLeft(idx) {
        for (var i = 0; i < 5; i++) {
            var btn = document.getElementById(this.id + '-lk' + i);
            if (btn) btn.classList.toggle('active', i === idx);
        }
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
        var html = '<div style="padding:8px;display:flex;flex-wrap:wrap;gap:6px;">';
        var self = this;
        cols.forEach(function(c, i) {
            var vals = (d[c] || []).filter(function(v) { return typeof v === 'number' || !isNaN(parseFloat(v)); }).map(Number);
            var mn = vals.length ? Math.min.apply(null, vals).toFixed(1) : '\u2014';
            var mx = vals.length ? Math.max.apply(null, vals).toFixed(1) : '\u2014';
            var sel = i === self.selectedCol ? 'border-color:#00e5ff;' : '';
            html += '<div style="background:#0a0a0a;border:1px solid #1a1a1a;padding:4px 8px;min-width:80px;' + sel + '">';
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
            var sel = i === self.selectedCol ? 'color:#00e5ff;' : 'color:#555;';
            html += '<th style="padding:2px 6px;text-align:right;font-size:8px;text-transform:uppercase;letter-spacing:0.06em;border-bottom:1px solid #1a1a1a;' + sel + '">' + c + '</th>';
        });
        html += '</tr>';
        for (var r = start; r < end; r++) {
            html += '<tr>';
            cols.forEach(function(c, i) {
                var sel = i === self.selectedCol ? 'color:#e0e0e0;' : 'color:#666;';
                var v = d[c] && d[c][r] !== undefined ? d[c][r] : '';
                html += '<td style="padding:1px 6px;text-align:right;border-bottom:1px solid #0a0a0a;' + sel + '">' + v + '</td>';
            });
            html += '</tr>';
        }
        html += '</table></div>';
        el.innerHTML = html;
    },

    _renderChart(el, cols, d) {
        var col = cols[this.selectedCol];
        if (!col) return;
        var vals = (d[col] || []).map(function(v) { return parseFloat(v); }).filter(function(v) { return !isNaN(v); });
        if (!vals.length) { el.innerHTML = '<div style="display:flex;align-items:center;justify-content:center;height:100%;color:rgba(0,229,255,0.06);font:300 11px/1 \'Helvetica Neue\',sans-serif;">No numeric data</div>'; return; }
        if (typeof ForgeViz !== 'undefined') {
            ForgeViz.render(el, {
                traces: [{ x: vals.map(function(_, i) { return i; }), y: vals, trace_type: 'line', color: '#00e5ff', width: 1.5, marker_size: 0 }],
                x_axis: { label: '' }, y_axis: { label: '' }, theme: 'svend_dark',
            }, { toolbar: false });
        }
    },

    _renderList(el, cols, d) {
        var col = cols[this.selectedCol];
        if (!col || !d[col]) return;
        var vals = d[col], start = this.page * 30, end = Math.min(start + 30, vals.length);
        var html = '<div style="padding:4px 8px;overflow:auto;height:100%;">';
        html += '<div style="font:600 8px/1 \'Helvetica Neue\',sans-serif;color:#00e5ff;text-transform:uppercase;letter-spacing:0.06em;margin-bottom:4px;">' + col + '</div>';
        for (var i = start; i < end; i++) {
            html += '<div style="padding:1px 0;font:10px/1.4 \'JetBrains Mono\',monospace;color:#aaa;border-bottom:1px solid #0a0a0a;display:flex;justify-content:space-between;">';
            html += '<span style="color:#444;">' + i + '</span><span>' + (vals[i] !== undefined ? vals[i] : '') + '</span></div>';
        }
        html += '</div>';
        el.innerHTML = html;
    },

    _renderStat(el, cols, d) {
        var col = cols[this.selectedCol];
        if (!col) return;
        var vals = (d[col] || []).map(function(v) { return parseFloat(v); }).filter(function(v) { return !isNaN(v); });
        if (!vals.length) { el.innerHTML = '<div style="display:flex;align-items:center;justify-content:center;height:100%;color:rgba(0,229,255,0.06);font:300 11px/1 \'Helvetica Neue\',sans-serif;">No numeric data</div>'; return; }
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
        var stats = [['N', n], ['Mean', mean.toFixed(4)], ['Median', median.toFixed(4)], ['StdDev', std.toFixed(4)], ['Min', min.toFixed(4)], ['Max', max.toFixed(4)], ['Range', (max - min).toFixed(4)], ['Sum', sum.toFixed(2)]];
        var html = '<div style="padding:8px 12px;">';
        html += '<div style="font:600 8px/1 \'Helvetica Neue\',sans-serif;color:#00e5ff;text-transform:uppercase;letter-spacing:0.06em;margin-bottom:8px;">' + col + '</div>';
        stats.forEach(function(s) {
            html += '<div style="display:flex;justify-content:space-between;padding:3px 0;border-bottom:1px solid #0a0a0a;">';
            html += '<span style="font:500 9px/1 \'Helvetica Neue\',sans-serif;color:#555;text-transform:uppercase;letter-spacing:0.04em;">' + s[0] + '</span>';
            html += '<span style="font:400 11px/1 \'JetBrains Mono\',monospace;color:#e0e0e0;">' + s[1] + '</span></div>';
        });
        html += '</div>';
        el.innerHTML = html;
    },
});

})(ForgeRack);
