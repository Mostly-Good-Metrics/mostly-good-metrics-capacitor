import { build } from 'esbuild';
import { createRequire } from 'node:module';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
const fixture = dirname(fileURLToPath(import.meta.url));
const sdk = resolve(fixture, '../..');
const require = createRequire(resolve(sdk, 'package.json'));
const core = process.env.MGM_JS_DIR
  ? resolve(process.env.MGM_JS_DIR, 'dist/esm/index.js')
  : require.resolve('@mostly-good-metrics/javascript');
const alias = { '@mgm/candidate-wrapper': resolve(sdk, 'dist/esm/src/index.js'), '@mostly-good-metrics/javascript': core };
for (const plugin of ['core', 'app', 'device', 'preferences']) {
  alias['@capacitor/' + plugin] = resolve(fixture, 'node_modules/@capacitor/' + plugin + '/dist/' + (plugin === 'core' ? '' : 'esm/') + 'index.js');
}
await build({ entryPoints: [resolve(fixture, 'probe.js')], outfile: resolve(fixture, 'www/probe.js'), bundle: true, minify: true, platform: 'browser', format: 'iife', alias });
