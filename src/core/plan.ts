import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import type { Assets } from './assets.js';
import type { Ctx } from './context.js';
import { applyFileChange, type FileChange } from './jsonc-file.js';
import { isOwnedSkillDir } from './ownership.js';
import { redact } from './redact.js';

export type Step =
  | { kind: 'run'; command: string; args: string[]; describe: string }
  | { kind: 'file'; change: FileChange }
  | { kind: 'copy-skill'; skill: Assets['skills'][number]; destDir: string; describe: string }
  | { kind: 'remove-dir'; dir: string; describe: string }
  | { kind: 'skip'; describe: string };

export interface AgentPlan {
  agentId: string;
  agentName: string;
  steps: Step[];
  notes: string[];
}

export interface StepResult {
  step: Step;
  ok: boolean;
  error?: string;
  backupPath?: string | null;
}

function stderrTail(stderr: string): string {
  const trimmed = stderr.trim();
  if (!trimmed) return '';
  return trimmed.split(/\r?\n/).slice(-20).join('\n');
}

function withStderr(summary: string, stderr: string): string {
  const tail = stderrTail(stderr);
  return tail ? `${summary}\n${tail}` : summary;
}

export function renderPlan(plans: AgentPlan[]): string {
  const lines: string[] = [];

  for (const plan of plans) {
    lines.push(`${plan.agentName}:`);
    for (const step of plan.steps) {
      switch (step.kind) {
        case 'run': {
          const argsStr = step.args.length > 0 ? ` ${step.args.join(' ')}` : '';
          lines.push(`  - run: ${step.command}${argsStr}`);
          break;
        }
        case 'file': {
          // Only the property being written. before.text / afterText hold the rest of the file.
          let diffStr = '';
          if (step.change.value !== undefined) {
            diffStr = `: + ${JSON.stringify(redact(step.change.value))}`;
          } else if (step.change.jsonPath && step.change.jsonPath.length > 0) {
            diffStr = `: - ${step.change.jsonPath.join('.')}`;
          }
          lines.push(`  - ${step.change.summary}${diffStr}`);
          break;
        }
        case 'copy-skill': {
          lines.push(`  - copy skill ${step.skill.name} to ${step.destDir}`);
          break;
        }
        case 'remove-dir': {
          lines.push(`  - remove directory ${step.dir}`);
          break;
        }
        case 'skip': {
          lines.push(`  - skip: ${step.describe}`);
          break;
        }
      }
    }
  }

  return lines.join('\n');
}

function errorMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

function resolveInside(destDir: string, relativePath: string): string {
  const root = path.resolve(destDir);
  const target = path.resolve(root, relativePath);
  const rel = path.relative(root, target);
  if (rel === '' || rel.startsWith('..') || path.isAbsolute(rel)) {
    throw new Error(`Skill file path escapes the destination: ${relativePath}`);
  }
  return target;
}

function writeSkillTree(destDir: string, files: { relativePath: string; text: string }[]): void {
  for (const file of files) {
    const target = resolveInside(destDir, file.relativePath);
    fs.mkdirSync(path.dirname(target), { recursive: true, mode: 0o755 });
    fs.writeFileSync(target, file.text, 'utf8');
  }
}

function swapIn(tempDir: string, destDir: string): void {
  if (!fs.existsSync(destDir)) {
    fs.renameSync(tempDir, destDir);
    return;
  }
  const oldDir = `${destDir}.old-${crypto.randomBytes(4).toString('hex')}`;
  fs.renameSync(destDir, oldDir);
  try {
    fs.renameSync(tempDir, destDir);
  } catch (err) {
    try {
      fs.renameSync(oldDir, destDir);
    } catch {
      // The previous folder is still at oldDir; the new folder was not put in place.
    }
    throw err;
  }
  fs.rmSync(oldDir, { recursive: true, force: true });
}

function notOwnedError(skillName: string): string {
  return `a skill named ${skillName} already exists and wasn't installed by SpecX`;
}

export async function executePlan(
  ctx: Ctx,
  plan: AgentPlan,
  exe: (name: string) => string | null,
): Promise<StepResult[]> {
  const results: StepResult[] = [];

  for (const step of plan.steps) {
    if (step.kind === 'run') {
      const resolved = exe(step.command);
      if (!resolved) {
        results.push({
          step,
          ok: false,
          error: `Executable not found: ${step.command}`,
        });
        break;
      }
      const res = await ctx.run(resolved, step.args);
      if (res.timedOut) {
        results.push({
          step,
          ok: false,
          error: withStderr(`Command timed out: ${step.command}`, res.stderr),
        });
        break;
      }
      if (res.error) {
        results.push({
          step,
          ok: false,
          error: withStderr(`Command failed to start: ${res.error}`, res.stderr),
        });
        break;
      }
      if (res.code !== 0) {
        results.push({
          step,
          ok: false,
          error: withStderr(`Command exited with code ${res.code}`, res.stderr),
        });
        break;
      }
      results.push({ step, ok: true });
    } else if (step.kind === 'file') {
      const fileRes = applyFileChange(ctx, step.change);
      if (!fileRes.ok) {
        results.push({ step, ok: false, error: fileRes.error });
        break;
      }
      results.push({ step, ok: true, backupPath: fileRes.backupPath });
    } else if (step.kind === 'copy-skill') {
      const tempDir = path.join(
        path.dirname(step.destDir),
        `.${path.basename(step.destDir)}.${crypto.randomBytes(4).toString('hex')}.tmp`,
      );
      try {
        if (fs.existsSync(step.destDir) && !isOwnedSkillDir(step.destDir)) {
          throw new Error(notOwnedError(step.skill.name));
        }
        fs.mkdirSync(tempDir, { recursive: true, mode: 0o755 });
        writeSkillTree(tempDir, step.skill.files);
        // Recheck immediately before replacing so an unowned folder is left untouched.
        if (fs.existsSync(step.destDir) && !isOwnedSkillDir(step.destDir)) {
          throw new Error(notOwnedError(step.skill.name));
        }
        swapIn(tempDir, step.destDir);
        results.push({ step, ok: true });
      } catch (err) {
        try {
          if (fs.existsSync(tempDir)) fs.rmSync(tempDir, { recursive: true, force: true });
        } catch {
          // The temp copy could not be removed; the destination was not replaced.
        }
        results.push({ step, ok: false, error: errorMessage(err) });
        break;
      }
    } else if (step.kind === 'remove-dir') {
      try {
        if (!fs.existsSync(step.dir)) {
          results.push({ step, ok: true });
        } else if (!isOwnedSkillDir(step.dir)) {
          results.push({
            step,
            ok: false,
            error: `Directory ${step.dir} exists and wasn't installed by SpecX`,
          });
          break;
        } else {
          fs.rmSync(step.dir, { recursive: true, force: true });
          results.push({ step, ok: true });
        }
      } catch (err) {
        results.push({ step, ok: false, error: errorMessage(err) });
        break;
      }
    } else if (step.kind === 'skip') {
      results.push({ step, ok: true });
    }
  }

  return results;
}
