# Expanded Victorian and Australian overlays design

## Objective

Add the largest defensible set of useful Victorian and Australian map sources to Gods Eye View while preserving truthful freshness, source attribution, privacy, provider licences, bounded runtime cost, and a comprehensible layer UI.

## Admission rule

A runtime source needs all of the following:

1. an official or first-party supported endpoint or versioned download;
2. reuse terms compatible with this deployment;
3. geometry that can be bounded by provider query or server-side indexing;
4. explicit timestamps/cadence and stale semantics;
5. a sanitizer that exposes only useful public fields; and
6. a failure mode that cannot erase other sources or mislabel historical data as live.

Publicly visible viewers and anonymously reachable service directories are not permission. Hidden viewer calls must not be scraped. Cameras require both a supported feed and explicit image embedding/redistribution rights; none currently qualifies.

## Accepted implementation families

### Free vector and point sources

- `au-emergency-facilities`: Geoscience Australia ambulance, police, metro/rural fire, SES and other emergency-facility layers. Reference inventory only; never imply staffing or readiness.
- `au-health-facilities`: GA/Healthdirect hospitals, general practices and pharmacies. Reference inventory only; never imply current opening, suitability, capacity, medicine stock or wait time.
- `au-place-names`: GA Composite Gazetteer, bbox queried and capped.
- `au-public-toilets`: National Public Toilet Map versioned CSV, indexed server-side after validating the file's embedded currency.
- `au-dea-hotspots`: DEA Hotspots WFS `public:hotspots_three_days`, bounded by bbox/time. Satellite detections are approximate and are not a warning or safety-of-life service.
- `melbourne-drinking-fountains` and `melbourne-barbecues`: City of Melbourne Opendatasoft point records.
- `melbourne-parking-live`: City of Melbourne parking sensors joined to parking-bay geometry/restrictions, with `lastupdated`, `status_timestamp` and provider caveats; never guarantee availability or legality.
- `melbourne-development`: Development Activity Monitor, clearly monthly/planned/historical rather than current works.
- `melbourne-culture`: outdoor artworks, memorials and sculptures; metadata only unless record-level media rights permit imagery.
- `vic-parks`: DataVic WFS `open-data-platform:parkres`.
- `vic-recreation-tracks`: DataVic WFS `open-data-platform:recweb_tracks`; existence is not current opening status.
- `vic-heritage`: DataVic WFS `open-data-platform:heritage_register` with official register links and unknown-cadence status.
- `vic-transport-stops`: current Transport Victoria Public Transport Stops GeoJSON or static GTFS-derived stops, with publisher date and no realtime claim.

### Registered operational sources

- `ptv-transit`: current Transport Victoria GTFS-Realtime vehicle feeds, implemented by the amended existing plan with one server-only portal key.
- `vic-road-unplanned`, `vic-road-planned`, `vic-freeway-travel-time`, and `vic-lane-signals`: current Transport Victoria Open Data Portal APIs using the same server-only key, provider-wide caches and sanitized source-specific normalizers.
- `vic-epa-air`: must be changed from the incorrect credential-free contract to EPA developer-portal registration, product subscription and a server-only key. Until that exact endpoint and licence are smoke-tested, it is not runtime eligible and must not remain in the default pack.

### Raster/context sources

- DEA WMS layers for Water Observations Statistics, annual land cover, coastlines and selected fuel-moisture context after exact current layer-name verification.
- GA relief/elevation and national seismic-hazard context.
- DataVic planning and coastal-inundation WMS layers where the exact selected layer has CC BY 4.0 terms and visible scenario/date caveats.

Raster layers are separate from vector packs and must use fixed, allow-listed imagery providers; no arbitrary WMS URL or layer name may be browser-controlled.

## Layer information architecture

Keep existing regional layers for compatibility and add category layers so users can understand what they enabled:

- `regional-civic`: facilities and public amenities;
- `regional-mobility`: transit, parking and road operations;
- `regional-environment`: hotspots, parks, tracks and environmental context;
- `regional-planning`: heritage, development and legal/reference context.

The three existing regional packs retain their current source membership for saved-link compatibility. Each newly admitted source belongs to exactly one category pack; category sources do not duplicate one another. Provider/proxy caches still coalesce an existing-source overlap if a legacy and category layer are enabled together.

Each layer card and the Context card must show human source names, current/stale/error/credentials-required state, observation or publication age, and whether data is live, recent, periodic, historical or modelled. Long place/source names must wrap or truncate without covering map controls at 320 px width.

## Operational boundaries

- Browser requests contain only an allow-listed source ID and validated bbox.
- Provider keys remain server-only, never use a `VITE_` prefix, and never appear in URLs, client payloads, logs or errors.
- Provider-wide feeds/downloads are fetched once per cache window and filtered after decode/indexing; bbox changes must not multiply upstream requests.
- Dynamic source cohorts retain source-local last-good data only within an explicit maximum stale age. Authentication failures never return stale success.
- Whole-file sources have byte, row, decompression and feature caps; use conditional requests and bounded indexes.
- Sensitive or irrelevant fields, internal IDs, licence plates, maintenance contacts and personal/free-text fields are removed.
- Tests cover real provider shapes, malformed data, stale transitions, partial failures, teardown races and attribution.

## Deferred, restricted and paid

- Live hospital/ambulance operations, utility outages, VicEmergency feeds, FFMVic operations, WMIS, shared bike/scooter availability, SkyBus GTFS and all cameras remain link-only or permission-gated until a supported licensed contract exists.
- BOM radar/satellite/lightning requires a product-specific redistribution licence and likely paid registered service.
- ATDW is the strongest governed events source but requires distributor approval and annual prepaid plans; document cost/features rather than subscribe without a separate purchase decision.
- Airservices charts/data and AMSA live/historical movement products remain restricted, non-commercial or paid as recorded in the source matrix.

## Verification

Completion requires source-level contract tests, full repository tests, production build, a clean independent review for every task, server-side authenticated smoke tests for registered feeds, browser-visible layer/status checks, and live host verification through Cloudflare Access. Code or mocked tests alone are not deployed proof.
