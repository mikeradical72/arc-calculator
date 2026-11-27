"""Build static parcel GeoJSON for the BaseAcre land finder.
Inputs (RAW dir, from fetch_parcels.py + SDA/CDL/TIGER downloads):
  wilkin_parcels.geojson, richland_parcels.geojson, richland_taxroll.json,
  cousub_*.geojson (Census TIGERweb), soil_poly_*.json / soil_comp_*.json / soil_mu_*.json (USDA SDA),
  cdl_<fips>_2025.tif (USDA NASS CDL via CropScape)
Output: data/land/<county>.geojson and data/land/meta.json
Run: python3 scripts/build_land.py /workspace/arcic/land/raw data/land"""
import json, re, sys, collections, datetime
import numpy as np, geopandas as gpd, pandas as pd, rasterio
from rasterio import features
from shapely import wkt as swkt
from shapely.geometry import mapping
RAW, OUT = sys.argv[1], sys.argv[2]
MIN_AC = 10.0
EA = 'EPSG:5070'

CROP = {1: 'Corn', 5: 'Soybeans', 23: 'Spring wheat', 24: 'Winter wheat', 41: 'Sugarbeets', 36: 'Alfalfa', 6: 'Sunflower', 42: 'Dry beans',
        21: 'Barley', 31: 'Canola', 28: 'Oats', 43: 'Potatoes', 53: 'Peas', 61: 'Fallow/idle', 12: 'Sweet corn', 4: 'Sorghum', 44: 'Other crops', 13: 'Pop corn', 22: 'Durum wheat', 32: 'Flaxseed', 205: 'Triticale', 27: 'Rye', 25: 'Other small grains', 26: 'Double crop (winter wheat/soybeans)', 29: 'Millet', 30: 'Speltz', 33: 'Safflower', 34: 'Rapeseed', 35: 'Mustard', 38: 'Camelina', 39: 'Buckwheat', 47: 'Misc. vegetables', 49: 'Onions', 57: 'Herbs', 58: 'Clover/wildflowers', 225: 'Double crop (winter wheat/corn)', 226: 'Double crop (oats/corn)', 236: 'Double crop (winter wheat/sorghum)', 237: 'Double crop (barley/corn)', 238: 'Double crop (winter wheat/cotton)', 240: 'Double crop (soybeans/oats)', 241: 'Double crop (corn/soybeans)', 254: 'Double crop (barley/soybeans)'}
def is_crop(v):
    return (1 <= v <= 61 and v not in (37, 59, 60)) or (66 <= v <= 77) or (204 <= v <= 254)
CROPMASK = np.array([is_crop(v) for v in range(256)])

def owner_type(name):
    s = ' ' + re.sub(r'[^A-Z0-9 ]', ' ', (name or '').upper()) + ' '
    if not name or not s.strip(): return 'Unknown'
    if re.search(r' (STATE OF|UNITED STATES|USA|U S A|COUNTY|CITY OF|VILLAGE OF|TOWNSHIP|TWP|SCHOOL|DIST|DISTRICT|WATERSHED|DNR|FISH|WILDLIFE|DEPT|DEPARTMENT|AUTHORITY|BOARD|RAILROAD|RAILWAY|BNSF|BURLINGTON) ', s): return 'Government / public'
    if re.search(r' (CHURCH|LUTHERAN|CATHOLIC|CEMETERY|PARISH|SYNOD|DIOCESE|ASSOCIATION|ASSN|FOUNDATION) ', s): return 'Church / nonprofit'
    if re.search(r' (TRUST|TRUSTEE|TRUSTEES|TRST|TRS|REVOCABLE|LIVING TR|TR) ', s): return 'Trust'
    if re.search(r' (ESTATE OF|ESTATE|EST) ', s) and not re.search(r'REAL ESTATE', s): return 'Estate'
    if re.search(r' (LLC|L L C|LLP|LLLP|LP|L P|INC|CORP|CORPORATION|CO|COMPANY|FARMS|FARM|PARTNERSHIP|PTNSHP|HOLDINGS|ENTERPRISES|LTD|BANK|COOP|CO OP|INVESTMENTS|PROPERTIES|LAND|REAL ESTATE|AG|AGRI|RANCH) ', s): return 'Business / farm entity'
    return 'Individual'

STATES = set('AL AK AZ AR CA CO CT DE DC FL GA HI ID IL IN IA KS KY LA ME MD MA MI MN MS MO MT NE NV NH NJ NM NY NC ND OH OK OR PA RI SC SD TN TX UT VT VA WA WV WI WY PR VI GU AE AP AA AB BC MB NB NL NS NT NU ON PE QC SK YT'.split())
# USPS 3-digit ZIP prefix -> state, used only when the roll's state field is missing or not a real state code.
ZIP3 = [(5,5,'NY'),(6,9,'PR'),(10,27,'MA'),(28,29,'RI'),(30,38,'NH'),(39,49,'ME'),(50,54,'VT'),(55,55,'MA'),(56,59,'VT'),(60,69,'CT'),(70,89,'NJ'),
  (100,149,'NY'),(150,196,'PA'),(197,199,'DE'),(200,200,'DC'),(201,201,'VA'),(202,205,'DC'),(206,219,'MD'),(220,246,'VA'),(247,268,'WV'),(270,289,'NC'),
  (290,299,'SC'),(300,319,'GA'),(320,349,'FL'),(350,369,'AL'),(370,385,'TN'),(386,397,'MS'),(398,399,'GA'),(400,427,'KY'),(430,459,'OH'),(460,479,'IN'),
  (480,499,'MI'),(500,528,'IA'),(530,549,'WI'),(550,567,'MN'),(570,577,'SD'),(580,588,'ND'),(590,599,'MT'),(600,629,'IL'),(630,658,'MO'),(660,679,'KS'),
  (680,693,'NE'),(700,714,'LA'),(716,729,'AR'),(730,749,'OK'),(750,799,'TX'),(800,816,'CO'),(820,831,'WY'),(832,838,'ID'),(840,847,'UT'),(850,865,'AZ'),
  (870,884,'NM'),(885,885,'TX'),(889,898,'NV'),(900,961,'CA'),(967,968,'HI'),(970,979,'OR'),(980,994,'WA'),(995,999,'AK')]
def zip_state(z):
    m = re.match(r'\s*(\d{5})', str(z or ''))
    if not m or m.group(1) == '00000': return None
    n = int(m.group(1)[:3])
    return next((st for lo, hi, st in ZIP3 if lo <= n <= hi), None)
STATS = collections.Counter()
def addr_state(lines):
    # MnGeo address lines: the city line looks like "Fargo, ND 58103"; take the last one that does.
    for x in reversed([l for l in lines if l]):
        m = re.search(r'\b([A-Z]{2})\s+\d{5}', x)
        if m and m.group(1) in STATES: return m.group(1)
    return None

def clean(r):
    return {k: (None if (isinstance(x, float) and np.isnan(x)) else x) for k, x in r.items()}

def title(s):
    return ' '.join(w.capitalize() if w.isupper() or w.islower() else w for w in (s or '').split()) or None

def load_wilkin():
    g = gpd.read_file(f'{RAW}/wilkin_parcels.geojson')
    g = g[g['acres_poly'].fillna(0) >= MIN_AC].copy()
    names = {n['objectid']: n for n in json.load(open(f'{RAW}/wilkin_names.json'))}
    rows = []
    for _, r in g.iterrows():
        a = clean(r)
        uc = a.get('useclass1')
        n = names.get(a['objectid'], {})
        own, tp = title(n.get('owner_name') or a['owner_name']), title(n.get('tax_name') or a['tax_name'])
        ost = addr_state([n.get(f'own_add_l{i}') for i in range(1, 5)]) if own else None
        tst = addr_state([n.get(f'tax_add_l{i}') for i in range(1, 5)])
        rows.append({
            'id': 'W' + str(a['state_pin'] or a['objectid']).replace('27167-', ''),
            'co': 'Wilkin', 'pin': a['county_pin'], 'ac': round(float(a['acres_poly']), 1),
            'dac': round(float(a['acres_deed']), 1) if a['acres_deed'] else None,
            'own': own, 'tp': tp, 'ost': ost, 'tst': tst,
            'cls': uc if isinstance(uc, str) and uc else 'Not listed',
            'val': int(a['emv_total']) if a['emv_total'] else None, 'lval': int(a['emv_land']) if a['emv_land'] else None,
            'legal': a['abb_legal'], 'str': f"S{int(a['section'])} T{int(a['township'])}N R{int(a['range'])}W" if a['section'] else None,
            'geometry': a['geometry']})
    return gpd.GeoDataFrame(rows, crs=4326)

def nd_state(t):
    st = (t.get('OwnerState') or '').strip().upper()
    if st in STATES: STATS['nd_state_ok'] += 1; return st
    z = zip_state(t.get('OwnerZip'))
    if z: STATS['nd_state_from_zip'] += 1; return z
    STATS['nd_state_unknown'] += 1; return None

def load_richland():
    g = gpd.read_file(f'{RAW}/richland_parcels.geojson')
    g = g[g['CalculatedAcres'].fillna(0) >= MIN_AC].copy()
    tr = json.load(open(f'{RAW}/richland_taxroll.json'))
    by = collections.defaultdict(list)
    for t in tr: by[t['UniqueGISID']].append(t)
    rows = []
    for _, r in g.iterrows():
        a = clean(r)
        ts = by.get(a['UniqueGISID'], [])
        t0 = ts[0] if ts else {}
        s = lambda k: sum((t.get(k) or 0) for t in ts) if ts else None
        uses = sorted({t.get('PrimaryParcelUse') for t in ts if t.get('PrimaryParcelUse')})
        agv = s('AgriculturalLandValue')
        cls = ', '.join(uses) if uses else ('Ag land value on roll' if agv else 'Not listed')
        rows.append({
            'id': 'R' + str(a['GISID']), 'co': 'Richland', 'pin': t0.get('ParcelID') or a['GISID'],
            'ac': round(float(a['CalculatedAcres']), 1), 'dac': None,
            'own': '; '.join(dict.fromkeys(title(t.get('OwnerName')) for t in ts if t.get('OwnerName'))) or None, 'tp': None,
            'ost': ' '.join(dict.fromkeys(x for x in (nd_state(t) for t in ts) if x)) or None, 'tst': None,
            'cls': cls, 'val': int(s('TotalValue')) if ts and s('TotalValue') else None,
            'lval': int(agv) if agv else None,
            'legal': t0.get('LegalDescription'), 'str': f"S{int(a['Section'])} T{int(a['Township'])}N R{int(a['Range'])}W" if a['Section'] else None,
            'nparcels': len(ts) or None,
            'geometry': a['geometry']})
    return gpd.GeoDataFrame(rows, crs=4326)

def soils(g, area):
    poly = json.load(open(f'{RAW}/soil_poly_{area}.json'))['Table']
    sp = gpd.GeoDataFrame({'mukey': [r[0] for r in poly]}, geometry=[swkt.loads(r[1]) for r in poly], crs=4326).to_crs(EA)
    sp['geometry'] = sp.buffer(0)
    comp = json.load(open(f'{RAW}/soil_comp_{area}.json'))['Table'][1:]
    num = collections.defaultdict(float); den = collections.defaultdict(float)
    for mukey, pct, val in comp:
        if val is not None and pct is not None:
            num[mukey] += float(pct) * float(val); den[mukey] += float(pct)
    nccpi = {k: num[k] / den[k] for k in num if den[k] > 0}
    mu = {r[0]: r for r in json.load(open(f'{RAW}/soil_mu_{area}.json'))['Table'][1:]}
    sp['nccpi'] = sp['mukey'].map(nccpi)
    sp['lcc'] = sp['mukey'].map(lambda k: mu.get(k, [None] * 4)[2])
    sp['drain'] = sp['mukey'].map(lambda k: mu.get(k, [None] * 4)[3])
    sp['muname'] = sp['mukey'].map(lambda k: mu.get(k, [None] * 4)[1])
    p = g[['id', 'geometry']].to_crs(EA)
    ov = gpd.overlay(p, sp, how='intersection', keep_geom_type=True)
    ov['a'] = ov.area
    out = {}
    for pid, grp in ov.groupby('id'):
        rated = grp[grp['nccpi'].notna()]
        tot = grp['a'].sum()
        ncc = (rated['nccpi'] * rated['a']).sum() / rated['a'].sum() if len(rated) and rated['a'].sum() > 0 else None
        lccs = grp[grp['lcc'].notna()]
        good = lccs[lccs['lcc'].astype(str).isin(['1', '2'])]['a'].sum() / tot if tot else None
        dom = grp.groupby('muname')['a'].sum().sort_values(ascending=False)
        domlcc = grp.groupby('lcc')['a'].sum().sort_values(ascending=False)
        out[pid] = {'nccpi': round(ncc * 100) if ncc is not None else None,
                    'lcc12': round(good * 100) if good is not None else None,
                    'lcc': str(domlcc.index[0]) if len(domlcc) else None,
                    'soil': dom.index[0] if len(dom) else None}
    return out

def cdl(g, path):
    with rasterio.open(path) as r:
        arr = r.read(1); p = g[['id', 'geometry']].to_crs(r.crs).reset_index(drop=True)
        lab = features.rasterize(((geom, i + 1) for i, geom in enumerate(p.geometry)), out_shape=arr.shape, transform=r.transform, fill=0, dtype='int32')
    n = len(p) + 1
    tot = np.bincount(lab.ravel(), minlength=n)
    crop = np.bincount(lab.ravel(), weights=CROPMASK[arr.ravel()].astype(float), minlength=n)
    out = {}
    m = lab > 0
    keys = lab[m].astype(np.int64) * 256 + arr[m].astype(np.int64)
    uk, cnt = np.unique(keys, return_counts=True)
    best = {}
    for k, c in zip(uk, cnt):
        i, v = divmod(int(k), 256)
        if is_crop(v) and c > best.get(i, (0, 0))[0]: best[i] = (c, v)
    for i, pid in enumerate(p['id']):
        t = tot[i + 1]
        b = best.get(i + 1)
        out[pid] = {'crop': round(100 * crop[i + 1] / t) if t else None,
                    'c25': (CROP.get(b[1], f'CDL class {b[1]}') if b and crop[i + 1] / max(t, 1) >= 0.2 else None)}
    return out

def township(g, key):
    cs = gpd.read_file(f'{RAW}/cousub_{key}.geojson')[['NAME', 'geometry']]
    pts = g[['id', 'geometry']].to_crs(EA).copy(); pts['geometry'] = pts.representative_point()
    j = gpd.sjoin(pts, cs.to_crs(EA), how='left', predicate='within').drop_duplicates('id')
    return dict(zip(j['id'], j['NAME']))

def finish(g, area, fips, key):
    seen = collections.Counter()
    ids = []
    for i in g['id']:
        seen[i] += 1; ids.append(i if seen[i] == 1 else f'{i}~{seen[i]}')
    g = g.copy(); g['id'] = ids
    print(key, len(g)); s = soils(g, area); print(' soils', len(s)); c = cdl(g, f'{RAW}/cdl_{fips}_2025.tif'); t = township(g, key)
    p = g.to_crs(EA)
    p['geometry'] = p.simplify(4, preserve_topology=True)
    g = p.to_crs(4326)
    feats = []
    for _, a in g.iterrows():
        pid = a['id']; props = clean({k: a[k] for k in g.columns if k != 'geometry'})
        props.update(s.get(pid, {})); props.update(c.get(pid, {})); tw = t.get(pid); props['twp'] = (tw if isinstance(tw, str) else '').replace(' township', ' Twp').replace(' city', ' (city)') or None
        props['otype'] = owner_type(props.get('own') or props.get('tp'))
        sts = sorted({x for v in (props.get('ost'), props.get('tst')) if v for x in v.split()})
        props['sts'] = sts
        props['absentee'] = any(x not in ('MN', 'ND') for x in sts) if sts else None
        props = {k: (None if (isinstance(v, float) and np.isnan(v)) else (int(v) if v is not None and (isinstance(v, np.integer) or k in ('val', 'lval')) else v)) for k, v in props.items()}
        props = {k: v for k, v in props.items() if v is not None and v != []}
        geom = mapping(a.geometry)
        def rnd(o):
            if isinstance(o, (list, tuple)):
                if o and isinstance(o[0], (int, float)): return [round(o[0], 5), round(o[1], 5)]
                return [rnd(x) for x in o]
            return o
        feats.append({'type': 'Feature', 'properties': props, 'geometry': {'type': geom['type'], 'coordinates': rnd(geom['coordinates'])}})
    json.dump({'type': 'FeatureCollection', 'features': feats}, open(f'{OUT}/{key}.geojson', 'w'), separators=(',', ':'))
    return feats

meta = {'built': datetime.date.today().isoformat(), 'minAcres': MIN_AC, 'counties': {}}
for key, loader, area, fips in [('wilkin', load_wilkin, 'MN167', '27167'), ('richland', load_richland, 'ND077', '38077')]:
    feats = finish(loader(), area, fips, key)
    meta['counties'][key] = {'count': len(feats)}
for key in ['wilkin', 'richland']:
    cs = gpd.read_file(f'{RAW}/county_{key}.geojson').to_crs(EA); cs['geometry'] = cs.simplify(30); cs = cs.to_crs(4326)
    json.dump(json.loads(cs[['NAME', 'geometry']].to_json()), open(f'{OUT}/county_{key}.geojson', 'w'), separators=(',', ':'))
json.dump(meta, open(f'{OUT}/meta.json', 'w'), indent=1)
meta['stateStats'] = dict(STATS)
json.dump(meta, open(f'{OUT}/meta.json', 'w'), indent=1)
print(meta)
