/**
 * scripts/generateOpenApi.ts
 * ---------------------------------------------------------------------------
 * Writes openapi.json from the live router.
 *
 *   npm run openapi:generate --workspace backend   # write the file
 *   npm run openapi:check    --workspace backend   # fail if it has drifted
 *
 * The `check` form is the useful one in CI. A committed spec that nobody
 * regenerates is worse than no spec: it looks authoritative while describing
 * an API that no longer exists. This makes drift a build failure rather than
 * something a client integrator discovers.
 */
import fs from 'node:fs';
import path from 'node:path';
import { buildOpenApiDocument } from '../src/docs/openapi';

const OUTPUT = path.resolve(process.cwd(), 'openapi.json');

function main(): void {
  const checkOnly = process.argv.includes('--check');
  const version = (JSON.parse(fs.readFileSync(path.resolve(process.cwd(), 'package.json'), 'utf8')) as {
    version: string;
  }).version;

  const document = buildOpenApiDocument(version);
  const serialised = `${JSON.stringify(document, null, 2)}\n`;

  const stats = document['x-generation'] as { routeCount: number; undocumentedEndpoints: number };

  if (checkOnly) {
    if (!fs.existsSync(OUTPUT)) {
      console.error('\n  openapi.json is missing. Run `npm run openapi:generate`.\n');
      process.exit(1);
    }

    if (fs.readFileSync(OUTPUT, 'utf8') !== serialised) {
      console.error(
        '\n  openapi.json is out of date with the router. Run `npm run openapi:generate` and commit the result.\n',
      );
      process.exit(1);
    }

    console.log(`\n  openapi.json is up to date (${stats.routeCount} endpoints).\n`);
    return;
  }

  fs.writeFileSync(OUTPUT, serialised, 'utf8');

  console.log('\n  ---------------------------------------------------------------');
  console.log('   OPENAPI SPEC WRITTEN');
  console.log(`   ${stats.routeCount} endpoints -> openapi.json`);
  console.log(
    `   ${stats.routeCount - stats.undocumentedEndpoints} have a hand-written description, ${stats.undocumentedEndpoints} do not`,
  );
  console.log('  ---------------------------------------------------------------');
  console.log('\n  Descriptions live in src/docs/descriptions.ts, keyed "METHOD /path".');
  console.log('  View the spec with any OpenAPI viewer, or GET /api/v1/openapi.json.\n');
}

main();
