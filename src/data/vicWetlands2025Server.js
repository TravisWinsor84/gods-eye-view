import { lstat, readFile, realpath } from 'node:fs/promises';
import path from 'node:path';
import { queryVicWetlands2025Index } from './vicWetlands2025Index.js';

const MAX_INDEX_BYTES = 2 * 1024 * 1024;
const MAX_CELL_BYTES = 16 * 1024 * 1024;
const CELL_PATH = /^cells\/[0-9]{3}-[0-9]{3}\.geojson$/;

function codedError(message, code = 'ARTIFACT_UNAVAILABLE') {
  const error = new Error(message);
  error.code = code;
  return error;
}

async function boundedRegularFile(filePath, maxBytes) {
  let stats;
  try {
    stats = await lstat(filePath);
  } catch {
    throw codedError('wetlands artifact is unavailable');
  }
  if (!stats.isFile() || stats.isSymbolicLink() || stats.size < 1 || stats.size > maxBytes) {
    throw codedError('wetlands artifact is invalid', 'INVALID_ARTIFACT');
  }
  return readFile(filePath);
}

/** Serve a reviewed, generated 2025 wetlands release from a fixed local directory. */
export function createVicWetlands2025Server({ dataDir } = {}) {
  const configuredDir = String(dataDir || '').trim();
  let releasePromise = null;

  async function release() {
    if (!configuredDir) throw codedError('wetlands artifact is unavailable');
    if (!releasePromise) {
      releasePromise = (async () => {
        const root = await realpath(configuredDir).catch(() => { throw codedError('wetlands artifact is unavailable'); });
        const bytes = await boundedRegularFile(path.join(root, 'index.json'), MAX_INDEX_BYTES);
        let index;
        try {
          index = JSON.parse(bytes.toString('utf8'));
        } catch {
          throw codedError('wetlands index is invalid', 'INVALID_ARTIFACT');
        }
        return { root, index };
      })().catch((error) => {
        releasePromise = null;
        throw error;
      });
    }
    return releasePromise;
  }

  return Object.freeze({
    async load({ bbox, maxFeatures }) {
      const { root, index } = await release();
      let result;
      try {
        result = await queryVicWetlands2025Index({
          index,
          bbox,
          maxFeatures,
          loadCell: async (cell) => {
            if (!CELL_PATH.test(String(cell?.path || ''))) {
              throw codedError('wetlands cell path is invalid', 'INVALID_ARTIFACT');
            }
            const filePath = path.resolve(root, cell.path);
            if (!filePath.startsWith(`${root}${path.sep}`)) {
              throw codedError('wetlands cell path is invalid', 'INVALID_ARTIFACT');
            }
            return boundedRegularFile(filePath, MAX_CELL_BYTES);
          },
        });
      } catch (error) {
        if (error?.code) throw error;
        throw codedError('wetlands artifact is invalid', 'INVALID_ARTIFACT');
      }
      return {
        ...result,
        sourceStatus: {
          status: 'current',
          cache: 'local-release',
          observedAt: '2025-03-20T00:00:00.000Z',
          edition: '2025',
          capped: false,
          caveat: 'Mapped inventory reference only; not live water extent, flood extent, access advice, or proof that water is present.',
        },
      };
    },
  });
}
