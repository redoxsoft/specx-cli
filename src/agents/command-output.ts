export function parseJson(stdout: string): unknown {
  // Some CLIs prefix JSON with a BOM, which JSON.parse rejects.
  return JSON.parse(stdout.replace(/^\uFEFF/, ''));
}

export function commandError(
  label: string,
  res: { timedOut: boolean; error?: string; code: number | null },
): string | null {
  // Command output is not included: it can contain header values, and this string is shown in the plan.
  if (res.timedOut) return `${label} timed out`;
  if (res.error) return `${label} failed to start: ${res.error}`;
  if (res.code !== 0) return `${label} exited with code ${res.code ?? 'unknown'}`;
  return null;
}
