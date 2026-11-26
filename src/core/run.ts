import spawn from 'cross-spawn';
import type { Runner, RunResult } from './context.js';

const DEFAULT_TIMEOUT_MS = 30_000;
const MAX_OUTPUT_BYTES = 1024 * 1024; // 1 MB
const KILL_GRACE_MS = 250;

export function createRunner(): Runner {
  return (command: string, args: readonly string[], opts?: { timeoutMs?: number }): Promise<RunResult> => {
    return new Promise((resolve) => {
      const timeoutMs = opts?.timeoutMs ?? DEFAULT_TIMEOUT_MS;

      let child: ReturnType<typeof spawn>;
      try {
        child = spawn(command, [...args], {
          stdio: ['ignore', 'pipe', 'pipe'],
          shell: false,
          windowsHide: true,
        });
      } catch (err) {
        // cross-spawn can throw before the process exists (bad arguments).
        resolve({
          code: null,
          stdout: '',
          stderr: '',
          timedOut: false,
          error: err instanceof Error ? err.message : String(err),
        });
        return;
      }

      let timedOut = false;
      let settled = false;
      let stdoutBytes = 0;
      let stderrBytes = 0;
      const stdoutChunks: Buffer[] = [];
      const stderrChunks: Buffer[] = [];
      let timer: ReturnType<typeof setTimeout> | null = null;
      let killTimer: ReturnType<typeof setTimeout> | null = null;

      const captured = (): { stdout: string; stderr: string } => ({
        stdout: Buffer.concat(stdoutChunks).toString('utf8'),
        stderr: Buffer.concat(stderrChunks).toString('utf8'),
      });

      const finish = (result: RunResult) => {
        if (settled) return;
        settled = true;
        if (timer) clearTimeout(timer);
        if (killTimer) clearTimeout(killTimer);
        resolve(result);
      };

      const kill = (signal: NodeJS.Signals) => {
        try {
          child.kill(signal);
        } catch {
          // The process has already exited, or this platform cannot deliver the signal.
        }
      };

      const take = (chunks: Buffer[], used: number, setUsed: (n: number) => void) => (chunk: Buffer | string) => {
        const buf = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
        if (used >= MAX_OUTPUT_BYTES) return;
        const piece = buf.subarray(0, Math.min(buf.length, MAX_OUTPUT_BYTES - used));
        chunks.push(piece);
        setUsed(used + piece.length);
      };

      if (timeoutMs > 0) {
        timer = setTimeout(() => {
          timedOut = true;
          kill('SIGTERM');
          // A child that ignores SIGTERM would otherwise leave this promise pending.
          killTimer = setTimeout(() => {
            kill('SIGKILL');
            child.stdout?.destroy();
            child.stderr?.destroy();
            child.unref();
            finish({ code: null, ...captured(), timedOut: true });
          }, KILL_GRACE_MS);
        }, timeoutMs);
      }

      child.stdout?.on('data', (chunk: Buffer | string) => {
        take(stdoutChunks, stdoutBytes, (n) => { stdoutBytes = n; })(chunk);
      });
      child.stderr?.on('data', (chunk: Buffer | string) => {
        take(stderrChunks, stderrBytes, (n) => { stderrBytes = n; })(chunk);
      });

      child.on('error', (err: Error) => {
        finish({
          code: null,
          ...captured(),
          timedOut,
          error: err.message,
        });
      });

      child.on('close', (code: number | null) => {
        finish({
          code: timedOut ? null : code,
          ...captured(),
          timedOut,
        });
      });
    });
  };
}
