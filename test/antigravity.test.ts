import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { antigravityAgent } from '../src/agents/antigravity.js';
import { executePlan } from '../src/core/plan.js';
import { fakeCtx, tempHome, testAssets } from './helpers.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const fixturesDir = path.join(__dirname, 'fixtures', 'antigravity');

test('antigravity: empty.json produces file step and copy-skill step, creating entry and skill', async (t) => {
  const home = tempHome(t);
  const configDir = path.join(home, '.gemini', 'config');
  fs.mkdirSync(configDir, { recursive: true });

  const mcpConfigJson = path.join(configDir, 'mcp_config.json');
  fs.copyFileSync(path.join(fixturesDir, 'empty.json'), mcpConfigJson);

  const ctx = fakeCtx({ homeDir: home }, t);
  const assets = testAssets();
  const det = { found: true, executable: null };

  const plan = await antigravityAgent.planInit(ctx, assets, det);
  assert.equal(plan.steps.some((s) => s.kind === 'file'), true, 'has file step');
  assert.equal(plan.steps.some((s) => s.kind === 'copy-skill'), true, 'has copy-skill step');

  const results = await executePlan(ctx, plan, () => null);
  assert.ok(results.every((r) => r.ok), 'all steps succeeded');

  // Verify mcp_config.json entry
  const parsed = JSON.parse(fs.readFileSync(mcpConfigJson, 'utf8')) as {
    mcpServers: { specx: { serverUrl: string } };
  };
  assert.equal(parsed.mcpServers.specx.serverUrl, assets.mcp.url);

  // Verify skill file
  const skillFile = path.join(configDir, 'skills', 'specx', 'SKILL.md');
  assert.equal(fs.existsSync(skillFile), true, 'skill file exists');
  const skillText = fs.readFileSync(skillFile, 'utf8');
  assert.match(skillText, /<!-- specx-plugin: abc123 version: 9\.9\.9 -->/);
});

test('antigravity: missing mcp_config.json produces file step and copy-skill step, creating entry and skill', async (t) => {
  const home = tempHome(t);
  const configDir = path.join(home, '.gemini', 'config');
  fs.mkdirSync(configDir, { recursive: true });
  const mcpConfigJson = path.join(configDir, 'mcp_config.json');

  const ctx = fakeCtx({ homeDir: home }, t);
  const assets = testAssets();
  const det = { found: true, executable: null };

  const plan = await antigravityAgent.planInit(ctx, assets, det);
  assert.equal(plan.steps.some((s) => s.kind === 'file'), true, 'has file step');
  assert.equal(plan.steps.some((s) => s.kind === 'copy-skill'), true, 'has copy-skill step');

  const results = await executePlan(ctx, plan, () => null);
  assert.ok(results.every((r) => r.ok), 'all steps succeeded');

  assert.equal(fs.existsSync(mcpConfigJson), true, 'mcp_config.json created');
  const parsed = JSON.parse(fs.readFileSync(mcpConfigJson, 'utf8')) as {
    mcpServers: { specx: { serverUrl: string } };
  };
  assert.equal(parsed.mcpServers.specx.serverUrl, assets.mcp.url);

  const skillFile = path.join(configDir, 'skills', 'specx', 'SKILL.md');
  assert.equal(fs.existsSync(skillFile), true);
  const skillText = fs.readFileSync(skillFile, 'utf8');
  assert.match(skillText, /<!-- specx-plugin: abc123 version: 9\.9\.9 -->/);
});

test('antigravity: specx-local.json -> no file step, status has problem, file unchanged after init', async (t) => {
  const home = tempHome(t);
  const configDir = path.join(home, '.gemini', 'config');
  fs.mkdirSync(configDir, { recursive: true });

  const mcpConfigJson = path.join(configDir, 'mcp_config.json');
  fs.copyFileSync(path.join(fixturesDir, 'specx-local.json'), mcpConfigJson);
  const originalContent = fs.readFileSync(mcpConfigJson, 'utf8');

  const ctx = fakeCtx({ homeDir: home }, t);
  const assets = testAssets();
  const det = { found: true, executable: null };

  const st = await antigravityAgent.status(ctx, assets, det);
  assert.ok(
    st.problems.some((p) => p.includes('points to http://localhost:8765/mcp')),
    'status mentions points to http://localhost:8765/mcp',
  );

  const plan = await antigravityAgent.planInit(ctx, assets, det);
  assert.equal(
    plan.steps.some((s) => s.kind === 'file'),
    false,
    'must not plan a file step to overwrite local entry',
  );

  await executePlan(ctx, plan, () => null);
  assert.equal(fs.readFileSync(mcpConfigJson, 'utf8'), originalContent, 'file is unchanged');
});

test('antigravity: owned.json with skill already installed -> every step skip', async (t) => {
  const home = tempHome(t);
  const configDir = path.join(home, '.gemini', 'config');
  const skillsDir = path.join(configDir, 'skills', 'specx');
  fs.mkdirSync(skillsDir, { recursive: true });

  const mcpConfigJson = path.join(configDir, 'mcp_config.json');
  fs.copyFileSync(path.join(fixturesDir, 'owned.json'), mcpConfigJson);

  const skillMd = path.join(skillsDir, 'SKILL.md');
  fs.writeFileSync(skillMd, '# SpecX Skill\n<!-- specx-plugin: abc123 version: 9.9.9 -->\n', 'utf8');

  const ctx = fakeCtx({ homeDir: home }, t);
  const assets = testAssets();
  const det = { found: true, executable: null };

  const plan = await antigravityAgent.planInit(ctx, assets, det);
  assert.ok(plan.steps.length > 0, 'has steps');
  assert.ok(
    plan.steps.every((s) => s.kind === 'skip'),
    `all steps must be skip, got: ${JSON.stringify(plan.steps)}`,
  );
});

test('antigravity: skills/specx folder without a marker fails copy-skill and remains unchanged', async (t) => {
  const home = tempHome(t);
  const configDir = path.join(home, '.gemini', 'config');
  const skillsDir = path.join(configDir, 'skills', 'specx');
  fs.mkdirSync(skillsDir, { recursive: true });

  const mcpConfigJson = path.join(configDir, 'mcp_config.json');
  fs.copyFileSync(path.join(fixturesDir, 'empty.json'), mcpConfigJson);

  const unmanagedContent = '# Custom User Skill\nNot created by SpecX\n';
  const skillMd = path.join(skillsDir, 'SKILL.md');
  fs.writeFileSync(skillMd, unmanagedContent, 'utf8');
  const before = fs.readdirSync(skillsDir).sort();

  const ctx = fakeCtx({ homeDir: home }, t);
  const assets = testAssets();
  const det = { found: true, executable: null };

  const plan = await antigravityAgent.planInit(ctx, assets, det);
  const results = await executePlan(ctx, plan, () => null);

  const copyResult = results.find((r) => r.step.kind === 'copy-skill');
  assert.ok(copyResult, 'has copy-skill result');
  assert.equal(copyResult.ok, false, 'copy-skill must fail');
  assert.ok(
    copyResult.error?.includes("wasn't installed by SpecX"),
    `error message: ${copyResult.error}`,
  );

  assert.deepEqual(fs.readdirSync(skillsDir).sort(), before, 'skill folder is unchanged');
  assert.equal(fs.readFileSync(skillMd, 'utf8'), unmanagedContent);
});

test('antigravity: remove on owned.json + installed skill cleans up and removes leftover specx-setup', async (t) => {
  const home = tempHome(t);
  const configDir = path.join(home, '.gemini', 'config');
  const skillsDir = path.join(configDir, 'skills');
  const specxDir = path.join(skillsDir, 'specx');
  const setupDir = path.join(skillsDir, 'specx-setup');
  fs.mkdirSync(specxDir, { recursive: true });
  fs.mkdirSync(setupDir, { recursive: true });

  const mcpConfigJson = path.join(configDir, 'mcp_config.json');
  fs.copyFileSync(path.join(fixturesDir, 'owned.json'), mcpConfigJson);

  fs.writeFileSync(
    path.join(specxDir, 'SKILL.md'),
    '# SpecX\n<!-- specx-plugin: abc123 version: 9.9.9 -->\n',
    'utf8',
  );
  fs.writeFileSync(
    path.join(setupDir, 'SKILL.md'),
    '# SpecX Setup\n<!-- specx-plugin: abc123 version: 9.9.9 -->\n',
    'utf8',
  );

  const ctx = fakeCtx({ homeDir: home }, t);
  const assets = testAssets();
  const det = { found: true, executable: null };

  const plan = await antigravityAgent.planRemove(ctx, assets, det);
  const results = await executePlan(ctx, plan, () => null);
  assert.ok(results.every((r) => r.ok), 'all remove steps succeeded');

  // Verify specx entry removed from mcp_config.json but github kept
  const parsed = JSON.parse(fs.readFileSync(mcpConfigJson, 'utf8')) as {
    mcpServers: Record<string, unknown>;
  };
  assert.equal(parsed.mcpServers.specx, undefined, 'specx removed from mcpServers');
  assert.ok(parsed.mcpServers.github !== undefined, 'github remains in mcpServers');

  // Verify directories removed
  assert.equal(fs.existsSync(specxDir), false, 'specx skill dir removed');
  assert.equal(fs.existsSync(setupDir), false, 'leftover specx-setup dir removed');
});

test('antigravity: broken.json -> single skip step, file unchanged', async (t) => {
  const home = tempHome(t);
  const configDir = path.join(home, '.gemini', 'config');
  fs.mkdirSync(configDir, { recursive: true });

  const mcpConfigJson = path.join(configDir, 'mcp_config.json');
  fs.copyFileSync(path.join(fixturesDir, 'broken.json'), mcpConfigJson);
  const originalContent = fs.readFileSync(mcpConfigJson, 'utf8');

  const ctx = fakeCtx({ homeDir: home }, t);
  const assets = testAssets();
  const det = { found: true, executable: null };

  const plan = await antigravityAgent.planInit(ctx, assets, det);
  assert.equal(plan.steps.length, 1, 'has exactly one step');
  assert.equal(plan.steps[0]?.kind, 'skip', 'the single step is skip');
  assert.ok(
    plan.steps[0]?.describe.includes("Antigravity's mcp_config.json has errors"),
    `describe: ${plan.steps[0]?.describe}`,
  );

  await executePlan(ctx, plan, () => null);
  assert.equal(fs.readFileSync(mcpConfigJson, 'utf8'), originalContent, 'file unchanged');
});

test('antigravity: with-url-secret.json -> secret not leaked in status or plan', async (t) => {
  const home = tempHome(t);
  const configDir = path.join(home, '.gemini', 'config');
  fs.mkdirSync(configDir, { recursive: true });

  const mcpConfigJson = path.join(configDir, 'mcp_config.json');
  fs.copyFileSync(path.join(fixturesDir, 'with-url-secret.json'), mcpConfigJson);

  const ctx = fakeCtx({ homeDir: home }, t);
  const assets = testAssets();
  const det = { found: true, executable: null };

  const st = await antigravityAgent.status(ctx, assets, det);
  assert.ok(
    st.problems.some((p) => p.includes('points to http://localhost:8765/mcp')),
    'status mentions points to http://localhost:8765/mcp',
  );
  assert.equal(
    st.problems.some((p) => p.includes('SECRET-URL-1') || p.includes('apiKey')),
    false,
    'status must not leak secret from URL query',
  );

  const initPlan = await antigravityAgent.planInit(ctx, assets, det);
  assert.equal(
    initPlan.steps.some((s) => s.kind === 'file'),
    false,
    'must not plan a file step to overwrite foreign entry',
  );
  for (const step of initPlan.steps) {
    if (step.kind === 'skip') {
      assert.equal(
        step.describe.includes('SECRET-URL-1') || step.describe.includes('apiKey'),
        false,
        'init step describe must not leak secret',
      );
    }
  }

  const removePlan = await antigravityAgent.planRemove(ctx, assets, det);
  for (const step of removePlan.steps) {
    if (step.kind === 'skip') {
      assert.equal(
        step.describe.includes('SECRET-URL-1') || step.describe.includes('apiKey'),
        false,
        'remove step describe must not leak secret',
      );
    }
  }
});
