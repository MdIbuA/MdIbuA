'use strict';

/** A baseline valid profile; override fields per test. */
function makeProfile(overrides = {}) {
  return {
    city: 'Delhi',
    householdSize: 4,
    hasChildren: false,
    hasElderly: false,
    hasRespiratoryCondition: false,
    isPregnant: false,
    commuteMode: 'public_transport',
    commuteKm: 10,
    heating: 'none',
    cooking: 'lpg_png',
    hasAirPurifier: false,
    outdoorActivity: 'moderate',
    question: '',
    manualAqi: null,
    ...overrides,
  };
}

/** Realistic Open-Meteo air-quality payload for a smoggy winter day. */
function makeAirQualityPayload() {
  const time = [];
  const pm25 = [];
  const aqi = [];
  for (let h = 0; h < 24; h += 1) {
    time.push(`2026-11-23T${String(h).padStart(2, '0')}:00`);
    // Afternoon dip (14-15h cleanest), night peak.
    const value = h >= 13 && h <= 16 ? 90 - (h === 14 || h === 15 ? 30 : 0) : 220 + (h >= 20 ? 40 : 0);
    pm25.push(value);
    aqi.push(Math.min(500, Math.round(value * 1.4)));
  }
  return {
    current: { time: '2026-11-23T10:00', us_aqi: 312, pm2_5: 240.4, pm10: 380, nitrogen_dioxide: 60, ozone: 12 },
    hourly: { time, pm2_5: pm25, us_aqi: aqi },
  };
}

/** Fake fetch routing geocode/air-quality URLs to canned responses. */
function makeFetch({ geocode, air, fail = false } = {}) {
  const calls = [];
  const fetchImpl = async (url) => {
    calls.push(url);
    if (fail) throw new Error('network down');
    const body = url.includes('geocoding')
      ? geocode ?? { results: [{ name: 'Delhi', admin1: 'Delhi', country: 'India', latitude: 28.6519, longitude: 77.2315, timezone: 'Asia/Kolkata' }] }
      : air ?? makeAirQualityPayload();
    return { ok: true, status: 200, json: async () => body };
  };
  return { fetchImpl, calls };
}

const silentLogger = { warn() {}, error() {}, log() {} };

module.exports = { makeProfile, makeAirQualityPayload, makeFetch, silentLogger };
