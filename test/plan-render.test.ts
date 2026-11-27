import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { antigravityAgent } from '../src/agents/antigravity.js';
import { cursorAgent } from '../src/agents/cursor.js';
import { vscodeAgent } from '../src/agents/vscode.js';
import { renderPlan, type Step } from '../src/core/plan.js';
import { fakeCtx, tempHome, testAssets } from './helpers.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const AGENTS = [
  {
    agent: cursorAgent,
    name: 'cursor',
    header: 'Cursor:',
    fixturesDir: path.join(__dirname, 'fixtures', 'cursor'),
    configDirRel: '.cursor',
    mcpFileName: 'mcp.json',
  },
  {
    agent: antigravityAgent,
    name: 'antigravity',
    header: 'Antigravity:',
    fixturesDir: path.join(__dirname, 'fixtures', 'antigravity'),
    configDirRel: path.join('.gemini', 'config'),
    mcpFileName: 'mcp_config.json',
  },
  {
    agent: vscodeAgent,
    name: 'vscode',
    header: 'VS Code / Copilot:',
    fixturesDir: path.join(__dirname, 'fixtures', 'vscode'),
    configDirRel: '.copilot',
    mcpFileName: 'mcp-config.json',
  },
] as const;

const FIXTURES = [
  'empty.json',
  'with-comments.json',
  'with-secrets.json',
  'specx-local.json',
  'owned.json',
  'broken.json',
  'with-url-secret.json',
];

const SECRETS = [
  'SECRET-TOKEN-123',
  'SECRET-AGY-789',
  'sk-SECRET-456',
  'SECRET-URL-1',
];

function renderedPiece(step: Step): string {
  switch (step.kind) {
    case 'run':
      return `run: ${step.command}${step.args.length > 0 ? ` ${step.args.join(' ')}` : ''}`;
    case 'file':
      return step.change.summary;
    case 'copy-skill':
      return `copy skill ${step.skill.name} to ${step.destDir}`;
    case 'remove-dir':
      return `remove directory ${step.dir}`;
    case 'skip':
      return step.problem ? `! ${step.describe}` : `skip: ${step.describe}`;
    default: {
      const unreachable: never = step;
      return unreachable;
    }
  }
}

for (const { name, fixturesDir } of AGENTS) {
  test(`plan-render: covers every ${name} fixture`, () => {
    const discovered = fs.readdirSync(fixturesDir).filter((f) => f.endsWith('.json')).sort();
    assert.deepEqual([...FIXTURES].sort(), discovered);
  });
}

for (const { agent, name, header, fixturesDir, configDirRel, mcpFileName } of AGENTS) {
  for (const fixtureName of FIXTURES) {
    test(`plan-render: init plan for ${name} ${fixtureName} never leaks secrets`, async (t) => {
      const home = tempHome(t);
      const confDir = path.join(home, configDirRel);
      fs.mkdirSync(confDir, { recursive: true });

      const fixturePath = path.join(fixturesDir, fixtureName);
      const fixtureContent = fs.readFileSync(fixturePath, 'utf8');
      fs.writeFileSync(path.join(confDir, mcpFileName), fixtureContent, 'utf8');

      const ctx = fakeCtx({ homeDir: home }, t);
      const assets = testAssets();
      const det = { found: true, executable: null };

      const plan = await agent.planInit(ctx, assets, det);
      const rendered = renderPlan([plan]);

      assert.ok(plan.steps.length > 0, `${name} ${fixtureName}: plan has no steps`);
      assert.match(rendered, new RegExp(`^${header}`), `${name} ${fixtureName}: rendered plan has no agent heading`);
      for (const step of plan.steps) {
        assert.equal(
          rendered.includes(renderedPiece(step)),
          true,
          `${name} ${fixtureName}: rendered plan is missing a ${step.kind} step`,
        );
        if (step.kind === 'file' && step.change.afterText.includes('\n')) {
          assert.equal(
            rendered.includes(step.change.afterText),
            false,
            `${name} ${fixtureName}: rendered plan includes the whole file`,
          );
        }
      }

      if (fixtureName === 'with-secrets.json') {
        const bodies = plan.steps
          .filter((step) => step.kind === 'file')
          .map((step) => (step.kind === 'file' ? step.change.afterText : ''));
        assert.ok(bodies.length > 0, `${name} with-secrets.json: init plan has no file step`);
        const bearer = name === 'antigravity' ? 'SECRET-AGY-789' : 'SECRET-TOKEN-123';
        assert.equal(bodies.some((body) => body.includes(bearer)), true, 'file body keeps the bearer token');
        assert.equal(bodies.some((body) => body.includes('sk-SECRET-456')), true, 'file body keeps the api key');
      }

      for (const secret of SECRETS) {
        assert.equal(rendered.includes(secret), false, `${name} ${fixtureName}: rendered plan contains secret ${secret}`);
      }

      if (fixtureName === 'with-url-secret.json') {
        const st = await agent.status(ctx, assets, det);
        for (const secret of SECRETS) {
          assert.equal(
            st.problems.some((p) => p.includes(secret)),
            false,
            `${name} status leaks secret ${secret}`,
          );
        }
        assert.ok(
          st.problems.some((p) => p.includes('points to http://localhost:8765/mcp')),
          `${name} status points to sanitized URL`,
        );
      }
    });

    test(`plan-render: remove plan for ${name} ${fixtureName} never leaks secrets`, async (t) => {
      const home = tempHome(t);
      const confDir = path.join(home, configDirRel);
      fs.mkdirSync(confDir, { recursive: true });

      const fixturePath = path.join(fixturesDir, fixtureName);
      const fixtureContent = fs.readFileSync(fixturePath, 'utf8');
      fs.writeFileSync(path.join(confDir, mcpFileName), fixtureContent, 'utf8');

      const ctx = fakeCtx({ homeDir: home }, t);
      const assets = testAssets();
      const det = { found: true, executable: null };

      const plan = await agent.planRemove(ctx, assets, det);
      const rendered = renderPlan([plan]);

      assert.ok(plan.steps.length > 0, `${name} ${fixtureName}: remove plan has no steps`);
      assert.match(rendered, new RegExp(`^${header}`), `${name} ${fixtureName}: rendered plan has no agent heading`);
      for (const step of plan.steps) {
        assert.equal(
          rendered.includes(renderedPiece(step)),
          true,
          `${name} ${fixtureName}: rendered plan is missing a ${step.kind} step`,
        );
        if (step.kind === 'file' && step.change.afterText.includes('\n')) {
          assert.equal(
            rendered.includes(step.change.afterText),
            false,
            `${name} ${fixtureName}: rendered plan includes the whole file`,
          );
        }
      }

      for (const secret of SECRETS) {
        assert.equal(rendered.includes(secret), false, `${name} ${fixtureName}: rendered remove plan contains secret ${secret}`);
      }
    });

    test(`plan-render: update plan for ${name} ${fixtureName} never leaks secrets`, async (t) => {
      const home = tempHome(t);
      const confDir = path.join(home, configDirRel);
      fs.mkdirSync(confDir, { recursive: true });

      const fixturePath = path.join(fixturesDir, fixtureName);
      const fixtureContent = fs.readFileSync(fixturePath, 'utf8');
      fs.writeFileSync(path.join(confDir, mcpFileName), fixtureContent, 'utf8');

      const ctx = fakeCtx({ homeDir: home }, t);
      const assets = testAssets();
      const det = { found: true, executable: null };

      const plan = await agent.planUpdate(ctx, assets, det);
      const rendered = renderPlan([plan]);

      assert.ok(plan.steps.length > 0, `${name} ${fixtureName}: update plan has no steps`);
      assert.match(rendered, new RegExp(`^${header}`), `${name} ${fixtureName}: rendered plan has no agent heading`);
      for (const step of plan.steps) {
        assert.equal(
          rendered.includes(renderedPiece(step)),
          true,
          `${name} ${fixtureName}: rendered plan is missing a ${step.kind} step`,
        );
        if (step.kind === 'file' && step.change.afterText.includes('\n')) {
          assert.equal(
            rendered.includes(step.change.afterText),
            false,
            `${name} ${fixtureName}: rendered plan includes the whole file`,
          );
        }
      }

      for (const secret of SECRETS) {
        assert.equal(rendered.includes(secret), false, `${name} ${fixtureName}: rendered update plan contains secret ${secret}`);
      }
    });
  }
}
