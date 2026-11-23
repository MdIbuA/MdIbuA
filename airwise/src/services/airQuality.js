'use strict';

const { TtlCache } = require('../utils/cache');
const { AppError } = require('../utils/errors');

const GEOCODE_URL = 'https://geocoding-api.open-meteo.com/v1/search';
const AIR_QUALITY_URL = 'https://air-quality-api.open-meteo.com/v1/air-quality';

/**
 * Fetches JSON with a hard timeout so a slow upstream never stalls a request.
 */
async function fetchJson(fetchImpl, url, timeoutMs) {
  let response;
  try {
    response = await fetchImpl(url, {
      signal: AbortSignal.timeout(timeoutMs),
      headers: { Accept: 'application/json' },
    });
  } catch {
    throw new AppError('Air quality provider is unreachable right now.', 503);
  }
  if (!response.ok) throw new AppError('Air quality provider returned an error.', 502);
  return response.json();
}

/**
 * Finds the contiguous window of `size` hours with the lowest mean PM2.5.
 * Returns null when not enough data exists.
 */
function findCleanestWindow(hours, size = 2) {
  let best = null;
  for (let i = 0; i + size <= hours.length; i += 1) {
    const slice = hours.slice(i, i + size);
    if (slice.some((h) => h.pm25 === null)) continue;
    const mean = slice.reduce((sum, h) => sum + h.pm25, 0) / size;
    if (!best || mean < best.meanPm25) {
      best = { start: slice[0].time, end: slice[size - 1].time, meanPm25: Math.round(mean) };
    }
  }
  return best;
}

/**
 * Turns the raw Open-Meteo hourly arrays into daytime insights: the cleanest
 * window to ventilate / exercise and the worst hours to avoid.
 */
function summariseHourly(hourly, currentTime) {
  if (!hourly || !Array.isArray(hourly.time)) return null;
  const today = (currentTime || hourly.time[0] || '').slice(0, 10);
  const hours = hourly.time
    .map((time, i) => ({
      time,
      hour: Number(time.slice(11, 13)),
      pm25: Number.isFinite(hourly.pm2_5?.[i]) ? hourly.pm2_5[i] : null,
      aqi: Number.isFinite(hourly.us_aqi?.[i]) ? hourly.us_aqi[i] : null,
    }))
    // Only waking hours of the current local day are actionable.
    .filter((h) => h.time.startsWith(today) && h.hour >= 6 && h.hour <= 22);

  if (!hours.length) return null;
  const valid = hours.filter((h) => h.pm25 !== null);
  const worst = valid.reduce((a, b) => (b.pm25 > a.pm25 ? b : a), valid[0]);
  return {
    cleanestWindow: findCleanestWindow(hours, 2),
    worstHour: worst ? { time: worst.time, pm25: Math.round(worst.pm25) } : null,
    hoursAnalysed: hours.length,
  };
}

/**
 * Air-quality service backed by the free, key-less Open-Meteo APIs.
 * `fetchImpl` is injectable so the service can be unit-tested offline.
 */
function createAirQualityService({ fetchImpl = globalThis.fetch, timeoutMs = 6000, geocodeTtlMs, airQualityTtlMs } = {}) {
  const geoCache = new TtlCache({ ttlMs: geocodeTtlMs || 86_400_000, maxEntries: 1000 });
  const aqCache = new TtlCache({ ttlMs: airQualityTtlMs || 900_000, maxEntries: 500 });

  async function geocode(city) {
    const key = city.toLowerCase();
    return geoCache.wrap(key, async () => {
      const url = `${GEOCODE_URL}?${new URLSearchParams({ name: city, count: '1', language: 'en', format: 'json' })}`;
      const data = await fetchJson(fetchImpl, url, timeoutMs);
      const place = data?.results?.[0];
      if (!place) throw new AppError(`Could not find a place called "${city}".`, 404);
      return {
        name: place.name,
        region: place.admin1 || '',
        country: place.country || '',
        latitude: place.latitude,
        longitude: place.longitude,
        timezone: place.timezone || 'auto',
      };
    });
  }

  async function getAirQuality(city) {
    const location = await geocode(city);
    // Round coordinates so nearby lookups share a cache entry (~1 km grid).
    const lat = location.latitude.toFixed(2);
    const lon = location.longitude.toFixed(2);
    const reading = await aqCache.wrap(`${lat},${lon}`, async () => {
      const params = new URLSearchParams({
        latitude: lat,
        longitude: lon,
        current: 'us_aqi,pm2_5,pm10,nitrogen_dioxide,ozone',
        hourly: 'pm2_5,us_aqi',
        forecast_days: '1',
        timezone: 'auto',
      });
      const data = await fetchJson(fetchImpl, `${AIR_QUALITY_URL}?${params}`, timeoutMs);
      const current = data?.current;
      if (!current || !Number.isFinite(current.us_aqi)) {
        throw new AppError('No air quality data is available for this location.', 502);
      }
      return {
        aqi: Math.round(current.us_aqi),
        pm25: current.pm2_5 ?? null,
        pm10: current.pm10 ?? null,
        no2: current.nitrogen_dioxide ?? null,
        ozone: current.ozone ?? null,
        observedAt: current.time,
        forecast: summariseHourly(data.hourly, current.time),
        source: 'Open-Meteo (CAMS)',
      };
    });
    return { location, ...reading };
  }

  return { geocode, getAirQuality };
}

module.exports = { createAirQualityService, summariseHourly, findCleanestWindow };
