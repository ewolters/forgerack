/**
 * ForgeRack — Cable Wiring System
 *
 * Click a jack to start a cable. Click another jack to complete.
 * SVG bezier curves render between connected jacks.
 * Data flows through cables when source units emit.
 */
(function(FR) {
'use strict';

// Cable state
const cables = [];
let pendingJack = null;
let pendingSvgLine = null;
let svgLayer = null;

// ── Resolve unit ID from a jack element ──
// Handles: data-unit-id on the jack, data-id on parent unit,
// or literal ${id} that wasn't substituted (traverse DOM to find real ID)

function _resolveUnitId(jack) {
    // Direct attribute
    var uid = jack.dataset.unitId;
    if (uid && uid !== '${id}' && uid !== '') return uid;

    // Walk up to find the nearest unit wrapper with a real data-id
    var parent = jack.closest('[data-id]');
    if (parent) {
        uid = parent.dataset.id;
        if (uid && uid !== '${id}') return uid;
    }

    // Walk up to find rack-unit-front or rack-unit-back with data-unit attribute
    var unitEl = jack.closest('.rack-unit-front, .rack-unit-back, [data-unit], [data-unit-back]');
    if (unitEl) {
        uid = unitEl.dataset.id || unitEl.dataset.unitId;
        if (uid && uid !== '${id}') return uid;

        // Last resort: use the unit type + index as ID
        var unitType = unitEl.dataset.unit || unitEl.dataset.unitBack || 'unknown';
        var siblings = document.querySelectorAll('[data-unit="' + unitType + '"], [data-unit-back="' + unitType + '"]');
        for (var i = 0; i < siblings.length; i++) {
            if (siblings[i] === unitEl) return unitType + '-' + i;
        }
    }

    return 'unknown';
}

// ── Event bus for unit-to-unit data flow ──

const listeners = {};  // { unitId:outputName → [{targetUnitId, targetInput}] }

// Debug: expose internals
FR._listeners = listeners;
FR._cables = cables;

FR.emit = function(unitId, outputName, data) {
    const key = unitId + ':' + outputName;
    (listeners[key] || []).forEach(function(link) {
        const target = FR.units[link.targetUnitId];
        if (target && target.receive) {
            target.receive(link.targetInput, data, unitId);
        }
    });
};

FR.connect = function(sourceUnitId, sourceOutput, targetUnitId, targetInput) {
    const key = sourceUnitId + ':' + sourceOutput;
    if (!listeners[key]) listeners[key] = [];
    listeners[key].push({ targetUnitId: targetUnitId, targetInput: targetInput });

    cables.push({
        source: { unitId: sourceUnitId, output: sourceOutput },
        target: { unitId: targetUnitId, input: targetInput },
    });

    _renderCables();

    // Immediately push existing data through the new cable
    var source = FR.units[sourceUnitId];
    if (source && source.getOutput) {
        var existingData = source.getOutput(sourceOutput);
        if (existingData && (Array.isArray(existingData) ? existingData.length > 0 : true)) {
            var target = FR.units[targetUnitId];
            if (target && target.receive) {
                console.log('[ForgeRack] Pushing existing data through new cable:', sourceUnitId, sourceOutput, '→', targetUnitId, targetInput);
                target.receive(targetInput, existingData, sourceUnitId);
            }
        }
    }
};

// ── SVG cable rendering ──

function _ensureSvgLayer() {
    if (svgLayer) return svgLayer;
    // Find or create the cable overlay
    let overlay = document.querySelector('.forge-rack-cables');
    if (!overlay) {
        overlay = document.createElement('div');
        overlay.className = 'forge-rack-cables';
        overlay.innerHTML = '<svg style="width:100%;height:100%;"></svg>';
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
    // Drooping cable — control points offset downward
    const dy = Math.abs(y2 - y1);
    const dx = Math.abs(x2 - x1);
    const sag = Math.min(60, Math.max(20, dx * 0.3 + dy * 0.2));
    const midY = Math.max(y1, y2) + sag;
    return 'M' + x1 + ',' + y1 + ' C' + x1 + ',' + midY + ' ' + x2 + ',' + midY + ' ' + x2 + ',' + y2;
}

function _renderCables() {
    const svg = _ensureSvgLayer();
    if (!svg) return;

    // Clear existing cables
    svg.innerHTML = '';

    cables.forEach(function(cable, i) {
        // Find the jack elements
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

        const path = document.createElementNS('http://www.w3.org/2000/svg', 'path');
        path.setAttribute('d', _bezierPath(p1.x, p1.y, p2.x, p2.y));
        path.setAttribute('class', 'forge-cable audio');
        path.setAttribute('stroke', _cableColor(i));
        svg.appendChild(path);

        // Mark jacks as connected
        sourceJack.classList.add('connected');
        targetJack.classList.add('connected');
    });
}

function _cableColor(index) {
    const colors = ['#4ade80', '#60a5fa', '#fbbf24', '#f87171', '#a78bfa', '#22d3ee', '#fb923c', '#e879f9'];
    return colors[index % colors.length];
}

// ── Interactive jack clicking ──

function _initJackInteraction() {
    // Listen for clicks on any patch jack — uses document delegation
    // so it works for dynamically added elements
    document.addEventListener('click', function(e) {
        // Debug: log what was actually clicked on the back panel
        if (e.target.closest('.rack-back, .rack-unit-back, [data-unit-back]')) {
            console.log('[ForgeRack] Back panel click:', e.target.tagName, e.target.className, e.target);
        }

        const jack = e.target.closest('.patch-jack, .jack');
        if (!jack) {
            // Click elsewhere — cancel pending
            if (pendingJack) {
                pendingJack.classList.remove('pending');
                pendingJack = null;
                if (pendingSvgLine) { pendingSvgLine.remove(); pendingSvgLine = null; }
            }
            return;
        }

        const unitId = _resolveUnitId(jack);
        const output = jack.dataset.output;
        const input = jack.dataset.input;

        if (!pendingJack) {
            // Start cable
            pendingJack = jack;
            jack.classList.add('pending');
            jack.style.boxShadow = '0 0 8px rgba(74,222,128,0.5)';
        } else {
            // Complete cable
            const firstUnitId = _resolveUnitId(pendingJack);
            const firstOutput = pendingJack.dataset.output;
            const firstInput = pendingJack.dataset.input;

            // Determine direction: output → input
            let srcId, srcOut, tgtId, tgtIn;
            console.log('[ForgeRack] Wire attempt:', {
                first: { unitId: firstUnitId, output: firstOutput, input: firstInput },
                second: { unitId: unitId, output: output, input: input }
            });

            if (firstOutput && input) {
                srcId = firstUnitId; srcOut = firstOutput;
                tgtId = unitId; tgtIn = input;
            } else if (firstInput && output) {
                srcId = unitId; srcOut = output;
                tgtId = firstUnitId; tgtIn = firstInput;
            } else {
                console.warn('[ForgeRack] Cannot wire: both jacks are same direction (both input or both output)');
                pendingJack.classList.remove('pending');
                pendingJack.style.boxShadow = '';
                pendingJack = null;
                return;
            }

            console.log('[ForgeRack] Connected:', srcId, srcOut, '→', tgtId, tgtIn);

            FR.connect(srcId, srcOut, tgtId, tgtIn);

            pendingJack.classList.remove('pending');
            pendingJack.style.boxShadow = '';
            pendingJack = null;
        }
    });
}

// ── Disconnect ──

FR.disconnect = function(sourceUnitId, sourceOutput, targetUnitId, targetInput) {
    // Remove from cables array
    for (var i = cables.length - 1; i >= 0; i--) {
        var c = cables[i];
        if (c.source.unitId === sourceUnitId && c.source.output === sourceOutput &&
            c.target.unitId === targetUnitId && c.target.input === targetInput) {
            cables.splice(i, 1);
        }
    }
    // Remove from listeners
    var key = sourceUnitId + ':' + sourceOutput;
    if (listeners[key]) {
        listeners[key] = listeners[key].filter(function(link) {
            return !(link.targetUnitId === targetUnitId && link.targetInput === targetInput);
        });
    }
    _renderCables();
    console.log('[ForgeRack] Disconnected:', sourceUnitId, sourceOutput, '→', targetUnitId, targetInput);
};

FR.disconnectJack = function(jack) {
    // Disconnect all cables touching this jack
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
            // Remove listener
            var key = c.source.unitId + ':' + c.source.output;
            if (listeners[key]) {
                listeners[key] = listeners[key].filter(function(link) {
                    return !(link.targetUnitId === c.target.unitId && link.targetInput === c.target.input);
                });
            }
            cables.splice(i, 1);
            removed++;
        }
    }
    if (removed > 0) {
        jack.classList.remove('connected');
        _renderCables();
        console.log('[ForgeRack] Disconnected', removed, 'cable(s) from jack');
    }
    return removed;
};

// ── Right-click jack to disconnect + Escape to cancel pending ──

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
            console.log('[ForgeRack] Wiring cancelled');
        }
    });
}

// ── Re-render cables on resize/scroll ──
window.addEventListener('resize', function() { _renderCables(); });

// ── Init ──
FR._initWiring = function() {
    _initJackInteraction();
    _initDisconnect();
};

// Auto-init
if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', FR._initWiring);
} else {
    FR._initWiring();
}

})(ForgeRack);
