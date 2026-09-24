'use strict';

/**
 * Write the assembled OpenAPI document to docs/openapi.json.
 *
 *   npm run docs:export
 *
 * The same spec is served live at `${API_PREFIX}/docs`, so this is purely for
 * reviewers who want to import the contract into Postman or Insomnia, or diff it
 * between commits. The generated file is committed on purpose: a reviewer should
 * be able to read the API contract without running anything.
 */

const fs = require('node:fs');
const path = require('node:path');

const { swaggerSpec } = require('../src/config/swagger');

const outputPath = path.join(__dirname, '..', 'docs', 'openapi.json');

function countOperations(spec) {
  let operations = 0;
  for (const methods of Object.values(spec.paths ?? {})) {
    operations += Object.keys(methods).filter((key) =>
      ['get', 'post', 'put', 'patch', 'delete', 'head', 'options'].includes(key),
    ).length;
  }
  return operations;
}

function main() {
  const operations = countOperations(swaggerSpec);
  const schemas = Object.keys(swaggerSpec.components?.schemas ?? {}).length;

  if (operations === 0) {
    // eslint-disable-next-line no-console -- CLI output
    console.error('No operations were discovered - are the @openapi blocks present?');
    process.exitCode = 1;
    return;
  }

  fs.mkdirSync(path.dirname(outputPath), { recursive: true });
  fs.writeFileSync(outputPath, `${JSON.stringify(swaggerSpec, null, 2)}\n`, 'utf8');

  // eslint-disable-next-line no-console -- CLI output
  console.log(`Wrote ${outputPath}`);
  // eslint-disable-next-line no-console -- CLI output
  console.log(`  ${Object.keys(swaggerSpec.paths).length} paths, ${operations} operations, ${schemas} schemas`);
}

if (require.main === module) main();

module.exports = { main };
