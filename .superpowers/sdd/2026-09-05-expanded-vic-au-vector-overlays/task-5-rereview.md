# Task 5 targeted re-review

## Verdict

**FAIL - 1 P2 and 1 P3 finding remain.**

Scope was limited to `6d01b58..7ebfbfd`, the six findings in
`task-5-review.md`, and their stated regression boundaries. Four findings are
closed. The toilet conflict text still makes a false statement after some
notes rotations, and malformed `Content-Length` is rejected instead of being
treated as an unknown compressed-byte count. No product code or commit was
modified.

## Remaining findings

### P2 - Rotated toilet notes can still produce false conflict wording

`src/data/indexedRegionalDownloads.js:362-369` now interpolates the current
structured licence and only uses the detailed update/non-transferability/
no-sublicensing wording when all three patterns are present. However, every
other notes value takes a fallback that says the package notes "contain
separate provider terms." That statement is false when `notes` is empty or is
ordinary descriptive text with no separate terms.

A read-only adversarial probe used both `notes: ""` and
`notes: "Dataset description only."`. In both cases the public status said
that the package notes contain separate provider terms. The added regression
test at `src/data/indexedRegionalDownloads.test.mjs:451-459` rotates only
`license_title`; it does not rotate or remove `notes`. The prior finding is
therefore only partially resolved: the warning tracks the licence, but not all
notes rotations without false specifics.

### P3 - Malformed Content-Length is not represented as unknown

`src/data/indexedRegionalDownloads.js:101-107` maps an absent or blank header
to `null`, but maps a nonnumeric or negative header to
`INVALID_SOURCE_DATA`. A read-only probe confirmed that an absent header
produces `compressedBytes: null` and remains bounded by decoded bytes, while
`Content-Length: not-a-number` is rejected before the bounded body is read.

The requested boundary is that absent **and malformed** lengths are unknown
(`null`) while the decoded-byte limit still applies. The added test at
`src/data/indexedRegionalDownloads.test.mjs:305-314` covers only absence, so
the malformed case remains open.

## Six-finding closure matrix

1. **PASS - clock rollback.** Freshness requires `checkedAt >= timestamp` at
   `src/data/indexedRegionalDownloads.js:489-512`, and stale fallback requires
   `failedAt >= dataset.validatedAt` at lines 571-580. The focused rollback
   test forced a refresh and rejected the old dataset after a negative age.
2. **PASS - rejected-body cancellation.** HTTP error, wrong media, invalid or
   oversized declared length, decoded overflow, and body-read error paths call
   and await body/reader cancellation while the request slot is active
   (`src/data/indexedRegionalDownloads.js:100-147`, `431-469`). Read-only
   probes observed cancellation before slot release for each applicable body;
   an already-errored native stream may decline its cancellation hook, but a
   direct reader probe confirmed the implementation still awaits
   `reader.cancel()` before releasing the slot.
3. **PASS - exact source paths.** The approved provider prefix is anchored,
   only one nonempty filename segment is accepted, and query/fragment values
   are rejected at `src/data/indexedRegionalDownloads.js:349-357`. Focused
   tests rejected extra prefixes, queries, and fragments before download. The
   current live official toilet and stops URLs both passed.
4. **FAIL - toilet conflict wording.** Current detailed wording is accurate,
   and rotated licences are interpolated, but empty/descriptive rotated notes
   still cause a false claim about separate provider terms.
5. **PASS - body-read timeout classification.** Body consumption remaps an
   abort to `TIMEOUT` at `src/data/indexedRegionalDownloads.js:458-465`; the
   proxy maps it to sanitized HTTP 504 at
   `src/data/regionalProxy.js:374-395`. Focused direct and proxy probes passed.
6. **FAIL - absent/malformed Content-Length.** Absence is `null` and decoded
   limits remain active, but malformed values are rejected rather than treated
   as `null` under the same decoded limit.

## Verification

- Focused tests: `node --test src/data/indexedRegionalDownloads.test.mjs
  src/data/regionalSources.test.mjs src/data/regionalProxy.test.mjs` - **PASS,
  103 passed, 0 failed, 0 skipped**.
- Rejection/cancellation probes - **PASS** for HTTP error, wrong media,
  declared oversize, malformed declared length rejection, decoded overflow,
  and body-read error cancellation ordering.
- Timeout proxy probe - **PASS**, body-phase abort returned HTTP 504 with
  `regional source timed out` and no provider detail.
- Bounded live 304 smoke on 2026-09-05 - **PASS**:
  - Toilets: current official path accepted; 12,057,577 decoded/compressed
    bytes, 25,563 rows; conditional request returned 304 and cache state
    `revalidated` / `not-modified`.
  - Transport stops: current official path accepted; 8,189,610
    decoded/compressed bytes, 31,170 rows; conditional request returned 304 and
    cache state `revalidated` / `not-modified`.
- `git diff --check 6d01b58..7ebfbfd` - **PASS**.
