import GtfsRealtimeBindings from 'gtfs-realtime-bindings';

const { transit_realtime: transitRealtime } = GtfsRealtimeBindings;

const BASE_URL = 'https://api.opendata.transport.vic.gov.au/opendata/public-transport/gtfs/realtime/v1';
const MODES = Object.freeze(['metro', 'tram', 'bus', 'vline']);
const CACHE_MS = 30_000;
const CURRENT_MAX_AGE_MS = 120_000;
const STALE_MAX_AGE_MS = 300_000;
const DEFAULT_TIMEOUT_MS = 10_000;
const OCCUPANCY_STATUS = Object.freeze([
  'EMPTY',
  'MANY_SEATS_AVAILABLE',
  'FEW_SEATS_AVAILABLE',
  'STANDING_ROOM_ONLY',
  'CRUSHED_STANDING_ROOM_ONLY',
  'FULL',
  'NOT_ACCEPTING_PASSENGERS',
  'NO_DATA_AVAILABLE',
  'NOT_BOARDABLE',
]);

export const TRANSPORT_VIC_FEED_URLS = Object.freeze(Object.fromEntries(
  MODES.map((mode) => [mode, `${BASE_URL}/${mode}/vehicle-positions`]),
));

// Authenticated feed sizes still need measuring. These explicit per-feed caps
// bound memory now without assuming the existing JSON proxy's 1 MB cap fits.
export const TRANSPORT_VIC_MAX_FEED_BYTES = Object.freeze({
  metro: 8_000_000,
  tram: 8_000_000,
  bus: 8_000_000,
  vline: 8_000_000,
});

const globalModeCache = new Map();
const globalModeInFlight = new Map();

function codedError(code, message) {
  const error = new Error(message);
  error.code = code;
  return error;
}

function safeIdentifier(value, maxLength = 160) {
  if (typeof value !== 'string') return '';
  return value.replace(/[\u0000-\u001f\u007f<>]/g, '').replace(/\s+/g, ' ').trim().slice(0, maxLength);
}

function safeTimestamp(value) {
  let number;
  try {
    number = typeof value?.toNumber === 'function' ? value.toNumber() : Number(value);
  } catch {
    return null;
  }
  return Number.isSafeInteger(number) && number > 0 ? number : null;
}

function finiteInRange(value, min, max) {
  return typeof value === 'number' && Number.isFinite(value) && value >= min && value <= max;
}

function feedAgeSeconds(feedTimestamp, nowMs) {
  return Math.max(0, Math.floor(nowMs / 1_000 - feedTimestamp));
}

function snapshotState(snapshot, nowMs, forceStale = false) {
  const ageSeconds = feedAgeSeconds(snapshot.feedTimestamp, nowMs);
  if (ageSeconds * 1_000 > STALE_MAX_AGE_MS) return null;
  const stale = forceStale || ageSeconds * 1_000 > CURRENT_MAX_AGE_MS;
  return { ageSeconds, stale, status: stale ? 'stale' : 'current' };
}

async function readBinaryCapped(response, maxBytes) {
  const contentLength = Number(response.headers?.get?.('content-length'));
  if (Number.isFinite(contentLength) && contentLength > maxBytes) {
    throw codedError('RESPONSE_TOO_LARGE', 'transport feed unavailable');
  }
  const reader = response.body?.getReader?.();
  if (!reader) {
    const bytes = new Uint8Array(await response.arrayBuffer());
    if (bytes.byteLength > maxBytes) throw codedError('RESPONSE_TOO_LARGE', 'transport feed unavailable');
    return bytes;
  }

  const chunks = [];
  let length = 0;
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      length += value.byteLength;
      if (length > maxBytes) {
        await reader.cancel();
        throw codedError('RESPONSE_TOO_LARGE', 'transport feed unavailable');
      }
      chunks.push(value);
    }
  } finally {
    reader.releaseLock();
  }
  const bytes = new Uint8Array(length);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return bytes;
}

function decodeSnapshot(mode, bytes) {
  let message;
  try {
    message = transitRealtime.FeedMessage.decode(bytes);
  } catch {
    throw codedError('INVALID_FEED', 'transport feed unavailable');
  }
  if (message?.header?.gtfsRealtimeVersion !== '2.0') {
    throw codedError('INVALID_FEED', 'transport feed unavailable');
  }
  const feedTimestamp = safeTimestamp(message.header.timestamp);
  if (feedTimestamp === null) throw codedError('INVALID_FEED', 'transport feed unavailable');

  const vehicles = [];
  for (const entity of message.entity || []) {
    const vehicle = entity?.vehicle;
    const longitude = vehicle?.position?.longitude;
    const latitude = vehicle?.position?.latitude;
    if (!finiteInRange(longitude, -180, 180) || !finiteInRange(latitude, -90, 90)) continue;

    const record = {
      entityId: safeIdentifier(entity?.id),
      mode,
      position: { longitude, latitude },
      feedTimestamp,
    };
    const vehicleId = safeIdentifier(vehicle?.vehicle?.id);
    const tripId = safeIdentifier(vehicle?.trip?.tripId);
    const routeId = safeIdentifier(vehicle?.trip?.routeId);
    const timestamp = safeTimestamp(vehicle?.timestamp);
    if (vehicleId) record.vehicleId = vehicleId;
    if (tripId) record.tripId = tripId;
    if (routeId) record.routeId = routeId;
    if (timestamp !== null) record.timestamp = timestamp;
    if (finiteInRange(vehicle?.position?.bearing, 0, 359.999999)) record.bearing = vehicle.position.bearing;
    if (Number.isInteger(vehicle?.occupancyStatus) && OCCUPANCY_STATUS[vehicle.occupancyStatus]) {
      record.occupancyStatus = OCCUPANCY_STATUS[vehicle.occupancyStatus];
    }
    vehicles.push(record);
  }
  return { feedTimestamp, vehicles };
}

function inBounds(vehicle, bbox) {
  const { longitude, latitude } = vehicle.position;
  return longitude >= bbox.west && longitude <= bbox.east
    && latitude >= bbox.south && latitude <= bbox.north;
}

/** Fetch, decode and globally cache Transport Victoria vehicle-position feeds. */
export function createTransportVicGtfs({
  fetchImpl = fetch,
  now = () => Date.now(),
  cache = globalModeCache,
  inFlight = globalModeInFlight,
  timeoutMs = DEFAULT_TIMEOUT_MS,
  maxFeedBytes = TRANSPORT_VIC_MAX_FEED_BYTES,
} = {}) {
  async function refreshMode(mode, apiKey) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(codedError('TIMEOUT', 'transport feed unavailable')), timeoutMs);
    try {
      const response = await fetchImpl(TRANSPORT_VIC_FEED_URLS[mode], {
        method: 'GET',
        headers: { KeyID: apiKey, Accept: 'application/x-protobuf' },
        signal: controller.signal,
        redirect: 'error',
      });
      if (response?.status === 401 || response?.status === 403) {
        throw codedError('CREDENTIALS_REQUIRED', 'regional source credentials required');
      }
      if (!response?.ok) throw codedError('UPSTREAM_FAILED', 'transport feed unavailable');
      const bytes = await readBinaryCapped(response, maxFeedBytes[mode]);
      const snapshot = decodeSnapshot(mode, bytes);
      if (!snapshotState(snapshot, now())) throw codedError('STALE_FEED', 'transport feed unavailable');
      cache.set(mode, { snapshot, cachedAt: now() });
      return { snapshot, forceStale: false };
    } catch (error) {
      if (error?.code === 'CREDENTIALS_REQUIRED') throw error;
      const existing = cache.get(mode);
      if (existing && snapshotState(existing.snapshot, now(), true)) {
        return { snapshot: existing.snapshot, forceStale: true };
      }
      throw codedError('MODE_UNAVAILABLE', 'transport feed unavailable');
    } finally {
      clearTimeout(timer);
    }
  }

  async function loadMode(mode, apiKey) {
    const existing = cache.get(mode);
    if (existing && now() - existing.cachedAt < CACHE_MS) {
      const state = snapshotState(existing.snapshot, now());
      if (state) return { snapshot: existing.snapshot, forceStale: state.stale };
    }
    let pending = inFlight.get(mode);
    if (!pending) {
      pending = refreshMode(mode, apiKey).finally(() => inFlight.delete(mode));
      inFlight.set(mode, pending);
    }
    return pending;
  }

  return Object.freeze({
    async load({ bbox, apiKey, maxFeatures }) {
      const settled = await Promise.allSettled(MODES.map((mode) => loadMode(mode, apiKey)));
      if (settled.some((result) => result.status === 'rejected' && result.reason?.code === 'CREDENTIALS_REQUIRED')) {
        throw codedError('CREDENTIALS_REQUIRED', 'regional source credentials required');
      }

      const modeStatus = {};
      const vehicles = [];
      let availableModes = 0;
      for (let index = 0; index < MODES.length; index += 1) {
        const mode = MODES[index];
        const result = settled[index];
        if (result.status === 'rejected') {
          modeStatus[mode] = { status: 'unavailable' };
          continue;
        }
        availableModes += 1;
        const { snapshot, forceStale } = result.value;
        const state = snapshotState(snapshot, now(), forceStale);
        if (!state) {
          modeStatus[mode] = { status: 'unavailable' };
          continue;
        }
        modeStatus[mode] = {
          status: state.status,
          feedTimestamp: snapshot.feedTimestamp,
          feedAgeSeconds: state.ageSeconds,
        };
        for (const vehicle of snapshot.vehicles) {
          if (vehicles.length >= maxFeatures) break;
          if (!inBounds(vehicle, bbox)) continue;
          vehicles.push({
            ...vehicle,
            feedAgeSeconds: state.ageSeconds,
            stale: state.stale,
          });
        }
      }
      if (availableModes === 0) throw codedError('ALL_MODES_FAILED', 'regional transport source is unavailable');
      return { vehicles, modeStatus };
    },
  });
}
