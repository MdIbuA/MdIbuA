'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const engine = require('../src/services/recommendationEngine');
const { makeProfile } = require('./helpers');

const ids = (items) => items.map((i) => i.id);

test('classifyAqi maps US AQI breakpoints to bands', () => {
  assert.equal(engine.classifyAqi(0).label, 'Good');
  assert.equal(engine.classifyAqi(50).label, 'Good');
  assert.equal(engine.classifyAqi(51).label, 'Moderate');
  assert.equal(engine.classifyAqi(151).label, 'Unhealthy');
  assert.equal(engine.classifyAqi(301).label, 'Hazardous');
  assert.equal(engine.classifyAqi(-10).label, 'Good');
  assert.equal(engine.classifyAqi('not a number').label, 'Good');
});

test('sensitive households are treated one band higher', () => {
  const healthy = engine.assessRisk(makeProfile(), 120);
  const sensitive = engine.assessRisk(makeProfile({ hasChildren: true, hasRespiratoryCondition: true }), 120);
  assert.equal(sensitive.effectiveLevel, healthy.effectiveLevel + 1);
  assert.ok(sensitive.personalRiskScore > healthy.personalRiskScore);
  assert.deepEqual(sensitive.sensitiveGroups, ['children', 'people with asthma/heart or lung conditions']);
});

test('severe indoor combustion raises risk even on a clean day', () => {
  const clean = engine.assessRisk(makeProfile(), 30);
  const coal = engine.assessRisk(makeProfile({ heating: 'wood_coal' }), 30);
  assert.equal(coal.effectiveLevel, clean.effectiveLevel + 1);
});

test('risk score is capped at 100', () => {
  const risk = engine.assessRisk(makeProfile({ hasChildren: true, heating: 'wood_coal', outdoorActivity: 'high' }), 500);
  assert.equal(risk.personalRiskScore, 100);
  assert.equal(risk.effectiveLevel, 5);
});

test('car commuters get a quantified transit swap', () => {
  const profile = makeProfile({ commuteMode: 'car_petrol', commuteKm: 15 });
  const plan = engine.buildPlan(profile, { aqi: 180 });
  const swap = plan.alternatives.find((a) => a.id === 'car-to-transit');
  assert.ok(swap);
  // 15 km × 2 trips × 5 days = 150 km/week; (0.17 - 0.03) × 150 = 21 kg
  assert.equal(engine.weeklyCommuteKm(profile), 150);
  assert.equal(swap.impact.co2KgPerWeek, 21);
  assert.equal(swap.priority, 'high');
});

test('impact summary does not double count carpool and transit', () => {
  const plan = engine.buildPlan(makeProfile({ commuteMode: 'car_petrol', commuteKm: 15 }), { aqi: 80 });
  assert.ok(ids(plan.alternatives).includes('carpool'));
  assert.equal(plan.impactSummary.co2KgPerWeek, 21);
  assert.equal(plan.impactSummary.co2KgPerYear, 1092);
  assert.equal(plan.impactSummary.treeEquivalent, 50);
});

test('walkers and WFH households get no commute swap', () => {
  for (const commuteMode of ['walk_cycle', 'work_from_home']) {
    const plan = engine.buildPlan(makeProfile({ commuteMode, commuteKm: commuteMode === 'work_from_home' ? 0 : 5 }), { aqi: 250 });
    assert.equal(ids(plan.alternatives).includes('car-to-transit'), false);
    assert.equal(ids(plan.alternatives).includes('bike-to-transit'), false);
  }
});

test('WFH suggestion appears only on unhealthy days for commuters', () => {
  const moderate = engine.buildPlan(makeProfile({ commuteMode: 'car_diesel' }), { aqi: 90 });
  const severe = engine.buildPlan(makeProfile({ commuteMode: 'car_diesel' }), { aqi: 260 });
  assert.equal(ids(moderate.alternatives).includes('wfh-peak-days'), false);
  const wfh = severe.alternatives.find((a) => a.id === 'wfh-peak-days');
  assert.equal(wfh.priority, 'high');
});

test('solid-fuel heating and cooking trigger high-priority clean-fuel swaps', () => {
  const plan = engine.buildPlan(makeProfile({ heating: 'wood_coal', cooking: 'biomass' }), { aqi: 200 });
  const heating = plan.alternatives.find((a) => a.id === 'clean-heating');
  const cooking = plan.alternatives.find((a) => a.id === 'clean-cooking');
  assert.equal(heating.priority, 'high');
  assert.equal(heating.impact.co2KgPerWeek, 29);
  assert.equal(cooking.priority, 'high');
  // Night routine warns about carbon monoxide.
  const night = plan.routine.find((slot) => slot.slot.startsWith('Night'));
  assert.ok(night.actions.some((a) => a.includes('carbon-monoxide')));
});

test('indoor hacks adapt to purifier ownership and are priority-sorted', () => {
  const without = engine.buildPlan(makeProfile(), { aqi: 220 });
  const withPurifier = engine.buildPlan(makeProfile({ hasAirPurifier: true }), { aqi: 220 });
  assert.equal(without.indoorHacks[0].id, 'diy-filter-fan');
  assert.equal(withPurifier.indoorHacks[0].id, 'purifier-placement');
  const order = { high: 0, medium: 1, low: 2 };
  const ranks = without.indoorHacks.map((h) => order[h.priority]);
  assert.deepEqual(ranks, [...ranks].sort((a, b) => a - b));
});

test('routine uses the forecast cleanest window and moves exercise indoors on bad days', () => {
  const forecast = { cleanestWindow: { start: '2026-11-23T14:00', end: '2026-11-23T15:00', meanPm25: 60 } };
  const plan = engine.buildPlan(makeProfile({ outdoorActivity: 'high' }), { aqi: 210, forecast });
  const daytime = plan.routine.find((slot) => slot.slot.startsWith('Daytime'));
  assert.ok(daytime.actions.some((a) => a.includes('14:00–15:00')));
  assert.ok(daytime.actions.some((a) => a.includes('Move exercise indoors')));
});

test('masks are recommended for sensitive groups from USG level, and not on good days', () => {
  const usgSensitive = engine.buildPlan(makeProfile({ hasElderly: true }), { aqi: 120 });
  const good = engine.buildPlan(makeProfile(), { aqi: 30 });
  assert.ok(usgSensitive.routine[0].actions.some((a) => a.includes('N95/FFP2')));
  assert.ok(good.routine[0].actions.some((a) => a.includes('Masks are optional')));
});

test('every recommendation carries an impact explanation', () => {
  const plan = engine.buildPlan(makeProfile({ commuteMode: 'two_wheeler', heating: 'kerosene', cooking: 'kerosene' }), { aqi: 260 });
  for (const item of [...plan.indoorHacks, ...plan.alternatives]) {
    assert.equal(typeof item.impact.explanation, 'string', item.id);
    assert.ok(item.impact.explanation.length > 10, item.id);
    assert.ok(['high', 'medium', 'low'].includes(item.priority), item.id);
  }
});
