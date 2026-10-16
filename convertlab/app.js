// ConvertLab: every calculation runs in the browser, nothing is sent anywhere.
// The maths functions at the top have no DOM code, so they can be tested with Node.

// ---------- Unit converter ----------
// Each linear category stores "how many base units is 1 of this unit".
var CATEGORIES = {
  length: { label: 'Length', units: {
    mm: 0.001, cm: 0.01, m: 1, km: 1000, 'in': 0.0254, ft: 0.3048, yd: 0.9144, mi: 1609.344 } },
  mass: { label: 'Mass', units: {
    mg: 1e-6, g: 0.001, kg: 1, t: 1000, oz: 0.028349523125, lb: 0.45359237 } },
  pressure: { label: 'Pressure', units: {
    Pa: 1, kPa: 1000, MPa: 1e6, bar: 1e5, atm: 101325, psi: 6894.757293168, mmHg: 133.322387415 } },
  energy: { label: 'Energy', units: {
    J: 1, kJ: 1000, cal: 4.184, kcal: 4184, Wh: 3600, kWh: 3.6e6, BTU: 1055.05585262 } },
  temperature: { label: 'Temperature', units: { '°C': 0, '°F': 0, K: 0 } },
  // Power: base watt. TR is the refrigeration ton used on chiller and condenser datasheets.
  power: { label: 'Power', units: {
    W: 1, kW: 1000, MW: 1e6, hp: 745.6998715822702, 'BTU/h': 0.2930710701722222, 'kcal/h': 1.163, TR: 3516.852842066668 } },
  // Flow: base cubic metre per second.
  flow: { label: 'Flow', units: {
    'm³/s': 1, 'm³/h': 1 / 3600, 'L/s': 0.001, 'L/min': 1 / 60000, CFM: 0.00047194745, 'US gpm': 0.0000630901964 } }
};
var DEFAULTS = {
  length: ['mm', 'in'], mass: ['kg', 'lb'], pressure: ['bar', 'psi'], energy: ['kWh', 'BTU'],
  temperature: ['°C', '°F'], power: ['kW', 'TR'], flow: ['m³/h', 'CFM']
};
// A short shop-floor note shown under some unit pairs.
var HINTS = {
  'pressure:bar:psi': 'Gauge or absolute? A pressure test at 30 bar(g) is about 31 bar absolute. Convert the number, then keep the same reference.',
  'power:kW:TR': 'One refrigeration ton is the heat needed to melt one short ton of ice in 24 hours, about 3.517 kW. Condenser and chiller datasheets often use it.',
  'temperature:°C:°F': 'A temperature difference converts without the offset: a 10 °C rise is an 18 °F rise.',
  'flow:m³/h:CFM': 'Fan and condenser airflow is often quoted in CFM in US catalogues and in m³/h in European ones.'
};

function toKelvin(v, u) {
  if (u === '°C') return v + 273.15;
  if (u === '°F') return (v - 32) * 5 / 9 + 273.15;
  return v;
}
function fromKelvin(k, u) {
  if (u === '°C') return k - 273.15;
  if (u === '°F') return (k - 273.15) * 9 / 5 + 32;
  return k;
}
function convert(category, value, from, to) {
  if (category === 'temperature') return fromKelvin(toKelvin(value, from), to);
  var u = CATEGORIES[category].units;
  return value * u[from] / u[to];
}
function format(n) {
  if (!isFinite(n)) return '';
  if (n === 0) return '0';
  var a = Math.abs(n);
  if (a >= 1e9 || a < 1e-6) return n.toExponential(6);
  return String(parseFloat(n.toPrecision(10)));
}

// ---------- FX forward (covered interest parity) ----------
// F = S * (1 + rTRY * d/365) / (1 + rUSD * d/360), rates in % per year.
function fxForward(spot, rTryPct, rUsdPct, days) {
  if (!(spot > 0) || !(days > 0) || !isFinite(rTryPct) || !isFinite(rUsdPct)) return null;
  var tryLeg = 1 + (rTryPct / 100) * days / 365;
  var usdLeg = 1 + (rUsdPct / 100) * days / 360;
  if (!(tryLeg > 0) || !(usdLeg > 0)) return null;
  var f = spot * tryLeg / usdLeg;
  return { f: f, points: f - spot, annPremium: (f / spot - 1) * 365 / days * 100 };
}

// ---------- OEE ----------
// Availability = run / planned, Performance = ideal cycle x units / run, Quality = good / total.
function oee(plannedMin, downMin, idealCycleSec, totalUnits, defectUnits) {
  if (!(plannedMin > 0) || !(downMin >= 0) || !(downMin < plannedMin) || !(idealCycleSec > 0) ||
      !(totalUnits > 0) || !(defectUnits >= 0) || !(defectUnits <= totalUnits)) return null;
  var run = plannedMin - downMin;
  var a = run / plannedMin;
  var p = idealCycleSec * totalUnits / 60 / run;
  var q = (totalUnits - defectUnits) / totalUnits;
  return { a: a, p: p, q: q, oee: a * p * q };
}

// ---------- Process capability ----------
// Standard normal CDF via the Abramowitz and Stegun 7.1.26 erf approximation (error < 1.5e-7).
function normCdf(z) {
  var x = Math.abs(z) / Math.SQRT2;
  var t = 1 / (1 + 0.3275911 * x);
  var y = 1 - (((((1.061405429 * t - 1.453152027) * t) + 1.421413741) * t - 0.284496736) * t + 0.254829592) * t * Math.exp(-x * x);
  return z >= 0 ? 0.5 * (1 + y) : 0.5 * (1 - y);
}
function capability(lsl, usl, mean, sd) {
  if (![lsl, usl, mean].every(isFinite) || !(sd > 0) || !(usl > lsl)) return null;
  var cp = (usl - lsl) / (6 * sd);
  var cpu = (usl - mean) / (3 * sd);
  var cpl = (mean - lsl) / (3 * sd);
  var cpk = Math.min(cpu, cpl);
  var pBelow = normCdf((lsl - mean) / sd);
  var pAbove = 1 - normCdf((usl - mean) / sd);
  return { cp: cp, cpk: cpk, cpu: cpu, cpl: cpl, ppm: (pBelow + pAbove) * 1e6, pBelow: pBelow, pAbove: pAbove };
}

// ---------- Takt time ----------
function takt(shiftMin, breakMin, shifts, demand, workMin) {
  if (!(shiftMin > 0) || !(breakMin >= 0) || !(breakMin < shiftMin) || !(shifts > 0) || !(demand > 0)) return null;
  var avail = (shiftMin - breakMin) * shifts;            // minutes per day
  var t = avail * 60 / demand;                           // seconds per unit
  var stations = workMin > 0 ? Math.ceil(workMin * 60 / t - 1e-9) : null;
  return { avail: avail, takt: t, stations: stations, balance: stations ? workMin * 60 / (stations * t) : null };
}

if (typeof module !== 'undefined') {
  module.exports = { CATEGORIES: CATEGORIES, convert: convert, format: format, fxForward: fxForward, oee: oee, normCdf: normCdf, capability: capability, takt: takt };
}

// ---------- Page wiring (only runs in a browser) ----------
if (typeof document !== 'undefined') (function () {
  var $ = function (id) { return document.getElementById(id); };
  var num = function (id) { return parseFloat($(id).value); };

  // Poka-yoke style input checks: each rule names the field it blocks and says how to fix it.
  function check(rules) {
    var ok = true, seen = {};
    rules.forEach(function (r) {
      var input = $(r[0]), err = $(r[0] + '-err');
      if (seen[r[0]]) return;
      if (!r[1]) {
        ok = false; seen[r[0]] = true;
        input.setAttribute('aria-invalid', 'true');
        if (err) err.textContent = r[2];
      } else {
        input.removeAttribute('aria-invalid');
        if (err) err.textContent = '';
      }
    });
    return ok;
  }
  function pct(x) { return (x * 100).toFixed(1) + '%'; }
  function dash(ids) { ids.forEach(function (id) { $(id).textContent = '-'; $(id).className = ''; }); }

  // Theme toggle
  var root = document.documentElement, toggle = $('theme-toggle');
  function syncToggle() {
    toggle.setAttribute('aria-label', root.getAttribute('data-theme') === 'dark' ? 'Switch to light mode' : 'Switch to dark mode');
  }
  toggle.addEventListener('click', function () {
    var next = root.getAttribute('data-theme') === 'dark' ? 'light' : 'dark';
    root.setAttribute('data-theme', next);
    try { localStorage.setItem('convertlab-theme', next); } catch (e) {}
    syncToggle();
  });
  syncToggle();

  // Unit converter
  var current = 'length';
  var fromVal = $('from-value'), toVal = $('to-value'), fromUnit = $('from-unit'), toUnit = $('to-unit');

  function fillUnits(select, category, selected) {
    select.innerHTML = '';
    Object.keys(CATEGORIES[category].units).forEach(function (name) {
      var o = document.createElement('option');
      o.value = name; o.textContent = name; o.selected = name === selected;
      select.appendChild(o);
    });
  }
  function update() {
    var v = parseFloat(fromVal.value), hint = $('hint');
    hint.textContent = HINTS[current + ':' + fromUnit.value + ':' + toUnit.value] ||
                       HINTS[current + ':' + toUnit.value + ':' + fromUnit.value] || '';
    if (isNaN(v)) { toVal.value = ''; $('formula').textContent = 'Type a number to convert.'; return; }
    var r = convert(current, v, fromUnit.value, toUnit.value);
    toVal.value = format(r);
    $('formula').textContent = format(v) + ' ' + fromUnit.value + ' = ' + format(r) + ' ' + toUnit.value;
  }
  [fromVal, fromUnit, toUnit].forEach(function (el) { el.addEventListener('input', update); });
  $('swap').addEventListener('click', function () {
    var f = fromUnit.value; fromUnit.value = toUnit.value; toUnit.value = f;
    if (toVal.value !== '') fromVal.value = toVal.value;
    update();
  });
  $('copy').addEventListener('click', function () {
    var btn = this, text = $('formula').textContent;
    function done(msg) { btn.textContent = msg; setTimeout(function () { btn.textContent = 'Copy result'; }, 1500); }
    if (navigator.clipboard && toVal.value !== '') navigator.clipboard.writeText(text).then(function () { done('Copied'); }, function () { done('Copy failed'); });
    else done(toVal.value === '' ? 'Nothing to copy' : 'Copy failed');
  });

  // FX forward
  function updateFx() {
    var ok = check([
      ['fx-spot', num('fx-spot') > 0, 'Enter a spot rate above 0.'],
      ['fx-days', num('fx-days') > 0, 'Enter at least 1 day.'],
      ['fx-try', isFinite(num('fx-try')), 'Enter the TRY rate.'],
      ['fx-usd', isFinite(num('fx-usd')), 'Enter the USD rate.']
    ]);
    var res = ok && fxForward(num('fx-spot'), num('fx-try'), num('fx-usd'), num('fx-days'));
    if (!res) { dash(['fx-f', 'fx-pts', 'fx-ann']); $('fx-text').textContent = 'Fix the marked fields to see the forward rate.'; return; }
    var above = res.points >= 0;
    $('fx-f').textContent = res.f.toFixed(4);
    $('fx-pts').textContent = (above ? '+' : '') + res.points.toFixed(4);
    $('fx-ann').textContent = res.annPremium.toFixed(2) + '%';
    $('fx-text').textContent = 'A ' + format(num('fx-days')) + '-day USD/TRY forward is ' + res.f.toFixed(4) + ', ' +
      Math.abs(res.points).toFixed(4) + ' TRY ' + (above ? 'above' : 'below') + ' spot. The gap comes from the difference between the TRY and USD interest rates, and it is what an FX swap trades.';
  }

  // OEE
  function updateOee() {
    var P = num('oee-planned'), D = num('oee-down'), C = num('oee-ct'), U = num('oee-units'), X = num('oee-defects');
    var ok = check([
      ['oee-planned', P > 0, 'Planned time must be above 0.'],
      ['oee-down', D >= 0, 'Downtime cannot be negative.'],
      ['oee-down', !(D >= P), 'Downtime must be less than the planned time.'],
      ['oee-ct', C > 0, 'Ideal cycle time must be above 0.'],
      ['oee-units', U > 0, 'Enter at least 1 unit.'],
      ['oee-defects', X >= 0, 'Defects cannot be negative.'],
      ['oee-defects', !(X > U), 'Defects cannot exceed the units produced.']
    ]);
    var res = ok && oee(P, D, C, U, X);
    var segs = ['seg-good', 'seg-q', 'seg-p', 'seg-a'];
    if (!res) {
      dash(['oee-a', 'oee-p', 'oee-q', 'oee-o']);
      segs.forEach(function (s) { $(s).style.width = '0'; });
      $('oee-text').textContent = 'Calculation blocked until the marked fields are fixed.';
      return;
    }
    $('oee-a').textContent = pct(res.a); $('oee-p').textContent = pct(res.p);
    $('oee-q').textContent = pct(res.q); $('oee-o').textContent = pct(res.oee);
    if (res.p > 1) {
      segs.forEach(function (s) { $(s).style.width = '0'; });
      $('oee-text').textContent = 'Performance is above 100%: the line ran faster than the ideal cycle time. Check the ideal cycle time and the unit count before trusting this OEE.';
      return;
    }
    // Share of planned time lost at each stage, so the bar adds up to 100%.
    var w = { a: 1 - res.a, p: res.a * (1 - res.p), q: res.a * res.p * (1 - res.q), good: res.oee };
    $('seg-good').style.width = pct(w.good); $('seg-q').style.width = pct(w.q);
    $('seg-p').style.width = pct(w.p); $('seg-a').style.width = pct(w.a);
    var losses = [['downtime', w.a], ['slow running', w.p], ['defects and rework', w.q]].sort(function (x, y) { return y[1] - x[1]; });
    var lostMin = function (share) { return (share * P).toFixed(0); };
    var level = res.oee >= 0.85 ? ' That is at the 85% often quoted as world class.' : '';
    $('oee-text').textContent = 'Out of ' + format(P) + ' planned minutes, about ' + lostMin(w.good) + ' made good parts at full speed.' + level +
      (losses[0][1] > 0 ? ' The biggest loss is ' + losses[0][0] + ', worth about ' + lostMin(losses[0][1]) + ' minutes.' : ' There is no loss in this shift.');
  }

  // Process capability
  var SVGNS = 'http://www.w3.org/2000/svg';
  function el(name, attrs, text) {
    var e = document.createElementNS(SVGNS, name);
    for (var k in attrs) e.setAttribute(k, attrs[k]);
    if (text) e.textContent = text;
    return e;
  }
  function drawCpk(L, U, m, s) {
    var svg = $('cpk-chart'); svg.innerHTML = '';
    var W = 600, H = 190, pad = 24, base = H - 28, top = 22;
    var lo = Math.min(m - 4 * s, L - (U - L) * 0.15), hi = Math.max(m + 4 * s, U + (U - L) * 0.15);
    var X = function (v) { return pad + (v - lo) / (hi - lo) * (W - 2 * pad); };
    var pdf = function (v) { return Math.exp(-0.5 * Math.pow((v - m) / s, 2)); };
    var Y = function (v) { return base - pdf(v) * (base - top); };
    var N = 160, pts = [];
    for (var i = 0; i <= N; i++) { var v = lo + (hi - lo) * i / N; pts.push([v, X(v), Y(v)]); }
    function area(a, b, cls) {
      var seg = pts.filter(function (p) { return p[0] >= a && p[0] <= b; });
      if (seg.length < 2) return;
      var d = 'M' + X(a) + ',' + base + ' L' + X(a) + ',' + Y(a);
      seg.forEach(function (p) { d += ' L' + p[1].toFixed(1) + ',' + p[2].toFixed(1); });
      d += ' L' + X(b) + ',' + Y(b) + ' L' + X(b) + ',' + base + ' Z';
      svg.appendChild(el('path', { 'class': cls, d: d }));
    }
    area(Math.max(lo, L), Math.min(hi, U), 'inside');
    if (L > lo) area(lo, L, 'tail');
    if (U < hi) area(U, hi, 'tail');
    svg.appendChild(el('line', { 'class': 'axis', x1: pad, x2: W - pad, y1: base, y2: base }));
    svg.appendChild(el('path', { 'class': 'curve', d: 'M' + pts.map(function (p) { return p[1].toFixed(1) + ',' + p[2].toFixed(1); }).join(' L') }));
    var mid = (L + U) / 2;
    svg.appendChild(el('line', { 'class': 'mid', x1: X(mid), x2: X(mid), y1: top - 8, y2: base }));
    svg.appendChild(el('line', { 'class': 'mean', x1: X(m), x2: X(m), y1: Y(m) - 4, y2: base }));
    [[L, 'LSL'], [U, 'USL']].forEach(function (p) {
      svg.appendChild(el('line', { 'class': 'spec', x1: X(p[0]), x2: X(p[0]), y1: top - 8, y2: base }));
      svg.appendChild(el('text', { x: X(p[0]), y: H - 8, 'text-anchor': 'middle' }, p[1] + ' ' + format(p[0])));
    });
    svg.appendChild(el('text', { x: X(mid), y: 13, 'text-anchor': 'middle' }, 'center ' + format(mid)));
  }
  function updateCpk() {
    var L = num('cpk-lsl'), U = num('cpk-usl'), m = num('cpk-mean'), s = num('cpk-sd');
    var ok = check([
      ['cpk-lsl', isFinite(L), 'Enter the lower spec limit.'],
      ['cpk-usl', isFinite(U), 'Enter the upper spec limit.'],
      ['cpk-usl', !(U <= L), 'USL must be greater than LSL.'],
      ['cpk-mean', isFinite(m), 'Enter the process mean.'],
      ['cpk-sd', s > 0, 'Standard deviation must be above 0.']
    ]);
    var r = ok && capability(L, U, m, s);
    if (!r) { dash(['cpk-cp', 'cpk-cpk', 'cpk-ppm', 'cpk-verdict']); $('cpk-chart').innerHTML = ''; $('cpk-text').textContent = 'Fix the marked fields to see the capability.'; return; }
    drawCpk(L, U, m, s);
    $('cpk-cp').textContent = r.cp.toFixed(2);
    $('cpk-cpk').textContent = r.cpk.toFixed(2);
    $('cpk-ppm').textContent = r.ppm >= 100 ? Math.round(r.ppm).toLocaleString('en-US') + ' ppm' : r.ppm.toFixed(r.ppm < 1 ? 3 : 1) + ' ppm';
    var v = $('cpk-verdict');
    if (r.cpk >= 1.33) { v.textContent = 'Capable'; v.className = 'good'; }
    else if (r.cpk >= 1) { v.textContent = 'Marginal'; v.className = 'warn'; }
    else { v.textContent = 'Not capable'; v.className = 'bad'; }

    // Compare the two fixes from the case study: re-center the mean, or cut sigma by 20%.
    var centred = capability(L, U, (L + U) / 2, s).cpk;
    var tighter = capability(L, U, m, s * 0.8).cpk;
    var side = r.pAbove > r.pBelow ? 'above the USL' : 'below the LSL';
    var msg = 'Most out-of-spec parts fall ' + side + '. ';
    if (Math.abs(r.cp - r.cpk) < 0.005) msg += 'The process is centered, so the only way to raise Cpk is to reduce variation: cutting σ by 20% gives Cpk ' + tighter.toFixed(2) + '.';
    else msg += 'Moving the mean to the center gives Cpk ' + centred.toFixed(2) + '; cutting σ by 20% instead gives ' + tighter.toFixed(2) + '. ' +
      (centred >= tighter ? 'Re-centering is the bigger win here.' : 'Reducing variation is the bigger win here.');
    $('cpk-text').textContent = msg;
  }

  // Takt time
  function updateTakt() {
    var S = num('tk-shift'), B = num('tk-breaks'), N = num('tk-shifts'), Dm = num('tk-demand'), Wk = num('tk-work');
    var ok = check([
      ['tk-shift', S > 0, 'Shift length must be above 0.'],
      ['tk-breaks', B >= 0, 'Breaks cannot be negative.'],
      ['tk-breaks', !(B >= S), 'Breaks must be shorter than the shift.'],
      ['tk-shifts', N > 0, 'Enter at least 1 shift.'],
      ['tk-demand', Dm > 0, 'Demand must be above 0.'],
      ['tk-work', !(Wk < 0) && isFinite(Wk), 'Enter the work content, or 0 to skip it.']
    ]);
    var r = ok && takt(S, B, N, Dm, Wk);
    if (!r) { dash(['tk-avail', 'tk-takt', 'tk-st']); $('tk-text').textContent = 'Fix the marked fields to see the takt time.'; return; }
    $('tk-avail').textContent = format(r.avail) + ' min';
    $('tk-takt').textContent = r.takt >= 120 ? (r.takt / 60).toFixed(2) + ' min' : r.takt.toFixed(1) + ' s';
    $('tk-st').textContent = r.stations === null ? '-' : String(r.stations);
    var msg = 'To meet ' + format(Dm) + ' units a day, one unit must leave the line every ' + $('tk-takt').textContent + '.';
    if (r.stations) msg += ' With ' + format(Wk) + ' min of work per unit you need at least ' + r.stations + ' station' + (r.stations > 1 ? 's' : '') +
      ', which gives a line balance efficiency of ' + pct(r.balance) + ' if the work splits evenly.';
    $('tk-text').textContent = msg;
  }

  // Tabs, with the active tool kept in the URL (for example convertlab/#cpk) so a tool can be linked directly.
  var CALCS = { fx: ['FX swap', updateFx], oee: ['OEE', updateOee], cpk: ['Cpk', updateCpk], takt: ['Takt time', updateTakt] };
  var tabsEl = $('tabs'), order = Object.keys(CATEGORIES).concat(Object.keys(CALCS));
  order.forEach(function (key, i) {
    if (i === Object.keys(CATEGORIES).length) { var sep = document.createElement('span'); sep.className = 'tab-sep'; sep.setAttribute('aria-hidden', 'true'); tabsEl.appendChild(sep); }
    var b = document.createElement('button');
    b.type = 'button'; b.className = 'tab' + (CALCS[key] ? ' calc' : ''); b.dataset.key = key;
    b.setAttribute('role', 'tab'); b.id = 'tab-' + key;
    b.textContent = CALCS[key] ? CALCS[key][0] : CATEGORIES[key].label;
    b.addEventListener('click', function () { select(key, true); });
    tabsEl.appendChild(b);
  });
  tabsEl.addEventListener('keydown', function (e) {
    if (e.key !== 'ArrowRight' && e.key !== 'ArrowLeft') return;
    var i = order.indexOf(current) + (e.key === 'ArrowRight' ? 1 : -1);
    i = (i + order.length) % order.length;
    select(order[i], true); $('tab-' + order[i]).focus();
  });

  var panels = { convert: $('panel-convert'), fx: $('panel-fx'), oee: $('panel-oee'), cpk: $('panel-cpk'), takt: $('panel-takt') };
  function select(key, push) {
    if (order.indexOf(key) < 0) key = 'length';
    current = key;
    Array.prototype.forEach.call(tabsEl.querySelectorAll('.tab'), function (b) {
      var on = b.dataset.key === key;
      b.setAttribute('aria-selected', on ? 'true' : 'false');
      b.tabIndex = on ? 0 : -1;
    });
    var panelKey = CALCS[key] ? key : 'convert';
    for (var p in panels) panels[p].hidden = p !== panelKey;
    panels[panelKey].setAttribute('aria-labelledby', 'tab-' + key);
    if (push && history.replaceState) history.replaceState(null, '', '#' + key);
    if (CALCS[key]) { CALCS[key][1](); return; }
    fillUnits(fromUnit, key, DEFAULTS[key][0]);
    fillUnits(toUnit, key, DEFAULTS[key][1]);
    update();
  }

  Object.keys(CALCS).forEach(function (key) {
    Array.prototype.forEach.call(panels[key].querySelectorAll('input'), function (i) { i.addEventListener('input', CALCS[key][1]); });
  });

  var start = location.hash.slice(1);
  select(order.indexOf(start) >= 0 ? start : 'length', false);
  if (order.indexOf(start) >= 0) $('tools').scrollIntoView();
})();
