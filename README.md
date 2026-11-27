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

### Parcel size
Parcel size sits at the top of the search panel: **~40 ac (35–45)**, **~80 ac (75–85)**, **~160 ac (150–170)**, **320+ ac**, **Any size**, plus custom min/max boxes (GIS acres, both ends included). Acres are bold on every list row and at the top of the details panel.

### Separate searches (tabs)
Each tab above the map is its own search, with its own filters (size, name, states, soil…), its own **ruled-out list**, sort order and map view. Tapping a parcel rules it out only in the active tab. Use **+ New** to add a tab; the **⋯** menu has Rename, Duplicate, Export as JSON, Import JSON and Delete. On phones the tab strip scrolls sideways. Everything is saved in localStorage (key `baseacre:land:v1`, format v2). Older saves move over on first load: the old global ruled-out list and filters go into the default (or active) tab.

### Rule out all results
The red **Rule out all N** button in the top bar rules out every parcel the current tab's search and filters match. That means all N matches, not just the list page or the map view, and it happens in one click with no confirmation. A toast with **Undo** (the top-bar Undo works too) brings back exactly the parcels that click ruled out. The button only changes the active tab's ruled-out list and is hidden when nothing matches.

### Owner / taxpayer name and mailing state
- **Name search**: case-insensitive partial match on the owner name **and** the taxpayer name (e.g. `yaggie`). Matches are highlighted in the list.
- **Mailing state**: a multi-select of every state in the data, with counts, plus **Unknown** and **Outside MN/ND**. A parcel matches if the owner's or the taxpayer's mailing state is one you picked (OR).
- Wilkin (MnGeo) gives `owner_name` and `tax_name` separately, each with its own address, but the owner name is filled for only about 520 of 4,748 parcels. Richland (ND tax roll) gives one owner/mailing name per record and no separate taxpayer. If a Richland roll state isn't a valid code (e.g. "ST" from "St Cloud"), the state is worked out from the first three digits of the ZIP.
