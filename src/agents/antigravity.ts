import { antigravityPaths, getPath } from '../core/platform.js';
import { createFileAgent } from './file-agent.js';
import type { Agent } from './types.js';

export const antigravityAgent: Agent = createFileAgent({
  id: 'antigravity',
  name: 'Antigravity',
  aliases: ['agy'],
  executables: ['agy'],
  homeMarker: (ctx) => getPath(ctx).join(ctx.homeDir, '.gemini', 'config'),
  paths: antigravityPaths,
  entry: (url) => ({ serverUrl: url }),
  signInHint:
    'In Antigravity, open the MCP servers list (/mcp in the CLI, or Customizations → Installed → MCP Servers in the app) and choose Authenticate for specx.',
});
