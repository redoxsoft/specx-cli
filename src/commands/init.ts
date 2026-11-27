import { ALL_AGENTS, resolveAgents, type Agent, type Detection } from '../agents/index.js';
import type { Assets } from '../core/assets.js';
import type { Ctx } from '../core/context.js';
import { renderPlan, type AgentPlan } from '../core/plan.js';
import { applyPlans, exitCodeFor, outcomeWithoutChanges, planProblems, printResults, type AgentResult } from './apply.js';
import { formatNoAgentsMessage, formatValidAgents, type CommandOptions, type IO } from './io.js';

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
    io.out(formatNoAgentsMessage());
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
    // Checking an agent runs its CLI, which can take a while.
    io.out(`Checking ${agent.name}…`);
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
    const results = planned.map(({ agent, plan }) => ({
      agent,
      outcome: outcomeWithoutChanges(plan),
      problems: planProblems(plan),
      backupPaths: [],
    }));
    printResults(ctx, results, io, 'init');
    printNextSteps(results, assets, io);
    return exitCodeFor(results);
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

  // 7. Apply, one agent after another; a failure doesn't stop the others.
  const results = await applyPlans(ctx, planned, io);

  // 8. Summary
  printResults(ctx, results, io, 'init');
  printNextSteps(results, assets, io);

  // 9. Exit 0 only when every chosen agent is set up.
  return exitCodeFor(results);
}

/** Sign-in steps only for agents that are fully set up; others already show what's wrong. */
function printNextSteps(results: AgentResult[], assets: Assets, io: IO): void {
  const ready = results.filter((r) => r.outcome === 'done' || r.outcome === 'unchanged').map((r) => r.agent);
  io.out('');
  io.out('Next steps:');
  for (const agent of ready) {
    io.out(`  ${agent.signInHint(assets)}`);
  }
  if (ready.length > 0) {
    io.out('  In your agent, run /specx setup to choose a workspace (Codex: $specx setup).');
  }
  io.out(`  Other agents: ${assets.connectPageUrl}`);
}
