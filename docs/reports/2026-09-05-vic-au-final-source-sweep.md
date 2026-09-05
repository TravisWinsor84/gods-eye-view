# Victoria/Australia final source sweep

Verified 5 September 2026 against official publisher/catalogue pages after the
implementation pass. This is the final admission record, not a claim that every
public file makes a useful live map overlay.

## Newly confirmed during the repeat sweep

- Transport Victoria's Unplanned Disruptions v3 is near-real-time, refreshed
  every 60 seconds, CC BY 4.0, and uses the `KeyID` header. It is implemented.
- Transport Victoria's August 2026 Telemetry Traffic Counts release contains
  15-minute aggregate volume, vehicle class and speed observations. It is a
  daily-published historical/monthly analytical file, not a live traffic feed.
- Traffic Signal Volume Data is also 15-minute aggregate history, but monthly
  files are roughly 120–133 MB and annual archives exceed 1 GB. It is unsuitable
  for direct viewport loading and needs a separate offline aggregate product.
- Freeway Travel Time is materially useful and updates every 30 seconds, but the
  current portal key returns 401 for both Traffic and GIS products. Planned Road
  Disruptions also requires a separate subscription not attached to the key.
- Speed Zones, Speed Signs, Victorian Traffic Signals, crash history, patronage,
  fleet registration and VISTA are legitimate reference/analysis datasets. They
  do not add current operational state and are deferred behind the admitted
  realtime, safety, amenity, planning and environmental layers.

## Remaining provider gates

| Source | State | What would unlock it |
| --- | --- | --- |
| Transport Victoria Planned Disruptions | Subscription requested | Portal support request submitted for the existing account/key. |
| Transport Victoria Freeway Travel Time | Subscription requested | Portal support request submitted for both Traffic and GIS APIs. |
| EPA Victoria current air quality | Registration/product contract unverified | Complete developer registration, then verify endpoint, header, quota, licence and live payload. |
| Victorian Wetland Inventory 2025 | Artifact built and verified | Deploy the serving contract, mount the staged 444-cell artifact, and set both configuration variables. |
| Victorian public webcams | No reusable image API found | Publisher grants an explicit machine endpoint plus public display/cache rights. |
| Live Victorian hospital waits | No supported public live feed found | VAHI or a health publisher releases a machine feed with republication permission and non-clinical caveats. |
| BOM operational imagery | Product licence required | Obtain the applicable Bureau display/redistribution licence. |

## Commercial/restricted options

| Product | Indicative published cost/constraint | Capability |
| --- | --- | --- |
| ATDW | Industry AU$165/month + AU$165 setup; Lite AU$220/month + AU$660 setup; Premium AU$400/month + AU$660 setup; annual prepay | Governed statewide tourism/events content. |
| Xweather Lightning | 15,000 free accesses then US$0.0006 per base access; lightning has a 10x multiplier before spatial/time multipliers | Near-real-time strikes, flashes and threat polygons; display/cache rights still need confirmation. |
| VesselFinder | EUR 330/10k, EUR 625/20k, EUR 1,470/50k credits excluding VAT; terrestrial 1 credit, satellite 10 | Wider vessel positions; standard terms restrict redistribution/caching, so enterprise permission is required. |

No camera viewer, restricted fire-management service, unlicensed national road
service, or deprecated/misidentified raster was scraped or relabelled as an
approved runtime source.
