import assert from 'node:assert/strict';
import test from 'node:test';
import { codexAgent } from '../src/agents/codex.js';
import { fakeCtx, fakeRunner, testAssets } from './helpers.js';

const assets = testAssets();
const det = { found: true, executable: 'codex' };

test('codex: nothing installed -> plan is marketplace add + install with exact args', async (t) => {
  const runner = fakeRunner({
    'codex plugin list --marketplace specx --json': { stdout: '{"installed": []}' },
    'codex plugin marketplace list': { stdout: 'MARKETPLACE ROOT\n' },
  }, t);
  const ctx = fakeCtx({ run: runner }, t);

  const plan = await codexAgent.planInit(ctx, assets, det);
  assert.equal(plan.steps.length, 2, 'has two steps');

  const step1 = plan.steps[0];
  assert.equal(step1?.kind, 'run');
  if (step1?.kind === 'run') {
    assert.equal(step1.command, 'codex');
    assert.deepEqual(step1.args, ['plugin', 'marketplace', 'add', assets.marketplace.githubRepo]);
  }

  const step2 = plan.steps[1];
  assert.equal(step2?.kind, 'run');
  if (step2?.kind === 'run') {
    assert.equal(step2.command, 'codex');
    assert.deepEqual(step2.args, ['plugin', 'add', assets.plugin.id]);
  }
});

test('codex: marketplace present, plugin absent -> install only', async (t) => {
  const runner = fakeRunner({
    'codex plugin list --marketplace specx --json': { stdout: '{"installed": []}' },
    'codex plugin marketplace list': {
      stdout: `MARKETPLACE ROOT\n${assets.marketplace.name} github:${assets.marketplace.githubRepo}\n`,
    },
  }, t);
  const ctx = fakeCtx({ run: runner }, t);

  const plan = await codexAgent.planInit(ctx, assets, det);
  assert.equal(plan.steps.length, 1, 'has one step');

  const step = plan.steps[0];
  assert.equal(step?.kind, 'run');
  if (step?.kind === 'run') {
    assert.equal(step.command, 'codex');
    assert.deepEqual(step.args, ['plugin', 'add', assets.plugin.id]);
  }
});

test('codex: installed at 9.9.9 -> plan skip, status plugin 9.9.9 and not outdated', async (t) => {
  const runner = fakeRunner({
    'codex plugin list --marketplace specx --json': {
      stdout: JSON.stringify({
        installed: [
          { pluginId: assets.plugin.id, version: '9.9.9', enabled: true },
        ],
      }),
    },
  }, t);
  const ctx = fakeCtx({ run: runner }, t);

  const plan = await codexAgent.planInit(ctx, assets, det);
  assert.equal(plan.steps.length, 1);
  assert.equal(plan.steps[0]?.kind, 'skip');

  const status = await codexAgent.status(ctx, assets, det);
  assert.equal(status.installed, 'plugin');
  assert.equal(status.version, '9.9.9');
  assert.equal(status.outdated, false);
});

test('codex: installed at 0.0.1 -> status outdated', async (t) => {
  const runner = fakeRunner({
    'codex plugin list --marketplace specx --json': {
      stdout: JSON.stringify({
        installed: [
          { pluginId: assets.plugin.id, version: '0.0.1', enabled: true },
        ],
      }),
    },
  }, t);
  const ctx = fakeCtx({ run: runner }, t);

  const status = await codexAgent.status(ctx, assets, det);
  assert.equal(status.installed, 'plugin');
  assert.equal(status.version, '0.0.1');
  assert.equal(status.outdated, true);
});

test('codex: list command fails (non-zero exit) -> status unknown, plan single skip', async (t) => {
  const runner = fakeRunner({
    'codex plugin list --marketplace specx --json': { code: 1, stderr: 'some crash' },
  }, t);
  const ctx = fakeCtx({ run: runner }, t);

  const status = await codexAgent.status(ctx, assets, det);
  assert.equal(status.installed, 'unknown');
  assert.ok(status.problems.length > 0);

  const plan = await codexAgent.planInit(ctx, assets, det);
  assert.equal(plan.steps.length, 1);
  assert.equal(plan.steps[0]?.kind, 'skip');
});

test('codex: list command fails (bad JSON) -> status unknown, plan single skip', async (t) => {
  const runner = fakeRunner({
    'codex plugin list --marketplace specx --json': { stdout: 'not json' },
  }, t);
  const ctx = fakeCtx({ run: runner }, t);

  const status = await codexAgent.status(ctx, assets, det);
  assert.equal(status.installed, 'unknown');
  assert.ok(status.problems.length > 0);

  const plan = await codexAgent.planInit(ctx, assets, det);
  assert.equal(plan.steps.length, 1);
  assert.equal(plan.steps[0]?.kind, 'skip');
});

test('codex: remove -> remove command, never marketplace remove', async (t) => {
  const runner = fakeRunner({
    'codex plugin list --marketplace specx --json': {
      stdout: JSON.stringify({
        installed: [
          { pluginId: assets.plugin.id, version: '9.9.9', enabled: true },
        ],
      }),
    },
  }, t);
  const ctx = fakeCtx({ run: runner }, t);

  const plan = await codexAgent.planRemove(ctx, assets, det);
  assert.equal(plan.steps.length, 1);

  const step = plan.steps[0];
  assert.equal(step?.kind, 'run');
  if (step?.kind === 'run') {
    assert.equal(step.command, 'codex');
    assert.deepEqual(step.args, ['plugin', 'remove', assets.plugin.id]);
  }

  // Ensure no marketplace remove step exists
  for (const s of plan.steps) {
    if (s.kind === 'run') {
      assert.ok(!s.args.includes('marketplace'));
    }
  }
});
