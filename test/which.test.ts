import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { findExecutable } from '../src/core/which.js';
import { fakeCtx, tempHome } from './helpers.js';

test('which: with win32, PATHEXT=.CMD;.EXE and fake exists, claude resolves to claude.CMD', (t) => {
  const ctx = fakeCtx({
    platform: 'win32',
    env: {
      PATH: 'C:\\Tools\\bin',
      PATHEXT: '.CMD;.EXE',
    },
  }, t);

  const fakeExists = (filePath: string) => filePath === 'C:\\Tools\\bin\\claude.CMD';
  const resolved = findExecutable(ctx, 'claude', fakeExists);

  assert.equal(resolved, 'C:\\Tools\\bin\\claude.CMD');
});

test('which: Path is used when PATH is unset on Windows', (t) => {
  const ctx = fakeCtx({
    platform: 'win32',
    env: {
      PATH: undefined,
      Path: 'D:\\Special\\bin',
      PATHEXT: '.CMD;.EXE',
    },
  }, t);

  const fakeExists = (filePath: string) => filePath === 'D:\\Special\\bin\\claude.CMD';
  const resolved = findExecutable(ctx, 'claude', fakeExists);

  assert.equal(resolved, 'D:\\Special\\bin\\claude.CMD');
});

test('which: on POSIX a non-executable file is not found', {
  skip: process.platform === 'win32' ? 'executable bits are not asserted on Windows' : false,
}, (t) => {
  const home = tempHome(t);
  const binDir = path.join(home, 'bin');
  fs.mkdirSync(binDir, { recursive: true });

  const ctx = fakeCtx({
    platform: 'linux',
    env: { PATH: binDir },
    homeDir: home,
  }, t);

  const nonExecFile = path.join(binDir, 'my-tool');
  fs.writeFileSync(nonExecFile, '#!/bin/sh\necho hi\n', { mode: 0o644 });
  fs.chmodSync(nonExecFile, 0o644);

  // File exists, but mode is 0o644 (not executable)
  const notFound = findExecutable(ctx, 'my-tool');
  assert.equal(notFound, null, 'non-executable file must not be found');

  // Make it executable
  fs.chmodSync(nonExecFile, 0o755);
  const found = findExecutable(ctx, 'my-tool');
  assert.equal(found, nonExecFile, 'executable file must be found');
});
