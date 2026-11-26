import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { applyFileChange, planRemoveProperty, planSetProperty, readJsoncFile } from '../src/core/jsonc-file.js';
import { cacheDir } from '../src/core/platform.js';
import { fakeCtx, tempHome } from './helpers.js';

function isInside(parent: string, child: string): boolean {
  const rel = path.relative(path.resolve(parent), path.resolve(child));
  return rel === '' || (!rel.startsWith(`..${path.sep}`) && rel !== '..' && !path.isAbsolute(rel));
}

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const fixturesDir = path.join(__dirname, 'fixtures', 'cursor');

test('jsonc-file: setting mcpServers.specx in with-comments.json keeps comments, tabs, github entry, and trailing newline', () => {
  const fixturePath = path.join(fixturesDir, 'with-comments.json');
  const file = readJsoncFile(fixturePath);
  assert.equal(file.ok, true);

  const change = planSetProperty(
    file,
    ['mcpServers', 'specx'],
    { url: 'https://mcp.redoxsoft.com/mcp' },
    'Add SpecX',
  );

  const expected = [
    '{',
    '\t// A line comment',
    '\t/* A block comment */',
    '\t"mcpServers": {',
    '\t\t"github": {',
    '\t\t\t"url": "https://example.com/mcp"',
    '\t\t},',
    '\t\t"specx": {',
    '\t\t\t"url": "https://mcp.redoxsoft.com/mcp"',
    '\t\t}',
    '\t}',
    '}',
    '',
  ].join('\n');
  assert.equal(
    change.afterText,
    expected,
    'keeps both comments, tab indentation, the github entry, and the trailing newline',
  );
});

test('jsonc-file: removing specx from owned.json leaves the other server untouched', () => {
  const fixturePath = path.join(fixturesDir, 'owned.json');
  const file = readJsoncFile(fixturePath);
  assert.equal(file.ok, true);

  const change = planRemoveProperty(file, ['mcpServers', 'specx'], 'Remove SpecX');
  assert.ok(change, 'plans a removal');

  const expected = [
    '{',
    '  "mcpServers": {',
    '    "github": {',
    '      "url": "https://example.com/mcp"',
    '    }',
    '  }',
    '}',
    '',
  ].join('\n');
  assert.equal(change.afterText, expected, 'removes specx and leaves the github server untouched');
});

test('jsonc-file: a missing file is created with 2-space indentation and a trailing newline', (t) => {
  const home = tempHome(t);
  const missingPath = path.join(home, 'sub', 'missing.json');
  const file = readJsoncFile(missingPath);

  assert.equal(file.ok, true);
  assert.equal(file.snapshot.exists, false);

  const change = planSetProperty(
    file,
    ['mcpServers', 'specx'],
    { url: 'https://mcp.redoxsoft.com/mcp' },
    'Create file',
  );

  const expected = [
    '{',
    '  "mcpServers": {',
    '    "specx": {',
    '      "url": "https://mcp.redoxsoft.com/mcp"',
    '    }',
    '  }',
    '}',
    '',
  ].join('\n');
  assert.equal(change.afterText, expected, 'uses 2-space indentation and a trailing newline');

  const ctx = fakeCtx({ homeDir: home }, t);
  const result = applyFileChange(ctx, change);
  assert.equal(result.ok, true);

  const onDisk = fs.readFileSync(missingPath, 'utf8');
  assert.equal(onDisk, expected);
});

test('jsonc-file: broken.json returns ok: false', () => {
  const fixturePath = path.join(fixturesDir, 'broken.json');
  const file = readJsoncFile(fixturePath);
  assert.equal(file.ok, false);
});

test('jsonc-file: applyFileChange refuses when the file changed after planning', (t) => {
  const home = tempHome(t);
  const filePath = path.join(home, 'test.json');
  fs.writeFileSync(filePath, '{\n  "version": 1\n}\n', 'utf8');

  const file = readJsoncFile(filePath);
  assert.equal(file.ok, true);

  const change = planSetProperty(file, ['version'], 2, 'Update version');

  // Change the file before applying
  fs.writeFileSync(filePath, '{\n  "version": 999\n}\n', 'utf8');

  const ctx = fakeCtx({ homeDir: home }, t);
  const result = applyFileChange(ctx, change);
  assert.equal(result.ok, false);
  if (!result.ok) {
    assert.match(result.error, /changed since the plan was made/);
  }

  // Verify file was not overwritten
  assert.equal(fs.readFileSync(filePath, 'utf8'), '{\n  "version": 999\n}\n');
});

test('jsonc-file: applyFileChange keeps existing mode and creates new files as 0o600', {
  skip: process.platform === 'win32' ? 'file mode bits are not meaningful on Windows' : false,
}, (t) => {
  const home = tempHome(t);
  const ctx = fakeCtx({ homeDir: home }, t);

  // 1. Existing file with 0o640 mode
  const existingPath = path.join(home, 'existing.json');
  fs.writeFileSync(existingPath, '{\n  "foo": "bar"\n}\n', { mode: 0o640 });
  fs.chmodSync(existingPath, 0o640);

  const file1 = readJsoncFile(existingPath);
  assert.equal(file1.ok, true);
  const change1 = planSetProperty(file1, ['foo'], 'baz', 'Change foo');
  const res1 = applyFileChange(ctx, change1);
  assert.equal(res1.ok, true);

  const stat1 = fs.statSync(existingPath);
  assert.equal(stat1.mode & 0o777, 0o640, 'keeps existing 0o640 mode');

  // 2. New file created as 0o600
  const newPath = path.join(home, 'new.json');
  const file2 = readJsoncFile(newPath);
  assert.equal(file2.ok, true);
  const change2 = planSetProperty(file2, ['hello'], 'world', 'New file');
  const res2 = applyFileChange(ctx, change2);
  assert.equal(res2.ok, true);

  const stat2 = fs.statSync(newPath);
  assert.equal(stat2.mode & 0o777, 0o600, 'creates new file with 0o600 mode');
});

test('jsonc-file: writing through a symlink updates the target and leaves the symlink', {
  skip: process.platform === 'win32' ? 'symbolic links are not asserted on Windows' : false,
}, (t) => {
  const home = tempHome(t);
  const ctx = fakeCtx({ homeDir: home }, t);

  const realTarget = path.join(home, 'real-target.json');
  const symlinkPath = path.join(home, 'link.json');

  fs.writeFileSync(realTarget, '{\n  "count": 1\n}\n', 'utf8');
  fs.symlinkSync(realTarget, symlinkPath);

  const file = readJsoncFile(symlinkPath);
  assert.equal(file.ok, true);
  assert.equal(file.snapshot.path, symlinkPath);
  assert.equal(file.snapshot.realPath, fs.realpathSync(realTarget));

  const change = planSetProperty(file, ['count'], 2, 'Update count');
  const res = applyFileChange(ctx, change);
  assert.equal(res.ok, true);

  // Symlink must remain a symlink
  const lstat = fs.lstatSync(symlinkPath);
  assert.equal(lstat.isSymbolicLink(), true, 'link remains a symbolic link');

  // Real target must be updated
  const targetContent = JSON.parse(fs.readFileSync(realTarget, 'utf8')) as { count: number };
  assert.equal(targetContent.count, 2, 'target was updated');
});

test('jsonc-file: a backup is written under the cache dir, not next to the file', (t) => {
  const home = tempHome(t);
  const cacheBase = path.join(home, 'test-cache');
  const ctx = fakeCtx({
    homeDir: home,
    env: {
      XDG_CACHE_HOME: cacheBase,
      LOCALAPPDATA: cacheBase,
    },
  }, t);

  const configPath = path.join(home, 'config.json');
  fs.writeFileSync(configPath, '{\n  "original": true\n}\n', 'utf8');

  const file = readJsoncFile(configPath);
  assert.equal(file.ok, true);

  const change = planSetProperty(file, ['original'], false, 'Update original');
  const res = applyFileChange(ctx, change);
  if (!res.ok) assert.fail(res.error);

  const backupPath = res.backupPath;
  assert.ok(backupPath, 'backup path returned');
  assert.equal(fs.existsSync(backupPath), true, 'backup file exists');

  const cache = cacheDir(ctx);
  assert.ok(isInside(home, cache), 'cache dir stays inside the temp home');
  assert.ok(isInside(cache, backupPath), 'backup is under the cache dir');
  if (ctx.platform === 'linux' || ctx.platform === 'win32') {
    assert.ok(isInside(cacheBase, backupPath), 'backup follows XDG_CACHE_HOME or LOCALAPPDATA');
  }
  assert.equal(path.dirname(backupPath) === path.dirname(configPath), false, 'backup is not next to the file');

  const backupContent = fs.readFileSync(backupPath, 'utf8');
  assert.equal(backupContent, '{\n  "original": true\n}\n');

  const parentFiles = fs.readdirSync(path.dirname(configPath));
  const bakSiblings = parentFiles.filter((f) => f.endsWith('.bak') || f.includes('.bak'));
  assert.deepEqual(bakSiblings, [], 'no backup files next to the config file');
});
