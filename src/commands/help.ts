import type { Assets } from '../core/assets.js';
import type { Ctx } from '../core/context.js';
import type { CommandOptions, IO } from './io.js';

export async function help(
  _ctx: Ctx,
  assets: Assets,
  _options: CommandOptions,
  io: IO,
): Promise<number> {
  io.out('Usage: npx specx-cli@latest <command> [options]');
  io.out('');
  io.out('Commands:');
  io.out('  init     Set up SpecX in your coding agents (Claude Code, Codex, Cursor)');
  io.out('  status   Check SpecX installation, version, and server reachability');
  io.out('  remove   Remove SpecX from your coding agents');
  io.out('  help     Show this help message');
  io.out('');
  io.out('Options:');
  io.out('  --agent <list>  Target specific agents (comma-separated: claude, codex, cursor)');
  io.out('  -y, --yes       Run without interactive prompts');
  io.out('  --dry-run       Show the plan without making any changes');
  io.out('  --json          Output machine-readable JSON (status only)');
  io.out('  -h, --help      Show this help message');
  io.out('  -v, --version   Show CLI and plugin version');
  io.out('');
  io.out('Examples:');
  io.out('  npx specx-cli@latest init');
  io.out('  npx specx-cli@latest status');
  io.out('  npx specx-cli@latest remove --agent cursor');
  io.out('');
  io.out(`Docs: ${assets.connectPageUrl}`);
  return 0;
}
