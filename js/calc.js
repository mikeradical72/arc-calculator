// BaseAcre calculation engine. Pure functions, no DOM.
// Rounding follows the published Cropland "ARC-IC Scenario #3" slides so the
// example reproduces them to the dollar:
//  - ARC-IC: blended benchmark/actual revenue, guarantee, cap and the per-base-acre
//    amount are rounded to cents at each step; payment rounded to the dollar.
//  - ARC-CO: full precision per crop, each crop's payment rounded to the dollar.
//  - PLC: payment rate rounded to cents, payment rounded to the dollar.
export const r2 = (x) => Math.round((x + Number.EPSILON * Math.sign(x || 1)) * 100) / 100;
export const n = (v) => { const x = parseFloat(v); return Number.isFinite(x) ? x : 0; };

export const RULES = {
  guarantee: 0.90,   // ARC guarantee, % of benchmark revenue (2025+ rules)
  cap: 0.12,         // ARC max payment, % of benchmark revenue (2025+ rules)
  coFactor: 0.85,    // ARC-CO and PLC pay on 85% of base
  icFactor: 0.65,    // ARC-IC pays on 65% of base
  sequestration: 0.057,
};

export function scalePrice(p, factor) { return factor === 1 ? n(p) : r2(n(p) * factor); }

export function arcIC(crops, factor = 1) {
  const rows = crops.map((c) => {
    const price = Math.max(scalePrice(c.mya, factor), n(c.loan));
    return {
      name: c.name, planted: n(c.planted), base: n(c.base),
      yield: n(c.icYield), bPrice: n(c.benchPrice), bRev: n(c.icYield) * n(c.benchPrice),
      aYield: n(c.farmYield), aPrice: price, aRev: n(c.farmYield) * price,
    };
  });
  const planted = rows.reduce((s, r) => s + r.planted, 0);
  const base = rows.reduce((s, r) => s + r.base, 0);
  if (planted <= 0) return { rows, planted, base, bench: 0, actual: 0, guarantee: 0, shortfall: 0, cap: 0, rate: 0, perBase: 0, payment: 0, capped: false, empty: true };
  const bench = r2(rows.reduce((s, r) => s + r.bRev * r.planted, 0) / planted);
  const actual = r2(rows.reduce((s, r) => s + r.aRev * r.planted, 0) / planted);
  const guarantee = r2(RULES.guarantee * bench);
  const shortfall = Math.max(0, r2(guarantee - actual));
  const cap = r2(RULES.cap * bench);
  const rate = Math.min(shortfall, cap);
  const perBase = r2(rate * RULES.icFactor);
  const payment = Math.round(perBase * base);
  return { rows, planted, base, bench, actual, guarantee, shortfall, cap, rate, perBase, payment, capped: shortfall >= cap && cap > 0 };
}

export function arcCO(crops, factor = 1) {
  const rows = crops.map((c) => {
    const base = n(c.base);
    const bench = n(c.coBenchYield) * n(c.benchPrice);
    const guarantee = RULES.guarantee * bench;
    const price = Math.max(scalePrice(c.mya, factor), n(c.loan));
    const actual = n(c.coYield) * price;
    const shortfall = Math.max(0, guarantee - actual);
    const cap = RULES.cap * bench;
    const rate = Math.min(shortfall, cap);
    const payment = Math.round(rate * RULES.coFactor * base);
    return { name: c.name, base, bYield: n(c.coBenchYield), bPrice: n(c.benchPrice), bench, guarantee, aYield: n(c.coYield), price, actual, shortfall, cap, rate, payment, capped: shortfall >= cap && cap > 0 };
  });
  return { rows, payment: rows.reduce((s, r) => s + r.payment, 0) };
}

export function plc(crops, factor = 1) {
  const rows = crops.map((c) => {
    const base = n(c.base);
    const mya = scalePrice(c.mya, factor);
    const eff = Math.max(mya, n(c.loan));
    const maxRate = Math.max(0, n(c.erp) - n(c.loan));
    const rate = r2(Math.max(0, Math.min(n(c.erp) - eff, maxRate)));
    const payment = Math.round(rate * n(c.plcYield) * RULES.coFactor * base);
    return { name: c.name, base, erp: n(c.erp), mya, eff, rate, plcYield: n(c.plcYield), payment };
  });
  return { rows, payment: rows.reduce((s, r) => s + r.payment, 0) };
}

export function compare(crops, opts = {}) {
  const factor = opts.factor ?? 1;
  const seq = opts.sequestration ? 1 - RULES.sequestration : 1;
  const ic = arcIC(crops, factor), co = arcCO(crops, factor), pl = plc(crops, factor);
  const mixRows = co.rows.map((r, i) => {
    const p = pl.rows[i].payment;
    return { name: r.name, co: r.payment, plc: p, pick: r.payment >= p ? 'ARC-CO' : 'PLC', best: Math.max(r.payment, p) };
  });
  const mix = mixRows.reduce((s, r) => s + r.best, 0);
  const totals = {
    'ARC-CO': Math.round(co.payment * seq),
    'ARC-IC': Math.round(ic.payment * seq),
    'PLC': Math.round(pl.payment * seq),
    'Mix': Math.round(mix * seq),
  };
  const decided = mixRows.filter((r) => r.co !== r.plc);
  const mixIsPure = decided.every((r) => r.pick === (decided[0] || {}).pick);
  const ranked = Object.entries(totals).filter(([k]) => k !== 'Mix' || !mixIsPure).sort((a, b) => b[1] - a[1]);
  // Benchmarks, per base acre, for the "how much better does my history need to be" test
  const baseTot = co.rows.reduce((s, r) => s + r.base, 0);
  const countyBench = baseTot > 0 ? co.rows.reduce((s, r) => s + r.bench * r.base, 0) / baseTot : 0;
  const farmVsCounty = countyBench > 0 ? ic.bench / countyBench - 1 : 0;
  const breakEvenEdge = RULES.coFactor / RULES.icFactor - 1; // both at cap
  return { ic, co, plc: pl, mixRows, mix, mixIsPure, totals, ranked, winner: ranked[0][0], countyBench, farmVsCounty, breakEvenEdge, seq: !!opts.sequestration, factor };
}

export function sensitivity(crops, opts = {}, steps = [-0.10, -0.05, 0, 0.05, 0.10]) {
  return steps.map((s) => ({ step: s, ...compare(crops, { ...opts, factor: 1 + s }) }));
}
