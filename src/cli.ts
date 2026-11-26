#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';
import { resolveAgents } from './agents/index.js';
import { help } from './commands/help.js';
import { init } from './commands/init.js';
import { formatValidAgents, getCliVersion, realIo, type CommandOptions, type IO } from './commands/io.js';
import { remove } from './commands/remove.js';
import { status } from './commands/status.js';
import { loadAssets, type Assets } from './core/assets.js';
import { realCtx, type Ctx } from './core/context.js';

function reportUnexpected(err: unknown, ctx: Ctx, io: IO): void {
  const raw = err instanceof Error ? err.message : String(err);
  io.err(`specx-cli: ${raw || 'Unknown error'}`);
  if (ctx.env.SPECX_DEBUG === '1' && err instanceof Error && err.stack) {
    io.err(err.stack);
  }
}

export async function runCli(
  args: string[],
  ctx: Ctx = realCtx(),
  io: IO = realIo(),
  loadedAssets?: Assets,
): Promise<number> {
  try {
    return await dispatchCli(args, ctx, io, loadedAssets);
  } catch (err) {
    reportUnexpected(err, ctx, io);
    return 1;
  }
}

async function dispatchCli(
  args: string[],
  ctx: Ctx,
  io: IO,
  loadedAssets: Assets | undefined,
): Promise<number> {
  const assets = loadedAssets ?? loadAssets();

  let values: {
    agent?: string;
    yes?: boolean;
    'dry-run'?: boolean;
    json?: boolean;
    help?: boolean;
    version?: boolean;
    project?: boolean;
    'api-key-env'?: string;
  };
  let positionals: string[];

  try {
    const res = parseArgs({
      args,
      options: {
        agent: { type: 'string' },
        yes: { type: 'boolean', short: 'y' },
        'dry-run': { type: 'boolean' },
        json: { type: 'boolean' },
        help: { type: 'boolean', short: 'h' },
        version: { type: 'boolean', short: 'v' },
        project: { type: 'boolean' },
        'api-key-env': { type: 'string' },
      },
      allowPositionals: true,
      strict: true,
    });
    values = res.values;
    positionals = res.positionals;
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    io.err(message);
    await help(ctx, assets, {}, io);
    return 2;
  }

  const command = positionals[0];

  // Phase 1: these are rejected even when combined with --version or --help.
  if (command === 'update' || values.project || values['api-key-env'] !== undefined) {
    io.err('not available yet');
    return 2;
  }

  if (values.version) {
    const cliVersion = getCliVersion();
    io.out(`specx-cli ${cliVersion} (SpecX plugin ${assets.pluginVersion})`);
    return 0;
  }

  // Unknown command
  if (command && !['init', 'status', 'remove', 'help'].includes(command)) {
    io.err(`Unknown command: ${command}`);
    await help(ctx, assets, {}, io);
    return 2;
  }

  // Unknown agent names
  if (values.agent !== undefined) {
    const { unknown } = resolveAgents(values.agent);
    if (unknown.length > 0) {
      io.err(`Unknown agent${unknown.length > 1 ? 's' : ''}: ${unknown.join(', ')}. Valid agents: ${formatValidAgents()}`);
      return 2;
    }
  }

  const options: CommandOptions = {
    agent: values.agent,
    yes: values.yes,
    dryRun: values['dry-run'],
    'dry-run': values['dry-run'],
    json: values.json,
    help: values.help,
    version: values.version,
    project: values.project,
    apiKeyEnv: values['api-key-env'],
    'api-key-env': values['api-key-env'],
  };

  if (values.help || command === 'help' || !command) {
    return help(ctx, assets, options, io);
  }

  switch (command) {
    case 'init':
      return init(ctx, assets, options, io);
    case 'status':
      return status(ctx, assets, options, io);
    case 'remove':
      return remove(ctx, assets, options, io);
    default:
      return help(ctx, assets, options, io);
  }
}

function isDirectExecution(): boolean {
  if (!process.argv[1]) return false;
  try {
    const realArgv1 = fs.realpathSync(process.argv[1]);
    const realThisFile = fs.realpathSync(fileURLToPath(import.meta.url));
    return realArgv1 === realThisFile;
  } catch {
    // realpath throws when argv[1] is missing; compare the path strings instead.
    return fileURLToPath(import.meta.url) === path.resolve(process.argv[1]);
  }
}

if (isDirectExecution()) {
  // realCtx() and realIo() run as defaults, before runCli's try. Command
  // errors are reported inside runCli. This catch is only for that setup.
  Promise.resolve()
    .then(() => runCli(process.argv.slice(2)))
    .then((code) => {
      process.exitCode = code;
    })
    .catch((err: unknown) => {
      const message = err instanceof Error ? err.message : String(err);
      process.stderr.write(`specx-cli: ${message || 'Unknown error'}\n`);
      process.exitCode = 1;
    });
}
