import { ALL_AGENTS, resolveAgents, type Agent, type Detection } from '../agents/index.js';
import type { Assets } from '../core/assets.js';
import type { Ctx } from '../core/context.js';
import { executePlan, renderPlan, type AgentPlan } from '../core/plan.js';
import { findExecutable } from '../core/which.js';
import { formatCheck, formatCross, formatValidAgents, type CommandOptions, type IO } from './io.js';

export async function init(
  ctx: Ctx,
  assets: Assets,
  options: CommandOptions,
  io: IO,
): Promise<number> {
  const isYes = Boolean(options.yes);
  const isDryRun = Boolean(options.dryRun || options['dry-run']);

  // 1. Detect: the --agent list, or every agent in ALL_AGENTS.
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

  const detected: { agent: Agent; det: Detection }[] = [];
  for (const agent of targetedAgents) {
    const det = agent.detect(ctx);
    if (det.note) {
      io.out(det.note);
    }
    detected.push({ agent, det });
  }

  // 2. None found
  const found = detected.filter(({ det }) => det.found);
  if (found.length === 0) {
    io.out('No supported agents found (Claude Code, Codex, Cursor).');
    io.out(`Other agents: ${assets.connectPageUrl}`);
    return 1;
  }

  // 3. Choose
  // Without a TTY and without --yes or --dry-run: print and exit 2, before asking anything.
  if (!ctx.isTTY && !isYes && !isDryRun) {
    io.err('Run with --yes to set up without questions, or --dry-run to see the plan.');
    return 2;
  }

  let chosen: { agent: Agent; det: Detection }[];
  if (options.agent !== undefined || isYes || (!ctx.isTTY && isDryRun)) {
    chosen = found;
  } else {
    const choices = found.map(({ agent }) => ({
      name: agent.name,
      value: agent.id,
      checked: true,
    }));
    const selectedIds = await io.checkbox({
      message: 'Select agents to set up SpecX:',
      choices,
    });
    chosen = found.filter(({ agent }) => selectedIds.includes(agent.id));
    if (chosen.length === 0) {
      io.out('Nothing to do.');
      return 0;
    }
  }

  // 4. Plan
  const planned: { agent: Agent; plan: AgentPlan }[] = [];
  for (const { agent, det } of chosen) {
    const plan = await agent.planInit(ctx, assets, det);
    planned.push({ agent, plan });
  }

  const plans = planned.map((p) => p.plan);
  const rendered = renderPlan(plans);
  if (rendered.length > 0) {
    io.out(rendered);
  }

  const allSkip = plans.every((p) => p.steps.every((s) => s.kind === 'skip'));
  if (allSkip) {
    io.out('Nothing to do.');
    return 0;
  }

  // 5. --dry-run
  if (isDryRun) {
    return 0;
  }

  // 6. Confirm
  if (!isYes) {
    const confirmed = await io.confirm({
      message: 'Apply these changes?',
      default: true,
    });
    if (!confirmed) {
      return 0;
    }
  }

  // 7. Apply
  const resultsByAgent: {
    agent: Agent;
    ok: boolean;
    error?: string;
    backupPaths: string[];
  }[] = [];

  for (const { agent, plan } of planned) {
    const stepResults = await executePlan(ctx, plan, (name) => findExecutable(ctx, name));
    const failedStep = stepResults.find((r) => !r.ok);
    const backupPaths = stepResults
      .map((r) => r.backupPath)
      .filter((b): b is string => typeof b === 'string' && b.length > 0);

    if (failedStep) {
      resultsByAgent.push({
        agent,
        ok: false,
        error: failedStep.error ?? 'Unknown error',
        backupPaths,
      });
    } else {
      resultsByAgent.push({
        agent,
        ok: true,
        backupPaths,
      });
    }
  }

  // 8. Summary
  const checkMark = formatCheck(ctx);
  const crossMark = formatCross(ctx);

  for (const res of resultsByAgent) {
    if (res.ok) {
      io.out(`${checkMark} ${res.agent.name}`);
    } else {
      io.out(`${crossMark} ${res.agent.name}: ${res.error}`);
    }
  }

  const allBackups = resultsByAgent.flatMap((r) => r.backupPaths);
  if (allBackups.length > 0) {
    io.out(`Backups written to:\n${allBackups.map((p) => `  ${p}`).join('\n')}`);
  }

  const successfulAgents = resultsByAgent.filter((r) => r.ok).map((r) => r.agent);
  if (successfulAgents.length > 0) {
    io.out('');
    io.out('Next steps:');
    for (const agent of successfulAgents) {
      io.out(`  ${agent.signInHint(assets)}`);
    }
    io.out('  In your agent, run /specx setup to choose a workspace (Codex: $specx setup).');
    io.out(`  Other agents: ${assets.connectPageUrl}`);
  }

  // 9. Exit 0 if every chosen agent succeeded, else 1
  return resultsByAgent.every((r) => r.ok) ? 0 : 1;
}
