import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export interface Assets {
  pluginVersion: string;
  promptVersion: string;
  marketplace: { name: string; gitUrl: string; githubRepo: string };
  plugin: { name: string; id: string };
  mcp: { serverName: string; url: string };
  skills: { name: string; files: { relativePath: string; text: string }[] }[];
  connectPageUrl: string;
}

function readDirFiles(baseDir: string, relDir = ''): { relativePath: string; text: string }[] {
  const current = path.join(baseDir, relDir);
  const entries = fs.readdirSync(current, { withFileTypes: true });
  const result: { relativePath: string; text: string }[] = [];

  for (const entry of entries) {
    const entryRel = relDir ? path.join(relDir, entry.name) : entry.name;
    if (entry.isDirectory()) {
      result.push(...readDirFiles(baseDir, entryRel));
    } else if (entry.isFile()) {
      result.push({
        relativePath: entryRel.replace(/\\/g, '/'),
        text: fs.readFileSync(path.join(baseDir, entryRel), 'utf8'),
      });
    }
  }

  result.sort((a, b) => (a.relativePath < b.relativePath ? -1 : a.relativePath > b.relativePath ? 1 : 0));
  return result;
}

export function loadAssets(): Assets {
  const currentFile = fileURLToPath(import.meta.url);
  const currentDir = path.dirname(currentFile);
  // dist/core/assets.js or src/core/assets.ts -> ../../assets
  const assetsDir = path.resolve(currentDir, '..', '..', 'assets');
  const manifestPath = path.join(assetsDir, 'manifest.json');

  if (!fs.existsSync(manifestPath)) {
    throw new Error(`SpecX assets manifest missing at ${manifestPath}`);
  }

  let raw: unknown;
  try {
    raw = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
  } catch (err) {
    throw new Error(`Failed to parse SpecX assets manifest at ${manifestPath}: ${err instanceof Error ? err.message : String(err)}`);
  }

  if (raw === null || typeof raw !== 'object') {
    throw new Error(`Invalid SpecX assets manifest at ${manifestPath}: expected an object`);
  }

  const m = raw as Record<string, unknown>;

  if (typeof m.pluginVersion !== 'string' || !m.pluginVersion) {
    throw new Error(`Invalid SpecX manifest: missing or invalid pluginVersion`);
  }
  if (typeof m.promptVersion !== 'string' || !m.promptVersion) {
    throw new Error(`Invalid SpecX manifest: missing or invalid promptVersion`);
  }
  if (typeof m.connectPageUrl !== 'string' || !m.connectPageUrl) {
    throw new Error(`Invalid SpecX manifest: missing or invalid connectPageUrl`);
  }

  const mp = m.marketplace as Record<string, unknown> | undefined;
  if (!mp || typeof mp.name !== 'string' || typeof mp.gitUrl !== 'string' || typeof mp.githubRepo !== 'string') {
    throw new Error(`Invalid SpecX manifest: missing or invalid marketplace configuration`);
  }

  const plugin = m.plugin as Record<string, unknown> | undefined;
  if (!plugin || typeof plugin.name !== 'string' || typeof plugin.id !== 'string') {
    throw new Error(`Invalid SpecX manifest: missing or invalid plugin configuration`);
  }

  const mcp = m.mcp as Record<string, unknown> | undefined;
  if (!mcp || typeof mcp.serverName !== 'string' || typeof mcp.url !== 'string') {
    throw new Error(`Invalid SpecX manifest: missing or invalid mcp configuration`);
  }

  if (!Array.isArray(m.skills)) {
    throw new Error(`Invalid SpecX manifest: skills must be an array`);
  }

  const skills: Assets['skills'] = [];
  for (const skillName of m.skills) {
    if (typeof skillName !== 'string') {
      throw new Error(`Invalid SpecX manifest: skill name must be a string`);
    }
    if (skillName.includes('/') || skillName.includes('\\') || skillName === '.' || skillName === '..') {
      throw new Error(`Invalid SpecX manifest: bad skill name "${skillName}"`);
    }
    const skillDir = path.join(assetsDir, 'skills', skillName);
    if (!fs.existsSync(skillDir) || !fs.statSync(skillDir).isDirectory()) {
      throw new Error(`Missing skill directory for "${skillName}" at ${skillDir}`);
    }
    let files: { relativePath: string; text: string }[];
    try {
      files = readDirFiles(skillDir);
    } catch (err) {
      throw new Error(
        `Cannot read skill "${skillName}" at ${skillDir}: ${err instanceof Error ? err.message : String(err)}`,
      );
    }
    if (!files.some((f) => f.relativePath === 'SKILL.md')) {
      throw new Error(`Missing SKILL.md for skill "${skillName}" at ${skillDir}`);
    }
    skills.push({ name: skillName, files });
  }

  return {
    pluginVersion: m.pluginVersion,
    promptVersion: m.promptVersion,
    marketplace: {
      name: mp.name,
      gitUrl: mp.gitUrl,
      githubRepo: mp.githubRepo,
    },
    plugin: {
      name: plugin.name,
      id: plugin.id,
    },
    mcp: {
      serverName: mcp.serverName,
      url: mcp.url,
    },
    skills,
    connectPageUrl: m.connectPageUrl,
  };
}
