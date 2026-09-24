'use strict';

/**
 * Minimal structured logger.
 *
 * Kept dependency-free on purpose: the assessment values simple, well-executed
 * solutions, and a tiny wrapper around `console` with level filtering and
 * ISO timestamps covers everything this service needs.
 */

const config = require('../config');

const LEVELS = { error: 0, warn: 1, info: 2, debug: 3 };

const activeLevel = (() => {
  if (config.isTest) return LEVELS.error;
  return config.isProduction ? LEVELS.info : LEVELS.debug;
})();

function write(level, message, meta) {
  if (LEVELS[level] > activeLevel) return;

  const entry = {
    ts: new Date().toISOString(),
    level,
    message,
    ...(meta && Object.keys(meta).length ? { meta } : {}),
  };

  const line = JSON.stringify(entry);
  if (level === 'error') {
    // eslint-disable-next-line no-console
    console.error(line);
  } else if (level === 'warn') {
    // eslint-disable-next-line no-console
    console.warn(line);
  } else {
    // eslint-disable-next-line no-console
    console.log(line);
  }
}

module.exports = {
  error: (message, meta) => write('error', message, meta),
  warn: (message, meta) => write('warn', message, meta),
  info: (message, meta) => write('info', message, meta),
  debug: (message, meta) => write('debug', message, meta),
};
