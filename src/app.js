'use strict';

const express = require('express');
const helmet = require('helmet');
const cors = require('cors');
const compression = require('compression');
const morgan = require('morgan');
const swaggerUi = require('swagger-ui-express');

const config = require('./config');
const { swaggerSpec } = require('./config/swagger');
const routes = require('./routes');
const { health } = require('./routes/health');
const { errorHandler, notFound } = require('./middleware/errorHandler');
const { apiLimiter } = require('./middleware/rateLimiter');

function createApp() {
  const app = express();

  app.set('trust proxy', 1);
  app.disable('x-powered-by');

  app.use(
    helmet({
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

  if (!config.isTest) {
    app.use(
      morgan(config.isProduction ? 'combined' : 'dev', {
        skip: (req) => req.path === '/health',
      }),
    );
  }

  app.use(express.json({ limit: '1mb' }));
  app.use(express.urlencoded({ extended: true, limit: '1mb' }));
  app.use(compression());

  app.use(apiLimiter);

  app.get('/', (_req, res) => {
    res.json({
      name: 'Automotive Marketplace API',
      version: require('../package.json').version,
      documentation: `${config.apiPrefix}/docs`,
      health: '/health',
      apiPrefix: config.apiPrefix,
    });
  });

  app.get('/health', health);

  app.use(config.apiPrefix, routes);

  app.get(`${config.apiPrefix}/openapi.json`, (_req, res) => res.json(swaggerSpec));

  app.use(
    `${config.apiPrefix}/docs`,
    swaggerUi.serve,
    swaggerUi.setup(swaggerSpec, {
      customSiteTitle: 'Automotive Marketplace API - Reference',
      swaggerOptions: {
        persistAuthorization: true,
        displayRequestDuration: true,
        docExpansion: 'list',
        filter: true,
        tryItOutEnabled: true,
      },
    }),
  );

  app.use(notFound);
  app.use(errorHandler);

  return app;
}

module.exports = createApp;
