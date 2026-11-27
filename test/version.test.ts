import assert from 'node:assert/strict';
import test from 'node:test';
import { compareVersions, isOlder, parseVersion } from '../src/core/version.js';

test('version: parseVersion parses semver and pre-releases', () => {
  assert.deepEqual(parseVersion('0.1.9'), { major: 0, minor: 1, patch: 9, prerelease: [] });
  assert.deepEqual(parseVersion('v0.1.10'), { major: 0, minor: 1, patch: 10, prerelease: [] });
  assert.deepEqual(parseVersion('1.2.3-rc.1'), { major: 1, minor: 2, patch: 3, prerelease: ['rc', '1'] });
  assert.deepEqual(parseVersion('1.2.3+build.1'), { major: 1, minor: 2, patch: 3, prerelease: [] });
  assert.deepEqual(parseVersion('invalid'), null);
});

test('version: compareVersions numeric major.minor.patch (0.1.10 > 0.1.9)', () => {
  assert.ok(compareVersions('0.1.10', '0.1.9') > 0);
  assert.ok(compareVersions('0.1.9', '0.1.10') < 0);
  assert.equal(compareVersions('0.1.9', '0.1.9'), 0);
  assert.ok(compareVersions('1.0.0', '0.9.9') > 0);
  assert.ok(compareVersions('0.2.0', '0.1.9') > 0);
});

test('version: compareVersions pre-release lower than release (0.1.1-rc.1 < 0.1.1)', () => {
  assert.ok(compareVersions('0.1.1-rc.1', '0.1.1') < 0);
  assert.ok(compareVersions('0.1.1', '0.1.1-rc.1') > 0);
  assert.equal(compareVersions('0.1.1-rc.1', '0.1.1-rc.1'), 0);
});

test('version: compareVersions pre-release identifier comparisons', () => {
  assert.ok(compareVersions('0.1.1-rc.1', '0.1.1-rc.2') < 0);
  assert.ok(compareVersions('0.1.1-rc.2', '0.1.1-rc.10') < 0);
  assert.ok(compareVersions('0.1.1-1', '0.1.1-alpha') < 0);
  assert.ok(compareVersions('0.1.1-alpha', '0.1.1-alpha.1') < 0);
  assert.ok(compareVersions('0.1.1-alpha', '0.1.1-beta') < 0);
});

test('version: compareVersions with leading v and build metadata', () => {
  assert.ok(compareVersions('v0.1.10', '0.1.9') > 0);
  assert.equal(compareVersions('1.0.0+abc', '1.0.0+xyz'), 0);
});

test('version: isOlder returns true only when first version is older than second', () => {
  assert.equal(isOlder('0.1.9', '0.1.10'), true);
  assert.equal(isOlder('0.1.10', '0.1.9'), false);
  assert.equal(isOlder('0.1.10', '0.1.10'), false);
  assert.equal(isOlder('0.1.1-rc.1', '0.1.1'), true);
  assert.equal(isOlder('0.1.1', '0.1.1-rc.1'), false);
});
