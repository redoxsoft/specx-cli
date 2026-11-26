import fs from 'node:fs';
import path from 'node:path';

export const SKILL_MARKER = /^<!-- specx-plugin: ([0-9a-f]+)(?: version: (\S+))? -->$/;

export function readSkillMarker(
  text: string
): { promptVersion: string; pluginVersion: string | null } | null {
  const lines = text.trimEnd().split(/\r?\n/);
  for (let i = lines.length - 1; i >= 0; i--) {
    const line = lines[i]?.trim();
    if (line) {
      const match = line.match(SKILL_MARKER);
      if (match && match[1]) {
        return {
          promptVersion: match[1],
          pluginVersion: match[2] ?? null,
        };
      }
      return null;
    }
  }
  return null;
}

export function isOwnedSkillDir(dir: string): boolean {
  try {
    const skillMd = path.join(dir, 'SKILL.md');
    if (!fs.existsSync(skillMd)) {
      return false;
    }
    const text = fs.readFileSync(skillMd, 'utf8');
    return readSkillMarker(text) !== null;
  } catch {
    // If directory or file cannot be read, it is not an owned skill dir
    return false;
  }
}

export function isOwnedMcpEntry(entry: unknown, mcpUrl: string): boolean {
  if (entry === null || typeof entry !== 'object') {
    return false;
  }
  const obj = entry as Record<string, unknown>;
  return typeof obj.url === 'string' && obj.url === mcpUrl;
}

export const OWNED_SKILL_NAMES: readonly string[] = ['specx', 'specx-setup'] as const;
