'use strict';

const { AppError } = require('./errors');

/** Allowed enum values. Anything else is rejected rather than coerced. */
const ENUMS = Object.freeze({
  commuteMode: ['car_petrol', 'car_diesel', 'two_wheeler', 'public_transport', 'walk_cycle', 'work_from_home'],
  heating: ['wood_coal', 'kerosene', 'gas', 'electric', 'heat_pump', 'none'],
  cooking: ['biomass', 'kerosene', 'lpg_png', 'electric'],
  outdoorActivity: ['low', 'moderate', 'high'],
});

const LIMITS = Object.freeze({
  cityMaxLength: 80,
  questionMaxLength: 500,
  householdSize: [1, 20],
  commuteKm: [0, 200],
  aqi: [0, 500],
});

// Letters (any script), spaces and common punctuation found in place names.
const CITY_PATTERN = /^[\p{L}\p{M}][\p{L}\p{M}\s.,'-]*$/u;

/** Strip control characters and collapse whitespace. */
function cleanText(value) {
  return String(value)
    .replace(/[\u0000-\u001F\u007F]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function toBool(value) {
  return value === true || value === 'true' || value === 'on' || value === 1 || value === '1';
}

function toNumberInRange(value, [min, max], field, errors) {
  if (value === undefined || value === null || value === '') return min;
  const num = Number(value);
  if (!Number.isFinite(num) || num < min || num > max) {
    errors.push(`${field} must be a number between ${min} and ${max}.`);
    return min;
  }
  return num;
}

function pickEnum(value, field, fallback, errors) {
  if (value === undefined || value === null || value === '') return fallback;
  if (!ENUMS[field].includes(value)) {
    errors.push(`${field} must be one of: ${ENUMS[field].join(', ')}.`);
    return fallback;
  }
  return value;
}

/**
 * Validates a city name for the geocoder.
 * @returns {string}
 */
function validateCity(raw) {
  const city = cleanText(raw ?? '');
  if (!city) throw new AppError('Please provide a city or town name.');
  if (city.length > LIMITS.cityMaxLength || !CITY_PATTERN.test(city)) {
    throw new AppError('City name contains unsupported characters or is too long.');
  }
  return city;
}

/**
 * Validates and normalises the household profile sent by the client.
 * Unknown fields are dropped (allow-list), so nothing unexpected reaches
 * the rule engine or the LLM prompt.
 */
function validateProfile(body) {
  if (!body || typeof body !== 'object' || Array.isArray(body)) {
    throw new AppError('Request body must be a JSON object.');
  }
  const errors = [];
  let city;
  try {
    city = validateCity(body.city);
  } catch (error) {
    errors.push(error.message);
  }

  const question = body.question ? cleanText(body.question) : '';
  if (question.length > LIMITS.questionMaxLength) {
    errors.push(`question must be at most ${LIMITS.questionMaxLength} characters.`);
  }

  const profile = {
    city,
    householdSize: Math.round(toNumberInRange(body.householdSize, LIMITS.householdSize, 'householdSize', errors)),
    hasChildren: toBool(body.hasChildren),
    hasElderly: toBool(body.hasElderly),
    hasRespiratoryCondition: toBool(body.hasRespiratoryCondition),
    isPregnant: toBool(body.isPregnant),
    commuteMode: pickEnum(body.commuteMode, 'commuteMode', 'public_transport', errors),
    commuteKm: toNumberInRange(body.commuteKm, LIMITS.commuteKm, 'commuteKm', errors),
    heating: pickEnum(body.heating, 'heating', 'none', errors),
    cooking: pickEnum(body.cooking, 'cooking', 'lpg_png', errors),
    hasAirPurifier: toBool(body.hasAirPurifier),
    outdoorActivity: pickEnum(body.outdoorActivity, 'outdoorActivity', 'moderate', errors),
    question,
    // Optional manual AQI override, used when live data is unavailable.
    manualAqi:
      body.manualAqi === undefined || body.manualAqi === null || body.manualAqi === ''
        ? null
        : Math.round(toNumberInRange(body.manualAqi, LIMITS.aqi, 'manualAqi', errors)),
  };

  if (profile.commuteMode === 'work_from_home') profile.commuteKm = 0;
  if (errors.length) throw new AppError('Invalid input.', 400, errors);
  return profile;
}

module.exports = { validateProfile, validateCity, cleanText, ENUMS, LIMITS };
