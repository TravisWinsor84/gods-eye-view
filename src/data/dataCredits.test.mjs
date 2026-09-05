import test from 'node:test';
import assert from 'node:assert/strict';

import { DATA_CREDITS } from './dataCredits.js';

test('registers the exact Public Transport Victoria CC BY 4.0 credit in the attribution surface', () => {
  const credit = DATA_CREDITS.find(({ key }) => key === 'ptv-transit');
  assert.ok(credit);
  assert.equal(
    credit.html,
    'Source: Licensed from Public Transport Victoria under a Creative Commons Attribution 4.0 International Licence.',
  );
});

test('registers exact GA and incorporated G-NAF credits for regional reference sources', () => {
  const byKey = new Map(DATA_CREDITS.map((credit) => [credit.key, credit.html]));
  assert.equal(
    byKey.get('au-emergency-facilities'),
    '© Commonwealth of Australia (Geoscience Australia) 2023. This material is released under the Creative Commons Attribution 4.0 International Licence. Incorporates or developed using G-NAF © Geoscape Australia licensed by the Commonwealth of Australia under the Open Geo-coded National Address File (G-NAF) End User Licence Agreement.',
  );
  assert.equal(
    byKey.get('au-health-facilities'),
    '© Commonwealth of Australia (Geoscience Australia) 2025\nThis material is released under the Creative Commons Attribution 4.0 International Licence.\n\nIncorporates or developed using G-NAF © Geoscape Australia licensed by the Commonwealth of Australia under the Open Geo-coded National Address File (G-NAF) End User Licence Agreement.',
  );
  assert.equal(byKey.get('au-place-names'), 'Geoscience Australia');
});
