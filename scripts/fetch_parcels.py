"""Download raw parcel data for Wilkin Co., MN and Richland Co., ND from public ArcGIS REST services.
Writes to RAW dir (not committed). Run: python3 scripts/fetch_parcels.py /workspace/arcic/land/raw"""
import json, sys, time, urllib.parse, urllib.request, os
RAW = sys.argv[1] if len(sys.argv) > 1 else 'raw'
os.makedirs(RAW, exist_ok=True)
MN = 'https://enterprise.gisdata.mn.gov/aghost/rest/services/us_mn_state_mngeo/plan_parcels_open/FeatureServer/0/query'
ND = 'https://services1.arcgis.com/GOcSXpzwBHyk2nog/arcgis/rest/services/NDGISHUB_Parcels/FeatureServer'

def get(url, params, tries=4):
    q = urllib.parse.urlencode(params)
    for t in range(tries):
        try:
            req = urllib.request.Request(url, data=q.encode(), headers={'User-Agent': 'BaseAcre-build/1.0'})
            with urllib.request.urlopen(req, timeout=120) as r:
                return json.load(r)
        except Exception as e:
            print('retry', t, e); time.sleep(3 * (t + 1))
    raise RuntimeError(url)

def paged(url, where, fields, geom=True, page=1000, fmt='geojson'):
    out, off = [], 0
    while True:
        p = {'where': where, 'outFields': fields, 'returnGeometry': 'true' if geom else 'false', 'f': fmt,
             'resultOffset': off, 'resultRecordCount': page, 'orderByFields': 'OBJECTID' if 'NDGIS' in url else 'objectid'}
        if geom: p.update({'outSR': 4326, 'geometryPrecision': 6})
        d = get(url, p)
        feats = d.get('features', [])
        out += feats; off += len(feats)
        print(url.split('/')[-3] if geom else 'table', off)
        if not feats or (len(feats) < page and not d.get('exceededTransferLimit')): break
    return out

mn_fields = 'objectid,county_pin,state_pin,ctu_name,owner_name,owner_more,own_add_l1,own_add_l2,own_add_l3,own_add_l4,tax_name,tax_add_l1,tax_add_l2,tax_add_l3,tax_add_l4,homestead,acres_poly,acres_deed,emv_land,emv_bldg,emv_total,tax_year,mkt_year,useclass1,useclass2,useclass3,multi_uses,tax_exempt,green_acre,ag_preserv,sale_date,sale_value,abb_legal,ownership,section,township,range,range_dir,plat_name,edit_date'
mn = paged(MN, "co_name='Wilkin'", mn_fields)
json.dump({'type': 'FeatureCollection', 'features': mn}, open(f'{RAW}/wilkin_parcels.geojson', 'w'))
nd = paged(ND + '/0/query', "CountyName='Richland'", 'OBJECTID,GISID,UniqueGISID,Section,Township,Range,TownshipName,CalculatedAcres,Ownership,FeatureType,SourceDate,LastUpdateDate')
json.dump({'type': 'FeatureCollection', 'features': nd}, open(f'{RAW}/richland_parcels.geojson', 'w'))
tr = paged(ND + '/1/query', "CountyName='Richland'", '*', geom=False, fmt='json')
json.dump([f['attributes'] for f in tr], open(f'{RAW}/richland_taxroll.json', 'w'))
print('done', len(mn), len(nd), len(tr))
