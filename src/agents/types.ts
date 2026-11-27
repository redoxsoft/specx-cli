import type { Assets } from '../core/assets.js';
import type { Ctx } from '../core/context.js';
import type { AgentPlan } from '../core/plan.js';

export interface Detection {
  found: boolean;
  executable: string | null;
  note?: string; // note: e.g. WSL warning
}

export type InstallState = 'plugin' | 'files' | 'partial' | 'none' | 'unknown';

export interface AgentStatus {
  agentId: string;
  agentName: string;
  detected: boolean;
  installed: InstallState;
  version: string | null; // plugin version, or the copied skill's marker version
  outdated: boolean | null; // vs assets.pluginVersion; null when unknown
  authMode: 'oauth' | 'unknown';
  problems: string[]; // plain-language, e.g. "mcp.json has a 'specx' entry pointing elsewhere"
}

export interface Agent {
  id: 'claude-code' | 'codex' | 'cursor' | 'antigravity' | 'vscode';
  name: string; // "Claude Code", "Codex", "Cursor"
  aliases: string[]; // e.g. ['claude']
  detect(ctx: Ctx): Detection;
  status(ctx: Ctx, assets: Assets, det: Detection): Promise<AgentStatus>;
  planInit(ctx: Ctx, assets: Assets, det: Detection): Promise<AgentPlan>;
  planRemove(ctx: Ctx, assets: Assets, det: Detection): Promise<AgentPlan>;
  planUpdate(ctx: Ctx, assets: Assets, det: Detection): Promise<AgentPlan>;
  signInHint(assets: Assets): string;
}
