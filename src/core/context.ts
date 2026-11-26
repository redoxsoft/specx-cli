import os from 'node:os';
import process from 'node:process';
import { createRunner } from './run.js';

export type Platform = 'darwin' | 'linux' | 'win32';

export interface RunResult {
  code: number | null;
  stdout: string;
  stderr: string;
  timedOut: boolean;
  error?: string;
}

export type Runner = (
  command: string,
  args: readonly string[],
  opts?: { timeoutMs?: number }
) => Promise<RunResult>;

export interface Ctx {
  platform: Platform;
  homeDir: string;
  env: Readonly<Record<string, string | undefined>>;
  cwd: string;
  run: Runner;            // real: core/run.ts; tests: a fake
  fetch: typeof fetch;    // real: globalThis.fetch; tests: a fake
  now: () => Date;
  isTTY: boolean;
}

export function realCtx(): Ctx {
  const platform = process.platform === 'win32'
    ? 'win32'
    : process.platform === 'darwin'
      ? 'darwin'
      : 'linux';

  return {
    platform,
    homeDir: os.homedir(),
    env: process.env,
    cwd: process.cwd(),
    run: createRunner(),
    fetch: globalThis.fetch,
    now: () => new Date(),
    isTTY: Boolean(process.stdout.isTTY),
  };
}
