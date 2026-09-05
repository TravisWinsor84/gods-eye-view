# Final Victoria/Australia data-source gap sweep

Date verified: 2026-09-05

This addendum records the final official-source sweep after the original
catalogue, expanded vector, registered-operations and raster plans. It adds
only materially distinct sources. Emergency, health, live utility outage,
events and camera discovery produced no additional source with a stronger
authoritative and reusable contract than the existing plans.

## Admit: fixed DataVic WFS

All six use `https://opendata.maps.vic.gov.au/geoserver/wfs`, anonymous HTTPS,
CC BY 4.0 and the bounded OGC adapter. Add fixed type/property allow-lists,
viewport/cap queries, public-projection IDs, geometry limits, source-specific
caveats and off-by-default category membership.

| Source ID | Official dataset | WFS type | Shape/cadence | Required meaning |
| --- | --- | --- | --- | --- |
| `vic-ev-chargers` | Government Funded Public EV Chargers | `open-data-platform:dcav_site` | 152 points; monthly | Reference funded sites only; no occupancy, price, service or live availability claim. |
| `vic-renewable-facilities` | Renewables Facility Location for Victoria | `open-data-platform:renewables` | 252 multipolygons; cadence unstated | Planning/infrastructure context; not live generation or operating state. |
| `vic-flood-history-2022` | Victorian Flood History - October 2022 Event Public | `open-data-platform:vic_flood_history_public` | 1,826 multipolygons; event-derived | Historical/incomplete observed evidence only; not current extent, peak extent, flash-flood coverage or warning. |
| `vic-epa-priority-sites` | EPA Victoria Priority Sites Register location polygons | `open-data-platform:psr_polygon` | 69 multipolygons; cadence unstated | Register footprint; absence does not mean uncontaminated/safe. Strip addresses, descriptions and notice/internal identifiers. |
| `vic-landfill-register` | Victorian Landfill Register location polygons | `open-data-platform:vlr_polygon` | 277 multipolygons; cadence unstated | Reference register with explicit possible lag; no current operating/safety inference. |
| `vic-recreation-assets` | DEECA Recreation Assets | `open-data-platform:recweb_asset` | 3,173 points; daily | Public-land amenity inventory; no current open/maintained claim. Strip comments, serials, photo IDs and operational fields. |

Official catalogue pages:

- https://discover.data.vic.gov.au/dataset/government-funded-public-ev-chargers
- https://discover.data.vic.gov.au/dataset/renewables-facility-location-for-victoria
- https://discover.data.vic.gov.au/dataset/victorian-flood-history-october-2022-event-public
- https://discover.data.vic.gov.au/dataset/epa-victoria-priority-sites-register-psr-location-polygons
- https://discover.data.vic.gov.au/dataset/epa-victoria-victorian-landfill-register-vlr-location-polygons
- https://discover.data.vic.gov.au/en_AU/dataset/recreation-assets

## Admit: bounded DataVic CKAN point index

Add `vic-waste-facilities` from resource
`e44f5d96-51e8-48ec-b674-299d100a0231` in Victoria's Waste and Resource
Recovery Infrastructure Map Data. The current October 2025 snapshot has 663
points and an "as needed" cadence. Resolve official CKAN metadata, page the
DataStore under fixed fields/row caps, omit address and ownership/free-text,
and expose facility name/type, suburb/LGA and snapshot date as reference only.
Inclusion must not imply current operation.

Official dataset:
https://discover.data.vic.gov.au/dataset/victoria-s-waste-and-resource-recovery-infrastructure-map-data

## Conditional admit: high-zoom cadastral REST

Add a high-zoom-only `vic-property-boundaries` layer using the official Vicmap
Property/Parcel/Easement ArcGIS FeatureServer services. Query only validated
small viewports at a strict minimum zoom, fixed output fields and feature/
geometry caps. Do not expose owners or addresses, infer ownership, or present
the geometry as a legal boundary determination. Catalogue cadence is weekly
and licence is CC BY 4.0.

Verified implementation contract:

- Primary polygon layer: `Vicmap_Parcel/FeatureServer/0` (`PARCEL_MP`) at
  `https://services-ap1.arcgis.com/P744lA0wf4LlBZ84/ArcGIS/rest/services/Vicmap_Parcel/FeatureServer/0`.
- Optional mutually-exclusive property view: `Vicmap_Property/FeatureServer/0`
  (`PROPERTY_MP`). Road casements are a supplementary polygon layer at
  `Vicmap_Property_Easements_and_Road_Casements/FeatureServer/1`; easement
  layer 0 is polyline and is excluded from this polygon adapter.
- The live services report `Query,Extract`, GeoJSON support and a provider
  `maxRecordCount` of 2,000. The application cap remains 500 and requests 501
  only to detect an overfull viewport; it does not silently truncate or page.
- Admit only at zoom 18 or closer and independently enforce a Victoria-
  intersecting bbox no more than 750 metres wide/high or 0.25 square kilometres.
  Reject geometry over 5,000 coordinates/feature, 50,000/response, 128 rings,
  or 2 MB decoded. Do not simplify cadastral geometry.
- Request fixed public reference fields plus `OBJECTID` for deterministic
  ordering, then strip `OBJECTID`, council property numbers, address-adjacent
  identifiers, workflow/lineage fields, shape metrics and any future owner,
  occupier, valuation, billing, contact or joined-address fields.
- Label every result reference-only and not a survey or legal boundary
  determination. The specific REST catalogue says weekly while broader product
  records say continual; retain the conservative weekly claim and record the
  catalogue inconsistency.

Official dataset:
https://discover.data.vic.gov.au/dataset/vicmap-property-rest-api

## Admit through versioned preprocessing

The current Victorian Wetland Inventory is the 2025 release, approximately
427,540 polygons. It is download-only (GDB/SHP/MIF/CAD), with no current-version
operational WFS. Add `vic-wetlands-2025` only through a reproducible,
version/hash-verified preprocessing pipeline that produces bounded simplified
viewport data and retains wetland type, water regime, source/confidence and
edition. Do not substitute the discoverable older NVR WFS and call it current.

Official dataset:
https://discover.data.vic.gov.au/dataset/victorian-wetland-inventory-current

## Hold for affirmative licence

- Harmonised National Roadworks and Road Closures: useful nightly historical
  ArcGIS service, but catalogue licence is `Not Specified`; do not ship until
  display/cache/derivative rights are confirmed.
- National Formal Rest Areas: useful amenity service, but licence is `Not
  Specified` and official cadence conflicts between monthly and quarterly; do
  not ship until both are clarified.

## Commercial list

- Xweather Lightning: account client ID/secret, near-real-time strikes/flashes
  and threat polygons, mandatory attribution. Official pay-as-you-go includes
  15,000 free accesses, then US$0.0006/base access; lightning uses a 10x
  multiplier, before spatial/time multipliers. Conditional only after external
  display/cache rights are confirmed.
- VesselFinder: EUR 330/10,000, EUR 625/20,000 or EUR 1,470/50,000 credits,
  excluding VAT; terrestrial positions cost one credit and satellite ten.
  Default terms restrict redistribution/caching, so reject for the public
  overlay unless an enterprise order expressly permits it.
- ATDW remains the preferred governed paid statewide events option already in
  the source matrix: Industry AU$165/month plus AU$165 setup; Lite AU$220/month
  plus AU$660 setup; Premium AU$400/month plus AU$660 setup, with annual prepay.

## Execution order

1. Extend the OGC adapter with the six fixed DataVic WFS sources and review.
2. Add the waste-facility CKAN adapter and review.
3. Add the high-zoom Vicmap ArcGIS layer and review.
4. Build and verify the versioned wetlands preprocessing/index path.
5. Include every admitted source in the category/status UI task.
6. Continue the registered-operations and raster plans, then perform one final
   live/provider/browser/deployment proof pass.
