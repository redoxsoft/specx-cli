// Runs before `npm publish`: refuses to publish without the generated assets,
// or (in CI) when the git tag doesn't match package.json's version.
import { existsSync, readFileSync } from 'node:fs';

const pkg = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8'));
const manifest = new URL('../assets/manifest.json', import.meta.url);
if (!existsSync(manifest)) {
  console.error('assets/manifest.json is missing. Run `npm run package:build` in redoxsoft-mcp first.');
  process.exit(1);
}
const ref = process.env.GITHUB_REF_NAME;
if (ref && ref !== `v${pkg.version}`) {
  console.error(`Tag ${ref} doesn't match package.json version ${pkg.version}.`);
  process.exit(1);
}
