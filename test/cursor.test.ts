import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { cursorAgent } from '../src/agents/cursor.js';
import { executePlan } from '../src/core/plan.js';
import { fakeCtx, tempHome, testAssets } from './helpers.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const fixturesDir = path.join(__dirname, 'fixtures', 'cursor');

test('cursor: empty.json produces file step and copy-skill step, creating entry and skill', async (t) => {
  const home = tempHome(t);
  const cursorDir = path.join(home, '.cursor');
  fs.mkdirSync(cursorDir, { recursive: true });

  const mcpJson = path.join(cursorDir, 'mcp.json');
  fs.copyFileSync(path.join(fixturesDir, 'empty.json'), mcpJson);

  const ctx = fakeCtx({ homeDir: home }, t);
  const assets = testAssets();
  const det = { found: true, executable: null };

  const plan = await cursorAgent.planInit(ctx, assets, det);
  assert.equal(plan.steps.some((s) => s.kind === 'file'), true, 'has file step');
  assert.equal(plan.steps.some((s) => s.kind === 'copy-skill'), true, 'has copy-skill step');

  const results = await executePlan(ctx, plan, () => null);
  assert.ok(results.every((r) => r.ok), 'all steps succeeded');

  // Verify mcp.json entry
  const parsed = JSON.parse(fs.readFileSync(mcpJson, 'utf8')) as {
    mcpServers: { specx: { url: string } };
  };
  assert.equal(parsed.mcpServers.specx.url, assets.mcp.url);

  // Verify skill file
  const skillFile = path.join(cursorDir, 'skills', 'specx', 'SKILL.md');
  assert.equal(fs.existsSync(skillFile), true, 'skill file exists');
  const skillText = fs.readFileSync(skillFile, 'utf8');
  assert.match(skillText, /<!-- specx-plugin: abc123 version: 9\.9\.9 -->/);
});

test('cursor: missing mcp.json produces file step and copy-skill step, creating entry and skill', async (t) => {
  const home = tempHome(t);
  const cursorDir = path.join(home, '.cursor');
  fs.mkdirSync(cursorDir, { recursive: true });
  const mcpJson = path.join(cursorDir, 'mcp.json');

  const ctx = fakeCtx({ homeDir: home }, t);
  const assets = testAssets();
  const det = { found: true, executable: null };

  const plan = await cursorAgent.planInit(ctx, assets, det);
  assert.equal(plan.steps.some((s) => s.kind === 'file'), true, 'has file step');
  assert.equal(plan.steps.some((s) => s.kind === 'copy-skill'), true, 'has copy-skill step');

  const results = await executePlan(ctx, plan, () => null);
  assert.ok(results.every((r) => r.ok), 'all steps succeeded');

  assert.equal(fs.existsSync(mcpJson), true, 'mcp.json created');
  const parsed = JSON.parse(fs.readFileSync(mcpJson, 'utf8')) as {
    mcpServers: { specx: { url: string } };
  };
  assert.equal(parsed.mcpServers.specx.url, assets.mcp.url);

  const skillFile = path.join(cursorDir, 'skills', 'specx', 'SKILL.md');
  assert.equal(fs.existsSync(skillFile), true);
  const skillText = fs.readFileSync(skillFile, 'utf8');
  assert.match(skillText, /<!-- specx-plugin: abc123 version: 9\.9\.9 -->/);
});

test('cursor: specx-local.json -> no file step, status has problem, file unchanged after init', async (t) => {
  const home = tempHome(t);
  const cursorDir = path.join(home, '.cursor');
  fs.mkdirSync(cursorDir, { recursive: true });

  const mcpJson = path.join(cursorDir, 'mcp.json');
  fs.copyFileSync(path.join(fixturesDir, 'specx-local.json'), mcpJson);
  const originalContent = fs.readFileSync(mcpJson, 'utf8');

  const ctx = fakeCtx({ homeDir: home }, t);
  const assets = testAssets();
  const det = { found: true, executable: null };

  const st = await cursorAgent.status(ctx, assets, det);
  assert.ok(
    st.problems.some((p) => p.includes('points to http://localhost:8765/mcp')),
    'status mentions points to http://localhost:8765/mcp',
  );

  const plan = await cursorAgent.planInit(ctx, assets, det);
  assert.equal(
    plan.steps.some((s) => s.kind === 'file'),
    false,
    'must not plan a file step to overwrite local entry',
  );

  await executePlan(ctx, plan, () => null);
  assert.equal(fs.readFileSync(mcpJson, 'utf8'), originalContent, 'file is unchanged');
});

test('cursor: owned.json with skill already installed -> every step skip', async (t) => {
  const home = tempHome(t);
  const cursorDir = path.join(home, '.cursor');
  const skillsDir = path.join(cursorDir, 'skills', 'specx');
  fs.mkdirSync(skillsDir, { recursive: true });

  const mcpJson = path.join(cursorDir, 'mcp.json');
  fs.copyFileSync(path.join(fixturesDir, 'owned.json'), mcpJson);

  const skillMd = path.join(skillsDir, 'SKILL.md');
  fs.writeFileSync(skillMd, '# SpecX Skill\n<!-- specx-plugin: abc123 version: 9.9.9 -->\n', 'utf8');

  const ctx = fakeCtx({ homeDir: home }, t);
  const assets = testAssets();
  const det = { found: true, executable: null };

  const plan = await cursorAgent.planInit(ctx, assets, det);
  assert.ok(plan.steps.length > 0, 'has steps');
  assert.ok(
    plan.steps.every((s) => s.kind === 'skip'),
    `all steps must be skip, got: ${JSON.stringify(plan.steps)}`,
  );
});

test('cursor: skills/specx folder without a marker fails copy-skill and remains unchanged', async (t) => {
  const home = tempHome(t);
  const cursorDir = path.join(home, '.cursor');
  const skillsDir = path.join(cursorDir, 'skills', 'specx');
  fs.mkdirSync(skillsDir, { recursive: true });

  const mcpJson = path.join(cursorDir, 'mcp.json');
  fs.copyFileSync(path.join(fixturesDir, 'empty.json'), mcpJson);

  const unmanagedContent = '# Custom User Skill\nNot created by SpecX\n';
  const skillMd = path.join(skillsDir, 'SKILL.md');
  fs.writeFileSync(skillMd, unmanagedContent, 'utf8');
  const before = fs.readdirSync(skillsDir).sort();

  const ctx = fakeCtx({ homeDir: home }, t);
  const assets = testAssets();
  const det = { found: true, executable: null };

  const plan = await cursorAgent.planInit(ctx, assets, det);
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

test('cursor: remove on owned.json + installed skill cleans up and removes leftover specx-setup', async (t) => {
  const home = tempHome(t);
  const cursorDir = path.join(home, '.cursor');
  const skillsDir = path.join(cursorDir, 'skills');
  const specxDir = path.join(skillsDir, 'specx');
  const setupDir = path.join(skillsDir, 'specx-setup');
  fs.mkdirSync(specxDir, { recursive: true });
  fs.mkdirSync(setupDir, { recursive: true });

  const mcpJson = path.join(cursorDir, 'mcp.json');
  fs.copyFileSync(path.join(fixturesDir, 'owned.json'), mcpJson);

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

  const plan = await cursorAgent.planRemove(ctx, assets, det);
  const results = await executePlan(ctx, plan, () => null);
  assert.ok(results.every((r) => r.ok), 'all remove steps succeeded');

  // Verify specx entry removed from mcp.json but github kept
  const parsed = JSON.parse(fs.readFileSync(mcpJson, 'utf8')) as {
    mcpServers: Record<string, unknown>;
  };
  assert.equal(parsed.mcpServers.specx, undefined, 'specx removed from mcpServers');
  assert.ok(parsed.mcpServers.github !== undefined, 'github remains in mcpServers');

  // Verify directories removed
  assert.equal(fs.existsSync(specxDir), false, 'specx skill dir removed');
  assert.equal(fs.existsSync(setupDir), false, 'leftover specx-setup dir removed');
});

test('cursor: broken.json -> single skip step, file unchanged', async (t) => {
  const home = tempHome(t);
  const cursorDir = path.join(home, '.cursor');
  fs.mkdirSync(cursorDir, { recursive: true });

  const mcpJson = path.join(cursorDir, 'mcp.json');
  fs.copyFileSync(path.join(fixturesDir, 'broken.json'), mcpJson);
  const originalContent = fs.readFileSync(mcpJson, 'utf8');

  const ctx = fakeCtx({ homeDir: home }, t);
  const assets = testAssets();
  const det = { found: true, executable: null };

  const plan = await cursorAgent.planInit(ctx, assets, det);
  assert.equal(plan.steps.length, 1, 'has exactly one step');
  assert.equal(plan.steps[0]?.kind, 'skip', 'the single step is skip');
  assert.ok(
    plan.steps[0]?.describe.includes("Cursor's mcp.json has errors"),
    `describe: ${plan.steps[0]?.describe}`,
  );

  await executePlan(ctx, plan, () => null);
  assert.equal(fs.readFileSync(mcpJson, 'utf8'), originalContent, 'file unchanged');
});
