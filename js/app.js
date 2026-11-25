import { compare, sensitivity, n, r2, RULES } from './calc.js';
import { SOURCES, COUNTIES, PRICES, FIELDS, PRESETS, buildPreset, cropFromCounty, newId } from './data.js';

const KEY = 'baseacre:v1';
const $ = (s, el = document) => el.querySelector(s);
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const usd0 = (x) => (x < 0 ? '−' : '') + '$' + Math.round(Math.abs(x)).toLocaleString('en-US');
const usd2 = (x) => (x < 0 ? '−' : '') + '$' + Math.abs(r2(x)).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const num = (x, d = 1) => { const v = n(x); return Number.isInteger(v) ? v.toLocaleString('en-US') : v.toLocaleString('en-US', { maximumFractionDigits: d }); };
const bu = (x) => num(x, 2) + ' bu';
const pct = (x) => Math.round(x * 100) + '%';

let state;
function load() {
  try { const s = JSON.parse(localStorage.getItem(KEY)); if (s && Array.isArray(s.crops)) return s; } catch (e) {}
  return buildPreset('wilkin');
}
let saveT;
function save() { clearTimeout(saveT); saveT = setTimeout(() => { try { localStorage.setItem(KEY, JSON.stringify(state)); } catch (e) {} }, 250); }

const countyLabel = () => state.county === 'custom' ? 'your county' : (COUNTIES[state.county]?.label || 'your county');
const isCass3 = () => state.preset === 'cass3';

/* ---------------- editor ---------------- */
const GROUPS = { farm: 'Your farm (ARC-IC)', county: 'County (ARC-CO)', price: 'Prices, $/bu', plc: 'PLC' };
const SRC_TITLE = { arcco: SOURCES.arcco.label, prices: SOURCES.prices.label, erp: SOURCES.erp.label, plcy: SOURCES.plcy.label, slide: 'From the Cass County Scenario #3 slides', est: 'Placeholder estimate: replace with your number', you: 'Your number' };

function renderEditor() {
  $('#farmName').value = state.farmName || '';
  $('#county').value = state.county;
  $('#practice').value = state.practice || 'Nonirrigated';
  $('#seq').checked = !!state.sequestration;
  const box = $('#crops');
  box.innerHTML = state.crops.map((c) => {
    const groups = Object.entries(GROUPS).map(([g, title]) => {
      const cells = FIELDS.filter((f) => f[2] === g).map(([k, label, , unit]) => {
        const src = (c.flags && c.flags[k]) || 'you';
        return `<div class="cell"><label for="${c.id}-${k}" title="${esc(label)}">${esc(label)}${unit === 'ac' ? '' : unit === '$' ? '' : ''}</label>
          <input id="${c.id}-${k}" data-id="${c.id}" data-k="${k}" class="src-${src}" title="${esc(SRC_TITLE[src] || '')}" type="number" inputmode="decimal" step="any" min="0" value="${esc(c[k])}"></div>`;
      }).join('');
      return `<div class="grp"><h4>${title}</h4><div class="cells">${cells}</div></div>`;
    }).join('');
    const prac = c.practice && c.practice !== 'All' ? c.practice.replace('Nonirrigated', 'Non-irrigated') : '';
    return `<div class="crop" data-id="${c.id}">
      <div class="crop-head"><input data-id="${c.id}" data-k="name" value="${esc(c.name)}" aria-label="Crop name"><span class="prac">${esc(prac)}</span><span class="grow"></span>
      <button class="btn icon ghost danger" data-remove="${c.id}" type="button" aria-label="Remove ${esc(c.name)}">Remove</button></div>
      <div class="groups">${groups}</div></div>`;
  }).join('') || '<p class="note">No crops yet. Add one below.</p>';
  renderCountyNote();
}

function renderCountyNote() {
  let t;
  if (isCass3()) t = `<b>Cass County Scenario #3.</b> These are the slide inputs exactly; the slides round FSA's county benchmarks (180.92 → 180.9 corn, 41.35 → 41.4 soybeans). The corn PLC yield of 138 bu is what slide 4's $1,672 PLC figure implies; the slides don't show it.`;
  else if (state.county === 'custom') t = `<b>Other county.</b> Prices are FSA's 2026 national figures. Enter your county's ARC-CO benchmark yields from FSA's "2026 ARC-County Benchmark Yields and Revenues" file, or get them from your county office.`;
  else {
    const co = COUNTIES[state.county];
    t = `<b>${esc(co.label)}</b> (FIPS ${co.fips}): the green fields are from FSA's 2026 ARC-CO benchmark file and 2025 county PLC yields; prices are FSA's 2026 figures (Nov. WASDE projected MYA). <b>Dashed fields are placeholders</b>, set equal to the county benchmark: your acres, your ARC-IC history and 2026 yield, and the 2026 county yield. FSA won't publish 2026 county yields until fall 2027, so put in your best estimate.`;
  }
  $('#countyNote').innerHTML = t;
}

function wireEditor() {
  $('#crops').addEventListener('input', (e) => {
    const el = e.target; const c = state.crops.find((x) => x.id === el.dataset.id); if (!c) return;
    const k = el.dataset.k;
    if (k === 'name') { c.name = el.value; }
    else {
      c[k] = el.value === '' ? '' : parseFloat(el.value);
      c.flags = c.flags || {}; c.flags[k] = 'you';
      el.className = 'src-you'; el.title = SRC_TITLE.you;
    }
    if (state.preset === 'cass3' && k !== 'name') state.preset = 'edited';
    save(); renderOutput();
  });
  $('#crops').addEventListener('click', (e) => {
    const id = e.target.dataset.remove; if (!id) return;
    state.crops = state.crops.filter((c) => c.id !== id); save(); renderEditor(); renderOutput();
  });
  $('#farmName').addEventListener('input', (e) => { state.farmName = e.target.value; save(); renderOutput(); });
  $('#seq').addEventListener('change', (e) => { state.sequestration = e.target.checked; save(); renderOutput(); });
  $('#county').addEventListener('change', (e) => {
    const v = e.target.value;
    if (v === 'custom') {
      state.county = 'custom'; state.preset = 'custom';
      state.crops.forEach((c) => { c.flags = c.flags || {}; ['coBenchYield', 'coYield', 'plcYield'].forEach((k) => { if (c.flags[k] !== 'you') c.flags[k] = 'est'; }); });
    } else applyCounty(v);
    save(); renderEditor(); renderOutput();
  });
  $('#practice').addEventListener('change', (e) => { state.practice = e.target.value; if (state.county !== 'custom') applyCounty(state.county); save(); renderEditor(); renderOutput(); });
  $('#btnCountyPreset').addEventListener('click', () => {
    if (state.county === 'custom') { alert('Pick Wilkin, Richland or Cass County to load FSA figures.'); return; }
    if (!confirm('Replace every number with the starting figures for ' + COUNTIES[state.county].label + '?')) return;
    state = buildPreset(state.county === 'cass' ? 'cass3' : state.county, state.practice);
    save(); renderEditor(); renderOutput();
  });
  $('#btnCass').addEventListener('click', () => { state = buildPreset('cass3'); save(); renderEditor(); renderOutput(); document.getElementById('slides').scrollIntoView({ behavior: 'smooth' }); });
  $('#btnAdd').addEventListener('click', () => {
    let name = $('#addCrop').value;
    if (name === 'Other') name = (prompt('Crop name?', 'Barley') || '').trim() || 'Other';
    const c = state.county !== 'custom' && COUNTIES[state.county] ? cropFromCounty(name, state.county, state.practice, { planted: 0, base: 0 }) : cropFromCounty(name, 'none', state.practice, { planted: 0, base: 0 });
    if (!PRICES[name]) { ['benchPrice', 'mya', 'erp', 'loan', 'coBenchYield', 'coYield', 'icYield', 'farmYield', 'plcYield'].forEach((k) => { c.flags[k] = 'est'; }); }
    state.crops.push(c); save(); renderEditor(); renderOutput();
  });
  $('#btnReset').addEventListener('click', () => { if (confirm('Clear your numbers and go back to the Wilkin County starting point?')) { state = buildPreset('wilkin'); save(); renderEditor(); renderOutput(); } });
}

// Refresh FSA-sourced fields for a county without touching numbers the user typed.
function applyCounty(key) {
  const co = COUNTIES[key]; state.county = key; if (state.preset === 'cass3') state.preset = 'edited';
  state.crops.forEach((c) => {
    const fresh = cropFromCounty(c.name, key, state.practice);
    c.practice = fresh.practice; c.flags = c.flags || {};
    const by = co.bench[c.name] ? fresh.coBenchYield : null;
    const set = (k, v, src) => { if (c.flags[k] !== 'you' && v != null) { c[k] = v; c.flags[k] = src; } };
    if (by != null) { set('coBenchYield', by, 'arcco'); set('coYield', by, 'est'); set('icYield', by, 'est'); set('farmYield', by, 'est'); }
    if (co.plcYield[c.name]) set('plcYield', co.plcYield[c.name], 'plcy');
    if (PRICES[c.name]) { ['benchPrice', 'mya', 'loan'].forEach((k) => set(k, PRICES[c.name][k], 'prices')); set('erp', PRICES[c.name].erp, 'erp'); }
  });
}

/* ---------------- slides ---------------- */
const MARK = `<svg viewBox="0 0 40 40" aria-hidden="true"><rect x="3" y="24" width="9" height="13" rx="2" fill="#d9a441"/><rect x="15.5" y="15" width="9" height="22" rx="2" fill="#3f9a4b"/><rect x="28" y="5" width="9" height="32" rx="2" fill="#1e5b3a"/></svg>`;
function slide(i, kicker, title, sub, body, fine) {
  const k = (state.farmName ? state.farmName + ' · ' : '') + kicker;
  return `<div class="slide-wrap"><div class="slide-tools"><button class="btn icon" type="button" data-png="${i}">Save slide ${i} as PNG</button></div>
  <article class="slide" id="slide-${i}"><div class="kick"><span>${esc(k)}</span><span>${i}/5</span></div>
  <h2>${title}</h2>${sub ? `<p class="sub">${sub}</p>` : ''}<div class="body">${body}</div>
  <div class="sfoot"><div class="mark">${MARK}BASEACRE</div><div class="fine">${fine}</div></div><div class="cbar"><i></i><i></i><i></i><i></i></div></article></div>`;
}

function renderOutput() {
  const crops = state.crops.filter((c) => c.name);
  const opts = { sequestration: state.sequestration };
  const R = compare(crops, opts);
  const seqNote = state.sequestration ? 'After 5.7% sequestration.' : 'Before sequestration.';
  const cty = countyLabel();
  renderTiles(R);
  if (!crops.length) { $('#slides').innerHTML = ''; return; }

  // ---- slide 1: inputs
  const ic = R.ic, co = R.co;
  const farmBench = ic.rows.reduce((s, r) => s + r.bRev * r.planted, 0), farmAct = ic.rows.reduce((s, r) => s + r.aRev * r.planted, 0);
  const coBench = co.rows.reduce((s, r) => s + r.bench * (r.base || 0), 0), coAct = co.rows.reduce((s, r) => s + r.actual * (r.base || 0), 0);
  const farmLoss = farmBench > 0 ? 1 - farmAct / farmBench : 0; const coLoss = coBench > 0 ? 1 - coAct / coBench : 0;
  // yield-only comparison (slide 1 is about yields)
  const yl = (a, b) => b > 0 ? 1 - a / b : 0;
  const fy = crops.reduce((s, c) => s + n(c.planted) * yl(n(c.farmYield), n(c.icYield)), 0) / Math.max(1, crops.reduce((s, c) => s + n(c.planted), 0));
  const cy = crops.reduce((s, c) => s + n(c.base) * yl(n(c.coYield), n(c.coBenchYield)), 0) / Math.max(1, crops.reduce((s, c) => s + n(c.base), 0));
  let t1, s1;
  if (fy >= 0.15 && cy >= 0.15) { t1 = 'Everybody got hit, this farm included.'; s1 = `2026 was rough across ${esc(cty)}, and this farm got hit ${fy > cy ? 'even harder than most' : 'too'}.`; }
  else if (fy >= 0.15) { t1 = 'This farm got hit harder than the county.'; s1 = `County yields held up better than this farm's in ${esc(cty)}.`; }
  else if (cy >= 0.15) { t1 = 'The county got hit; this farm held up.'; s1 = `County yields in ${esc(cty)} are well under their benchmarks, while this farm is closer to its own.`; }
  else { t1 = 'A close-to-normal year on yields.'; s1 = `Yields in ${esc(cty)} and on this farm are near their benchmarks, so prices decide this one.`; }
  s1 += ` Farm yields are ${pct(Math.max(0, fy))} under the farm's benchmark; county yields are ${pct(Math.max(0, cy))} under the county's.`;
  const tp = crops.reduce((s, c) => s + n(c.planted), 0), tb = crops.reduce((s, c) => s + n(c.base), 0);
  const s1body = `<div class="scroll"><table class="t"><thead>
    <tr><th rowspan="2" class="lighthd" style="text-align:left">Crop</th><th rowspan="2" class="lighthd">Acres<br>planted</th><th rowspan="2" class="lighthd">Base<br>acres</th><th rowspan="2" class="lighthd">ARC-IC<br>benchmark<br>yield</th><th rowspan="2" class="lighthd">County<br>benchmark<br>yield</th><th colspan="2" class="darkhd">2026 performance</th></tr>
    <tr class="hd"><th>This farm</th><th>Est. county<br>yield</th></tr></thead><tbody>
    ${crops.map((c) => `<tr><td>${esc(c.name)}</td><td>${num(c.planted)}</td><td>${num(c.base)}</td><td>${bu(c.icYield)}</td><td class="soft">${bu(c.coBenchYield)}</td><td class="strong">${bu(c.farmYield)}</td><td class="soft">${bu(c.coYield)}</td></tr>`).join('')}
    <tr class="total"><td>Farm total</td><td>${num(tp)}</td><td>${num(tb)}</td><td></td><td></td><td></td><td></td></tr></tbody></table></div>`;
  const out = [];
  out.push(slide(1, 'ARC-IC vs ARC-CO vs PLC · 2026', t1, s1, s1body, `${isCass3() ? 'Example farm from Cropland\'s ARC-IC Scenario #3. ' : ''}ARC-IC benchmark yield = the farm's 2020–24 FSA production history, high and low years dropped. Not crop insurance APH. County benchmark yields: FSA 2026 file. 2026 county yields are estimates.`));

  // ---- slide 2: ARC-IC math
  let t2 = ic.capped ? 'ARC-IC pays its max' : ic.payment > 0 ? `ARC-IC pays ${usd0(R.totals['ARC-IC'])}` : 'ARC-IC doesn\'t pay here';
  const s2body = `<div class="scroll"><table class="t"><thead>
    <tr><th rowspan="2" style="text-align:left;vertical-align:bottom">Crop</th><th rowspan="2" style="vertical-align:bottom">Acres</th><th colspan="3" class="lighthd">ARC-IC benchmark</th><th colspan="3" class="darkhd">2026</th></tr>
    <tr><th class="shade">Yield</th><th class="shade">Price</th><th class="shade">$ / acre</th><th>Yield</th><th>Proj. MYA</th><th>$ / acre</th></tr></thead><tbody>
    ${ic.rows.map((r) => `<tr><td>${esc(r.name)}</td><td>${num(r.planted)}</td><td class="shade">${bu(r.yield)}</td><td class="shade">${usd2(r.bPrice)}</td><td class="shade strong">${usd0(r.bRev)}</td><td>${bu(r.aYield)}</td><td>${usd2(r.aPrice)}</td><td class="strong">${usd0(r.aRev)}</td></tr>`).join('')}
    <tr><td>Farm (blended)</td><td class="strong">${num(ic.planted)}</td><td class="shade"></td><td class="shade"></td><td class="shade strong">${usd0(ic.bench)}</td><td></td><td></td><td class="strong">${usd0(ic.actual)}</td></tr>
    </tbody></table></div>
    <div class="boxes">
      <div class="box"><div class="k">Guarantee</div><div class="v">${usd2(ic.guarantee)}</div><div class="f">90% × ${usd2(ic.bench)}</div></div>
      <div class="box"><div class="k">Shortfall</div><div class="v">${usd2(ic.shortfall)}</div><div class="f">${usd2(ic.guarantee)} − ${usd2(ic.actual)}</div></div>
      <div class="box"><div class="k">Payment rate</div><div class="v">${usd2(ic.rate)}</div><div class="f">${ic.capped ? `Capped at 12% of ${usd2(ic.bench)}` : `Cap is ${usd2(ic.cap)} (12%)`}</div></div>
      <div class="box"><div class="k">Per base acre</div><div class="v">${usd2(ic.perBase)}</div><div class="f">${usd2(ic.rate)} × 65%</div></div>
      <div class="box dark"><div class="k">Estimated payment</div><div class="v">${usd0(R.totals['ARC-IC'])}</div><div class="f">${usd2(ic.perBase)} × ${num(ic.base)} base acres${state.sequestration ? ' − 5.7%' : ''}</div></div>
    </div>
    <p class="lead">${ic.capped ? 'ARC-IC pays on 65% of base: the shortfall was bigger than the cap, so this is as much as ARC-IC can pay here.' : ic.payment > 0 ? `The shortfall is under the ${usd2(ic.cap)} cap, so ARC-IC pays the full shortfall on 65% of base.` : `Farm revenue of ${usd2(ic.actual)}/acre is above the ${usd2(ic.guarantee)} guarantee, so there's no shortfall to pay.`}</p>`;
  out.push(slide(2, 'The ARC-IC math', t2, '', s2body, `Benchmark prices: FSA 2026. 2026 prices: projected MYA (Nov. 2026 WASDE) or the loan rate if higher. Revenues blended by planted acres. Benchmark simplified. ${seqNote}`));

  // ---- slide 3: ARC-CO and PLC
  const allCapped = co.rows.length && co.rows.every((r) => r.capped);
  const coFoot = allCapped ? (co.rows.length > 1 ? 'All crops hit the 12% cap, paid on 85% of base' : 'Hit the 12% cap, paid on 85% of base') : co.payment > 0 ? 'Shortfall below 90% of benchmark, up to the 12% cap, paid on 85% of base' : 'County revenue is above the 90% guarantee for every crop';
  const pl = R.plc;
  const plFoot = pl.rows.every((r) => r.rate === 0) ? (pl.rows.length > 1 ? 'Every price is above its reference price' : 'Price is above the reference price') : 'Pays the price gap × PLC yield on 85% of base';
  const s3body = `<div class="sect">ARC-CO <span>· pays on each base crop's county revenue, on 85% of that base</span></div>
    <div class="scroll"><table class="t sm"><thead><tr class="hd"><th>Base crop</th><th>Base</th><th>County benchmark</th><th>Guarantee (90%)</th><th>2026 est. county revenue</th><th>Payment</th></tr></thead><tbody>
    ${co.rows.map((r) => `<tr><td>${esc(r.name)}</td><td>${num(r.base)}</td><td>${bu(r.bYield)} × ${usd2(r.bPrice)} = ${usd2(r.bench)}</td><td>${usd2(r.guarantee)}</td><td>${bu(r.aYield)} × ${usd2(r.price)} = ${usd2(r.actual)}</td><td class="strong">${usd0(r.payment)}</td></tr>`).join('')}
    <tr class="foot"><td colspan="5">${coFoot}</td><td class="big">${usd0(co.payment)}</td></tr></tbody></table></div>
    <div class="sect">PLC <span>· uses price only, pays on 85% of base</span></div>
    <div class="scroll"><table class="t sm"><thead><tr class="hd"><th>Base crop</th><th>Base</th><th>Reference price</th><th>2026 proj. MYA</th><th>Rate</th><th>× PLC yield × 85% × base</th><th>Payment</th></tr></thead><tbody>
    ${pl.rows.map((r) => `<tr><td>${esc(r.name)}</td><td>${num(r.base)}</td><td>${usd2(r.erp)}</td><td>${usd2(r.mya)}</td><td>${usd2(r.rate)}</td><td>${r.rate > 0 ? `${usd2(r.rate)} × ${bu(r.plcYield)} × 85% × ${num(r.base)}` : 'price above reference'}</td><td class="strong">${usd0(r.payment)}</td></tr>`).join('')}
    <tr class="foot"><td colspan="6">${plFoot}</td><td class="big">${usd0(pl.payment)}</td></tr></tbody></table></div>`;
  out.push(slide(3, 'The ARC-CO and PLC math', 'The same farm under ARC-CO and PLC', '', s3body, `County benchmark yields: FSA. Expected 2026 county yields: estimates; FSA publishes final yields in fall 2027. ARC-CO payment = shortfall, capped at 12% of benchmark, × 85% × base. Reference prices: FSA 2026 effective reference prices. ${seqNote}`));

  // ---- slide 4: comparison
  const T = R.totals; const progs = ['ARC-CO', 'ARC-IC', 'PLC'].concat(R.mixIsPure ? [] : ['Mix']);
  const max = Math.max(1, ...progs.map((p) => T[p]));
  const colors = { 'ARC-CO': '#1e5b3a', 'ARC-IC': '#3f9a4b', 'PLC': '#d9a441', 'Mix': '#4f9aa8' };
  const nm = (p) => p === 'Mix' ? 'Best ARC-CO/PLC mix' : p;
  const ranked = progs.map((p) => [p, T[p]]).sort((a, b) => b[1] - a[1]);
  const [w, w2] = ranked; const diff = w[1] - (w2 ? w2[1] : 0);
  let t4, s4;
  if (w[1] === 0) { t4 = 'Nothing pays at these numbers'; s4 = 'None of the three programs pay at these prices and yields. Check the price table below to see what it would take.'; }
  else if (diff === 0) { t4 = `${nm(w[0])} and ${nm(w2[0])} tie on this farm`; s4 = 'Both programs come out the same at these numbers.'; }
  else {
    t4 = `Why ${nm(w[0])} wins on this farm`;
    if (ic.capped && allCapped) s4 = 'Both ARC programs hit the 12% cap. ARC-CO pays on 85% of base, ARC-IC only 65%.';
    else s4 = `${nm(w[0])} comes out ${usd0(diff)} ahead of ${nm(w2[0])} at the projected prices.`;
  }
  const sens = sensitivity(crops, opts);
  const priceLbl = (f) => crops.slice(0, 3).map((c) => usd2(f === 1 ? n(c.mya) : r2(n(c.mya) * f)).replace('$', '')).join(' / ');
  const s4body = `<div class="bars">${progs.map((p) => `<div class="lbl">${nm(p)}</div><div class="track"><div class="fill" style="width:${(T[p] / max * 100).toFixed(1)}%;background:${colors[p]}"></div></div><div class="amt">${usd0(T[p])}</div>`).join('')}</div>
    <div class="sect">If the 2026 MYA moves <span>· ${crops.slice(0, 3).map((c) => esc(c.name.toLowerCase()) + ' ±' + usd2(r2(n(c.mya) * 0.05))).join(', ')} per 5%</span></div>
    <div class="scroll"><table class="t sm"><thead><tr class="hd"><th>2026 MYA price</th><th>${crops.slice(0, 3).map((c) => esc(c.name)).join(' / ')}</th><th>ARC-CO</th><th>ARC-IC</th><th>PLC</th>${R.mixIsPure ? '' : '<th>Best mix</th>'}</tr></thead><tbody>
    ${sens.map((s) => `<tr${s.step === 0 ? ' class="shade"' : ''}><td>${s.step === 0 ? 'Projected MYA' : `Prices ${s.step < 0 ? 'down' : 'up'} ${Math.round(Math.abs(s.step) * 100)}%`}</td><td>${priceLbl(1 + s.step)}</td><td class="strong">${usd0(s.totals['ARC-CO'])}</td><td class="strong">${usd0(s.totals['ARC-IC'])}</td><td class="strong">${usd0(s.totals['PLC'])}</td>${R.mixIsPure ? '' : `<td class="strong">${usd0(s.totals['Mix'])}</td>`}</tr>`).join('')}
    </tbody></table></div>
    <p class="lead">${sens.every((s) => s.ic.capped && s.co.rows.every((r) => r.capped)) ? 'Both are at their cap at every price, so the 85% vs 65% decides it, not the farm\'s better yields.' : 'Totals per program across a ±10% range in the national marketing-year average price.'}</p>`;
  out.push(slide(4, 'The comparison', t4, s4, s4body, `Prices are the national marketing-year average (MYA) that ARC and PLC pay on, not local cash. Base: FSA's Nov. 2026 projection, ±5% and ±10%. ARC-CO and PLC are elected crop by crop; ARC-IC covers the whole FSA farm. ${seqNote}`));

  // ---- slide 5: takeaways
  const edge = R.farmVsCounty, need = R.breakEvenEdge;
  const left = [];
  if (fy >= 0.15 && T['ARC-CO'] >= T['ARC-IC']) left.push(['A bad year doesn\'t mean ARC-IC', `This farm's yields fell ${pct(fy)}, but the county drop of ${pct(Math.max(0, cy))} was enough for ARC-CO to ${allCapped ? 'max out' : 'pay more'}.`]);
  if (ic.capped && allCapped) left.push(['85% of base beats 65%', `With both at the cap, ARC-CO pays on 85% of base and ARC-IC on 65%. That's a ${usd0(Math.abs(T['ARC-CO'] - T['ARC-IC']))} difference.`]);
  left.push([T['ARC-IC'] > T['ARC-CO'] ? 'Farm history carries ARC-IC' : 'Better history wasn\'t enough', `This farm's benchmark is about ${pct(Math.abs(edge))} ${edge >= 0 ? 'above' : 'below'} the county's. With both programs at their caps, it would need about ${pct(need)} for ARC-IC to win.`]);
  if (pl.payment > 0 || T['PLC'] >= T['ARC-CO']) left.push(['PLC is in play', `PLC pays ${usd0(T['PLC'])} because ${pl.rows.filter((r) => r.rate > 0).map((r) => esc(r.name.toLowerCase())).join(' and ') || 'no crop'} is projected under its reference price.`]);
  else left.push(['PLC needs lower prices', `PLC pays nothing until prices drop under ${pl.rows.map((r) => `${usd2(r.erp)} ${esc(r.name.toLowerCase())}`).join(', ')}.`]);
  const right = [
    ['1. Look at the whole county', 'If most of the county got hit too, ARC-CO is in the running.'],
    ['2. Compare your benchmark to the county\'s', `If your normal revenue per acre isn't about ${pct(need)} higher, a maxed-out ARC-CO usually wins.`],
    ['3. Run all three on each FSA farm', 'ARC-IC covers the whole farm. ARC-CO and PLC can be mixed crop by crop. Check the election deadline with your county FSA office.'],
  ];
  const s5body = `<div class="cols"><div><h5>What this example shows</h5>${left.slice(0, 3).map(([a, b]) => `<div class="pt"><b>${a}</b><span>${b}</span></div>`).join('')}</div>
    <div><h5>How to check your own farms</h5>${right.map(([a, b]) => `<div class="pt"><b>${a}</b><span>${b}</span></div>`).join('')}</div></div>
    <div class="cta"><b>Best estimate here: ${nm(w[0])}, ${usd0(w[1])}.</b> ${w2 ? `Next: ${nm(w2[0])}, ${usd0(w2[1])}.` : ''}</div>`;
  out.push(slide(5, 'Takeaways', 'What this means for your farm', '', s5body, `2026 production is certified to FSA by July 15, 2027; payments after Oct. 1, 2027. ${seqNote} Estimates only, not a USDA determination.`));

  $('#slides').innerHTML = out.join('');
}

function renderTiles(R) {
  const T = R.totals; const progs = ['ARC-CO', 'ARC-IC', 'PLC'].concat(R.mixIsPure ? [] : ['Mix']);
  const best = Math.max(...progs.map((p) => T[p]));
  const sub = { 'ARC-CO': 'County revenue · 85% of base', 'ARC-IC': 'Farm revenue · 65% of base', 'PLC': 'Price only · 85% of base', 'Mix': R.mixRows.map((r) => `${r.name}: ${r.co === r.plc ? 'either' : r.pick}`).join(' · ') };
  const tiles = progs.map((p) => `<div class="tile${T[p] === best && best > 0 ? ' win' : ''}"><div class="k">${p === 'Mix' ? 'Best mix by crop' : p}${T[p] === best && best > 0 ? ' · best' : ''}</div><div class="v">${usd0(T[p])}</div><div class="s">${esc(sub[p])}</div></div>`);
  if (R.mixIsPure) tiles.push(`<div class="tile"><div class="k">Difference</div><div class="v">${usd0(Math.abs(T['ARC-CO'] - T['ARC-IC']))}</div><div class="s">ARC-CO vs ARC-IC</div></div>`);
  $('#tiles').innerHTML = tiles.join('');
}

/* ---------------- export ---------------- */
async function exportSlide(i) {
  if (!window.html2canvas) { alert('The image tool is still loading. Try again in a moment.'); return; }
  const src = document.getElementById('slide-' + i); const stage = $('#exportStage');
  stage.innerHTML = ''; const clone = src.cloneNode(true); clone.id = ''; stage.appendChild(clone);
  if (document.fonts && document.fonts.ready) await document.fonts.ready;
  const canvas = await window.html2canvas(clone, { scale: 1.5, backgroundColor: '#f9f9f6', width: 1280, height: 720, windowWidth: 1280, logging: false });
  stage.innerHTML = '';
  const a = document.createElement('a');
  const slug = (state.farmName || 'baseacre').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'baseacre';
  a.download = `${slug}-arc-plc-${i}of5.png`; a.href = canvas.toDataURL('image/png');
  document.body.appendChild(a); a.click(); a.remove();
}
window.__exportSlide = exportSlide;

function init() {
  state = load();
  $('#sources').innerHTML = Object.values(SOURCES).map((s) => `<li><a href="${s.url}" target="_blank" rel="noopener">${esc(s.label)}</a></li>`).join('') +
    '<li>Example: Cropland\'s "ARC-IC Scenario #3" slides (Cass County, ND), posted by Justin Frye on X. Used to check the math.</li>';
  wireEditor(); renderEditor(); renderOutput();
  $('#slides').addEventListener('click', (e) => { const i = e.target.dataset.png; if (i) { e.target.disabled = true; exportSlide(+i).finally(() => { e.target.disabled = false; }); } });
  $('#btnExportAll').addEventListener('click', async (e) => { e.target.disabled = true; try { for (let i = 1; i <= 5; i++) await exportSlide(i); } finally { e.target.disabled = false; } });
  $('#btnPrint').addEventListener('click', () => window.print());
}
init();
