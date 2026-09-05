# Task 5 report: indexed national amenities and Victorian stops

## Outcome

Implemented two fixed, anonymous official-source adapters:

- `au-public-toilets`, resolved from the National Public Toilet Map CKAN
  package; and
- `vic-transport-stops`, resolved from the Transport Victoria public transport
  lines and stops CKAN package.

Both clients resolve current resource metadata before download, reject
non-HTTPS or unexpected hosts/types/paths, stream-cap metadata and source
files, parse under fixed row limits, build one provider-wide spatial index, and
reuse that index across viewport queries. Metadata is revalidated with
`Cache-Control: no-cache` so the data.gov.au 30-day cache header cannot pin a
rotated resource. File validators are opaque and URL-scoped; ETag and
Last-Modified conditional requests reuse a parsed index only after HTTP 304.

## Data and safety contracts

The toilet CSV uses a quote-aware parser, a 16 MiB declared-size ceiling, a
20 MiB decoded ceiling and a 30,000-row cap. Public output contains only the
facility name/type, strict boolean accessibility/payment flags and bounded
opening-hours text. Addresses, source IDs, notes and provider-only fields are
not emitted. Opening hours are descriptive and never represented as proof that
a facility is currently open. The structured catalogue licence says CC BY 3.0
AU, while the package notes add prompt-update, non-transferability and
no-sublicensing terms; runtime status and documentation preserve that conflict
as requiring legal review.

The transport GeoJSON uses a 12 MiB declared-size ceiling, a 16 MiB decoded
ceiling and a 40,000-feature cap. `STOP_ID` stays a string and is never a public
identity or sole dedupe key because the current source contains nonnumeric and
nonunique values. Public output contains only stop name, mode and coordinates.
It is a weekly reference inventory, not realtime evidence that a service is
running. Interstate coach endpoints are retained when requested by bbox.

Public IDs derive only from canonical public properties and coordinates.
Provider row order, rotating source IDs and explicit digest collisions cannot
change capped membership. A nonempty source with no valid public feature fails
closed. Successful HTTP 304 validation extends the finite last-good window;
failed refreshes are explicitly stale only within the configured ceiling.
Metadata, downloads and body consumption use the shared four-request provider
semaphore.

## Verification

- RED regressions demonstrated missing 304 freshness extension, stale-metadata
  cache bypass and all-invalid-source rejection before the local fixes.
- Focused adapter/catalogue/proxy verification passed 95/95 tests.
- Live toilet download: 12,057,577 bytes, 25,563 rows, 25,560 indexed public
  features, 3 duplicate public rows; Melbourne-area query returned 1,000 and
  was honestly partial/capped.
- Live transport download: 8,189,610 bytes, 31,170 rows, 31,161 indexed public
  features, 9 duplicate public rows; Melbourne-area query returned 1,000 and
  was honestly partial/capped.
- A second live query after advancing each source's refresh clock received
  HTTP 304 semantics from both providers and reported `revalidated` /
  `not-modified` while reusing the parsed indexes.

No source files were committed, no credentials were required, and nothing was
pushed or deployed.
