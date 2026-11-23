'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { createAirQualityService, summariseHourly, findCleanestWindow } = require('../src/services/airQuality');
const { makeFetch, makeAirQualityPayload } = require('./helpers');

test('getAirQuality geocodes the city and returns a normalised reading', async () => {
  const { fetchImpl, calls } = makeFetch();
  const service = createAirQualityService({ fetchImpl });
  const result = await service.getAirQuality('Delhi');
  assert.equal(result.location.country, 'India');
  assert.equal(result.aqi, 312);
  assert.equal(result.pm25, 240.4);
  assert.equal(calls.length, 2);
  assert.match(calls[1], /latitude=28\.65&longitude=77\.23/);
});

test('results are cached: repeated lookups make no extra network calls', async () => {
  const { fetchImpl, calls } = makeFetch();
  const service = createAirQualityService({ fetchImpl });
  await service.getAirQuality('Delhi');
  await service.getAirQuality('delhi');
  assert.equal(calls.length, 2);
});

test('unknown places produce a 404 AppError', async () => {
  const { fetchImpl } = makeFetch({ geocode: { results: [] } });
  const service = createAirQualityService({ fetchImpl });
  await assert.rejects(service.getAirQuality('Atlantis'), (error) => error.status === 404);
});

test('network failures produce a 503 AppError', async () => {
  const { fetchImpl } = makeFetch({ fail: true });
  const service = createAirQualityService({ fetchImpl });
  await assert.rejects(service.getAirQuality('Delhi'), (error) => error.status === 503);
});

test('upstream HTTP errors and missing data produce 502', async () => {
  const badStatus = createAirQualityService({ fetchImpl: async () => ({ ok: false, status: 500, json: async () => ({}) }) });
  await assert.rejects(badStatus.getAirQuality('Delhi'), (error) => error.status === 502);
  const { fetchImpl } = makeFetch({ air: { current: {} } });
  await assert.rejects(createAirQualityService({ fetchImpl }).getAirQuality('Delhi'), (error) => error.status === 502);
});

test('summariseHourly finds the cleanest 2-hour daytime window and worst hour', () => {
  const { hourly, current } = makeAirQualityPayload();
  const summary = summariseHourly(hourly, current.time);
  assert.equal(summary.cleanestWindow.start, '2026-11-23T14:00');
  assert.equal(summary.cleanestWindow.end, '2026-11-23T15:00');
  assert.equal(summary.cleanestWindow.meanPm25, 60);
  assert.equal(summary.worstHour.pm25, 260);
  assert.equal(summary.hoursAnalysed, 17); // 06:00–22:00
});

test('summariseHourly and findCleanestWindow handle missing data', () => {
  assert.equal(summariseHourly(undefined), null);
  assert.equal(summariseHourly({ time: [] }), null);
  assert.equal(findCleanestWindow([{ time: 't', pm25: null }, { time: 't2', pm25: null }]), null);
});
