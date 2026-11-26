import fs from 'node:fs';
import path from 'node:path';
import type { Ctx } from './context.js';
import { cacheDir } from './platform.js';

export function backupFile(ctx: Ctx, realPath: string, text: string): string {
  const p = ctx.platform === 'win32' ? path.win32 : path.posix;
  const sanitized = realPath.replace(/[/\\]|:/g, '_');
  const baseCache = cacheDir(ctx);
  const backupsDir = p.join(baseCache, 'backups');
  const backupDir = p.join(backupsDir, sanitized);

  // A redirected backup directory could write user config contents outside the cache.
  for (const dir of [backupsDir, backupDir]) {
    try {
      const stat = fs.lstatSync(dir);
      if (!stat.isDirectory() || stat.isSymbolicLink()) {
        throw new Error(`Backup path is not a real directory: ${dir}`);
      }
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code !== 'ENOENT') throw err;
      fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
    }
    fs.chmodSync(dir, 0o700);
  }

  const timestamp = ctx.now().toISOString().replace(/:/g, '-');
  let backupPath = p.join(backupDir, `${timestamp}.bak`);
  let fd: number | null = null;
  for (let suffix = 0; suffix < 10_000; suffix++) {
    const filename = suffix === 0 ? `${timestamp}.bak` : `${timestamp}-${suffix}.bak`;
    backupPath = p.join(backupDir, filename);
    try {
      fd = fs.openSync(backupPath, 'wx', 0o600);
      break;
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code !== 'EEXIST') throw err;
    }
  }
  if (fd === null) throw new Error(`Could not create a unique backup in ${backupDir}`);

  try {
    fs.writeFileSync(fd, text, { encoding: 'utf8' });
    fs.fchmodSync(fd, 0o600);
  } catch (err) {
    try {
      fs.closeSync(fd);
    } catch {
      // Preserve the original write or permission error.
    }
    try {
      fs.unlinkSync(backupPath);
    } catch {
      // The incomplete backup is best-effort cleanup after a failed write.
    }
    throw err;
  }
  fs.closeSync(fd);

  const entries = fs.readdirSync(backupDir)
    .filter((file) => /^\d{4}-\d\d-\d\dT.*\.bak$/.test(file))
    .sort((a, b) => {
      const aParts = /^(.*?)(?:-(\d+))?\.bak$/.exec(a);
      const bParts = /^(.*?)(?:-(\d+))?\.bak$/.exec(b);
      const byTime = (aParts?.[1] ?? a).localeCompare(bParts?.[1] ?? b);
      return byTime || Number(aParts?.[2] ?? 0) - Number(bParts?.[2] ?? 0);
    });
  for (const oldFile of entries.slice(0, Math.max(0, entries.length - 10))) {
    fs.unlinkSync(p.join(backupDir, oldFile));
  }

  return backupPath;
}
