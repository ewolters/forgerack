# ForgeRack

Modular instrument rack UI — Reason Studios-style dataflow interface for statistical and manufacturing tools. Demo at `/app/demo/rack/`.

**Owner:** Eric Wolters (eric.wolters@svend.ai)
**Status:** v0.1.0, experimental/demo. NOT replacing production tool pages.
**Stack:** Vanilla JS + CSS, served as pip package into Django (SVEND)

## Quick Start

```bash
# Edit unit template
vim units/strategist/unit.html

# Copy to package + deploy
cp units/<name>/unit.html src/forgerack/templates/forgerack/units/<name>.html
cp js/units.js src/forgerack/static/js/units.js
set -a && source /etc/svend/env && set +a
cd ~/kjerne/services/svend/web && python3 manage.py collectstatic --noinput
```

No venv — system Python. Same env sourcing as Kjerne.

## Architecture

```
units/<name>/unit.html    ← development templates (32 units)
js/units.js               ← all unit behaviors (~6100 lines)
css/components.css         ← primitives + 19 manufacturers (~2770 lines)
src/forgerack/            ← pip package (static + templates copied here for deploy)
docs/                     ← BUILDING_UNITS.md, CSS_TECHNIQUES.md, DESIGN_REFERENCE.md
```

### Unit Pattern

Each unit has a front panel (controls) and back panel (patch jacks). Templates use `${id}` for instance substitution.

```javascript
FR.registerUnit('unit-name', {
    init(el, id) { /* DOM setup, event listeners */ },
    receive(inputName, data) { /* incoming data from patch cable */ },
    getOutput(channel) { /* return current output data */ }
});
```

**Data format:** Columnar `{data: {colName: [values...]}, columns: ['col1', 'col2', ...]}`
**Emission:** `FR.emit(this.id, 'outputName', data)` broadcasts to connected jacks
**LEDs:** `FR.LED(element).set('green|amber|red|blue|accent')` or `.off()`
**Sizing:** 1U=42px, 2U=84px, 4U=168px, 10U=420px

### Server-Side Compute

`/api/rack/compute/` dispatches to forge packages (forgestat, forgedoe, etc.). Registered ops: mean, median, stdev, descriptive, ttest_2sample, pearson, spearman, regression. Units should use server-side compute to guarantee numbers match the ANALYST unit.

### Wiring

SVG cables with cubic Bezier sag. Back panel patch jacks connect outputs to inputs. Tab flips front/back. Session persistence via RackSession model.

## Units (32)

**Data Input:** csv-input, intake
**Processing:** calc, filter, triage, formula, correlator, comparator, probe, analyst (200+ stats), precision (Gage R&R), counter, mixer
**Display:** chart-panel, narrative, readout, spectrum, sentinel (SPC), designer (DOE), strategist (advanced DOE)
**Utility:** combinator, splitter, clock, scribble, mfd, resolver, threshold, router, blank-1u, blank-2u

## Skeuomorphic Design

5 units have full analog treatment: SPECTRUM (Tektronix), SENTINEL (Guardian/Nord), PRECISION (Apothecary), DESIGNER (Meridian), STRATEGIST (Kosmos/Soviet).

### Visual Infrastructure
- SVG feTurbulence filters: brush-grain, brush-grain-fine, matte-noise, screw-metal, wear-scratches/chips/patina/dust
- Warm tungsten light source 130deg (3200K): `rgba(255,240,215,...)`
- Texture classes: tex-brushed (0.05), tex-brushed-fine (0.05), tex-matte (0.06)
- 19 manufacturer identities in CSS (Steelwerk, Keysight, Klinisch, Cobalt, Vakuum, Phosphor, Nordkraft, Milspec, Guardian, Tokamak, Fluke, Tektronix, Kosmos, etc.)

### Design Rules
- Light source top-left, depth = 3-layer shadows
- Knobs: conic gradient, specular at 38%/35%, knurled edge
- LEDs: 3-layer glow (body + sharp + bloom), off = dark lens not invisible
- CRT: scanlines (2px repeating), phosphor bloom, edge shadow
- Screws: Phillips cross via ::before/::after, radial gradient
- Metal tags: stamped greyscale plates with rivets for labels

See `docs/CSS_TECHNIQUES.md` and `docs/DESIGN_REFERENCE.md` for full reference.

## ATLAS Mainframe

Bolted at top of rack. Live process graph, OLR LEDs, CRT readouts, evidence feed. Polls graph + loop APIs every 5 minutes.

## Current State & Next Steps

**Just completed:** STRATEGIST (DSh-K11) — olive powder coat, chickenhead dials, stamped metal tags, recessed inputs, CRT factor list + run sheet. Soviet/Kosmos identity.

**Next up:**
- DESIGNER categorical factor support (3-level factors like Operator)
- SEQUENCER (Kosmos, 3U) — planned
- TOLERANCE (Apothecary, 3U) — planned
- Migrate CORRELATOR + SENTINEL to server-side compute
- Back panel silk-screen text: bump from 5-7px to 8-9px across all units

## SVEND Integration Points

- Sidebar: `~/kjerne/services/svend/web/templates/demo/rack.html` (~80KB)
- Views: `agents_api/rack_views.py`
- Models: `agents_api/models.py` (RackSession)
- URLs: `svend/urls.py`
