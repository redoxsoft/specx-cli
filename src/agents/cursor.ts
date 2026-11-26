import fs from 'node:fs';
import path from 'node:path';
import type { Assets } from '../core/assets.js';
import type { Ctx } from '../core/context.js';
import { planRemoveProperty, planSetProperty, readJsoncFile, type ParsedFile } from '../core/jsonc-file.js';
import { isOwnedMcpEntry, isOwnedSkillDir, OWNED_SKILL_NAMES, readSkillMarker } from '../core/ownership.js';
import type { AgentPlan, Step } from '../core/plan.js';
import { cursorPaths, isWindowsBinaryUnderWsl } from '../core/platform.js';
import { findExecutable } from '../core/which.js';
import type { Agent, AgentStatus, Detection, InstallState } from './types.js';

const CURSOR_EXECUTABLES = ['cursor', 'cursor-agent'] as const;
const MCP_JSON_ERROR = "Cursor's mcp.json has errors; fix it and run again";

function pathFor(ctx: Ctx): path.PlatformPath {
  return ctx.platform === 'win32' ? path.win32 : path.posix;
}

function plainObject(value: unknown): Record<string, unknown> | null {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return null;
  return value as Record<string, unknown>;
}

/** Where the SpecX server entry sits, or why mcp.json cannot be edited. */
function mcpEntry(
  file: ParsedFile,
  serverName: string,
): { ok: false } | { ok: true; entry: unknown | undefined } {
  if (!file.ok) return { ok: false };
  const root = plainObject(file.value);
  // jsonc-parser throws if this path is added under an array, null, or string.
  if (!root) return { ok: false };
  if (!Object.hasOwn(root, 'mcpServers')) return { ok: true, entry: undefined };
  const servers = plainObject(root.mcpServers);
  if (!servers) return { ok: false };
  if (!Object.hasOwn(servers, serverName)) return { ok: true, entry: undefined };
  return { ok: true, entry: servers[serverName] };
}

function leftAlone(serverName: string, entry: unknown): string {
  const record = plainObject(entry);
  const url = record && typeof record.url === 'string' ? record.url : null;
  if (url !== null) {
    return `mcp.json has a '${serverName}' entry pointing elsewhere (left alone: it points to ${url})`;
  }
  // The rest of the entry is not printed: it may hold Authorization or other header values.
  return `mcp.json has a '${serverName}' entry pointing elsewhere (left alone)`;
}

interface SkillDirState {
  exists: boolean;
  owned: boolean;
  version: string | null;
}

function readSkillDir(ctx: Ctx, dir: string): SkillDirState {
  if (!fs.existsSync(dir)) return { exists: false, owned: false, version: null };
  if (!isOwnedSkillDir(dir)) return { exists: true, owned: false, version: null };
  const skillMd = pathFor(ctx).join(dir, 'SKILL.md');
  try {
    const marker = readSkillMarker(fs.readFileSync(skillMd, 'utf8'));
    return { exists: true, owned: true, version: marker?.pluginVersion ?? null };
  } catch {
    // The marker was readable a moment ago; a second read failing means the version is unknown.
    return { exists: true, owned: true, version: null };
  }
}

export const cursorAgent: Agent = {
  id: 'cursor',
  name: 'Cursor',
  aliases: [],

  detect(ctx: Ctx): Detection {
    let windowsExe: string | null = null;
    for (const name of CURSOR_EXECUTABLES) {
      const exe = findExecutable(ctx, name);
      if (!exe) continue;
      if (isWindowsBinaryUnderWsl(ctx, exe)) {
        windowsExe ??= exe;
        continue;
      }
      return { found: true, executable: exe };
    }
    if (windowsExe) {
      // A binary under /mnt is the Windows agent. Its config lives on the Windows
      // side, so a Linux ~/.cursor is not a reason to set that agent up.
      return {
        found: false,
        executable: windowsExe,
        note: 'Cursor is a Windows binary; its configuration lives on the Windows side',
      };
    }
    const cursorDir = pathFor(ctx).dirname(cursorPaths(ctx).skillsDir);
    if (fs.existsSync(cursorDir)) {
      return { found: true, executable: null };
    }
    return { found: false, executable: null };
  },

  async status(ctx: Ctx, assets: Assets, det: Detection): Promise<AgentStatus> {
    if (!det.found) {
      return {
        agentId: 'cursor',
        agentName: 'Cursor',
        detected: false,
        installed: 'none',
        version: null,
        outdated: null,
        authMode: 'unknown',
        problems: det.note ? [det.note] : [],
      };
    }

    const { mcpJson, skillsDir } = cursorPaths(ctx);
    const p = pathFor(ctx);
    const file = readJsoncFile(mcpJson);
    const looked = mcpEntry(file, assets.mcp.serverName);
    const problems: string[] = [];

    if (!looked.ok) {
      problems.push(!file.ok ? `${MCP_JSON_ERROR}: ${file.error}` : MCP_JSON_ERROR);
    }

    let hasOwnedEntry = false;
    if (looked.ok && looked.entry !== undefined) {
      if (isOwnedMcpEntry(looked.entry, assets.mcp.url)) {
        hasOwnedEntry = true;
      } else {
        problems.push(leftAlone(assets.mcp.serverName, looked.entry));
      }
    }

    const specx = readSkillDir(ctx, p.join(skillsDir, 'specx'));
    if (specx.exists && !specx.owned) {
      problems.push("a 'specx' skill exists that SpecX didn't install");
    }

    const setup = readSkillDir(ctx, p.join(skillsDir, 'specx-setup'));
    if (setup.exists) {
      problems.push(
        setup.owned
          ? "a leftover 'specx-setup' skill exists"
          : "a 'specx-setup' skill exists that SpecX didn't install",
      );
    }

    let installed: InstallState;
    let authMode: 'oauth' | 'unknown';
    if (!looked.ok) {
      installed = 'unknown';
      authMode = 'unknown';
    } else if (hasOwnedEntry && specx.owned) {
      installed = 'files';
      authMode = 'oauth';
    } else if (hasOwnedEntry || specx.owned) {
      installed = 'partial';
      authMode = 'oauth';
    } else {
      installed = 'none';
      authMode = 'unknown';
    }

    const version = specx.owned ? specx.version : null;
    const outdated = version !== null ? version !== assets.pluginVersion : null;

    return {
      agentId: 'cursor',
      agentName: 'Cursor',
      detected: true,
      installed,
      version,
      outdated,
      authMode,
      problems,
    };
  },

  async planInit(ctx: Ctx, assets: Assets, det: Detection): Promise<AgentPlan> {
    const notes = det.note ? [det.note] : [];
    if (!det.found) {
      return {
        agentId: 'cursor',
        agentName: 'Cursor',
        steps: [{ kind: 'skip', describe: det.note ?? 'Cursor is not installed' }],
        notes,
      };
    }

    const { mcpJson, skillsDir } = cursorPaths(ctx);
    const p = pathFor(ctx);
    const file = readJsoncFile(mcpJson);
    const looked = mcpEntry(file, assets.mcp.serverName);
    if (!looked.ok) {
      return {
        agentId: 'cursor',
        agentName: 'Cursor',
        steps: [{ kind: 'skip', describe: MCP_JSON_ERROR }],
        notes,
      };
    }

    const steps: Step[] = [];
    if (looked.entry === undefined) {
      const change = planSetProperty(
        file,
        ['mcpServers', assets.mcp.serverName],
        { url: assets.mcp.url },
        "Add SpecX to Cursor's MCP servers",
      );
      steps.push({ kind: 'file', change });
    } else if (isOwnedMcpEntry(looked.entry, assets.mcp.url)) {
      steps.push({ kind: 'skip', describe: "SpecX MCP server is already configured in Cursor's mcp.json" });
    } else {
      steps.push({ kind: 'skip', describe: leftAlone(assets.mcp.serverName, looked.entry) });
    }

    for (const skill of assets.skills) {
      const destDir = p.join(skillsDir, skill.name);
      const state = readSkillDir(ctx, destDir);
      if (state.owned && state.version === assets.pluginVersion) {
        steps.push({
          kind: 'skip',
          describe: `SpecX skill ${skill.name} ${state.version} is already installed`,
        });
      } else {
        steps.push({
          kind: 'copy-skill',
          skill,
          destDir,
          describe: `Copy skill ${skill.name} to ${destDir}`,
        });
      }
    }

    // specx-setup is the old layout. Leave it in place when this build still ships it.
    if (!assets.skills.some((skill) => skill.name === 'specx-setup')) {
      const setupDir = p.join(skillsDir, 'specx-setup');
      if (fs.existsSync(setupDir) && isOwnedSkillDir(setupDir)) {
        steps.push({
          kind: 'remove-dir',
          dir: setupDir,
          describe: `Remove leftover skill directory ${setupDir}`,
        });
      }
    }

    return {
      agentId: 'cursor',
      agentName: 'Cursor',
      steps,
      notes,
    };
  },

  async planRemove(ctx: Ctx, assets: Assets, det: Detection): Promise<AgentPlan> {
    const notes = det.note ? [det.note] : [];
    if (!det.found) {
      return {
        agentId: 'cursor',
        agentName: 'Cursor',
        steps: [{ kind: 'skip', describe: det.note ?? 'Cursor is not installed' }],
        notes,
      };
    }

    const { mcpJson, skillsDir } = cursorPaths(ctx);
    const p = pathFor(ctx);
    const file = readJsoncFile(mcpJson);
    const looked = mcpEntry(file, assets.mcp.serverName);
    const steps: Step[] = [];

    if (!looked.ok) {
      steps.push({ kind: 'skip', describe: MCP_JSON_ERROR });
    } else if (looked.entry !== undefined) {
      if (isOwnedMcpEntry(looked.entry, assets.mcp.url)) {
        const change = planRemoveProperty(
          file,
          ['mcpServers', assets.mcp.serverName],
          "Remove SpecX from Cursor's MCP servers",
        );
        if (change) steps.push({ kind: 'file', change });
      } else {
        steps.push({ kind: 'skip', describe: leftAlone(assets.mcp.serverName, looked.entry) });
      }
    }

    for (const name of OWNED_SKILL_NAMES) {
      const dir = p.join(skillsDir, name);
      const state = readSkillDir(ctx, dir);
      if (!state.exists) continue;
      if (state.owned) {
        steps.push({
          kind: 'remove-dir',
          dir,
          describe: `Remove skill directory ${dir}`,
        });
      } else {
        steps.push({
          kind: 'skip',
          describe: `Skill directory ${dir} was not installed by SpecX (left alone)`,
        });
      }
    }

    if (steps.length === 0) {
      steps.push({ kind: 'skip', describe: 'SpecX is not installed' });
    }

    return {
      agentId: 'cursor',
      agentName: 'Cursor',
      steps,
      notes,
    };
  },

  signInHint(_assets: Assets): string {
    return 'Cursor asks you to sign in to SpecX the first time you use it.';
  },
};
