'use strict';

/**
 * Reference data used by the rule engine. Values are deliberately rounded,
 * published-average figures; see README "Assumptions" for sources/caveats.
 */

/** US EPA AQI bands (Open-Meteo reports US AQI). */
const AQI_BANDS = Object.freeze([
  { max: 50, level: 0, label: 'Good', color: '#2e7d32' },
  { max: 100, level: 1, label: 'Moderate', color: '#8d6e00' },
  { max: 150, level: 2, label: 'Unhealthy for Sensitive Groups', color: '#c25e00' },
  { max: 200, level: 3, label: 'Unhealthy', color: '#c62828' },
  { max: 300, level: 4, label: 'Very Unhealthy', color: '#6a1b9a' },
  { max: Infinity, level: 5, label: 'Hazardous', color: '#4a0e0e' },
]);

/**
 * Per passenger-km tailpipe estimates.
 * co2Kg: well-to-wheel-ish average CO2; pm25G: exhaust PM2.5 in grams.
 * exposure: relative in-transit PM2.5 exposure (walking next to traffic = 1).
 */
const COMMUTE = Object.freeze({
  car_petrol: { label: 'Petrol car', co2Kg: 0.17, pm25G: 0.005, exposure: 0.6 },
  car_diesel: { label: 'Diesel car', co2Kg: 0.16, pm25G: 0.03, exposure: 0.6 },
  two_wheeler: { label: 'Two-wheeler', co2Kg: 0.06, pm25G: 0.01, exposure: 1.0 },
  public_transport: { label: 'Bus / metro', co2Kg: 0.03, pm25G: 0.002, exposure: 0.5 },
  walk_cycle: { label: 'Walking / cycling', co2Kg: 0, pm25G: 0, exposure: 1.0 },
  work_from_home: { label: 'Work from home', co2Kg: 0, pm25G: 0, exposure: 0 },
});

/** Commute days per week and trips per day assumed for weekly totals. */
const COMMUTE_DAYS_PER_WEEK = 5;
const TRIPS_PER_DAY = 2;

/** Indoor combustion sources ranked by household PM2.5 contribution. */
const HEATING = Object.freeze({
  wood_coal: { label: 'Wood / coal stove or angithi', indoorRisk: 'severe', co2KgPerWeek: 35 },
  kerosene: { label: 'Kerosene heater', indoorRisk: 'high', co2KgPerWeek: 20 },
  gas: { label: 'Gas heater', indoorRisk: 'moderate', co2KgPerWeek: 15 },
  electric: { label: 'Electric heater', indoorRisk: 'none', co2KgPerWeek: 18 },
  heat_pump: { label: 'Heat pump / inverter AC', indoorRisk: 'none', co2KgPerWeek: 6 },
  none: { label: 'No heating', indoorRisk: 'none', co2KgPerWeek: 0 },
});

const COOKING = Object.freeze({
  biomass: { label: 'Wood / dung / crop-residue chulha', indoorRisk: 'severe' },
  kerosene: { label: 'Kerosene stove', indoorRisk: 'high' },
  lpg_png: { label: 'LPG / piped gas', indoorRisk: 'moderate' },
  electric: { label: 'Induction / electric', indoorRisk: 'low' },
});

/** Approximate CO2 absorbed by one mature tree per year (kg). */
const TREE_CO2_KG_PER_YEAR = 22;

/** Clean-air delivery rate target: air changes per hour for a purifier. */
const PURIFIER_TARGET_ACH = 5;
const TYPICAL_BEDROOM_M3 = 12 * 2.7; // 12 m² floor, 2.7 m ceiling

module.exports = {
  AQI_BANDS,
  COMMUTE,
  COMMUTE_DAYS_PER_WEEK,
  TRIPS_PER_DAY,
  HEATING,
  COOKING,
  TREE_CO2_KG_PER_YEAR,
  PURIFIER_TARGET_ACH,
  TYPICAL_BEDROOM_M3,
};
