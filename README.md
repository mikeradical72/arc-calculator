# BaseAcre: farmland finder + ARC/PLC calculator

**Live:** https://mikeradical72.github.io/arc-calculator/

## Land finder (main view)
A map and a synced list of every parcel of 10+ GIS acres in **Wilkin County, MN** (4,748) and **Richland County, ND** (8,595). Pick a satellite or street basemap.

- **Rule parcels out with one tap.** Tap a parcel on the map, or a row in the list, and it disappears right away with no confirm step. There's a count of ruled-out parcels, Undo (in the toolbar and in a toast), "Show ruled out" (tap one to restore it) and Restore all. Ruled-out parcels, filters and the map view are saved in localStorage.
- **"Tap shows details" mode** opens a parcel's details instead of ruling it out. The details panel can send that county to the ARC/PLC tab.
- **Filters:** county, township, acres (min and max), soil productivity (NCCPI), cropland share, share of Class I–II soils, owner type, 2025 main crop, assessor land class, owner mailing from outside MN/ND, and a text search on owner, parcel ID or legal description.

### Data (precomputed to `data/land/*.geojson` by `scripts/fetch_parcels.py` + `scripts/build_land.py`)
| Layer | Source |
|---|---|
| Wilkin parcels | MnGeo "Parcels, Compiled from Opt-In Open Data Counties" (FeatureServer `plan_parcels_open`) |
| Richland parcels | ND Statewide Parcel Program (NDGISHub Parcels + Parcels_TaxRoll), joined on UniqueGISID |
| NCCPI, land capability class, main soil | USDA NRCS SSURGO via Soil Data Access (MN167, ND077), weighted by area |
| Cropland % and 2025 main crop | USDA NASS Cropland Data Layer 2025 (CropScape) |
| Townships | US Census TIGERweb county subdivisions |
| Owner type, out-of-state owner | Worked out from the owner name and mailing address (keyword match) |

Raw downloads go to a scratch directory and aren't committed.

## ARC/PLC tab
The ARC-IC vs ARC-CO vs PLC calculator (`#arc`), unchanged. `node tests/calc.test.mjs` checks the Cass County Scenario #3 slide numbers.

## Tests
`node tests/calc.test.mjs`, `node tests/land.test.mjs`, `python3 tests/smoke.py <url>`, `python3 tests/land_smoke.py <url>`

Estimates and public records only. This app doesn't show whether land is for sale or rent, and it isn't a survey. Not affiliated with USDA or either county.

### Parcel size and saved searches
- **Parcel size** sits at the top of the search panel (always visible, also on phones): quick presets **~40 ac (35–45)**, **~80 ac (75–85)**, **~160 ac (150–170)**, **320+ ac (300 and up)**, or **Any size**, plus custom min/max acre boxes. Ranges are inclusive and use GIS acres.
- **Saved searches**: "Save search" stores a named copy of the current filters — parcel size included — so each saved search has its own acre range, county, township, soil and other filters. Pick one from the dropdown to load it; if you change it, an **Update** button appears; **Delete** removes it. Saved searches live in localStorage. Ruled-out parcels are shared across searches.
- Acres are shown in bold on every list row and at the top of the details panel (GIS acres, plus deeded acres where the county lists them).
