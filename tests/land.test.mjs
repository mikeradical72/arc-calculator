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
const { ACRE_PRESETS, presetFor, applyPreset, acreLabel, statesOf, stateCounts, newSearch, uniqueName, duplicateSearch, removeSearch, migrateStore, exportSearch, importSearch, cleanFilters } = await import('../js/landcore.js');
for (const pr of ACRE_PRESETS.filter((x) => x.key !== 'any')) {
  const ff = applyPreset(freshFilters(), pr.key);
  const got = ALL.filter((p) => matches(p, ff));
  ok(got.length > 0 && got.every((p) => p.ac >= pr.min && (pr.max === '' || p.ac <= pr.max)) && presetFor(ff) === pr.key, `size preset ${pr.label} (${pr.sub}) -> ${got.length} parcels`);
}
ok(presetFor(freshFilters()) === 'any' && acreLabel(freshFilters()) === 'any size', 'no size filter = any');
let cf = freshFilters(); cf.acMin = 60; cf.acMax = 100; ok(presetFor(cf) === 'custom' && acreLabel(cf) === '60–100 ac', 'custom min/max');
console.log('SIZE TESTS PASSED');

// ---- owner / taxpayer names ----
const wt = W.filter((p) => p.tp); ok(wt.length > 4000, `Wilkin taxpayer names present separately (${wt.length})`);
ok(W.some((p) => p.own && p.tp && p.own !== p.tp), 'Wilkin has parcels where owner and taxpayer differ');
ok(R.every((p) => !p.tp) && R.filter((p) => p.own).length > 8000, 'Richland: owner/mailing name, no separate taxpayer');
const byName = (q) => { const ff = freshFilters(); ff.name = q; return ALL.filter((p) => matches(p, ff)); };
const yg = byName('Yaggie');
ok(yg.length > 0 && yg.every((p) => [p.own, p.tp].some((x) => x && /yaggie/i.test(x))), `name search 'Yaggie' -> ${yg.length} parcels`);
ok(byName('yAgGiE').length === yg.length && byName('yagg').length >= yg.length, 'name search is case-insensitive partial');
const ownerOnly = W.find((p) => p.own && p.tp && !p.tp.toLowerCase().includes(p.own.toLowerCase().slice(0, 6)) && !p.own.toLowerCase().includes(p.tp.toLowerCase().slice(0, 6)));
ok(byName(ownerOnly.own.slice(0, 8)).some((p) => p.id === ownerOnly.id) && byName(ownerOnly.tp.slice(0, 8)).some((p) => p.id === ownerOnly.id), 'name search matches owner AND taxpayer fields');
ok(yg.some((p) => p.co === 'Wilkin' && !p.own && p.tp), 'Yaggie hits include taxpayer-only Wilkin parcels');
ok(byName('zzzz-no-such-name').length === 0, 'no false matches');
console.log('YAGGIE COUNT', yg.length, 'acres', Math.round(yg.reduce((a, p) => a + p.ac, 0)));

// ---- mailing state filter ----
const sc = stateCounts(ALL); const scm = new Map(sc);
ok(scm.get('MN') > 1000 && scm.get('ND') > 1000 && scm.get('Unknown') > 0, `state options incl. Unknown (${sc.length}: ${sc.map(([k, n]) => k + ' ' + n).join(', ')})`);
ok(sc.every(([k]) => /^[A-Z]{2}$/.test(k) || k === 'Unknown'), 'state options are 2-letter codes or Unknown');
const byStates = (st, abs = false) => { const ff = freshFilters(); ff.states = st; ff.absentee = abs; return ALL.filter((p) => matches(p, ff)); };
ok(byStates(['SD']).length === scm.get('SD') && byStates(['SD']).every((p) => statesOf(p).includes('SD')), 'single state matches its count');
ok(byStates(['SD', 'AZ']).length >= Math.max(scm.get('SD'), scm.get('AZ')), 'multi-select is OR');
ok(byStates(['Unknown']).length === scm.get('Unknown') && byStates(['Unknown']).every((p) => !p.sts), 'Unknown option = no mailing state in source');
const wDual = W.find((p) => p.ost && p.tst && p.ost !== p.tst);
if (wDual) ok(byStates([wDual.ost]).some((p) => p.id === wDual.id) && byStates([wDual.tst]).some((p) => p.id === wDual.id), 'state matches owner OR taxpayer state');
const outside = byStates([], true);
ok(outside.length > 0 && outside.every((p) => statesOf(p).some((x) => x !== 'MN' && x !== 'ND' && x !== 'Unknown')), `outside MN/ND option (${outside.length})`);
ok(byStates(['MN'], true).length >= outside.length, 'outside MN/ND combines (OR) with picked states');
let cnt = freshFilters(); cnt.states = ['SD']; cnt.name = 'x'; ok(activeFilterCount(cnt) === 2, 'state + name counted as active filters');

// ---- separate searches ----
const m0 = migrateStore({});
ok(m0.v === 2 && m0.searches.length === 1 && m0.active === m0.searches[0].id && m0.searches[0].hidden.length === 0, 'fresh store -> one empty search');
const legacy = { filters: { ...freshFilters(), acMin: 150, acMax: 170, county: 'wilkin' }, hidden: ['W1', 'W2', 'W2'], sort: 'acres', view: { c: [46.3, -96.6], z: 12 }, mode: 'inspect', color: 'crop', showHidden: true };
const m1 = migrateStore(JSON.parse(JSON.stringify(legacy)));
const a1 = m1.searches.find((x) => x.id === m1.active);
ok(m1.searches.length === 1 && a1.hidden.join() === 'W1,W2' && a1.filters.acMin === 150 && a1.filters.county === 'wilkin' && a1.sort === 'acres' && a1.view.z === 12 && m1.mode === 'inspect' && m1.color === 'crop',
  'v1 global ruled-out list + filters migrate into the default search');
const legacy15 = { ...legacy, searches: [{ id: 'sA', name: 'Quarters', filters: { acMin: 150, acMax: 170 } }, { id: 'sB', name: 'Forties', filters: { acMin: 35, acMax: 45 } }], active: 'sB' };
const m15 = migrateStore(JSON.parse(JSON.stringify(legacy15)));
const qA = m15.searches.find((x) => x.id === 'sA'), qB = m15.searches.find((x) => x.id === 'sB');
ok(m15.active === 'sB' && qB.hidden.length === 2 && qA.hidden.length === 0 && qA.filters.acMin === 150, 'v1.5 saved searches: global list goes to the active search only');
const list = m0.searches; list[0].name = 'Search 1';
const s1 = list[0]; s1.filters.acMin = 75; s1.filters.acMax = 85; s1.hidden = ['A', 'B'];
const s2 = newSearch(uniqueName(list, 'Search 1'), {}); list.push(s2);
ok(s2.name === 'Search 1 (2)' && s2.hidden.length === 0 && s2.filters.acMin === '', 'new search starts empty with a unique name');
s2.hidden.push('C'); s2.filters.name = 'Yaggie';
ok(s1.hidden.join() === 'A,B' && s1.filters.name === '' && s2.hidden.join() === 'C', 'searches keep separate ruled-out lists and filters');
const d = duplicateSearch(list, s1.id); d.hidden.push('Z'); d.filters.acMin = 1;
ok(list[1] === d && d.name === 'Search 1 copy' && s1.hidden.join() === 'A,B' && s1.filters.acMin === 75 && d.hidden.join() === 'A,B,Z', 'duplicate is a deep, independent copy');
const store = { v: 2, searches: list, active: s2.id };
const back = migrateStore(JSON.parse(JSON.stringify(store)));
ok(back.searches.length === 3 && back.active === s2.id && back.searches.map((x) => x.hidden.join('|')).join(';') === 'A|B;A|B|Z;C' && back.searches[2].filters.name === 'Yaggie', 'v2 store round-trips (reload) with separate lists');
const ex = exportSearch(s1); const txt = JSON.stringify(ex);
const imp = importSearch(list, txt);
ok(ex.format === 'baseacre-search' && imp.name === 'Search 1 (3)' && imp.id !== s1.id && imp.hidden.join() === 'A,B' && imp.filters.acMax === 85, 'export -> import as a new search');
assert.throws(() => importSearch(list, '{"hello":1}')); assert.throws(() => importSearch(list, 'not json')); console.log('ok import rejects bad files');
const evil = cleanFilters({ acMin: '<script>', states: ['ND', 5, {}], county: 'wilkin', bogus: 1 });
ok(evil.acMin === '' && evil.states.join() === 'ND' && !('bogus' in evil), 'imported filters are sanitised');
let nextId = removeSearch(list, imp.id); ok(list.length === 3 && nextId === list[2].id, 'delete search picks a neighbour');
const solo = [newSearch('only')]; removeSearch(solo, solo[0].id); ok(solo.length === 1 && solo[0].name === 'Search 1', 'deleting the last search leaves a fresh one');
console.log('SEARCH/NAME/STATE TESTS PASSED');
