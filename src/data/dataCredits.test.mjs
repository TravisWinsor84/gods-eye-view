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
