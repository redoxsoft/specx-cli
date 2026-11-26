// Removes dist/ before a build. Node instead of `rm -rf` so it works on Windows too.
import { rmSync } from 'node:fs';

rmSync(new URL('../dist', import.meta.url), { recursive: true, force: true });
