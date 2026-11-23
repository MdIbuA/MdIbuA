'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { validateProfile, validateCity, cleanText } = require('../src/utils/validation');

test('validateProfile normalises a minimal valid body with defaults', () => {
  const profile = validateProfile({ city: '  New   Delhi ' });
  assert.equal(profile.city, 'New Delhi');
  assert.equal(profile.householdSize, 1);
  assert.equal(profile.commuteMode, 'public_transport');
  assert.equal(profile.heating, 'none');
  assert.equal(profile.manualAqi, null);
  assert.equal(profile.hasChildren, false);
});

test('validateProfile coerces checkbox-style booleans', () => {
  const profile = validateProfile({ city: 'Lahore', hasChildren: 'on', hasElderly: 'true', isPregnant: false });
  assert.equal(profile.hasChildren, true);
  assert.equal(profile.hasElderly, true);
  assert.equal(profile.isPregnant, false);
});

test('validateProfile drops unknown fields (allow-list)', () => {
  const profile = validateProfile({ city: 'Kraków', __proto__polluted: 'x', role: 'admin' });
  assert.equal(Object.hasOwn(profile, 'role'), false);
  assert.equal(Object.hasOwn(profile, '__proto__polluted'), false);
});

test('validateProfile rejects bad enums and out-of-range numbers with details', () => {
  assert.throws(
    () => validateProfile({ city: 'Delhi', commuteMode: 'rocket', householdSize: 99, commuteKm: -5, manualAqi: 900 }),
    (error) => {
      assert.equal(error.status, 400);
      assert.equal(error.details.length, 4);
      return true;
    },
  );
});

test('validateProfile forces commute distance to 0 for work-from-home', () => {
  const profile = validateProfile({ city: 'Delhi', commuteMode: 'work_from_home', commuteKm: 30 });
  assert.equal(profile.commuteKm, 0);
});

test('validateProfile enforces question length limit', () => {
  assert.throws(() => validateProfile({ city: 'Delhi', question: 'a'.repeat(501) }), /Invalid input/);
});

test('validateProfile rejects non-object bodies', () => {
  assert.throws(() => validateProfile(null), /JSON object/);
  assert.throws(() => validateProfile([1, 2]), /JSON object/);
});

test('validateCity accepts non-Latin scripts and rejects markup / missing values', () => {
  assert.equal(validateCity('दिल्ली'), 'दिल्ली');
  assert.equal(validateCity("Xi'an"), "Xi'an");
  assert.throws(() => validateCity('<script>alert(1)</script>'), /unsupported/);
  assert.throws(() => validateCity(''), /provide a city/);
  assert.throws(() => validateCity(undefined), /provide a city/);
  assert.throws(() => validateCity('a'.repeat(81)), /too long/);
});

test('cleanText strips control characters', () => {
  assert.equal(cleanText('hi\u0000\nthere\t'), 'hi there');
});
