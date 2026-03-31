# ForgeRack Design Reference

Skeuomorphic rack-mount instrument design language. Primary inspiration: Reason Studios (Propellerhead Reason).

## Reason Studios Patterns

### Panel Finishes

Each device has a distinct material identity. Never repeat a finish between devices.

| Device | Finish | Base Color | Accent |
|--------|--------|------------|--------|
| SubTractor | Warm matte gray, slight olive undertone | `#7a7a78` | Muted teal stripe |
| Malstrom | Dark charcoal, industrial texture | `#2d2d30` | Orange-red `#cc4422` |
| Thor | Dark gunmetal, premium density | `#3a3a3e` | Gold/amber `#c8a832` |
| RV7000 | Medium blue-gray, clean | `#4a5060` | Blue LEDs, white labels |
| Scream 4 | Dark olive/military | `#3a4030` | Yellow-orange `#d4a020` |
| MClass Suite | Light silver/platinum | `#c8c8c4` | Black text, subtle LEDs |
| Combinator | Dark leather brown-black | `#2a2420` | Configurable |
| Kong | Red-black, aggressive | `#2a1a1a` | Red `#cc2222` |
| Neptune | Deep blue-black | `#1a2030` | Cyan accents |
| Pulveriser | Dark industrial gray | `#2a2a2c` | Orange-amber warning |

### ForgeRack Device Map

| Unit | Finish | Base | Accent | Identity |
|------|--------|------|--------|----------|
| INGEST DT-100 | Brushed steel, aged | `#141714` | Gray `#9ca3af` | East German terminal |
| SCOPE LS-800 | Dark instrument black | `#0b0e0b` | Green `#4ade80` | Oscilloscope |
| SIEVE FG-01 | Dark cyan-tinted | `#0d1314` | Cyan `#22d3ee` | Keysight analyzer |
| MANIFOLD SP-04 | Warm birch/off-white | `#2a2720` | Muted stone `#78716c` | Bang & Olufsen |
| HERALD TT-01 | Near-black | `#090b09` | Green phosphor `#22c55e` | 1970s teletype |
| REGISTER RD-04 | Dark slate | `#0f110f` | Cool white `#e2e8f0` | Cockpit gauges |
| CRATE CM-01 | Crosshatch olive drab | `#141311` | Warm stone `#78716c` | Pelican case |
| TRIAGE TR-200 | Warm olive-sage, LIGHTER | `#4a5040` | Cream `#b8a878` | Clinical lab |

### Typography

**Section headers:** 700 weight, 9-10px, uppercase, 0.15-0.25em letter-spacing. Condensed sans-serif (Arial, Helvetica Neue).

**Parameter labels:** 600 weight, 7-8px, uppercase, 0.06-0.1em letter-spacing. Below controls.

**Brand/model names:** Range from engraved (transparent + text-shadow) to painted cream to Courier monospace. Each device picks ONE style.

**Display text:** JetBrains Mono or Courier New. 11-13px for readouts. Green phosphor `rgba(74,222,128,0.3-0.55)` for CRT, cream `rgba(220,210,180,0.4)` for clinical.

**7-segment values:** JetBrains Mono 700 weight, 22-28px. Ghost digits behind at 0.02-0.04 opacity.

### Knobs

**Large (32px):** Conic gradient with specular highlight at 10 o'clock. 2px dark border. Pointer line from center to edge in device accent color with glow. Drop shadow 3px.

**Small (24px):** Same treatment, shorter pointer. Used for less-accessed parameters.

**Knob well:** Subtle inset shadow around knob housing. Arc position markers (tick marks) at 270-degree sweep for min/max.

### LEDs

**Off:** Dark glassy dome, radial gradient (`#2a302a` → `#0e120e`). 1px border `#1a1f1a`.

**On:** Bright radial gradient (lighter center → saturated edge). Double glow: 6px sharp + 14px soft bloom. Colors:
- Green: `#6ef59e` → `#18a34a`
- Amber: `#fcd34d` → `#b45309`
- Red: `#fca5a5` → `#b91c1c`
- Blue: `#93c5fd` → `#1d4ed8`

### Buttons

**Momentary (press):** 3D bevel, translateY(1px) on mousedown. Light gradient top-to-bottom. Inset highlight on top edge, drop shadow on bottom.

**Segment (radio):** Row of rectangular buttons in a recessed border. Active state gets accent background + text-shadow glow + inset shadow.

**Rocker switch:** Vertical 16x24px toggle. Off: gradient down. On: gradient reversed + accent bar at top via ::after.

### Displays

**CRT screen:** Background `#020402`. Triple overlay: scanlines (repeating 2px linear-gradient), phosphor bloom (radial gradient), edge shadow (inset box-shadow 30px). Text in phosphor color with glow.

**7-segment window:** Background `#030503`, heavy inset shadow. Ghost "888" behind actual value at 0.02 opacity. Value text-shadow glow at 0.1-0.2 opacity.

**Settings CRT:** Smaller, monospace, lower opacity. MODE/PTS/SRC format. Scanlines + bloom overlays.

### Panels

**Recessed dark:** `rgba(0,0,0,0.2-0.3)`, 1px solid `rgba(0,0,0,0.35-0.45)`, 2px border-radius. `inset 0 2px 4px rgba(0,0,0,0.3)` + bottom highlight `0 1px 0 rgba(255,255,255,0.006)`.

**Bare metal (lighter):** `linear-gradient(180deg, #3a3d3a, #2e312e)`. 1px solid `rgba(0,0,0,0.5)`. Inset shadow top + highlight bottom. Dark or cream text depending on device.

**Olive/clinical:** `linear-gradient(180deg, #5a6050, #4e5446)`. Same inset pattern. Cream text `rgba(220,210,180,0.6)`.

### Back Panel

**Background:** Uniform medium gray (`#1c1c1c` → `#1f1f1f`). Fine vertical brushed texture.

**Patch jacks:** 16px circles, dark radial gradient, 2px border. Hover: accent border + glow. Connected: green border + bloom. Labels below in 9px uppercase.

**Jack groups:** flex row, 18px gap. Section labels in 10px uppercase, 0.2em letter-spacing.

**Silk-screen text:** 7px Courier New at 0.04-0.05 opacity. Model info, specs, copyright. Line height 1.8.

### Rack Frame

**Rails:** Absolute overlays, 48px wide. Score lines every 42px (1U grid).

**Screws:** 10px circles, radial gradient with specular at 35%/35%. Phillips cross via ::before + ::after pseudo-elements. Inset highlight + drop shadow.

**Panel bevel:** Every rack-unit-front gets `border-top: 1px solid rgba(255,255,255,0.04)` and `border-bottom: 1px solid rgba(0,0,0,0.4)`.

### Cables

**Rendering:** SVG bezier curves with downward sag. Control points below midpoint for gravity droop. Sag proportional to horizontal distance.

**Colors:** Cycle through `['#4ade80','#60a5fa','#fbbf24','#f87171','#a78bfa','#22d3ee','#fb923c','#e879f9']`.

**Interaction:** Click jack to start cable, click another to complete. Right-click connected jack to disconnect. Escape cancels pending.

## Design Rules

1. **Every device must be visually distinct.** Different base color, different accent, different personality.
2. **Nothing is flat.** Every element has shadow, bevel, gradient, or texture.
3. **Labels are small but readable.** 7-10px, uppercase, letterspaced. Opacity 0.3-0.7 depending on importance.
4. **Controls sit in recessed wells.** Groups of related controls share a recessed panel.
5. **Lighter panels = different material.** Bare metal, clinical, platinum — contrast against the dark rack.
6. **Cream for clinical, green for CRT, white for technical.** Text color matches device identity.
7. **LEDs tell the story.** System state visible at a glance from LED colors.
8. **Back panel is utilitarian.** Gray, jacks, labels, silk-screen specs. No decoration.
