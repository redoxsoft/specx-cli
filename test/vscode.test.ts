import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { vscodeAgent } from '../src/agents/vscode.js';
import { executePlan } from '../src/core/plan.js';
import { fakeCtx, makeAgentExecutable, tempHome, testAssets } from './helpers.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const fixturesDir = path.join(__dirname, 'fixtures', 'vscode');

test('vscode: empty.json produces file step and copy-skill step, creating entry and skill', async (t) => {
  const home = tempHome(t);
  const copilotDir = path.join(home, '.copilot');
  fs.mkdirSync(copilotDir, { recursive: true });

  const mcpConfigJson = path.join(copilotDir, 'mcp-config.json');
  fs.copyFileSync(path.join(fixturesDir, 'empty.json'), mcpConfigJson);

  const ctx = fakeCtx({ homeDir: home }, t);
  const assets = testAssets();
  const det = { found: true, executable: null };

  const plan = await vscodeAgent.planInit(ctx, assets, det);
  assert.equal(plan.steps.some((s) => s.kind === 'file'), true, 'has file step');
  assert.equal(plan.steps.some((s) => s.kind === 'copy-skill'), true, 'has copy-skill step');

  const results = await executePlan(ctx, plan, () => null);
  assert.ok(results.every((r) => r.ok), 'all steps succeeded');

  // Verify mcp-config.json entry
  const parsed = JSON.parse(fs.readFileSync(mcpConfigJson, 'utf8')) as {
    mcpServers: { specx: { type: string; url: string } };
  };
  assert.equal(parsed.mcpServers.specx.type, 'http');
  assert.equal(parsed.mcpServers.specx.url, assets.mcp.url);

  // Verify skill file
  const skillFile = path.join(copilotDir, 'skills', 'specx', 'SKILL.md');
  assert.equal(fs.existsSync(skillFile), true, 'skill file exists');
  const skillText = fs.readFileSync(skillFile, 'utf8');
  assert.match(skillText, /<!-- specx-plugin: abc123 version: 9\.9\.9 -->/);
});

test('vscode: missing mcp-config.json produces file step and copy-skill step, creating entry and skill', async (t) => {
  const home = tempHome(t);
  const copilotDir = path.join(home, '.copilot');
  fs.mkdirSync(copilotDir, { recursive: true });
  const mcpConfigJson = path.join(copilotDir, 'mcp-config.json');

  const ctx = fakeCtx({ homeDir: home }, t);
  const assets = testAssets();
  const det = { found: true, executable: null };

  const plan = await vscodeAgent.planInit(ctx, assets, det);
  assert.equal(plan.steps.some((s) => s.kind === 'file'), true, 'has file step');
  assert.equal(plan.steps.some((s) => s.kind === 'copy-skill'), true, 'has copy-skill step');

  const results = await executePlan(ctx, plan, () => null);
  assert.ok(results.every((r) => r.ok), 'all steps succeeded');

  assert.equal(fs.existsSync(mcpConfigJson), true, 'mcp-config.json created');
  const parsed = JSON.parse(fs.readFileSync(mcpConfigJson, 'utf8')) as {
    mcpServers: { specx: { type: string; url: string } };
  };
  assert.equal(parsed.mcpServers.specx.type, 'http');
  assert.equal(parsed.mcpServers.specx.url, assets.mcp.url);

  const skillFile = path.join(copilotDir, 'skills', 'specx', 'SKILL.md');
  assert.equal(fs.existsSync(skillFile), true);
  const skillText = fs.readFileSync(skillFile, 'utf8');
  assert.match(skillText, /<!-- specx-plugin: abc123 version: 9\.9\.9 -->/);
});

test('vscode: specx-local.json -> no file step, status has problem, file unchanged after init', async (t) => {
  const home = tempHome(t);
  const copilotDir = path.join(home, '.copilot');
  fs.mkdirSync(copilotDir, { recursive: true });

  const mcpConfigJson = path.join(copilotDir, 'mcp-config.json');
  fs.copyFileSync(path.join(fixturesDir, 'specx-local.json'), mcpConfigJson);
  const originalContent = fs.readFileSync(mcpConfigJson, 'utf8');

  const ctx = fakeCtx({ homeDir: home }, t);
  const assets = testAssets();
  const det = { found: true, executable: null };

  const st = await vscodeAgent.status(ctx, assets, det);
  assert.ok(
    st.problems.some((p) => p.includes('points to http://localhost:8765/mcp')),
    'status mentions points to http://localhost:8765/mcp',
  );

  const plan = await vscodeAgent.planInit(ctx, assets, det);
  assert.equal(
    plan.steps.some((s) => s.kind === 'file'),
    false,
    'must not plan a file step to overwrite local entry',
  );

  await executePlan(ctx, plan, () => null);
  assert.equal(fs.readFileSync(mcpConfigJson, 'utf8'), originalContent, 'file is unchanged');
});

test('vscode: owned.json with skill already installed -> every step skip', async (t) => {
  const home = tempHome(t);
  const copilotDir = path.join(home, '.copilot');
  const skillsDir = path.join(copilotDir, 'skills', 'specx');
  fs.mkdirSync(skillsDir, { recursive: true });

  const mcpConfigJson = path.join(copilotDir, 'mcp-config.json');
  fs.copyFileSync(path.join(fixturesDir, 'owned.json'), mcpConfigJson);

  const skillMd = path.join(skillsDir, 'SKILL.md');
  fs.writeFileSync(skillMd, '# SpecX Skill\n<!-- specx-plugin: abc123 version: 9.9.9 -->\n', 'utf8');

  const ctx = fakeCtx({ homeDir: home }, t);
  const assets = testAssets();
  const det = { found: true, executable: null };

  const plan = await vscodeAgent.planInit(ctx, assets, det);
  assert.ok(plan.steps.length > 0, 'has steps');
  assert.ok(
    plan.steps.every((s) => s.kind === 'skip'),
    `all steps must be skip, got: ${JSON.stringify(plan.steps)}`,
  );
});

test('vscode: skills/specx folder without a marker fails copy-skill and remains unchanged', async (t) => {
  const home = tempHome(t);
  const copilotDir = path.join(home, '.copilot');
  const skillsDir = path.join(copilotDir, 'skills', 'specx');
  fs.mkdirSync(skillsDir, { recursive: true });

  const mcpConfigJson = path.join(copilotDir, 'mcp-config.json');
  fs.copyFileSync(path.join(fixturesDir, 'empty.json'), mcpConfigJson);

  const unmanagedContent = '# Custom User Skill\nNot created by SpecX\n';
  const skillMd = path.join(skillsDir, 'SKILL.md');
  fs.writeFileSync(skillMd, unmanagedContent, 'utf8');
  const before = fs.readdirSync(skillsDir).sort();

  const ctx = fakeCtx({ homeDir: home }, t);
  const assets = testAssets();
  const det = { found: true, executable: null };

  const plan = await vscodeAgent.planInit(ctx, assets, det);
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

test('vscode: remove on owned.json + installed skill cleans up and removes leftover specx-setup', async (t) => {
  const home = tempHome(t);
  const copilotDir = path.join(home, '.copilot');
  const skillsDir = path.join(copilotDir, 'skills');
  const specxDir = path.join(skillsDir, 'specx');
  const setupDir = path.join(skillsDir, 'specx-setup');
  fs.mkdirSync(specxDir, { recursive: true });
  fs.mkdirSync(setupDir, { recursive: true });

  const mcpConfigJson = path.join(copilotDir, 'mcp-config.json');
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

  const plan = await vscodeAgent.planRemove(ctx, assets, det);
  const results = await executePlan(ctx, plan, () => null);
  assert.ok(results.every((r) => r.ok), 'all remove steps succeeded');

  // Verify specx entry removed from mcp-config.json but github kept
  const parsed = JSON.parse(fs.readFileSync(mcpConfigJson, 'utf8')) as {
    mcpServers: Record<string, unknown>;
  };
  assert.equal(parsed.mcpServers.specx, undefined, 'specx removed from mcpServers');
  assert.ok(parsed.mcpServers.github !== undefined, 'github remains in mcpServers');

  // Verify directories removed
  assert.equal(fs.existsSync(specxDir), false, 'specx skill dir removed');
  assert.equal(fs.existsSync(setupDir), false, 'leftover specx-setup dir removed');
});

test('vscode: broken.json -> single skip step, file unchanged', async (t) => {
  const home = tempHome(t);
  const copilotDir = path.join(home, '.copilot');
  fs.mkdirSync(copilotDir, { recursive: true });

  const mcpConfigJson = path.join(copilotDir, 'mcp-config.json');
  fs.copyFileSync(path.join(fixturesDir, 'broken.json'), mcpConfigJson);
  const originalContent = fs.readFileSync(mcpConfigJson, 'utf8');

  const ctx = fakeCtx({ homeDir: home }, t);
  const assets = testAssets();
  const det = { found: true, executable: null };

  const plan = await vscodeAgent.planInit(ctx, assets, det);
  assert.equal(plan.steps.length, 1, 'has exactly one step');
  assert.equal(plan.steps[0]?.kind, 'skip', 'the single step is skip');
  assert.ok(
    plan.steps[0]?.describe.includes("VS Code / Copilot's mcp-config.json has errors"),
    `describe: ${plan.steps[0]?.describe}`,
  );

  await executePlan(ctx, plan, () => null);
  assert.equal(fs.readFileSync(mcpConfigJson, 'utf8'), originalContent, 'file unchanged');
});

test('vscode: with-url-secret.json -> secret not leaked in status or plan', async (t) => {
  const home = tempHome(t);
  const copilotDir = path.join(home, '.copilot');
  fs.mkdirSync(copilotDir, { recursive: true });

  const mcpConfigJson = path.join(copilotDir, 'mcp-config.json');
  fs.copyFileSync(path.join(fixturesDir, 'with-url-secret.json'), mcpConfigJson);

  const ctx = fakeCtx({ homeDir: home }, t);
  const assets = testAssets();
  const det = { found: true, executable: null };

  const st = await vscodeAgent.status(ctx, assets, det);
  assert.ok(
    st.problems.some((p) => p.includes('points to http://localhost:8765/mcp')),
    'status mentions points to http://localhost:8765/mcp',
  );
  assert.equal(
    st.problems.some((p) => p.includes('SECRET-URL-1') || p.includes('apiKey')),
    false,
    'status must not leak secret from URL query',
  );

  const initPlan = await vscodeAgent.planInit(ctx, assets, det);
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

  const removePlan = await vscodeAgent.planRemove(ctx, assets, det);
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

test('vscode: detect finds executable code or copilot in PATH, and homeMarker in COPILOT_HOME or default', async (t) => {
  // 1. code in PATH
  {
    const home = tempHome(t);
    const ctx = fakeCtx({ homeDir: home }, t);
    makeAgentExecutable(ctx.tempBinDir, 'code', ctx.platform);
    const det = vscodeAgent.detect(ctx);
    assert.equal(det.found, true);
    assert.ok(det.executable?.includes('code'));
  }

  // 2. copilot in PATH
  {
    const home = tempHome(t);
    const ctx = fakeCtx({ homeDir: home }, t);
    makeAgentExecutable(ctx.tempBinDir, 'copilot', ctx.platform);
    const det = vscodeAgent.detect(ctx);
    assert.equal(det.found, true);
    assert.ok(det.executable?.includes('copilot'));
  }

  // 3. No executable, but ~/.copilot directory exists
  {
    const home = tempHome(t);
    fs.mkdirSync(path.join(home, '.copilot'), { recursive: true });
    const ctx = fakeCtx({ homeDir: home }, t);
    const det = vscodeAgent.detect(ctx);
    assert.equal(det.found, true);
    assert.equal(det.executable, null);
  }

  // 4. No executable and no directory
  {
    const home = tempHome(t);
    const ctx = fakeCtx({ homeDir: home }, t);
    const det = vscodeAgent.detect(ctx);
    assert.equal(det.found, false);
    assert.equal(det.executable, null);
  }
});

test('vscode: COPILOT_HOME respected for detection, config and skills', async (t) => {
  const home = tempHome(t);
  const customCopilotHome = path.join(home, 'custom-copilot');
  fs.mkdirSync(customCopilotHome, { recursive: true });

  const ctx = fakeCtx({
    homeDir: home,
    env: { COPILOT_HOME: customCopilotHome },
  }, t);
  const assets = testAssets();

  // Detection respects COPILOT_HOME
  const det = vscodeAgent.detect(ctx);
  assert.equal(det.found, true);
  assert.equal(det.executable, null);

  // PlanInit writes to COPILOT_HOME
  const plan = await vscodeAgent.planInit(ctx, assets, det);
  const mcpStep = plan.steps.find((s) => s.kind === 'file');
  assert.ok(mcpStep && mcpStep.kind === 'file');
  assert.equal(mcpStep.change.path, path.join(customCopilotHome, 'mcp-config.json'));

  const skillStep = plan.steps.find((s) => s.kind === 'copy-skill');
  assert.ok(skillStep && skillStep.kind === 'copy-skill');
  assert.equal(skillStep.destDir, path.join(customCopilotHome, 'skills', 'specx'));

  await executePlan(ctx, plan, () => null);

  // Verify file created in customCopilotHome, not home/.copilot
  assert.equal(fs.existsSync(path.join(customCopilotHome, 'mcp-config.json')), true);
  assert.equal(fs.existsSync(path.join(customCopilotHome, 'skills', 'specx', 'SKILL.md')), true);
  assert.equal(fs.existsSync(path.join(home, '.copilot')), false, '~/.copilot must not be created');

  // Status reads from customCopilotHome
  const st = await vscodeAgent.status(ctx, assets, det);
  assert.equal(st.installed, 'files');
  assert.equal(st.version, '9.9.9');

  // PlanRemove removes from customCopilotHome
  const removePlan = await vscodeAgent.planRemove(ctx, assets, det);
  await executePlan(ctx, removePlan, () => null);
  assert.equal(fs.existsSync(path.join(customCopilotHome, 'skills', 'specx')), false);
  const parsed = JSON.parse(fs.readFileSync(path.join(customCopilotHome, 'mcp-config.json'), 'utf8')) as {
    mcpServers: Record<string, unknown>;
  };
  assert.equal(parsed.mcpServers.specx, undefined);
});

test('vscode: update -> respects state table (outdated skill, current skill, broken config, not installed)', async (t) => {
  const assets = testAssets();
  const det = { found: true, executable: null };

  // 1. Broken config -> skip with problem
  {
    const home = tempHome(t);
    const copilotDir = path.join(home, '.copilot');
    fs.mkdirSync(copilotDir, { recursive: true });
    fs.copyFileSync(path.join(fixturesDir, 'broken.json'), path.join(copilotDir, 'mcp-config.json'));
    const ctx = fakeCtx({ homeDir: home }, t);
    const plan = await vscodeAgent.planUpdate(ctx, assets, det);
    assert.equal(plan.steps.length, 1);
    const step = plan.steps[0];
    assert.ok(step && step.kind === 'skip');
    assert.equal(step.problem, true);
    assert.match(step.describe, /VS Code \/ Copilot's mcp-config\.json has errors; fix it and run again/);
  }

  // 2. Not installed -> skip "not installed; run `npx specx-cli@latest init`"
  {
    const home = tempHome(t);
    const copilotDir = path.join(home, '.copilot');
    fs.mkdirSync(copilotDir, { recursive: true });
    fs.copyFileSync(path.join(fixturesDir, 'empty.json'), path.join(copilotDir, 'mcp-config.json'));
    const ctx = fakeCtx({ homeDir: home }, t);
    const plan = await vscodeAgent.planUpdate(ctx, assets, det);
    assert.equal(plan.steps.length, 1);
    const step = plan.steps[0];
    assert.ok(step && step.kind === 'skip');
    assert.equal(step.problem, undefined);
    assert.equal(step.describe, 'not installed; run `npx specx-cli@latest init`');
  }

  // 3. Outdated skill -> copy-skill step
  {
    const home = tempHome(t);
    const copilotDir = path.join(home, '.copilot');
    const skillDir = path.join(copilotDir, 'skills', 'specx');
    fs.mkdirSync(skillDir, { recursive: true });
    fs.copyFileSync(path.join(fixturesDir, 'owned.json'), path.join(copilotDir, 'mcp-config.json'));
    fs.writeFileSync(
      path.join(skillDir, 'SKILL.md'),
      '# SpecX\n<!-- specx-plugin: abc version: 0.0.1 -->\n',
      'utf8',
    );
    const ctx = fakeCtx({ homeDir: home }, t);
    const plan = await vscodeAgent.planUpdate(ctx, assets, det);
    const copies = plan.steps.filter((s) => s.kind === 'copy-skill');
    assert.equal(copies.length, 1);
    assert.equal(copies[0]?.kind === 'copy-skill' ? copies[0].destDir : '', skillDir);
  }

  // 4. Marker without version -> copy-skill step
  {
    const home = tempHome(t);
    const copilotDir = path.join(home, '.copilot');
    const skillDir = path.join(copilotDir, 'skills', 'specx');
    fs.mkdirSync(skillDir, { recursive: true });
    fs.copyFileSync(path.join(fixturesDir, 'owned.json'), path.join(copilotDir, 'mcp-config.json'));
    fs.writeFileSync(
      path.join(skillDir, 'SKILL.md'),
      '# SpecX\n<!-- specx-plugin: abc -->\n',
      'utf8',
    );
    const ctx = fakeCtx({ homeDir: home }, t);
    const plan = await vscodeAgent.planUpdate(ctx, assets, det);
    assert.ok(plan.steps.some((s) => s.kind === 'copy-skill'));
  }

  // 5. Up to date -> skip "up to date"
  {
    const home = tempHome(t);
    const copilotDir = path.join(home, '.copilot');
    const skillDir = path.join(copilotDir, 'skills', 'specx');
    fs.mkdirSync(skillDir, { recursive: true });
    fs.copyFileSync(path.join(fixturesDir, 'owned.json'), path.join(copilotDir, 'mcp-config.json'));
    fs.writeFileSync(
      path.join(skillDir, 'SKILL.md'),
      '# SpecX\n<!-- specx-plugin: abc version: 9.9.9 -->\n',
      'utf8',
    );
    const ctx = fakeCtx({ homeDir: home }, t);
    const plan = await vscodeAgent.planUpdate(ctx, assets, det);
    assert.equal(plan.steps.length, 1);
    const step = plan.steps[0];
    assert.ok(step && step.kind === 'skip');
    assert.equal(step.problem, undefined);
    assert.equal(step.describe, 'up to date');
  }

  // 6. Unmanaged skill folder without marker -> problem skip
  {
    const home = tempHome(t);
    const copilotDir = path.join(home, '.copilot');
    const skillDir = path.join(copilotDir, 'skills', 'specx');
    fs.mkdirSync(skillDir, { recursive: true });
    fs.copyFileSync(path.join(fixturesDir, 'empty.json'), path.join(copilotDir, 'mcp-config.json'));
    fs.writeFileSync(path.join(skillDir, 'SKILL.md'), '# Custom skill without marker\n', 'utf8');
    const ctx = fakeCtx({ homeDir: home }, t);
    const plan = await vscodeAgent.planUpdate(ctx, assets, det);
    assert.equal(
      plan.steps.some((s) => s.kind === 'copy-skill' || s.kind === 'file'),
      false,
    );
    assert.ok(
      plan.steps.some((s) => s.kind === 'skip' && s.problem === true),
    );
  }
});
