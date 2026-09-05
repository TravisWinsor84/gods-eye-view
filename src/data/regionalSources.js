import { GA_SOURCE_CREDITS, normalizeGaRegionalPayload } from './gaRegionalSources.js';
import {
  CITY_OF_MELBOURNE_CREDIT,
  normalizeMelbourneCivicPayload,
} from './melbourneCivicSources.js';
import { OGC_SOURCE_CREDITS, normalizeOgcPayload } from './ogcRegionalSources.js';

const MAX_TEXT_LENGTH = 512;

function civicDecision(decision) {
  return Object.freeze(decision);
}

export const CIVIC_SOURCE_VALIDATION = Object.freeze({
  'au-hospital-ed-performance': civicDecision({
    publisher: 'Australian Institute of Health and Welfare',
    officialUrl: 'https://www.aihw.gov.au/hospitals/other-resources/myhospitals-api',
    endpoint: 'https://myhospitalsapi.aihw.gov.au/api/v1/flat-data-extract/MYH-ED-WAITS',
    licence: 'Creative Commons Attribution 4.0 International', cacheMs: 86_400_000, geometry: 'point',
    sensitivityReview: 'Aggregate historical ED performance only; excludes live waits, demand, capacity, ambulance offload, routing and forecasts.',
    runtimeEligible: true, decision: 'runtime-eligible', credential: 'none',
  }),
  'vahi-daily-ed-wait': civicDecision({
    publisher: 'Victorian Agency for Health Information',
    officialUrl: 'https://vahi.vic.gov.au/reports/emergency-department-non-urgent-wait-time',
    endpoint: null, licence: 'Written publisher permission required', cacheMs: 0, geometry: 'metadata-only',
    sensitivityReview: 'A daily non-live estimate could be mistaken for clinical advice or current treatment availability.',
    runtimeEligible: false, decision: 'permission-required', credential: 'not-applicable',
  }),
  'vahi-quarterly-emergency-care': civicDecision({
    publisher: 'Victorian Agency for Health Information',
    officialUrl: 'https://vahi.vic.gov.au/emergency-care/ambulance-patient-transfers',
    endpoint: null, licence: 'Publisher page terms; no supported public data feed', cacheMs: 0, geometry: 'metadata-only',
    sensitivityReview: 'Quarterly aggregate context only; never current ambulance offload, capacity or routing information.',
    runtimeEligible: false, decision: 'metadata-link-only', credential: 'not-applicable',
  }),
  'ambulance-victoria-quarterly-performance': civicDecision({
    publisher: 'Ambulance Victoria', officialUrl: 'https://www.ambulance.vic.gov.au/our-performance',
    endpoint: null, licence: 'Creative Commons Attribution 4.0 International, excluding images, branding and third-party material',
    cacheMs: 0, geometry: 'metadata-only',
    sensitivityReview: 'Quarterly PDF reports are historical performance, not current ambulance availability or an emergency forecast.',
    runtimeEligible: false, decision: 'metadata-link-only', credential: 'not-applicable',
  }),
  'victraffic-cameras': civicDecision({
    publisher: 'Victorian Department of Transport and Planning',
    officialUrl: 'https://transport.vic.gov.au/road-and-active-transport/business-and-industry/road-and-traffic-management/traffic-cameras-and-cctv',
    endpoint: null, licence: 'Creative Commons Attribution 4.0 International excludes images and third-party material',
    cacheMs: 0, geometry: 'metadata-only',
    sensitivityReview: 'Road imagery can contain people, number plates and incidents; no archiving, identification or operational inference.',
    runtimeEligible: false, decision: 'metadata-link-only', credential: 'not-applicable',
  }),
  'boating-vic-cameras': civicDecision({
    publisher: 'Safe Transport Victoria', officialUrl: 'https://www.boating.vic.gov.au/', endpoint: null,
    licence: 'Creative Commons Attribution 4.0 International excludes images, photographs, branding and third-party material',
    cacheMs: 0, geometry: 'metadata-only',
    sensitivityReview: 'Ramp imagery can contain people, vessels and number plates and is not authoritative boating or weather advice.',
    runtimeEligible: false, decision: 'metadata-link-only', credential: 'not-applicable',
  }),
  'gippsland-ports-webcams': civicDecision({
    publisher: 'Gippsland Ports', officialUrl: 'https://gippslandports.vic.gov.au/boating/webcams/', endpoint: null,
    licence: 'No public image-reuse grant; player direct-linking is unauthorised', cacheMs: 0, geometry: 'metadata-only',
    sensitivityReview: 'Webcam views can contain identifiable people and vessels and must not be used as navigational advice.',
    runtimeEligible: false, decision: 'rejected', credential: 'not-applicable',
  }),
  'port-phillip-marina-webcam': civicDecision({
    publisher: 'City of Port Phillip',
    officialUrl: 'https://www.portphillip.vic.gov.au/explore-the-city/beaches-parks-and-playgrounds/find-parks-and-playgrounds/marina-reserve',
    endpoint: null, licence: 'Written council permission required for image republication', cacheMs: 0, geometry: 'metadata-only',
    sensitivityReview: 'A public low-resolution player does not grant retention or aggregation rights for imagery of people at the reserve.',
    runtimeEligible: false, decision: 'permission-required', credential: 'not-applicable',
  }),
  'ffmvic-cameras': civicDecision({
    publisher: 'Forest Fire Management Victoria', officialUrl: 'https://fireweb.ffm.vic.gov.au/', endpoint: null,
    licence: 'Restricted registered-user operational service; no public reuse grant', cacheMs: 0, geometry: 'metadata-only',
    sensitivityReview: 'Operational fire-management imagery and critical-infrastructure context are outside public runtime scope.',
    runtimeEligible: false, decision: 'rejected', credential: 'restricted',
  }),
  'bom-imagery': civicDecision({
    publisher: 'Bureau of Meteorology', officialUrl: 'https://www.bom.gov.au/catalogue/data-feeds.shtml', endpoint: null,
    licence: 'Product-specific Bureau data licence required for redistribution', cacheMs: 0, geometry: 'raster-metadata-only',
    sensitivityReview: 'Weather imagery is not CCTV; anonymous access does not establish display, redistribution or caching rights.',
    runtimeEligible: false, decision: 'licence-required', credential: 'registration-may-be-required',
  }),
});

export const REGIONAL_SOURCES = Object.freeze({
  'melbourne-trees': Object.freeze({
    name: 'Melbourne Urban Forest', source: 'City of Melbourne Open Data', publisher: 'City of Melbourne',
    endpoint: 'https://data.melbourne.vic.gov.au/api/explore/v2.1/', licence: 'CC BY (as declared by the selected dataset)',
    geometry: 'point', refreshMs: 86_400_000, refresh: 'daily', credit: 'City of Melbourne Open Data', credential: 'none', runtimeEligible: true, maxFeatures: 1_000,
  }),
  'melbourne-places': Object.freeze({
    name: 'Melbourne Public Places', source: 'City of Melbourne Open Data', publisher: 'City of Melbourne',
    endpoint: 'https://data.melbourne.vic.gov.au/api/explore/v2.1/', licence: 'CC BY (as declared by the selected dataset)',
    geometry: 'point', refreshMs: 86_400_000, refresh: 'daily', credit: 'City of Melbourne Open Data', credential: 'none', runtimeEligible: true, maxFeatures: 500,
  }),
  'melbourne-cycling': Object.freeze({
    name: 'Melbourne Cycling Network', source: 'City of Melbourne Open Data', publisher: 'City of Melbourne',
    endpoint: 'https://data.melbourne.vic.gov.au/api/explore/v2.1/', licence: 'CC BY (as declared by the selected dataset)',
    geometry: 'line', refreshMs: 86_400_000, refresh: 'daily', credit: 'City of Melbourne Open Data', credential: 'none', runtimeEligible: true, maxFeatures: 1_000,
  }),
  'melbourne-water-history': Object.freeze({
    name: 'Melbourne Water History', source: 'City of Melbourne Open Data', publisher: 'City of Melbourne',
    endpoint: 'https://data.melbourne.vic.gov.au/api/explore/v2.1/', licence: 'CC BY (as declared by the selected dataset)',
    geometry: 'line-or-polygon', refreshMs: 604_800_000, refresh: 'weekly', credit: 'City of Melbourne Open Data', credential: 'none', runtimeEligible: true, maxFeatures: 500,
  }),
  'vic-epa-air': Object.freeze({
    name: 'Victoria Air Quality', source: 'EPA Victoria', publisher: 'Environment Protection Authority Victoria',
    endpoint: null, licence: 'EPA Victoria developer/API terms pending registration and product-subscription validation',
    geometry: 'not runtime eligible', refreshMs: 0, refresh: 'not fetched; provider contract unverified', credit: 'EPA Victoria',
    credential: 'registration-required', runtimeEligible: false, decision: 'credentials-required',
    availabilityReason: 'EPA Victoria registration required', maxFeatures: 0,
  }),
  'vic-cfa-alerts': Object.freeze({
    name: 'CFA / VicEmergency RSS (restricted)', source: 'CFA RSS feeds', publisher: 'Country Fire Authority Victoria',
    endpoint: 'https://www.cfa.vic.gov.au/rss-feeds', licence: 'CFA RSS terms: personal, non-commercial use; no modification',
    geometry: 'not runtime eligible', refreshMs: 0, refresh: 'not fetched or normalized', credit: 'CFA RSS feeds', credential: 'restricted', runtimeEligible: false, maxFeatures: 0,
  }),
  'vic-fire-context': Object.freeze({
    name: 'Victoria Fire Context', source: 'DataVic', publisher: 'State of Victoria',
    endpoint: 'https://discover.data.vic.gov.au/', licence: 'Creative Commons Attribution 4.0 International',
    geometry: 'polygon-or-line', refreshMs: 86_400_000, refresh: 'daily viewport query', credit: 'State of Victoria (DataVic)', credential: 'none', runtimeEligible: true, maxFeatures: 500,
  }),
  'vic-freight-network': Object.freeze({
    name: 'Victorian Freight Network', source: 'DataVic', publisher: 'State of Victoria',
    endpoint: 'https://discover.data.vic.gov.au/', licence: 'Creative Commons Attribution 4.0 International',
    geometry: 'line-or-point', refreshMs: 86_400_000, refresh: 'daily viewport query', credit: 'State of Victoria (DataVic)', credential: 'none', runtimeEligible: true, maxFeatures: 1_000,
  }),
  'au-hydrology': Object.freeze({
    name: 'Australian Hydrology', source: 'Australian Hydrological Geospatial Fabric', publisher: 'Bureau of Meteorology / Geoscience Australia',
    endpoint: 'https://www.bom.gov.au/water/geofabric/', licence: 'Creative Commons Attribution 4.0 International',
    geometry: 'line-or-polygon', refreshMs: 604_800_000, refresh: 'weekly viewport query', credit: 'Bureau of Meteorology / Geoscience Australia', credential: 'none', runtimeEligible: true, maxFeatures: 1_000,
  }),
  'au-emergency-facilities': Object.freeze({
    name: 'Australian Emergency Management Facilities', source: 'Geoscience Australia', publisher: 'Geoscience Australia',
    endpoint: 'https://services.ga.gov.au/gis/rest/services/Emergency_Management_Facilities/MapServer',
    licence: 'Creative Commons Attribution 4.0 International with incorporated G-NAF attribution',
    geometry: 'point', refreshMs: 86_400_000, refresh: 'daily viewport query; reference inventory only',
    credit: GA_SOURCE_CREDITS['au-emergency-facilities'], credential: 'none', runtimeEligible: true, maxFeatures: 1_000,
  }),
  'au-health-facilities': Object.freeze({
    name: 'Australian Health Facilities', source: 'Geoscience Australia / Healthdirect', publisher: 'Geoscience Australia',
    endpoint: 'https://services.ga.gov.au/gis/rest/services/National_HealthDirect_Health_Facilities/MapServer',
    licence: 'Live GA service: Creative Commons Attribution 4.0 International with incorporated G-NAF attribution; Data.gov catalogue licence is unspecified',
    geometry: 'point', refreshMs: 86_400_000, refresh: 'daily viewport query; periodic reference directory',
    credit: GA_SOURCE_CREDITS['au-health-facilities'], credential: 'none', runtimeEligible: true, maxFeatures: 1_000,
  }),
  'au-place-names': Object.freeze({
    name: 'Composite Gazetteer of Australia', source: 'Geoscience Australia', publisher: 'Geoscience Australia',
    endpoint: 'https://services.ga.gov.au/gis/rest/services/Composite_Gazetteer_of_Australia/MapServer',
    licence: 'Geoscience Australia service attribution; compiled reference data',
    geometry: 'point', refreshMs: 604_800_000, refresh: 'weekly viewport query; compiled reference data',
    credit: GA_SOURCE_CREDITS['au-place-names'], credential: 'none', runtimeEligible: true, maxFeatures: 1_000,
  }),
  'au-dea-hotspots': Object.freeze({
    name: 'Digital Earth Australia Hotspots', source: 'Digital Earth Australia', publisher: 'Geoscience Australia',
    endpoint: 'https://hotspots.dea.ga.gov.au/geoserver/wfs',
    licence: 'Dataset-specific catalogue licence unspecified; fallback: Creative Commons Attribution 4.0 International under Geoscience Australia general copyright terms, subject to accompanying notices.',
    geometry: 'point', refreshMs: 300_000, maxStaleMs: 900_000,
    refresh: 'five-minute viewport cache over the fixed three-day observation layer; last-good limited to fifteen minutes',
    credit: OGC_SOURCE_CREDITS['au-dea-hotspots'], credential: 'none', runtimeEligible: true, maxFeatures: 1_000,
  }),
  'vic-parks': Object.freeze({
    name: 'Victorian Parks and Reserves', source: 'DataVic', publisher: 'State of Victoria',
    endpoint: 'https://opendata.maps.vic.gov.au/geoserver/wfs', licence: 'Creative Commons Attribution 4.0 International',
    geometry: 'polygon', refreshMs: 86_400_000, maxStaleMs: 604_800_000,
    refresh: 'daily viewport cache; reference reserve boundaries', credit: OGC_SOURCE_CREDITS['vic-parks'],
    credential: 'none', runtimeEligible: true, maxFeatures: 500,
  }),
  'vic-recreation-tracks': Object.freeze({
    name: 'Victorian Recreation Tracks', source: 'DataVic', publisher: 'State of Victoria',
    endpoint: 'https://opendata.maps.vic.gov.au/geoserver/wfs', licence: 'Creative Commons Attribution 4.0 International',
    geometry: 'line', refreshMs: 86_400_000, maxStaleMs: 604_800_000,
    refresh: 'daily viewport cache; reference alignment only, not live closure or condition state',
    credit: OGC_SOURCE_CREDITS['vic-recreation-tracks'], credential: 'none', runtimeEligible: true, maxFeatures: 1_000,
  }),
  'vic-heritage': Object.freeze({
    name: 'Victorian Heritage Register', source: 'DataVic', publisher: 'State of Victoria',
    endpoint: 'https://opendata.maps.vic.gov.au/geoserver/wfs', licence: 'Creative Commons Attribution 4.0 International',
    geometry: 'polygon', refreshMs: 86_400_000, maxStaleMs: 604_800_000,
    refresh: 'unknown publisher cadence; daily viewport cache', credit: OGC_SOURCE_CREDITS['vic-heritage'],
    credential: 'none', runtimeEligible: true, maxFeatures: 250,
  }),
  'vic-ev-chargers': Object.freeze({
    name: 'Government Funded Public EV Chargers', source: 'DataVic', publisher: 'State of Victoria',
    endpoint: 'https://opendata.maps.vic.gov.au/geoserver/wfs', licence: 'Creative Commons Attribution 4.0 International',
    geometry: 'point', refreshMs: 86_400_000, maxStaleMs: 604_800_000,
    refresh: 'monthly publisher cadence; daily viewport cache; funded-site reference only, not occupancy, pricing, service or live availability',
    credit: OGC_SOURCE_CREDITS['vic-ev-chargers'], credential: 'none', runtimeEligible: true, maxFeatures: 200,
  }),
  'vic-renewable-facilities': Object.freeze({
    name: 'Renewables Facility Location for Victoria', source: 'DataVic', publisher: 'State of Victoria',
    endpoint: 'https://opendata.maps.vic.gov.au/geoserver/wfs', licence: 'Creative Commons Attribution 4.0 International',
    geometry: 'polygon', refreshMs: 86_400_000, maxStaleMs: 604_800_000,
    refresh: 'publisher cadence unstated; daily viewport cache; planning and infrastructure context only',
    credit: OGC_SOURCE_CREDITS['vic-renewable-facilities'], credential: 'none', runtimeEligible: true, maxFeatures: 300,
  }),
  'vic-flood-history-2022': Object.freeze({
    name: 'Victorian Flood History - October 2022 Event Public', source: 'DataVic', publisher: 'State of Victoria',
    endpoint: 'https://opendata.maps.vic.gov.au/geoserver/wfs', licence: 'Creative Commons Attribution 4.0 International',
    geometry: 'polygon', refreshMs: 86_400_000, maxStaleMs: 604_800_000,
    refresh: 'historical incomplete October 2022 evidence; one-feature viewport cap; not current extent, peak extent, flash-flood coverage or warning',
    credit: OGC_SOURCE_CREDITS['vic-flood-history-2022'], credential: 'none', runtimeEligible: true, maxFeatures: 1,
    maxResponseBytes: 1_500_000, maxInputCoordinatesPerFeature: 60_000,
    maxInputCoordinatesPerResponse: 75_000, maxOutputCoordinatesPerFeature: 60_000,
    maxRingsPerFeature: 2_000, maxTopologyComparisons: 20_000_000,
  }),
  'vic-epa-priority-sites': Object.freeze({
    name: 'EPA Victoria Priority Sites Register', source: 'DataVic', publisher: 'Environment Protection Authority Victoria',
    endpoint: 'https://opendata.maps.vic.gov.au/geoserver/wfs', licence: 'Creative Commons Attribution 4.0 International',
    geometry: 'polygon', refreshMs: 86_400_000, maxStaleMs: 604_800_000,
    refresh: 'publisher cadence unstated; daily viewport cache; absence does not mean uncontaminated or safe',
    credit: OGC_SOURCE_CREDITS['vic-epa-priority-sites'], credential: 'none', runtimeEligible: true, maxFeatures: 100,
  }),
  'vic-landfill-register': Object.freeze({
    name: 'Victorian Landfill Register', source: 'DataVic', publisher: 'Environment Protection Authority Victoria',
    endpoint: 'https://opendata.maps.vic.gov.au/geoserver/wfs', licence: 'Creative Commons Attribution 4.0 International',
    geometry: 'polygon', refreshMs: 86_400_000, maxStaleMs: 604_800_000,
    refresh: 'publisher cadence unstated; daily viewport cache; possible register lag and no current operation or safety inference',
    credit: OGC_SOURCE_CREDITS['vic-landfill-register'], credential: 'none', runtimeEligible: true, maxFeatures: 300,
  }),
  'vic-recreation-assets': Object.freeze({
    name: 'DEECA Recreation Assets', source: 'DataVic', publisher: 'State of Victoria',
    endpoint: 'https://opendata.maps.vic.gov.au/geoserver/wfs', licence: 'Creative Commons Attribution 4.0 International',
    geometry: 'point', refreshMs: 86_400_000, maxStaleMs: 604_800_000,
    refresh: 'daily publisher cadence and viewport cache; inventory presence does not prove open or maintained',
    credit: OGC_SOURCE_CREDITS['vic-recreation-assets'], credential: 'none', runtimeEligible: true, maxFeatures: 1_000,
  }),
  'melbourne-drinking-fountains': Object.freeze({
    name: 'Melbourne Drinking Fountains', source: 'City of Melbourne Open Data', publisher: 'City of Melbourne',
    endpoint: 'https://data.melbourne.vic.gov.au/explore/dataset/drinking-fountains/information/',
    licence: 'Creative Commons Attribution 4.0 International', geometry: 'point', refreshMs: 21_600_000,
    maxStaleMs: 259_200_000,
    refresh: 'six-hour viewport cache; publisher source cadence is daily; last-good is limited to three missed publisher cycles', credit: CITY_OF_MELBOURNE_CREDIT,
    credential: 'none', runtimeEligible: true, maxFeatures: 500,
  }),
  'melbourne-barbecues': Object.freeze({
    name: 'Melbourne Public Barbecues', source: 'City of Melbourne Open Data', publisher: 'City of Melbourne',
    endpoint: 'https://data.melbourne.vic.gov.au/explore/dataset/public-barbecues/information/',
    licence: 'Creative Commons Attribution 4.0 International', geometry: 'point', refreshMs: 21_600_000,
    maxStaleMs: 259_200_000,
    refresh: 'six-hour viewport cache; publisher source cadence is daily; last-good is limited to three missed publisher cycles', credit: CITY_OF_MELBOURNE_CREDIT,
    credential: 'none', runtimeEligible: true, maxFeatures: 200,
  }),
  'melbourne-parking-live': Object.freeze({
    name: 'Melbourne On-street Parking Sensors', source: 'City of Melbourne Open Data', publisher: 'City of Melbourne',
    endpoint: 'https://data.melbourne.vic.gov.au/explore/dataset/on-street-parking-bay-sensors/information/',
    licence: 'Creative Commons Attribution 4.0 International', geometry: 'point', refreshMs: 120_000,
    maxStaleMs: 600_000,
    refresh: 'provider-wide sensor and bay tables cached for two minutes; freshness is per sensor record',
    credit: CITY_OF_MELBOURNE_CREDIT, credential: 'none', runtimeEligible: true, maxFeatures: 1_000,
  }),
  'melbourne-development': Object.freeze({
    name: 'Melbourne Development Activity', source: 'City of Melbourne Open Data', publisher: 'City of Melbourne',
    endpoint: 'https://data.melbourne.vic.gov.au/explore/dataset/development-activity-monitor/information/',
    licence: 'Creative Commons Attribution 4.0 International', geometry: 'point', refreshMs: 86_400_000,
    maxStaleMs: 2_592_000_000,
    refresh: 'daily viewport cache; publisher source cadence is monthly', credit: CITY_OF_MELBOURNE_CREDIT,
    credential: 'none', runtimeEligible: true, maxFeatures: 1_000,
  }),
  'melbourne-culture': Object.freeze({
    name: 'Melbourne Public Art and Memorials', source: 'City of Melbourne Open Data', publisher: 'City of Melbourne',
    endpoint: 'https://data.melbourne.vic.gov.au/explore/dataset/outdoor-artworks/information/',
    licence: 'Creative Commons Attribution 4.0 International for dataset metadata; record-level media rights are separate',
    geometry: 'point', refreshMs: 86_400_000, refresh: 'daily viewport cache; source inspection cadence is unspecified',
    maxStaleMs: 2_592_000_000,
    credit: CITY_OF_MELBOURNE_CREDIT, credential: 'none', runtimeEligible: true, maxFeatures: 500,
  }),
  'au-public-toilets': Object.freeze({
    name: 'National Public Toilet Map', source: 'Australian Government data.gov.au', publisher: 'Australian Government',
    endpoint: 'https://data.gov.au/data/api/3/action/package_show?id=553b3049-2b8b-46a2-95e6-640d7986a8c1',
    licence: 'Legal review required: catalogue says Creative Commons Attribution 3.0 Australia, but package notes add conflicting prompt-update, non-transferability and no-sublicensing terms. Redistribution rights are not asserted.',
    geometry: 'point', refreshMs: 21_600_000, maxStaleMs: 259_200_000,
    refresh: 'hourly metadata revalidation and six-hour conditional download check; finite three-day last-good; reference inventory only',
    credit: 'National Public Toilet Map, Australian Government', credential: 'none', runtimeEligible: true,
    maxFeatures: 1_000, maxRows: 30_000,
  }),
  'vic-transport-stops': Object.freeze({
    name: 'Victorian Public Transport Stops', source: 'Transport Victoria Open Data Portal', publisher: 'Department of Transport and Planning Victoria',
    endpoint: 'https://opendata.transport.vic.gov.au/api/3/action/package_show?id=public-transport-lines-and-stops',
    licence: 'Creative Commons Attribution 4.0', geometry: 'point', refreshMs: 86_400_000,
    maxStaleMs: 604_800_000,
    refresh: 'hourly metadata revalidation and daily conditional download check; reference stop inventory, not realtime or evidence a service is running',
    credit: 'Source: Department of Transport and Planning Victoria, Public Transport Lines and Stops, licensed under Creative Commons Attribution 4.0.',
    credential: 'none', runtimeEligible: true, maxFeatures: 1_000, maxRows: 40_000,
  }),
  'vic-waste-facilities': Object.freeze({
    name: 'Victorian Waste and Resource Recovery Facilities', source: 'DataVic', publisher: 'Recycling Victoria',
    endpoint: 'https://discover.data.vic.gov.au/api/3/action/package_show?id=victoria-s-waste-and-resource-recovery-infrastructure-map-data',
    licence: 'Creative Commons Attribution 4.0 International', geometry: 'point', refreshMs: 21_600_000,
    maxStaleMs: 259_200_000,
    refresh: 'six-hour snapshot index; October 2025 reference inventory only, and inclusion does not imply a facility is currently operating',
    credit: 'Victoria’s Waste and Recycling Infrastructure Map © Recycling Victoria 2023. Licensed under Creative Commons Attribution 4.0 International.',
    credential: 'none', runtimeEligible: true, maxFeatures: 1_000, maxRows: 1_000,
  }),
  'vic-property-boundaries': Object.freeze({
    name: 'Vicmap Property Parcel Boundaries', source: 'DataVic', publisher: 'State of Victoria',
    endpoint: 'https://services-ap1.arcgis.com/P744lA0wf4LlBZ84/ArcGIS/rest/services/Vicmap_Parcel/FeatureServer/0',
    licence: 'Creative Commons Attribution 4.0 International', geometry: 'polygon', refreshMs: 86_400_000,
    maxStaleMs: 604_800_000, minZoom: 18,
    refresh: 'weekly REST catalogue cadence (broader product records describe continual maintenance); high-zoom reference parcel geometry only, not a survey or legal boundary determination',
    credit: 'State of Victoria (DataVic), Vicmap Property — licensed under Creative Commons Attribution 4.0 International.',
    credential: 'none', runtimeEligible: true, maxFeatures: 500,
  }),
  'ptv-transit': Object.freeze({
    name: 'Transport Victoria Realtime Transit', source: 'Transport Victoria Open Data Portal', publisher: 'Public Transport Victoria',
    endpoint: 'https://opendata.transport.vic.gov.au/dataset/gtfs-realtime', licence: 'Creative Commons Attribution 4.0 International',
    geometry: 'point', refreshMs: 30_000, refresh: 'provider snapshots cached globally by mode for at least 30 seconds', credit: 'Source: Licensed from Public Transport Victoria under a Creative Commons Attribution 4.0 International Licence.',
    // Browser layers require no credential. The proxy enforces this server-only
    // provider credential and returns an honest 424 when it is absent.
    credential: 'none', serverCredential: 'TRANSPORT_VIC_OPEN_DATA_API_KEY', credentialEnv: 'TRANSPORT_VIC_OPEN_DATA_API_KEY',
    configuredEnv: 'VITE_TRANSPORT_VIC_OPEN_DATA_CONFIGURED', credentialsReason: 'Transport Victoria Open Data Portal key required',
    runtimeEligible: true, maxFeatures: 1_000,
  }),
  'au-hospital-ed-performance': Object.freeze({
    name: 'Australian historical ED performance', source: 'AIHW MyHospitals',
    ...CIVIC_SOURCE_VALIDATION['au-hospital-ed-performance'],
    refreshMs: 86_400_000, refresh: 'daily cache check; data changes on AIHW release cycles',
    credit: 'Based on Australian Institute of Health and Welfare material.', maxFeatures: 1_000,
  }),
});

function sourceFor(sourceId) {
  if (Object.hasOwn(CIVIC_SOURCE_VALIDATION, sourceId)
    && !CIVIC_SOURCE_VALIDATION[sourceId].runtimeEligible) {
    throw new Error(`${sourceId} is not runtime eligible: ${CIVIC_SOURCE_VALIDATION[sourceId].decision}`);
  }
  if (!Object.hasOwn(REGIONAL_SOURCES, sourceId)) throw new Error(`Unknown regional source: ${sourceId}`);
  return REGIONAL_SOURCES[sourceId];
}

function availabilitySourceFor(sourceId) {
  if (Object.hasOwn(REGIONAL_SOURCES, sourceId)) return REGIONAL_SOURCES[sourceId];
  if (Object.hasOwn(CIVIC_SOURCE_VALIDATION, sourceId)) return CIVIC_SOURCE_VALIDATION[sourceId];
  throw new Error(`Unknown regional source: ${sourceId}`);
}

function cleanText(value, maxLength = MAX_TEXT_LENGTH) {
  return typeof value === 'string' ? value.replace(/\s+/g, ' ').trim().slice(0, maxLength) : '';
}

function runtimeEnvironment() {
  if (typeof process !== 'undefined' && process?.env) return process.env;
  return import.meta.env || {};
}

const AVAILABILITY_STATUSES = new Set([
  'available',
  'credentials-required',
  'licence-required',
  'metadata-link-only',
  'permission-required',
  'rejected',
  'restricted',
  'unavailable',
]);

/** Return credential-safe admission state for one fixed regional source. */
export function regionalSourceAvailability(sourceId, env = runtimeEnvironment()) {
  const source = availabilitySourceFor(sourceId);
  if (!source.runtimeEligible) {
    const status = AVAILABILITY_STATUSES.has(source.decision) ? source.decision : 'unavailable';
    return {
      available: false,
      status,
      reason: cleanText(source.availabilityReason, 180) || 'Regional source unavailable',
    };
  }

  if (source.credentialEnv) {
    const hasServerCredential = Boolean(cleanText(env?.[source.credentialEnv], 1));
    const hasBrowserMarker = source.configuredEnv && env?.[source.configuredEnv] === 'true';
    if (!hasServerCredential && !hasBrowserMarker) {
      return {
        available: false,
        status: 'credentials-required',
        reason: cleanText(source.credentialsReason, 180) || 'Regional source credentials required',
      };
    }
  }

  return { available: true, status: 'available', reason: '' };
}

function safeUrl(value) {
  try {
    const url = new URL(String(value || ''));
    return ['http:', 'https:'].includes(url.protocol) ? url.href : '';
  } catch {
    return '';
  }
}

function coordinate(value, min, max) {
  const number = typeof value === 'number'
    ? value
    : typeof value === 'string' && value.trim() ? Number(value) : Number.NaN;
  return Number.isFinite(number) && number >= min && number <= max ? number : null;
}

function validPosition(value) {
  return Array.isArray(value) && value.length >= 2
    && coordinate(value[0], -180, 180) !== null && coordinate(value[1], -90, 90) !== null;
}

function validCoordinates(type, coordinates) {
  if (type === 'Point') return validPosition(coordinates);
  if (!Array.isArray(coordinates) || !coordinates.length) return false;
  if (type === 'LineString' || type === 'MultiPoint') return coordinates.every(validPosition);
  if (type === 'Polygon' || type === 'MultiLineString') return coordinates.every((part) => Array.isArray(part) && part.length && part.every(validPosition));
  if (type === 'MultiPolygon') return coordinates.every((polygon) => Array.isArray(polygon) && polygon.length
    && polygon.every((ring) => Array.isArray(ring) && ring.length && ring.every(validPosition)));
  return false;
}

function geometryAllowed(source, type) {
  const allowed = {
    point: ['Point'],
    line: ['LineString', 'MultiLineString'],
    'line-or-polygon': ['LineString', 'MultiLineString', 'Polygon', 'MultiPolygon'],
    'polygon-or-line': ['Polygon', 'MultiPolygon', 'LineString', 'MultiLineString'],
    'line-or-point': ['LineString', 'MultiLineString', 'Point'],
  }[source.geometry];
  return allowed?.includes(type) || false;
}

function normalizeGeometry(source, geometry) {
  if (!geometry || typeof geometry !== 'object' || !geometryAllowed(source, geometry.type)
    || !validCoordinates(geometry.type, geometry.coordinates)) return null;
  return { type: geometry.type, coordinates: geometry.coordinates };
}

function propertiesFor(row, title) {
  const properties = { title: cleanText(title, 180) || 'Untitled feature' };
  for (const key of ['category', 'type', 'status', 'aqi', 'description']) {
    const value = row?.[key];
    if (key === 'aqi' && Number.isFinite(Number(value))) properties.aqi = Number(value);
    else if (key === 'description' && cleanText(value)) properties.description = cleanText(value);
    else if (key !== 'aqi' && cleanText(value, 180)) properties[key] = cleanText(value, 180);
  }
  const url = safeUrl(row?.url || row?.link);
  if (url) properties.url = url;
  return properties;
}

function feature(id, geometry, properties) {
  return { type: 'Feature', ...(id === undefined || id === null || id === '' ? {} : { id: String(id) }), geometry, properties };
}

function collectFeatures(rows, maxFeatures, normalizeRow) {
  const features = [];
  for (const row of rows) {
    const normalized = normalizeRow(row);
    if (!normalized) continue;
    features.push(normalized);
    if (features.length >= maxFeatures) break;
  }
  return features;
}

function recordFeatures(sourceId, payload, maxFeatures) {
  if (!Array.isArray(payload?.results)) throw new Error(`${sourceId} payload must contain a results array`);
  return collectFeatures(payload.results, maxFeatures, (row) => {
    const { record } = row || {};
    const fields = record?.fields;
    const longitude = coordinate(fields?.longitude ?? fields?.lon, -180, 180);
    const latitude = coordinate(fields?.latitude ?? fields?.lat, -90, 90);
    if (longitude === null || latitude === null) return null;
    return feature(record?.id ?? fields?.id, { type: 'Point', coordinates: [longitude, latitude] }, propertiesFor(fields,
      fields?.common_name || fields?.name || fields?.title || fields?.asset_name));
  });
}

function geoJsonFeatures(source, payload, maxFeatures) {
  const rows = payload?.type === 'FeatureCollection' ? payload.features : payload?.features;
  if (!Array.isArray(rows)) throw new Error('GeoJSON payload must contain a features array');
  return collectFeatures(rows, maxFeatures, (row) => {
    const geometry = normalizeGeometry(source, row?.geometry);
    if (!geometry) return null;
    const properties = row?.properties || {};
    return feature(row?.id ?? properties.id ?? properties.objectid, geometry, propertiesFor(properties,
      properties.title || properties.name || properties.road_name || properties.label || properties.feature_name));
  });
}

function ptvFeatures(payload, maxFeatures) {
  if (!Array.isArray(payload?.vehicles)) throw new Error('ptv-transit payload must contain a vehicles array');
  const validModes = new Set(['metro', 'tram', 'bus', 'vline']);
  const validOccupancy = new Set(['EMPTY', 'MANY_SEATS_AVAILABLE', 'FEW_SEATS_AVAILABLE', 'STANDING_ROOM_ONLY', 'CRUSHED_STANDING_ROOM_ONLY', 'FULL', 'NOT_ACCEPTING_PASSENGERS', 'NO_DATA_AVAILABLE', 'NOT_BOARDABLE']);
  return collectFeatures(payload.vehicles, maxFeatures, (vehicle) => {
    const longitude = coordinate(vehicle?.position?.longitude, -180, 180);
    const latitude = coordinate(vehicle?.position?.latitude, -90, 90);
    if (longitude === null || latitude === null) return null;
    const mode = cleanText(vehicle?.mode, 20);
    if (!validModes.has(mode)) return null;
    const properties = {
      title: `${mode === 'vline' ? 'V/Line' : `${mode[0].toUpperCase()}${mode.slice(1)}`} vehicle`,
      mode,
      stale: vehicle?.stale === true,
    };
    for (const key of ['tripId', 'routeId']) {
      const value = cleanText(vehicle?.[key], 160).replace(/[<>\u0000-\u001f\u007f]/g, '');
      if (value) properties[key] = value;
    }
    for (const key of ['timestamp', 'feedTimestamp', 'feedAgeSeconds']) {
      if (Number.isSafeInteger(vehicle?.[key]) && vehicle[key] >= 0) properties[key] = vehicle[key];
    }
    if (typeof vehicle?.bearing === 'number' && Number.isFinite(vehicle.bearing) && vehicle.bearing >= 0 && vehicle.bearing < 360) {
      properties.bearing = vehicle.bearing;
    }
    if (validOccupancy.has(vehicle?.occupancyStatus)) properties.occupancyStatus = vehicle.occupancyStatus;
    const featureId = cleanText(vehicle?.featureId, 200).replace(/[^a-zA-Z0-9-]/g, '');
    if (!featureId) return null;
    return feature(featureId, { type: 'Point', coordinates: [longitude, latitude] }, properties);
  });
}

function ptvModeStatus(payload) {
  const statuses = {};
  for (const mode of ['metro', 'tram', 'bus', 'vline']) {
    const input = payload?.modeStatus?.[mode];
    if (!['current', 'stale', 'unavailable'].includes(input?.status)) continue;
    statuses[mode] = { status: input.status };
    if (Number.isSafeInteger(input.feedTimestamp) && input.feedTimestamp > 0) statuses[mode].feedTimestamp = input.feedTimestamp;
    if (Number.isSafeInteger(input.feedAgeSeconds) && input.feedAgeSeconds >= 0) statuses[mode].feedAgeSeconds = input.feedAgeSeconds;
  }
  return statuses;
}

function aihwCaveats(row) {
  const caveats = [];
  const seen = new Set();
  const append = (label, code, footnote) => {
    if (!cleanText(label) && !cleanText(code, 180)) return;
    const normalized = {
      ...(cleanText(code, 180) ? { code: cleanText(code, 180) } : {}),
      ...(cleanText(label) ? { label: cleanText(label) } : {}),
      ...(cleanText(footnote) ? { footnote: cleanText(footnote) } : {}),
    };
    const key = JSON.stringify(normalized);
    if (Object.keys(normalized).length && !seen.has(key)) {
      seen.add(key);
      caveats.push(normalized);
    }
  };
  append(row?.suppression, row?.suppression_codes, row?.suppression_footnotes || row?.caveat_footnotes);
  append(row?.caveat, row?.caveat_codes, row?.caveat_footnotes);
  append(row?.data_set_caveat, row?.data_set_caveat_codes, row?.data_set_caveat_footnotes);
  return caveats;
}

function aihwFeatures(source, payload) {
  const extract = payload?.extract;
  if (!Array.isArray(extract?.result?.data)) {
    throw new Error('au-hospital-ed-performance payload must contain extract.result.data');
  }
  if (!Array.isArray(payload?.reportingUnits?.result)) {
    throw new Error('au-hospital-ed-performance payload must contain reportingUnits.result');
  }
  const version = extract.version_information;
  if (!version || version.data_version === undefined || !cleanText(version.date_uploaded, 80)) {
    throw new Error('au-hospital-ed-performance payload must retain AIHW version information');
  }
  const reportingUnits = new Map(payload.reportingUnits.result.map((unit) => [unit?.reporting_unit_code, unit]));
  const allowedMeasures = new Set(['MYH0010', 'MYH0011']);

  return collectFeatures(extract.result.data, source.maxFeatures, (row) => {
    if (row?.reporting_unit_type_code !== 'H' || !allowedMeasures.has(row?.measure_code)) return null;
    const unit = reportingUnits.get(row.reporting_unit_code);
    const longitude = coordinate(unit?.longitude, -180, 180);
    const latitude = coordinate(unit?.latitude, -90, 90);
    const start = cleanText(row?.reporting_start_date, 80);
    const end = cleanText(row?.reporting_end_date, 80);
    if (longitude === null || latitude === null || !start || !end) return null;

    const caveats = aihwCaveats(row);
    const suppressed = row.value === null || Boolean(cleanText(row?.suppression) || cleanText(row?.suppression_codes));
    const numericValue = typeof row.value === 'number' && Number.isFinite(row.value) ? row.value : null;
    const errorState = suppressed ? 'suppressed' : numericValue === null ? 'unavailable' : caveats.length ? 'caveated' : 'none';
    const properties = {
      title: cleanText(row.reporting_unit_name, 180) || 'Australian public hospital',
      sourceId: 'au-hospital-ed-performance', source: source.publisher, officialUrl: source.officialUrl,
      context: 'aggregate historical ED performance', historical: true,
      reportingUnitCode: cleanText(row.reporting_unit_code, 80),
      reportingUnitType: 'Hospital',
      measureCode: row.measure_code, measure: cleanText(row.measure_name),
      reportedMeasureCode: cleanText(row.reported_measure_code, 80), reportedMeasure: cleanText(row.reported_measure_name),
      reportingPeriod: { start, end },
      freshness: {
        ...(cleanText(version.api_version, 80) ? { apiVersion: cleanText(version.api_version, 80) } : {}),
        dataVersion: version.data_version,
        uploadedAt: cleanText(version.date_uploaded, 80),
        ...(cleanText(version.requested_time_stamp, 80) ? { requestedAt: cleanText(version.requested_time_stamp, 80) } : {}),
      },
      caveats, suppressed, errorState,
      units: { name: cleanText(row.units_name, 80), display: cleanText(row.units_display, 20) },
    };
    if (!suppressed && numericValue !== null) {
      properties.value = numericValue;
      if (typeof row.lower_value === 'number' && Number.isFinite(row.lower_value)) properties.lowerValue = row.lower_value;
      if (typeof row.upper_value === 'number' && Number.isFinite(row.upper_value)) properties.upperValue = row.upper_value;
    }
    const id = [row.reporting_unit_code, row.measure_code, row.reported_measure_code, start, end].filter(Boolean).join(':');
    return feature(id, { type: 'Point', coordinates: [longitude, latitude] }, properties);
  });
}

/** Convert one approved source's public payload into a bounded GeoJSON FeatureCollection. */
export function normalizeRegionalFeatureCollection(sourceId, payload) {
  const source = sourceFor(sourceId);
  if (!source.runtimeEligible) throw new Error(`${sourceId} is not runtime eligible: restricted source terms`);
  let features;
  if (['melbourne-trees', 'melbourne-places'].includes(sourceId)) features = recordFeatures(sourceId, payload, source.maxFeatures);
  else if (['au-emergency-facilities', 'au-health-facilities', 'au-place-names'].includes(sourceId)) {
    return normalizeGaRegionalPayload(sourceId, payload);
  }
  else if (['au-dea-hotspots', 'vic-parks', 'vic-recreation-tracks', 'vic-heritage', 'vic-ev-chargers',
    'vic-renewable-facilities', 'vic-flood-history-2022', 'vic-epa-priority-sites', 'vic-landfill-register',
    'vic-recreation-assets'].includes(sourceId)) {
    return normalizeOgcPayload(sourceId, payload, { maxFeatures: source.maxFeatures });
  }
  else if (['melbourne-drinking-fountains', 'melbourne-barbecues', 'melbourne-parking-live', 'melbourne-development', 'melbourne-culture'].includes(sourceId)) {
    return normalizeMelbourneCivicPayload(sourceId, payload, { maxFeatures: source.maxFeatures });
  }
  else if (sourceId === 'ptv-transit') features = ptvFeatures(payload, source.maxFeatures);
  else if (sourceId === 'au-hospital-ed-performance') features = aihwFeatures(source, payload);
  else features = geoJsonFeatures(source, payload, source.maxFeatures);
  return {
    type: 'FeatureCollection',
    features,
    ...(sourceId === 'ptv-transit' ? { modeStatus: ptvModeStatus(payload) } : {}),
  };
}

/** Return the source's required display attribution, or reject an unknown source. */
export function regionalSourceAttribution(sourceId) {
  return sourceFor(sourceId).credit;
}
