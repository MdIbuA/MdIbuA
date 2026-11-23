'use strict';

const path = require('node:path');
const express = require('express');
const helmet = require('helmet');
const { rateLimit } = require('express-rate-limit');

const { validateProfile, validateCity, ENUMS } = require('./utils/validation');
const { AppError } = require('./utils/errors');
const { buildPlan, classifyAqi } = require('./services/recommendationEngine');

/**
 * Builds the Express app. Services are injected so tests can run fully
 * offline with fakes.
 * @param {{ airQuality: object, assistant: object, rateLimitPerMinute?: number, logger?: Console }} deps
 */
function createApp({ airQuality, assistant, rateLimitPerMinute = 30, logger = console }) {
  const app = express();
  app.disable('x-powered-by');
  app.set('trust proxy', 1); // correct client IPs behind Cloud Run / reverse proxies

  app.use(
    helmet({
      contentSecurityPolicy: {
        useDefaults: true,
        directives: {
          'default-src': ["'self'"],
          'script-src': ["'self'"],
          'style-src': ["'self'"],
          'img-src': ["'self'", 'data:'],
          'connect-src': ["'self'"],
          'object-src': ["'none'"],
          'frame-ancestors': ["'none'"],
        },
      },
    }),
  );
  app.use(express.json({ limit: '10kb' }));

  app.use(
    '/api/',
    rateLimit({
      windowMs: 60_000,
      limit: rateLimitPerMinute,
      standardHeaders: 'draft-7',
      legacyHeaders: false,
      message: { error: 'Too many requests, please slow down.' },
    }),
  );

  app.get('/api/health', (_req, res) => res.json({ status: 'ok' }));

  app.get('/api/options', (_req, res) => res.json(ENUMS));

  app.get('/api/air', async (req, res, next) => {
    try {
      const city = validateCity(req.query.city);
      const air = await airQuality.getAirQuality(city);
      res.set('Cache-Control', 'public, max-age=300');
      res.json({ ...air, band: classifyAqi(air.aqi) });
    } catch (error) {
      next(error);
    }
  });

  app.post('/api/plan', async (req, res, next) => {
    try {
      const profile = validateProfile(req.body);
      let air;
      if (profile.manualAqi !== null) {
        air = { aqi: profile.manualAqi, location: { name: profile.city, country: '' }, forecast: null, source: 'Manual entry' };
      } else {
        air = await airQuality.getAirQuality(profile.city);
      }
      const plan = buildPlan(profile, air);
      const narrative = await assistant.narrate(plan, profile, air);
      res.set('Cache-Control', 'no-store');
      res.json({ air, ...plan, narrative });
    } catch (error) {
      next(error);
    }
  });

  app.use('/api', (_req, _res, next) => next(new AppError('Not found.', 404)));

  app.use(express.static(path.join(__dirname, '..', 'public'), { maxAge: '1h', index: 'index.html' }));

  // Central error handler: only AppError messages reach the client.
  // eslint-disable-next-line no-unused-vars
  app.use((error, _req, res, _next) => {
    if (error.type === 'entity.parse.failed') return res.status(400).json({ error: 'Malformed JSON body.' });
    if (error.type === 'entity.too.large') return res.status(413).json({ error: 'Request body too large.' });
    if (error instanceof AppError) {
      return res.status(error.status).json({ error: error.message, ...(error.details ? { details: error.details } : {}) });
    }
    logger.error('[server] unexpected error:', error.message);
    return res.status(500).json({ error: 'Something went wrong. Please try again.' });
  });

  return app;
}

module.exports = { createApp };
