import { cursorPaths, getPath } from '../core/platform.js';
import { createFileAgent } from './file-agent.js';
import type { Agent } from './types.js';

export const cursorAgent: Agent = createFileAgent({
  id: 'cursor',
  name: 'Cursor',
  aliases: [],
  executables: ['cursor', 'cursor-agent'],
  homeMarker: (ctx) => getPath(ctx).dirname(cursorPaths(ctx).skillsDir),
  paths: cursorPaths,
  entry: (url) => ({ url }),
  signInHint: 'Cursor asks you to sign in to SpecX the first time you use it.',
});
