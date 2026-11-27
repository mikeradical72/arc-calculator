// Pure land-finder logic (no DOM): filters, hidden-parcel stack, sorting. Tested in tests/land.test.mjs.
export const DEFAULT_FILTERS = Object.freeze({
  county: 'all', twps: [], acMin: '', acMax: '', ncMin: 0, cropMin: 0, lccMin: 0,
  otypes: [], classes: [], crops: [], absentee: false, q: '', name: '', states: [],
});
export const freshFilters = () => JSON.parse(JSON.stringify(DEFAULT_FILTERS));
const num = (v) => (v === '' || v == null || isNaN(+v) ? null : +v);

export function matches(p, f) {
  if (f.county !== 'all' && p.co.toLowerCase() !== f.county) return false;
  if (f.twps.length && !f.twps.includes(p.co + '|' + (p.twp || ''))) return false;
  const mn = num(f.acMin), mx = num(f.acMax);
  if (mn != null && p.ac < mn) return false;
  if (mx != null && p.ac > mx) return false;
  if (f.ncMin > 0 && !(p.nccpi >= f.ncMin)) return false;
  if (f.cropMin > 0 && !(p.crop >= f.cropMin)) return false;
  if (f.lccMin > 0 && !(p.lcc12 >= f.lccMin)) return false;
  if (f.otypes.length && !f.otypes.includes(p.otype)) return false;
  if (f.classes.length && !f.classes.includes(p.co + '|' + p.cls)) return false;
  if (f.crops.length && !f.crops.includes(p.c25 || 'None')) return false;
  if ((f.states && f.states.length) || f.absentee) {
    // Mailing-state filter: owner's OR taxpayer's state. "Outside MN/ND" is folded in as an extra option (OR).
    const st = statesOf(p);
    if (!((f.states || []).some((x) => st.includes(x)) || (f.absentee && p.absentee === true))) return false;
  }
  if (f.name) {
    const q = f.name.trim().toLowerCase();
    if (q && ![p.own, p.tp].some((x) => x && x.toLowerCase().includes(q))) return false;
  }
  if (f.q) {
    const q = f.q.toLowerCase();
    if (![p.own, p.tp, p.pin, p.legal, p.twp, p.str].some((s) => s && String(s).toLowerCase().includes(q))) return false;
  }
  return true;
}

export function activeFilterCount(f) {
  let n = 0;
  if (f.county !== 'all') n++;
  for (const k of ['twps', 'otypes', 'classes', 'crops']) if (f[k].length) n++;
  if (num(f.acMin) != null || num(f.acMax) != null) n++;
  for (const k of ['ncMin', 'cropMin', 'lccMin']) if (f[k] > 0) n++;
  if (f.absentee || (f.states && f.states.length)) n++;
  if (f.name && f.name.trim()) n++;
  if (f.q) n++;
  return n;
}

// Ruled-out parcels: a set plus an ordered stack so "undo" restores the most recent one.
export class Hidden {
  constructor(ids = []) { this.stack = [...new Set(ids)]; this.set = new Set(this.stack); }
  has(id) { return this.set.has(id); }
  get size() { return this.set.size; }
  hide(id) { if (this.set.has(id)) return false; this.set.add(id); this.stack.push(id); return true; }
  restore(id) { if (!this.set.delete(id)) return false; this.stack = this.stack.filter((x) => x !== id); return true; }
  undo() { const id = this.stack.pop(); if (id != null) this.set.delete(id); return id ?? null; }
  last() { return this.stack.length ? this.stack[this.stack.length - 1] : null; }
  reset(ids = []) { this.stack = [...new Set(ids)]; this.set = new Set(this.stack); }
  clear() { const n = this.set.size; this.set.clear(); this.stack = []; return n; }
  toJSON() { return this.stack; }
}

export const SORTS = {
  nccpi: (a, b) => (b.nccpi ?? -1) - (a.nccpi ?? -1) || b.ac - a.ac,
  acres: (a, b) => b.ac - a.ac,
  acresAsc: (a, b) => a.ac - b.ac,
  crop: (a, b) => (b.crop ?? -1) - (a.crop ?? -1) || b.ac - a.ac,
  valac: (a, b) => perAcre(a) - perAcre(b),
};
export function perAcre(p) { return p.lval && p.ac ? p.lval / p.ac : Infinity; }

// Parcel-size quick presets (inclusive GIS-acre ranges). max '' = no upper limit.
export const ACRE_PRESETS = [
  { key: 'any', label: 'Any size', min: '', max: '' },
  { key: '40', label: '~40 ac', sub: '35–45', min: 35, max: 45 },
  { key: '80', label: '~80 ac', sub: '75–85', min: 75, max: 85 },
  { key: '160', label: '~160 ac', sub: '150–170', min: 150, max: 170 },
  { key: '320', label: '320+ ac', sub: '300 and up', min: 300, max: '' },
];
const same = (a, b) => String(a ?? '') === String(b ?? '');
export function presetFor(f) {
  const p = ACRE_PRESETS.find((x) => same(x.min, f.acMin) && same(x.max, f.acMax));
  return p ? p.key : 'custom';
}
export function applyPreset(f, key) {
  const p = ACRE_PRESETS.find((x) => x.key === key); if (!p) return f;
  f.acMin = p.min; f.acMax = p.max; return f;
}
export function acreLabel(f) {
  const mn = f.acMin === '' || f.acMin == null ? null : +f.acMin, mx = f.acMax === '' || f.acMax == null ? null : +f.acMax;
  if (mn == null && mx == null) return 'any size';
  if (mx == null) return `${mn}+ ac`;
  if (mn == null) return `up to ${mx} ac`;
  return `${mn}–${mx} ac`;
}

// Mailing states for a parcel (owner's and taxpayer's); 'Unknown' when the source gives none.
export const statesOf = (p) => (p.sts && p.sts.length ? p.sts : ['Unknown']);
export const OUTSIDE = (st) => st !== 'MN' && st !== 'ND' && st !== 'Unknown';
export function stateCounts(parcels) {
  const m = new Map(); for (const p of parcels) for (const s of statesOf(p)) m.set(s, (m.get(s) || 0) + 1);
  return [...m].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]));
}

/* ---------- separate searches ("tabs") ----------
   Each search owns: name, filters (incl. parcel size, name, states), its own ruled-out list, sort and map view. */
const clone = (o) => JSON.parse(JSON.stringify(o));
const uid = () => 's' + Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
export const SORT_KEYS = ['nccpi', 'acres', 'acresAsc', 'crop', 'valac'];
export function cleanFilters(f) {
  const out = freshFilters(); if (!f || typeof f !== 'object') return out;
  for (const [k, d] of Object.entries(DEFAULT_FILTERS)) {
    const v = f[k]; if (v === undefined) continue;
    if (Array.isArray(d)) { if (Array.isArray(v)) out[k] = v.filter((x) => typeof x === 'string').slice(0, 500); }
    else if (typeof d === 'boolean') out[k] = !!v;
    else if (typeof d === 'number') { if (isFinite(+v)) out[k] = +v; }
    else if (k === 'acMin' || k === 'acMax') out[k] = v === '' || v == null || !isFinite(+v) ? '' : (typeof v === 'number' ? v : String(v));
    else if (typeof v === 'string') out[k] = v.slice(0, 200);
  }
  return out;
}
function cleanView(v) { return v && Array.isArray(v.c) && v.c.length === 2 && v.c.every(isFinite) && isFinite(v.z) ? { c: [+v.c[0], +v.c[1]], z: +v.z } : null; }
export function newSearch(name, from = {}) {
  return { id: uid(), name: String(name || 'Search').slice(0, 60), filters: cleanFilters(from.filters),
    hidden: Array.isArray(from.hidden) ? [...new Set(from.hidden.filter((x) => typeof x === 'string'))] : [],
    sort: SORT_KEYS.includes(from.sort) ? from.sort : 'nccpi', view: cleanView(from.view) };
}
export function uniqueName(list, base) {
  const names = new Set(list.map((s) => s.name)); if (!names.has(base)) return base;
  for (let i = 2; ; i++) if (!names.has(`${base} (${i})`)) return `${base} (${i})`;
}
export function duplicateSearch(list, id) {
  const s = list.find((x) => x.id === id); if (!s) return null;
  const d = newSearch(uniqueName(list, s.name + ' copy'), clone(s)); list.splice(list.indexOf(s) + 1, 0, d); return d;
}
export function removeSearch(list, id) {
  const i = list.findIndex((x) => x.id === id); if (i < 0) return null;
  list.splice(i, 1); if (!list.length) list.push(newSearch('Search 1'));
  return list[Math.min(i, list.length - 1)].id;   // the tab to show next
}
// Read whatever is in localStorage (v1 global state, v1.5 saved searches, or v2) into {searches, active, ui}.
export function migrateStore(raw) {
  raw = raw && typeof raw === 'object' ? raw : {};
  const ui = { mode: raw.mode || 'out', color: raw.color || 'nccpi', base: raw.base || 'sat', showHidden: !!raw.showHidden, inView: raw.inView !== false };
  let searches, active;
  if (raw.v === 2 && Array.isArray(raw.searches)) {
    searches = raw.searches.map((s) => ({ ...newSearch(s.name, s), id: typeof s.id === 'string' ? s.id : uid() }));
    active = raw.active;
  } else {
    // Old format: one global filter set + one global ruled-out list (+ maybe v1.5 saved filter sets without their own lists).
    const live = { filters: raw.filters, hidden: raw.hidden, sort: raw.sort, view: raw.view };
    const old = Array.isArray(raw.searches) ? raw.searches : [];
    searches = old.map((s) => ({ ...newSearch(s.name, { filters: s.filters, sort: raw.sort, view: raw.view }), id: s.id || uid() }));
    const a = searches.find((s) => s.id === raw.active);
    if (a) { Object.assign(a, newSearch(a.name, live), { id: a.id }); active = a.id; }      // live state + global ruled-out list -> the active search
    else { const d = newSearch(uniqueName(searches, 'Search 1'), live); searches.unshift(d); active = d.id; }
  }
  if (!searches.length) searches.push(newSearch('Search 1'));
  if (!searches.some((s) => s.id === active)) active = searches[0].id;
  return { v: 2, searches, active, ...ui };
}
export const EXPORT_FORMAT = 'baseacre-search';
export function exportSearch(s) {
  return { format: EXPORT_FORMAT, version: 2, exported: new Date().toISOString(),
    search: { name: s.name, filters: clone(s.filters), hidden: [...s.hidden], sort: s.sort, view: s.view } };
}
export function importSearch(list, obj) {
  if (typeof obj === 'string') obj = JSON.parse(obj);
  if (!obj || obj.format !== EXPORT_FORMAT || !obj.search || typeof obj.search !== 'object') throw new Error('Not a BaseAcre search file');
  const s = newSearch(uniqueName(list, String(obj.search.name || 'Imported search').slice(0, 60)), obj.search);
  list.push(s); return s;
}
