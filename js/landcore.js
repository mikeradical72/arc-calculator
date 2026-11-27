// Pure land-finder logic (no DOM): filters, hidden-parcel stack, sorting. Tested in tests/land.test.mjs.
export const DEFAULT_FILTERS = Object.freeze({
  county: 'all', twps: [], acMin: '', acMax: '', ncMin: 0, cropMin: 0, lccMin: 0,
  otypes: [], classes: [], crops: [], absentee: false, q: '',
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
  if (f.absentee && p.absentee !== true) return false;
  if (f.q) {
    const q = f.q.toLowerCase();
    if (![p.own, p.pin, p.legal, p.twp, p.str].some((s) => s && String(s).toLowerCase().includes(q))) return false;
  }
  return true;
}

export function activeFilterCount(f) {
  let n = 0;
  if (f.county !== 'all') n++;
  for (const k of ['twps', 'otypes', 'classes', 'crops']) if (f[k].length) n++;
  if (num(f.acMin) != null || num(f.acMax) != null) n++;
  for (const k of ['ncMin', 'cropMin', 'lccMin']) if (f[k] > 0) n++;
  if (f.absentee) n++;
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

// Saved searches: each keeps its own full copy of the filters (including parcel size).
export function saveSearch(list, name, filters, id) {
  const copy = JSON.parse(JSON.stringify(filters));
  if (id) { const s = list.find((x) => x.id === id); if (s) { s.filters = copy; if (name) s.name = name; return s; } }
  const s = { id: 's' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6), name: name || 'Search ' + (list.length + 1), filters: copy };
  list.push(s); return s;
}
export function loadSearch(list, id) {
  const s = list.find((x) => x.id === id);
  return s ? JSON.parse(JSON.stringify(s.filters)) : null;
}
export function deleteSearch(list, id) { const i = list.findIndex((x) => x.id === id); if (i >= 0) list.splice(i, 1); return i >= 0; }
export function sameFilters(a, b) { return JSON.stringify(a) === JSON.stringify(b); }
