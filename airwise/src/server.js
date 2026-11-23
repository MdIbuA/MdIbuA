'use strict';

const config = require('./config');
const { createApp } = require('./app');
const { createAirQualityService } = require('./services/airQuality');
const { createAssistant } = require('./services/assistant');

const app = createApp({
  airQuality: createAirQualityService({
    timeoutMs: config.httpTimeoutMs,
    geocodeTtlMs: config.geocodeTtlMs,
    airQualityTtlMs: config.airQualityTtlMs,
  }),
  assistant: createAssistant({
    enabled: config.llmEnabled,
    model: config.llmModel,
    timeoutMs: config.llmTimeoutMs,
    ttlMs: config.planTtlMs,
  }),
  rateLimitPerMinute: config.rateLimitPerMinute,
});

const server = app.listen(config.port, () => {
  console.log(`AirWise listening on http://localhost:${config.port} (AI narrative: ${config.llmEnabled ? 'on' : 'off, rule-based'})`);
});

// Graceful shutdown for containers (Cloud Run / Docker send SIGTERM).
for (const signal of ['SIGTERM', 'SIGINT']) {
  process.on(signal, () => server.close(() => process.exit(0)));
}
