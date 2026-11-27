import fs from 'node:fs';
import type { Assets } from '../core/assets.js';
import type { Ctx } from '../core/context.js';
import { planRemoveProperty, planSetProperty, readJsoncFile, type ParsedFile } from '../core/jsonc-file.js';
import { isOwnedMcpEntry, isOwnedSkillDir, OWNED_SKILL_NAMES, readSkillMarker } from '../core/ownership.js';
import type { AgentPlan, Step } from '../core/plan.js';
import { getPath, isWindowsBinaryUnderWsl } from '../core/platform.js';
import { isOlder } from '../core/version.js';
import { findExecutable } from '../core/which.js';
import type { Agent, AgentStatus, Detection, InstallState } from './types.js';

export interface FileAgentConfig {
  id: Agent['id'];
  name: string;
  aliases: string[];
  executables: readonly string[];
  homeMarker: (ctx: Ctx) => string;
  paths: (ctx: Ctx) => { mcpJson: string; skillsDir: string };
  entry: (url: string) => Record<string, unknown>;
  signInHint: string | ((assets: Assets) => string);
}

function plainObject(value: unknown): Record<string, unknown> | null {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return null;
  return value as Record<string, unknown>;
}

/** Where the SpecX server entry sits, or why mcp.json / mcp_config.json cannot be edited. */
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

function sanitizeUrl(raw: string): string | null {
  try {
    const parsed = new URL(raw);
    return `${parsed.origin}${parsed.pathname}`;
  } catch {
    return null;
  }
}

function leftAlone(fileName: string, serverName: string, entry: unknown): string {
  const record = plainObject(entry);
  const rawUrl =
    record && typeof record.serverUrl === 'string'
      ? record.serverUrl
      : record && typeof record.url === 'string'
        ? record.url
        : null;
  const safe = rawUrl !== null ? sanitizeUrl(rawUrl) : null;
  if (safe !== null) {
    return `${fileName} has a '${serverName}' entry pointing elsewhere (left alone: it points to ${safe})`;
  }
  // The rest of the entry is not printed: it may hold Authorization or other header values.
  return `${fileName} has a '${serverName}' entry pointing elsewhere (left alone)`;
}

interface SkillDirState {
  exists: boolean;
  owned: boolean;
  version: string | null;
}

function readSkillDir(ctx: Ctx, dir: string): SkillDirState {
  if (!fs.existsSync(dir)) return { exists: false, owned: false, version: null };
  if (!isOwnedSkillDir(dir)) return { exists: true, owned: false, version: null };
  const skillMd = getPath(ctx).join(dir, 'SKILL.md');
  try {
    const marker = readSkillMarker(fs.readFileSync(skillMd, 'utf8'));
    return { exists: true, owned: true, version: marker?.pluginVersion ?? null };
  } catch {
    // The marker was readable a moment ago; a second read failing means the version is unknown.
    return { exists: true, owned: true, version: null };
  }
}

export function createFileAgent(config: FileAgentConfig): Agent {
  return {
    id: config.id,
    name: config.name,
    aliases: config.aliases,

    detect(ctx: Ctx): Detection {
      let windowsExe: string | null = null;
      for (const name of config.executables) {
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
        // side, so a Linux ~/.cursor or ~/.gemini is not a reason to set that agent up.
        return {
          found: false,
          executable: windowsExe,
          note: `${config.name} is a Windows binary; its configuration lives on the Windows side`,
        };
      }
      const markerDir = config.homeMarker(ctx);
      if (fs.existsSync(markerDir)) {
        return { found: true, executable: null };
      }
      return { found: false, executable: null };
    },

    async status(ctx: Ctx, assets: Assets, det: Detection): Promise<AgentStatus> {
      if (!det.found) {
        return {
          agentId: config.id,
          agentName: config.name,
          detected: false,
          installed: 'none',
          version: null,
          outdated: null,
          authMode: 'unknown',
          problems: det.note ? [det.note] : [],
        };
      }

      const { mcpJson, skillsDir } = config.paths(ctx);
      const p = getPath(ctx);
      const fileName = p.basename(mcpJson);
      const mcpJsonError = `${config.name}'s ${fileName} has errors; fix it and run again`;
      const file = readJsoncFile(mcpJson);
      const looked = mcpEntry(file, assets.mcp.serverName);
      const problems: string[] = [];

      if (!looked.ok) {
        problems.push(!file.ok ? `${mcpJsonError}: ${file.error}` : mcpJsonError);
      }

      let hasOwnedEntry = false;
      if (looked.ok && looked.entry !== undefined) {
        if (isOwnedMcpEntry(looked.entry, assets.mcp.url)) {
          hasOwnedEntry = true;
        } else {
          problems.push(leftAlone(fileName, assets.mcp.serverName, looked.entry));
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
      const outdated = version !== null ? isOlder(version, assets.pluginVersion) : null;

      return {
        agentId: config.id,
        agentName: config.name,
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
          agentId: config.id,
          agentName: config.name,
          steps: [{ kind: 'skip', describe: det.note ?? `${config.name} is not installed` }],
          notes,
        };
      }

      const { mcpJson, skillsDir } = config.paths(ctx);
      const p = getPath(ctx);
      const fileName = p.basename(mcpJson);
      const mcpJsonError = `${config.name}'s ${fileName} has errors; fix it and run again`;
      const file = readJsoncFile(mcpJson);
      const looked = mcpEntry(file, assets.mcp.serverName);
      if (!looked.ok) {
        return {
          agentId: config.id,
          agentName: config.name,
          steps: [{ kind: 'skip', describe: mcpJsonError, problem: true }],
          notes,
        };
      }

      const steps: Step[] = [];
      if (looked.entry === undefined) {
        const change = planSetProperty(
          file,
          ['mcpServers', assets.mcp.serverName],
          config.entry(assets.mcp.url),
          `Add SpecX to ${config.name}'s MCP servers`,
        );
        steps.push({ kind: 'file', change });
      } else if (isOwnedMcpEntry(looked.entry, assets.mcp.url)) {
        steps.push({
          kind: 'skip',
          describe: `SpecX MCP server is already configured in ${config.name}'s ${fileName}`,
        });
      } else {
        steps.push({
          kind: 'skip',
          describe: leftAlone(fileName, assets.mcp.serverName, looked.entry),
          problem: true,
        });
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
        agentId: config.id,
        agentName: config.name,
        steps,
        notes,
      };
    },

    async planRemove(ctx: Ctx, assets: Assets, det: Detection): Promise<AgentPlan> {
      const notes = det.note ? [det.note] : [];
      if (!det.found) {
        return {
          agentId: config.id,
          agentName: config.name,
          steps: [{ kind: 'skip', describe: det.note ?? `${config.name} is not installed` }],
          notes,
        };
      }

      const { mcpJson, skillsDir } = config.paths(ctx);
      const p = getPath(ctx);
      const fileName = p.basename(mcpJson);
      const mcpJsonError = `${config.name}'s ${fileName} has errors; fix it and run again`;
      const file = readJsoncFile(mcpJson);
      const looked = mcpEntry(file, assets.mcp.serverName);
      const steps: Step[] = [];

      if (!looked.ok) {
        steps.push({ kind: 'skip', describe: mcpJsonError, problem: true });
      } else if (looked.entry !== undefined) {
        if (isOwnedMcpEntry(looked.entry, assets.mcp.url)) {
          const change = planRemoveProperty(
            file,
            ['mcpServers', assets.mcp.serverName],
            `Remove SpecX from ${config.name}'s MCP servers`,
          );
          if (change) steps.push({ kind: 'file', change });
        } else {
          steps.push({
            kind: 'skip',
            describe: leftAlone(fileName, assets.mcp.serverName, looked.entry),
            problem: true,
          });
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
            problem: true,
          });
        }
      }

      if (steps.length === 0) {
        steps.push({ kind: 'skip', describe: 'SpecX is not installed', absent: true });
      }

      return {
        agentId: config.id,
        agentName: config.name,
        steps,
        notes,
      };
    },

    async planUpdate(ctx: Ctx, assets: Assets, det: Detection): Promise<AgentPlan> {
      const notes = det.note ? [det.note] : [];
      if (!det.found) {
        return {
          agentId: config.id,
          agentName: config.name,
          steps: [{ kind: 'skip', describe: det.note ?? `${config.name} is not installed` }],
          notes,
        };
      }

      const { mcpJson, skillsDir } = config.paths(ctx);
      const p = getPath(ctx);
      const fileName = p.basename(mcpJson);
      const mcpJsonError = `${config.name}'s ${fileName} has errors; fix it and run again`;
      const file = readJsoncFile(mcpJson);
      const looked = mcpEntry(file, assets.mcp.serverName);

      if (!looked.ok) {
        return {
          agentId: config.id,
          agentName: config.name,
          steps: [{ kind: 'skip', describe: mcpJsonError, problem: true }],
          notes,
        };
      }

      const steps: Step[] = [];

      const hasOwnedEntry = looked.entry !== undefined && isOwnedMcpEntry(looked.entry, assets.mcp.url);
      const hasForeignEntry = looked.entry !== undefined && !isOwnedMcpEntry(looked.entry, assets.mcp.url);

      if (hasForeignEntry) {
        steps.push({
          kind: 'skip',
          describe: leftAlone(fileName, assets.mcp.serverName, looked.entry),
          problem: true,
        });
      }

      const specxDir = p.join(skillsDir, 'specx');
      const specxState = readSkillDir(ctx, specxDir);
      const hasOwnedSkill = specxState.exists && specxState.owned;
      const hasUnownedSkill = specxState.exists && !specxState.owned;

      if (hasUnownedSkill) {
        steps.push({
          kind: 'skip',
          describe: "a 'specx' skill exists that SpecX didn't install",
          problem: true,
        });
      }

      if (!hasOwnedEntry && !hasOwnedSkill) {
        if (!hasForeignEntry && !hasUnownedSkill) {
          steps.push({
            kind: 'skip',
            describe: 'not installed; run `npx specx-cli@latest init`',
            absent: true,
          });
        }
      } else {
        if (hasOwnedSkill) {
          const refreshSpecx =
            specxState.version === null || isOlder(specxState.version, assets.pluginVersion);
          if (refreshSpecx) {
            const bundled = assets.skills.find((skill) => skill.name === 'specx');
            if (bundled) {
              steps.push({
                kind: 'copy-skill',
                skill: bundled,
                destDir: specxDir,
                describe: `Copy skill ${bundled.name} to ${specxDir}`,
              });
            }
          } else {
            steps.push({
              kind: 'skip',
              describe: 'up to date',
            });
          }
        }

        if ((hasOwnedEntry && !hasOwnedSkill) || (!hasOwnedEntry && hasOwnedSkill)) {
          steps.push({
            kind: 'skip',
            describe: 'partly set up; run `npx specx-cli@latest init` to finish',
            problem: true,
          });
        }
      }

      // Replace another bundled skill only when its directory already carries the
      // SpecX marker and that marker is older than this plugin, or has no version.
      // A missing skill is left for init. A directory without the marker is never overwritten.
      for (const skill of assets.skills) {
        if (skill.name === 'specx') continue;
        const destDir = p.join(skillsDir, skill.name);
        const state = readSkillDir(ctx, destDir);
        if (!state.owned) continue;
        if (state.version !== null && !isOlder(state.version, assets.pluginVersion)) continue;
        steps.push({
          kind: 'copy-skill',
          skill,
          destDir,
          describe: `Copy skill ${skill.name} to ${destDir}`,
        });
      }

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
        agentId: config.id,
        agentName: config.name,
        steps,
        notes,
      };
    },

    signInHint(assets: Assets): string {
      return typeof config.signInHint === 'function'
        ? config.signInHint(assets)
        : config.signInHint;
    },
  };
}
