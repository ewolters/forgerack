/**
 * CSV Input — parses pasted data into columns, creates output jacks.
 */
ForgeRack.registerUnit('csv-input', {
    init(el, id) {
        this.el = el;
        this.id = id;
        this.data = {};    // {colName: [values]}
        this.columns = [];
    },

    parse() {
        const raw = document.getElementById(`${this.id}-data`).value.trim();
        if (!raw) return;

        const lines = raw.split('\n').map(l => l.trim()).filter(Boolean);
        if (lines.length < 2) {
            // Single column — no header
            const vals = raw.split(/[\n,\s]+/).map(Number).filter(v => !isNaN(v));
            this.data = { 'data': vals };
            this.columns = ['data'];
        } else {
            // Try CSV with header
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
                        this.data[h].push(isNaN(v) ? vals[j]?.trim() : v);
                    });
                }
            } else {
                // No header, single column
                const vals = raw.split(/[\n,\s]+/).map(Number).filter(v => !isNaN(v));
                this.data = { 'data': vals };
                this.columns = ['data'];
            }
        }

        this._render();
        this._emit('parsed', { columns: this.columns, data: this.data });
    },

    demo() {
        // Bearing bore diameter dataset
        const demo = '25.02,24.98,25.01,24.97,25.03,25.00,24.99,25.02,24.96,25.01,25.04,24.98,25.00,25.01,24.99,25.03,24.97,25.02,25.00,24.98,25.01,24.99,25.05,25.02,24.96,25.08,25.03,25.01,24.97,25.00';
        document.getElementById(`${this.id}-data`).value = demo;
        this.parse();
    },

    _render() {
        const n = this.columns.length > 0 ? this.data[this.columns[0]].length : 0;
        document.getElementById(`${this.id}-n`).textContent = n;
        ForgeRack.LED(document.getElementById(`${this.id}-led`)).set(n > 0 ? 'green' : false);

        // Column chips
        const colsEl = document.getElementById(`${this.id}-cols`);
        colsEl.style.display = 'block';
        colsEl.innerHTML = this.columns.map(c =>
            `<span style="display:inline-block;padding:1px 6px;margin:1px;background:rgba(156,163,175,0.08);border:1px solid rgba(156,163,175,0.12);border-radius:2px;font-size:9px;">${c}</span>`
        ).join('');

        // Output jacks — one per column
        const jacks = document.getElementById(`${this.id}-jacks`);
        jacks.innerHTML = this.columns.map(c =>
            `<div class="patch-group"><div class="jack connected" data-output="${c}"></div><span style="font-size:7px;color:var(--text-label);">${c}</span></div>`
        ).join('');
    },

    _emit(event, detail) {
        this.el.dispatchEvent(new CustomEvent(`unit:${event}`, { detail, bubbles: true }));
    },

    getOutput(column) {
        return this.data[column] || [];
    },

    getAllData() {
        return this.data;
    }
});
