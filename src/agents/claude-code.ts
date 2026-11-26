import type { Assets } from '../core/assets.js';
import type { Ctx } from '../core/context.js';
import type { AgentPlan, Step } from '../core/plan.js';
import { isWindowsBinaryUnderWsl } from '../core/platform.js';
import { findExecutable } from '../core/which.js';
import { commandError, parseJson } from './command-output.js';
import type { Agent, AgentStatus, Detection } from './types.js';

const LIST_TIMEOUT_MS = 30_000;

interface ClaudePluginItem {
  id: string;
  version?: string;
  scope?: string;
  enabled?: boolean;
}

interface ClaudeMarketplaceItem {
  name: string;
  url?: string;
  repo?: string;
}

function parseClaudePlugins(stdout: string): ClaudePluginItem[] | null {
  try {
    const raw = parseJson(stdout);
    if (!Array.isArray(raw)) return null;
    const items: ClaudePluginItem[] = [];
    for (const item of raw) {
      if (!item || typeof item !== 'object' || Array.isArray(item)) continue;
      const obj = item as Record<string, unknown>;
      if (typeof obj.id !== 'string') continue;
      const version = obj.version;
      const scope = obj.scope;
      const enabled = obj.enabled;
      items.push({
        id: obj.id,
        version: typeof version === 'string' ? version : undefined,
        scope: typeof scope === 'string' ? scope : undefined,
        enabled: typeof enabled === 'boolean' ? enabled : undefined,
      });
    }
    return items;
  } catch {
    // Malformed JSON is unreadable state, not a crash.
    return null;
  }
}

async function listClaudePlugins(
  ctx: Ctx,
  executable: string,
): Promise<{ ok: true; plugins: ClaudePluginItem[] } | { ok: false; error: string }> {
  const res = await ctx.run(executable, ['plugin', 'list', '--json'], { timeoutMs: LIST_TIMEOUT_MS });
  const failed = commandError('claude plugin list --json', res);
  if (failed) return { ok: false, error: failed };
  const plugins = parseClaudePlugins(res.stdout);
  if (plugins === null) {
    return { ok: false, error: 'claude plugin list --json returned invalid JSON' };
  }
  return { ok: true, plugins };
}

function parseClaudeMarketplaces(stdout: string): ClaudeMarketplaceItem[] | null {
  try {
    const raw = parseJson(stdout);
    if (!Array.isArray(raw)) return null;
    const items: ClaudeMarketplaceItem[] = [];
    for (const item of raw) {
      if (!item || typeof item !== 'object' || Array.isArray(item)) continue;
      const obj = item as Record<string, unknown>;
      if (typeof obj.name !== 'string') continue;
      const url = obj.url;
      const repo = obj.repo;
      items.push({
        name: obj.name,
        url: typeof url === 'string' ? url : undefined,
        repo: typeof repo === 'string' ? repo : undefined,
      });
    }
    return items;
  } catch {
    // Malformed JSON is unreadable state, not a crash.
    return null;
  }
}

async function listClaudeMarketplaces(
  ctx: Ctx,
  executable: string,
): Promise<{ ok: true; marketplaces: ClaudeMarketplaceItem[] } | { ok: false; error: string }> {
  const res = await ctx.run(executable, ['plugin', 'marketplace', 'list', '--json'], { timeoutMs: LIST_TIMEOUT_MS });
  const failed = commandError('claude plugin marketplace list --json', res);
  if (failed) return { ok: false, error: failed };
  const marketplaces = parseClaudeMarketplaces(res.stdout);
  if (marketplaces === null) {
    return { ok: false, error: 'claude plugin marketplace list --json returned invalid JSON' };
  }
  return { ok: true, marketplaces };
}

export const claudeCodeAgent: Agent = {
  id: 'claude-code',
  name: 'Claude Code',
  aliases: ['claude'],

  detect(ctx: Ctx): Detection {
    const exe = findExecutable(ctx, 'claude');
    if (!exe) {
      return { found: false, executable: null };
    }
    if (isWindowsBinaryUnderWsl(ctx, exe)) {
      return {
        found: false,
        executable: exe,
        note: "Claude Code is a Windows binary; its configuration lives on the Windows side",
      };
    }
    return { found: true, executable: exe };
  },

  async status(ctx: Ctx, assets: Assets, det: Detection): Promise<AgentStatus> {
    if (!det.found || !det.executable) {
      return {
        agentId: 'claude-code',
        agentName: 'Claude Code',
        detected: false,
        installed: 'none',
        version: null,
        outdated: null,
        authMode: 'unknown',
        problems: det.note ? [det.note] : [],
      };
    }

    const res = await listClaudePlugins(ctx, det.executable);
    if (!res.ok) {
      return {
        agentId: 'claude-code',
        agentName: 'Claude Code',
        detected: true,
        installed: 'unknown',
        version: null,
        outdated: null,
        authMode: 'unknown',
        problems: [res.error],
      };
    }

    const plugin = res.plugins.find((p) => p.id === assets.plugin.id);
    if (plugin) {
      const version = plugin.version ?? null;
      const outdated = version !== null ? version !== assets.pluginVersion : null;
      const problems: string[] = [];
      if (plugin.enabled === false) {
        problems.push(`SpecX is installed but disabled (claude plugin enable ${assets.plugin.id})`);
      }
      return {
        agentId: 'claude-code',
        agentName: 'Claude Code',
        detected: true,
        installed: 'plugin',
        version,
        outdated,
        authMode: 'oauth',
        problems,
      };
    }

    return {
      agentId: 'claude-code',
      agentName: 'Claude Code',
      detected: true,
      installed: 'none',
      version: null,
      outdated: null,
      authMode: 'unknown',
      problems: [],
    };
  },

  async planInit(ctx: Ctx, assets: Assets, det: Detection): Promise<AgentPlan> {
    const notes = det.note ? [det.note] : [];
    if (!det.found || !det.executable) {
      return {
        agentId: 'claude-code',
        agentName: 'Claude Code',
        steps: [{ kind: 'skip', describe: det.note ?? 'Claude Code is not installed' }],
        notes,
      };
    }

    const pluginRes = await listClaudePlugins(ctx, det.executable);
    if (!pluginRes.ok) {
      return {
        agentId: 'claude-code',
        agentName: 'Claude Code',
        steps: [{ kind: 'skip', describe: pluginRes.error }],
        notes,
      };
    }

    const plugin = pluginRes.plugins.find((p) => p.id === assets.plugin.id);
    if (plugin) {
      const verStr = plugin.version ? ` ${plugin.version}` : '';
      return {
        agentId: 'claude-code',
        agentName: 'Claude Code',
        steps: [{ kind: 'skip', describe: `SpecX${verStr} is already installed` }],
        notes,
      };
    }

    const marketplaceRes = await listClaudeMarketplaces(ctx, det.executable);
    if (!marketplaceRes.ok) {
      return {
        agentId: 'claude-code',
        agentName: 'Claude Code',
        steps: [{ kind: 'skip', describe: marketplaceRes.error }],
        notes,
      };
    }

    const hasMarketplace = marketplaceRes.marketplaces.some((m) => m.name === assets.marketplace.name);
    const steps: Step[] = [];
    if (!hasMarketplace) {
      steps.push({
        kind: 'run',
        command: 'claude',
        args: ['plugin', 'marketplace', 'add', assets.marketplace.gitUrl],
        describe: `Add marketplace ${assets.marketplace.name}`,
      });
    }
    steps.push({
      kind: 'run',
      command: 'claude',
      args: ['plugin', 'install', assets.plugin.id, '--scope', 'user'],
      describe: `Install plugin ${assets.plugin.id}`,
    });

    return {
      agentId: 'claude-code',
      agentName: 'Claude Code',
      steps,
      notes,
    };
  },

  async planRemove(ctx: Ctx, assets: Assets, det: Detection): Promise<AgentPlan> {
    const notes = det.note ? [det.note] : [];
    if (!det.found || !det.executable) {
      return {
        agentId: 'claude-code',
        agentName: 'Claude Code',
        steps: [{ kind: 'skip', describe: det.note ?? 'Claude Code is not installed' }],
        notes,
      };
    }

    const pluginRes = await listClaudePlugins(ctx, det.executable);
    if (!pluginRes.ok) {
      return {
        agentId: 'claude-code',
        agentName: 'Claude Code',
        steps: [{ kind: 'skip', describe: pluginRes.error }],
        notes,
      };
    }

    const plugin = pluginRes.plugins.find((p) => p.id === assets.plugin.id);
    if (plugin) {
      const scope = plugin.scope || 'user';
      return {
        agentId: 'claude-code',
        agentName: 'Claude Code',
        steps: [
          {
            kind: 'run',
            command: 'claude',
            args: ['plugin', 'uninstall', assets.plugin.id, '--scope', scope],
            describe: `Uninstall plugin ${assets.plugin.id}`,
          },
        ],
        notes,
      };
    }

    return {
      agentId: 'claude-code',
      agentName: 'Claude Code',
      steps: [{ kind: 'skip', describe: 'SpecX is not installed' }],
      notes,
    };
  },

  signInHint(_assets: Assets): string {
    return 'In Claude Code, type /mcp, choose plugin:specx:specx, then Authenticate. Or run: claude mcp login plugin:specx:specx';
  },
};
