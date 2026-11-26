import fs from 'node:fs';
import path from 'node:path';
import type { Ctx } from './context.js';
import { cacheDir } from './platform.js';

const ONE_DAY_MS = 24 * 60 * 60 * 1000;

export async function latestCliVersion(ctx: Ctx): Promise<string | null> {
  const p = ctx.platform === 'win32' ? path.win32 : path.posix;
  const cacheFile = p.join(cacheDir(ctx), 'latest.json');
  const now = ctx.now().getTime();

  try {
    if (fs.existsSync(cacheFile)) {
      const content = fs.readFileSync(cacheFile, 'utf8');
      const data = JSON.parse(content) as { version?: unknown; checkedAt?: unknown };
      if (
        typeof data.version === 'string' &&
        typeof data.checkedAt === 'number' &&
        now - data.checkedAt < ONE_DAY_MS &&
        now >= data.checkedAt
      ) {
        return data.version;
      }
    }
  } catch {
    // Ignore cache read/parse errors
  }

  try {
    const res = await ctx.fetch('https://registry.npmjs.org/specx-cli/latest', {
      signal: AbortSignal.timeout(2500),
    });
    if (!res.ok) {
      return null;
    }
    const json = (await res.json()) as { version?: unknown };
    if (typeof json?.version === 'string') {
      try {
        const dir = p.dirname(cacheFile);
        if (!fs.existsSync(dir)) {
          fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
        }
        fs.writeFileSync(
          cacheFile,
          JSON.stringify({ version: json.version, checkedAt: now }),
          'utf8'
        );
      } catch {
        // Ignore cache write errors
      }
      return json.version;
    }
    return null;
  } catch {
    // Network or timeout failure
    return null;
  }
}

export async function serverReachable(ctx: Ctx, mcpUrl: string): Promise<boolean | null> {
  try {
    const origin = new URL(mcpUrl).origin;
    const res = await ctx.fetch(`${origin}/.well-known/oauth-protected-resource`, {
      signal: AbortSignal.timeout(3000),
    });
    return res.status === 200;
  } catch {
    // Network error, DNS failure, timeout, or invalid URL
    return null;
  }
}
