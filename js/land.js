import { ruleOutTargets, matches, freshFilters, Hidden, SORTS, activeFilterCount, perAcre, ACRE_PRESETS, presetFor, applyPreset, acreLabel, statesOf, OUTSIDE, stateCounts, newSearch, uniqueName, duplicateSearch, removeSearch, migrateStore, exportSearch, importSearch } from './landcore.js';

const KEY = 'baseacre:land:v1';   // same key; contents migrate to v2 (separate searches) on first load
const $ = (s, el = document) => el.querySelector(s);
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const fmt$ = (x) => x == null ? '—' : '$' + Math.round(x).toLocaleString('en-US');
const PAGE = 60;

/* ---------- state ----------
   STORE.searches = separate searches (tabs). Each has its own filters, ruled-out list, sort and map view.
   S.filters / hidden / S.sort / S.view are the live copies of the active search; syncOut() writes them back. */
function readRaw() { try { return JSON.parse(localStorage.getItem(KEY)) || {}; } catch (e) { return {}; } }
const STORE = migrateStore(readRaw());
let A = STORE.searches.find((x) => x.id === STORE.active);
const S = { mode: STORE.mode, color: STORE.color, base: STORE.base, showHidden: STORE.showHidden, inView: STORE.inView,
  filters: JSON.parse(JSON.stringify(A.filters)), sort: A.sort, view: A.view };
const hidden = new Hidden(A.hidden);
function syncOut() { A.filters = JSON.parse(JSON.stringify(S.filters)); A.hidden = hidden.toJSON().slice(); A.sort = S.sort; A.view = S.view; }
function persist() {
  syncOut();
  const out = { v: 2, searches: STORE.searches, active: A.id, mode: S.mode, color: S.color, base: S.base, showHidden: S.showHidden, inView: S.inView };
  try { localStorage.setItem(KEY, JSON.stringify(out)); } catch (e) {}
}
let saveT;
function save() { clearTimeout(saveT); saveT = setTimeout(() => { persist(); renderTabs(); }, 200); }
persist();   // write the migrated (v2) form right away
window.__land = { S, hidden, STORE, get active() { return A; } };

/* ---------- tabs ---------- */
let map, ready = false;
function route() {
  const arc = location.hash === '#arc';
  $('#view-land').hidden = arc; $('#view-arc').hidden = !arc;
  $('#tabLand').classList.toggle('on', !arc); $('#tabArc').classList.toggle('on', arc);
  document.body.classList.toggle('view-land', !arc);
  if (!arc && map) setTimeout(() => map.invalidateSize(), 50);
}
window.addEventListener('hashchange', route);
route();

/* ---------- colors ---------- */
const SCALES = {
  nccpi: { title: 'Soil productivity (NCCPI, 0–100)', key: 'nccpi', stops: [[0, '#b8432f', 'under 35'], [35, '#e08a3c', '35–44'], [45, '#e8c547', '45–54'], [55, '#8fbf3a', '55–64'], [65, '#1e7a3e', '65+']] },
  crop: { title: 'Cropland in 2025 (CDL)', key: 'crop', stops: [[0, '#8a6d4a', 'under 50%'], [50, '#d9a441', '50–74%'], [75, '#a7c957', '75–89%'], [90, '#2e7d32', '90%+']] },
};
const OTYPE_COLORS = { 'Individual': '#3f7fbf', 'Business / farm entity': '#d9822b', 'Trust': '#8e5bd1', 'Government / public': '#2e9e8f', 'Estate': '#c0447a', 'Church / nonprofit': '#7a7a3a', 'Unknown': '#888' };
function colorOf(p) {
  if (S.color === 'otype') return OTYPE_COLORS[p.otype] || '#888';
  const sc = SCALES[S.color]; const v = p[sc.key];
  if (v == null) return '#9a9a9a';
  let c = sc.stops[0][1]; for (const [t, col] of sc.stops) if (v >= t) c = col; return c;
}
function renderLegend() {
  let h;
  if (S.color === 'otype') h = `<b>Owner type (from owner name)</b>` + Object.entries(OTYPE_COLORS).map(([k, c]) => `<div><i style="background:${c}"></i>${k}</div>`).join('');
  else { const sc = SCALES[S.color]; h = `<b>${sc.title}</b>` + sc.stops.map(([, c, l]) => `<div><i style="background:${c}"></i>${l}</div>`).join('') + `<div><i style="background:#9a9a9a"></i>no data</div>`; }
  if (S.showHidden) h += `<div><i style="background:#fff;border:2px dashed #b8432f"></i>ruled out</div>`;
  $('#legend').innerHTML = h;
  $('#legend').onclick = () => $('#legend').classList.toggle('min');
}

/* ---------- data ---------- */
let P = [];                 // parcel properties
const FEAT = new Map();     // id -> feature
const BBOX = new Map();     // id -> [minx,miny,maxx,maxy]
const LAYERS = new Map();   // id -> leaflet layer (only drawn ones)
function bboxOf(g) {
  let a = Infinity, b = Infinity, c = -Infinity, d = -Infinity;
  const walk = (o) => { if (typeof o[0] === 'number') { a = Math.min(a, o[0]); b = Math.min(b, o[1]); c = Math.max(c, o[0]); d = Math.max(d, o[1]); } else o.forEach(walk); };
  walk(g.coordinates); return [a, b, c, d];
}

/* ---------- map ---------- */
let parcelLayer, baseLayers, curBase, renderer;
const isHover = window.matchMedia && matchMedia('(hover: hover) and (pointer: fine)').matches;
function initMap() {
  map = L.map('map', { preferCanvas: true, doubleClickZoom: false, zoomSnap: 0.5, attributionControl: true });
  renderer = L.canvas({ padding: 0.4, tolerance: 2 });
  baseLayers = {
    sat: L.layerGroup([
      L.tileLayer('https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}', { maxZoom: 19, attribution: 'Imagery © Esri, Maxar, Earthstar Geographics, USDA FSA, USGS' }),
      L.tileLayer('https://server.arcgisonline.com/ArcGIS/rest/services/Reference/World_Transportation/MapServer/tile/{z}/{y}/{x}', { maxZoom: 19, opacity: 0.7 }),
      L.tileLayer('https://server.arcgisonline.com/ArcGIS/rest/services/Reference/World_Boundaries_and_Places/MapServer/tile/{z}/{y}/{x}', { maxZoom: 19 }),
    ]),
    osm: L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', { maxZoom: 19, attribution: '© OpenStreetMap contributors' }),
  };
  setBase(S.base);
  if (S.view) map.setView(S.view.c, S.view.z); else map.fitBounds([[45.85, -97.30], [46.67, -96.15]]);
  parcelLayer = L.geoJSON(null, { renderer, style: styleFor, onEachFeature: (f, l) => {
    LAYERS.set(f.properties.id, l);
    l.on('click', (e) => { L.DomEvent.stop(e); onParcelTap(f.properties.id); });
    if (isHover) l.bindTooltip(() => tipHtml(f.properties), { sticky: true, className: 'ptip', direction: 'top', offset: [0, -6] });
  } }).addTo(map);
  map.on('moveend', () => { S.view = { c: [map.getCenter().lat, map.getCenter().lng], z: map.getZoom() }; save(); if (S.inView) renderList(); });
  const Fit = L.Control.extend({ options: { position: 'topleft' }, onAdd() { const a = L.DomUtil.create('a', 'leaflet-bar fit-btn'); a.href = '#'; a.title = 'Show both counties'; a.setAttribute('role', 'button'); a.textContent = 'Both counties';
    L.DomEvent.on(a, 'click', (e) => { L.DomEvent.stop(e); map.fitBounds([[45.85, -97.30], [46.67, -96.15]]); }); return a; } });
  new Fit().addTo(map);
  map.attributionControl.addAttribution('Parcels: MnGeo, NDGISHub · Soils: USDA NRCS · CDL: USDA NASS');
}
function setBase(k) { if (curBase) map.removeLayer(curBase); curBase = baseLayers[k] || baseLayers.sat; curBase.addTo(map); curBase.bringToBack?.(); }
function styleFor(f) {
  const p = f.properties;
  if (hidden.has(p.id)) return { color: '#b8432f', weight: 1.5, dashArray: '4 4', fillColor: '#ffffff', fillOpacity: 0.25, opacity: 0.9 };
  const sat = S.base === 'sat';
  return { color: sat ? '#ffffff' : '#334', weight: map && map.getZoom() >= 13 ? 1.2 : 0.6, opacity: sat ? 0.85 : 0.6, fillColor: colorOf(p), fillOpacity: sat ? 0.45 : 0.55 };
}
function tipHtml(p) {
  return `<b>${p.ac} ac · ${esc(p.twp || p.co)}</b><br>${esc(whoLine(p))}<br>NCCPI ${p.nccpi ?? '—'} · cropland ${p.crop ?? '—'}% · ${esc(p.c25 || 'no main crop')}<br><span style="color:#b8432f">${S.mode === 'out' ? (hidden.has(p.id) ? 'Click to restore' : 'Click to rule out') : 'Click for details'}</span>`;
}

/* ---------- filtering + drawing ---------- */
let visible = [];  // parcels passing filters (incl. ruled-out ones when showHidden)
function compute() {
  const f = S.filters;
  visible = P.filter((p) => matches(p, f) && (S.showHidden || !hidden.has(p.id)));
}
function redraw() {
  compute();
  LAYERS.clear(); parcelLayer.clearLayers();
  parcelLayer.addData({ type: 'FeatureCollection', features: visible.map((p) => FEAT.get(p.id)) });
  renderCounts(); renderList(); renderLegend();
}
function renderCounts() {
  const shown = visible.filter((p) => !hidden.has(p.id)).length;
  const matchingHidden = P.filter((p) => hidden.has(p.id) && matches(p, S.filters)).length;
  $('#lcShown').textContent = shown.toLocaleString('en-US');
  const total = P.length;
  $('#lcOf').textContent = `of ${total.toLocaleString('en-US')}` + (S.filters.acMin !== '' || S.filters.acMax !== '' ? ` · ${acreLabel(S.filters)}` : '') + (activeFilterCount(S.filters) ? ' · filtered' : '') + (matchingHidden ? ` · ${matchingHidden.toLocaleString('en-US')} ruled out here` : '');
  $('#lcHidden').textContent = hidden.size.toLocaleString('en-US');
  const rb = $('#lbRuleAll'); rb.hidden = !shown; rb.disabled = !shown; $('#lbRuleAllN').textContent = shown.toLocaleString('en-US');
  rb.setAttribute('aria-label', `Rule out all ${shown} parcels in this search`);
  $('#lbUndo').disabled = !hidden.size; $('#lbRestore').disabled = !hidden.size;
  const n = activeFilterCount(S.filters); $('#fCount').textContent = n ? n : '';
}

/* ---------- deselect ---------- */
function onParcelTap(id) {
  if (S.mode === 'inspect') { showInspect(id); return; }
  if (hidden.has(id)) restoreOne(id); else hideOne(id);
}
function hideOne(id) {
  if (!hidden.hide(id)) return;
  const l = LAYERS.get(id);
  if (l) { if (S.showHidden) l.setStyle(styleFor(FEAT.get(id))); else { parcelLayer.removeLayer(l); LAYERS.delete(id); } }
  if (!S.showHidden) visible = visible.filter((p) => p.id !== id);
  const li = document.querySelector(`.pi[data-id="${CSS.escape(id)}"]`);
  if (li) { if (S.showHidden) li.classList.add('ruled'); else li.remove(); }
  if ($('#inspect').dataset.id === id && !S.showHidden) $('#inspect').hidden = true;
  save(); renderCounts(); toast(id); topUpList();
}
function restoreOne(id, redrawAll = false) {
  if (!hidden.restore(id)) return;
  save();
  if (S.showHidden && !redrawAll) {
    const l = LAYERS.get(id); if (l) l.setStyle(styleFor(FEAT.get(id)));
    const li = document.querySelector(`.pi[data-id="${CSS.escape(id)}"]`); if (li) li.classList.remove('ruled');
    renderCounts();
  } else redraw();
}
// Last bulk "Rule out all" in this tab, so Undo restores exactly that batch.
let lastBatch = null;
function batchIsLast() { return lastBatch && lastBatch.length && hidden.last() === lastBatch[lastBatch.length - 1]; }
function ruleOutAll() {
  const ids = ruleOutTargets(P, S.filters, hidden); if (!ids.length) return;
  const done = hidden.hideMany(ids); lastBatch = done;
  save(); redraw();
  const t = $('#toast');
  t.innerHTML = `<span>Ruled out ${done.length.toLocaleString('en-US')} parcels</span><button type="button" id="toastUndo">Undo</button>`;
  t.hidden = false; clearTimeout(toastT); toastT = setTimeout(hideToast, 8000);
  $('#toastUndo').onclick = (e) => { e.stopPropagation(); undoBatch(); };
}
function undoBatch() {
  if (!lastBatch) return; const n = hidden.restoreMany(lastBatch); lastBatch = null;
  save(); redraw(); hideToast(); if (n) toastMsg(`Restored ${n.toLocaleString('en-US')} parcels`);
}
function undo() {
  if (batchIsLast()) { undoBatch(); return; }
  const id = hidden.undo(); if (!id) return;
  save(); redraw(); flash(id); hideToast();
}
let toastT;
function toast(id) {
  const p = FEAT.get(id).properties; const t = $('#toast');
  t.innerHTML = `<span>Ruled out ${p.ac} ac · ${esc(p.twp || p.co)}</span><button type="button" id="toastUndo">Undo</button>`;
  t.hidden = false; clearTimeout(toastT); toastT = setTimeout(hideToast, 4000);
  $('#toastUndo').onclick = (e) => { e.stopPropagation(); undo(); };
}
function toastMsg(m) { const t = $('#toast'); t.innerHTML = `<span>${esc(m)}</span>`; t.hidden = false; clearTimeout(toastT); toastT = setTimeout(hideToast, 2500); }
function hideToast() { $('#toast').hidden = true; }
function flash(id) {
  const l = LAYERS.get(id); if (!l) return;
  l.setStyle({ color: '#ffeb3b', weight: 4 }); setTimeout(() => l.setStyle(styleFor(FEAT.get(id))), 900);
}

/* ---------- list ---------- */
let listShown = PAGE, listItems = [];
function inBounds(p, b) { const x = BBOX.get(p.id); return x[2] >= b.getWest() && x[0] <= b.getEast() && x[3] >= b.getSouth() && x[1] <= b.getNorth(); }
function renderList(reset = true) {
  if (reset) listShown = PAGE;
  const b = map.getBounds();
  listItems = visible.filter((p) => !S.inView || inBounds(p, b)).sort(SORTS[S.sort] || SORTS.nccpi);
  const ul = $('#plist');
  ul.innerHTML = listItems.length ? listItems.slice(0, listShown).map(liHtml).join('') : `<li class="empty">No parcels match${S.inView ? ' in this map view. Zoom out or turn off "Only what\'s on the map"' : ''}.</li>`;
  $('#lMore').hidden = listItems.length <= listShown;
  $('#lMore').textContent = `Show more (${(listItems.length - listShown).toLocaleString('en-US')} left)`;
}
function topUpList() {
  // keep the list full after removing a row
  const ul = $('#plist'); const have = ul.querySelectorAll('.pi').length;
  listItems = listItems.filter((p) => S.showHidden || !hidden.has(p.id));
  if (have < Math.min(listShown, listItems.length)) {
    const ids = new Set([...ul.querySelectorAll('.pi')].map((x) => x.dataset.id));
    const add = listItems.slice(0, listShown).filter((p) => !ids.has(p.id));
    ul.insertAdjacentHTML('beforeend', add.map(liHtml).join(''));
  }
  if (!listItems.length) renderList();
  $('#lMore').hidden = listItems.length <= listShown;
}
function liHtml(p) {
  const r = hidden.has(p.id);
  const pa = perAcre(p);
  return `<li class="pi${r ? ' ruled' : ''}" data-id="${esc(p.id)}"><span class="sw" style="background:${colorOf(p)}"></span>
    <div class="main"><div class="t"><span class="acbig">${p.ac.toLocaleString('en-US')} ac</span> <small>${esc(p.twp || '')} · ${esc(p.co)} Co.</small></div>
    <div class="o">${nameHtml(p)}${p.otype && p.otype !== 'Individual' ? ` <span class="ot">· ${esc(p.otype)}</span>` : ''}</div>
    <div class="m"><span>NCCPI ${p.nccpi ?? '—'}</span><span>Crop ${p.crop ?? '—'}%</span><span>Class I–II ${p.lcc12 ?? '—'}%</span>${p.c25 ? `<span>2025 ${esc(p.c25)}</span>` : ''}${isFinite(pa) ? `<span>${fmt$(pa)}/ac ${p.co === 'Wilkin' ? 'EMV' : 'roll'}</span>` : ''}</div></div>
    <div class="acts"><button type="button" data-act="zoom" title="Zoom to parcel" aria-label="Zoom to parcel"><svg viewBox="0 0 24 24" width="16" height="16" aria-hidden="true"><circle cx="12" cy="12" r="7" fill="none" stroke="currentColor" stroke-width="2"/><circle cx="12" cy="12" r="2" fill="currentColor"/><path d="M12 1v4M12 19v4M1 12h4M19 12h4" stroke="currentColor" stroke-width="2"/></svg></button><button type="button" data-act="info" title="Details" aria-label="Details">i</button></div></li>`;
}

function whoLine(p) {
  if (p.own && p.tp && p.own !== p.tp) return `Owner ${p.own} · Taxpayer ${p.tp}`;
  if (p.tp && !p.own) return `Taxpayer ${p.tp}`;
  return p.own || p.tp || 'Owner not listed';
}
function hl(txt) {
  const q = (S.filters.name || '').trim(); const e = esc(txt); if (!q) return e;
  const i = txt.toLowerCase().indexOf(q.toLowerCase()); if (i < 0) return e;
  return esc(txt.slice(0, i)) + '<mark>' + esc(txt.slice(i, i + q.length)) + '</mark>' + esc(txt.slice(i + q.length));
}
function nameHtml(p) {
  const st = (x) => x ? ` <span class="st">${esc(x)}</span>` : '';
  const parts = [];
  if (p.own) parts.push(`<span class="lbl">Owner</span> ${hl(p.own)}${st(p.ost)}`);
  if (p.tp) parts.push(`<span class="lbl">Taxpayer</span> ${hl(p.tp)}${st(p.tst)}`);
  return parts.join('<br>') || 'Owner not listed';
}

/* ---------- inspect ---------- */
function showInspect(id) {
  const p = FEAT.get(id).properties; const box = $('#inspect');
  const pa = perAcre(p);
  const row = (k, v, src) => v == null || v === '' ? '' : `<dt>${k}</dt><dd>${v}${src ? ` <small>${src}</small>` : ''}</dd>`;
  box.dataset.id = id;
  box.innerHTML = `<h4><span>${esc(p.twp || '')}, ${esc(p.co)} Co.</span><button class="btn icon ghost" type="button" data-x>Close</button></h4>
    <div class="acres-hero" id="inspAcres">${p.ac.toLocaleString('en-US')} acres<small>GIS${p.dac != null ? ` · ${p.dac.toLocaleString('en-US')} deeded` : ''}</small></div><dl>
    ${row('Owner', esc(p.own || (p.co === 'Wilkin' ? 'Not published (taxpayer only)' : 'Not listed')), p.co === 'Wilkin' ? 'owner_name, MnGeo' : 'tax roll owner/mailing name, NDGISHub')}
    ${row('Owner mail state', esc(p.ost || (p.own ? 'Unknown' : '')), p.co === 'Richland' ? 'tax roll' : 'owner address')}
    ${p.co === 'Wilkin' ? row('Taxpayer', esc(p.tp || 'Not listed'), 'tax_name, MnGeo') + row('Taxpayer mail state', esc(p.tst || 'Unknown'), 'tax address') : row('Taxpayer', 'Not published separately', 'ND roll lists one owner/mailing name')}
    ${row('Owner type', esc(p.otype), 'guessed from name')}
    ${row('Mailing states', esc(statesOf(p).join(', ')), p.absentee ? 'outside MN/ND' : '')}
    ${row('Parcel ID', esc(p.pin))}
    ${row('Legal', esc(p.legal))}
    ${row('Sec-Twp-Rng', esc(p.str))}
    ${row('GIS acres', p.ac)}${row('Deeded acres', p.dac)}
    ${row('Assessor class', esc(p.cls))}
    ${row(p.co === 'Wilkin' ? 'Est. market value' : 'Total value (roll)', fmt$(p.val), p.co === 'Wilkin' ? 'EMV' : 'county tax roll')}
    ${row(p.co === 'Wilkin' ? 'Land EMV' : 'Ag land value', p.lval != null ? `${fmt$(p.lval)}${isFinite(pa) ? ` · ${fmt$(pa)}/ac` : ''}` : null)}
    ${row('NCCPI', p.nccpi, 'SSURGO, area-weighted')}
    ${row('Class I–II soils', p.lcc12 != null ? p.lcc12 + '%' : null, 'non-irrigated LCC')}
    ${row('Main soil', esc(p.soil))}
    ${row('Cropland 2025', p.crop != null ? p.crop + '%' : null, 'NASS CDL')}
    ${row('Main crop 2025', esc(p.c25), 'NASS CDL')}
  </dl><div class="row wrap">
    <button class="btn sm" type="button" data-act="zoom">Zoom</button>
    <button class="btn sm ${hidden.has(id) ? '' : 'danger'}" type="button" data-act="toggle">${hidden.has(id) ? 'Restore' : 'Rule out'}</button>
    <button class="btn sm primary" type="button" data-act="arc">ARC/PLC for ${esc(p.co)} Co.</button></div>`;
  box.hidden = false;
  box.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
  flash(id);
}
function zoomTo(id) { const b = BBOX.get(id); map.fitBounds([[b[1], b[0]], [b[3], b[2]]], { maxZoom: 16, padding: [30, 30] }); setTimeout(() => flash(id), 400); }

/* ---------- filters UI ---------- */
function chipGroup(el, values, key) {
  el.innerHTML = values.map(([v, label, n]) => `<button type="button" data-v="${esc(v)}" class="${S.filters[key].includes(v) ? 'on' : ''}">${esc(label)} <small>${n.toLocaleString('en-US')}</small></button>`).join('');
  el.onclick = (e) => { const b = e.target.closest('button'); if (!b) return; const v = b.dataset.v; const arr = S.filters[key];
    const i = arr.indexOf(v); if (i >= 0) arr.splice(i, 1); else arr.push(v); b.classList.toggle('on'); changed(); };
}
function checkGroup(el, groups, key, countEl) {
  el.innerHTML = groups.map(([g, items]) => `<h6>${esc(g)}</h6>` + items.map(([v, label, n]) => `<label><input type="checkbox" value="${esc(v)}" ${S.filters[key].includes(v) ? 'checked' : ''}> ${esc(label)} <small>${n.toLocaleString('en-US')}</small></label>`).join('')).join('');
  const upd = () => { countEl.textContent = S.filters[key].length || ''; };
  el.onchange = (e) => { const v = e.target.value; const arr = S.filters[key]; const i = arr.indexOf(v); if (e.target.checked && i < 0) arr.push(v); if (!e.target.checked && i >= 0) arr.splice(i, 1); upd(); changed(); };
  upd();
}
const count = (arr, fn) => { const m = new Map(); arr.forEach((p) => { const k = fn(p); m.set(k, (m.get(k) || 0) + 1); }); return m; };
function buildFilterUI() {
  const f = S.filters;
  $('#fCounty').value = f.county; renderSize();
  $('#fNc').value = f.ncMin; $('#fCrop').value = f.cropMin; $('#fLcc').value = f.lccMin; $('#fQ').value = f.q; $('#fName').value = f.name || ''; renderStates();
  $('#fColor').value = S.color; $('#fBase').value = S.base; $('#lSort').value = S.sort || 'nccpi'; $('#lInView').checked = S.inView; $('#lbShowHidden').checked = S.showHidden;
  sliderLabels();
  const ot = count(P, (p) => p.otype); chipGroup($('#fOtype'), [...ot].sort((a, b) => b[1] - a[1]).map(([k, n]) => [k, k, n]), 'otypes');
  const cr = count(P, (p) => p.c25 || 'None'); chipGroup($('#fCrops'), [...cr].sort((a, b) => b[1] - a[1]).filter(([, n]) => n >= 10).map(([k, n]) => [k, k === 'None' ? 'No main crop' : k, n]), 'crops');
  const grp = (fn, label) => ['Wilkin', 'Richland'].map((co) => { const m = count(P.filter((p) => p.co === co), fn); return [`${co} County, ${co === 'Wilkin' ? 'MN' : 'ND'}`, [...m].sort((a, b) => String(a[0]).localeCompare(String(b[0]))).map(([k, n]) => [co + '|' + (k || ''), label(k), n])]; });
  checkGroup($('#fTwps'), grp((p) => p.twp || '', (k) => k || '(no township)'), 'twps', $('#fTwpCount'));
  checkGroup($('#fClasses'), grp((p) => p.cls, (k) => k), 'classes', $('#fClsCount'));
}
/* ---------- parcel size + saved searches ---------- */
function renderSize() {
  const f = S.filters, k = presetFor(f);
  $('#fSize').innerHTML = ACRE_PRESETS.map((p) => `<button type="button" data-k="${p.key}" class="${p.key === k ? 'on' : ''}" aria-pressed="${p.key === k}">${p.label}${p.sub ? `<small>${p.sub}</small>` : '<small>no limit</small>'}</button>`).join('');
  $('#vSize').textContent = acreLabel(f) + (k === 'custom' ? ' (custom)' : '');
  $('#fAcMin').value = f.acMin ?? ''; $('#fAcMax').value = f.acMax ?? '';
}
/* ---------- search tabs ---------- */
function renderTabs() {
  $('#stabList').innerHTML = STORE.searches.map((x) => {
    const on = x.id === A.id; const n = on ? hidden.size : x.hidden.length;
    return `<button type="button" role="tab" class="stab${on ? ' on' : ''}" aria-selected="${on}" data-id="${esc(x.id)}" title="${esc(x.name)}"><span class="nm">${esc(x.name)}</span>${n ? `<span class="hn" title="ruled out">${n.toLocaleString('en-US')}</span>` : ''}</button>`;
  }).join('');
  const t = $('#stabList .stab.on'); if (t) t.scrollIntoView({ block: 'nearest', inline: 'nearest' });
}
function switchTo(id) {
  if (id === A.id) return;
  const next = STORE.searches.find((x) => x.id === id); if (!next) return;
  clearTimeout(saveT); syncOut();
  A = next; loadActive();
}
function loadActive() {
  for (const k of Object.keys(S.filters)) delete S.filters[k];
  Object.assign(S.filters, JSON.parse(JSON.stringify(A.filters)));
  hidden.reset(A.hidden); S.sort = A.sort; lastBatch = null;
  $('#inspect').hidden = true; hideToast();
  buildFilterUI();
  if (A.view) { S.view = A.view; map.setView(A.view.c, A.view.z, { animate: false }); } else S.view = A.view = { c: [map.getCenter().lat, map.getCenter().lng], z: map.getZoom() };
  redraw(); persist(); renderTabs();
}
function addSearch(s) { STORE.searches.push(s); switchTo(s.id); }
function searchMenu(m) {
  if (m === 'rename') {
    const n = (prompt('Rename this search:', A.name) || '').trim(); if (!n || n === A.name) return;
    A.name = uniqueName(STORE.searches.filter((x) => x !== A), n.slice(0, 60)); persist(); renderTabs();
  } else if (m === 'dup') {
    syncOut(); const d = duplicateSearch(STORE.searches, A.id); switchTo(d.id); toastMsg(`Duplicated as “${d.name}”`);
  } else if (m === 'export') {
    syncOut();
    const blob = new Blob([JSON.stringify(exportSearch(A), null, 1)], { type: 'application/json' });
    const a = document.createElement('a'); a.href = URL.createObjectURL(blob);
    a.download = 'baseacre-search-' + A.name.replace(/[^a-z0-9]+/gi, '-').replace(/^-|-$/g, '').toLowerCase() + '.json';
    document.body.appendChild(a); a.click(); setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 500);
  } else if (m === 'import') {
    $('#sImportFile').value = ''; $('#sImportFile').click();
  } else if (m === 'delete') {
    if (!confirm(`Delete the search “${A.name}” and its ${hidden.size} ruled-out parcels? Other searches aren't affected.`)) return;
    clearTimeout(saveT);
    const nextId = removeSearch(STORE.searches, A.id);
    A = STORE.searches.find((x) => x.id === nextId); loadActive();
  }
}
/* ---------- mailing states ---------- */
let STATE_COUNTS = [], stMore = false;
function renderStates() {
  const f = S.filters; const sel = new Set(f.states || []);
  const out = P.filter((p) => p.absentee === true).length;
  const top = stMore ? STATE_COUNTS : STATE_COUNTS.filter(([k], i) => i < 8 || sel.has(k));
  $('#fStates').innerHTML = `<button type="button" data-v="__out" class="out${f.absentee ? ' on' : ''}" aria-pressed="${!!f.absentee}">Outside MN/ND <small>${out.toLocaleString('en-US')}</small></button>` +
    top.map(([k, n]) => `<button type="button" data-v="${esc(k)}" class="${sel.has(k) ? 'on' : ''}" aria-pressed="${sel.has(k)}">${esc(k)} <small>${n.toLocaleString('en-US')}</small></button>`).join('');
  $('#fStMore').textContent = stMore ? 'Fewer states' : `All ${STATE_COUNTS.length} states…`;
  $('#fStCount').textContent = (sel.size + (f.absentee ? 1 : 0)) || '';
}
function sliderLabels() {
  const f = S.filters;
  $('#vNc').textContent = f.ncMin > 0 ? f.ncMin : 'any'; $('#vCrop').textContent = f.cropMin > 0 ? f.cropMin + '%' : 'any'; $('#vLcc').textContent = f.lccMin > 0 ? f.lccMin + '%' : 'any';
}
let chT;
function changed(now = false) { save(); clearTimeout(chT); chT = setTimeout(redraw, now ? 0 : 120); }
function wire() {
  const f = S.filters;
  $('#fCounty').onchange = (e) => { f.county = e.target.value; changed(true); if (f.county !== 'all') { const cs = COUNTY_BOUNDS[f.county]; map.fitBounds(cs); } };
  const sizeTxt = () => { const k = presetFor(f); $('#vSize').textContent = acreLabel(f) + (k === 'custom' ? ' (custom)' : ''); document.querySelectorAll('#fSize button').forEach((b) => { b.classList.toggle('on', b.dataset.k === k); b.setAttribute('aria-pressed', b.dataset.k === k); }); };
  $('#fAcMin').oninput = (e) => { f.acMin = e.target.value; sizeTxt(); changed(); };
  $('#fAcMax').oninput = (e) => { f.acMax = e.target.value; sizeTxt(); changed(); };
  $('#fSize').onclick = (e) => { const b = e.target.closest('button'); if (!b) return; applyPreset(f, b.dataset.k); renderSize(); changed(true); };
  $('#stabList').onclick = (e) => { const b = e.target.closest('.stab'); if (b) switchTo(b.dataset.id); };
  $('#sNew').onclick = () => {
    const n = (prompt('Name the new search:', uniqueName(STORE.searches, 'Search ' + (STORE.searches.length + 1))) || '').trim(); if (!n) return;
    syncOut(); const v = { c: [map.getCenter().lat, map.getCenter().lng], z: map.getZoom() };
    addSearch(newSearch(uniqueName(STORE.searches, n), { view: v })); toastMsg(`New search “${A.name}” — fresh filters, nothing ruled out`);
  };
  const menu = $('#sMenu'), mb = $('#sMenuBtn');
  const closeMenu = () => { menu.hidden = true; mb.setAttribute('aria-expanded', 'false'); };
  mb.onclick = (e) => { e.stopPropagation(); menu.hidden = !menu.hidden; mb.setAttribute('aria-expanded', String(!menu.hidden)); };
  menu.onclick = (e) => { const b = e.target.closest('[data-m]'); if (!b) return; closeMenu(); searchMenu(b.dataset.m); };
  document.addEventListener('click', (e) => { if (!menu.hidden && !e.target.closest('.smenu-wrap')) closeMenu(); });
  $('#sImportFile').onchange = async (e) => {
    const file = e.target.files[0]; if (!file) return;
    try { const txt = await file.text(); syncOut(); const s2 = importSearch(STORE.searches, txt); STORE.searches.pop(); addSearch(s2); toastMsg(`Imported “${s2.name}” (${s2.hidden.length} ruled out)`); }
    catch (err) { alert('Could not import that file: ' + err.message); }
  };
  $('#fName').oninput = (e) => { f.name = e.target.value; changed(); };
  $('#fStates').onclick = (e) => {
    const b = e.target.closest('button'); if (!b) return; const v = b.dataset.v;
    if (v === '__out') f.absentee = !f.absentee;
    else { f.states = f.states || []; const i = f.states.indexOf(v); if (i >= 0) f.states.splice(i, 1); else f.states.push(v); }
    renderStates(); changed(true);
  };
  $('#fStMore').onclick = () => { stMore = !stMore; renderStates(); };
  $('#fNc').oninput = (e) => { f.ncMin = +e.target.value; sliderLabels(); changed(); };
  $('#fCrop').oninput = (e) => { f.cropMin = +e.target.value; sliderLabels(); changed(); };
  $('#fLcc').oninput = (e) => { f.lccMin = +e.target.value; sliderLabels(); changed(); };
  $('#fQ').oninput = (e) => { f.q = e.target.value.trim(); changed(); };
  $('#fColor').onchange = (e) => { S.color = e.target.value; save(); redraw(); };
  $('#fBase').onchange = (e) => { S.base = e.target.value; setBase(S.base); save(); parcelLayer.setStyle(styleFor); };
  $('#fReset').onclick = () => { Object.assign(S.filters, freshFilters()); buildFilterUI(); changed(true); };
  $('#lSort').onchange = (e) => { S.sort = e.target.value; save(); renderList(); };
  $('#lInView').onchange = (e) => { S.inView = e.target.checked; save(); renderList(); };
  $('#lMore').onclick = () => { listShown += PAGE; renderList(false); };
  $('#lbUndo').onclick = undo;
  $('#lbRuleAll').onclick = ruleOutAll;
  $('#lbShowHidden').onchange = (e) => { S.showHidden = e.target.checked; save(); redraw(); };
  $('#lbRestore').onclick = () => { if (!hidden.size) return; hidden.clear(); lastBatch = null; save(); redraw(); hideToast(); };
  document.querySelectorAll('.map-mode button').forEach((b) => { b.classList.toggle('on', b.dataset.mode === S.mode); b.onclick = () => { S.mode = b.dataset.mode; save(); document.querySelectorAll('.map-mode button').forEach((x) => x.classList.toggle('on', x === b)); }; });
  $('#plist').addEventListener('click', (e) => {
    const li = e.target.closest('.pi'); if (!li) return; const id = li.dataset.id; const act = e.target.closest('button')?.dataset.act;
    if (act === 'zoom') { zoomTo(id); if (window.innerWidth < 860) $('#map').scrollIntoView({ behavior: 'smooth' }); return; }
    if (act === 'info') { showInspect(id); return; }
    if (hidden.has(id)) restoreOne(id); else hideOne(id);
  });
  $('#inspect').addEventListener('click', (e) => {
    const box = $('#inspect'); const id = box.dataset.id; if (e.target.closest('[data-x]')) { box.hidden = true; return; }
    const act = e.target.closest('button')?.dataset.act; if (!act) return;
    if (act === 'zoom') zoomTo(id);
    if (act === 'toggle') { if (hidden.has(id)) restoreOne(id); else hideOne(id); if (!box.hidden) showInspect(id); }
    if (act === 'arc') { const p = FEAT.get(id).properties; window.BaseAcreARC?.useCounty(p.co.toLowerCase(), `${p.ac} ac, ${p.str || p.twp || ''}`.trim()); location.hash = '#arc'; window.scrollTo(0, 0); }
  });
}

/* ---------- sources ---------- */
function renderSources(meta) {
  $('#landSourcesBody').innerHTML = `<ul>
  <li><b>Wilkin County parcels:</b> <a href="https://gisdata.mn.gov/dataset/plan-parcels-open" target="_blank" rel="noopener">MnGeo, Parcels Compiled from Opt-In Open Data Counties</a> (Wilkin is one of the counties that opted in). Owner name (<code>owner_name</code>) and taxpayer name (<code>tax_name</code>) as separate fields, each with its own mailing address, plus GIS and deeded acres, estimated market value (EMV), and use class where the county lists one.</li>
  <li><b>Richland County parcels:</b> <a href="https://north-dakota-state-parcel-program-ndgov.hub.arcgis.com/" target="_blank" rel="noopener">North Dakota Statewide Parcel Program (NDGISHub Parcels + Tax Roll)</a>, joined on the GIS ID. Owner/mailing name and the owner's mailing state, primary use, ag land value and total value as listed on the county tax roll.</li>
  <li><b>Soil productivity:</b> <a href="https://sdmdataaccess.nrcs.usda.gov/" target="_blank" rel="noopener">USDA NRCS SSURGO via Soil Data Access</a> (survey areas MN167, ND077). NCCPI v3 is averaged across each map unit's components, then weighted by area across the parcel and shown ×100. "Class I–II soils" is the share of the parcel whose dominant non-irrigated land capability class is 1 or 2.</li>
  <li><b>Cropland share and main crop:</b> <a href="https://nassgeodata.gmu.edu/CropScape/" target="_blank" rel="noopener">USDA NASS Cropland Data Layer 2025</a> (30 m). Cropland counts CDL crop classes 1–61, except other hay (37), sod/grass seed (59) and switchgrass (60), plus classes 66–77 and 204–254. Main crop is the most common crop class where cropland is at least 20%.</li>
  <li><b>Townships:</b> <a href="https://tigerweb.geo.census.gov/" target="_blank" rel="noopener">US Census TIGERweb county subdivisions</a>, assigned at each parcel's interior point.</li>
  <li><b>Worked out here:</b> owner type is guessed from keywords in the owner name (or the taxpayer name when there's no owner) and can be wrong. Mailing state is read from the "City, ST 12345" line of each Wilkin address. For Richland, the roll's state field is used. When that field isn't a real state code (city names like "St Cloud" or "Mc Lean" spill into it), the state comes from the ZIP code's first three digits (${(meta.stateStats?.nd_state_from_zip ?? 0).toLocaleString()} tax-roll records). "Outside MN/ND" = any owner or taxpayer mailing state other than MN or ND.</li></ul>
  <p><b>Gaps:</b> only parcels of ${meta.minAcres}+ GIS acres are included (${meta.counties.wilkin.count.toLocaleString()} in Wilkin, ${meta.counties.richland.count.toLocaleString()} in Richland). Nothing here says a parcel is for sale or for rent, or who farms it; there are no sale prices. Wilkin lists a use class for only some parcels. Richland doesn't publish deeded acres, so GIS acres are used. <b>Names and mailing states:</b> Wilkin publishes the taxpayer for almost every parcel but a separate owner name for only about 1 in 9 of them (${P.filter((p) => p.co === 'Wilkin' && p.own).length.toLocaleString()} parcels). For the rest the owner shows as "not published" and only the taxpayer can be searched. About 170 Wilkin addresses are cut off after three lines (care-of lines), so their state is unknown. Richland's roll lists one owner/mailing name per record and no separate taxpayer. When several roll records share one map parcel, all their names are kept. ${(meta.stateStats?.nd_state_unknown ?? 0).toLocaleString()} Richland roll records have no usable state or ZIP (mostly government and drain parcels). Parcels with no mailing state show as "Unknown" (${P.filter((p) => !p.sts).length.toLocaleString()} in total). A mailing address is where the tax bill goes, not where the owner lives. Dollar values aren't comparable across the state line: Wilkin shows estimated market value, while Richland shows the values on its tax roll. CDL is a satellite classification and has errors. NCCPI is a national soil index, not a yield. Boundaries are simplified to about 4 m and aren't a survey. Data downloaded ${meta.built}.</p>`;
}

/* ---------- boot ---------- */
const COUNTY_BOUNDS = {};
async function boot() {
  initMap();
  const wrap = $('.map-wrap'); const ld = document.createElement('div'); ld.className = 'loading'; ld.textContent = 'Loading parcels…'; wrap.appendChild(ld);
  const [w, r, meta, cw, cr] = await Promise.all(['wilkin', 'richland', 'meta.json', 'county_wilkin', 'county_richland'].map((n) => fetch(`data/land/${n.endsWith('.json') ? n : n + '.geojson'}`).then((x) => x.json())));
  for (const fc of [w, r]) for (const f of fc.features) { P.push(f.properties); FEAT.set(f.properties.id, f); BBOX.set(f.properties.id, bboxOf(f.geometry)); }
  [['wilkin', cw], ['richland', cr]].forEach(([k, fc]) => { const gl = L.geoJSON(fc, { interactive: false, style: { color: '#ffd54a', weight: 2.5, fill: false, dashArray: '6 4' } }).addTo(map); COUNTY_BOUNDS[k] = gl.getBounds(); });
  renderSources(meta);
  STATE_COUNTS = stateCounts(P);
  buildFilterUI(); wire(); redraw(); renderTabs();
  if (window.innerWidth < 860 && !localStorage.getItem(KEY + ':seen')) $('#filtersBox').open = false;
  try { localStorage.setItem(KEY + ':seen', '1'); } catch (e) {}
  map.on('zoomend', () => parcelLayer.setStyle(styleFor));
  window.__land.map = map; ld.remove(); ready = true; document.body.dataset.landReady = '1';
}
boot().catch((e) => { console.error(e); $('.map-wrap').insertAdjacentHTML('beforeend', `<div class="loading">Couldn't load parcel data: ${esc(e.message)}</div>`); });
