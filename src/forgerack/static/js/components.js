/**
 * ForgeRack — Component Behaviors
 * Makes dials turn, switches toggle, meters animate, LEDs pulse.
 */
(function(G) {
'use strict';
const FR = {};

// Dial: drag to rotate (270° sweep)
FR.Dial = function(el, o) {
    o = Object.assign({min:0,max:100,value:50,step:1,onChange:null}, o);
    const knob = el.querySelector('.dial-knob');
    const valEl = el.querySelector('.dial-value');
    let drag=false, sy, sv;

    function render(v) {
        const pct = (v-o.min)/(o.max-o.min);
        knob.style.transform = `rotate(${-135+pct*270}deg)`;
        if(valEl) valEl.textContent = v.toFixed(o.step<1?2:0);
    }
    function down(e){drag=true;sy=e.clientY;sv=o.value;document.addEventListener('pointermove',move);document.addEventListener('pointerup',up);e.preventDefault();}
    function move(e){if(!drag)return;const dy=sy-e.clientY;let nv=sv+dy*(o.max-o.min)/150;nv=Math.round(nv/o.step)*o.step;nv=Math.max(o.min,Math.min(o.max,nv));o.value=nv;render(nv);if(o.onChange)o.onChange(nv);}
    function up(){drag=false;document.removeEventListener('pointermove',move);document.removeEventListener('pointerup',up);}
    knob.addEventListener('pointerdown',down);
    render(o.value);
    return {get value(){return o.value},set value(v){o.value=v;render(v);}};
};

// Switch: click toggle
FR.Switch = function(el, o) {
    o = Object.assign({value:false,onChange:null}, o);
    const track = el.querySelector('.switch-slide') || el;
    function render(v){track.classList.toggle('on',v);}
    el.addEventListener('click',()=>{o.value=!o.value;render(o.value);if(o.onChange)o.onChange(o.value);});
    render(o.value);
    return {get value(){return o.value},set value(v){o.value=v;render(v);}};
};

// LED
FR.LED = function(el) {
    return {
        off(){el.className='led';},green(){el.className='led on-green';},amber(){el.className='led on-amber';},
        red(){el.className='led on-red';},blue(){el.className='led on-blue';},accent(){el.className='led on-accent';},
        set(s){if(s===true||s==='green')this.green();else if(s==='amber'||s==='warn')this.amber();else if(s===false||s==='red')this.red();else if(s==='blue')this.blue();else this.off();}
    };
};

// LED Bank
FR.LEDBank = function(container) {
    const leds = Array.from(container.querySelectorAll('.led'));
    return {
        setAll(states){states.forEach((s,i)=>{if(i<leds.length)FR.LED(leds[i]).set(s);});},
        clear(){leds.forEach(l=>FR.LED(l).off());},
        get count(){return leds.length;}
    };
};

// Meter
FR.Meter = function(el, o) {
    o = Object.assign({min:0,max:100,value:0}, o);
    const fill = el.querySelector('.meter-fill') || el.querySelector('.vu-meter-fill');
    const vert = el.classList.contains('vu-meter');
    function render(v){const p=Math.max(0,Math.min(100,((v-o.min)/(o.max-o.min))*100));if(vert)fill.style.height=p+'%';else fill.style.width=p+'%';}
    render(o.value);
    return {get value(){return o.value},set value(v){o.value=v;render(v);}};
};

// Readout
FR.Readout = function(el, o) {
    o = Object.assign({value:null,format:'auto',thresholds:null}, o);
    const valEl = el.querySelector('.readout-value');
    function render(v) {
        if(v==null){valEl.textContent='—';el.className=el.className.replace(/ (good|warn|bad)/g,'');return;}
        if(o.format==='auto')valEl.textContent=typeof v==='number'?v.toFixed(2):String(v);
        else if(o.format==='int')valEl.textContent=Math.round(v);
        else if(o.format==='pct')valEl.textContent=(v*100).toFixed(1)+'%';
        else valEl.textContent=String(v);
        el.className=el.className.replace(/ (good|warn|bad)/g,'');
        if(o.thresholds){const{good,warn}=o.thresholds;if(good!==undefined&&v>=good)el.className+=' good';else if(warn!==undefined&&v>=warn)el.className+=' warn';else el.className+=' bad';}
    }
    render(o.value);
    return {get value(){return o.value},set value(v){o.value=v;render(v);}};
};

// Segment switch
FR.Segment = function(container, o) {
    o = Object.assign({value:0,onChange:null}, o);
    const btns = Array.from(container.querySelectorAll('.segment-btn'));
    function render(i){btns.forEach((b,j)=>b.classList.toggle('active',j===i));}
    btns.forEach((b,i)=>b.addEventListener('click',()=>{o.value=i;render(i);if(o.onChange)o.onChange(i,b.textContent.trim());}));
    render(o.value);
    return {get value(){return o.value},set value(v){o.value=v;render(v);}};
};

// Auto-init
FR.init = function(root) {
    root = root || document;
    root.querySelectorAll('[data-dial]').forEach(el=>{el._dial=FR.Dial(el,JSON.parse(el.dataset.dial||'{}'));});
    root.querySelectorAll('[data-switch]').forEach(el=>{el._switch=FR.Switch(el);});
    root.querySelectorAll('[data-meter]').forEach(el=>{el._meter=FR.Meter(el,JSON.parse(el.dataset.meter||'{}'));});
    root.querySelectorAll('[data-readout]').forEach(el=>{el._readout=FR.Readout(el,JSON.parse(el.dataset.readout||'{}'));});
};

if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',()=>FR.init());
else FR.init();

G.ForgeRack = FR;
})(typeof window!=='undefined'?window:this);

// ========================================================================
// Rack Ears — generate bolt holes aligned to rail pattern
// ========================================================================

/*
 * Bolt pattern (matches rack.html rail generation):
 *   3 bolts per U, 14px diameter, 3px between, 10px between U groups
 *   Bolt centers from unit top edge:
 *     U0: 10, 27, 44
 *     U1: 68, 85, 102
 *     U2: 126, 143, 160
 *     U3: 184, 201, 218
 *     ...pattern: first bolt of Un = 10 + n*58
 */

FR.generateEars = function(unitEl) {
    // Determine U count from data attribute or computed height
    var uCount = parseInt(unitEl.dataset.u || '2');
    var unitHeight = unitEl.offsetHeight || (uCount * 58);

    // Calculate bolt center positions relative to unit top
    // We place holes at the top and bottom of each U group's first and last bolt
    var positions = [];
    for (var u = 0; u < uCount; u++) {
        var groupStart = 10 + u * 58;
        positions.push(groupStart);       // first bolt of group
        positions.push(groupStart + 34);  // last bolt of group (3rd bolt center)
    }

    // Deduplicate and limit — just top 2 and bottom 2 for cleanliness
    if (positions.length > 4) {
        positions = [positions[0], positions[1], positions[positions.length - 2], positions[positions.length - 1]];
    }

    // Create ear elements if they don't exist
    ['left', 'right'].forEach(function(side) {
        var ear = unitEl.querySelector('.rack-ear.' + side);
        if (!ear) {
            ear = document.createElement('div');
            ear.className = 'rack-ear ' + side;
            unitEl.appendChild(ear);
        }
        ear.innerHTML = '';

        positions.forEach(function(yCenter) {
            var hole = document.createElement('div');
            hole.className = 'rack-ear-hole';
            hole.style.top = (yCenter - 6) + 'px';  // center the 12px hole
            ear.appendChild(hole);
        });
    });
};

// Auto-generate ears for all unit panels
FR.initEars = function(root) {
    root = root || document;
    root.querySelectorAll('.rack-unit-front, .rack-unit-back').forEach(function(el) {
        FR.generateEars(el);
    });
};

// Unit registry for behaviors
FR.units = {};
FR.registerUnit = function(type, proto) {
    // Store prototype — instantiated when unit is mounted
    FR._unitTypes = FR._unitTypes || {};
    FR._unitTypes[type] = proto;
};

// Mount a unit — call init, generate ears, register instance
FR.mountUnit = function(el, id) {
    var type = el.dataset.unit;
    if (!type || !FR._unitTypes || !FR._unitTypes[type]) return;

    var instance = Object.create(FR._unitTypes[type]);
    instance.init(el, id);
    FR.units[id] = instance;
    FR.generateEars(el);
    return instance;
};
