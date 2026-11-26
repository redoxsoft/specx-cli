import assert from 'node:assert/strict';
import test from 'node:test';
import { claudeCodeAgent } from '../src/agents/claude-code.js';
import { fakeCtx, fakeRunner, testAssets } from './helpers.js';

const assets = testAssets();
const det = { found: true, executable: 'claude' };

test('claude-code: nothing installed -> plan is marketplace add + install with exact args', async (t) => {
  const runner = fakeRunner({
    'claude plugin list --json': { stdout: '[]' },
    'claude plugin marketplace list --json': { stdout: '[]' },
  }, t);
  const ctx = fakeCtx({ run: runner }, t);

  const plan = await claudeCodeAgent.planInit(ctx, assets, det);
  assert.equal(plan.steps.length, 2, 'has two steps');

  const step1 = plan.steps[0];
  assert.equal(step1?.kind, 'run');
  if (step1?.kind === 'run') {
    assert.equal(step1.command, 'claude');
    assert.deepEqual(step1.args, ['plugin', 'marketplace', 'add', assets.marketplace.gitUrl]);
  }

  const step2 = plan.steps[1];
  assert.equal(step2?.kind, 'run');
  if (step2?.kind === 'run') {
    assert.equal(step2.command, 'claude');
    assert.deepEqual(step2.args, ['plugin', 'install', assets.plugin.id, '--scope', 'user']);
  }
});

test('claude-code: marketplace present, plugin absent -> install only', async (t) => {
  const runner = fakeRunner({
    'claude plugin list --json': { stdout: '[]' },
    'claude plugin marketplace list --json': {
      stdout: JSON.stringify([{ name: assets.marketplace.name, url: assets.marketplace.gitUrl }]),
    },
  }, t);
  const ctx = fakeCtx({ run: runner }, t);

  const plan = await claudeCodeAgent.planInit(ctx, assets, det);
  assert.equal(plan.steps.length, 1, 'has only one step');

  const step = plan.steps[0];
  assert.equal(step?.kind, 'run');
  if (step?.kind === 'run') {
    assert.equal(step.command, 'claude');
    assert.deepEqual(step.args, ['plugin', 'install', assets.plugin.id, '--scope', 'user']);
  }
});

test('claude-code: installed at 9.9.9 -> plan skip, status plugin 9.9.9 and not outdated', async (t) => {
  const runner = fakeRunner({
    'claude plugin list --json': {
      stdout: JSON.stringify([
        { id: assets.plugin.id, version: '9.9.9', scope: 'user', enabled: true },
      ]),
    },
  }, t);
  const ctx = fakeCtx({ run: runner }, t);

  const plan = await claudeCodeAgent.planInit(ctx, assets, det);
  assert.equal(plan.steps.length, 1);
  assert.equal(plan.steps[0]?.kind, 'skip');

  const status = await claudeCodeAgent.status(ctx, assets, det);
  assert.equal(status.installed, 'plugin');
  assert.equal(status.version, '9.9.9');
  assert.equal(status.outdated, false);
});

test('claude-code: installed at 0.0.1 -> status outdated', async (t) => {
  const runner = fakeRunner({
    'claude plugin list --json': {
      stdout: JSON.stringify([
        { id: assets.plugin.id, version: '0.0.1', scope: 'user', enabled: true },
      ]),
    },
  }, t);
  const ctx = fakeCtx({ run: runner }, t);

  const status = await claudeCodeAgent.status(ctx, assets, det);
  assert.equal(status.installed, 'plugin');
  assert.equal(status.version, '0.0.1');
  assert.equal(status.outdated, true);
});

test('claude-code: list command fails (non-zero exit) -> status unknown, plan single skip', async (t) => {
  const runner = fakeRunner({
    'claude plugin list --json': { code: 1, stderr: 'network error or broken config' },
  }, t);
  const ctx = fakeCtx({ run: runner }, t);

  const status = await claudeCodeAgent.status(ctx, assets, det);
  assert.equal(status.installed, 'unknown');
  assert.ok(status.problems.length > 0);

  const plan = await claudeCodeAgent.planInit(ctx, assets, det);
  assert.equal(plan.steps.length, 1);
  assert.equal(plan.steps[0]?.kind, 'skip');
});

test('claude-code: list command fails (bad JSON) -> status unknown, plan single skip', async (t) => {
  const runner = fakeRunner({
    'claude plugin list --json': { stdout: 'This is not valid JSON!' },
  }, t);
  const ctx = fakeCtx({ run: runner }, t);

  const status = await claudeCodeAgent.status(ctx, assets, det);
  assert.equal(status.installed, 'unknown');
  assert.ok(status.problems.length > 0);

  const plan = await claudeCodeAgent.planInit(ctx, assets, det);
  assert.equal(plan.steps.length, 1);
  assert.equal(plan.steps[0]?.kind, 'skip');
});

test('claude-code: remove -> uninstall command, never marketplace remove', async (t) => {
  const runner = fakeRunner({
    'claude plugin list --json': {
      stdout: JSON.stringify([
        { id: assets.plugin.id, version: '9.9.9', scope: 'user', enabled: true },
      ]),
    },
  }, t);
  const ctx = fakeCtx({ run: runner }, t);

  const plan = await claudeCodeAgent.planRemove(ctx, assets, det);
  assert.equal(plan.steps.length, 1);

  const step = plan.steps[0];
  assert.equal(step?.kind, 'run');
  if (step?.kind === 'run') {
    assert.equal(step.command, 'claude');
    assert.deepEqual(step.args, ['plugin', 'uninstall', assets.plugin.id, '--scope', 'user']);
  }

  // Ensure no marketplace remove step exists
  for (const s of plan.steps) {
    if (s.kind === 'run') {
      assert.ok(!s.args.includes('marketplace'));
    }
  }
});
