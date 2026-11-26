import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { cursorAgent } from '../src/agents/cursor.js';
import { renderPlan, type Step } from '../src/core/plan.js';
import { fakeCtx, tempHome, testAssets } from './helpers.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const fixturesDir = path.join(__dirname, 'fixtures', 'cursor');

const FIXTURES = [
  'empty.json',
  'with-comments.json',
  'with-secrets.json',
  'specx-local.json',
  'owned.json',
  'broken.json',
];

const BEARER = 'SECRET-TOKEN-123';
const API_KEY = 'sk-SECRET-456';

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

test('plan-render: covers every cursor fixture', () => {
  const discovered = fs.readdirSync(fixturesDir).filter((name) => name.endsWith('.json')).sort();
  assert.deepEqual([...FIXTURES].sort(), discovered);
});

for (const fixtureName of FIXTURES) {
  test(`plan-render: init plan for ${fixtureName} never leaks secrets`, async (t) => {
    const home = tempHome(t);
    const cursorDir = path.join(home, '.cursor');
    fs.mkdirSync(cursorDir, { recursive: true });

    const fixturePath = path.join(fixturesDir, fixtureName);
    const fixtureContent = fs.readFileSync(fixturePath, 'utf8');
    fs.writeFileSync(path.join(cursorDir, 'mcp.json'), fixtureContent, 'utf8');

    const ctx = fakeCtx({ homeDir: home }, t);
    const assets = testAssets();
    const det = { found: true, executable: null };

    const plan = await cursorAgent.planInit(ctx, assets, det);
    const rendered = renderPlan([plan]);

    assert.ok(plan.steps.length > 0, `${fixtureName}: plan has no steps`);
    assert.match(rendered, /^Cursor:/, `${fixtureName}: rendered plan has no agent heading`);
    for (const step of plan.steps) {
      assert.equal(
        rendered.includes(renderedPiece(step)),
        true,
        `${fixtureName}: rendered plan is missing a ${step.kind} step`,
      );
      if (step.kind === 'file' && step.change.afterText.includes('\n')) {
        assert.equal(
          rendered.includes(step.change.afterText),
          false,
          `${fixtureName}: rendered plan includes the whole file`,
        );
      }
    }

    if (fixtureName === 'with-secrets.json') {
      const bodies = plan.steps
        .filter((step) => step.kind === 'file')
        .map((step) => (step.kind === 'file' ? step.change.afterText : ''));
      assert.ok(bodies.length > 0, 'with-secrets.json: init plan has no file step');
      assert.equal(bodies.some((body) => body.includes(BEARER)), true, 'file body keeps the bearer token');
      assert.equal(bodies.some((body) => body.includes(API_KEY)), true, 'file body keeps the api key');
    }

    assert.equal(rendered.includes(BEARER), false, `${fixtureName}: rendered plan contains a bearer token`);
    assert.equal(rendered.includes(API_KEY), false, `${fixtureName}: rendered plan contains an api key`);
  });
}
