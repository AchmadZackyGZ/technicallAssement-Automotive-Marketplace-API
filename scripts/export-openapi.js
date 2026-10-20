'use strict';

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
    console.error('No operations were discovered - are the @openapi blocks present?');
    process.exitCode = 1;
    return;
  }

  fs.mkdirSync(path.dirname(outputPath), { recursive: true });
  fs.writeFileSync(outputPath, `${JSON.stringify(swaggerSpec, null, 2)}\n`, 'utf8');

  console.log(`Wrote ${outputPath}`);
  console.log(`  ${Object.keys(swaggerSpec.paths).length} paths, ${operations} operations, ${schemas} schemas`);
}

if (require.main === module) main();

module.exports = { main };
