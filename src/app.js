'use strict';

/**
 * Express application factory.
 *
 * `createApp()` returns a fully configured app without starting a listener,
 * which keeps the HTTP surface testable (supertest-style) and lets `server.js`
 * own process concerns such as signals and shutdown.
 *
 * Middleware order is intentional and documented inline:
 *   security -> observability -> parsing -> throttling -> routes -> errors
 */

const express = require('express');
const helmet = require('helmet');
const cors = require('cors');
const compression = require('compression');
const morgan = require('morgan');

const config = require('./config');
const routes = require('./routes');
const { health } = require('./routes/health');
const { errorHandler, notFound } = require('./middleware/errorHandler');
const { apiLimiter } = require('./middleware/rateLimiter');

function createApp() {
  const app = express();

  // Behind Railway/Render's proxy we need the real client IP for rate limiting.
  app.set('trust proxy', 1);
  app.disable('x-powered-by');

  // --- Security ------------------------------------------------------------
  app.use(
    helmet({
      // Swagger UI ships inline scripts/styles, so CSP is relaxed for /docs.
      contentSecurityPolicy: config.isProduction
        ? {
            directives: {
              defaultSrc: ["'self'"],
              scriptSrc: ["'self'", "'unsafe-inline'"],
              styleSrc: ["'self'", "'unsafe-inline'"],
              imgSrc: ["'self'", 'data:', 'https:'],
            },
          }
        : false,
      crossOriginEmbedderPolicy: false,
    }),
  );
  app.use(
    cors({
      origin: config.cors.origin === '*' ? true : config.cors.origin.split(',').map((o) => o.trim()),
      methods: ['GET', 'POST', 'PATCH', 'PUT', 'DELETE', 'OPTIONS'],
      allowedHeaders: ['Content-Type', 'Authorization'],
      maxAge: 86_400,
    }),
  );

  // --- Observability -------------------------------------------------------
  if (!config.isTest) {
    app.use(
      morgan(config.isProduction ? 'combined' : 'dev', {
        skip: (req) => req.path === '/health',
      }),
    );
  }

  // --- Body parsing --------------------------------------------------------
  app.use(express.json({ limit: '1mb' }));
  app.use(express.urlencoded({ extended: true, limit: '1mb' }));
  app.use(compression());

  // --- Throttling ----------------------------------------------------------
  app.use(apiLimiter);

  // --- Service index -------------------------------------------------------
  app.get('/', (_req, res) => {
    res.json({
      name: 'Automotive Marketplace API',
      version: require('../package.json').version,
      documentation: `${config.apiPrefix}/docs`,
      health: '/health',
      apiPrefix: config.apiPrefix,
    });
  });

  // Hosting platforms probe the root path; API clients use the versioned alias
  // registered in routes/index.js. Same handler, two entry points.
  app.get('/health', health);

  // --- Feature routes ------------------------------------------------------
  app.use(config.apiPrefix, routes);

  // --- Terminal handlers (must be last) ------------------------------------
  app.use(notFound);
  app.use(errorHandler);

  return app;
}

module.exports = createApp;
