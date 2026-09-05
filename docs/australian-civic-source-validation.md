# Australian civic source validation

Validation completed against official publisher material and live public API
responses on 5 September 2026 AEST. Public visibility was not treated as
permission to reproduce, proxy, embed or cache content. No account was created,
no protected service was inspected and no camera viewer or image endpoint was
scraped.

## Safety and runtime boundary

The only accepted runtime candidate in this civic validation is
`au-hospital-ed-performance`. Existing regional contracts remain unchanged. The
new ID means AIHW MyHospitals aggregate historical emergency-department
performance only. It must never be described or used as a live wait, demand,
bed/capacity, ambulance-offload, medical-routing or treatment forecast source.

The contract excludes patient, staff, ambulance, security and
critical-infrastructure operational data. Each accepted feature retains:

- source ID, publisher attribution and the official AIHW link;
- the reporting-period start and end dates;
- API version, data version, upload time and request time where supplied;
- caveat and suppression details plus an explicit error state; and
- a value only when it is finite and not suppressed.

Suppressed records may remain visible as `suppressed: true` context, but
`value`, `lowerValue` and `upperValue` are omitted even if an upstream or test
payload includes numbers alongside suppression metadata.

## Accepted source: AIHW MyHospitals

| Contract field | Validated value |
|----------------|-----------------|
| Source ID | `au-hospital-ed-performance` |
| Publisher | Australian Institute of Health and Welfare (AIHW) |
| Official page | [MyHospitals API](https://www.aihw.gov.au/hospitals/other-resources/myhospitals-api) |
| Technical endpoint | `GET https://myhospitalsapi.aihw.gov.au/api/v1/flat-data-extract/MYH-ED-WAITS` with required `skip` and `top` query parameters |
| Coordinate metadata | `GET https://myhospitalsapi.aihw.gov.au/api/v1/reporting-units?reporting_unit_type_code=H` |
| Licence | [Creative Commons Attribution 4.0 International](https://www.aihw.gov.au/copyright) |
| Attribution | `Based on Australian Institute of Health and Welfare material.` |
| Credentials | None |
| CORS | Live GET with an `Origin` header returned `Access-Control-Allow-Origin: *` |
| Geometry | Point, joined by `reporting_unit_code` to public hospital reporting-unit metadata |
| Cache recommendation | `86,400,000` ms (24 hours) |
| Runtime eligibility | `true`, within the historical aggregate boundary above |

AIHW's official API page says the API is open, free, unauthenticated, cached
daily and refreshed when new data is published. The current OpenAPI document
limits flat extracts to 1,000 rows per request and documents JSON/CSV response
schemas. Live checks observed API version `1.6.4.0`, data version `2026052802`
uploaded on 28 May 2026, and ED rows for 1 July 2024 to 30 June 2025. Those are
observations, not guarantees of a fixed version or release date.

A filtered 1,000-row hospital ED extract was approximately 2.07 MB during
validation. The hospital-only reporting-unit response was approximately 1.17
MB and contained 1,165 units, 1,119 with coordinates. Consumers must use
bounded filtered pages, cache the relatively stable reporting-unit catalogue,
and never infer that a missing coordinate or record means a hospital is closed
or unavailable.

The API page and OpenAPI licence text still refer to CC BY 3.0 (the page also
contains a `3.9` typo), while AIHW's current governing copyright page states CC
BY 4.0 and says a more restrictive item-specific notice takes precedence. Both
versions permit reuse with attribution. The registry records the current
copyright-page terms and the modified-material attribution above; the version
discrepancy must be rechecked during future source reviews and before
activation.

### Normalizer contract

`normalizeRegionalFeatureCollection('au-hospital-ed-performance', payload)`
accepts two untouched official response shapes in one bounded adapter payload:

```js
{
  extract: {
    result: { data: [/* flat MYH-ED-WAITS rows */] },
    version_information: {/* AIHW version metadata */},
  },
  reportingUnits: {
    result: [/* AIHW reporting-unit rows */],
  },
}
```

The adapter admits hospital rows (`reporting_unit_type_code: "H"`) only and
whitelists `MYH0010` (percentage treated within clinically recommended time)
and `MYH0011` (presentations). It joins coordinates by reporting-unit code,
requires both reporting dates and AIHW version metadata, caps output at 1,000
features and drops rows outside that contract. Malformed composite payloads
throw instead of being guessed into a map shape.

`MYH0010` and `MYH0011` are annual or otherwise period-based performance
measures. Their presence must not be relabelled as current queue length,
current patient count, beds, diversion, offload, available ambulances or a
recommendation about where to seek treatment.

## Non-executable validation decisions

Every record below is kept in `CIVIC_SOURCE_VALIDATION`, separate from the
runtime source registry. Each has `runtimeEligible: false`, `endpoint: null`,
`cacheMs: 0`, no request/proxy template and an official page that may be linked.

| Candidate | Decision | Primary-source finding and required next step |
|-----------|----------|-----------------------------------------------|
| [VAHI daily non-urgent ED wait](https://vahi.vic.gov.au/reports/emergency-department-non-urgent-wait-time) | `permission-required` | VAHI says figures are updated daily but are not live, may not represent actual waiting time and are not advice for severe injury. Its [copyright page](https://vahi.vic.gov.au/copyright) requires prior written consent for publishing, reproducing or communicating site material. Obtain written permission and a supported feed before reconsideration. |
| [VAHI quarterly emergency care](https://vahi.vic.gov.au/emergency-care/ambulance-patient-transfers) | `metadata-link-only` | The page publishes hospital-filtered quarterly measures, extraction dates, preliminary-period warnings and corrections, but no supported machine endpoint. Link to the page; do not reproduce it as current operational pressure. |
| [Ambulance Victoria performance](https://www.ambulance.vic.gov.au/our-performance) | `metadata-link-only` | AV releases response-time reports every three months as PDFs. Its [copyright page](https://www.ambulance.vic.gov.au/copyright-1) applies CC BY 4.0 to covered material but excludes images, branding and third-party material. A governed versioned dataset would be needed for future ingestion. |
| [DTP traffic cameras and CCTV](https://transport.vic.gov.au/road-and-active-transport/business-and-industry/road-and-traffic-management/traffic-cameras-and-cctv) | `metadata-link-only` | DTP describes more than 1,600 mixed-owner operational cameras and says recordings are not routinely made. No public image API was documented, and [DTP copyright](https://transport.vic.gov.au/website-terms/copyright) excludes images and third-party material from its general CC BY 4.0 grant. Written rights and a supported feed are required. |
| [Boating Vic](https://www.boating.vic.gov.au/) | `metadata-link-only` | Safe Transport Victoria describes selected live ramp/carpark vision, but no supported camera API or image licence. Its [copyright terms](https://safetransport.vic.gov.au/copyright-and-disclaimer/) exclude images, photographs, branding and third-party material. Written rights and a supported feed are required. |
| [Gippsland Ports webcams](https://gippslandports.vic.gov.au/boating/webcams/) | `rejected` | The official page links embedded vendor players, not a documented image API; no affirmative reuse/caching grant was found and direct player linking is stated as unauthorised. Keep only the canonical publisher link unless both publisher and provider authorise reuse. |
| [City of Port Phillip Marina Reserve webcam](https://www.portphillip.vic.gov.au/explore-the-city/beaches-parks-and-playgrounds/find-parks-and-playgrounds/marina-reserve) | `permission-required` | Council documents a daylight, low-resolution, non-recorded public player, but not programmatic image access or republication rights. Obtain written permission and a supported endpoint before use. |
| [FFMVic FireWeb](https://fireweb.ffm.vic.gov.au/) | `rejected` | FireWeb identifies itself as an integrated fire-management service and requires registered-user access; registration is limited to listed agencies or emergency-response personnel. No anonymous camera API or reuse grant was documented. Operational fire imagery remains out of scope. |
| [BOM weather imagery](https://www.bom.gov.au/catalogue/data-feeds.shtml) | `licence-required` | BOM lists radar images at five-minute and satellite images at ten-minute cadence, but anonymous products are non-commercial and dataset-specific constraints govern redistribution. [BOM catalogue guidance](https://www.bom.gov.au/metadata/catalogue/license.shtml) requires checking redistribution and commercial-use constraints for each product. Obtain the appropriate registered-user/data licence before any display, proxy or cache. |

No investigated camera source is runtime-image eligible. Do not scrape,
hotlink, proxy or cache camera images, and do not derive undocumented endpoints
from public viewers. Metadata/link-only does not authorise image display.

## Revalidation triggers

Revalidate a decision before activation if the publisher changes its terms,
publishes a supported machine endpoint, changes authentication or rate limits,
or grants written display/redistribution/cache rights. Activation also requires
a separate proxy/layer/UI task with bounded URLs, payload caps, timeouts,
freshness/error presentation and visible official attribution. This validation
does not itself activate any network route or user-facing layer.
