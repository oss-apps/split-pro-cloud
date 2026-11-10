import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { filterBalances } from './balanceSearch';

// Only the name and email are read; keep the fixture independent of server profile fields.
const balances = [
  { friend: { name: 'Alice', email: 'alice@example.com' } },
  { friend: { name: null, email: 'bob@example.com' } },
  { friend: { name: null, email: null } },
] as Parameters<typeof filterBalances>[0];

describe('filterBalances', () => {
  it('should match names without case or surrounding whitespace', () => {
    assert.deepEqual(filterBalances(balances, ' ALICE '), [balances[0]]);
  });

  it('should search email when the name is missing', () => {
    assert.deepEqual(filterBalances(balances, 'BOB@'), [balances[1]]);
  });

  it('should preserve all balances and their order when search is cleared', () => {
    assert.deepEqual(filterBalances(balances, '   '), balances);
  });

  it('should return no results safely with missing profile fields', () => {
    assert.deepEqual(filterBalances(balances, 'nobody'), []);
    assert.deepEqual(filterBalances([], 'alice'), []);
  });
});
