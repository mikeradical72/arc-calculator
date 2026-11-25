# BaseAcre: ARC-IC vs ARC-CO vs PLC (2026)

A static, mobile-friendly calculator that runs ARC-IC, ARC-CO and PLC side by side for one FSA farm. It shows the step-by-step math as five slide-style cards you can save as PNGs or print.

**Live:** https://mikeradical72.github.io/arc-calculator/

- County presets: **Wilkin County, MN** and **Richland County, ND**. They load FSA's 2026 ARC-CO benchmark yields (file as of Jan. 16, 2026), FSA's 2026 benchmark prices, projected MYA and loan rates (Table 4, Nov. 10, 2026), 2026 effective reference prices, and 2025 county average PLC yields. Cass County, ND is also included.
- **Load Cass County Scenario #3** reproduces the Cropland ARC-IC Scenario #3 slides to the dollar: ARC-IC $33,465, ARC-CO $41,099, a $7,634 difference, and PLC $1,672 at −5% prices.
- Your inputs are saved in localStorage. No server, no account.
- `node tests/calc.test.mjs` checks every slide number. `python3 tests/smoke.py <url>` runs a browser check and saves screenshots.

Estimates only, before sequestration (optional 5.7% toggle). Not a USDA determination. Not affiliated with Cropland or USDA.
