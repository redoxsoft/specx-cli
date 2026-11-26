import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { runCli } from '../src/cli.js';
import { findExecutable } from '../src/core/which.js';
import { fakeCtx, fakeIo, fakeRunner, makeAgentExecutable, tempHome, testAssets } from './helpers.js';

test('commands: init with isTTY: false and no --yes/--dry-run -> exit 2, no runner calls, no prompts', async (t) => {
  const home = tempHome(t);
  const io = fakeIo(undefined, t);
  const runner = fakeRunner({}, t);
  const ctx = fakeCtx({ homeDir: home, isTTY: false, run: runner }, t);
  const assets = testAssets();

  makeAgentExecutable(ctx.tempBinDir, 'cursor', ctx.platform);

  const code = await runCli(['init'], ctx, io, assets);

  assert.equal(code, 2, 'exits with 2');
  assert.equal(runner.calls.length, 0, 'no runner calls');
  assert.match(
    io.errText,
    /Run with --yes to set up without questions, or --dry-run to see the plan/,
  );
});

test('commands: init --dry-run --agent cursor -> plan printed, nothing written, exit 0', async (t) => {
  const home = tempHome(t);
  const io = fakeIo(undefined, t);
  const runner = fakeRunner({}, t);
  const ctx = fakeCtx({ homeDir: home, isTTY: false, run: runner }, t);
  const assets = testAssets();

  makeAgentExecutable(ctx.tempBinDir, 'cursor', ctx.platform);

  const code = await runCli(['init', '--dry-run', '--agent', 'cursor'], ctx, io, assets);

  assert.equal(code, 0, 'exits with 0');
  assert.match(io.outText, /Cursor:/, 'prints Cursor in plan');
  assert.match(io.outText, /Add SpecX to Cursor's MCP servers/, 'prints MCP step in plan');

  const mcpJson = path.join(home, '.cursor', 'mcp.json');
  assert.equal(fs.existsSync(mcpJson), false, 'mcp.json was not written');
  const skillsDir = path.join(home, '.cursor', 'skills');
  assert.equal(fs.existsSync(skillsDir), false, 'skills folder was not written');
});

test('commands: init --yes --agent cursor on empty home with Cursor found -> exit 0, files written, summary hints', async (t) => {
  const home = tempHome(t);
  const io = fakeIo(undefined, t);
  const runner = fakeRunner({}, t);
  const ctx = fakeCtx({ homeDir: home, isTTY: false, run: runner }, t);
  const assets = testAssets();

  makeAgentExecutable(ctx.tempBinDir, 'cursor', ctx.platform);

  const code = await runCli(['init', '--yes', '--agent', 'cursor'], ctx, io, assets);

  assert.equal(code, 0, 'exits with 0');

  // Verify files written
  const mcpJson = path.join(home, '.cursor', 'mcp.json');
  assert.equal(fs.existsSync(mcpJson), true, 'mcp.json was written');
  const skillFile = path.join(home, '.cursor', 'skills', 'specx', 'SKILL.md');
  assert.equal(fs.existsSync(skillFile), true, 'skill file was written');

  // Verify summary output
  assert.match(
    io.outText,
    /Cursor asks you to sign in to SpecX the first time you use it/,
    'contains sign-in hint',
  );
  assert.match(io.outText, /\/specx setup/, 'contains /specx setup hint');
});

test('commands: one agent failing (Claude install exits 1) and Cursor succeeding -> exit 1, Cursor still done', async (t) => {
  const home = tempHome(t);
  const io = fakeIo(undefined, t);
  const assets = testAssets();
  const runner = fakeRunner({}, t);
  const ctx = fakeCtx({ homeDir: home, isTTY: false, run: runner }, t);

  makeAgentExecutable(ctx.tempBinDir, 'claude', ctx.platform);
  makeAgentExecutable(ctx.tempBinDir, 'cursor', ctx.platform);
  const claudeExe = findExecutable(ctx, 'claude');
  assert.ok(claudeExe, 'claude is resolved inside the temp bin');
  runner.setResponses({
    [`${claudeExe} plugin list --json`]: { stdout: '[]' },
    [`${claudeExe} plugin marketplace list --json`]: { stdout: '[]' },
    [`${claudeExe} plugin marketplace add ${assets.marketplace.gitUrl}`]: { code: 0 },
    [`${claudeExe} plugin install ${assets.plugin.id} --scope user`]: {
      code: 1,
      stderr: 'Failed to download plugin archive',
    },
  });

  const code = await runCli(['init', '--yes', '--agent', 'claude,cursor'], ctx, io, assets);

  assert.equal(code, 1, 'overall command exits with 1 due to failure');

  // Verify Cursor's files are still created and done
  const mcpJson = path.join(home, '.cursor', 'mcp.json');
  assert.equal(fs.existsSync(mcpJson), true, 'Cursor mcp.json was written');
  const skillFile = path.join(home, '.cursor', 'skills', 'specx', 'SKILL.md');
  assert.equal(fs.existsSync(skillFile), true, 'Cursor skill file was written');

  assert.match(io.outText, /Claude Code: Command exited with code 1/);
  assert.match(io.outText, /^✓ Cursor: set up$/m, 'Cursor still succeeds');
  assert.ok(
    runner.calls.some(
      (call) => call.command === claudeExe && call.args.join(' ') === `plugin install ${assets.plugin.id} --scope user`,
    ),
    'the failing call is the Claude install command',
  );
});

test('commands: status --json parses as JSON and exits 1 when nothing is installed', async (t) => {
  const home = tempHome(t);
  const io = fakeIo(undefined, t);
  const runner = fakeRunner({}, t);
  const ctx = fakeCtx({ homeDir: home, run: runner }, t);
  const assets = testAssets();

  const code = await runCli(['status', '--json'], ctx, io, assets);

  assert.equal(code, 1, 'exits 1 when nothing is installed');

  let parsed: { cli?: { version?: string }; agents?: unknown[] };
  try {
    parsed = JSON.parse(io.outText) as { cli?: { version?: string }; agents?: unknown[] };
  } catch (err) {
    const detail = err instanceof Error ? err.message : String(err);
    assert.fail(`status --json output must be valid JSON (${detail})`);
  }

  assert.ok(parsed.cli, 'output includes cli info');
  assert.ok(Array.isArray(parsed.agents), 'output includes agents array');
});

test('commands: unknown --agent foo -> exit 2 listing valid names', async (t) => {
  const home = tempHome(t);
  const io = fakeIo(undefined, t);
  const runner = fakeRunner({}, t);
  const ctx = fakeCtx({ homeDir: home, run: runner }, t);
  const assets = testAssets();

  const code = await runCli(['init', '--agent', 'foo'], ctx, io, assets);

  assert.equal(code, 2, 'exits 2 on unknown agent');
  assert.match(io.errText, /Unknown agent: foo/, 'identifies unknown agent');
  assert.match(io.errText, /Valid agents:/, 'lists valid agents');
  assert.match(io.errText, /claude-code/, 'lists claude-code');
  assert.match(io.errText, /codex/, 'lists codex');
  assert.match(io.errText, /cursor/, 'lists cursor');
});

test('commands: a Codex check that times out -> "not set up", no Codex sign-in hint, Cursor still set up, exit 1', async (t) => {
  const home = tempHome(t);
  const io = fakeIo(undefined, t);
  const assets = testAssets();
  const runner = fakeRunner({}, t);
  const ctx = fakeCtx({ homeDir: home, isTTY: false, run: runner }, t);

  makeAgentExecutable(ctx.tempBinDir, 'codex', ctx.platform);
  makeAgentExecutable(ctx.tempBinDir, 'cursor', ctx.platform);
  const codexExe = findExecutable(ctx, 'codex');
  assert.ok(codexExe, 'codex is resolved inside the temp bin');
  runner.setResponses({
    [`${codexExe} plugin list --marketplace ${assets.marketplace.name} --json`]: { code: null, timedOut: true },
  });

  const code = await runCli(['init', '--yes', '--agent', 'codex,cursor'], ctx, io, assets);

  assert.equal(code, 1, 'exits 1 because Codex is not set up');
  assert.match(io.outText, /^Checking Codex…$/m, 'shows progress while checking');
  assert.match(io.outText, /^Cursor: Add SpecX to Cursor's MCP servers…$/m, 'shows progress while applying');
  assert.match(io.outText, /^! Codex: not set up$/m);
  assert.match(io.outText, /timed out/);
  assert.match(io.outText, /^✓ Cursor: set up$/m);
  assert.doesNotMatch(io.outText, /codex mcp login/, 'no sign-in hint for an agent that is not set up');
  assert.match(io.outText, /Cursor asks you to sign in/);
});

test('commands: init when everything is already set up -> "already set up", exit 0', async (t) => {
  const home = tempHome(t);
  const io = fakeIo(undefined, t);
  const assets = testAssets();
  const runner = fakeRunner({}, t);
  const ctx = fakeCtx({ homeDir: home, isTTY: false, run: runner }, t);

  makeAgentExecutable(ctx.tempBinDir, 'codex', ctx.platform);
  const codexExe = findExecutable(ctx, 'codex');
  assert.ok(codexExe);
  runner.setResponses({
    [`${codexExe} plugin list --marketplace ${assets.marketplace.name} --json`]: {
      stdout: JSON.stringify({ installed: [{ pluginId: assets.plugin.id, version: assets.pluginVersion, enabled: true }] }),
    },
  });

  const code = await runCli(['init', '--yes', '--agent', 'codex'], ctx, io, assets);

  assert.equal(code, 0);
  assert.match(io.outText, /^✓ Codex: already set up$/m);
  assert.match(io.outText, /codex mcp login/);
});
