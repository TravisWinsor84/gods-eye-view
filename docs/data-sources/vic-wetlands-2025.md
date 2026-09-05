# Victorian Wetland Inventory 2025 preprocessing contract

Verified against official Victorian Government metadata on 5 September 2026.

## Pinned official identity

| Field | Pinned value |
| --- | --- |
| Source ID | `vic-wetlands-2025` |
| Dataset | Victorian Wetland Inventory (Current) |
| Dataset ID | `514a3b37-6a42-47c5-a159-dab47cbf752a` |
| Metadata UUID | `1621d8fc-4afa-5d31-a612-f822c88f4891` |
| Edition | 2025 |
| Publication date | 9 April 2025 |
| Period end | 19 March 2025 |
| Resource | `WETLANDCURRENT SHP` |
| Resource ID | `a7069c00-29e4-407f-89f2-7a9da546b4a1` |
| Resource format | SHP |
| Licence | Creative Commons Attribution 4.0 International |
| Attribution | Copyright (c) The State of Victoria, Department of Energy, Environment and Climate Action |

Official evidence:

- Dataset: <https://discover.data.vic.gov.au/dataset/victorian-wetland-inventory-current>
- SHP resource: <https://discover.data.vic.gov.au/dataset/victorian-wetland-inventory-current/resource/a7069c00-29e4-407f-89f2-7a9da546b4a1>
- CKAN metadata: <https://discover.data.vic.gov.au/api/3/action/package_show?id=victorian-wetland-inventory-current>
- ISO metadata: <https://metashare.maps.vic.gov.au/geonetwork/srv/api/records/1621d8fc-4afa-5d31-a612-f822c88f4891/formatters/xml>
- DataShare order page: <https://datashare.maps.vic.gov.au/search?md=1621d8fc-4afa-5d31-a612-f822c88f4891>

The current catalogue contains approximately 427,540 polygons. It lists only
download formats (DWG, DXF, GDB, SHP, MIF, TAB and Extended TAB), not a WFS.
The separately catalogued `WETLAND_CURRENT_NVR_MAP` WFS is explicitly a copy
from before the 2025 update and must never back this source ID.

## Production release evidence

DataShare order `T7V5WN`, delivered 5 September 2026, was processed with these
pinned values:

- archive: `Order_DZDI79.zip`, 178,582,503 bytes;
- SHA-256: `dd5f2b56e862180dd20a68574fe60b8e08d70f5561cde7f7381e0cc732287c60`;
- SHP member:
  `ll_gda2020/esrishape/whole_of_dataset/victoria/FLORAFAUNA1/WETLAND_CURRENT.shp`;
- transform precision: seven decimal places;
- GDAL 3.6.2 and PROJ package 9.1.1-1+b1; and
- output: 427,540 source features in 444 cells, 231,905,550 cell bytes
  (223 MiB on disk).

An independent verification pass matched every generated cell's byte count,
SHA-256, JSON structure and indexed feature count against `index.json`. The
artifact is staged on the Docker host pending the application deployment that
adds its serving contract and mount.

## Acquisition and release manifest

DataVic redirects the SHP resource download action to a DataShare order flow;
it does not publish an anonymous immutable archive URL or archive checksum in
CKAN. Obtain the statewide SHP/GDA2020 archive through that official flow.
Before preprocessing, create a reviewed release manifest containing the pinned
identity above plus the delivered archive's exact:

- direct HTTPS `datashare.maps.vic.gov.au` URL as `sourceArchive.downloadUrl`;
- file name as `sourceArchive.fileName`;
- byte length as `sourceArchive.bytes`; and
- lowercase SHA-256 as `sourceArchive.sha256`; and
- the exact archive-relative `WETLAND_CURRENT.shp` path as
  `sourceArchive.shapefilePath` (DataShare deliveries may nest it several
  directories below the ZIP root).

The small fixture manifest at
`src/data/fixtures/vic-wetlands-2025/release-manifest.json` is the executable
schema example. Its source bytes are deliberately a three-feature GeoJSON
fixture, not the production dataset. Do not copy its fixture hash into a
production manifest.

The script has no URL argument. Download mode reads only the URL from the
reviewed manifest, requires HTTPS on `datashare.maps.vic.gov.au`, refuses
redirects, streams under the pinned byte cap, verifies byte length and SHA-256,
and renames the temporary file only after verification. ZIP conversion also
requires a normalized relative path ending exactly in `WETLAND_CURRENT.shp`;
absolute paths, traversal segments and alternate layers are rejected.

Production download and preprocessing:

```sh
node scripts/preprocess-vic-wetlands-2025.mjs \
  --release-manifest /absolute/path/vic-wetlands-2025.release.json \
  --download-to /absolute/cache/WETLANDCURRENT_SHP.zip \
  --out-dir /absolute/output/vic-wetlands-2025
```

If the already-verified ordered archive is available locally:

```sh
node scripts/preprocess-vic-wetlands-2025.mjs \
  --release-manifest /absolute/path/vic-wetlands-2025.release.json \
  --source /absolute/cache/WETLANDCURRENT_SHP.zip \
  --out-dir /absolute/output/vic-wetlands-2025
```

Production ZIP conversion requires `ogr2ogr` from GDAL. Record the exact GDAL
and PROJ versions alongside each production release manifest/run. The script
opens only the pinned `WETLAND_CURRENT.shp` member and requests WGS84 GeoJSON Sequence output. A
`.geojson` source is accepted solely so the deterministic fixture can exercise
the same transform without adding a package dependency.

## Bounded transform

The reviewed manifest may lower but cannot raise these hard ceilings:

| Limit | Hard ceiling |
| --- | ---: |
| Source bytes | 2 GiB |
| Source features | 450,000 |
| Coordinates per feature | 250,000 |
| Coordinates total | 60,000,000 |
| Rings per feature | 2,048 |
| Index cells per feature | 256 |
| Generated bytes per cell | 16 MiB |
| Generated artifact bytes | 512 MiB |

The checked fixture uses 0.25-degree cells, Douglas-Peucker tolerance
`0.00005` degrees (about 5 m), and six decimal places. Geometry must be Polygon
or MultiPolygon and remain inside the bounded Victoria envelope. Features and
cells are sorted with locale-independent byte-stable IDs.

Only these public properties survive preprocessing:

- `id` from `WETLAND_NO`, namespaced by the source ID; if an official wetland
  number is reused, a deterministic content digest distinguishes the feature;
- `wetlandType` from the delivered SHP field `WTLND_TYPE` (with the longer
  catalogue aliases retained for fixture/backward compatibility);
- `waterRegime` from `WAT_REGIME`;
- `source` from optional `SRCDATANAM`; and
- `sourceConfidence` from optional `WATREGCONF`;
- fixed `edition: "2025"`; and
- fixed `referenceOnly: true`.

Polygon exteriors that cannot retain three distinct positions at the pinned
release precision still fail closed. Interior holes smaller than that precision
are omitted rather than causing an otherwise valid official wetland polygon to
be dropped.

The archive identity and SHA-256 prove the edition. `VERS_DATE` and `EDIT_YEAR`
are feature-lineage fields and may legitimately predate 2025, so they are not
used as edition gates. Missing optional source/confidence values are retained
as `null` rather than invented.

## Artifact and viewport contract

The output directory is intentionally generated, not committed:

```text
vic-wetlands-2025/
  index.json
  cells/
    NNN-NNN.geojson
```

`index.json` carries the pinned source identity, source archive hash, licence,
attribution, limits, transform, counts, reference notice, and for every cell:
path, bbox, feature count, byte length and SHA-256. Each cell is a deterministic
GeoJSON FeatureCollection sorted by public feature ID.

`queryVicWetlands2025Index` is the isolated parent-integration seam. It permits
only Victoria-contained viewports no wider or taller than one degree and no
larger than 0.5 square degrees, at most 500 returned features, 16 MiB per cell,
32 MiB decoded per request, and one million coordinates per response. It
verifies exact cell bytes and SHA-256 before parsing, strips no failures, de-
duplicates polygons repeated across cells, and rejects overfull views rather
than silently truncating them.

## Meaning

This is a mapped-inventory reference layer. It is not live water extent, flood
extent, access advice, safety advice, navigability information, or a survey or
legal boundary. Inclusion does not prove that water is currently present;
absence does not prove that a place is dry. Parent integration must keep the
layer off by default and display the reference-only notice and attribution.
