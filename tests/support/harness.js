'use strict';

const createApp = require('../../src/app');
const db = require('../../src/utils/db');
const redis = require('../../src/utils/redis');

const state = { available: false, reason: 'not checked' };

async function startTestServer() {
  const app = createApp();

  const server = await new Promise((resolve) => {
    const instance = app.listen(0, '127.0.0.1', () => resolve(instance));
  });

  const { port } = server.address();

  return {
    baseUrl: `http://127.0.0.1:${port}`,
    close: () =>
      new Promise((resolve) => {
        server.close(resolve);
      }),
  };
}

async function checkDatabase() {
  const result = await db.healthCheck();
  state.available = result.ok;
  state.reason = result.ok ? 'ok' : result.error;
  return state;
}

async function api(baseUrl, method, path, { body, token } = {}) {
  const response = await fetch(`${baseUrl}${path}`, {
    method,
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });

  const text = await response.text();
  let parsed = null;
  try {
    parsed = text ? JSON.parse(text) : null;
  } catch {
    parsed = text;
  }

  return { status: response.status, body: parsed, headers: response.headers };
}

function uniqueSuffix() {
  return `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 7)}`;
}

async function shutdown() {
  await redis.close();
  await db.close();
}

module.exports = { state, startTestServer, checkDatabase, api, uniqueSuffix, shutdown, db };
