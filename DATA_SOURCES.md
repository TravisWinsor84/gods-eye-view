# Data Sources & Attribution

God's Eye View's **code** is [MIT](LICENSE)-licensed. **The MIT grant covers the source code only — it does NOT extend to third-party data or visual assets.** Every third-party source keeps its own license and terms. This file documents the live and bundled data sources; bundled 3D-model provenance is recorded in [`public/models/README.md`](public/models/README.md).

How to read this:

- **The non-permissive datasets are carved out, not omitted.** Some bundled data (e.g. TeleGeography, CC BY-NC-SA) isn't MIT-compatible. Rather than hide it, we **bundle it with a clear license carve-out** so the app works out of the box — but it stays under the provider's terms.
- **If your use doesn't fit a dataset's license, remove that dataset.** Most importantly: TeleGeography is **NonCommercial** — commercial users must delete it (or license it from TeleGeography). It's one self-contained folder.
- **Attribution is shown in-app** and listed here. Keep it intact. The required Google/Cesium credit renders on the on-globe credit line (bottom-left, `#cesium-credits`), and every per-layer credit below is registered into the expandable **"Data attribution"** lightbox on that line (`src/data/dataCredits.js` → `viewer.creditDisplay.addStaticCredit`). Both stay visible in clean-view and recording modes.
- **Bundled model attribution lives beside the model files.** [`public/models/README.md`](public/models/README.md) records each shipped model's creator, source, license, and modification status.

---

## Live sources (fetched at runtime — not stored in this repo)

| Source | Used for | License / terms | Attribution |
|--------|----------|-----------------|-------------|
| **Google Map Tiles API** (Photorealistic 3D Tiles) + Places/Geocoding | The 3D globe, voice scene context, and on-demand nearby installation search | Google Maps Platform ToS (proprietary, your own key + billing) | "Google" / "Google Maps" logo — **shown in-app**, required |
| **OpenSky Network** | Primary worldwide live-flight snapshot | Non-commercial research/education license | Schäfer et al., *"Bringing Up OpenSky"*, IPSN 2014 + opensky-network.org |
| **adsb.lol point API** | Bounded live-flight fallback when OpenSky has no usable snapshot | ODbL 1.0 | adsb.lol contributors; `api.adsb.lol/v2/lat/{lat}/lon/{lon}/dist/{radius}` |
| **adsb.lol** | Military flights + aircraft traces | ODbL 1.0 | "adsb.lol" (ODbL) |
| **AISStream.io** | Live vessels (AIS) | Free, beta, no formal ToS; AIS is a public broadcast | "AISStream.io" (courtesy) |
| **CelesTrak** | Satellite TLEs (SGP4) | US-government-origin data, no license; citation requested | "CelesTrak (celestrak.org), Dr. T.S. Kelso" |
| **The Space Devs — Launch Library 2 v2.3** | Recent launch, payload, stage, and recovery metadata for Space Missions (30d) | [The Space Devs terms of use](https://github.com/TheSpaceDevs/Tutorials/blob/main/faqs/faq_TSD.md#terms-of-use): data may be used and shared in any form; avoid forwarding it without added value; attribution is encouraged (not mandatory). [Official API limits](https://ll.thespacedevs.com/docs/): 15 unauthenticated calls/hour; optional token | "Launch Library 2 — The Space Devs" (courtesy attribution) |
| **Esri World Imagery** (ArcGIS Online tile service) | The keyless satellite basemap — the default landing when no Google/ion credential is configured, and the "Esri Satellite" map stack | [Esri Master Agreement](https://www.esri.com/en-us/legal/terms/full-master-agreement): the public World Imagery service is usable in public-facing apps with attribution; no key is required for this classic endpoint, but Esri governs and can change access — an app at scale should review current ArcGIS Location Platform terms | "Powered by Esri — Source: Esri, Maxar, Earthstar Geographics, and the GIS User Community" (provider carries the service's own credit line) |
| **USGS** | Earthquakes | U.S. public domain | "Data courtesy of the U.S. Geological Survey" |
| **OpenStreetMap (Overpass API)** | Road geometry for traffic | ODbL 1.0 | "© OpenStreetMap contributors" |
| **TomTom Traffic API** (flow vector tiles) | Live congestion coloring for the traffic layer (optional, BYOK) | [TomTom for Developers terms](https://developer.tomtom.com) (proprietary, your own key; free tier currently 200K tile requests/month — see [current pricing](https://docs.tomtom.com/pricing/)) | "Traffic flow data © TomTom" — registered when live mode activates |
| **OpenStreetMap (Overpass API)** | Viewport-bounded mapped installation context for Global Context | ODbL 1.0 | "© OpenStreetMap contributors" (incomplete mapped context) |
| **OpenStreetMap (Nominatim)** | Reverse-geocoded place label in the cockpit Local Info page | ODbL 1.0 + Nominatim usage policy | "© OpenStreetMap contributors" |
| **Open-Meteo** | Current weather in the cockpit Local Info page and cockpit-local dynamic atmospheric effects | [CC BY 4.0 data licence and adjacent-link attribution requirement](https://open-meteo.com/en/licence) | Linked "Weather data by Open-Meteo.com" beside the displayed local data |
| **Google News RSS** | Primary locality-matched headlines in the cockpit Regional News page | [Google News Terms of Service](https://www.google.com/intl/en_us/terms_google_news.html) restrict use to personal, noncommercial use; linked articles remain third-party publisher content and retain publisher terms | "Google News RSS" plus each article's linked publisher/domain |
| **GDELT Project DOC 2.0** | Fail-soft fallback for location-matched cockpit headlines | [GDELT Terms of Use](https://www.gdeltproject.org/about.html#termsofuse): unrestricted academic/commercial/governmental dataset use, with citation and link required; linked articles retain publisher terms | "GDELT Project" plus each article's linked publisher/domain |
| **City of Austin Open Data** | CCTV camera catalog + frames | City of Austin Open Data Terms of Use | "City of Austin, TX — data.austintexas.gov" |
| **Caltrans (cwwp2.dot.ca.gov)** | CCTV camera catalogs + frames, California districts | Public Caltrans traffic camera data | "Caltrans — cwwp2.dot.ca.gov" (courtesy) |
| **TfL Open Data (JamCams)** | CCTV camera catalog + frames, London | [TfL Open Data terms](https://tfl.gov.uk/info-for/open-data-users/) — attribution REQUIRED | "Powered by TfL Open Data. Contains OS data © Crown copyright and database rights" |
| **GBFS (Lyft / BCycle)** | Bikeshare availability | Per-feed (attribution-only) | Credit the operator (e.g. Austin BCycle) + its `license_url` |
| **Radio Browser** | Geolocated internet-radio station directory and station-level tags | Public-domain directory data under PDDL 1.0; individual broadcaster stream terms apply | "Radio Browser" plus a link to the selected broadcaster |
| **Re:Earth Terrain** (Mapterhorn) | Terrain (keyless globe stacks — OSM etc. — + `/api/terrain/heights` ellipsoidal-height lookups) | Terrain mesh: CC BY 4.0; geoid: EGM2008 (NGA, public domain) | "Terrain (keyless globe stacks): Re:Earth Terrain / Mapterhorn (CC BY 4.0) / EGM2008 (NGA)" |

### Victorian and Australian regional catalogue

This table contains implemented regional sources, validated candidates that are
not wired into a layer yet, and deliberately gated catalogue-only records. Each
entry below states its actual integration status; runtime eligibility alone does
not imply that a proxy route or category layer exists. Implemented adapters use
the allow-listed regional proxy and packs described below. Entries marked not
runtime eligible have no browser fetch, request template, proxy transport or
pack membership. Any provider credential remains server-side and is documented
only after its authenticated contract has been validated.

| Source ID | Official publisher and endpoint | Licence / terms | Exact attribution | Geometry | Refresh model |
|-----------|---------------------------------|-----------------|-------------------|----------|---------------|
| `melbourne-trees` | City of Melbourne, [Open Data Explore API](https://data.melbourne.vic.gov.au/api-console/explore/v2.1/) | CC BY, as declared by the selected City of Melbourne dataset | `City of Melbourne Open Data` | Point | Daily; source record catalogue refresh |
| `melbourne-places` | City of Melbourne, [Open Data Explore API](https://data.melbourne.vic.gov.au/api-console/explore/v2.1/) | CC BY, as declared by the selected City of Melbourne dataset | `City of Melbourne Open Data` | Point | Daily; source record catalogue refresh |
| `melbourne-cycling` | City of Melbourne, [Open Data Explore API](https://data.melbourne.vic.gov.au/api-console/explore/v2.1/) | CC BY, as declared by the selected City of Melbourne dataset | `City of Melbourne Open Data` | Line | Daily; viewport-bounded source query |
| `melbourne-water-history` | City of Melbourne, [Open Data Explore API](https://data.melbourne.vic.gov.au/api-console/explore/v2.1/) | CC BY, as declared by the selected City of Melbourne dataset | `City of Melbourne Open Data` | Line or polygon | Weekly; static/historical source check |
| `vic-epa-air` | Environment Protection Authority Victoria, [EPA developer portal](https://portal.api.epa.vic.gov.au/); exact API endpoint is not yet validated | **Registration and product subscription required - not runtime eligible.** Validate the subscribed endpoint, schema, quota, attribution and developer/API terms before activation. | `EPA Victoria` | Not normalized or displayed | Not fetched. EPA reports hourly air observations, but no application cadence is claimed until the subscribed API contract is smoke-tested. |
| `vic-cfa-alerts` | Country Fire Authority Victoria, [CFA RSS feeds](https://www.cfa.vic.gov.au/rss-feeds) | **Restricted - not runtime eligible.** CFA RSS terms limit use to personal, non-commercial use, prohibit modification, and require supplied links to be displayed. | `CFA RSS feeds` | Not normalized or displayed | Not fetched. A compatible official feed or written developer data-feed contract is required before reconsideration. |
| `vic-fire-context` | State of Victoria, [DataVic](https://discover.data.vic.gov.au/) | Creative Commons Attribution 4.0 International, subject to the selected dataset's listing | `State of Victoria (DataVic)` | Polygon or line | Daily viewport query |
| `vic-freight-network` | State of Victoria, [DataVic](https://discover.data.vic.gov.au/) | Creative Commons Attribution 4.0 International, subject to the selected dataset's listing | `State of Victoria (DataVic)` | Line or point | Daily viewport query |
| `au-hydrology` | Bureau of Meteorology / Geoscience Australia, [Australian Hydrological Geospatial Fabric](https://www.bom.gov.au/water/geofabric/) | Creative Commons Attribution 4.0 International, subject to the selected service/dataset listing | `Bureau of Meteorology / Geoscience Australia` | Line or polygon | Weekly viewport query |
| `au-emergency-facilities` | Geoscience Australia, [Emergency Management Facilities ArcGIS service](https://services.ga.gov.au/gis/rest/services/Emergency_Management_Facilities/MapServer) | Creative Commons Attribution 4.0 International; incorporates G-NAF under the G-NAF End User Licence Agreement | `© Commonwealth of Australia (Geoscience Australia) 2023. This material is released under the Creative Commons Attribution 4.0 International Licence. Incorporates or developed using G-NAF © Geoscape Australia licensed by the Commonwealth of Australia under the Open Geo-coded National Address File (G-NAF) End User Licence Agreement.` | Point | Implemented registry, sanitizer and daily viewport proxy; not assigned to a visible category pack until Task 6 |
| `au-health-facilities` | Geoscience Australia / Healthdirect, [National HealthDirect Health Facilities ArcGIS service](https://services.ga.gov.au/gis/rest/services/National_HealthDirect_Health_Facilities/MapServer) | The live service states Creative Commons Attribution 4.0 International and incorporated G-NAF terms; the Data.gov catalogue licence remains unspecified | `© Commonwealth of Australia (Geoscience Australia) 2025`<br>`This material is released under the Creative Commons Attribution 4.0 International Licence.`<br><br>`Incorporates or developed using G-NAF © Geoscape Australia licensed by the Commonwealth of Australia under the Open Geo-coded National Address File (G-NAF) End User Licence Agreement.` | Point | Implemented registry, sanitizer and daily viewport proxy; periodic reference directory, not assigned to a visible category pack until Task 6 |
| `au-place-names` | Geoscience Australia, [Composite Gazetteer of Australia ArcGIS service](https://services.ga.gov.au/gis/rest/services/Composite_Gazetteer_of_Australia/MapServer) | Service attribution: Geoscience Australia; compiled reference data | `Geoscience Australia` | Point | Implemented registry, sanitizer and weekly viewport proxy; not assigned to a visible category pack until Task 6 |
| `au-dea-hotspots` | Geoscience Australia / Digital Earth Australia, [DEA Hotspots WFS](https://hotspots.dea.ga.gov.au/geoserver/wfs), fixed `public:hotspots_three_days` layer | Dataset-specific [DEA Hotspots](https://data.gov.au/data/api/3/action/package_show?id=digital-earth-australia-hotspots) and [WFS](https://data.gov.au/data/api/3/action/package_show?id=digital-earth-australia-hotspots-wfs) catalogue licences are `notspecified`; fallback is [Geoscience Australia's current general copyright terms](https://www.ga.gov.au/copyright): Creative Commons Attribution 4.0 International, subject to specific statements, third-party rights and accompanying notices | `© Commonwealth of Australia (Geoscience Australia) 2026. This material is licensed under the Creative Commons Attribution 4.0 International Licence. Observe and retain any copyright or related notices that may accompany this material as part of the attribution.` | Point | Implemented five-minute viewport cache over the fixed three-day observation layer; last-good limited to fifteen minutes; satellite observation context only, not warning or evacuation advice; not assigned to a visible category pack until Task 6 |
| `vic-parks` | State of Victoria, [DataVic WFS](https://opendata.maps.vic.gov.au/geoserver/wfs), fixed `open-data-platform:parkres` layer | Creative Commons Attribution 4.0 International | `State of Victoria (DataVic)` | Polygon or multipolygon | Implemented daily viewport cache; reference reserve boundaries with name/type/manager only; last-good limited to seven days; not assigned to a visible category pack until Task 6 |
| `vic-recreation-tracks` | State of Victoria, [DataVic WFS](https://opendata.maps.vic.gov.au/geoserver/wfs), fixed `open-data-platform:recweb_tracks` layer | Creative Commons Attribution 4.0 International | `State of Victoria (DataVic)` | Line or multiline | Implemented daily viewport cache; reference alignment only, explicitly not live closure or condition state; last-good limited to seven days; not assigned to a visible category pack until Task 6 |
| `vic-heritage` | State of Victoria, [DataVic WFS](https://opendata.maps.vic.gov.au/geoserver/wfs), fixed `open-data-platform:heritage_register` layer | Creative Commons Attribution 4.0 International | `State of Victoria (DataVic)` | Polygon or multipolygon | Implemented daily viewport cache with unknown publisher cadence; bounded topology-checked simplification; last-good limited to seven days; not assigned to a visible category pack until Task 6 |
| `vic-ev-chargers` | State of Victoria, [Government Funded Public EV Chargers](https://discover.data.vic.gov.au/dataset/government-funded-public-ev-chargers), fixed `open-data-platform:dcav_site` WFS layer | Creative Commons Attribution 4.0 International | `State of Victoria (DataVic)` | Point | Implemented monthly-source reference through a daily viewport cache and seven-day last-good ceiling; funded sites only, not occupancy, pricing, service or live availability; no category-pack membership yet |
| `vic-renewable-facilities` | State of Victoria, [Renewables Facility Location for Victoria](https://discover.data.vic.gov.au/dataset/renewables-facility-location-for-victoria), fixed `open-data-platform:renewables` WFS layer | Creative Commons Attribution 4.0 International | `State of Victoria (DataVic)` | Polygon or multipolygon | Adapter and proxy contract implemented for planning/infrastructure context only; not live generation or operation. The 2026-09-05 full-state live probe failed bounded topology validation and is not accepted as runtime-proven; no category-pack membership yet. |
| `vic-flood-history-2022` | State of Victoria, [Victorian Flood History - October 2022 Event Public](https://discover.data.vic.gov.au/dataset/victorian-flood-history-october-2022-event-public), fixed `open-data-platform:vic_flood_history_public` WFS layer | Creative Commons Attribution 4.0 International | `State of Victoria (DataVic)` | Polygon or multipolygon | Historical and incomplete October 2022 evidence only, not current/peak extent, flash-flood coverage or warning. Adapter/proxy limits are implemented, but the 2026-09-05 live feature has 1,410 rings and fails the 512-ring cap before simplification; it is not runtime-proven and has no category-pack membership. |
| `vic-epa-priority-sites` | EPA Victoria, [Priority Sites Register location polygons](https://discover.data.vic.gov.au/dataset/epa-victoria-priority-sites-register-psr-location-polygons), fixed `open-data-platform:psr_polygon` WFS layer | Creative Commons Attribution 4.0 International | `State of Victoria (DataVic)` | Polygon or multipolygon | Implemented daily viewport cache with seven-day last-good; register footprint only and absence does not mean uncontaminated or safe; no category-pack membership yet |
| `vic-landfill-register` | EPA Victoria, [Victorian Landfill Register location polygons](https://discover.data.vic.gov.au/dataset/epa-victoria-victorian-landfill-register-vlr-location-polygons), fixed `open-data-platform:vlr_polygon` WFS layer | Creative Commons Attribution 4.0 International | `State of Victoria (DataVic)` | Polygon or multipolygon | Implemented daily viewport cache with seven-day last-good; possible register lag and no current operating/safety inference; no category-pack membership yet |
| `vic-recreation-assets` | State of Victoria, [DEECA Recreation Assets](https://discover.data.vic.gov.au/en_AU/dataset/recreation-assets), fixed `open-data-platform:recweb_asset` WFS layer | Creative Commons Attribution 4.0 International | `State of Victoria (DataVic)` | Point | Implemented daily viewport cache with seven-day last-good; inventory presence does not prove open or maintained; capped/partial at 1,000 of 3,173 statewide matches; no category-pack membership yet |
| `vic-property-boundaries` | State of Victoria, [Vicmap Property REST API](https://discover.data.vic.gov.au/dataset/vicmap-property-rest-api), fixed `Vicmap_Parcel/FeatureServer/0` polygon layer | Creative Commons Attribution 4.0 International | `State of Victoria (DataVic), Vicmap Property — licensed under Creative Commons Attribution 4.0 International.` | Polygon or multipolygon | High-zoom-only reference parcel geometry at zoom 18 or closer, independently limited to a Victoria-intersecting viewport no more than 750 metres per side or 0.25 square kilometres. The REST catalogue says weekly while broader product records describe continual maintenance. Not a survey or legal boundary determination. |
| `melbourne-drinking-fountains` | City of Melbourne, [Drinking Fountains](https://data.melbourne.vic.gov.au/explore/dataset/drinking-fountains/information/) through Explore API v2.1 | [Creative Commons Attribution 4.0 International](https://creativecommons.org/licenses/by/4.0/) | `City of Melbourne Open Data — licensed under Creative Commons Attribution 4.0 International.` | Point | Implemented six-hour viewport cache; publisher source cadence is daily; last-good is limited to three missed daily publisher cycles; inventory only and not assigned to a visible category pack until Task 6 |
| `melbourne-barbecues` | City of Melbourne, [Public Barbecues](https://data.melbourne.vic.gov.au/explore/dataset/public-barbecues/information/) through Explore API v2.1 | [Creative Commons Attribution 4.0 International](https://creativecommons.org/licenses/by/4.0/) | `City of Melbourne Open Data — licensed under Creative Commons Attribution 4.0 International.` | Point | Implemented six-hour viewport cache; publisher source cadence is daily; last-good is limited to three missed daily publisher cycles; inventory only and not assigned to a visible category pack until Task 6 |
| `melbourne-parking-live` | City of Melbourne, [On-street Parking Bay Sensors](https://data.melbourne.vic.gov.au/explore/dataset/on-street-parking-bay-sensors/information/) joined to [On-street Parking Bays](https://data.melbourne.vic.gov.au/explore/dataset/on-street-parking-bays/information/) through Explore API v2.1 JSON exports | [Creative Commons Attribution 4.0 International](https://creativecommons.org/licenses/by/4.0/) | `City of Melbourne Open Data — licensed under Creative Commons Attribution 4.0 International.` | Point | Implemented provider-wide two-minute cache; bbox filtering follows the server-side join; each observation becomes stale after five minutes; not assigned to a visible category pack until Task 6 |
| `melbourne-development` | City of Melbourne, [Development Activity Monitor](https://data.melbourne.vic.gov.au/explore/dataset/development-activity-monitor/information/) through Explore API v2.1 | [Creative Commons Attribution 4.0 International](https://creativecommons.org/licenses/by/4.0/) | `City of Melbourne Open Data — licensed under Creative Commons Attribution 4.0 International.` | Point | Implemented daily viewport cache for a monthly planning/development source; not live works and not assigned to a visible category pack until Task 6 |
| `melbourne-culture` | City of Melbourne, [Outdoor Artworks](https://data.melbourne.vic.gov.au/explore/dataset/outdoor-artworks/information/) and [Public Memorials and Sculptures](https://data.melbourne.vic.gov.au/explore/dataset/public-memorials-and-sculptures/information/) through Explore API v2.1 | Dataset metadata is [Creative Commons Attribution 4.0 International](https://creativecommons.org/licenses/by/4.0/); media rights remain record-specific | `City of Melbourne Open Data — licensed under Creative Commons Attribution 4.0 International.` | Point | Implemented daily viewport cache; reference metadata with unspecified inspection cadence; not assigned to a visible category pack until Task 6 |
| `au-public-toilets` | Australian Government, [National Public Toilet Map CKAN package](https://data.gov.au/data/api/3/action/package_show?id=553b3049-2b8b-46a2-95e6-640d7986a8c1); the current CSV resource is selected from metadata rather than a pinned rotating filename | **Legal review required.** The structured catalogue says Creative Commons Attribution 3.0 Australia, while package notes require prompt updates and describe a non-transferable licence with no sublicensing. These terms conflict, so this project does not overstate redistribution rights. | `National Public Toilet Map, Australian Government` | Point | Implemented provider-wide CSV index. Metadata is revalidated hourly regardless of the provider's 30-day cache header; the file gets a conditional check every six hours, with finite three-day last-good. Reference inventory only, never proof a facility is currently open; no category-pack membership until Task 6. |
| `vic-transport-stops` | Department of Transport and Planning Victoria, [Public Transport Lines and Stops CKAN package](https://opendata.transport.vic.gov.au/api/3/action/package_show?id=public-transport-lines-and-stops); the exact stops GeoJSON resource is selected from package metadata | [Creative Commons Attribution 4.0](https://creativecommons.org/licenses/by/4.0/) | `Source: Department of Transport and Planning Victoria, Public Transport Lines and Stops, licensed under Creative Commons Attribution 4.0.` | Point | Implemented provider-wide GeoJSON index. Metadata is revalidated hourly and the file conditionally checked daily, with finite seven-day last-good. Package/resource dates remain separate. Reference inventory only, never realtime or evidence that a service is running; interstate coach endpoints remain valid; no category-pack membership until Task 6. |
| `ptv-transit` | Public Transport Victoria, [Transport Victoria Open Data Portal GTFS Realtime](https://opendata.transport.vic.gov.au/dataset/gtfs-realtime) | [Creative Commons Attribution 4.0 International](https://creativecommons.org/licenses/by/4.0/); one Open Data Portal key is required server-side | `Source: Licensed from Public Transport Victoria under a Creative Commons Attribution 4.0 International Licence.` | Point (vehicle positions) | Metro, tram, bus and V/Line provider snapshots cached globally by mode for at least 30 seconds; bbox filtering occurs after decode |
| `au-hospital-ed-performance` | Australian Institute of Health and Welfare, [MyHospitals API](https://www.aihw.gov.au/hospitals/other-resources/myhospitals-api) | [CC BY 4.0](https://www.aihw.gov.au/copyright); no credentials | `Based on Australian Institute of Health and Welfare material.` | Point (hospital reporting units) | 24-hour application cache; release-cycle historical data |

`au-hospital-ed-performance` is approved only for aggregate, period-based
AIHW MyHospitals emergency-department performance. It is never a live wait,
demand, capacity, ambulance-offload, medical-routing or treatment-forecast
source. Every normalized datum keeps its official link, reporting period, API
freshness metadata, caveats and error state. Suppressed values are marked but
never emitted as numbers. This registration does not add a proxy, layer or UI.

The three GA ArcGIS sources are reference inventories, not operational feeds.
Their server-owned requests use only fixed service/layer IDs, an envelope bbox
in EPSG:4326, fixed public field lists, at most two 500-feature pages per
sublayer, a 1,000-feature normalized cap and the regional proxy's one-megabyte
per-response cap. Emergency facilities never imply staffing, readiness,
response time or ambulance availability. Health facilities never imply current
opening, clinical suitability, capacity, medicine stock, ED waits or medical
advice. Place names are compiled reference labels and are not navigation data.
The sanitizer omits provider object IDs, G-NAF address IDs, Healthdirect service
IDs, authority IDs, comments, contacts and full street addresses. Partial
sublayer failures are returned as degraded source status without exposing
provider errors. These routes are implemented but are not visible in a category
layer or pack until the explicit Task 6 integration.

The ten OGC routes use fixed WFS 2.0 `GetFeature` templates. Each request
includes an EPSG:4326 bbox and output CRS, GeoJSON output, both the WFS 2
`count` ceiling and GeoServer's WFS 1-compatible `maxFeatures` ceiling, and a
source-specific public `propertyName` allow-list. Redirects and non-JSON media
types fail closed. Response bodies are stream-limited to 2 MB while the shared
provider-wide semaphore is held; normalization then enforces the source feature
cap, finite longitude/latitude, exact geometry nesting, 50,000 input coordinates
per feature and 100,000 per response. Polygon holes must lie strictly inside
their shell without touching or crossing it; holes may not overlap, touch or
nest; and sibling multipolygon members may not overlap, touch or contain one
another. Relationship and ring checks share a 150,000-comparison budget per
normalization, with only linear bounds storage; exhausting it rejects the
refresh. Ring direction is not an admission requirement because official
GeoJSON is inconsistent, but simplification must preserve each ring's original
orientation. Malformed, contradictory-count or excessive geometry rejects the
refresh instead of being cached. Duplicate or wrong-geometry rows are removed
deterministically and make source status partial rather than current.

DEA output retains observation time and provider-supplied positional uncertainty
and confidence, but no provider ID, file name or operational free text. Its
375 m-type satellite-detection caveat explicitly says the layer is observation
context, not warning or evacuation advice. Parks retain only reserve name, type
and manager. Recreation tracks retain only name and public classification and
never expose closure, condition, comments or maintenance fields. Heritage keeps
only site name and heritage-object type, labels publisher cadence unknown, and
never exposes register/internal IDs or sensitive/free-text fields. Heritage
polygon input is validated before deterministic reduction to at most 4,000
coordinates per feature; closed rings, original orientation, simple-ring and
full polygon/multipolygon relationships are revalidated after simplification.
A failed refresh uses source-local
last-good data only inside the catalogue ceiling, otherwise returns a sanitized
timeout/unavailable/invalid response.

The six final-gap DataVic routes use only their documented public field
allow-lists and derive stable public IDs from sanitized geometry and properties;
provider IDs, addresses, comments, descriptions, notice/licence/reference IDs,
raw coordinates and media/link identifiers are not emitted. EV charger sites,
renewable facilities, EPA priority sites, landfill records and recreation
assets are reference context with the source-specific caveats in the table.
Flood history is always historical/incomplete October 2022 evidence. Its
request count is one and its source-only limits are 1.5 MB per response, 60,000
input coordinates per feature, 75,000 per response, 4,000 output coordinates
per feature and 500,000 topology comparisons; every other OGC source retains
the shared 2 MB, 50,000/100,000-coordinate and 150,000-comparison ceilings.
The current live flood feature cannot satisfy the implemented ring/output
combination without discarding topology, so the route currently fails closed
rather than serving misleading geometry. See the Task 1 report for exact live
evidence.

The five Melbourne civic sources use fixed City of Melbourne Explore API v2.1
requests and strict public-field allow-lists. Offset-paginated datasets use
fixed server-owned ordering fields; any provider identifier needed only for
ordering is never normalized or returned. Overlapping pages are defensively
deduplicated and reported partial. Fountains and barbecues expose only type,
inventory date and geometry; their presence does not guarantee current
operability. Development records omit
development/property/application identifiers and full street addresses and are
labelled monthly context rather than live works or permit advice. Cultural
records retain only bounded title, type and date metadata; address-bearing
property/description fields, asset/service-manager fields, long histories,
inscriptions and record imagery are not exposed.

Parking is the only provider-wide Melbourne civic source. The server makes two
fixed JSON export requests per refresh (sensor observations and non-null joined
bay geometry), with one request per table, a 4 MiB per-table ceiling, a 32 MiB
aggregate ceiling, and hard row ceilings of 8,000 sensors and 32,000 bays. The
two tables are downloaded and coalesced once per two minutes, joined by
`kerbsideid`, indexed in process, and bbox-filtered only after the join. Provider
identifiers are not returned. Each record preserves its exact `lastupdated`,
`status_timestamp` and bay publication date and is independently stale after
five minutes. A failed refresh can retain source-local last-good parking tables
for at most ten minutes; the inventory sources use explicit seven- or thirty-day
ceilings appropriate to their publication cadence. `Present` and `Unoccupied`
are sensor observations only: network
delay, public holidays, construction and changed restrictions can make them
misleading, so the UI must never promise availability or legality and users
must check current street signs. Missing geometry, table or dataset failures,
byte or row caps, and retained last-good tables are surfaced as partial, stale
or unavailable status rather than silently presented as complete.

The two indexed-download sources resolve the current resource through a fixed
official CKAN `package_show` URL before file revalidation. Metadata must be JSON
and the selected resource must have the exact expected name, format and media
type, a UUID resource ID, an HTTPS URL on the source's fixed host, a matching
package/resource path and a declared size under the source cap. Redirects are
rejected. Download validators are opaque and URL-scoped: ETag and Last-Modified
are sent only while the resource ID and URL remain unchanged, so a rotated
resource or filename cannot inherit old validators. A 304 reuses the bounded
parsed index and updates its validation state.

File bodies are consumed while holding the shared four-request provider
semaphore. Declared compressed length and streamed decoded bytes are bounded;
CSV rows and GeoJSON features have separate hard caps. The National Public
Toilet Map uses a maintained quote-aware CSV parser, finite string coordinates
and strict `True`/`False` flags. It emits only bounded name, facility type,
accessibility, payment and descriptive opening-hours text. Addresses, provider
keys, URLs, notes and other free text are omitted. Opening-hours text always
states that it is not proof the facility is currently open, and no row-level
currency or update date is invented.

Transport stops accept only finite WGS84 Point features and expose bounded stop
name and mode plus a reference-only caveat. `STOP_ID` remains an opaque source
string used neither as a public ID nor as a sole deduplication key; duplicate
IDs and interstate coach endpoints are retained when their public projections
differ. No stop claims realtime state, service operation or a per-feature date.
For both sources, normalized public properties and coordinates determine stable
public IDs and deterministic cap order. Exact duplicate public projections are
removed, digest collisions receive stable ordinals, and bbox queries reuse one
process-global bucket index rather than refetching by viewport. Responses
distinguish current, partial and finite stale last-good state and surface the
package metadata date, resource modified date and, where provided, the distinct
dataset-last-updated date.

`vic-epa-air` is deliberately fail-closed. The previously recorded URL was an
information page, not a supported API endpoint, and the guessed gateway route
returned 404 during provider research. EPA developer-portal signup and product
subscription are still required before the real endpoint and key contract can
be inspected. The source therefore has no callable request template, no
environment-variable contract, and no pack membership. Do not add an EPA key
name or endpoint to configuration until an authenticated, licence-compatible
air-quality response has been validated without exposing the credential.

`ptv-transit` uses only the four current vehicle-position feeds beneath
`https://api.opendata.transport.vic.gov.au/opendata/public-transport/gtfs/realtime/v1`:
metro, tram, bus and V/Line. The server sends
`TRANSPORT_VIC_OPEN_DATA_API_KEY` only in the upstream `KeyID` header with
`Accept: application/x-protobuf`; browser requests remain fixed to
`/api/regional/ptv-transit` with validated bounds. Set the browser-safe boolean
`VITE_TRANSPORT_VIC_OPEN_DATA_CONFIGURED=true` alongside the server-only key to
add this source to the Victoria pack; it contains no credential. Responses use
a deterministic digest identity and retain only safe trip and route identifiers
plus timestamp, bearing and occupancy when valid. GTFS entity IDs, vehicle IDs,
publisher-facing labels and licence plates are never exposed. Each response
reports per-mode current, stale or unavailable status and feed age; over-age
positions are discarded. A single 32 MiB provisional hard safety ceiling is
enforced while streaming each feed. The authenticated 2026-09-05 snapshot was
15,354 bytes for metro, 119,651 bytes for bus and 3,290 bytes for V/Line; tram
returned an honest HTTP 500 provider failure, so repeated successful measurements
across all four modes are still required before introducing source-specific
limits. Trip updates,
departures and static GTFS joins are not implemented. The legacy PTV v3
credential contract is not used.

### Australian civic candidates that are not executable

The separate validation-decision catalogue in `src/data/regionalSources.js`
keeps the following records out of executable regional-source contracts. They
have `runtimeEligible: false`, `endpoint: null`, no request template and no
image proxy/cache permission. Canonical official pages may be linked only.

| Candidate | Decision | Boundary |
|-----------|----------|----------|
| [VAHI daily non-urgent ED wait](https://vahi.vic.gov.au/reports/emergency-department-non-urgent-wait-time) | Permission required | Daily but not live; no supported machine endpoint and VAHI requires prior written consent for republication. |
| [VAHI quarterly emergency care](https://vahi.vic.gov.au/emergency-care/ambulance-patient-transfers) | Metadata/link-only | Quarterly and preliminary where stated; no supported public data feed. |
| [Ambulance Victoria quarterly performance](https://www.ambulance.vic.gov.au/our-performance) | Metadata/link-only | Official reports are PDFs, not a stable runtime feed; they do not show current ambulance availability. |
| [DTP/VicTraffic cameras](https://transport.vic.gov.au/road-and-active-transport/business-and-industry/road-and-traffic-management/traffic-cameras-and-cctv) | Metadata/link-only | No documented public image API; the general CC BY licence excludes images and third-party material. |
| [Boating Vic cameras](https://www.boating.vic.gov.au/) | Metadata/link-only | No documented public image API; Safe Transport Victoria's general licence excludes images, photographs and third-party material. |
| [Gippsland Ports webcams](https://gippslandports.vic.gov.au/boating/webcams/) | Restricted/rejected | No image-reuse grant; the publisher's embedded players do not authorise direct linking. |
| [City of Port Phillip Marina Reserve webcam](https://www.portphillip.vic.gov.au/explore-the-city/beaches-parks-and-playgrounds/find-parks-and-playgrounds/marina-reserve) | Permission required | A public low-resolution player is not a supported still-image API or republication licence. |
| [FFMVic FireWeb cameras](https://fireweb.ffm.vic.gov.au/) | Restricted/rejected | Registered operational service; no anonymous camera API or public reuse grant. |
| [Bureau of Meteorology imagery](https://www.bom.gov.au/catalogue/data-feeds.shtml) | Licence required | Product-specific display/redistribution rights are required; anonymous availability is not a public runtime-image licence. |

No investigated Australian camera source is runtime-image eligible. Do not
scrape viewers, derive private endpoints, hotlink, proxy, archive or cache their
images. Full validation evidence and adapter details are in
[`docs/australian-civic-source-validation.md`](docs/australian-civic-source-validation.md).

### Notes on the live sources

- **Google Maps Platform.** You supply your own API key and are bound by [Google's ToS](https://cloud.google.com/maps-platform/terms). Google Maps Content (tiles, geocodes, places) **may not be cached, stored, rehosted, or committed** — this app only ever uses it live, which is the compliant pattern. The "Google" attribution is displayed on the globe and must stay visible. Restrict your key (see [SECURITY.md](SECURITY.md)).
- **OpenSky Network.** Its license is **non-commercial**, and operational use of the REST API in a live product can require a prior written agreement with OpenSky — even for non-profit/government use. If you deploy this commercially, contact OpenSky for your own terms. The flights layer is a toggle and runs anonymously by default.
- **adsb.lol flight fallback.** When OpenSky is unavailable and no last-good OpenSky response exists, the server requests a cached, capped 250 nm adsb.lol point snapshot around the current camera subpoint. This is regional observed context, not worldwide completeness; provenance is exposed in the Flights stats/context row. Military ICAOs remain reconciled through the existing dedicated military registry rather than duplicated.
- **Launch Library 2.** `/api/launches` makes a server-side rolling-30-day query against the supported v2.3 detailed launch endpoint, caches successful responses for 15 minutes in memory and on disk, and serves the last successful response during a throttle or transient outage. Anonymous access is limited to 15 calls/hour; deployments can provide `LL2_API_TOKEN` for authenticated access. The Space Devs' published terms permit using and sharing the API data in any form, ask users not to forward it without adding value, disclaim complete accuracy, and encourage—but do not require—attribution. This app keeps a courtesy credit. Payload and stage/recovery records are shown only when supplied. Failed launches expose their source status and never receive fallback orbit geometry or a live/estimated marker. LL2 supplies launch context and event timing, not continuous ascent telemetry or live orbital state.
- **TfL JamCams.** The camera list comes from the keyless `api.tfl.gov.uk` endpoint (an optional `TFL_APP_KEY` raises its rate limit); frames come from TfL's public S3 bucket. The "Powered by TfL Open Data" attribution is required by TfL's terms and is registered in the Data attribution popover.
- **Radio Browser.** `/api/radio/stations` discovers official API mirrors, makes bounded and coalesced healthy/geolocated HTTPS-station queries, caches the normalized public-domain directory for 45 minutes, and may serve the last good catalog for up to seven days during an outage. Refreshes must meet minimum accepted-query and station coverage before replacing a warm catalog; schema-valid responses whose rows all fail the product's health policy do not count as successful queries. A usable partial cold catalog is explicitly `DEGRADED`, and malformed or empty successful payloads are rejected atomically. Every directory and click-count request rejects redirects, validates all resolved addresses as globally routable (including reserved/documentation IPv4 and special/non-global IPv6 exclusions), and pins the TLS connection to a validated address. Only MP3/AAC non-HLS directory rows with public HTTPS stream targets are returned; favicons are intentionally omitted. Pressing play connects one browser audio element directly to the selected broadcaster and calls the directory's click counter through known-ID-only `POST /api/radio/click/:uuid`. GEV never proxies, caches, records, bundles, or redistributes audio. Radio Browser supplies station-level tags, not dependable current-song or upcoming-program metadata, so Radio filtering never claims either. Direct playback exposes the listener's IP address to the broadcaster, whose own stream terms apply.
- **TomTom Traffic.** Optional and BYOK: without `TOMTOM_API_KEY` the traffic layer runs its built-in simulation and no TomTom data (or attribution) appears. With a key, flow vector tiles are fetched through the server-side `/api/tomtom` proxy (120 s cache + a daily tile-budget governor — `TOMTOM_DAILY_TILE_BUDGET`, default 40,000, a configurable application safety ceiling, not a guarantee of staying within TomTom's monthly free allowance; TomTom's [current pricing](https://docs.tomtom.com/pricing/) lists 200K free tile requests per month) and the "Traffic flow data © TomTom" credit is registered in the Data attribution popover the moment live mode activates. TomTom data is served live and cached only transiently (≤120 s TTL under `.gev-cache/`, gitignored) — it is not bundled or redistributed. One 23 KB point-in-time tile snapshot is committed as a decode-test fixture (`src/data/fixtures/`, © TomTom, never served to the app).
- **Re:Earth Terrain.** Keyless (no API key). Used two ways: (1) `src/mapStackController.js` swaps in a `Cesium.CesiumTerrainProvider` pointed at Re:Earth's `cesium-mesh/ellipsoid` quantized-mesh endpoint for globe stacks without a Cesium ion token (e.g. OSM), replacing a flat `EllipsoidTerrainProvider`; falls back to the flat provider if the endpoint can't be reached. (2) The server-side `/api/terrain/heights` proxy (disk-cached, serve-stale) resolves per-point ellipsoidal ground height for entity placement. Both are best-effort with a keyless-safe fallback (bundled EGM96 geoid math) if Re:Earth is unreachable.
- **Global Context installation context.** `/api/military-installations` queries only an allow-listed subset of OSM `military=*` and `landuse=military` features inside a maximum 10° non-dateline viewport. It caches and may serve stale mapped context, but it is neither a global installation database nor evidence of capability, activity, or absence. User-requested Google Places results remain separately sourced candidates unless their returned types explicitly establish military classification; generic offices, museums, and similarly ambiguous matches are excluded from military proximity counts.
- **Cockpit regional briefing.** `/api/regional-brief` rounds aircraft coordinates into 0.1° cache cells, caches results for five minutes, and serializes Nominatim calls at no more than one request per second. Google News RSS is queried with the resolved locality/region first; GDELT is used only when that RSS query fails or is empty. Google's published Google News terms restrict that source to personal, noncommercial use, so commercial deployments must disable/replace it or obtain separate permission; GDELT permits commercial dataset use with citation. The Data attribution popover identifies the active headline sources; article links retain publisher attribution. Headlines are location-query matches, not verified incidents, risk rankings, or evidence that a location is safe. Empty, partial, stale, and unavailable source states remain distinct. Open-Meteo supplies current conditions independently of the news source. `WX OFF` disables cockpit weather rendering only; the Local Info briefing still fetches its source-backed weather values and displays the required linked Open-Meteo credit.
- **Dynamic weather presentation.** While cockpit mode is active, `/api/weather-effects` requests current Open-Meteo observations for the aircraft/camera location, rounds coordinates into 0.1° cache cells, caches results for five minutes, and may retain a stale observation for up to 30 minutes during a transient outage. WMO condition code selects the visual family; observed cloud cover, precipitation, visibility, wind speed, and wind direction bound its strength and motion. Missing or expired weather renders no synthetic atmospheric effect, and normal globe view never renders the weather overlay.

---

## Bundled snapshots (committed under `src/data/local_data/`)

Static datasets shipped in the repo for an out-of-the-box experience. **None are MIT** — each keeps its own license (see the carve-out in [LICENSE](LICENSE)). Each folder also has its own provenance README.

| Dataset | Folder | License | Commercial use? | Attribution |
|---------|--------|---------|-----------------|-------------|
| **Datacenters** (~4.3K) | `datacenters/` | **ODbL 1.0** (OpenStreetMap extract) | ✅ (attribution + share-alike on data) | "© OpenStreetMap contributors" |
| **Dams** (704) | `dams/` | **ODbL 1.0** (OpenInfraMap / OSM extract) | ✅ (attribution + share-alike on data) | "© OpenStreetMap contributors" (+ Open Infrastructure Map) |
| **TeleGeography Submarine Cable Map** (712 cables + 1,917 landing points) | `telegeography_submarine_cables/` | **CC BY-NC-SA 3.0** | ❌ **NonCommercial — remove for commercial use** | "© TeleGeography — submarinecablemap.com" |
| **Natural Earth physical regions** (1,046 land + 292 marine named polygons) | `natural_earth/` | **Public domain** | ✅ (no restrictions) | "Made with Natural Earth" (courtesy credit — not legally required) |
| **DataSF Analysis Neighborhoods** (41 SF neighborhood polygons) | `neighborhoods/` | **PDDL 1.0** (public domain) | ✅ (no restrictions) | "City & County of San Francisco — DataSF" (courtesy — not legally required) |

### ⚠️ TeleGeography is bundled but NonCommercial

The submarine-cable GeoJSON is **CC BY-NC-SA 3.0** (Attribution-**NonCommercial**-**ShareAlike**). It is bundled so the cables layer works out of the box, but it is **not covered by this project's MIT license**. CC BY-NC-SA permits redistribution with attribution and share-alike — which is exactly how it ships here — but the **NonCommercial** clause means:

> If you use God's Eye View commercially, delete `src/data/local_data/telegeography_submarine_cables/` (or obtain a commercial license from TeleGeography). It is one self-contained folder; the rest of the app runs without it.

The richer structured dataset is licensed separately/commercially by TeleGeography.

### ODbL share-alike (datacenters, dams)

The OSM-derived datasets are under the **Open Database License**. ODbL's share-alike applies to the **data / derived database, not this MIT-licensed code** — the two coexist (exactly how Open Infrastructure Map ships: MIT software + ODbL data). If you publicly distribute a *modified* version of these databases, you must offer it under ODbL. Keep the "© OpenStreetMap contributors" notice (link: https://www.openstreetmap.org/copyright).

### NASA FIRMS acknowledgement

> We acknowledge the use of data and/or imagery from NASA's Fire Information for Resource Management System (FIRMS) (https://earthdata.nasa.gov/firms), part of NASA's Earth Observing System Data and Information System (EOSDIS).

FIRMS active fires are **fetched live at runtime** (CC0 / U.S. public domain data): the
`/api/firms` server-side proxy merges the three VIIRS NRT sources (NOAA-20, NOAA-21,
Suomi-NPP) clamped to the trailing 24 h, cached 30 min to respect the shared MAP_KEY
transaction quota. Requires a free `FIRMS_MAP_KEY`
(https://firms.modaps.eosdis.nasa.gov/api/map_key/); the layer is empty without it.
The former bundled 2026-05-25 snapshot was removed 2026-07-16.

### Natural Earth physical regions (`natural_earth/`)

Curated from the **Natural Earth 10m physical vectors** (https://www.naturalearthdata.com/ —
fetched from the canonical `nvkelso/natural-earth-vector` GitHub repo, commit
`ca96624a56bd078437bca8184e78163e5039ad19`, 2026-07-28): `ne_10m_geography_regions_polys`
(mountain ranges, deserts, plateaus, peninsulas, islands, …) → `regions.json` and
`ne_10m_geography_marine_polys` (seas, gulfs, straits, bays) → `marine.json`. They back the
voice-annotation resolver's named-natural-region lookup (`src/data/naturalEarthRegions.js`),
so "outline the Alps" draws the real range polygon offline.

Curation (provenance in each file's `meta` header): named features only, outer rings only,
Douglas-Peucker simplified at ~0.01° with coordinates rounded to 3 decimals, sub-20 km²
MultiPolygon crumbs and zero-area sliver artifacts dropped (7.3 MB source → 2.5 MB pack).

Natural Earth is **public domain** (no permission needed, no attribution legally required —
https://www.naturalearthdata.com/about/terms-of-use/). We credit anyway: "Made with Natural
Earth". Registration in the in-app `dataCredits.js` attribution list ships with the resolver
wiring (see below).

### DataSF Analysis Neighborhoods (`neighborhoods/`)

`neighborhoods/san-francisco.json` bundles the City & County of San Francisco's official
**"Analysis Neighborhoods"** dataset (41 neighborhood polygons; DataSF dataset `j2bu-swwd`,
catalog map view
[`p5b7-5n3h`](https://data.sfgov.org/Geographic-Locations-and-Boundaries/Analysis-Neighborhoods-Map/p5b7-5n3h)).
It backs the voice-annotation resolver's offline neighborhood-boundary lookup
(`src/data/neighborhoodPolygons.js`), so "outline Chinatown" draws the city's real
boundary polygon with no network dependency.

The dataset is licensed **PDDL 1.0** (Open Data Commons Public Domain Dedication and
License — public domain; the DataSF metadata declares `licenseId: "PDDL"`). No attribution
is legally required; we note the source here and in the folder's `SOURCE.md`, which records
the retrieval date (2026-07-30), exact download URL, license evidence, and the
deterministic transform (`scripts/build-sf-neighborhoods.mjs`: `nhood` → `name`, ~2 m
Douglas-Peucker simplification, 6-decimal rounding).

---

## In-app attribution

The required Google Maps / Cesium credit renders on the on-globe credit line (`#cesium-credits`, bottom-left) and must stay visible — including in clean-view and recording modes (the whole line, logo + "Google Maps" + the "Data attribution" link, stays on screen; only the GEV panels/HUD fade). The layer-specific credits (adsb.lol, TeleGeography, OSM datacenters/dams/roads, NASA FIRMS, CelesTrak, USGS, City of Austin, GBFS, Radio Browser, OpenSky, AISStream, Public Transport Victoria, Geoscience Australia and incorporated G-NAF material) are registered into the expandable **"Data attribution"** popover on that credit line via `viewer.creditDisplay.addStaticCredit(new Cesium.Credit(html, /* showOnScreen */ false))` — see `src/data/dataCredits.js`. When you add a new data source, add its license and attribution to this file **and** append an entry to `DATA_CREDITS` in `src/data/dataCredits.js` so it surfaces in the app.
