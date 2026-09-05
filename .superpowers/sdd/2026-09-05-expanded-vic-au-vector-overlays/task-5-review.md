# Task 5 independent review

## Verdict

**FAIL - 2 P1, 3 P2 and 1 P3 findings.**

Focused verification passed 95/95, both current provider files downloaded and
parsed within their declared limits, and live conditional requests returned
HTTP 304 while reusing the parsed indexes. The implementation nevertheless
bypasses its finite freshness ceiling after a wall-clock rollback, releases the
shared request semaphore without cancelling rejected response bodies, admits
unapproved same-host download paths, can publish a hard-coded toilet licence
conflict that contradicts current metadata, misclassifies body-phase timeouts,
and reports a missing compressed byte count as zero. Review scope was
`9f33b61..6d01b58` plus the named Task 5 brief, report, current implementation,
tests, catalogue, proxy, package manifest and lockfile. Only this review
artifact was written; no product source, test, commit, push, deployment,
credential or provider state was changed.

## Findings

### P1 - A backward wall-clock step makes old data current and bypasses every refresh and stale ceiling

`src/data/indexedRegionalDownloads.js:451-468` compares the current wall clock
directly with `metadataCheckedAt` and `dataset.validatedAt`. A negative age is
therefore treated as younger than both refresh intervals. The stale fallback at
`src/data/indexedRegionalDownloads.js:530-538` has the same defect: a negative
age is always within `maxStaleMs`. There is no rollback detection, age clamp or
monotonic elapsed clock.

A read-only clock probe loaded one feature at time 10,000, moved `now()` back to
zero, and made every later fetch fail. The next query made no revalidation
request (`fetchCalls` remained 1) and returned the old dataset as
`status: "current"`, `cache: "hit"`. A one-day host-clock rollback would thus
extend the nominal six-hour/daily validation intervals and three-day/seven-day
last-good ceilings by roughly a day while continuing to advertise the result
as current. Existing freshness tests at
`src/data/indexedRegionalDownloads.test.mjs:82-167` and
`src/data/indexedRegionalDownloads.test.mjs:412-435` only move the clock
forward.

### P1 - Rejected response bodies are not cancelled before the shared request slot is released

`src/data/indexedRegionalDownloads.js:99-119` releases the reader lock after an
invalid chunk or decoded-byte overflow but never calls `reader.cancel()` or
aborts the request. Earlier rejection paths at
`src/data/indexedRegionalDownloads.js:423-426` likewise return or throw for an
HTTP error or wrong media type without cancelling the body, and the declared
length rejection at lines 100-103 happens before a reader is acquired. The
outer `withRequestSlot` scope then exits at lines 412-430 and returns capacity
to the shared four-request gate even though the provider stream may still be
open and producing bytes.

A read-only over-limit stream probe emitted a five-byte chunk against a
four-byte decoded cap. The request correctly raised `SOURCE_LIMIT`, but the
stream's `cancel()` hook was called zero times, its lock was released, and the
request slot was already inactive. Repeating malformed, oversized or wrong-type
responses can therefore leave more than four live provider bodies/connections
outside the gate and defeats the failure-path resource bound. The concurrency
tests at `src/data/indexedRegionalDownloads.test.mjs:169-205` and
`src/data/regionalProxy.test.mjs:143-176` cover successful complete streams,
not early body rejection and cancellation.

### P2 - The resource-path check is substring-based rather than a fixed path boundary

`src/data/indexedRegionalDownloads.js:322-359` correctly fixes package ID,
resource name, UUID shape, format, media type, HTTPS scheme and exact host, but
line 337 admits any normalized path containing the expected
`/dataset/{package}/resource/{resource}/download/` substring. It does not anchor
the provider-specific prefix or reject an unexpected path prefix, query or
fragment despite the catalogue claiming a matching fixed package/resource
path at `DATA_SOURCES.md:166-173`.

A read-only official-client probe supplied
`https://data.gov.au/unapproved-prefix/dataset/{expected-package}/resource/{expected-resource}/download/toilet.csv`.
The resolver accepted it, fetched it and returned a public feature. Redirects
remain correctly disabled, but this is not the stated fixed path trust
boundary. The resolver matrix at
`src/data/indexedRegionalDownloads.test.mjs:360-410` checks scheme, host, UUID,
type, size and redirect behavior but has no wrong-path, extra-prefix, query or
fragment case.

### P2 - Toilet licence metadata is not validated before an exact conflict statement is published

`src/data/indexedRegionalDownloads.js:350-357` accepts any bounded
`license_title`, does not inspect the package terms, and unconditionally adds a
statement that the structured licence is CC BY 3.0 AU and the package notes
require prompt updates, non-transferability and no sublicensing. This allows
provider metadata rotation to produce an internally contradictory response.
The same path probe changed `license_title` to `Other`; the result exposed
`licence: "Other"` beside the hard-coded CC BY 3.0 AU conflict statement and
still loaded the file.

The live metadata on 2026-09-05 does currently report Creative Commons
Attribution 3.0 Australia, and its package terms do contain the update,
non-transferability and no-sublicensing restrictions. The current output is
therefore accurate today, but the fixed resolver does not fail closed or update
honestly if either side of that legal conflict changes. The exact-licence test
at `src/data/indexedRegionalDownloads.test.mjs:304-326` covers only the present
fixture.

### P2 - A timeout after response headers is reported as ordinary upstream unavailability

Only the initial `fetchImpl` call is inside the AbortError-to-`TIMEOUT` mapping
at `src/data/indexedRegionalDownloads.js:415-422`. Body consumption occurs
after that catch at line 426. If the timeout fires while `reader.read()` is
waiting, the resulting `AbortError` reaches `currentDataset`, is not one of the
recognized codes at `src/data/indexedRegionalDownloads.js:530-538`, and is
rewritten to `UPSTREAM_UNAVAILABLE`. The proxy then returns HTTP 502 rather than
the intended timeout HTTP 504 at `src/data/regionalProxy.js:374-395`.

A read-only delayed-body probe with a five-millisecond timeout returned
`UPSTREAM_UNAVAILABLE` after the response headers had already arrived. This
makes error/status reporting depend on whether the same timeout happens before
or after headers. No Task 5 test stalls the body after a successful fetch
resolution.

### P3 - A missing Content-Length is reported as zero compressed bytes

`src/data/indexedRegionalDownloads.js:100` converts the header directly with
`Number(response.headers.get('content-length'))`; a missing header is `null`,
and `Number(null)` is zero. Lines 127-130 consequently record
`compressedBytes: 0` for a non-empty chunked response instead of `null`, and
that false measurement is exposed at
`src/data/indexedRegionalDownloads.js:563-565`. The transfer remains decoded-
byte bounded, so this does not remove the main memory ceiling, but the status
metric is not honest. Tests cover declared and decoded overflows at
`src/data/indexedRegionalDownloads.test.mjs:214-244`, not absent or malformed
length reporting.

## Verified clean

- Metadata URLs, package IDs, resource names, UUID resource IDs, schemes,
  hosts, formats, metadata/download media types and declared resource sizes are
  fixed and fail closed (`src/data/indexedRegionalDownloads.js:15-52`,
  `src/data/indexedRegionalDownloads.js:322-359`), subject to the path and
  licence findings above. Both metadata and file fetches use
  `redirect: "error"`; live probes observed no redirect.
- Metadata requests carry `Cache-Control: no-cache`, are decoded under a 2 MiB
  cap, and are re-resolved hourly. Resource ID or URL rotation suppresses old
  validators. ETag and Last-Modified are preserved as opaque values and sent
  only for the same resource URL (`src/data/indexedRegionalDownloads.js:433-489`).
- Live toilet and stops revalidations each sent the validators from their own
  URL, received HTTP 304, reused the parsed index, and reported
  `cache: "revalidated"`, `downloadStatus: "not-modified"`. A successful 304
  advances `validatedAt`; ordinary forward-clock stale fallback is finite and
  labelled stale, subject to the rollback finding.
- One pending refresh and one process-global client per source coalesce
  concurrent metadata/download work across bboxes. Bbox filtering happens
  after one provider-wide bucket index is built, and final cap order is sorted
  by deterministic public ID (`src/data/indexedRegionalDownloads.js:201-233`,
  `src/data/indexedRegionalDownloads.js:400-404`,
  `src/data/indexedRegionalDownloads.js:530-576`,
  `src/data/indexedRegionalDownloads.js:580-614`).
- Declared provider size, response Content-Length, streamed decoded bytes, CSV
  record size, CSV row count and GeoJSON feature count are bounded. CSV parsing
  is quote-aware; GeoJSON must be a FeatureCollection; invalid rows are
  counted; and a non-empty all-invalid collection fails closed
  (`src/data/indexedRegionalDownloads.js:99-131`,
  `src/data/indexedRegionalDownloads.js:235-320`,
  `src/data/indexedRegionalDownloads.js:492-507`). Parser and index memory are
  bounded by the fixed byte/row limits, subject to failure-path cancellation.
- Toilet output contains only bounded title, facility type, strict
  `True`/`False` accessibility/payment flags and descriptive opening-hours
  text. Address, note, provider ID and provider-only fields are excluded, and
  every emitted opening-hours value carries an explicit no-current-open caveat
  (`src/data/indexedRegionalDownloads.js:235-288`).
- Stops accept only finite WGS84 points with bounded title and mode. `STOP_ID`
  is neither exposed nor used for public identity/dedupe, so nonnumeric and
  nonunique IDs do not collapse distinct public projections. Interstate coach
  endpoints remain queryable, and output explicitly disclaims realtime or
  currently-running service (`src/data/indexedRegionalDownloads.js:290-320`).
- Exact public projections are deterministically deduplicated independent of
  provider row order. Public IDs derive only from sanitized geometry and public
  properties; digest collisions receive stable canonical ordinals; bbox caps
  therefore select stable membership (`src/data/indexedRegionalDownloads.js:133-195`,
  `src/data/indexedRegionalDownloads.js:213-233`).
- The proxy shares one four-request FIFO semaphore across indexed metadata and
  file reads, GA, civic and PTV work, and releases capacity in `finally`
  (`src/data/regionalProxy.js:176-214`). Successful body consumption remains
  inside the slot; only the rejected-body lifecycle in Finding 2 escapes the
  intended live-body bound.
- Responses distinguish current, partial, stale and unavailable/error paths.
  Invalid rows, duplicate public projections and viewport caps produce partial;
  stale last-good is explicit; invalid/limit/provider details are sanitized at
  the proxy (`src/data/indexedRegionalDownloads.js:530-573`,
  `src/data/regionalProxy.js:374-395`), subject to the clock and timeout
  findings above.
- Current live metadata dates are kept as distinct exact source strings:
  toilets package `2026-08-31T23:24:56.240805`, resource
  `2026-08-31T23:24:01.608696`, no dataset-last-updated field; stops package
  `2026-03-05T05:35:25.834801`, resource `2026-03-05T05:35:25.824500`, dataset
  last updated `2025-07-28T00:00:00`.
- `csv-parse@6.2.1` is an MIT-licensed, dependency-free direct runtime package.
  `package.json` and `package-lock.json` agree on the range, exact version,
  registry integrity and licence; `npm ls` and `npm ci --dry-run
  --ignore-scripts` are clean. `npm audit --omit=dev` reports no finding caused
  by this dependency. It does report one pre-existing unrelated moderate
  transitive `dompurify` advisory, so the repository-wide production audit is
  not globally clean.
- Neither source is added to a visible category pack before Task 6.

## Verification

- Focused command:
  `node --test src/data/indexedRegionalDownloads.test.mjs src/data/regionalSources.test.mjs src/data/regionalProxy.test.mjs`
  - **PASS:** 95 passed, 0 failed, 0 skipped.
- Lock consistency:
  - **PASS:** `npm ls csv-parse --all` resolves `csv-parse@6.2.1`.
  - **PASS:** `npm ci --dry-run --ignore-scripts` reported `up to date`.
  - **PASS:** `git diff --check 9f33b61..6d01b58` produced no errors.
- Bounded live metadata/download/304 probes on 2026-09-05:
  - **PASS:** toilets metadata was HTTP 200 JSON under 2 MiB; the selected CSV
    was 12,057,577 bytes and parsed 25,563 rows into 25,560 public features
    with 3 deterministic duplicates. Conditional revalidation returned HTTP
    304 with the same URL-scoped ETag and Last-Modified.
  - **PASS:** stops metadata was HTTP 200 JSON under 2 MiB; the selected GeoJSON
    was 8,189,610 bytes and parsed 31,170 rows into 31,161 public features with
    9 deterministic duplicates. Conditional revalidation returned HTTP 304
    with the same URL-scoped ETag and Last-Modified.
- Read-only adversarial probes:
  - **FAIL:** a backward clock step returned old data as current without a new
    fetch.
  - **FAIL:** decoded overflow raised `SOURCE_LIMIT` but did not cancel the body
    before releasing the request slot.
  - **FAIL:** an unapproved same-host path and contradictory toilet licence were
    accepted and downloaded.
  - **FAIL:** a body-phase abort was rewritten to `UPSTREAM_UNAVAILABLE` rather
    than `TIMEOUT`.

## Official references checked

- National Public Toilet Map package metadata:
  `https://data.gov.au/data/api/3/action/package_show?id=553b3049-2b8b-46a2-95e6-640d7986a8c1`
- Transport Victoria Public Transport Lines and Stops package metadata:
  `https://opendata.transport.vic.gov.au/api/3/action/package_show?id=public-transport-lines-and-stops`
- npm registry metadata and audit data for `csv-parse@6.2.1`.
