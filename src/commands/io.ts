import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';
import { styleText } from 'node:util';
import { checkbox, confirm } from '@inquirer/prompts';
import { ALL_AGENTS } from '../agents/index.js';
import type { Ctx } from '../core/context.js';

export interface CheckboxChoice<T> {
  name?: string;
  value: T;
  checked?: boolean;
}

export interface CheckboxOptions<T> {
  message: string;
  choices: readonly CheckboxChoice<T>[];
}

export interface ConfirmOptions {
  message: string;
  default?: boolean;
}

export interface IO {
  out(text: string): void;
  err(text: string): void;
  checkbox<T extends string = string>(opts: CheckboxOptions<T>): Promise<T[]>;
  confirm(opts: ConfirmOptions): Promise<boolean>;
}

export interface CommandOptions {
  agent?: string;
  yes?: boolean;
  dryRun?: boolean;
  'dry-run'?: boolean;
  json?: boolean;
  help?: boolean;
  version?: boolean;
  project?: boolean;
  apiKeyEnv?: string;
  'api-key-env'?: string;
}

function useColor(ctx: Ctx): boolean {
  return ctx.isTTY && !ctx.env.NO_COLOR;
}

export function formatCheck(ctx: Ctx): string {
  if (useColor(ctx)) {
    // validateStream would read the real stdout and ignore ctx.isTTY.
    return styleText('green', '✓', { validateStream: false });
  }
  return '✓';
}

export function formatCross(ctx: Ctx): string {
  if (useColor(ctx)) {
    return styleText('red', '✗', { validateStream: false });
  }
  return '✗';
}

export function formatValidAgents(): string {
  return ALL_AGENTS.map((a) =>
    a.aliases.length > 0 ? `${a.id} (${a.aliases.join(', ')})` : a.id,
  ).join(', ');
}

export function formatNoAgentsMessage(): string {
  const names = ALL_AGENTS.map((a) => a.name).join(', ');
  return `No supported agents found (${names}).`;
}

export function getCliVersion(): string {
  const pkgPath = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..', 'package.json');
  let parsed: unknown;
  try {
    parsed = JSON.parse(fs.readFileSync(pkgPath, 'utf8'));
  } catch (err) {
    // Keep the path in the message; the top-level handler prints only that one line.
    const detail = err instanceof Error ? err.message : String(err);
    throw new Error(`Cannot read specx-cli version from ${pkgPath}: ${detail}`);
  }
  const version =
    parsed !== null && typeof parsed === 'object' && 'version' in parsed
      ? (parsed as { version?: unknown }).version
      : undefined;
  if (typeof version !== 'string' || version.length === 0) {
    throw new Error(`package.json at ${pkgPath} has no version`);
  }
  return version;
}

export function realIo(): IO {
  return {
    out(text: string): void {
      process.stdout.write(text.endsWith('\n') ? text : `${text}\n`);
    },
    err(text: string): void {
      process.stderr.write(text.endsWith('\n') ? text : `${text}\n`);
    },
    async checkbox<T extends string = string>(opts: CheckboxOptions<T>): Promise<T[]> {
      const result = await checkbox({
        message: opts.message,
        choices: opts.choices.map((c) => ({
          name: c.name,
          value: c.value,
          checked: c.checked,
        })),
      });
      return result as T[];
    },
    async confirm(opts: ConfirmOptions): Promise<boolean> {
      return confirm({
        message: opts.message,
        default: opts.default,
      });
    },
  };
}
