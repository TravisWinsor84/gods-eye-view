const REPORTING_UNITS_URL = 'https://myhospitalsapi.aihw.gov.au/api/v1/reporting-units?reporting_unit_type_code=H';
const EXTRACT_URL = 'https://myhospitalsapi.aihw.gov.au/api/v1/flat-data-extract/MYH-ED-WAITS';
const REPORTING_UNITS_CACHE_MS = 24 * 60 * 60 * 1_000;
const DEFAULT_TIMEOUT_MS = 30_000;
const MAX_RESPONSE_BYTES = 2_500_000;
const UNIT_BATCH_SIZE = 25;

function codedError(message, code) {
  const error = new Error(message);
  error.code = code;
  return error;
}

function coordinate(value, min, max) {
  return typeof value === 'number' && Number.isFinite(value) && value >= min && value <= max ? value : null;
}

async function readJsonCapped(response) {
  const declared = Number(response.headers?.get?.('content-length'));
  if (Number.isFinite(declared) && declared > MAX_RESPONSE_BYTES) throw codedError('source limit exceeded', 'SOURCE_LIMIT');
  const reader = response.body?.getReader?.();
  if (!reader) throw codedError('invalid source data', 'INVALID_SOURCE_DATA');
  const chunks = [];
  let size = 0;
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > MAX_RESPONSE_BYTES) throw codedError('source limit exceeded', 'SOURCE_LIMIT');
      chunks.push(value);
    }
  } finally {
    reader.releaseLock();
  }
  const bytes = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength; }
  try { return JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes)); }
  catch { throw codedError('invalid source data', 'INVALID_SOURCE_DATA'); }
}

function validBounds(bbox) {
  return bbox && [bbox.west, bbox.south, bbox.east, bbox.north].every(Number.isFinite)
    && bbox.west < bbox.east && bbox.south < bbox.north;
}

/** Load bounded, historical AIHW ED measures for hospitals in one viewport. */
export function createAihwHospitalEd({
  fetchImpl = fetch,
  now = () => Date.now(),
  withRequestSlot = async (operation) => operation(),
  timeoutMs = DEFAULT_TIMEOUT_MS,
} = {}) {
  let unitsCache = null;
  let unitsLoadedAt = Number.NEGATIVE_INFINITY;
  let unitsPending = null;

  async function requestJson(url) {
    return withRequestSlot(async () => {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), timeoutMs);
      try {
        let response;
        try {
          response = await fetchImpl(url, {
            method: 'GET', headers: { Accept: 'application/json' }, signal: controller.signal, redirect: 'error',
          });
        } catch (error) {
          if (controller.signal.aborted || error?.name === 'AbortError') throw codedError('source timed out', 'TIMEOUT');
          throw codedError('source temporarily unavailable', 'UPSTREAM_UNAVAILABLE');
        }
        if (!response?.ok) throw codedError('source temporarily unavailable', 'UPSTREAM_UNAVAILABLE');
        const contentType = response.headers?.get?.('content-type') || '';
        if (!/^application\/(?:[a-z0-9!#$&^_.+-]+\+)?json(?:\s*;|$)/i.test(contentType)) {
          throw codedError('invalid source data', 'INVALID_SOURCE_DATA');
        }
        return readJsonCapped(response);
      } finally {
        clearTimeout(timer);
      }
    });
  }

  async function reportingUnits() {
    if (unitsCache && now() - unitsLoadedAt < REPORTING_UNITS_CACHE_MS) return unitsCache;
    if (!unitsPending) unitsPending = requestJson(REPORTING_UNITS_URL).then((payload) => {
      if (!Array.isArray(payload?.result) || !payload.version_information) throw codedError('invalid source data', 'INVALID_SOURCE_DATA');
      unitsCache = payload;
      unitsLoadedAt = now();
      return payload;
    }).finally(() => { unitsPending = null; });
    return unitsPending;
  }

  async function load({ bbox, maxFeatures = 1_000 } = {}) {
    if (!validBounds(bbox) || !Number.isSafeInteger(maxFeatures) || maxFeatures <= 0 || maxFeatures > 1_000) {
      throw codedError('invalid source query', 'INVALID_SOURCE_QUERY');
    }
    const catalogue = await reportingUnits();
    const units = catalogue.result.filter((unit) => {
      const longitude = coordinate(unit?.longitude, -180, 180);
      const latitude = coordinate(unit?.latitude, -90, 90);
      return unit?.reporting_unit_type?.reporting_unit_type_code === 'H'
        && typeof unit?.reporting_unit_code === 'string'
        && longitude !== null && latitude !== null
        && longitude >= bbox.west && longitude <= bbox.east
        && latitude >= bbox.south && latitude <= bbox.north;
    });
    if (!units.length) {
      return { extract: { result: { data: [] }, version_information: catalogue.version_information }, reportingUnits: { result: [] } };
    }

    const data = [];
    let versionInformation = null;
    const startYear = new Date(now()).getUTCFullYear() - 2;
    for (let batchOffset = 0; batchOffset < units.length && data.length < maxFeatures; batchOffset += UNIT_BATCH_SIZE) {
      const batch = units.slice(batchOffset, batchOffset + UNIT_BATCH_SIZE);
      let skip = 0;
      while (data.length < maxFeatures) {
        const url = new URL(EXTRACT_URL);
        url.searchParams.set('skip', String(skip));
        url.searchParams.set('top', String(Math.min(1_000, maxFeatures - data.length)));
        url.searchParams.append('measure_code', 'MYH0010');
        url.searchParams.append('measure_code', 'MYH0011');
        url.searchParams.set('reporting_unit_type_code', 'H');
        url.searchParams.set('start_date', `${startYear}-01-01`);
        for (const unit of batch) url.searchParams.append('reporting_unit_code', unit.reporting_unit_code);
        const page = await requestJson(url);
        if (!Array.isArray(page?.result?.data) || !page.version_information) throw codedError('invalid source data', 'INVALID_SOURCE_DATA');
        versionInformation ||= page.version_information;
        data.push(...page.result.data.slice(0, maxFeatures - data.length));
        const total = page.result.pagination?.total_results_available;
        if (!Number.isSafeInteger(total) || total < 0 || page.result.data.length === 0) break;
        skip += page.result.data.length;
        if (skip >= total) break;
      }
    }
    return {
      extract: { result: { data }, version_information: versionInformation || catalogue.version_information },
      reportingUnits: { result: units },
    };
  }

  return Object.freeze({ load });
}
