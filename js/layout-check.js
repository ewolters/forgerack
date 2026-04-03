/**
 * ForgeRack Layout Checker
 * Run in browser console or inject as script to detect clipping/overflow/overlap issues.
 *
 * Usage:
 *   FR_LAYOUT.check()          — check all mounted units
 *   FR_LAYOUT.check('#unit-3') — check a specific unit
 *   FR_LAYOUT.highlight()      — same as check() but draws red outlines on problem elements
 *   FR_LAYOUT.clear()          — remove highlight outlines
 */
(function() {
    'use strict';

    var WARN_COLOR = 'rgba(255,60,60,0.6)';
    var INFO_COLOR = 'rgba(255,200,60,0.5)';
    var highlights = [];

    function getUnitPanels(selector) {
        if (selector) {
            var el = document.querySelector(selector);
            return el ? [el] : [];
        }
        return Array.from(document.querySelectorAll('.rack-unit-front'));
    }

    function rectContains(parent, child) {
        return (
            child.left >= parent.left - 0.5 &&
            child.right <= parent.right + 0.5 &&
            child.top >= parent.top - 0.5 &&
            child.bottom <= parent.bottom + 0.5
        );
    }

    function rectsOverlap(a, b) {
        return !(a.right <= b.left || b.right <= a.left || a.bottom <= b.top || b.bottom <= a.top);
    }

    function isVisible(el) {
        var style = getComputedStyle(el);
        return style.display !== 'none' && style.visibility !== 'hidden' && style.opacity !== '0';
    }

    function hasOverflowClip(el) {
        var style = getComputedStyle(el);
        return style.overflow === 'hidden' || style.overflow === 'clip' ||
               style.overflowX === 'hidden' || style.overflowY === 'hidden';
    }

    function allowsOverflow(el) {
        var style = getComputedStyle(el);
        return style.overflow === 'visible';
    }

    function describeEl(el) {
        var desc = el.tagName.toLowerCase();
        if (el.id) desc += '#' + el.id;
        if (el.className && typeof el.className === 'string') {
            var cls = el.className.trim().split(/\s+/).slice(0, 2).join('.');
            if (cls) desc += '.' + cls;
        }
        // Add text hint for small elements
        var text = (el.textContent || '').trim();
        if (text && text.length < 20) desc += ' "' + text + '"';
        return desc;
    }

    function walkUnit(panel, issues, doHighlight) {
        var panelRect = panel.getBoundingClientRect();
        var unitId = panel.dataset.id || panel.dataset.unit || '?';

        // Walk all descendants
        var all = panel.querySelectorAll('*');
        for (var i = 0; i < all.length; i++) {
            var el = all[i];
            if (!isVisible(el)) continue;
            if (el.tagName === 'SELECT' || el.tagName === 'OPTION') continue;
            if (el.tagName === 'SVG' || el.closest('svg')) continue;

            var rect = el.getBoundingClientRect();
            // Skip zero-size elements
            if (rect.width < 1 || rect.height < 1) continue;

            // 1. Check if element exceeds the unit panel bounds
            if (!rectContains(panelRect, rect)) {
                // Walk up to see if any ancestor clips it (overflow:hidden)
                var clipped = false;
                var ancestor = el.parentElement;
                while (ancestor && ancestor !== panel) {
                    if (hasOverflowClip(ancestor)) {
                        clipped = true;
                        break;
                    }
                    ancestor = ancestor.parentElement;
                }

                // Check if parent explicitly allows overflow
                var parentAllows = el.parentElement && allowsOverflow(el.parentElement);

                if (!clipped && !parentAllows) {
                    var dx = Math.max(0, panelRect.left - rect.left, rect.right - panelRect.right);
                    var dy = Math.max(0, panelRect.top - rect.top, rect.bottom - panelRect.bottom);
                    issues.push({
                        type: 'CLIP',
                        severity: (dx > 5 || dy > 5) ? 'error' : 'warn',
                        unit: unitId,
                        element: describeEl(el),
                        detail: 'exceeds panel by ' + Math.round(dx) + 'px H, ' + Math.round(dy) + 'px V',
                        el: el
                    });
                }
            }

            // 2. Check if element exceeds its direct parent (when parent clips)
            if (el.parentElement && el.parentElement !== panel && hasOverflowClip(el.parentElement)) {
                var parentRect = el.parentElement.getBoundingClientRect();
                if (!rectContains(parentRect, rect)) {
                    var pdx = Math.max(0, parentRect.left - rect.left, rect.right - parentRect.right);
                    var pdy = Math.max(0, parentRect.top - rect.top, rect.bottom - parentRect.bottom);
                    if (pdx > 2 || pdy > 2) {
                        issues.push({
                            type: 'HIDDEN-CLIP',
                            severity: 'error',
                            unit: unitId,
                            element: describeEl(el),
                            detail: 'clipped by ' + describeEl(el.parentElement) + ' — ' + Math.round(pdx) + 'px H, ' + Math.round(pdy) + 'px V hidden',
                            el: el
                        });
                    }
                }
            }

            // 3. Check flex/grid siblings for overlap (only direct children of flex/grid)
            if (el.parentElement) {
                var parentStyle = getComputedStyle(el.parentElement);
                if (parentStyle.display === 'flex' || parentStyle.display === 'grid' ||
                    parentStyle.display === 'inline-flex' || parentStyle.display === 'inline-grid') {
                    var next = el.nextElementSibling;
                    if (next && isVisible(next)) {
                        var nextRect = next.getBoundingClientRect();
                        if (nextRect.width > 0 && nextRect.height > 0 && rectsOverlap(rect, nextRect)) {
                            var ox = Math.min(rect.right, nextRect.right) - Math.max(rect.left, nextRect.left);
                            var oy = Math.min(rect.bottom, nextRect.bottom) - Math.max(rect.top, nextRect.top);
                            if (ox > 2 && oy > 2) {
                                issues.push({
                                    type: 'OVERLAP',
                                    severity: 'warn',
                                    unit: unitId,
                                    element: describeEl(el) + ' ↔ ' + describeEl(next),
                                    detail: Math.round(ox) + 'px × ' + Math.round(oy) + 'px overlap',
                                    el: el
                                });
                            }
                        }
                    }
                }
            }
        }
    }

    function check(selector) {
        var panels = getUnitPanels(selector);
        if (!panels.length) {
            console.warn('[FR_LAYOUT] No units found' + (selector ? ' for ' + selector : ''));
            return [];
        }
        var issues = [];
        panels.forEach(function(p) { walkUnit(p, issues, false); });

        // Report
        if (issues.length === 0) {
            console.log('%c[FR_LAYOUT] ✓ No issues found across ' + panels.length + ' unit(s)', 'color:#4ade80;font-weight:bold');
        } else {
            var errors = issues.filter(function(i) { return i.severity === 'error'; });
            var warns = issues.filter(function(i) { return i.severity === 'warn'; });
            console.group('%c[FR_LAYOUT] ' + issues.length + ' issue(s): ' + errors.length + ' errors, ' + warns.length + ' warnings', 'color:#ef4444;font-weight:bold');
            issues.forEach(function(issue) {
                var color = issue.severity === 'error' ? 'color:#ef4444' : 'color:#f59e0b';
                console.log('%c[' + issue.type + '] %c' + issue.unit + ' → ' + issue.element + ': ' + issue.detail,
                    color, 'color:inherit');
            });
            console.groupEnd();
        }
        return issues;
    }

    function highlight(selector) {
        clear();
        var panels = getUnitPanels(selector);
        var issues = [];
        panels.forEach(function(p) { walkUnit(p, issues, true); });

        issues.forEach(function(issue) {
            if (!issue.el) return;
            var color = issue.severity === 'error' ? WARN_COLOR : INFO_COLOR;
            var overlay = document.createElement('div');
            var rect = issue.el.getBoundingClientRect();
            overlay.style.cssText = 'position:fixed;pointer-events:none;z-index:99999;' +
                'border:2px solid ' + color + ';' +
                'background:' + color.replace(/[\d.]+\)$/, '0.08)') + ';' +
                'left:' + rect.left + 'px;top:' + rect.top + 'px;' +
                'width:' + rect.width + 'px;height:' + rect.height + 'px;';
            // Label
            var label = document.createElement('div');
            label.style.cssText = 'position:absolute;top:-16px;left:0;font:700 10px/1 monospace;color:' + color + ';white-space:nowrap;background:rgba(0,0,0,0.8);padding:2px 4px;border-radius:2px;';
            label.textContent = issue.type + ': ' + issue.detail;
            overlay.appendChild(label);
            document.body.appendChild(overlay);
            highlights.push(overlay);
        });

        if (issues.length === 0) {
            console.log('%c[FR_LAYOUT] ✓ Clean — no highlights needed', 'color:#4ade80;font-weight:bold');
        } else {
            console.log('%c[FR_LAYOUT] ' + highlights.length + ' issue(s) highlighted in red/yellow', 'color:#ef4444;font-weight:bold');
        }
        return issues;
    }

    function clear() {
        highlights.forEach(function(el) { el.remove(); });
        highlights = [];
    }

    window.FR_LAYOUT = {
        check: check,
        highlight: highlight,
        clear: clear
    };

    console.log('%c[FR_LAYOUT] Layout checker loaded. Use FR_LAYOUT.check() or FR_LAYOUT.highlight()', 'color:#4ade80');
})();
