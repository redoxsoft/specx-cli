import path from 'node:path';
import type { Ctx } from './context.js';

function getPath(ctx: Ctx) {
  return ctx.platform === 'win32' ? path.win32 : path.posix;
}

export function cacheDir(ctx: Ctx): string {
  const p = getPath(ctx);
  if (ctx.platform === 'linux') {
    const xdg = ctx.env.XDG_CACHE_HOME;
    return xdg ? p.join(xdg, 'specx-cli') : p.join(ctx.homeDir, '.cache', 'specx-cli');
  }
  if (ctx.platform === 'darwin') {
    return p.join(ctx.homeDir, 'Library', 'Caches', 'specx-cli');
  }
  // win32
  const localAppData = ctx.env.LOCALAPPDATA;
  if (localAppData) {
    return p.join(localAppData, 'specx-cli', 'Cache');
  }
  return p.join(ctx.homeDir, 'AppData', 'Local', 'specx-cli', 'Cache');
}

export function isWsl(ctx: Ctx): boolean {
  return ctx.platform === 'linux' && Boolean(ctx.env.WSL_DISTRO_NAME);
}

export function isWindowsBinaryUnderWsl(ctx: Ctx, binaryPath: string): boolean {
  return isWsl(ctx) && binaryPath.startsWith('/mnt/');
}

export function cursorPaths(ctx: Ctx): { mcpJson: string; skillsDir: string } {
  const p = getPath(ctx);
  return {
    mcpJson: p.join(ctx.homeDir, '.cursor', 'mcp.json'),
    skillsDir: p.join(ctx.homeDir, '.cursor', 'skills'),
  };
}
