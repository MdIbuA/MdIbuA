'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { TtlCache } = require('../src/utils/cache');

test('TtlCache returns values until they expire', () => {
  let now = 0;
  const cache = new TtlCache({ ttlMs: 100, now: () => now });
  cache.set('a', 1);
  assert.equal(cache.get('a'), 1);
  now = 150;
  assert.equal(cache.get('a'), undefined);
});

test('TtlCache evicts least recently used entry when full', () => {
  const cache = new TtlCache({ ttlMs: 1000, maxEntries: 2 });
  cache.set('a', 1);
  cache.set('b', 2);
  cache.get('a'); // a is now most recent
  cache.set('c', 3);
  assert.equal(cache.get('b'), undefined);
  assert.equal(cache.get('a'), 1);
  assert.equal(cache.size, 2);
});

test('TtlCache.wrap de-duplicates concurrent producers and does not cache failures', async () => {
  const cache = new TtlCache({ ttlMs: 1000 });
  let calls = 0;
  const producer = async () => {
    calls += 1;
    return 'value';
  };
  const [a, b] = await Promise.all([cache.wrap('k', producer), cache.wrap('k', producer)]);
  assert.equal(a, 'value');
  assert.equal(b, 'value');
  assert.equal(calls, 1);

  await assert.rejects(cache.wrap('bad', async () => { throw new Error('boom'); }), /boom/);
  assert.equal(cache.get('bad'), undefined);
});
