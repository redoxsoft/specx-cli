import { copilotHome, copilotPaths } from '../core/platform.js';
import { createFileAgent } from './file-agent.js';
import type { Agent } from './types.js';

export const vscodeAgent: Agent = createFileAgent({
  id: 'vscode',
  name: 'VS Code / Copilot',
  aliases: ['code', 'copilot'],
  executables: ['code', 'copilot'],
  homeMarker: copilotHome,
  paths: copilotPaths,
  entry: (url) => ({ type: 'http', url }),
  signInHint:
    'In VS Code, open Copilot Chat, start a session that uses SpecX, and complete sign-in when asked (or choose Authenticate in the session\'s server actions).',
});
