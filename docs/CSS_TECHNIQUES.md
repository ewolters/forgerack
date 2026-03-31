# ForgeRack CSS Techniques — Analog Hardware Realism

Concrete techniques for making components feel like physical objects. Every snippet is production-ready — copy into components.css.

---

## Core Rules

1. **Light source: top-left.** Every highlight, shadow, specular — consistent direction. Break this and the whole rack looks wrong.
2. **Depth = layered shadows.** Real objects: tight dark contact shadow + soft wide ambient shadow. Minimum 3 `box-shadow` layers on raised elements.
3. **Nothing flat.** Use `repeating-linear-gradient` at 0.003-0.01 opacity for surface micro-texture. The eye registers it subconsciously.
4. **Color from light, not paint.** Highlights = lighter base + white mix. Shadows = darker base + black mix. Never gray.
5. **Wear tells age.** Patina at 0.005-0.02 opacity. If visible at a glance, halve it.

---

## Metal Surfaces

### Brushed — two offset directional scratches
```css
background:
    repeating-linear-gradient(90deg,
        rgba(255,255,255,0.008) 0px, transparent 1px, transparent 3px),
    repeating-linear-gradient(88deg,
        rgba(0,0,0,0.005) 0px, transparent 1px, transparent 4px),
    linear-gradient(180deg, #3a3d3a, #2e312e);
```
Key: angles differ by 2deg. Opacity under 0.01.

### Anodized — color tint over metal texture
```css
background:
    linear-gradient(135deg, rgba(accent, 0.08), transparent 50%),
    repeating-linear-gradient(180deg,
        rgba(255,255,255,0.003) 0px, transparent 1px, transparent 3px),
    linear-gradient(160deg, #base-dark, #base-mid 50%, #base-dark 80%);
```

### Hammertone — powder coat texture via noise radials
```css
background:
    radial-gradient(ellipse at 20% 30%, rgba(255,255,255,0.015), transparent 10%),
    radial-gradient(ellipse at 60% 70%, rgba(255,255,255,0.01), transparent 8%),
    radial-gradient(ellipse at 80% 20%, rgba(0,0,0,0.02), transparent 12%),
    linear-gradient(160deg, #1a1e1a, #141814);
```

### Tolex / Vinyl — soft texture wrap
```css
background:
    repeating-linear-gradient(180deg,
        rgba(255,255,255,0.004) 0px, transparent 1px, transparent 3px),
    linear-gradient(160deg, #1e1216 0%, #1a0f14 30%, #1c1015 50%, #160c10 80%);
```

---

## Knobs

### Conic lighting — the wrap-around highlight
```css
background:
    radial-gradient(circle at 38% 35%, rgba(255,255,255,0.08), transparent 60%),
    conic-gradient(from 220deg,
        #333833 0%, #444944 20%, #333833 40%, #1e231e 70%, #333833 100%);
border: 2px solid #141814;
box-shadow: 0 3px 6px rgba(0,0,0,0.6), 0 1px 2px rgba(0,0,0,0.4),
            inset 0 1px 0 rgba(255,255,255,0.08);
```

`from 220deg` matches top-left light. The radial at 38%/35% is the specular hotspot.

### Knurled edge — repeating-conic-gradient
```css
.knob::before {
    content: ''; position: absolute; inset: -1px; border-radius: 50%;
    background: repeating-conic-gradient(
        from 0deg, transparent 0deg, transparent 4deg,
        rgba(0,0,0,0.15) 5deg, transparent 6deg);
    pointer-events: none;
}
```

### Position indicator — glowing line
```css
.knob::after {
    width: 2px; height: 9px;
    background: var(--device-accent);
    border-radius: 1px;
    box-shadow: 0 0 6px var(--device-accent-glow), 0 0 2px var(--device-accent);
}
```

---

## LEDs

### Three-layer glow system
```css
/* 1. Lens body with internal refraction */
background: radial-gradient(circle at 40% 35%,
    color-mix(in srgb, var(--color), white 40%), var(--color));

/* 2. Glow corona — tight bright + wide dim */
box-shadow:
    0 0 6px rgba(color, 0.6),
    0 0 14px rgba(color, 0.2);

/* 3. Surface bleed (optional, via parent ::after) */
background: radial-gradient(circle, rgba(color, 0.15), transparent 70%);
```

### Off-state — dark lens, not invisible
```css
background: radial-gradient(circle at 40% 35%, #2a302a, #0e120e);
border: 1px solid #1a1f1a;
box-shadow: inset 0 1px 2px rgba(0,0,0,0.6), 0 1px 0 rgba(255,255,255,0.02);
```

### Pulsing animation
```css
@keyframes led-pulse {
    0%, 100% { box-shadow: 0 0 6px rgba(c,0.8), 0 0 14px rgba(c,0.3); }
    50% { box-shadow: 0 0 4px rgba(c,0.5), 0 0 8px rgba(c,0.15); }
}
```

---

## CRT Screens

### Scanlines — 2px pitch, barely visible
```css
background: repeating-linear-gradient(0deg,
    transparent 0px, rgba(0,0,0,0.05) 1px, transparent 2px);
```

### Phosphor bloom — center glow
```css
background: radial-gradient(ellipse at 50% 50%,
    rgba(accent, 0.015), transparent 70%);
```

### Edge shadow — curved glass vignette
```css
box-shadow: inset 0 0 30px rgba(0,0,0,0.4);
```

### Color-aberration for CRT text (optional, subtle)
```css
text-shadow:
    0 0 4px currentColor,
    2px 0 0 rgba(255,0,255,0.05),
    -2px 0 0 rgba(0,255,255,0.05);
```

### Phosphor types
| Code | Color | Hex | Feel |
|------|-------|-----|------|
| P1 | Green | `#00ff64` | Classic terminal |
| P3 | Amber | `#d97706` | Radar, process control |
| P4 | White | `#c8c8c8` | Lab, data |
| P7 | Blue | `#6496ff` | Long persistence scope |

---

## Screws

### Phillips — two pseudo-elements
```css
.screw {
    background: radial-gradient(circle at 35% 35%, #5a5f5a, #2a2f2a 60%, #1a1f1a);
    border-radius: 50%;
    box-shadow: inset 0 1px 1px rgba(255,255,255,0.1),
                inset 0 -1px 2px rgba(0,0,0,0.5),
                0 1px 2px rgba(0,0,0,0.5);
}
::before { width: 6px; height: 1.5px; background: rgba(0,0,0,0.5); }
::after  { width: 1.5px; height: 6px; background: rgba(0,0,0,0.5); }
```

### Hex socket — clip-path polygon
```css
clip-path: polygon(50% 0%, 93.3% 25%, 93.3% 75%, 50% 100%, 6.7% 75%, 6.7% 25%);
```

### Torx — 6-point star
```css
clip-path: polygon(50% 0%, 63% 25%, 93% 25%, 73% 50%, 83% 80%, 50% 65%, 17% 80%, 27% 50%, 7% 25%, 37% 25%);
```

---

## Engraved Text

### Silk-screen (raised, catches top light)
```css
color: rgba(accent, 0.3);
text-shadow: 0 1px 0 rgba(accent, 0.1);
```

### Engraved (recessed, catches bottom light)
```css
color: transparent;
text-shadow: 0 1px 0 rgba(255,255,255,0.04), 0 -1px 0 rgba(0,0,0,0.3);
-webkit-text-stroke: 0.3px rgba(accent, 0.15);
```

### Stamped serial number — monospace, barely there
```css
font: 600 9px/1 'Courier New', monospace;
color: rgba(255,255,255,0.06);
letter-spacing: 0.06em;
```

---

## Buttons

### Press depth — shadow swap
```css
.btn {
    box-shadow: 0 2px 3px rgba(0,0,0,0.4), inset 0 1px 0 rgba(255,255,255,0.06);
}
.btn:active {
    transform: translateY(1px);
    box-shadow: inset 0 1px 2px rgba(0,0,0,0.3);
}
```

### Guarded danger button — recessed to prevent accidental press
```css
.btn-danger {
    box-shadow: inset 0 1px 3px rgba(0,0,0,0.3), 0 1px 0 rgba(255,255,255,0.02);
}
```

### Toggle illumination ring
```css
.btn-toggle.on {
    border-color: var(--device-accent);
    box-shadow: 0 0 8px var(--device-accent-glow);
    text-shadow: 0 0 6px var(--device-accent-glow);
}
```

---

## VU Needle Meters

### Needle physics — cubic-bezier for overshoot
```css
transition: transform 0.5s cubic-bezier(0.4, 0, 0.2, 1);
```
This gives the needle a slight overshoot and settle — like a real damped mechanical movement.

### Pivot — metal cap at rotation point
```css
background: radial-gradient(circle at 35% 35%, #5a5f5a, #1a1f1a);
box-shadow: 0 1px 2px rgba(0,0,0,0.5);
```

### Face — dark with zone arcs
```css
background: radial-gradient(ellipse at 50% 100%, #1a1e1a, #0d100d 70%);
```

---

## Nixie Tubes

### Ghost cathode — digit '8' behind active value
```css
.digit::before {
    content: '8';
    color: rgba(255,140,50,0.04);
    font-weight: 300;
}
```

### The glow — 3 layers of text-shadow
```css
color: #ff8c32;
text-shadow:
    0 0 6px rgba(255,140,50,0.6),
    0 0 15px rgba(255,100,20,0.3),
    0 0 30px rgba(255,80,10,0.1);
```

### Housing — dark glass
```css
background: #0a0804;
border: 1px solid #1a1510;
box-shadow: inset 0 2px 6px rgba(0,0,0,0.8);
```

---

## Patina Application Guide

| Manufacturer | Scratched | Dusty | Heat | Faded | Oxidized |
|---|---|---|---|---|---|
| Nordkraft | light | light | no | no | no |
| Steelwerk | medium | medium | no | light | no |
| Keysight | no | no | no | no | no |
| Milspec | heavy | medium | no | medium | no |
| Phosphor | light | medium | light | medium | no |
| Klinisch | no | no | no | no | no |
| Cobalt | no | light | no | no | no |
| Vakuum | medium | light | light | light | light |
| Guardian | light | light | no | no | no |
| Tokamak | no | no | light | no | no |

---

## Performance Notes

- `repeating-linear-gradient` at >4 layers = paint cost. Keep textures to 2-3 layers.
- `box-shadow` with large blur radius (>20px) is expensive. LED glow is fine at 14px.
- `conic-gradient` is well-optimized in modern browsers. Use freely.
- `mix-blend-mode: overlay` triggers compositing layer. Only on patina overlays.
- `backdrop-filter: blur()` is very expensive. Avoid or limit to tiny elements.
- `will-change: transform` on animated elements only (needles, pulsing LEDs).
- Pseudo-element budget: 2 per element (::before, ::after). Plan screw crosses carefully.
