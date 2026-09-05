# Australian Civic Context and Map Orientation Design

## Goal

Make every map state intelligible at a glance, then add only lawfully reusable Australian civic-status overlays: official hospital system-pressure information and permitted local transport/webcam context.

## User experience

An always-visible compact **Context** card sits in the lower-left map chrome. It shows the resolved place name and hierarchy (suburb, state, country), camera orientation when applicable, active overlay count, and an age/provenance summary. It expands when the user selects a feature, camera, or layer; expansion adds a plain-language explanation of the selected item, exact source, update time, and a link to the official publisher.

Text wraps within a fixed-width card. Primary labels use a two-line clamp; full names are available via native title/accessible description and in the expanded view. The card never says that it knows an individual hospital's current wait or patient capacity.

## Civic-status overlays

Create a distinct `regional-civic-status` pack that is off by default and shown only when at least one compatible source is configured and validated. Its candidates are independent adapters, not a universal availability claim:

- **Hospital system pressure:** use an official aggregate emergency-department performance/capacity product only when it provides a documented machine endpoint and allows map display. Show “reported system pressure”, reporting period, geographic scope, and a direct official link. Do not show individual wait estimates, triage, patient counts, bed availability, ambulance queueing, or inferred acuity.
- **Local cameras:** use only official agency camera catalogues/images whose current terms explicitly allow display/embedding. Keep an agency-provided still-image URL only when its terms permit it; otherwise render the camera point with a source link. Never scrape a map viewer, bypass a paywall, or retain camera frames beyond the permitted/cache interval.
- **Road and disruption context:** reuse the already planned official transport source proxy; camera/hospital cards may reference an active disruption but must retain separate provenance and timestamps.

An unsupported, restricted, unavailable, or stale source appears in the card/layer status as unavailable with a reason. It never silently becomes a generic third-party source.

## Data and privacy boundary

Every candidate must pass the project source contract: official publisher, display-compatible licence/terms, documented endpoint, bounded proxy route, explicit cache/timeout/payload caps, and source-local failure isolation. No patient, staff, ambulance, security, or precise critical-infrastructure operational data is fetched, stored, inferred, or rendered. Keys remain server-side; no `VITE_` credentials.

## Architecture

The context card reads existing selected feature, camera, location, data-layer state, and source status through a small pure `mapContext` model. It does not make network calls itself. Regional civic adapters are added through the existing regional registry/proxy/layer interfaces after each source passes a dedicated validation test. The proxy supplies sanitized status metadata (`source`, `observedAt`, `stale`, `officialUrl`) alongside bounded map geometry; browser code never sees upstream credentials.

## Failure handling

If location resolution fails, show coordinates and “Location not resolved”. If an active source fails, retain its last-good data only inside the source-specific freshness limit and show “stale” with the last observed time. If no civic source clears validation, the pack is absent and its documentation lists the reason; no placeholder data or scraping fallback is used.

## Verification

- Unit-test name hierarchy, label clamping/input normalization, selection explanations, unknown locations, and stale/error source states.
- UI-test the compact and expanded card on desktop and narrow viewport sizes, with keyboard focus and screen-reader labels.
- For every activated civic source, test allowlisting, licence status, a bounded proxy response, timestamp/provenance, stale recovery, and source-specific error isolation.
- Production verification checks Cloudflare Access, browser-visible context, all enabled no-account sources, and server-only credential behavior. No external paid subscription or account is created without a separate explicit request.
