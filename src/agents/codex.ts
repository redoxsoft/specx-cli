import type { Assets } from '../core/assets.js';
import type { Ctx } from '../core/context.js';
import type { AgentPlan, Step } from '../core/plan.js';
import { isWindowsBinaryUnderWsl } from '../core/platform.js';
import { findExecutable } from '../core/which.js';
import { commandError, parseJson } from './command-output.js';
import type { Agent, AgentStatus, Detection } from './types.js';

const LIST_TIMEOUT_MS = 30_000;

interface CodexPluginItem {
  pluginId: string;
  version?: string;
  enabled?: boolean;
  marketplaceName?: string;
}

function parseCodexPlugins(stdout: string): CodexPluginItem[] | null {
  try {
    const raw = parseJson(stdout);
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null;
    const installed = (raw as Record<string, unknown>).installed;
    if (!Array.isArray(installed)) return null;
    const items: CodexPluginItem[] = [];
    for (const item of installed) {
      if (!item || typeof item !== 'object' || Array.isArray(item)) continue;
      const obj = item as Record<string, unknown>;
      if (typeof obj.pluginId !== 'string') continue;
      const version = obj.version;
      const enabled = obj.enabled;
      const marketplaceName = obj.marketplaceName;
      items.push({
        pluginId: obj.pluginId,
        version: typeof version === 'string' ? version : undefined,
        enabled: typeof enabled === 'boolean' ? enabled : undefined,
        marketplaceName: typeof marketplaceName === 'string' ? marketplaceName : undefined,
      });
    }
    return items;
  } catch {
    // Malformed JSON is unreadable state, not a crash.
    return null;
  }
}

async function listCodexPlugins(
  ctx: Ctx,
  executable: string,
): Promise<{ ok: true; plugins: CodexPluginItem[] } | { ok: false; error: string }> {
  const res = await ctx.run(executable, ['plugin', 'list', '--json'], { timeoutMs: LIST_TIMEOUT_MS });
  const failed = commandError('codex plugin list --json', res);
  if (failed) return { ok: false, error: failed };
  const plugins = parseCodexPlugins(res.stdout);
  if (plugins === null) {
    return { ok: false, error: 'codex plugin list --json returned invalid JSON' };
  }
  return { ok: true, plugins };
}

async function hasCodexMarketplace(
  ctx: Ctx,
  executable: string,
  marketplaceName: string,
): Promise<{ ok: true; present: boolean } | { ok: false; error: string }> {
  const res = await ctx.run(executable, ['plugin', 'marketplace', 'list'], { timeoutMs: LIST_TIMEOUT_MS });
  const failed = commandError('codex plugin marketplace list', res);
  if (failed) return { ok: false, error: failed };
  return { ok: true, present: marketplaceListed(res.stdout, marketplaceName) };
}

function marketplaceListed(stdout: string, marketplaceName: string): boolean {
  const lines = stdout.split(/\r?\n/);
  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    const cols = trimmed.split(/\s+/);
    const first = cols[0];
    const second = cols[1];
    // Header row is "MARKETPLACE ROOT" (spacing varies). It is not a marketplace name.
    if (first === 'MARKETPLACE' && second === 'ROOT') continue;
    if (first === marketplaceName) return true;
  }
  return false;
}

export const codexAgent: Agent = {
  id: 'codex',
  name: 'Codex',
  aliases: [],

  detect(ctx: Ctx): Detection {
    const exe = findExecutable(ctx, 'codex');
    if (!exe) {
      return { found: false, executable: null };
    }
    if (isWindowsBinaryUnderWsl(ctx, exe)) {
      return {
        found: false,
        executable: exe,
        note: "Codex is a Windows binary; its configuration lives on the Windows side",
      };
    }
    return { found: true, executable: exe };
  },

  async status(ctx: Ctx, assets: Assets, det: Detection): Promise<AgentStatus> {
    if (!det.found || !det.executable) {
      return {
        agentId: 'codex',
        agentName: 'Codex',
        detected: false,
        installed: 'none',
        version: null,
        outdated: null,
        authMode: 'unknown',
        problems: det.note ? [det.note] : [],
      };
    }

    const res = await listCodexPlugins(ctx, det.executable);
    if (!res.ok) {
      return {
        agentId: 'codex',
        agentName: 'Codex',
        detected: true,
        installed: 'unknown',
        version: null,
        outdated: null,
        authMode: 'unknown',
        problems: [res.error],
      };
    }

    const plugin = res.plugins.find((p) => p.pluginId === assets.plugin.id);
    if (plugin) {
      const version = plugin.version ?? null;
      const outdated = version !== null ? version !== assets.pluginVersion : null;
      const problems: string[] = [];
      if (plugin.enabled === false) {
        problems.push(`SpecX is installed but disabled (codex plugin enable ${assets.plugin.id})`);
      }
      return {
        agentId: 'codex',
        agentName: 'Codex',
        detected: true,
        installed: 'plugin',
        version,
        outdated,
        authMode: 'oauth',
        problems,
      };
    }

    return {
      agentId: 'codex',
      agentName: 'Codex',
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
        agentId: 'codex',
        agentName: 'Codex',
        steps: [{ kind: 'skip', describe: det.note ?? 'Codex is not installed' }],
        notes,
      };
    }

    const pluginRes = await listCodexPlugins(ctx, det.executable);
    if (!pluginRes.ok) {
      return {
        agentId: 'codex',
        agentName: 'Codex',
        steps: [{ kind: 'skip', describe: pluginRes.error }],
        notes,
      };
    }

    const plugin = pluginRes.plugins.find((p) => p.pluginId === assets.plugin.id);
    if (plugin) {
      const verStr = plugin.version ? ` ${plugin.version}` : '';
      return {
        agentId: 'codex',
        agentName: 'Codex',
        steps: [{ kind: 'skip', describe: `SpecX${verStr} is already installed` }],
        notes,
      };
    }

    const mpRes = await hasCodexMarketplace(ctx, det.executable, assets.marketplace.name);
    if (!mpRes.ok) {
      return {
        agentId: 'codex',
        agentName: 'Codex',
        steps: [{ kind: 'skip', describe: mpRes.error }],
        notes,
      };
    }

    const steps: Step[] = [];
    if (!mpRes.present) {
      steps.push({
        kind: 'run',
        command: 'codex',
        args: ['plugin', 'marketplace', 'add', assets.marketplace.githubRepo],
        describe: `Add marketplace ${assets.marketplace.name}`,
      });
    }
    steps.push({
      kind: 'run',
      command: 'codex',
      args: ['plugin', 'add', assets.plugin.id],
      describe: `Install plugin ${assets.plugin.id}`,
    });

    return {
      agentId: 'codex',
      agentName: 'Codex',
      steps,
      notes,
    };
  },

  async planRemove(ctx: Ctx, assets: Assets, det: Detection): Promise<AgentPlan> {
    const notes = det.note ? [det.note] : [];
    if (!det.found || !det.executable) {
      return {
        agentId: 'codex',
        agentName: 'Codex',
        steps: [{ kind: 'skip', describe: det.note ?? 'Codex is not installed' }],
        notes,
      };
    }

    const pluginRes = await listCodexPlugins(ctx, det.executable);
    if (!pluginRes.ok) {
      return {
        agentId: 'codex',
        agentName: 'Codex',
        steps: [{ kind: 'skip', describe: pluginRes.error }],
        notes,
      };
    }

    const plugin = pluginRes.plugins.find((p) => p.pluginId === assets.plugin.id);
    if (plugin) {
      return {
        agentId: 'codex',
        agentName: 'Codex',
        steps: [
          {
            kind: 'run',
            command: 'codex',
            args: ['plugin', 'remove', assets.plugin.id],
            describe: `Remove plugin ${assets.plugin.id}`,
          },
        ],
        notes,
      };
    }

    return {
      agentId: 'codex',
      agentName: 'Codex',
      steps: [{ kind: 'skip', describe: 'SpecX is not installed' }],
      notes,
    };
  },

  signInHint(_assets: Assets): string {
    return 'Run: codex mcp login specx (or start Codex and use SpecX; it asks you to sign in).';
  },
};
