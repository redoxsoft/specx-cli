export function parseVersion(v: string): {
  major: number;
  minor: number;
  patch: number;
  prerelease: string[];
} | null {
  const trimmed = v.trim().replace(/^v/i, '');
  const match = /^(\d+)\.(\d+)\.(\d+)(?:-([0-9A-Za-z.-]+))?(?:\+[0-9A-Za-z.-]+)?$/.exec(trimmed);
  if (!match) return null;
  const major = Number(match[1]);
  const minor = Number(match[2]);
  const patch = Number(match[3]);
  const prerelease = match[4] ? match[4].split('.') : [];
  return { major, minor, patch, prerelease };
}

export function compareVersions(a: string, b: string): number {
  const pa = parseVersion(a);
  const pb = parseVersion(b);
  if (!pa && !pb) return a.localeCompare(b);
  if (!pa) return -1;
  if (!pb) return 1;

  if (pa.major !== pb.major) return pa.major - pb.major;
  if (pa.minor !== pb.minor) return pa.minor - pb.minor;
  if (pa.patch !== pb.patch) return pa.patch - pb.patch;

  if (pa.prerelease.length === 0 && pb.prerelease.length > 0) return 1;
  if (pa.prerelease.length > 0 && pb.prerelease.length === 0) return -1;
  if (pa.prerelease.length === 0 && pb.prerelease.length === 0) return 0;

  const len = Math.max(pa.prerelease.length, pb.prerelease.length);
  for (let i = 0; i < len; i++) {
    const segA = pa.prerelease[i];
    const segB = pb.prerelease[i];
    if (segA === undefined) return -1;
    if (segB === undefined) return 1;
    if (segA === segB) continue;

    const isNumA = /^\d+$/.test(segA);
    const isNumB = /^\d+$/.test(segB);

    if (isNumA && isNumB) {
      const diff = Number(segA) - Number(segB);
      if (diff !== 0) return diff;
    } else if (isNumA && !isNumB) {
      return -1;
    } else if (!isNumA && isNumB) {
      return 1;
    } else {
      const cmp = segA.localeCompare(segB);
      if (cmp !== 0) return cmp;
    }
  }

  return 0;
}

export function isOlder(current: string, latest: string): boolean {
  return compareVersions(current, latest) < 0;
}
