import type { Agent } from '../agents/index.js';
import type { Ctx } from '../core/context.js';
import { executePlan, stepLabel, type AgentPlan } from '../core/plan.js';
import { findExecutable } from '../core/which.js';
import { formatCheck, formatCross, type IO } from './io.js';

/**
 * What happened for one agent:
 * - done: every change applied;
 * - partial: changes applied, but something was left alone (a problem skip);
 * - unchanged: nothing to do, nothing wrong;
 * - not-done: nothing applied because of a problem;
 * - failed: a change failed.
 */
export type Outcome = 'done' | 'partial' | 'unchanged' | 'not-done' | 'failed';

export interface AgentResult {
  agent: Agent;
  outcome: Outcome;
  error?: string;
  problems: string[];
  backupPaths: string[];
}

export function planProblems(plan: AgentPlan): string[] {
  return plan.steps.flatMap((step) => (step.kind === 'skip' && step.problem ? [step.describe] : []));
}

/** Outcome of a plan that wasn't applied: no steps to run. */
export function outcomeWithoutChanges(plan: AgentPlan): Outcome {
  return planProblems(plan).length > 0 ? 'not-done' : 'unchanged';
}

/** Applies each agent's plan in turn, printing a line before each step so long installs show progress. */
export async function applyPlans(
  ctx: Ctx,
  planned: { agent: Agent; plan: AgentPlan }[],
  io: IO,
): Promise<AgentResult[]> {
  const results: AgentResult[] = [];
  for (const { agent, plan } of planned) {
    const problems = planProblems(plan);
    const changes = plan.steps.filter((step) => step.kind !== 'skip').length;
    if (changes === 0) {
      results.push({ agent, outcome: outcomeWithoutChanges(plan), problems, backupPaths: [] });
      continue;
    }
    const stepResults = await executePlan(ctx, plan, (name) => findExecutable(ctx, name), (step) => {
      io.out(`${agent.name}: ${stepLabel(step)}…`);
    });
    const backupPaths = stepResults
      .map((r) => r.backupPath)
      .filter((b): b is string => typeof b === 'string' && b.length > 0);
    const failed = stepResults.find((r) => !r.ok);
    if (failed) {
      results.push({ agent, outcome: 'failed', error: failed.error ?? 'Unknown error', problems, backupPaths });
    } else {
      results.push({ agent, outcome: problems.length > 0 ? 'partial' : 'done', problems, backupPaths });
    }
  }
  return results;
}

const HEADLINE: Record<'init' | 'remove', Record<Outcome, string>> = {
  init: {
    done: 'set up',
    partial: 'partly set up',
    unchanged: 'already set up',
    'not-done': 'not set up',
    failed: 'failed',
  },
  remove: {
    done: 'removed',
    partial: 'partly removed',
    unchanged: 'nothing to remove',
    'not-done': 'not removed',
    failed: 'failed',
  },
};

/** One line per agent, with problems indented under it, then backup locations. */
export function printResults(ctx: Ctx, results: AgentResult[], io: IO, command: 'init' | 'remove'): void {
  const check = formatCheck(ctx);
  const cross = formatCross(ctx);
  io.out('');
  for (const res of results) {
    const mark = res.outcome === 'done' || res.outcome === 'unchanged' ? check : res.outcome === 'failed' ? cross : '!';
    const headline = HEADLINE[command][res.outcome];
    io.out(res.outcome === 'failed' ? `${mark} ${res.agent.name}: ${res.error}` : `${mark} ${res.agent.name}: ${headline}`);
    for (const problem of res.problems) io.out(`    ${problem}`);
  }
  const backups = results.flatMap((r) => r.backupPaths);
  if (backups.length > 0) {
    io.out(`Backups written to:\n${backups.map((p) => `  ${p}`).join('\n')}`);
  }
}

/** Exit code: 0 only when every agent ended done or unchanged. */
export function exitCodeFor(results: AgentResult[]): number {
  return results.every((r) => r.outcome === 'done' || r.outcome === 'unchanged') ? 0 : 1;
}
