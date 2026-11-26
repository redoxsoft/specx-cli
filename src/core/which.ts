import fs from 'node:fs';
import path from 'node:path';
import type { Ctx, Platform } from './context.js';

function defaultExists(filePath: string, platform: Platform): boolean {
  try {
    const stat = fs.statSync(filePath);
    if (!stat.isFile()) return false;
    if (platform === 'win32') return true;
    return (stat.mode & 0o111) !== 0;
  } catch {
    // Missing path or a directory we cannot stat: not an executable we can run.
    return false;
  }
}

function pathKey(ctx: Ctx): string {
  if (ctx.platform !== 'win32') return ctx.env.PATH ?? '';
  // Windows stores the variable as Path. A test double is case-sensitive, so fall back explicitly.
  return ctx.env.PATH ?? ctx.env.Path ?? '';
}

function pathExtensions(ctx: Ctx): string[] {
  const raw = ctx.env.PATHEXT ?? ctx.env.Pathext ?? '.COM;.EXE;.BAT;.CMD';
  return raw
    .split(';')
    .map((ext) => ext.trim())
    .filter((ext) => ext.length > 0)
    .map((ext) => (ext.startsWith('.') ? ext : `.${ext}`));
}

function candidateNames(ctx: Ctx, name: string): string[] {
  if (ctx.platform !== 'win32') return [name];
  // SearchPath does not append PATHEXT when the name already has an extension.
  // `claude.cmd` still matches a PATHEXT entry of `.CMD` because the filesystem is case-insensitive.
  if (path.win32.extname(name)) return [name];
  return pathExtensions(ctx).map((item) => `${name}${item}`);
}

export function findExecutable(
  ctx: Ctx,
  name: string,
  exists?: (filePath: string) => boolean,
): string | null {
  const p = ctx.platform === 'win32' ? path.win32 : path.posix;
  const checkExists = exists ?? ((filePath: string) => defaultExists(filePath, ctx.platform));
  const names = candidateNames(ctx, name);

  const resolve = (cand: string): string => (p.isAbsolute(cand) ? cand : p.resolve(ctx.cwd, cand));

  const hasSeparator = p.isAbsolute(name) || name.includes('/') || (ctx.platform === 'win32' && name.includes('\\'));
  if (hasSeparator) {
    for (const cand of names) {
      const fullPath = resolve(cand);
      if (checkExists(fullPath)) return fullPath;
    }
    return null;
  }

  const sep = ctx.platform === 'win32' ? ';' : ':';
  const dirs = pathKey(ctx).split(sep).filter((dir) => dir.length > 0);
  for (const dir of dirs) {
    for (const cand of names) {
      const fullPath = p.join(dir, cand);
      if (checkExists(fullPath)) return fullPath;
    }
  }
  return null;
}
