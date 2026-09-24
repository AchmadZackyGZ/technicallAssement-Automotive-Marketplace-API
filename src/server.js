'use strict';

const config = require('./config');
const logger = require('./utils/logger');
const db = require('./utils/db');
const redis = require('./utils/redis');
const createApp = require('./app');

/**
 * Process entry point.
 *
 * Responsibilities are deliberately narrow: boot the HTTP server, wire up
 * graceful shutdown, and release resources on the way out.
 */

const app = createApp();

const server = app.listen(config.port, () => {
  logger.info('HTTP server listening', {
    env: config.env,
    port: config.port,
    apiPrefix: config.apiPrefix,
    docs: `${config.apiPrefix}/docs`,
    // `connecting` rather than a misleading `disabled` - the Redis client
    // connects in the background so boot is never blocked by a slow cache.
    redis: redis.status(),
  });
});

/** Stop accepting connections, drain in-flight requests, release resources. */
async function shutdown(signal) {
  logger.info('Shutdown signal received', { signal });

  const forceExit = setTimeout(() => {
    logger.error('Graceful shutdown timed out - forcing exit');
    process.exit(1);
  }, 10_000);
  forceExit.unref();

  server.close(async () => {
    try {
      await redis.close();
      await db.close();
      logger.info('Shutdown complete');
      clearTimeout(forceExit);
      process.exit(0);
    } catch (error) {
      logger.error('Error during shutdown', { error: error.message });
      process.exit(1);
    }
  });
}

['SIGTERM', 'SIGINT'].forEach((signal) => {
  process.on(signal, () => shutdown(signal));
});

process.on('unhandledRejection', (reason) => {
  logger.error('Unhandled promise rejection', {
    reason: reason instanceof Error ? reason.message : String(reason),
  });
});

process.on('uncaughtException', (error) => {
  logger.error('Uncaught exception - shutting down', { error: error.message, stack: error.stack });
  shutdown('uncaughtException');
});

module.exports = server;
