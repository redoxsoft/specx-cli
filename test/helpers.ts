import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import type { TestContext } from 'node:test';
import type { Assets } from '../src/core/assets.js';
import type { Ctx, Platform, RunResult, Runner } from '../src/core/context.js';
import type { CheckboxOptions, ConfirmOptions, IO } from '../src/commands/io.js';

export function tempHome(t: TestContext): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'specx-test-home-'));
  t.after(() => {
    fs.rmSync(dir, { recursive: true, force: true });
  });
  return dir;
}

export interface FakeRunnerCall {
  command: string;
  args: readonly string[];
  opts?: { timeoutMs?: number };
}

export interface FakeRunner extends Runner {
  calls: FakeRunnerCall[];
  setResponses: (responses: Record<string, Partial<RunResult>>) => void;
}

export function fakeRunner(
  initialResponses: Record<string, Partial<RunResult>> = {},
  t?: TestContext,
): FakeRunner {
  let responses: Record<string, Partial<RunResult>> = { ...initialResponses };
  const calls: FakeRunnerCall[] = [];
  const unexpected: string[] = [];
  if (t) {
    // runCli catches assertion errors, so a swallowed unexpected call must still fail the test.
    t.after(() => {
      assert.deepEqual(unexpected, []);
    });
  }

  const runner: Runner = async (command: string, args: readonly string[], opts?: { timeoutMs?: number }): Promise<RunResult> => {
    calls.push({ command, args, opts });
    const key = command + ' ' + args.join(' ');
    const match = responses[key];
    if (match !== undefined) {
      return {
        code: match.code ?? 0,
        stdout: match.stdout ?? '',
        stderr: match.stderr ?? '',
        timedOut: match.timedOut ?? false,
        error: match.error,
      };
    }

    const message = `fakeRunner: unexpected call: "${key}". Registered keys: ${Object.keys(responses).map((k) => `"${k}"`).join(', ')}`;
    unexpected.push(message);
    assert.fail(message);
  };

  const fake = runner as FakeRunner;
  fake.calls = calls;
  fake.setResponses = (newResponses: Record<string, Partial<RunResult>>) => {
    responses = { ...newResponses };
  };

  return fake;
}

export interface FakeIo extends IO {
  outLines: string[];
  errLines: string[];
  readonly outText: string;
  readonly errText: string;
  setCheckboxAnswers: (answers: string[][]) => void;
  setConfirmAnswers: (answers: boolean[]) => void;
}

export function fakeIo(
  options?: {
    checkboxAnswers?: string[][];
    confirmAnswers?: boolean[];
  },
  t?: TestContext,
): FakeIo {
  const outLines: string[] = [];
  const errLines: string[] = [];
  const checkboxQueue = [...(options?.checkboxAnswers ?? [])];
  const confirmQueue = [...(options?.confirmAnswers ?? [])];
  const unexpected: string[] = [];
  if (t) {
    // runCli catches assertion errors, so a swallowed prompt must still fail the test.
    t.after(() => {
      assert.deepEqual(unexpected, []);
    });
  }

  return {
    outLines,
    errLines,
    get outText(): string {
      return outLines.join('\n');
    },
    get errText(): string {
      return errLines.join('\n');
    },
    out(text: string): void {
      outLines.push(text);
    },
    err(text: string): void {
      errLines.push(text);
    },
    async checkbox<T extends string = string>(opts: CheckboxOptions<T>): Promise<T[]> {
      const answer = checkboxQueue.shift();
      if (answer === undefined) {
        const message = `fakeIo: unexpected checkbox prompt "${opts.message}" without configured answers`;
        unexpected.push(message);
        assert.fail(message);
      }
      return answer as T[];
    },
    async confirm(opts: ConfirmOptions): Promise<boolean> {
      const answer = confirmQueue.shift();
      if (answer === undefined) {
        const message = `fakeIo: unexpected confirm prompt "${opts.message}" without configured answers`;
        unexpected.push(message);
        assert.fail(message);
      }
      return answer;
    },
    setCheckboxAnswers(answers: string[][]): void {
      checkboxQueue.push(...answers);
    },
    setConfirmAnswers(answers: boolean[]): void {
      confirmQueue.push(...answers);
    },
  };
}

export interface FakeCtxOptions extends Partial<Ctx> {
  tempHomeDir?: string;
  tempBinDir?: string;
}

export interface FakeCtx extends Ctx {
  tempHomeDir: string;
  tempBinDir: string;
  runner: FakeRunner;
}

export function fakeCtx(overrides: FakeCtxOptions | undefined, t: TestContext): FakeCtx {
  const homeDir = overrides?.homeDir ?? overrides?.tempHomeDir ?? tempHome(t);
  const tempBinDir = overrides?.tempBinDir ?? path.join(homeDir, 'bin');
  if (!fs.existsSync(tempBinDir)) {
    fs.mkdirSync(tempBinDir, { recursive: true });
  }

  const platform: Platform = overrides?.platform ?? (
    process.platform === 'win32'
      ? 'win32'
      : process.platform === 'darwin'
        ? 'darwin'
        : 'linux'
  );

  const runner = (overrides?.run as FakeRunner) ?? fakeRunner({}, t);

  const fakeFetch: typeof fetch = async () => {
    throw new Error('fakeCtx: unexpected fetch call');
  };

  const fixedDate = new Date('2025-01-01T00:00:00.000Z');

  const env: Record<string, string | undefined> = {
    PATH: tempBinDir,
    ...overrides?.env,
  };

  const ctx: FakeCtx = {
    platform,
    homeDir,
    env,
    cwd: overrides?.cwd ?? homeDir,
    run: runner,
    fetch: overrides?.fetch ?? fakeFetch,
    now: overrides?.now ?? (() => fixedDate),
    isTTY: overrides?.isTTY ?? false,
    tempHomeDir: homeDir,
    tempBinDir,
    runner,
  };

  return ctx;
}

export function testAssets(): Assets {
  return {
    pluginVersion: '9.9.9',
    promptVersion: 'abc123',
    marketplace: {
      name: 'specx',
      gitUrl: 'https://github.com/redoxsoft/specx-marketplace.git',
      githubRepo: 'redoxsoft/specx-marketplace',
    },
    plugin: {
      name: 'specx',
      id: 'specx',
    },
    mcp: {
      serverName: 'specx',
      url: 'https://mcp.redoxsoft.com/mcp',
    },
    skills: [
      {
        name: 'specx',
        files: [
          {
            relativePath: 'SKILL.md',
            text: '# SpecX Skill\n<!-- specx-plugin: abc123 version: 9.9.9 -->\n',
          },
        ],
      },
    ],
    connectPageUrl: 'https://specx.redoxsoft.com/docs/connect',
  };
}

export function makeAgentExecutable(
  binDir: string,
  name: string,
  platform: Platform = process.platform === 'win32' ? 'win32' : 'linux',
): string {
  const fileName = platform === 'win32' ? `${name}.cmd` : name;
  const filePath = path.join(binDir, fileName);
  fs.writeFileSync(filePath, '#!/bin/sh\nexit 0\n', { mode: 0o755 });
  try {
    fs.chmodSync(filePath, 0o755);
  } catch {
    // Windows chmod might not support unix modes
  }
  return filePath;
}
