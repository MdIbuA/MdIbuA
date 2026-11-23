'use strict';

/**
 * AirWise front end. All server data is rendered with textContent / DOM APIs
 * (never innerHTML), so model or API output cannot inject markup.
 */
(() => {
  const form = document.getElementById('profile-form');
  const submitBtn = document.getElementById('submit-btn');
  const formError = document.getElementById('form-error');
  const results = document.getElementById('results');

  /** Small element factory: el('p', { className: 'x' }, 'text', child). */
  function el(tag, props = {}, ...children) {
    const node = document.createElement(tag);
    Object.assign(node, props);
    for (const child of children) {
      if (child === null || child === undefined || child === false) continue;
      node.append(child instanceof Node ? child : document.createTextNode(String(child)));
    }
    return node;
  }

  /** replaceChildren() would render null as the text "null", so drop falsy nodes. */
  function setChildren(parent, ...children) {
    parent.replaceChildren(...children.filter((child) => child !== null && child !== undefined && child !== false));
  }

  function badge(priority) {
    return el('span', { className: `badge ${priority}` }, `${priority} priority`);
  }

  function formatTime(iso) {
    return iso ? iso.slice(11, 16) : '';
  }

  function impactText(impact) {
    const parts = [];
    if (Array.isArray(impact.exposureReductionPct)) {
      parts.push(`Exposure ↓ ${impact.exposureReductionPct[0]}–${impact.exposureReductionPct[1]}%`);
    }
    if (Number.isFinite(impact.co2KgPerWeek) && impact.co2KgPerWeek > 0) {
      parts.push(`CO₂ ↓ ${impact.co2KgPerWeek} kg/week`);
    }
    if (Number.isFinite(impact.pm25GramsPerWeek) && impact.pm25GramsPerWeek > 0) {
      parts.push(`Exhaust PM2.5 ↓ ${impact.pm25GramsPerWeek} g/week`);
    }
    return parts;
  }

  function renderItems(listId, items) {
    const list = document.getElementById(listId);
    list.replaceChildren(
      ...items.map((item) => {
        const metrics = impactText(item.impact);
        return el(
          'li',
          {},
          el('h4', {}, item.title, ' ', badge(item.priority)),
          el('p', {}, item.detail),
          el(
            'p',
            { className: 'impact' },
            el('strong', {}, 'Impact: '),
            metrics.length ? `${metrics.join(' · ')}. ` : '',
            item.impact.explanation,
          ),
        );
      }),
    );
  }

  function renderAqi(data) {
    const card = document.getElementById('aqi-card');
    const { air, risk } = data;
    card.style.setProperty('--band', risk.color);
    const place = [air.location?.name, air.location?.region, air.location?.country].filter(Boolean).join(', ');
    const forecast = air.forecast;
    setChildren(
      card,
      el('h3', {}, `Air quality in ${place}`),
      el('p', { className: 'aqi-value' }, `AQI ${risk.aqi}`),
      el('p', {}, el('strong', {}, risk.category)),
      el('p', {}, risk.headline),
      air.pm25 !== undefined && air.pm25 !== null ? el('p', { className: 'aqi-meta' }, `PM2.5: ${Math.round(air.pm25)} µg/m³ (WHO 24-h guideline: 15)`) : null,
      forecast?.cleanestWindow
        ? el('p', { className: 'aqi-meta' }, `Cleanest window today: ${formatTime(forecast.cleanestWindow.start)}–${formatTime(forecast.cleanestWindow.end)} (≈${forecast.cleanestWindow.meanPm25} µg/m³)`)
        : null,
      forecast?.worstHour ? el('p', { className: 'aqi-meta' }, `Worst hour: ${formatTime(forecast.worstHour.time)} (≈${forecast.worstHour.pm25} µg/m³)`) : null,
      el('p', { className: 'aqi-meta' }, `Personal risk score: ${risk.personalRiskScore}/100`),
      el('p', { className: 'source-note' }, `Source: ${air.source || 'Open-Meteo'}`),
    );
  }

  function renderNarrative(narrative) {
    const card = document.getElementById('narrative-card');
    const label = narrative.source === 'ai' ? 'AI coach briefing' : 'Coach briefing (rule-based)';
    setChildren(
      card,
      el('h3', {}, label),
      el('p', {}, narrative.summary),
      el('h4', {}, 'Top 3 actions today'),
      el(
        'ol',
        {},
        ...narrative.priorities.map((p) => el('li', {}, el('strong', {}, p.action), el('br'), p.impact)),
      ),
      narrative.answer ? el('h4', {}, 'Your question') : null,
      narrative.answer ? el('p', {}, narrative.answer) : null,
    );
  }

  function renderRoutine(routine) {
    document.getElementById('routine').replaceChildren(
      ...routine.map((slot) =>
        el('div', { className: 'routine-slot' }, el('h4', {}, slot.slot), el('ul', {}, ...slot.actions.map((a) => el('li', {}, a)))),
      ),
    );
  }

  function renderImpactSummary(summary) {
    const node = document.getElementById('impact-summary');
    node.textContent =
      summary.co2KgPerYear > 0
        ? `Adopting these swaps could avoid ≈${summary.co2KgPerYear} kg CO₂ per year (${summary.co2KgPerWeek} kg/week) — about what ${summary.treeEquivalent} mature trees absorb.`
        : 'Your current choices are already low-emission — focus on reducing exposure and helping your community.';
  }

  function collectPayload() {
    const data = new FormData(form);
    const payload = {};
    for (const [key, value] of data.entries()) payload[key] = typeof value === 'string' ? value.trim() : value;
    for (const name of ['hasChildren', 'hasElderly', 'hasRespiratoryCondition', 'isPregnant', 'hasAirPurifier']) {
      payload[name] = form.elements[name].checked;
    }
    if (!payload.manualAqi) delete payload.manualAqi;
    return payload;
  }

  function showError(message) {
    formError.textContent = message;
    formError.hidden = false;
  }

  form.addEventListener('submit', async (event) => {
    event.preventDefault();
    formError.hidden = true;
    const city = form.elements.city;
    if (!city.value.trim()) {
      city.setAttribute('aria-invalid', 'true');
      city.focus();
      showError('Please enter your city or town.');
      return;
    }
    city.removeAttribute('aria-invalid');

    submitBtn.disabled = true;
    submitBtn.textContent = 'Building your plan…';
    results.setAttribute('aria-busy', 'true');

    try {
      const response = await fetch('/api/plan', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(collectPayload()),
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) {
        const details = Array.isArray(data.details) ? ` ${data.details.join(' ')}` : '';
        const hint = response.status >= 500 ? ' You can enter the AQI manually below.' : '';
        throw new Error(`${data.error || 'Request failed.'}${details}${hint}`);
      }
      renderAqi(data);
      renderNarrative(data.narrative);
      renderRoutine(data.routine);
      renderItems('indoor', data.indoorHacks);
      renderImpactSummary(data.impactSummary);
      renderItems('alternatives', data.alternatives);
      results.hidden = false;
      document.getElementById('results-heading').focus();
    } catch (error) {
      showError(error.message || 'Could not reach AirWise. Check your connection and try again.');
    } finally {
      submitBtn.disabled = false;
      submitBtn.textContent = 'Get my clean-air plan';
      results.setAttribute('aria-busy', 'false');
    }
  });
})();
