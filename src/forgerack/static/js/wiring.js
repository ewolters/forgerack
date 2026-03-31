/**
 * ForgeRack — Cable Wiring System
 *
 * Click a jack to start a cable. Click another jack to complete.
 * SVG bezier curves render between connected jacks.
 * Data flows through cables when source units emit.
 *
 * Features:
 * - Cables colored by source unit accent
 * - Animated signal dots on data flow
 * - Hover tooltips showing data shape
 * - Right-click cable or jack to disconnect
 */
(function(FR) {
'use strict';

// Cable state
const cables = [];
let pendingJack = null;
let pendingSvgLine = null;
let svgLayer = null;

// Track last data that flowed through each cable for tooltips
const _cableData = {};

// ── Unit accent color map ──
const _UNIT_ACCENTS = {
    'intake':      '#7ca0c4',
    'csv-input':   '#9ca3af',
    'filter':      '#22d3ee',
    'triage':      '#b8a878',
    'calc':        '#d4884a',
    'readout':     '#e2e8f0',
    'chart-panel': '#4ade80',
    'narrative':   '#22c55e',
    'splitter':    '#78716c',
    'combinator':  '#78716c'
};

// ── Resolve unit ID from a jack element ──

function _resolveUnitId(jack) {
    var uid = jack.dataset.unitId;
    if (uid && uid !== '${id}' && uid !== '') return uid;

    var unitEl = jack.closest('[data-id]');
    if (unitEl) {
        uid = unitEl.dataset.id;
        if (uid && uid !== '${id}' && uid !== '') return uid;
    }

    var keys = Object.keys(FR.units);
    for (var i = 0; i < keys.length; i++) {
        var unit = FR.units[keys[i]];
        if (unit.el && unit.el.contains(jack)) return keys[i];
    }

    var backEl = jack.closest('[data-unit-back]');
    if (backEl) {
        var backType = backEl.dataset.unitBack;
        var backId = backEl.dataset.id;
        if (backId && backId !== '${id}') return backId;
        for (var j = 0; j < keys.length; j++) {
            var u = FR.units[keys[j]];
            if (u.el && u.el.dataset.unit === backType) return keys[j];
        }
    }

    console.warn('[ForgeRack] Could not resolve unit ID for jack:', jack);
    return 'unknown';
}

// ── Get unit type from unit ID ──
function _unitType(unitId) {
    var unit = FR.units[unitId];
    if (unit && unit.el) return unit.el.dataset.unit || '';
    return '';
}

// ── Event bus for unit-to-unit data flow ──

const listeners = {};

FR._listeners = listeners;
FR._cables = cables;

FR.emit = function(unitId, outputName, data) {
    const key = unitId + ':' + outputName;
    var linkList = listeners[key] || [];

    // Trigger signal animation on cables from this output
    cables.forEach(function(cable, idx) {
        if (cable.source.unitId === unitId && cable.source.output === outputName) {
            _storeCableData(idx, data);
            _animateCable(idx);
        }
    });

    linkList.forEach(function(link) {
        const target = FR.units[link.targetUnitId];
        if (target && target.receive) {
            target.receive(link.targetInput, data, unitId);
        }
    });
};

function _storeCableData(idx, data) {
    if (data && data.data && data.columns) {
        _cableData[idx] = {
            columns: data.columns.length,
            rows: (data.data[data.columns[0]] || []).length,
            type: 'dataset',
            colNames: data.columns.slice(0, 6)
        };
    } else if (Array.isArray(data)) {
        _cableData[idx] = { columns: 1, rows: data.length, type: 'array' };
    } else if (typeof data === 'string') {
        _cableData[idx] = { type: 'text', length: data.length };
    }
}

FR.connect = function(sourceUnitId, sourceOutput, targetUnitId, targetInput) {
    const key = sourceUnitId + ':' + sourceOutput;
    if (!listeners[key]) listeners[key] = [];
    listeners[key].push({ targetUnitId: targetUnitId, targetInput: targetInput });

    cables.push({
        source: { unitId: sourceUnitId, output: sourceOutput },
        target: { unitId: targetUnitId, input: targetInput },
    });

    _renderCables();

    // Immediately push existing data
    var source = FR.units[sourceUnitId];
    if (source && source.getOutput) {
        var existingData = source.getOutput(sourceOutput);
        if (existingData && (Array.isArray(existingData) ? existingData.length > 0 : true)) {
            var target = FR.units[targetUnitId];
            if (target && target.receive) {
                var idx = cables.length - 1;
                _storeCableData(idx, existingData);
                target.receive(targetInput, existingData, sourceUnitId);
                _animateCable(idx);
            }
        }
    }
};

// ── SVG cable rendering ──

function _ensureSvgLayer() {
    if (svgLayer) return svgLayer;
    let overlay = document.querySelector('.forge-rack-cables');
    if (!overlay) {
        overlay = document.createElement('div');
        overlay.className = 'forge-rack-cables';
        overlay.innerHTML = '<svg style="width:100%;height:100%;overflow:visible;"></svg>';
        const rackBack = document.getElementById('rackBack');
        if (rackBack) {
            rackBack.style.position = 'relative';
            rackBack.appendChild(overlay);
        }
    }
    svgLayer = overlay.querySelector('svg');
    return svgLayer;
}

function _getJackCenter(jackEl) {
    const rect = jackEl.getBoundingClientRect();
    const parent = jackEl.closest('.rack-back, .mainframe-rear, .forge-rack-cables');
    const pRect = parent ? parent.getBoundingClientRect() : { left: 0, top: 0 };
    return {
        x: rect.left - pRect.left + rect.width / 2,
        y: rect.top - pRect.top + rect.height / 2
    };
}

function _bezierPath(x1, y1, x2, y2) {
    const dy = Math.abs(y2 - y1);
    const dx = Math.abs(x2 - x1);
    const sag = Math.min(60, Math.max(20, dx * 0.3 + dy * 0.2));
    const midY = Math.max(y1, y2) + sag;
    return 'M' + x1 + ',' + y1 + ' C' + x1 + ',' + midY + ' ' + x2 + ',' + midY + ' ' + x2 + ',' + y2;
}

// ── Cable color by source unit accent ──

function _cableColorForUnit(unitId) {
    var type = _unitType(unitId);
    return _UNIT_ACCENTS[type] || '#4ade80';
}

function _renderCables() {
    const svg = _ensureSvgLayer();
    if (!svg) return;

    svg.innerHTML = '';

    cables.forEach(function(cable, i) {
        const sourceJack = document.querySelector(
            '[data-output="' + cable.source.output + '"][data-unit-id="' + cable.source.unitId + '"]'
        ) || document.querySelector(
            '.patch-jack[data-output="' + cable.source.output + '"]'
        );
        const targetJack = document.querySelector(
            '[data-input="' + cable.target.input + '"][data-unit-id="' + cable.target.unitId + '"]'
        ) || document.querySelector(
            '.patch-jack[data-input="' + cable.target.input + '"]'
        );

        if (!sourceJack || !targetJack) return;

        const p1 = _getJackCenter(sourceJack);
        const p2 = _getJackCenter(targetJack);
        var color = _cableColorForUnit(cable.source.unitId);
        var pathD = _bezierPath(p1.x, p1.y, p2.x, p2.y);

        // Group: shadow + cable + glow + hit area
        var g = document.createElementNS('http://www.w3.org/2000/svg', 'g');
        g.setAttribute('class', 'forge-cable-group');
        g.dataset.cableIndex = i;

        // Shadow
        var shadow = document.createElementNS('http://www.w3.org/2000/svg', 'path');
        shadow.setAttribute('d', pathD);
        shadow.setAttribute('fill', 'none');
        shadow.setAttribute('stroke', 'rgba(0,0,0,0.4)');
        shadow.setAttribute('stroke-width', '4.5');
        shadow.setAttribute('stroke-linecap', 'round');
        g.appendChild(shadow);

        // Main cable
        var path = document.createElementNS('http://www.w3.org/2000/svg', 'path');
        path.setAttribute('d', pathD);
        path.setAttribute('fill', 'none');
        path.setAttribute('stroke', color);
        path.setAttribute('stroke-width', '2.5');
        path.setAttribute('stroke-linecap', 'round');
        path.setAttribute('class', 'forge-cable-path');
        path.id = 'cable-path-' + i;
        g.appendChild(path);

        // Subtle glow
        var glow = document.createElementNS('http://www.w3.org/2000/svg', 'path');
        glow.setAttribute('d', pathD);
        glow.setAttribute('fill', 'none');
        glow.setAttribute('stroke', color);
        glow.setAttribute('stroke-width', '7');
        glow.setAttribute('stroke-linecap', 'round');
        glow.setAttribute('opacity', '0.06');
        g.appendChild(glow);

        // Fat invisible hit area for hover/click
        var hitArea = document.createElementNS('http://www.w3.org/2000/svg', 'path');
        hitArea.setAttribute('d', pathD);
        hitArea.setAttribute('fill', 'none');
        hitArea.setAttribute('stroke', 'transparent');
        hitArea.setAttribute('stroke-width', '14');
        hitArea.setAttribute('stroke-linecap', 'round');
        hitArea.style.pointerEvents = 'stroke';
        hitArea.style.cursor = 'pointer';
        hitArea.dataset.cableIndex = i;
        hitArea.classList.add('forge-cable-hit');
        g.appendChild(hitArea);

        svg.appendChild(g);

        sourceJack.classList.add('connected');
        targetJack.classList.add('connected');
    });
}

// ── Signal flow animation — glowing dots travel along cable ──

function _animateCable(cableIndex) {
    var svg = _ensureSvgLayer();
    if (!svg) return;

    var pathEl = document.getElementById('cable-path-' + cableIndex);
    if (!pathEl) return;

    var cable = cables[cableIndex];
    if (!cable) return;
    var color = _cableColorForUnit(cable.source.unitId);

    // 3 staggered signal dots
    for (var d = 0; d < 3; d++) {
        (function(delay) {
            var dot = document.createElementNS('http://www.w3.org/2000/svg', 'circle');
            dot.setAttribute('r', '3');
            dot.setAttribute('fill', color);
            dot.setAttribute('opacity', '0');
            dot.setAttribute('filter', 'url(#dot-glow-' + cableIndex + ')');

            // Motion along path
            var anim = document.createElementNS('http://www.w3.org/2000/svg', 'animateMotion');
            anim.setAttribute('dur', '0.7s');
            anim.setAttribute('begin', delay + 's');
            anim.setAttribute('fill', 'freeze');
            anim.setAttribute('repeatCount', '1');
            var mpath = document.createElementNS('http://www.w3.org/2000/svg', 'mpath');
            mpath.setAttributeNS('http://www.w3.org/1999/xlink', 'href', '#cable-path-' + cableIndex);
            anim.appendChild(mpath);
            dot.appendChild(anim);

            // Fade in-out
            var fade = document.createElementNS('http://www.w3.org/2000/svg', 'animate');
            fade.setAttribute('attributeName', 'opacity');
            fade.setAttribute('values', '0;0.95;0.95;0');
            fade.setAttribute('keyTimes', '0;0.15;0.75;1');
            fade.setAttribute('dur', '0.7s');
            fade.setAttribute('begin', delay + 's');
            fade.setAttribute('fill', 'freeze');
            dot.appendChild(fade);

            // Size pulse
            var pulse = document.createElementNS('http://www.w3.org/2000/svg', 'animate');
            pulse.setAttribute('attributeName', 'r');
            pulse.setAttribute('values', '2;4;2');
            pulse.setAttribute('dur', '0.7s');
            pulse.setAttribute('begin', delay + 's');
            pulse.setAttribute('fill', 'freeze');
            dot.appendChild(pulse);

            svg.appendChild(dot);
            setTimeout(function() { if (dot.parentNode) dot.remove(); }, (delay + 0.8) * 1000);
        })(d * 0.12);
    }

    // Brief cable flash
    if (pathEl) {
        var orig = pathEl.getAttribute('stroke-width');
        pathEl.setAttribute('stroke-width', '3.5');
        pathEl.style.filter = 'drop-shadow(0 0 6px ' + color + ')';
        setTimeout(function() {
            pathEl.setAttribute('stroke-width', orig || '2.5');
            pathEl.style.filter = '';
        }, 350);
    }
}

// ── Cable hover tooltip ──

var _tooltip = null;

function _showCableTooltip(e, cableIndex) {
    var info = _cableData[cableIndex];
    var cable = cables[cableIndex];
    if (!cable) return;

    var srcType = (_unitType(cable.source.unitId) || cable.source.unitId).toUpperCase();
    var tgtType = (_unitType(cable.target.unitId) || cable.target.unitId).toUpperCase();

    var text = srcType + ' \u2192 ' + tgtType + '\n';
    text += cable.source.output + ' \u2192 ' + cable.target.input + '\n';

    if (info) {
        if (info.type === 'dataset') {
            text += info.columns + ' cols \u00b7 ' + info.rows + ' rows';
            if (info.colNames && info.colNames.length > 0) {
                text += '\n' + info.colNames.join(', ');
                if (info.columns > info.colNames.length) text += ' \u2026';
            }
        } else if (info.type === 'array') {
            text += info.rows + ' values';
        } else if (info.type === 'text') {
            text += 'text (' + info.length + ' chars)';
        }
    } else {
        text += '(no data yet)';
    }

    if (!_tooltip) {
        _tooltip = document.createElement('div');
        _tooltip.style.cssText = 'position:fixed;z-index:10001;' +
            'background:#1a1a1a;border:1px solid rgba(255,255,255,0.15);border-radius:4px;' +
            'padding:6px 10px;font:10px/1.4 "JetBrains Mono",monospace;color:#e8efe8;' +
            'box-shadow:0 4px 12px rgba(0,0,0,0.6);pointer-events:none;white-space:pre;max-width:280px;';
        document.body.appendChild(_tooltip);
    }
    _tooltip.textContent = text;
    _tooltip.style.display = '';
    _tooltip.style.left = (e.clientX + 12) + 'px';
    _tooltip.style.top = (e.clientY - 10) + 'px';
}

function _hideCableTooltip() {
    if (_tooltip) _tooltip.style.display = 'none';
}

// ── Interactive jack clicking ──

function _initJackInteraction() {
    document.addEventListener('click', function(e) {
        if (e.target.closest('.rack-back, .rack-unit-back, [data-unit-back]')) {
            console.log('[ForgeRack] Back panel click:', e.target.tagName, e.target.className, e.target);
        }

        const jack = e.target.closest('.patch-jack, .jack');
        if (!jack) {
            if (pendingJack) {
                pendingJack.classList.remove('pending');
                pendingJack.style.boxShadow = '';
                pendingJack = null;
                if (pendingSvgLine) { pendingSvgLine.remove(); pendingSvgLine = null; }
            }
            return;
        }

        const unitId = _resolveUnitId(jack);
        const output = jack.dataset.output;
        const input = jack.dataset.input;

        if (!pendingJack) {
            pendingJack = jack;
            jack.classList.add('pending');
            jack.style.boxShadow = '0 0 8px rgba(74,222,128,0.5)';
        } else {
            const firstUnitId = _resolveUnitId(pendingJack);
            const firstOutput = pendingJack.dataset.output;
            const firstInput = pendingJack.dataset.input;

            let srcId, srcOut, tgtId, tgtIn;

            if (firstOutput && input) {
                srcId = firstUnitId; srcOut = firstOutput;
                tgtId = unitId; tgtIn = input;
            } else if (firstInput && output) {
                srcId = unitId; srcOut = output;
                tgtId = firstUnitId; tgtIn = firstInput;
            } else {
                console.warn('[ForgeRack] Cannot wire: both jacks are same direction');
                pendingJack.classList.remove('pending');
                pendingJack.style.boxShadow = '';
                pendingJack = null;
                return;
            }

            FR.connect(srcId, srcOut, tgtId, tgtIn);

            pendingJack.classList.remove('pending');
            pendingJack.style.boxShadow = '';
            pendingJack = null;
        }
    });

    // Cable hover tooltips
    document.addEventListener('mouseover', function(e) {
        var hit = e.target.closest('.forge-cable-hit');
        if (hit) _showCableTooltip(e, parseInt(hit.dataset.cableIndex));
    });
    document.addEventListener('mousemove', function(e) {
        if (_tooltip && _tooltip.style.display !== 'none') {
            _tooltip.style.left = (e.clientX + 12) + 'px';
            _tooltip.style.top = (e.clientY - 10) + 'px';
        }
    });
    document.addEventListener('mouseout', function(e) {
        if (e.target.closest('.forge-cable-hit')) _hideCableTooltip();
    });

    // Right-click cable to disconnect
    document.addEventListener('contextmenu', function(e) {
        var hit = e.target.closest('.forge-cable-hit');
        if (hit) {
            e.preventDefault();
            var idx = parseInt(hit.dataset.cableIndex);
            var cable = cables[idx];
            if (cable) {
                FR.disconnect(cable.source.unitId, cable.source.output, cable.target.unitId, cable.target.input);
                _hideCableTooltip();
            }
        }
    });
}

// ── Disconnect ──

FR.disconnect = function(sourceUnitId, sourceOutput, targetUnitId, targetInput) {
    for (var i = cables.length - 1; i >= 0; i--) {
        var c = cables[i];
        if (c.source.unitId === sourceUnitId && c.source.output === sourceOutput &&
            c.target.unitId === targetUnitId && c.target.input === targetInput) {
            cables.splice(i, 1);
            delete _cableData[i];
        }
    }
    var key = sourceUnitId + ':' + sourceOutput;
    if (listeners[key]) {
        listeners[key] = listeners[key].filter(function(link) {
            return !(link.targetUnitId === targetUnitId && link.targetInput === targetInput);
        });
    }
    _renderCables();
};

FR.disconnectJack = function(jack) {
    var unitId = _resolveUnitId(jack);
    var output = jack.dataset.output;
    var input = jack.dataset.input;
    var removed = 0;

    for (var i = cables.length - 1; i >= 0; i--) {
        var c = cables[i];
        var match = false;
        if (output && c.source.unitId === unitId && c.source.output === output) match = true;
        if (input && c.target.unitId === unitId && c.target.input === input) match = true;
        if (match) {
            var key = c.source.unitId + ':' + c.source.output;
            if (listeners[key]) {
                listeners[key] = listeners[key].filter(function(link) {
                    return !(link.targetUnitId === c.target.unitId && link.targetInput === c.target.input);
                });
            }
            cables.splice(i, 1);
            delete _cableData[i];
            removed++;
        }
    }
    if (removed > 0) {
        jack.classList.remove('connected');
        _renderCables();
    }
    return removed;
};

// ── Right-click jack to disconnect + Escape to cancel ──

function _initDisconnect() {
    document.addEventListener('contextmenu', function(e) {
        var jack = e.target.closest('.patch-jack, .jack');
        if (jack && jack.classList.contains('connected')) {
            e.preventDefault();
            FR.disconnectJack(jack);
        }
    });

    document.addEventListener('keydown', function(e) {
        if (e.key === 'Escape' && pendingJack) {
            pendingJack.classList.remove('pending');
            pendingJack.style.boxShadow = '';
            pendingJack = null;
        }
    });
}

// ── Re-render on resize ──
window.addEventListener('resize', function() { _renderCables(); });

// ── Init ──
FR._initWiring = function() {
    _initJackInteraction();
    _initDisconnect();
};

if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', FR._initWiring);
} else {
    FR._initWiring();
}

})(ForgeRack);
