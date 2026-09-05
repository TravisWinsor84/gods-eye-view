# Victorian and Australian Data Catalogue

## Goal

Add the widest practical set of official Victorian, Melbourne, and Australian
map overlays to God's Eye View without making any feed failure, credential
expiry, or licensing constraint able to impair the existing globe.

## Delivery model

Each source is an independent data-layer adapter. An adapter declares its
attribution, scope, refresh cadence, cache policy, parameters, and whether it
is static, live, or requires a server-side credential. `main.js` registers the
adapter through the existing `DataLayerManager`; the layer control therefore
gets the same lifecycle, error state, share-link, and clear-all behavior as
the current layers.

Server-side proxies are used for registered services. They accept a small,
validated request shape, cache upstream responses, use a bounded timeout and
payload size, and never expose provider secrets to the browser. Static CC-BY
data is converted to compact GeoJSON/GeoJSONL only when its licence permits
redistribution; WFS/REST data remains upstream-backed and is fetched by
viewport/bounds rather than bundled statewide.

## Source tiers

### Tier 1: no-account official sources

| Adapter | Geographic scope | Data | Delivery |
| --- | --- | --- | --- |
| Melbourne places | City of Melbourne | public toilets, drinking fountains, bicycle parking, street furniture, parks | Opendatasoft API, cached GeoJSON points |
| Melbourne Urban Forest | City of Melbourne | tree species, dimensions, health/urban-forest attributes | Opendatasoft API; clustered and zoom-gated |
| Melbourne cycling | City of Melbourne | bicycle network and protection class | GeoJSON/API line layer |
| Melbourne water history | City of Melbourne | former wetlands and surface-flow routes | static GeoJSON line/polygon layers |
| Victoria air quality | Victoria | current EPA stations, AQI, forecasts and notices | EPA Environment Monitoring API; live point layer |
| Victoria emergency context | Victoria | CFA incidents, total-fire-ban and fire-danger RSS; fire districts | RSS proxy plus DataVic boundary source |
| Victorian planning/fire context | Victoria | bushfire-prone areas, fire history, fire-management zones | DataVic WFS/REST; viewport polygons |
| Victorian transport context | Victoria | principal freight roads, rail and places; selected Vicmap transport features | DataVic GeoJSON/WFS; static/network layers |
| National hydrology | Australia | Australian Hydrological Geospatial Fabric catchments/waterways | Geoscience/BOM data services; zoom-gated geometry |

### Tier 2: free registered sources

| Adapter | Geographic scope | Data | Credential model |
| --- | --- | --- | --- |
| PTV transit | Victoria | stops, routes, departures, disruptions and real-time metropolitan vehicles where provided | PTV developer ID/key plus per-request signature, server-side only |
| Bureau of Meteorology warnings | Australia | weather warnings and CAP-compatible warning geometry when available | validate current public feed and terms before release; no browser key |

### Tier 3: constrained or paid candidates

These must not be wired without an explicit plan/price decision. They are kept
in the final catalogue with their licensing/cost and capability notes:

- commercial traffic incident/camera/video feeds;
- commercial satellite AIS, SAR, aerial imagery, and premium weather radar;
- Port of Melbourne operational/berth information where not openly licensed;
- local-government CCTV streams unless the publisher explicitly permits
  programme access and redistribution.

## User experience

`Australia` is added as a location group and `Melbourne` as a first-class city
preset. Its pack has two defaults: a practical `CITY` profile (places,
cycling, trees) and an `OPS` profile (EPA, emergency context, PTV once
configured, plus existing traffic/flights/vessels/fires). Statewide layers
stay off by default and show only at a sensible zoom level. Dense source data
uses clustering, decimation, or a viewport query; labels are never enabled for
all features at once.

Every layer card must show source and attribution, last successful update,
and an honest unavailable/credentials-required state. Existing TomTom,
FIRMS, ADS-B, AIS, weather, and earthquake layers remain their source of
truth; regional adapters supplement rather than duplicate them.

## Source acceptance rules

1. Official publisher or an attributable government open-data catalogue.
2. A documented reusable licence or terms compatible with client display.
3. Geographic coordinates/geometry and useful refresh semantics.
4. No personal data, named-person tracking, or sensitive/private operational
   information.
5. Bounded response size and an adapter-specific cache/timeout plan.
6. A source that requires payment is documented but not subscribed to.

## Failure and security handling

- A source error marks only its layer unavailable; it cannot block startup or
  another layer's refresh.
- Cache last-good public data only within the source's permitted retention.
- All credentials live in the host `.env` with mode 600 and are consumed only
  by Vite server proxies.
- Proxies validate bounds, pagination, and source-specific request parameters;
  they enforce timeout, payload, and per-IP rate limits.
- Attribution is registered when a layer activates and removed when it is
  disabled, following existing `dataCredits` behaviour.

## Verification

For each adapter: parser/unit tests with an official representative payload;
proxy validation/error/cache tests; lifecycle tests; source/attribution tests;
and a live smoke check that proves the layer becomes available without leaking
a credential. Before deployment: focused test suite, production Docker build,
container health, and Cloudflare-host header check. PTV additionally requires
an authenticated proxy smoke test after user registration.

## Rollout order

1. Source inventory and endpoint/licence validation across Melbourne, Victoria
   and national catalogues; repeat searches by transport, hazards, environment,
   water, infrastructure, city assets, and emergency domains.
2. Implement no-account Melbourne/Victoria source adapters and the Melbourne
   preset.
3. Register PTV through Chrome, add the signed proxy, then implement transit.
4. Add validated BOM/CFA and national source adapters.
5. Publish the paid/restricted candidate matrix with price/features and do not
   activate any paid account or feed without a separate decision.
