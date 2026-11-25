// Reference data. Every figure here is from the FSA files listed in SOURCES,
// except values flagged 'est' (placeholders the user should overwrite).
export const SOURCES = {
  arcco: { label: 'FSA, 2026 ARC-County Benchmark Yields and Revenues (as of Jan. 16, 2026)', url: 'https://www.fsa.usda.gov/resources/programs/arc-plc/program-data' },
  prices: { label: 'FSA, Table 4: 2026 ARC-CO benchmark prices, projected 2026/27 MYA (Nov. WASDE) and loan rates (Nov. 10, 2026)', url: 'https://www.fsa.usda.gov/documents/2026-arc-co-excel' },
  erp: { label: 'FSA, 2026 Effective Reference Prices (Oct. 30, 2026)', url: 'https://www.fsa.usda.gov/documents/2026-erp-pdf' },
  plcy: { label: 'FSA, Program Year 2025 Average PLC Yields by County (county average, not your farm)', url: 'https://www.fsa.usda.gov/documents/plc-county-yields-py2025' },
};

// National 2026 prices, per bushel
export const PRICES = {
  Corn:     { benchPrice: 5.03,  mya: 4.60,  erp: 4.42,  loan: 2.42 },
  Soybeans: { benchPrice: 12.17, mya: 12.10, erp: 10.71, loan: 6.82 },
  Wheat:    { benchPrice: 6.98,  mya: 6.20,  erp: 6.35,  loan: 3.72 },
};

// 2026 ARC-CO benchmark yields (2020-24 olympic avg, trend-adjusted) and 2025 county avg PLC yields
export const COUNTIES = {
  wilkin: {
    label: 'Wilkin County, MN', short: 'Wilkin Co., MN', fips: '27167',
    bench: { Corn: { Irrigated: 196.86, Nonirrigated: 173.9 }, Soybeans: { Irrigated: 52.81, Nonirrigated: 37.33 }, Wheat: { All: 57.46 } },
    plcYield: { Corn: 133.48, Soybeans: 34.33, Wheat: 50.40 },
  },
  richland: {
    label: 'Richland County, ND', short: 'Richland Co., ND', fips: '38077',
    bench: { Corn: { Irrigated: 201.76, Nonirrigated: 179.17 }, Soybeans: { Irrigated: 53.1, Nonirrigated: 43.75 }, Wheat: { All: 59.81 } },
    plcYield: { Corn: 132.07, Soybeans: 34.97, Wheat: 48.32 },
  },
  cass: {
    label: 'Cass County, ND', short: 'Cass Co., ND', fips: '38017',
    bench: { Corn: { Irrigated: 198.19, Nonirrigated: 180.92 }, Soybeans: { Irrigated: 53.02, Nonirrigated: 41.35 }, Wheat: { All: 67.54 } },
    plcYield: { Corn: 127.83, Soybeans: 34.14, Wheat: 53.97 },
  },
};

export const FIELDS = [
  // key, label, group, unit
  ['planted', 'Acres planted', 'farm', 'ac'],
  ['base', 'Base acres', 'farm', 'ac'],
  ['icYield', 'ARC-IC benchmark yield', 'farm', 'bu'],
  ['farmYield', '2026 farm yield', 'farm', 'bu'],
  ['coBenchYield', 'County benchmark yield', 'county', 'bu'],
  ['coYield', '2026 county yield (est.)', 'county', 'bu'],
  ['benchPrice', 'Benchmark price', 'price', '$'],
  ['mya', '2026 MYA (proj.)', 'price', '$'],
  ['erp', 'Effective ref. price', 'price', '$'],
  ['loan', 'Loan rate', 'price', '$'],
  ['plcYield', 'PLC yield', 'plc', 'bu'],
];

let uid = 0;
export const newId = () => 'c' + Date.now().toString(36) + (uid++);

export function cropFromCounty(name, countyKey, practice, acres = {}) {
  const co = COUNTIES[countyKey];
  const p = PRICES[name] || { benchPrice: 0, mya: 0, erp: 0, loan: 0 };
  const benchSet = co && co.bench[name];
  const prac = benchSet ? (benchSet[practice] != null ? practice : Object.keys(benchSet)[0]) : null;
  const by = benchSet ? benchSet[prac] : 0;
  const flags = {};
  const src = (k, f) => { flags[k] = f; };
  ['benchPrice', 'mya', 'loan'].forEach((k) => src(k, PRICES[name] ? 'prices' : 'you'));
  src('erp', PRICES[name] ? 'erp' : 'you');
  src('coBenchYield', benchSet ? 'arcco' : 'you');
  src('plcYield', co && co.plcYield[name] ? 'plcy' : 'you');
  // Not published anywhere yet: placeholders = county benchmark, flagged as estimates
  ['coYield', 'icYield', 'farmYield'].forEach((k) => src(k, 'est'));
  src('planted', 'est'); src('base', 'est');
  return {
    id: newId(), name, practice: prac || 'All',
    planted: acres.planted ?? 0, base: acres.base ?? 0,
    icYield: by, farmYield: by, coBenchYield: by, coYield: by,
    benchPrice: p.benchPrice, mya: p.mya, erp: p.erp, loan: p.loan,
    plcYield: co && co.plcYield[name] ? co.plcYield[name] : 0,
    flags,
  };
}

export const PRESETS = {
  wilkin: { label: 'Wilkin County, MN', county: 'wilkin' },
  richland: { label: 'Richland County, ND', county: 'richland' },
  cass3: { label: 'Cass County Scenario #3 (slide check)', county: 'cass' },
};

export function buildPreset(key, practice = 'Nonirrigated') {
  if (key === 'cass3') {
    // Exactly the slide inputs. Slides round the FSA county benchmarks (180.92 -> 180.9, 41.35 -> 41.4).
    // Corn PLC yield 138 is the value implied by slide 4's $1,672 PLC payment at -5% prices.
    const f = (o) => ({ ...o, flags: Object.fromEntries(Object.keys(o).filter((k) => !['id', 'name', 'practice'].includes(k)).map((k) => [k, 'slide'])) });
    return {
      preset: 'cass3', county: 'cass', practice: 'Nonirrigated', farmName: 'Cass County example farm', sequestration: false,
      crops: [
        f({ id: newId(), name: 'Corn', practice: 'Nonirrigated', planted: 300, base: 285, icYield: 188, farmYield: 100, coBenchYield: 180.9, coYield: 135, benchPrice: 5.03, mya: 4.60, erp: 4.42, loan: 2.42, plcYield: 138 }),
        f({ id: newId(), name: 'Soybeans', practice: 'Nonirrigated', planted: 300, base: 285, icYield: 46, farmYield: 20, coBenchYield: 41.4, coYield: 28, benchPrice: 12.17, mya: 12.10, erp: 10.71, loan: 6.82, plcYield: 34.1 }),
      ],
    };
  }
  const p = PRESETS[key];
  const acres = { Corn: { planted: 500, base: 450 }, Soybeans: { planted: 500, base: 450 }, Wheat: { planted: 300, base: 280 } };
  return {
    preset: key, county: p.county, practice, farmName: 'My farm', sequestration: false,
    crops: ['Corn', 'Soybeans', 'Wheat'].map((c) => cropFromCounty(c, p.county, practice, acres[c])),
  };
}
