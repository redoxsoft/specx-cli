import type { Agent } from './types.js';
import { claudeCodeAgent } from './claude-code.js';
import { codexAgent } from './codex.js';
import { cursorAgent } from './cursor.js';
import { antigravityAgent } from './antigravity.js';
import { vscodeAgent } from './vscode.js';

export * from './types.js';
export { claudeCodeAgent } from './claude-code.js';
export { codexAgent } from './codex.js';
export { cursorAgent } from './cursor.js';
export { antigravityAgent } from './antigravity.js';
export { vscodeAgent } from './vscode.js';

export const ALL_AGENTS: readonly Agent[] = [
  claudeCodeAgent,
  codexAgent,
  cursorAgent,
  antigravityAgent,
  vscodeAgent,
];

export function resolveAgents(list: string): { agents: Agent[]; unknown: string[] } {
  const tokens = list
    .split(',')
    .map((s) => s.trim())
    .filter((s) => s.length > 0);

  const agents: Agent[] = [];
  const unknown: string[] = [];

  for (const token of tokens) {
    const lower = token.toLowerCase();
    const match = ALL_AGENTS.find(
      (a) => a.id.toLowerCase() === lower || a.aliases.some((alias) => alias.toLowerCase() === lower),
    );
    if (match) {
      if (!agents.includes(match)) {
        agents.push(match);
      }
    } else {
      if (!unknown.includes(token)) {
        unknown.push(token);
      }
    }
  }

  return { agents, unknown };
}
