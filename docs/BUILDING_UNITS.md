# Building ForgeRack Units

Reference for creating and adding new rack units to the ForgeRack system.

## Architecture

```
~/forgerack/
├── units/<name>/unit.html    ← Source template (development)
├── js/units.js               ← All unit behaviors (single file)
├── css/components.css        ← Component primitives + manufacturer CSS
│
├── src/forgerack/            ← Pip package (distribution)
│   ├── templates/forgerack/units/<name>.html
│   ├── static/js/units.js
│   └── static/css/components.css
│
~/kjerne/.../templates/demo/rack.html  ← Sidebar + mount system
```

## Steps to Add a Unit

### 1. Create the unit folder and template

```
mkdir ~/forgerack/units/<name>/
```

Create `unit.html` with two sections:

```html
<!-- ════════ FRONT PANEL ════════ -->
<div class="rack-unit-front u4 mfr-<manufacturer>" data-unit="<name>" data-id="${id}" style="
    --device-accent:<hex color>;
    background: <texture gradients>;
    overflow:hidden;
">
    <!-- Nameplate bar (top ~30px, right-click here to remove) -->
    <div style="display:flex;align-items:center;gap:8px;padding:4px 48px;
        border-bottom:2px solid rgba(0,0,0,0.3);
        background: linear-gradient(180deg, rgba(<accent>,0.01), rgba(0,0,0,0.1));">
        <div class="led-housing">
            <span class="led" id="${id}-led" style="width:6px;height:6px;"></span>
        </div>
        <span style="font:700 20px/1 ...">Name</span>
        <span style="...">Subtitle</span>
        <div style="margin-left:auto;...">
            <span style="...">MODEL-ID</span>
        </div>
    </div>

    <!-- Main body -->
    <div style="padding:6px 48px;display:flex;gap:10px;height:calc(100% - 36px);">
        <!-- Your controls here -->
    </div>
</div>

<!-- ════════ BACK PANEL ════════ -->
<div class="rack-unit-back u4" data-unit-back="<name>" data-id="${id}" style="
    background: repeating-linear-gradient(180deg, ...), linear-gradient(160deg, #1c1c1c, #1f1f1f 40%, #1d1d1d);
    overflow:hidden;
">
    <div style="display:flex;align-items:center;gap:8px;padding:5px 48px;border-bottom:1px solid rgba(255,255,255,0.05);">
        <span style="font:700 11px/1 ...;color:rgba(255,255,255,0.1);">Name</span>
        <span style="font:400 11px/1 'Courier New',monospace;color:rgba(255,255,255,0.06);">MODEL-ID</span>
        <span style="...;margin-left:auto;">S/N ${id}</span>
    </div>
    <div style="padding:10px 48px;">
        <div style="font:700 10px/1 'Arial',sans-serif;color:rgba(255,255,255,0.07);text-transform:uppercase;letter-spacing:0.2em;margin-bottom:10px;">Signal</div>
        <div style="display:flex;gap:18px;">
            <div class="patch-group"><div class="patch-jack" data-input="data" data-unit-id="${id}"></div><div class="patch-jack-label">data in</div></div>
            <div class="patch-group"><div class="patch-jack" data-output="result" data-unit-id="${id}"></div><div class="patch-jack-label">result</div></div>
        </div>
    </div>
</div>
```

**Key rules:**
- `${id}` is replaced at mount time with a unique instance ID (e.g., `calc_3`)
- Front panel: `data-unit="<name>"` must match the JS registration name
- Back panel: `data-unit-back="<name>"` and jacks use `data-input`/`data-output` + `data-unit-id="${id}"`
- `padding: ... 48px` on content rows leaves room for the rack rail bolts
- Height classes: `u1`=42px, `u2`=84px, `u3`=126px, `u4`=168px, `u5`=210px, `u6`=252px, `u8`=336px, `u10`=420px

### 2. Register the unit behavior

In `~/forgerack/js/units.js`, add before the closing `})(ForgeRack);`:

```javascript
FR.registerUnit('<name>', {
    init(el, id) {
        this.el = el;       // front panel DOM element
        this.id = id;       // unique instance ID
        // Wire up event listeners here
    },

    receive(inputName, data) {
        // Called when data arrives on any input jack
        // inputName = the jack's data-input attribute value
        // data = whatever the upstream unit emitted
    },

    getOutput(channel) {
        // Optional: return current data for a named output jack
        // Called by the wiring system for pull-mode queries
        return null;
    }
});
```

**Data format convention:**
Columnar data flows as `{data: {colName: [values...]}, columns: ['col1', 'col2', ...]}`.

**Emitting data:**
```javascript
FR.emit(this.id, 'result', data);   // outputName must match back panel jack
```

**LED control:**
```javascript
FR.LED(document.getElementById(this.id + '-led')).set('green');  // green|amber|red|blue|accent
FR.LED(document.getElementById(this.id + '-led')).off();
```

### 3. Add to the sidebar

In `~/kjerne/services/svend/web/templates/demo/rack.html`, add a sidebar item inside the appropriate group:

```html
<div class="rack-sidebar-item" data-unit="<name>" onclick="mountUnit(this)">
    <span class="rack-sidebar-dot" style="background:<accent color>;"></span>
    Display Name
    <span class="rack-sidebar-count"></span>
</div>
```

**Sidebar groups:** Data, Displays, Processors, Containers. Add new groups as needed.

### 4. (Optional) Create or assign a manufacturer

In `~/forgerack/css/components.css`, add a manufacturer block:

```css
/* ── MFR: BRANDNAME (Aesthetic description)
 *    Used by: UNIT_NAME, future xyz units
 *    Concise visual identity description.
 */
.mfr-brandname .dial-knob {
    background:
        radial-gradient(circle at 38% 35%, rgba(<accent>,0.06), transparent 50%),
        conic-gradient(from 220deg, <dark> 0%, <mid> 20%, <dark> 40%, <darker> 70%, <dark> 100%);
    border-color: <border>;
}
.mfr-brandname .dial-knob::after { background: <pointer color>; }
.mfr-brandname .segment-btn { background: rgba(<accent>,0.04); color: rgba(<accent>,0.3); }
.mfr-brandname .segment-btn.active { background: rgba(<accent>,0.12); color: <accent>; }
.mfr-brandname .led { border-color: <border>; }
```

Then add `mfr-brandname` class to the front panel div.

### 5. Copy to pip package and deploy

```bash
# Copy unit template
cp ~/forgerack/units/<name>/unit.html ~/forgerack/src/forgerack/templates/forgerack/units/<name>.html

# Copy shared files (always — they contain all units)
cp ~/forgerack/js/units.js ~/forgerack/src/forgerack/static/js/units.js
cp ~/forgerack/css/components.css ~/forgerack/src/forgerack/static/css/components.css

# Install and collect
cd ~/forgerack && pip install -e .
set -a && source /etc/svend/env && set +a
cd ~/kjerne/services/svend/web && python3 manage.py collectstatic --noinput

# Commit and push
cd ~/forgerack && git add -A && git commit -m "..." && git push
```

## Available Components (CSS classes)

### Primitives
| Class | Description |
|-------|-------------|
| `.led` | 10px status LED (`.lg` = 14px) |
| `.led.on-green/amber/red/blue` | Active LED colors |
| `.led-housing` | Mounting ring for LEDs |
| `.dial` + `.dial-knob` | Rotary knob (32px default, 24px small) |
| `.switch-rocker` | Toggle switch |
| `.switch-slide` | Slide switch |
| `.segment` + `.segment-btn` | Segmented button group |
| `.btn-metal` | Metal momentary button |
| `.btn-action` | Green-tinted action button |
| `.btn-ghost` | Minimal outline button |
| `.panel-recessed` | Recessed control housing |
| `.patch-jack` | Back-panel patch point |
| `.patch-jack-label` | Label below patch jack |
| `.patch-group` | Jack + label wrapper |
| `.input-mono` | Monospace text input |
| `.crt-scanlines` | CRT scanline overlay |

### LCD Displays
Use the calculator-style green-gray LCD pattern:
```html
<div style="background:linear-gradient(180deg, #9aaa8a, #8a9a7a);
    border:2px solid #2a2a2a;border-radius:2px;
    box-shadow:inset 0 1px 3px rgba(0,0,0,0.25);
    padding:4px 3px;text-align:right;position:relative;overflow:hidden;">
    <!-- Glass reflection -->
    <div style="position:absolute;inset:0;background:linear-gradient(180deg,
        rgba(255,255,255,0.06),transparent 40%,rgba(0,0,0,0.04));pointer-events:none;"></div>
    <div style="position:relative;">
        <!-- Ghost digits -->
        <div style="font:700 18px/1 'JetBrains Mono',monospace;color:rgba(40,50,35,0.08);">888.88</div>
        <!-- Active value -->
        <div id="${id}-value" style="font:700 18px/1 'JetBrains Mono',monospace;color:#0a1208;
            position:absolute;inset:0;text-align:right;">—</div>
    </div>
</div>
```

### CRT Display
Amber or green CRT with scanlines:
```html
<div style="background:rgba(0,0,0,0.3);border:1px solid rgba(0,0,0,0.5);border-radius:2px;
    box-shadow:inset 0 2px 6px rgba(0,0,0,0.4);position:relative;overflow:hidden;">
    <div class="crt-scanlines"></div>
    <div style="position:absolute;inset:0;
        background:radial-gradient(ellipse at center, rgba(<accent>,0.01), transparent 80%);
        pointer-events:none;z-index:2;"></div>
    <div id="${id}-log" style="padding:5px 8px;font:11px/1.6 'JetBrains Mono',monospace;
        color:rgba(<accent>,0.35);position:relative;z-index:1;">
    </div>
</div>
```

## Manufacturers Registry

| Class | Name | Style | Used By |
|-------|------|-------|---------|
| `mfr-nordkraft` | Nordkraft | Scandinavian warm birch, B&O | MANIFOLD |
| `mfr-steelwerk` | Steelwerk | East German industrial, cold gray | INGEST, REGISTER |
| `mfr-keysight` | Keysight | Test & measurement, cyan | SIEVE |
| `mfr-milspec` | Milspec | Military olive drab, Impact font | CRATE |
| `mfr-phosphor` | Phosphor | Green CRT, vintage terminal | HERALD, SCOPE |
| `mfr-klinisch` | Klinisch | Clinical sage-olive, cream | TRIAGE |
| `mfr-cobalt` | Cobalt | Blue-gray data workstation | INTAKE |
| `mfr-vakuum` | Vakuum | Burgundy tube amp, copper, serif | CALC |

## Unit Registry

| Sidebar Name | data-unit | Model | Mfr | U-Height | Jacks In | Jacks Out |
|-------------|-----------|-------|-----|----------|----------|-----------|
| Intake | `intake` | IO-200 | Cobalt | 10U | — | per-column, full |
| CSV Input | `csv-input` | DT-100 | Steelwerk | 4U | — | per-column, full |
| Triage | `triage` | TR-200 | Klinisch | 5U | data | clean |
| Filter | `filter` | FG-02 | Keysight | 5U | data | pass, reject |
| Calc | `calc` | TX-01 | Vakuum | 4U | data | result |
| Chart Panel | `chart-panel` | LS-800 | Phosphor | 10U | data | — |
| Register | `readout` | RD-04 | Steelwerk | 2U | values | — |
| Narrative | `narrative` | TT-01 | Phosphor | 4U | text | — |
| Splitter | `splitter` | SP-04 | Nordkraft | 2U | signal | a, b, c, d |
| Combinator | `combinator` | CM-01 | Milspec | 3U | signal | — |
