# `vic-wetlands-2025` isolated implementation report

Date: 5 September 2026

## Result

Implemented a wetland-only, parent-ready preprocessing and viewport-index
slice without changing shared adapters, regional registrations, package files,
or existing tests. No generated statewide dataset is committed.

The slice includes:

- a fixed-identity release-manifest gate for the official 2025 SHP resource;
- streamed pinned download and SHA-256 verification with no URL CLI argument;
- streamed GDAL conversion path for the official SHP ZIP;
- deterministic simplification, public-field projection and 0.25-degree cells;
- byte, feature, coordinate, ring, cell and output limits;
- an integrity-checked bounded viewport query seam;
- a three-feature deterministic fixture; and
- source/acquisition/artifact/reference-semantics documentation.

## External production blocker

The official DataVic resource redirects to DataShare's order workflow. CKAN
publishes neither an anonymous immutable archive URL nor an archive checksum.
The current official archive must therefore be ordered, then its delivered
DataShare URL, byte length and SHA-256 must be added to a reviewed production
release manifest. This implementation does not place that external order and
does not substitute the pre-2025 NVR WFS.

## Verification record

- RED observed: missing preprocessing script.
- GREEN observed: deterministic fixture artifact contract.
- RED observed: ZIP parsed as JSON.
- GREEN observed: the GDAL GeoJSON Sequence invocation seam, including an
  argument-verifying fake converter. A real ordered archive run remains pending.
- RED observed: missing viewport-index query function.
- GREEN observed: bounded, hash-verified viewport query.
- RED observed: missing pinned-download function.
- GREEN observed: streamed, atomic, manifest-only download.
- RED observed: older `VERS_DATE` rejected as non-2025.
- GREEN observed: archive identity proves edition; optional lineage fields are
  retained honestly.
- RED observed: duplicate `WETLAND_NO` values were rejected even though the
  official schema does not declare that field unique.
- GREEN observed: deterministic content-disambiguated IDs preserve distinct
  features that reuse an official wetland number.

Final verification:

- `node --check scripts/preprocess-vic-wetlands-2025.mjs` - passed.
- `node --test src/data/vicWetlands2025Index.test.mjs src/data/vicWetlands2025Preprocess.test.mjs`
  - 15 tests passed, 0 failed.
- `npm run build` - passed (the existing Vite large-chunk warning remains).
- The repository-wide baseline run before this slice had 2 unrelated failures:
  `vic-epa-air` registration in `regionalLayer.test.mjs` and
  `regionalPacks.test.mjs`. This isolated slice does not change those files.
