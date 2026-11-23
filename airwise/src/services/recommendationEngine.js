'use strict';

const F = require('../data/factors');

/**
 * Deterministic decision engine. Given a validated household profile and an
 * air-quality reading it returns prioritised, explainable recommendations.
 *
 * The GenAI layer only *narrates* this output; every number shown to the user
 * originates here, so advice stays consistent, testable and auditable.
 */

const round1 = (n) => Math.round(n * 10) / 10;

/** Maps an AQI value to its band. */
function classifyAqi(aqi) {
  const value = Math.max(0, Number(aqi) || 0);
  return F.AQI_BANDS.find((band) => value <= band.max);
}

/** Lists the sensitive groups present in the household. */
function sensitiveGroups(profile) {
  const groups = [];
  if (profile.hasChildren) groups.push('children');
  if (profile.hasElderly) groups.push('older adults');
  if (profile.hasRespiratoryCondition) groups.push('people with asthma/heart or lung conditions');
  if (profile.isPregnant) groups.push('pregnancy');
  return groups;
}

/**
 * Personal risk: sensitive households are treated one AQI band higher, and
 * indoor combustion adds risk independent of outdoor air.
 */
function assessRisk(profile, aqi) {
  const band = classifyAqi(aqi);
  const groups = sensitiveGroups(profile);
  const isSensitive = groups.length > 0;
  const indoorSources = [F.HEATING[profile.heating].indoorRisk, F.COOKING[profile.cooking].indoorRisk];
  const indoorPenalty = indoorSources.includes('severe') ? 1 : 0;
  const effectiveLevel = Math.min(5, band.level + (isSensitive ? 1 : 0) + indoorPenalty);
  const score = Math.min(100, Math.round((effectiveLevel / 5) * 85 + (profile.outdoorActivity === 'high' ? 10 : 0) + (isSensitive ? 5 : 0)));
  return {
    aqi: Math.round(aqi),
    category: band.label,
    color: band.color,
    level: band.level,
    effectiveLevel,
    sensitiveGroups: groups,
    personalRiskScore: score,
    headline: buildHeadline(band, effectiveLevel, groups),
  };
}

function buildHeadline(band, effectiveLevel, groups) {
  const who = groups.length ? ` for a household with ${groups.join(', ')}` : '';
  if (effectiveLevel >= 4) return `Air is ${band.label.toLowerCase()} — treat today as a stay-indoors, clean-room day${who}.`;
  if (effectiveLevel === 3) return `Air is ${band.label.toLowerCase()} — limit time outside and protect indoor air${who}.`;
  if (effectiveLevel === 2) return `Air is ${band.label.toLowerCase()} — sensitive members should cut outdoor exertion${who}.`;
  return `Air is ${band.label.toLowerCase()} — a good day to ventilate and move actively${who}.`;
}

/** Formats an ISO local time ("2026-11-23T14:00") as "14:00". */
const hhmm = (iso) => (iso ? iso.slice(11, 16) : null);

function weeklyCommuteKm(profile) {
  return profile.commuteKm * F.TRIPS_PER_DAY * F.COMMUTE_DAYS_PER_WEEK;
}

/** Daily routine split by time of day, adapted to severity and forecast. */
function buildRoutine(profile, risk, forecast) {
  const lvl = risk.effectiveLevel;
  const window = forecast?.cleanestWindow;
  const windowText = window ? `${hhmm(window.start)}–${hhmm(window.end)}` : 'early afternoon (usually 13:00–16:00 in winter)';
  const needsMask = risk.level >= 3 || (risk.level >= 2 && risk.sensitiveGroups.length > 0);
  const routine = [];

  routine.push({
    slot: 'Morning (6–10)',
    actions: [
      lvl >= 2
        ? 'Skip dawn walks: winter temperature inversions trap smog close to the ground until mid-morning.'
        : 'Morning air is acceptable — a brisk walk is fine, ideally away from main roads.',
      needsMask
        ? 'Anyone stepping out (school run, commute) wears a well-fitted N95/FFP2 mask; cloth and surgical masks block little PM2.5.'
        : 'Masks are optional today; keep N95s handy for traffic-heavy stretches.',
      'Keep windows shut until the cleanest window of the day.',
    ],
  });

  const commute = F.COMMUTE[profile.commuteMode];
  const midday = [`Open windows for 10–15 minutes around ${windowText}, when PM2.5 is forecast to be lowest, then close them.`];
  if (profile.commuteMode !== 'work_from_home') {
    midday.push(
      profile.commuteMode.startsWith('car')
        ? 'In the car, set ventilation to recirculate and keep windows up in traffic.'
        : `On your ${commute.label.toLowerCase()} commute, prefer side streets/park routes — PM2.5 drops sharply even 50–100 m from busy roads.`,
    );
  }
  if (profile.outdoorActivity !== 'low') {
    midday.push(
      lvl >= 3
        ? 'Move exercise indoors today (yoga, stair climbing, home workouts).'
        : `If exercising outdoors, do it during ${windowText} at moderate intensity.`,
    );
  }
  routine.push({ slot: 'Daytime (10–17)', actions: midday });

  const evening = ['Pollution rises again after sunset as the air cools and traffic peaks — keep windows closed.'];
  evening.push(
    profile.cooking === 'biomass' || profile.cooking === 'kerosene'
      ? 'Cook with doors to living rooms shut and the kitchen window open or exhaust running; keep children out of the kitchen.'
      : 'Run the kitchen exhaust/chimney while cooking and 10 minutes after — frying and gas burners spike indoor PM2.5.',
  );
  evening.push('Avoid incense, mosquito coils and candles — each is a strong indoor PM2.5 source.');
  routine.push({ slot: 'Evening (17–21)', actions: evening });

  routine.push({
    slot: 'Night (21–6)',
    actions: [
      profile.hasAirPurifier
        ? 'Run the purifier on high in the bedroom with the door closed for 30 minutes before sleep, then on auto/low.'
        : 'Make the bedroom the "clean room": seal gaps around the door/window and run a DIY filter fan (see indoor hacks).',
      profile.heating === 'wood_coal' || profile.heating === 'kerosene'
        ? 'Never sleep with a coal/wood/kerosene heater burning in a closed room — besides PM2.5 it can cause fatal carbon-monoxide build-up.'
        : 'Keep heating electric where possible; layer bedding instead of raising heater use.',
    ],
  });

  return routine;
}

/** Indoor air-quality hacks with explained impact, ordered by priority. */
function buildIndoorHacks(profile, risk) {
  const hacks = [];
  const lvl = risk.effectiveLevel;
  const cadr = Math.round(F.TYPICAL_BEDROOM_M3 * F.PURIFIER_TARGET_ACH);

  if (profile.hasAirPurifier) {
    hacks.push({
      id: 'purifier-placement',
      title: 'Get more out of your purifier',
      detail: `Run it in one closed room rather than the whole house, keep it 30 cm from walls, and check the HEPA filter monthly in smog season. For a 12 m² bedroom you need a CADR of about ${cadr} m³/h.`,
      priority: lvl >= 2 ? 'high' : 'medium',
      impact: { kind: 'exposure', exposureReductionPct: [50, 80], explanation: 'A correctly sized HEPA purifier in a closed room typically removes half to four-fifths of indoor PM2.5.' },
    });
  } else {
    hacks.push({
      id: 'diy-filter-fan',
      title: 'Build a DIY filter fan (box fan + MERV-13 filter)',
      detail: `Strap a MERV-13/HEPA-grade filter to the intake side of a box or table fan. It costs a fraction of a purifier and delivers roughly the ${cadr} m³/h CADR a 12 m² bedroom needs.`,
      priority: lvl >= 2 ? 'high' : 'medium',
      impact: { kind: 'exposure', exposureReductionPct: [40, 70], explanation: 'Independent tests of DIY filter fans show indoor PM2.5 reductions comparable to entry-level purifiers in a closed room.' },
    });
  }

  hacks.push({
    id: 'seal-gaps',
    title: 'Seal the clean room',
    detail: 'Use foam weather-strips or a rolled towel on window and door gaps of the room where sensitive members spend most time.',
    priority: lvl >= 3 ? 'high' : 'medium',
    impact: { kind: 'exposure', exposureReductionPct: [10, 30], explanation: 'Less infiltration means your filter works on clean recirculated air instead of fresh smog.' },
  });

  hacks.push({
    id: 'smart-ventilation',
    title: 'Ventilate by the forecast, not by habit',
    detail: 'Air out the home briefly during the cleanest forecast window shown above, then close up. Short bursts avoid CO₂ and moisture build-up without importing peak smog.',
    priority: 'medium',
    impact: { kind: 'exposure', exposureReductionPct: [10, 25], explanation: 'Shifting ventilation from peak to off-peak hours cuts the PM2.5 you let in.' },
  });

  hacks.push({
    id: 'wet-cleaning',
    title: 'Wet-mop and damp-dust instead of sweeping',
    detail: 'Dry sweeping re-suspends settled fine dust. A damp cloth and mop trap it.',
    priority: 'low',
    impact: { kind: 'exposure', exposureReductionPct: [5, 10], explanation: 'Reduces re-suspended indoor dust, especially near floor level where children play.' },
  });

  hacks.push({
    id: 'no-indoor-smoke',
    title: 'Cut indoor smoke sources',
    detail: 'Swap incense sticks, dhoop, mosquito coils and candles for electric diffusers / mosquito nets. Never smoke indoors.',
    priority: 'medium',
    impact: { kind: 'exposure', exposureReductionPct: [10, 40], explanation: 'One burning mosquito coil can release as much PM2.5 as dozens of cigarettes.' },
  });

  hacks.push({
    id: 'plants-myth',
    title: 'Myth check: house plants will not clean smog',
    detail: 'You would need hundreds of plants per room to match one filter. Keep plants for wellbeing, but rely on filtration for PM2.5.',
    priority: 'low',
    impact: { kind: 'awareness', exposureReductionPct: null, explanation: 'Avoids spending money on solutions that do not measurably reduce PM2.5.' },
  });

  const order = { high: 0, medium: 1, low: 2 };
  return hacks.sort((a, b) => order[a.priority] - order[b.priority]);
}

/** Sustainable swaps with quantified emissions and exposure impact. */
function buildAlternatives(profile, risk) {
  const alternatives = [];
  const weeklyKm = weeklyCommuteKm(profile);
  const current = F.COMMUTE[profile.commuteMode];

  const swapTo = (targetKey, title, detail, share = 1) => {
    const target = F.COMMUTE[targetKey];
    const co2 = round1((current.co2Kg - target.co2Kg) * weeklyKm * share);
    const pm = round1((current.pm25G - target.pm25G) * weeklyKm * share);
    return { co2, pm, title, detail };
  };

  if (weeklyKm > 0 && profile.commuteMode.startsWith('car')) {
    const s = swapTo(
      'public_transport',
      'Switch your car commute to metro/bus',
      `Your ${weeklyKm} km/week car commute is the single largest emission lever you control.`,
    );
    alternatives.push({
      id: 'car-to-transit',
      title: s.title,
      detail: s.detail,
      priority: 'high',
      impact: {
        kind: 'emissions',
        co2KgPerWeek: s.co2,
        pm25GramsPerWeek: s.pm,
        explanation: `Saves about ${s.co2} kg CO₂ and ${s.pm} g of exhaust PM2.5 every week — and enclosed metro cars usually expose you to less PM2.5 than traffic.`,
      },
    });
    const carpoolCo2 = round1(current.co2Kg * weeklyKm * 0.5);
    alternatives.push({
      id: 'carpool',
      title: 'Carpool with one colleague or neighbour',
      detail: 'If transit is impractical, sharing the ride halves your per-person emissions.',
      priority: 'medium',
      impact: { kind: 'emissions', co2KgPerWeek: carpoolCo2, pm25GramsPerWeek: round1(current.pm25G * weeklyKm * 0.5), explanation: `Cuts about ${carpoolCo2} kg CO₂ per week from your share of the trip.` },
    });
  }

  if (weeklyKm > 0 && profile.commuteMode === 'two_wheeler') {
    const s = swapTo('public_transport', 'Use metro/bus on high-smog days', 'Riders breathe traffic exhaust directly; enclosed transit lowers both exposure and emissions.', 0.6);
    alternatives.push({
      id: 'bike-to-transit',
      title: s.title,
      detail: s.detail,
      priority: risk.level >= 3 ? 'high' : 'medium',
      impact: { kind: 'both', co2KgPerWeek: s.co2, pm25GramsPerWeek: s.pm, exposureReductionPct: [30, 50], explanation: `Switching on 3 of 5 days saves ~${s.co2} kg CO₂/week and roughly halves your in-transit PM2.5 dose.` },
    });
  }

  if (weeklyKm > 0 && risk.level >= 3 && profile.commuteMode !== 'work_from_home') {
    const perDayCo2 = round1(current.co2Kg * profile.commuteKm * F.TRIPS_PER_DAY);
    alternatives.push({
      id: 'wfh-peak-days',
      title: 'Work or study from home on "Very Unhealthy" days',
      detail: 'Ask your employer/school for a smog-day remote policy — many cities issue advisories for exactly this.',
      priority: risk.level >= 4 ? 'high' : 'medium',
      impact: { kind: 'both', co2KgPerWeek: perDayCo2, exposureReductionPct: [20, 40], explanation: `Each skipped trip day avoids ~${perDayCo2} kg CO₂ and your highest-exposure hours outdoors.` },
    });
  }

  const heating = F.HEATING[profile.heating];
  if (profile.heating === 'wood_coal' || profile.heating === 'kerosene') {
    const co2 = round1(heating.co2KgPerWeek - F.HEATING.heat_pump.co2KgPerWeek);
    alternatives.push({
      id: 'clean-heating',
      title: 'Replace combustion heating with an inverter AC/heat pump or electric heater',
      detail: `${heating.label}s are among the largest household PM2.5 sources and add to neighbourhood smog. Insulate first (door snakes, curtains, rugs) to need less heat.`,
      priority: 'high',
      impact: { kind: 'both', co2KgPerWeek: co2, exposureReductionPct: [60, 90], explanation: `Removes an in-home combustion source (indoor PM2.5 down by up to ~60–90%) and saves around ${co2} kg CO₂ per week.` },
    });
  } else if (profile.heating === 'electric') {
    const co2 = round1(heating.co2KgPerWeek - F.HEATING.heat_pump.co2KgPerWeek);
    alternatives.push({
      id: 'heat-pump',
      title: 'Use an inverter AC in heat mode instead of a resistive heater',
      detail: 'Heat pumps deliver 3–4 units of heat per unit of electricity.',
      priority: 'low',
      impact: { kind: 'emissions', co2KgPerWeek: co2, explanation: `Roughly a third of the electricity, saving ~${co2} kg CO₂ per week from power-plant emissions.` },
    });
  }

  if (profile.cooking === 'biomass' || profile.cooking === 'kerosene') {
    alternatives.push({
      id: 'clean-cooking',
      title: 'Move to LPG/PNG or induction cooking',
      detail: 'Check eligibility for subsidised LPG connections (e.g. PMUY in India) or use an induction plate for everyday cooking.',
      priority: 'high',
      impact: { kind: 'exposure', exposureReductionPct: [50, 80], explanation: 'Solid-fuel and kerosene cooking is the leading cause of household air pollution deaths worldwide (WHO); clean fuels cut kitchen PM2.5 by more than half.' },
    });
  }

  alternatives.push({
    id: 'no-burning',
    title: 'Never burn leaves, waste or crop residue — compost it',
    detail: 'Join or start a resident-welfare composting drive and report open burning to the local pollution-control helpline.',
    priority: 'medium',
    impact: { kind: 'community', explanation: 'Open burning is a major local winter PM2.5 source; one stopped bonfire protects the whole street, not just your home.' },
  });

  alternatives.push({
    id: 'community-alerts',
    title: 'Share a neighbourhood smog alert group',
    detail: 'A building or school WhatsApp/Signal group that shares daily AQI and the cleanest window helps elderly neighbours and parents plan.',
    priority: 'low',
    impact: { kind: 'community', explanation: 'Collective timing of school runs and outdoor play lowers exposure for the most vulnerable.' },
  });

  const order = { high: 0, medium: 1, low: 2 };
  return alternatives.sort((a, b) => order[a.priority] - order[b.priority]);
}

/** Aggregates potential weekly/annual CO2 savings into a relatable figure. */
function summariseImpact(alternatives) {
  // Car-to-transit and carpool are mutually exclusive; count only the larger.
  const exclusive = new Set(['carpool']);
  const weekly = alternatives
    .filter((a) => !exclusive.has(a.id) && Number.isFinite(a.impact.co2KgPerWeek))
    .reduce((sum, a) => sum + a.impact.co2KgPerWeek, 0);
  const yearly = Math.round(weekly * 52);
  return {
    co2KgPerWeek: round1(weekly),
    co2KgPerYear: yearly,
    treeEquivalent: Math.round(yearly / F.TREE_CO2_KG_PER_YEAR),
  };
}

/**
 * Main entry point.
 * @param {object} profile validated profile
 * @param {{aqi:number, forecast?:object}} air air-quality reading
 */
function buildPlan(profile, air) {
  const risk = assessRisk(profile, air.aqi);
  const alternatives = buildAlternatives(profile, risk);
  return {
    risk,
    routine: buildRoutine(profile, risk, air.forecast),
    indoorHacks: buildIndoorHacks(profile, risk),
    alternatives,
    impactSummary: summariseImpact(alternatives),
  };
}

module.exports = {
  buildPlan,
  assessRisk,
  classifyAqi,
  buildRoutine,
  buildIndoorHacks,
  buildAlternatives,
  summariseImpact,
  weeklyCommuteKm,
};
