import assert from 'node:assert/strict';
import { compare, sensitivity, r2 } from '../js/calc.js';
import { PRESETS, buildPreset } from '../js/data.js';
const st = buildPreset('cass3');
const c = compare(st.crops);
const eq = (a, b, m) => { assert.equal(a, b, m); console.log('ok', m, a); };
// Slide 2
eq(c.ic.bench, 752.73, 'IC blended benchmark'); eq(c.ic.actual, 351.00, 'IC actual');
eq(c.ic.guarantee, 677.46, 'IC guarantee'); eq(c.ic.shortfall, 326.46, 'IC shortfall');
eq(c.ic.cap, 90.33, 'IC cap'); eq(c.ic.perBase, 58.71, 'IC per base acre'); eq(c.ic.payment, 33465, 'IC payment');
eq(r2(c.ic.rows[0].bRev), 945.64, 'corn bench rev ~$946'); eq(r2(c.ic.rows[1].bRev), 559.82, 'soy bench rev ~$560');
// Slide 3
eq(r2(c.co.rows[0].bench), 909.93, 'CO corn bench'); eq(r2(c.co.rows[0].guarantee), 818.93, 'CO corn guarantee');
eq(r2(c.co.rows[0].actual), 621.00, 'CO corn actual'); eq(c.co.rows[0].payment, 26452, 'CO corn pay');
eq(r2(c.co.rows[1].bench), 503.84, 'CO soy bench'); eq(r2(c.co.rows[1].guarantee), 453.45, 'CO soy guarantee');
eq(r2(c.co.rows[1].actual), 338.80, 'CO soy actual'); eq(c.co.rows[1].payment, 14647, 'CO soy pay');
eq(c.totals['ARC-CO'], 41099, 'ARC-CO total'); eq(c.totals['PLC'], 0, 'PLC total');
// Slide 4/5
eq(c.totals['ARC-CO'] - c.totals['ARC-IC'], 7634, 'difference'); eq(c.winner, 'ARC-CO', 'winner');
const s = sensitivity(st.crops, {}, [-0.05, 0, 0.05]);
eq(s[0].totals['PLC'], 1672, 'PLC at -5%'); eq(s[0].totals['ARC-CO'], 41099, 'CO -5%'); eq(s[0].totals['ARC-IC'], 33465, 'IC -5%');
eq(s[2].totals['PLC'], 0, 'PLC +5%'); eq(s[2].totals['ARC-CO'], 41099, 'CO +5%'); eq(s[2].totals['ARC-IC'], 33465, 'IC +5%');
eq(Math.round(c.farmVsCounty * 100), 6, 'farm ~6% above county'); eq(Math.round(c.breakEvenEdge * 100), 31, 'needs ~31%');
for (const k of Object.keys(PRESETS)) { const p = buildPreset(k); const r = compare(p.crops); assert.ok(Number.isFinite(r.totals['ARC-CO'])); console.log('preset', k, r.totals); }
console.log('ALL SLIDE NUMBERS REPRODUCED');
