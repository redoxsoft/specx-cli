import { ALL_AGENTS, resolveAgents, type Agent, type AgentStatus, type Detection } from '../agents/index.js';
import type { Assets } from '../core/assets.js';
import type { Ctx } from '../core/context.js';
import { latestCliVersion, serverReachable } from '../core/network.js';
import { formatValidAgents, getCliVersion, type CommandOptions, type IO } from './io.js';

function parseSemver(v: string): [number, number, number] | null {
  const m = /^v?(\d+)\.(\d+)\.(\d+)/.exec(v.trim());
  if (!m) return null;
  const major = Number(m[1]);
  const minor = Number(m[2]);
  const patch = Number(m[3]);
  return [major, minor, patch];
}

function isOlder(current: string, latest: string): boolean {
  const c = parseSemver(current);
  const l = parseSemver(latest);
  if (!c || !l) return current !== latest;
  const [c0, c1, c2] = c;
  const [l0, l1, l2] = l;
  if (c0 < l0) return true;
  if (c0 > l0) return false;
  if (c1 < l1) return true;
  if (c1 > l1) return false;
  if (c2 < l2) return true;
  if (c2 > l2) return false;
  return false;
}

function formatAgentLine(item: { agent: Agent; det: Detection; status: AgentStatus }): string {
  const { agent, det, status } = item;
  let stateStr: string;
  if (!det.found) {
    stateStr = 'not found';
  } else if (status.installed === 'none') {
    stateStr = 'not installed';
  } else if (status.installed === 'plugin') {
    stateStr = status.version ? `plugin ${status.version}` : 'plugin';
  } else if (status.installed === 'files') {
    stateStr = status.version ? `files ${status.version}` : 'files';
  } else if (status.installed === 'partial') {
    stateStr = 'partial';
  } else {
    stateStr = 'unknown';
  }

  let line = `${agent.name}  ${stateStr}`;
  if (status.outdated) {
    line += '  [outdated]';
  }
  return line;
}

function computeStatusExitCode(
  results: { det: Detection; status: AgentStatus }[],
): number {
  let hasInstalled = false;
  let hasIssues = false;

  for (const { det, status } of results) {
    if (!det.found) {
      continue; // Agents that aren't found don't count.
    }

    if (status.installed === 'plugin' || status.installed === 'files') {
      hasInstalled = true;
      if (status.outdated || status.problems.length > 0) {
        hasIssues = true;
      }
    } else if (status.installed === 'partial') {
      hasInstalled = true;
      hasIssues = true;
    } else if (status.installed === 'unknown') {
      hasIssues = true;
    }
  }

  if (!hasInstalled || hasIssues) {
    return 1;
  }
  return 0;
}

export async function status(
  ctx: Ctx,
  assets: Assets,
  options: CommandOptions,
  io: IO,
): Promise<number> {
  const isJson = Boolean(options.json);

  let targetedAgents: readonly Agent[];
  if (options.agent !== undefined) {
    const { agents, unknown } = resolveAgents(options.agent);
    if (unknown.length > 0) {
      io.err(`Unknown agent${unknown.length > 1 ? 's' : ''}: ${unknown.join(', ')}. Valid agents: ${formatValidAgents()}`);
      return 2;
    }
    targetedAgents = agents;
  } else {
    targetedAgents = ALL_AGENTS;
  }

  const [agentResults, latestVer, reachable] = await Promise.all([
    Promise.all(
      targetedAgents.map(async (agent) => {
        const det = agent.detect(ctx);
        const st = await agent.status(ctx, assets, det);
        return { agent, det, status: st };
      }),
    ),
    latestCliVersion(ctx),
    serverReachable(ctx, assets.mcp.url),
  ]);

  const cliVersion = getCliVersion();

  if (isJson) {
    const payload = {
      cli: {
        version: cliVersion,
        latest: latestVer,
      },
      server: {
        reachable,
      },
      agents: agentResults.map((r) => r.status),
    };
    io.out(JSON.stringify(payload, null, 2));
    return computeStatusExitCode(agentResults);
  }

  const serverStr = reachable === true ? 'reachable' : reachable === false ? 'not reachable' : 'unknown';
  const latestStr = latestVer ?? 'unknown';
  io.out(`specx-cli ${cliVersion} · latest ${latestStr} · server ${serverStr}`);

  if (latestVer && isOlder(cliVersion, latestVer)) {
    io.out('A newer specx-cli is available: npx specx-cli@latest status');
  }

  for (const item of agentResults) {
    io.out(formatAgentLine(item));
    for (const problem of item.status.problems) {
      io.out(`  ${problem}`);
    }
  }

  return computeStatusExitCode(agentResults);
}
