/**
 * ForgeRack — Unit Behaviors
 * Each unit registers its init, data handling, and jack I/O.
 */
(function(FR) {
'use strict';

// ═══════════════════════════════════════════════════════════
// CSV INPUT — already has unit-csv-input.js, but let's consolidate
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
// CHART PANEL (LENS) — renders ForgeViz ChartSpec
// ═══════════════════════════════════════════════════════════

FR.registerUnit('chart-panel', {
    init(el, id) {
        this.el = el;
        this.id = id;
        this._spec = null;
    },

    receive(inputName, data, fromUnit) {
        // Data received via cable — render it
        if (!data) return;

        const viewport = document.getElementById(this.id + '-viewport');
        const empty = document.getElementById(this.id + '-empty');
        if (!viewport) return;

        // If data is already a ChartSpec, render directly
        if (data.traces || data.chart_type) {
            this._renderSpec(viewport, data);
            if (empty) empty.style.display = 'none';
            return;
        }

        // If data is an array of numbers, build a line chart
        if (Array.isArray(data)) {
            const spec = {
                traces: [{ x: data.map((_, i) => i + 1), y: data, trace_type: 'line', color: '#4ade80', width: 1.5, marker_size: 3 }],
                reference_lines: [],
                x_axis: { label: '' },
                y_axis: { label: '' },
                theme: 'svend_dark'
            };
            this._renderSpec(viewport, spec);
            if (empty) empty.style.display = 'none';
            return;
        }

        // If data is { columns, data } from csv-input, plot first numeric column
        if (data.data && data.columns) {
            const col = data.columns[0];
            const vals = data.data[col];
            if (Array.isArray(vals) && vals.length > 0 && typeof vals[0] === 'number') {
                this.receive('chart', vals, fromUnit);
                return;
            }
        }
    },

    _renderSpec(viewport, spec) {
        viewport.innerHTML = '';
        if (typeof ForgeViz !== 'undefined' && ForgeViz.render) {
            ForgeViz.render(viewport, spec, { toolbar: false });
        } else {
            viewport.innerHTML = '<div style="padding:10px;font:9px monospace;color:rgba(74,222,128,0.2);">ForgeViz not loaded</div>';
        }
        FR.LED(document.getElementById(this.id + '-led')).set('green');
    },

    clear() {
        const viewport = document.getElementById(this.id + '-viewport');
        const empty = document.getElementById(this.id + '-empty');
        if (viewport) viewport.innerHTML = '';
        if (empty) { empty.style.display = 'flex'; viewport.appendChild(empty); }
        FR.LED(document.getElementById(this.id + '-led')).off();
    }
});


// ═══════════════════════════════════════════════════════════
// FILTER — pass/reject based on condition
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
// READOUT — numeric display panel
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
// NARRATIVE — text output
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
// COMBINATOR — container device
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
// SPLITTER — passive fan-out (no behavior needed beyond wiring)
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
