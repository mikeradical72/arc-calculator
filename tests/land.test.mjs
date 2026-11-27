import assert from 'node:assert/strict';
import fs from 'node:fs';
import { matches, freshFilters, Hidden, SORTS, activeFilterCount } from '../js/landcore.js';
const load = (k) => JSON.parse(fs.readFileSync(new URL(`../data/land/${k}.geojson`, import.meta.url))).features.map((f) => f.properties);
const W = load('wilkin'), R = load('richland'), ALL = [...W, ...R];
const ok = (c, m) => { assert.ok(c, m); console.log('ok', m); };
ok(W.length > 3000 && R.length > 6000, `parcel counts W=${W.length} R=${R.length}`);
ok(ALL.every((p) => p.id && p.co && p.ac >= 10), 'every parcel has id, county, >=10 ac');
ok(new Set(ALL.map((p) => p.id)).size === ALL.length, 'ids unique');
ok(ALL.every((p) => p.nccpi == null || (p.nccpi >= 0 && p.nccpi <= 100)), 'nccpi in 0-100');
ok(ALL.every((p) => p.crop == null || (p.crop >= 0 && p.crop <= 100)), 'cropland % in 0-100');
let f = freshFilters();
ok(ALL.filter((p) => matches(p, f)).length === ALL.length && activeFilterCount(f) === 0, 'no filters = all parcels');
f.county = 'wilkin'; ok(ALL.filter((p) => matches(p, f)).length === W.length, 'county filter');
f = freshFilters(); f.acMin = 150; f.acMax = 170; ok(ALL.filter((p) => matches(p, f)).every((p) => p.ac >= 150 && p.ac <= 170), 'acre range');
f = freshFilters(); f.ncMin = 60; f.cropMin = 80; const hi = ALL.filter((p) => matches(p, f)); ok(hi.length > 0 && hi.every((p) => p.nccpi >= 60 && p.crop >= 80), `soil+cropland filter (${hi.length})`);
const t = W.find((p) => p.twp).twp; f = freshFilters(); f.twps = ['Wilkin|' + t]; ok(ALL.filter((p) => matches(p, f)).every((p) => p.twp === t && p.co === 'Wilkin'), 'township filter');
f = freshFilters(); f.otypes = ['Trust']; ok(ALL.filter((p) => matches(p, f)).every((p) => p.otype === 'Trust'), 'owner type filter');
f = freshFilters(); f.absentee = true; ok(ALL.filter((p) => matches(p, f)).every((p) => p.absentee === true), 'absentee filter');
f = freshFilters(); f.q = W[0].pin; ok(ALL.filter((p) => matches(p, f)).some((p) => p.id === W[0].id), 'search by PIN');
const h = new Hidden();
h.hide('a'); h.hide('b'); h.hide('b'); h.hide('c');
ok(h.size === 3 && h.last() === 'c', 'hide + no duplicates');
ok(h.undo() === 'b' ? false : true, 'undo returns last');
ok(!h.has('c') && h.size === 2 && h.last() === 'b', 'undo restored c');
h.restore('a'); ok(h.size === 1 && h.last() === 'b', 'restore one');
const h2 = new Hidden(JSON.parse(JSON.stringify(h))); ok(h2.has('b') && h2.size === 1, 'round-trips through JSON');
ok(h2.clear() === 1 && h2.size === 0 && h2.undo() === null, 'restore all');
const s = [...ALL].sort(SORTS.nccpi); ok((s[0].nccpi ?? 0) >= (s[s.length - 1].nccpi ?? 0), 'sort by soil');
console.log('ALL LAND TESTS PASSED');

// ---- parcel size presets + saved searches ----
const { ACRE_PRESETS, presetFor, applyPreset, acreLabel, saveSearch, loadSearch, deleteSearch, sameFilters } = await import('../js/landcore.js');
for (const pr of ACRE_PRESETS.filter((x) => x.key !== 'any')) {
  const ff = applyPreset(freshFilters(), pr.key);
  const got = ALL.filter((p) => matches(p, ff));
  ok(got.length > 0 && got.every((p) => p.ac >= pr.min && (pr.max === '' || p.ac <= pr.max)) && presetFor(ff) === pr.key, `size preset ${pr.label} (${pr.sub}) -> ${got.length} parcels`);
}
ok(presetFor(freshFilters()) === 'any' && acreLabel(freshFilters()) === 'any size', 'no size filter = any');
let cf = freshFilters(); cf.acMin = 60; cf.acMax = 100; ok(presetFor(cf) === 'custom' && acreLabel(cf) === '60–100 ac', 'custom min/max');
const list = [];
let fa = applyPreset(freshFilters(), '160'); fa.county = 'wilkin';
const sa = saveSearch(list, 'Wilkin quarters', fa);
let fb = applyPreset(freshFilters(), '320'); fb.ncMin = 55;
const sb = saveSearch(list, 'Big good ground', fb);
fa.acMin = 1; // mutating the live filters must not change the saved copy
ok(loadSearch(list, sa.id).acMin === 150 && loadSearch(list, sa.id).acMax === 170, 'saved search keeps its own acre range');
ok(loadSearch(list, sb.id).acMin === 300 && loadSearch(list, sb.id).acMax === '' && loadSearch(list, sb.id).ncMin === 55, 'second search has its own size + filters');
const fresh = JSON.parse(JSON.stringify(list));
ok(sameFilters(loadSearch(fresh, sa.id), loadSearch(list, sa.id)), 'saved searches round-trip through JSON');
const upd = loadSearch(list, sa.id); upd.acMin = 75; upd.acMax = 85; saveSearch(list, null, upd, sa.id);
ok(list.length === 2 && loadSearch(list, sa.id).acMin === 75 && presetFor(loadSearch(list, sa.id)) === '80', 'update a saved search in place');
ok(deleteSearch(list, sb.id) && list.length === 1, 'delete saved search');
console.log('SIZE + SAVED SEARCH TESTS PASSED');
