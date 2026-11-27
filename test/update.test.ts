import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { cursorAgent } from '../src/agents/cursor.js';
import { antigravityAgent } from '../src/agents/antigravity.js';
import { runCli } from '../src/cli.js';
import { update } from '../src/commands/update.js';
import { fakeCtx, fakeIo, makeAgentExecutable, tempHome, testAssets } from './helpers.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const cursorFixturesDir = path.join(__dirname, 'fixtures', 'cursor');

test('update: newer CLI available -> exit 1, no agent commands', async (t) => {
  const home = tempHome(t);
  const ctx = fakeCtx(
    {
      homeDir: home,
      fetch: async () =>
        ({
          ok: true,
          json: async () => ({ version: '99.0.0' }),
        }) as Response,
    },
    t,
  );
  makeAgentExecutable(ctx.tempBinDir, 'claude');
  const io = fakeIo(undefined, t);
  const assets = testAssets();

  const code = await runCli(['update', '--yes'], ctx, io, assets);

  assert.equal(code, 1);
  assert.match(io.outText, /A newer specx-cli is available\. Run: npx specx-cli@latest update/);
  assert.equal(ctx.runner.calls.length, 0, 'no agent commands run');
});

test('update: registry unreachable -> continues', async (t) => {
  const home = tempHome(t);
  const cursorDir = path.join(home, '.cursor');
  fs.mkdirSync(cursorDir, { recursive: true });
  fs.copyFileSync(path.join(cursorFixturesDir, 'empty.json'), path.join(cursorDir, 'mcp.json'));

  const ctx = fakeCtx(
    {
      homeDir: home,
      fetch: async () => {
        throw new Error('network down');
      },
    },
    t,
  );
  const io = fakeIo(undefined, t);
  const assets = testAssets();

  const code = await runCli(['update', '--yes', '--agent', 'cursor'], ctx, io, assets);

  assert.match(io.outText, /Couldn't check for a newer specx-cli; continuing\./);
  assert.equal(code, 0);
});

test('update: Claude outdated -> both commands in order and restart hint', async (t) => {
  const home = tempHome(t);
  const ctx = fakeCtx(
    {
      homeDir: home,
      fetch: async () =>
        ({
          ok: true,
          json: async () => ({ version: '0.1.1' }),
        }) as Response,
    },
    t,
  );
  const claudeExe = makeAgentExecutable(ctx.tempBinDir, 'claude');
  ctx.runner.setResponses({
    [`${claudeExe} plugin list --json`]: {
      stdout: JSON.stringify([{ id: 'specx', version: '0.0.1' }]),
    },
    [`${claudeExe} plugin marketplace update specx`]: { code: 0 },
    [`${claudeExe} plugin update specx`]: { code: 0 },
  });
  const io = fakeIo(undefined, t);
  const assets = testAssets();

  const code = await runCli(['update', '--yes', '--agent', 'claude'], ctx, io, assets);

  assert.equal(code, 0);
  const calls = ctx.runner.calls.map((c) => `${c.command} ${c.args.join(' ')}`);
  const mpIdx = calls.indexOf(`${claudeExe} plugin marketplace update specx`);
  const upIdx = calls.indexOf(`${claudeExe} plugin update specx`);
  assert.ok(mpIdx >= 0, 'ran marketplace update');
  assert.ok(upIdx > mpIdx, 'ran plugin update after marketplace update');
  assert.match(io.outText, /Restart Claude Code \(or Claude Desktop\) to use the new version\./);
});

test('update: the first of the two failing -> failed, the second not run, exit 1', async (t) => {
  const home = tempHome(t);
  const ctx = fakeCtx(
    {
      homeDir: home,
      fetch: async () =>
        ({
          ok: true,
          json: async () => ({ version: '0.1.1' }),
        }) as Response,
    },
    t,
  );
  const claudeExe = makeAgentExecutable(ctx.tempBinDir, 'claude');
  ctx.runner.setResponses({
    [`${claudeExe} plugin list --json`]: {
      stdout: JSON.stringify([{ id: 'specx', version: '0.0.1' }]),
    },
    [`${claudeExe} plugin marketplace update specx`]: { code: 1, stderr: 'fetch failed' },
    [`${claudeExe} plugin update specx`]: { code: 0 },
  });
  const io = fakeIo(undefined, t);
  const assets = testAssets();

  const code = await runCli(['update', '--yes', '--agent', 'claude'], ctx, io, assets);

  assert.equal(code, 1);
  const calls = ctx.runner.calls.map((c) => `${c.command} ${c.args.join(' ')}`);
  assert.ok(calls.includes(`${claudeExe} plugin marketplace update specx`));
  assert.equal(calls.includes(`${claudeExe} plugin update specx`), false, 'second command was not run');
  assert.match(io.outText, /Claude Code: Command exited with code 1/);
  assert.equal(io.outText.includes('Restart Claude Code'), false, 'does not print restart hint on failure');
});

test('update: Claude current -> skip', async (t) => {
  const home = tempHome(t);
  const ctx = fakeCtx(
    {
      homeDir: home,
      fetch: async () =>
        ({
          ok: true,
          json: async () => ({ version: '0.1.1' }),
        }) as Response,
    },
    t,
  );
  const claudeExe = makeAgentExecutable(ctx.tempBinDir, 'claude');
  ctx.runner.setResponses({
    [`${claudeExe} plugin list --json`]: {
      stdout: JSON.stringify([{ id: 'specx', version: '9.9.9' }]),
    },
  });
  const io = fakeIo(undefined, t);
  const assets = testAssets();

  const code = await runCli(['update', '--yes', '--agent', 'claude'], ctx, io, assets);

  assert.equal(code, 0);
  assert.match(io.outText, /Claude Code: up to date/);
  assert.equal(io.outText.includes('Restart Claude Code'), false);
});

test('update: Codex outdated -> both commands', async (t) => {
  const home = tempHome(t);
  const ctx = fakeCtx(
    {
      homeDir: home,
      fetch: async () =>
        ({
          ok: true,
          json: async () => ({ version: '0.1.1' }),
        }) as Response,
    },
    t,
  );
  const codexExe = makeAgentExecutable(ctx.tempBinDir, 'codex');
  ctx.runner.setResponses({
    [`${codexExe} plugin list --marketplace specx --json`]: {
      stdout: JSON.stringify({ installed: [{ pluginId: 'specx', version: '0.0.1' }] }),
    },
    [`${codexExe} plugin marketplace upgrade specx`]: { code: 0 },
    [`${codexExe} plugin add specx`]: { code: 0 },
  });
  const io = fakeIo(undefined, t);
  const assets = testAssets();

  const code = await runCli(['update', '--yes', '--agent', 'codex'], ctx, io, assets);

  assert.equal(code, 0);
  const calls = ctx.runner.calls.map((c) => `${c.command} ${c.args.join(' ')}`);
  const upgradeIdx = calls.indexOf(`${codexExe} plugin marketplace upgrade specx`);
  const addIdx = calls.indexOf(`${codexExe} plugin add specx`);
  assert.ok(upgradeIdx >= 0, 'ran marketplace upgrade');
  assert.ok(addIdx > upgradeIdx, 'ran plugin add after marketplace upgrade');
  assert.match(io.outText, /Codex: updated/);
});

test('update: file agents: each row of the state table', async (t) => {
  const assets = testAssets();
  const det = { found: true, executable: null };

  // Row 1: config file doesn't parse -> problem skip (same message as init)
  {
    const home = tempHome(t);
    const cursorDir = path.join(home, '.cursor');
    fs.mkdirSync(cursorDir, { recursive: true });
    fs.copyFileSync(path.join(cursorFixturesDir, 'broken.json'), path.join(cursorDir, 'mcp.json'));
    const ctx = fakeCtx({ homeDir: home }, t);
    const plan = await cursorAgent.planUpdate(ctx, assets, det);
    assert.equal(plan.steps.length, 1);
    const step = plan.steps[0];
    assert.ok(step && step.kind === 'skip');
    assert.equal(step.problem, true);
    assert.match(step.describe, /Cursor's mcp\.json has errors; fix it and run again/);
  }

  // Row 2: no owned entry and no owned skill -> skip "not installed; run `npx specx-cli@latest init`"
  {
    const home = tempHome(t);
    const cursorDir = path.join(home, '.cursor');
    fs.mkdirSync(cursorDir, { recursive: true });
    fs.copyFileSync(path.join(cursorFixturesDir, 'empty.json'), path.join(cursorDir, 'mcp.json'));
    const ctx = fakeCtx({ homeDir: home }, t);
    const plan = await cursorAgent.planUpdate(ctx, assets, det);
    assert.equal(plan.steps.length, 1);
    const step = plan.steps[0];
    assert.ok(step && step.kind === 'skip');
    assert.equal(step.problem, undefined);
    assert.equal(step.describe, 'not installed; run `npx specx-cli@latest init`');
  }

  // Row 3: owned skill older than assets.pluginVersion, or its marker has no version -> copy-skill
  {
    const home = tempHome(t);
    const cursorDir = path.join(home, '.cursor');
    const skillDir = path.join(cursorDir, 'skills', 'specx');
    fs.mkdirSync(skillDir, { recursive: true });
    fs.copyFileSync(path.join(cursorFixturesDir, 'owned.json'), path.join(cursorDir, 'mcp.json'));
    fs.writeFileSync(
      path.join(skillDir, 'SKILL.md'),
      '# SpecX\n<!-- specx-plugin: abc version: 0.0.1 -->\n',
      'utf8',
    );
    const ctx = fakeCtx({ homeDir: home }, t);
    const plan = await cursorAgent.planUpdate(ctx, assets, det);
    const copies = plan.steps.filter((s) => s.kind === 'copy-skill');
    assert.equal(copies.length, 1);
    assert.equal(copies[0]?.kind === 'copy-skill' ? copies[0].destDir : '', skillDir);
  }

  // Row 3b: marker has no version -> copy-skill
  {
    const home = tempHome(t);
    const cursorDir = path.join(home, '.cursor');
    const skillDir = path.join(cursorDir, 'skills', 'specx');
    fs.mkdirSync(skillDir, { recursive: true });
    fs.copyFileSync(path.join(cursorFixturesDir, 'owned.json'), path.join(cursorDir, 'mcp.json'));
    fs.writeFileSync(
      path.join(skillDir, 'SKILL.md'),
      '# SpecX\n<!-- specx-plugin: abc -->\n',
      'utf8',
    );
    const ctx = fakeCtx({ homeDir: home }, t);
    const plan = await cursorAgent.planUpdate(ctx, assets, det);
    assert.ok(plan.steps.some((s) => s.kind === 'copy-skill'));
  }

  // Row 4: owned skill current -> skip "up to date"
  {
    const home = tempHome(t);
    const cursorDir = path.join(home, '.cursor');
    const skillDir = path.join(cursorDir, 'skills', 'specx');
    fs.mkdirSync(skillDir, { recursive: true });
    fs.copyFileSync(path.join(cursorFixturesDir, 'owned.json'), path.join(cursorDir, 'mcp.json'));
    fs.writeFileSync(
      path.join(skillDir, 'SKILL.md'),
      '# SpecX\n<!-- specx-plugin: abc version: 9.9.9 -->\n',
      'utf8',
    );
    const ctx = fakeCtx({ homeDir: home }, t);
    const plan = await cursorAgent.planUpdate(ctx, assets, det);
    assert.equal(plan.steps.length, 1);
    const step = plan.steps[0];
    assert.ok(step && step.kind === 'skip');
    assert.equal(step.problem, undefined);
    assert.equal(step.describe, 'up to date');
  }

  // Row 5: skills/specx exists without the SpecX marker -> problem skip (never overwrite)
  {
    const home = tempHome(t);
    const cursorDir = path.join(home, '.cursor');
    const skillDir = path.join(cursorDir, 'skills', 'specx');
    fs.mkdirSync(skillDir, { recursive: true });
    fs.copyFileSync(path.join(cursorFixturesDir, 'empty.json'), path.join(cursorDir, 'mcp.json'));
    fs.writeFileSync(path.join(skillDir, 'SKILL.md'), '# Custom skill without marker\n', 'utf8');
    const ctx = fakeCtx({ homeDir: home }, t);
    const plan = await cursorAgent.planUpdate(ctx, assets, det);
    assert.equal(
      plan.steps.some((s) => s.kind === 'copy-skill' || s.kind === 'file'),
      false,
      'does not overwrite or edit an unmarked skill',
    );
    assert.ok(
      plan.steps.some(
        (s) =>
          s.kind === 'skip' &&
          s.problem === true &&
          s.describe.includes("a 'specx' skill exists that SpecX didn't install"),
      ),
    );
  }

  // Row 6a: owned entry present, skill missing -> partly set up problem skip
  {
    const home = tempHome(t);
    const cursorDir = path.join(home, '.cursor');
    fs.mkdirSync(cursorDir, { recursive: true });
    fs.copyFileSync(path.join(cursorFixturesDir, 'owned.json'), path.join(cursorDir, 'mcp.json'));
    const ctx = fakeCtx({ homeDir: home }, t);
    const plan = await cursorAgent.planUpdate(ctx, assets, det);
    assert.equal(
      plan.steps.some((s) => s.kind === 'copy-skill' || s.kind === 'file'),
      false,
      'does not install the missing skill or edit mcp.json',
    );
    assert.ok(
      plan.steps.some(
        (s) =>
          s.kind === 'skip' &&
          s.problem === true &&
          s.describe === 'partly set up; run `npx specx-cli@latest init` to finish',
      ),
    );
  }

  // Row 6b: skill present, owned entry missing -> skill step if applies, plus partly set up problem skip
  {
    const home = tempHome(t);
    const cursorDir = path.join(home, '.cursor');
    const skillDir = path.join(cursorDir, 'skills', 'specx');
    fs.mkdirSync(skillDir, { recursive: true });
    fs.copyFileSync(path.join(cursorFixturesDir, 'empty.json'), path.join(cursorDir, 'mcp.json'));
    fs.writeFileSync(
      path.join(skillDir, 'SKILL.md'),
      '# SpecX\n<!-- specx-plugin: abc version: 0.0.1 -->\n',
      'utf8',
    );
    const ctx = fakeCtx({ homeDir: home }, t);
    const plan = await cursorAgent.planUpdate(ctx, assets, det);
    assert.ok(plan.steps.some((s) => s.kind === 'copy-skill'), 'has copy-skill');
    assert.ok(
      plan.steps.some(
        (s) =>
          s.kind === 'skip' &&
          s.problem === true &&
          s.describe === 'partly set up; run `npx specx-cli@latest init` to finish',
      ),
      'has partly set up problem skip',
    );
  }

  // Row 7: foreign specx entry (another URL) -> problem skip (never change it)
  {
    const home = tempHome(t);
    const cursorDir = path.join(home, '.cursor');
    fs.mkdirSync(cursorDir, { recursive: true });
    fs.copyFileSync(path.join(cursorFixturesDir, 'specx-local.json'), path.join(cursorDir, 'mcp.json'));
    const ctx = fakeCtx({ homeDir: home }, t);
    const plan = await cursorAgent.planUpdate(ctx, assets, det);
    assert.equal(
      plan.steps.some((s) => s.kind === 'copy-skill' || s.kind === 'file'),
      false,
      'does not change a foreign specx entry',
    );
    assert.ok(
      plan.steps.some(
        (s) =>
          s.kind === 'skip' &&
          s.problem === true &&
          s.describe.includes('pointing elsewhere'),
      ),
    );
  }

  // Row 8: owned leftover specx-setup folder -> remove-dir
  {
    const home = tempHome(t);
    const cursorDir = path.join(home, '.cursor');
    const skillDir = path.join(cursorDir, 'skills', 'specx');
    const setupDir = path.join(cursorDir, 'skills', 'specx-setup');
    fs.mkdirSync(skillDir, { recursive: true });
    fs.mkdirSync(setupDir, { recursive: true });
    fs.copyFileSync(path.join(cursorFixturesDir, 'owned.json'), path.join(cursorDir, 'mcp.json'));
    fs.writeFileSync(
      path.join(skillDir, 'SKILL.md'),
      '# SpecX\n<!-- specx-plugin: abc version: 9.9.9 -->\n',
      'utf8',
    );
    fs.writeFileSync(
      path.join(setupDir, 'SKILL.md'),
      '# SpecX Setup\n<!-- specx-plugin: abc version: 9.9.9 -->\n',
      'utf8',
    );
    const ctx = fakeCtx({ homeDir: home }, t);
    const plan = await cursorAgent.planUpdate(ctx, assets, det);
    assert.ok(
      plan.steps.some(
        (s) => s.kind === 'remove-dir' && s.dir === setupDir,
      ),
      'has remove-dir step for specx-setup',
    );
  }
});

test('update: not installed anywhere -> exit 0', async (t) => {
  const home = tempHome(t);
  const cursorDir = path.join(home, '.cursor');
  fs.mkdirSync(cursorDir, { recursive: true });
  fs.copyFileSync(path.join(cursorFixturesDir, 'empty.json'), path.join(cursorDir, 'mcp.json'));

  const ctx = fakeCtx(
    {
      homeDir: home,
      fetch: async () =>
        ({
          ok: true,
          json: async () => ({ version: '0.1.1' }),
        }) as Response,
    },
    t,
  );
  const io = fakeIo(undefined, t);
  const assets = testAssets();

  const code = await runCli(['update', '--yes', '--agent', 'cursor'], ctx, io, assets);

  assert.equal(code, 0);
  assert.match(io.outText, /^- Cursor: not installed/m);
});

test('update: interactive checkbox defaults to installed agents', async (t) => {
  const home = tempHome(t);
  const cursorDir = path.join(home, '.cursor');
  const skillDir = path.join(cursorDir, 'skills', 'specx');
  fs.mkdirSync(skillDir, { recursive: true });
  fs.copyFileSync(path.join(cursorFixturesDir, 'owned.json'), path.join(cursorDir, 'mcp.json'));
  fs.writeFileSync(
    path.join(skillDir, 'SKILL.md'),
    '# SpecX\n<!-- specx-plugin: abc version: 0.0.1 -->\n',
    'utf8',
  );

  const ctx = fakeCtx(
    {
      homeDir: home,
      isTTY: true,
      fetch: async () =>
        ({
          ok: true,
          json: async () => ({ version: '0.1.1' }),
        }) as Response,
    },
    t,
  );
  const claudeExe = makeAgentExecutable(ctx.tempBinDir, 'claude');
  ctx.runner.setResponses({
    [`${claudeExe} plugin list --json`]: {
      stdout: '[]',
    },
  });

  let checkboxChoices: { name?: string; value: string; checked?: boolean }[] = [];
  const io = fakeIo(
    {
      checkboxAnswers: [['cursor']],
      confirmAnswers: [true],
    },
    t,
  );
  const origCheckbox = io.checkbox;
  io.checkbox = async (opts) => {
    checkboxChoices = [...opts.choices];
    return origCheckbox(opts);
  };

  const assets = testAssets();
  const code = await update(ctx, assets, {}, io);

  assert.equal(code, 0);
  const cursorChoice = checkboxChoices.find((c) => c.value === 'cursor');
  const claudeChoice = checkboxChoices.find((c) => c.value === 'claude-code');
  assert.equal(cursorChoice?.checked, true, 'Cursor is installed, so checked');
  assert.equal(claudeChoice?.checked, false, 'Claude is not installed, so unchecked');
});

test('update: a pre-release registry version is not newer than the release', async (t) => {
  const home = tempHome(t);
  const cursorDir = path.join(home, '.cursor');
  fs.mkdirSync(cursorDir, { recursive: true });
  fs.copyFileSync(path.join(cursorFixturesDir, 'empty.json'), path.join(cursorDir, 'mcp.json'));

  const ctx = fakeCtx(
    {
      homeDir: home,
      fetch: async () =>
        ({
          ok: true,
          json: async () => ({ version: '0.1.1-rc.1' }),
        }) as Response,
    },
    t,
  );
  const io = fakeIo(undefined, t);
  const assets = testAssets();

  const code = await runCli(['update', '--yes', '--agent', 'cursor'], ctx, io, assets);

  assert.equal(io.outText.includes('A newer specx-cli is available'), false);
  assert.equal(code, 0);
});

test('update: Claude installed newer than this CLI is left alone', async (t) => {
  const home = tempHome(t);
  const ctx = fakeCtx(
    {
      homeDir: home,
      fetch: async () =>
        ({
          ok: true,
          json: async () => ({ version: '0.1.1' }),
        }) as Response,
    },
    t,
  );
  const claudeExe = makeAgentExecutable(ctx.tempBinDir, 'claude');
  ctx.runner.setResponses({
    [`${claudeExe} plugin list --json`]: {
      stdout: JSON.stringify([{ id: 'specx', version: '0.1.10' }]),
    },
  });
  const io = fakeIo(undefined, t);
  const assets = testAssets();
  assets.pluginVersion = '0.1.9';

  const code = await runCli(['update', '--yes', '--agent', 'claude'], ctx, io, assets);

  assert.equal(code, 0);
  assert.match(io.outText, /Claude Code: up to date/);
  const calls = ctx.runner.calls.map((c) => c.args.join(' '));
  assert.equal(calls.includes('plugin update specx'), false);
});

test('update: Claude 0.1.9 is older than 0.1.10', async (t) => {
  const home = tempHome(t);
  const ctx = fakeCtx(
    {
      homeDir: home,
      fetch: async () =>
        ({
          ok: true,
          json: async () => ({ version: '0.1.1' }),
        }) as Response,
    },
    t,
  );
  const claudeExe = makeAgentExecutable(ctx.tempBinDir, 'claude');
  ctx.runner.setResponses({
    [`${claudeExe} plugin list --json`]: {
      stdout: JSON.stringify([{ id: 'specx', version: '0.1.9' }]),
    },
    [`${claudeExe} plugin marketplace update specx`]: { code: 0 },
    [`${claudeExe} plugin update specx`]: { code: 0 },
  });
  const io = fakeIo(undefined, t);
  const assets = testAssets();
  assets.pluginVersion = '0.1.10';

  const code = await runCli(['update', '--yes', '--agent', 'claude'], ctx, io, assets);

  assert.equal(code, 0);
  const calls = ctx.runner.calls.map((c) => `${c.command} ${c.args.join(' ')}`);
  const mpIdx = calls.indexOf(`${claudeExe} plugin marketplace update specx`);
  const upIdx = calls.indexOf(`${claudeExe} plugin update specx`);
  assert.ok(mpIdx >= 0, 'ran marketplace update');
  assert.ok(upIdx > mpIdx, 'ran plugin update after marketplace update');
});

test('update: file agents do not install or overwrite skills without the SpecX marker', async (t) => {
  const det = { found: true, executable: null };
  const assets = testAssets();
  assets.skills = [
    ...assets.skills,
    {
      name: 'specx-extra',
      files: [
        {
          relativePath: 'SKILL.md',
          text: '# Extra\n<!-- specx-plugin: abc version: 9.9.9 -->\n',
        },
      ],
    },
  ];

  const home = tempHome(t);
  const cursorDir = path.join(home, '.cursor');
  const specxDir = path.join(cursorDir, 'skills', 'specx');
  const extraDir = path.join(cursorDir, 'skills', 'specx-extra');
  fs.mkdirSync(specxDir, { recursive: true });
  fs.mkdirSync(extraDir, { recursive: true });
  fs.copyFileSync(path.join(cursorFixturesDir, 'owned.json'), path.join(cursorDir, 'mcp.json'));
  fs.writeFileSync(path.join(specxDir, 'SKILL.md'), '# SpecX\n<!-- specx-plugin: abc version: 0.0.1 -->\n', 'utf8');
  fs.writeFileSync(path.join(extraDir, 'SKILL.md'), '# Custom skill without marker\n', 'utf8');

  const ctx = fakeCtx({ homeDir: home }, t);
  const plan = await cursorAgent.planUpdate(ctx, assets, det);
  const copies = plan.steps.filter((s) => s.kind === 'copy-skill');
  assert.equal(copies.length, 1);
  const copy = copies[0];
  assert.ok(copy && copy.kind === 'copy-skill');
  assert.equal(copy.skill.name, 'specx');
  assert.equal(copy.destDir, specxDir);
});

test('update: file agents refresh an owned outdated extra skill and skip one that is current', async (t) => {
  const det = { found: true, executable: null };
  const assets = testAssets();
  assets.pluginVersion = '0.1.10';
  assets.skills = [
    {
      name: 'specx',
      files: [{ relativePath: 'SKILL.md', text: '# SpecX\n<!-- specx-plugin: abc version: 0.1.10 -->\n' }],
    },
    {
      name: 'specx-extra',
      files: [{ relativePath: 'SKILL.md', text: '# Extra\n<!-- specx-plugin: abc version: 0.1.10 -->\n' }],
    },
    {
      name: 'specx-old',
      files: [{ relativePath: 'SKILL.md', text: '# Old\n<!-- specx-plugin: abc version: 0.1.10 -->\n' }],
    },
    {
      name: 'specx-missing',
      files: [{ relativePath: 'SKILL.md', text: '# Missing\n<!-- specx-plugin: abc version: 0.1.10 -->\n' }],
    },
  ];

  const home = tempHome(t);
  const cursorDir = path.join(home, '.cursor');
  const specxDir = path.join(cursorDir, 'skills', 'specx');
  const extraDir = path.join(cursorDir, 'skills', 'specx-extra');
  const oldDir = path.join(cursorDir, 'skills', 'specx-old');
  fs.mkdirSync(specxDir, { recursive: true });
  fs.mkdirSync(extraDir, { recursive: true });
  fs.mkdirSync(oldDir, { recursive: true });
  fs.copyFileSync(path.join(cursorFixturesDir, 'owned.json'), path.join(cursorDir, 'mcp.json'));
  fs.writeFileSync(path.join(specxDir, 'SKILL.md'), '# SpecX\n<!-- specx-plugin: abc version: 0.1.10 -->\n', 'utf8');
  fs.writeFileSync(path.join(extraDir, 'SKILL.md'), '# Extra\n<!-- specx-plugin: abc version: 0.1.10 -->\n', 'utf8');
  fs.writeFileSync(path.join(oldDir, 'SKILL.md'), '# Old\n<!-- specx-plugin: abc -->\n', 'utf8');

  const ctx = fakeCtx({ homeDir: home }, t);
  const plan = await cursorAgent.planUpdate(ctx, assets, det);
  const copied = plan.steps.flatMap((s) => (s.kind === 'copy-skill' ? [s.skill.name] : []));
  assert.deepEqual(copied, ['specx-old']);
  assert.ok(plan.steps.some((s) => s.kind === 'skip' && s.describe === 'up to date'));
});

test('update: a newer file skill is not replaced; 0.1.9 is older than 0.1.10', async (t) => {
  const det = { found: true, executable: null };

  async function skillPlan(pluginVersion: string, markerVersion: string) {
    const assets = testAssets();
    assets.pluginVersion = pluginVersion;
    const home = tempHome(t);
    const cursorDir = path.join(home, '.cursor');
    const skillDir = path.join(cursorDir, 'skills', 'specx');
    fs.mkdirSync(skillDir, { recursive: true });
    fs.copyFileSync(path.join(cursorFixturesDir, 'owned.json'), path.join(cursorDir, 'mcp.json'));
    fs.writeFileSync(
      path.join(skillDir, 'SKILL.md'),
      `# SpecX\n<!-- specx-plugin: abc version: ${markerVersion} -->\n`,
      'utf8',
    );
    const ctx = fakeCtx({ homeDir: home }, t);
    return cursorAgent.planUpdate(ctx, assets, det);
  }

  const newer = await skillPlan('0.1.9', '0.1.10');
  assert.equal(newer.steps.some((s) => s.kind === 'copy-skill'), false);
  assert.ok(newer.steps.some((s) => s.kind === 'skip' && s.describe === 'up to date'));

  const older = await skillPlan('0.1.10', '0.1.9');
  assert.ok(older.steps.some((s) => s.kind === 'copy-skill'));

  const prerelease = await skillPlan('0.1.1', '0.1.1-rc.1');
  assert.ok(prerelease.steps.some((s) => s.kind === 'copy-skill'));

  const release = await skillPlan('0.1.1-rc.1', '0.1.1');
  assert.equal(release.steps.some((s) => s.kind === 'copy-skill'), false);
  assert.ok(release.steps.some((s) => s.kind === 'skip' && s.describe === 'up to date'));
});

test('update: an agent without SpecX is reported as "not installed", not "up to date", and does not fail the run', async (t) => {
  const { fakeCtx, fakeIo, fakeRunner, tempHome, testAssets, makeAgentExecutable } = await import('./helpers.js');
  const { runCli } = await import('../src/cli.js');
  const home = tempHome(t);
  const io = fakeIo(undefined, t);
  const assets = testAssets();
  const runner = fakeRunner({}, t);
  const ctx = fakeCtx(
    { homeDir: home, isTTY: false, run: runner, fetch: (async () => { throw new Error('offline'); }) as unknown as typeof fetch },
    t,
  );
  makeAgentExecutable(ctx.tempBinDir, 'agy', ctx.platform);

  const code = await runCli(['update', '--yes', '--agent', 'antigravity'], ctx, io, assets);

  assert.equal(code, 0);
  assert.match(io.outText, /^- Antigravity: not installed/m);
  assert.doesNotMatch(io.outText, /Antigravity: up to date/);
});
