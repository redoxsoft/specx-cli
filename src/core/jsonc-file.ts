import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import {
  applyEdits,
  findNodeAtLocation,
  modify,
  parse,
  parseTree,
  printParseErrorCode,
  type Edit,
  type ParseError,
} from 'jsonc-parser';
import { backupFile } from './backup.js';
import type { Ctx } from './context.js';

export interface FileSnapshot {
  path: string;
  realPath: string;
  exists: boolean;
  text: string;
  mode: number | null;
  hash: string;
}

export type ParsedFile =
  | { ok: true; snapshot: FileSnapshot; value: unknown }
  | { ok: false; snapshot: FileSnapshot; error: string };

export interface FileChange {
  path: string;
  realPath: string;
  before: FileSnapshot;
  afterText: string;
  summary: string;
  /** The value passed to planSetProperty, so renderPlan can show only that property. */
  value?: unknown;
  jsonPath?: readonly (string | number)[];
}

const CHANGED_SINCE_PLAN = 'changed since the plan was made; run the command again';

interface Formatting {
  insertSpaces: boolean;
  tabSize: number;
  eol: '\n' | '\r\n';
  unit: string;
}

function sha256(text: string): string {
  return crypto.createHash('sha256').update(text).digest('hex');
}

function errorMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

function gcd(a: number, b: number): number {
  let x = a;
  let y = b;
  while (y !== 0) {
    const next = x % y;
    x = y;
    y = next;
  }
  return x;
}

function detectFormatting(text: string): Formatting {
  const eol: '\n' | '\r\n' = text.includes('\r\n') ? '\r\n' : '\n';
  let tabCount = 0;
  const spaceIndents: number[] = [];

  for (const line of text.split(/\r?\n/)) {
    const match = /^([ \t]+)\S/.exec(line);
    const indent = match?.[1];
    if (!indent) continue;
    if (indent[0] === '\t') tabCount++;
    else spaceIndents.push(indent.length);
  }

  if (tabCount > spaceIndents.length) {
    return { insertSpaces: false, tabSize: 2, eol, unit: '\t' };
  }

  let width = 2;
  if (spaceIndents.length > 0) {
    let g = 0;
    for (const n of spaceIndents) {
      if (n > 0) g = g === 0 ? n : gcd(g, n);
    }
    if (g >= 1 && g <= 8) width = g;
  }

  return { insertSpaces: true, tabSize: width, eol, unit: ' '.repeat(width) };
}

function adjustTrailingNewline(text: string, originalText: string, exists: boolean, eol: string): string {
  if (!exists) {
    return text.endsWith('\n') ? text : `${text}${eol}`;
  }
  const hadNewline = originalText.endsWith('\n');
  const hasNewline = text.endsWith('\n');
  if (hadNewline && !hasNewline) return `${text}${eol}`;
  if (!hadNewline && hasNewline) return text.replace(/\r?\n$/, '');
  return text;
}

function emptySnapshot(filePath: string, realPath: string): FileSnapshot {
  return {
    path: filePath,
    realPath,
    exists: false,
    text: '',
    mode: null,
    hash: sha256(''),
  };
}

function lineStart(text: string, offset: number): number {
  let i = offset;
  while (i > 0 && text[i - 1] !== '\n') i--;
  return i;
}

function lineIndent(text: string, offset: number): string {
  const start = lineStart(text, offset);
  const match = /^[ \t]*/.exec(text.slice(start, offset));
  return match?.[0] ?? '';
}

/** Indent of a property inserted at `offset`: its sibling's indent, or one level inside `{`. */
function propertyIndent(text: string, offset: number, unit: string): string {
  const start = lineStart(text, offset);
  const prefix = text.slice(start, offset).replace(/\r$/, '');
  const indent = /^[ \t]*/.exec(prefix)?.[0] ?? '';
  if (/[^\s{]/.test(prefix)) return indent;
  return indent + unit;
}

function prettyJson(value: unknown, unit: string, continuationIndent: string, eol: string): string {
  const raw = JSON.stringify(value, null, unit) ?? 'null';
  const indented = raw.includes('\n')
    ? raw.split('\n').map((line, i) => (i === 0 ? line : `${continuationIndent}${line}`)).join('\n')
    : raw;
  return eol === '\n' ? indented : indented.replace(/\n/g, eol);
}

function isSpace(ch: string | undefined): boolean {
  return ch === ' ' || ch === '\t';
}

function consumeNewline(text: string, index: number): number {
  if (text[index] === '\r' && text[index + 1] === '\n') return index + 2;
  if (text[index] === '\n' || text[index] === '\r') return index + 1;
  return index;
}

/**
 * Remove one property or array element, plus its comma, without rewriting neighbours or comments.
 * jsonc-parser's own removal range includes the whitespace and comments around the property.
 */
function preciseRemoval(text: string, jsonPath: (string | number)[]): Edit | null {
  const root = parseTree(text, [], { allowTrailingComma: true });
  if (!root) return null;
  const node = findNodeAtLocation(root, jsonPath);
  if (!node) return null;
  const target = node.parent?.type === 'property' ? node.parent : node;

  let start = target.offset;
  let end = target.offset + target.length;
  while (start > 0 && isSpace(text[start - 1])) start--;

  let i = end;
  while (i < text.length && isSpace(text[i])) i++;
  if (text[i] === ',') {
    end = i + 1;
    while (end < text.length && isSpace(text[end])) end++;
    end = consumeNewline(text, end);
    return { offset: start, length: end - start, content: '' };
  }

  let j = start - 1;
  while (j >= 0 && (isSpace(text[j]) || text[j] === '\n' || text[j] === '\r')) j--;
  if (j >= 0 && text[j] === ',') {
    return { offset: j, length: end - j, content: '' };
  }

  end = consumeNewline(text, end);
  return { offset: start, length: end - start, content: '' };
}

function whitespaceUntilBrace(text: string, offset: number): number {
  let i = offset;
  while (i < text.length) {
    const ch = text[i];
    if (ch !== ' ' && ch !== '\t' && ch !== '\n' && ch !== '\r') break;
    i++;
  }
  return text[i] === '}' ? i - offset : 0;
}

interface PropertyEdit {
  lead: boolean;
  key: string;
  value: string;
  trail: boolean;
}

function splitPropertyEdit(content: string): PropertyEdit | null {
  let rest = content;
  let lead = false;
  let trail = false;
  if (rest.startsWith(',')) {
    lead = true;
    rest = rest.slice(1);
  }
  if (rest.endsWith(',')) {
    trail = true;
    rest = rest.slice(0, -1);
  }
  const match = /^("(?:\\.|[^"\\])*"): ([\s\S]+)$/.exec(rest);
  const key = match?.[1];
  const value = match?.[2];
  if (!key || !value) return null;
  return { lead, key, value, trail };
}

/**
 * Rewrite only the text jsonc-parser is inserting. Passing formattingOptions makes
 * the library reformat the whole line, which rewrites neighbouring entries.
 */
function tryRewrite(text: string, edit: Edit, fmt: Formatting): Edit | null {
  if (edit.content === '') return edit;

  const property = splitPropertyEdit(edit.content);
  if (property) {
    let parsed: unknown;
    try {
      parsed = JSON.parse(property.value) as unknown;
    } catch {
      return null;
    }
    const indent = propertyIndent(text, edit.offset, fmt.unit);
    const pretty = prettyJson(parsed, fmt.unit, indent, fmt.eol);
    const body = `${property.key}: ${pretty}`;
    if (property.lead) {
      // The previous property already ends with a comma when the file has a trailing comma.
      let i = edit.offset;
      while (i > 0 && ' \t\r\n'.includes(text[i - 1] ?? '')) i--;
      const alreadyComma = i > 0 && text[i - 1] === ',';
      const comma = alreadyComma ? '' : ',';
      return {
        offset: edit.offset,
        length: edit.length,
        content: `${comma}${fmt.eol}${indent}${body}${property.trail ? ',' : ''}`,
      };
    }
    const skip = whitespaceUntilBrace(text, edit.offset);
    return {
      offset: edit.offset,
      length: edit.length + skip,
      content: `${fmt.eol}${indent}${body}${property.trail ? ',' : ''}${fmt.eol}`,
    };
  }

  try {
    const parsed = JSON.parse(edit.content) as unknown;
    return {
      offset: edit.offset,
      length: edit.length,
      content: prettyJson(parsed, fmt.unit, lineIndent(text, edit.offset), fmt.eol),
    };
  } catch {
    return null;
  }
}

function applyJsoncEdit(
  text: string,
  jsonPath: (string | number)[],
  value: unknown,
  exists: boolean,
): string {
  const fmt = detectFormatting(text);
  const formattingOptions = { insertSpaces: fmt.insertSpaces, tabSize: fmt.tabSize, eol: fmt.eol };

  let surgical: Edit[];
  try {
    surgical = modify(text, jsonPath, value, {});
  } catch (err) {
    if (value === undefined && err instanceof Error && err.message.includes('Can not delete')) {
      // jsonc-parser throws when asked to delete a path that is not there.
      return text;
    }
    throw err;
  }

  if (value === undefined) {
    if (surgical.length === 0) return text;
    const precise = preciseRemoval(text, jsonPath);
    const after = applyEdits(text, precise ? [precise] : surgical);
    return adjustTrailingNewline(after, text, exists, fmt.eol);
  }

  const rewritten = surgical.length === 1 ? tryRewrite(text, surgical[0]!, fmt) : null;
  const edits = rewritten
    ? [rewritten]
    : modify(text, jsonPath, value, { formattingOptions });
  return adjustTrailingNewline(applyEdits(text, edits), text, exists, fmt.eol);
}

export function readJsoncFile(filePath: string): ParsedFile {
  let realPath = filePath;
  let exists = false;
  try {
    exists = fs.existsSync(filePath);
    if (!exists) {
      // existsSync follows links and reports false for a dangling symlink. Treating
      // that path as a new file would replace the link itself during atomic rename.
      try {
        const linkStat = fs.lstatSync(filePath);
        if (linkStat.isSymbolicLink()) {
          const snapshot = { ...emptySnapshot(filePath, filePath), exists: true, mode: linkStat.mode };
          return { ok: false, snapshot, error: 'Broken symbolic link; refusing to replace it' };
        }
      } catch (err) {
        if ((err as NodeJS.ErrnoException).code !== 'ENOENT') throw err;
      }
    }
    if (exists) {
      realPath = fs.realpathSync(filePath);
    } else {
      const parent = path.dirname(filePath);
      const resolvedParent = fs.existsSync(parent) ? fs.realpathSync(parent) : path.resolve(parent);
      realPath = path.join(resolvedParent, path.basename(filePath));
    }

    if (!exists) {
      return { ok: true, snapshot: emptySnapshot(filePath, realPath), value: {} };
    }

    const stat = fs.statSync(realPath);
    if (!stat.isFile()) {
      return {
        ok: false,
        snapshot: { ...emptySnapshot(filePath, realPath), exists: true, mode: stat.mode },
        error: 'Not a file',
      };
    }

    const text = fs.readFileSync(realPath, 'utf8');
    const snapshot: FileSnapshot = {
      path: filePath,
      realPath,
      exists: true,
      text,
      mode: stat.mode,
      hash: sha256(text),
    };

    const errors: ParseError[] = [];
    const value: unknown = parse(text, errors, { allowTrailingComma: true });
    if (errors.length > 0) {
      const msg = errors.map((e) => printParseErrorCode(e.error)).join(', ');
      return { ok: false, snapshot, error: `Failed to parse JSONC: ${msg}` };
    }

    return { ok: true, snapshot, value };
  } catch (err) {
    // A file we cannot read must not be edited. Keep `exists` so callers do not treat it as new.
    return {
      ok: false,
      snapshot: { ...emptySnapshot(filePath, realPath), exists },
      error: errorMessage(err),
    };
  }
}

export function planSetProperty(
  file: ParsedFile,
  jsonPath: (string | number)[],
  value: unknown,
  summary: string,
): FileChange {
  if (!file.ok) {
    throw new Error(`Cannot modify unparsed JSONC file: ${file.error}`);
  }

  const afterText = applyJsoncEdit(file.snapshot.text, jsonPath, value, file.snapshot.exists);
  return {
    path: file.snapshot.path,
    realPath: file.snapshot.realPath,
    before: file.snapshot,
    afterText,
    summary,
    value,
    jsonPath,
  };
}

function hasProperty(val: unknown, jsonPath: readonly (string | number)[]): boolean {
  let curr: unknown = val;
  for (const seg of jsonPath) {
    if (curr === null || typeof curr !== 'object') return false;
    if (!Object.hasOwn(curr, seg)) return false;
    curr = (curr as Record<string | number, unknown>)[seg];
  }
  return true;
}

export function planRemoveProperty(
  file: ParsedFile,
  jsonPath: (string | number)[],
  summary: string,
): FileChange | null {
  if (!file.ok) {
    throw new Error(`Cannot modify unparsed JSONC file: ${file.error}`);
  }
  if (!hasProperty(file.value, jsonPath)) return null;

  const afterText = applyJsoncEdit(file.snapshot.text, jsonPath, undefined, file.snapshot.exists);
  if (afterText === file.snapshot.text) return null;

  return {
    path: file.snapshot.path,
    realPath: file.snapshot.realPath,
    before: file.snapshot,
    afterText,
    summary,
    jsonPath,
  };
}

export function applyFileChange(
  ctx: Ctx,
  change: FileChange,
): { ok: true; backupPath: string | null } | { ok: false; error: string } {
  // 1. Re-read realPath. If it changed since the plan, do not write.
  let existsNow = false;
  try {
    existsNow = fs.existsSync(change.realPath);
  } catch (err) {
    return { ok: false, error: errorMessage(err) };
  }
  if (existsNow !== change.before.exists) {
    return { ok: false, error: CHANGED_SINCE_PLAN };
  }

  let currentHash = sha256('');
  if (existsNow) {
    try {
      currentHash = sha256(fs.readFileSync(change.realPath, 'utf8'));
    } catch (err) {
      return { ok: false, error: errorMessage(err) };
    }
  }
  if (currentHash !== change.before.hash) {
    return { ok: false, error: CHANGED_SINCE_PLAN };
  }

  // 2. Backup an existing file before replacing it.
  let backupPath: string | null = null;
  if (existsNow) {
    try {
      backupPath = backupFile(ctx, change.realPath, change.before.text);
    } catch (err) {
      return { ok: false, error: `Failed to create backup: ${errorMessage(err)}` };
    }
  }

  // 3. Create the parent directory if missing (mode 0o700).
  const parentDir = path.dirname(change.realPath);
  if (!fs.existsSync(parentDir)) {
    try {
      fs.mkdirSync(parentDir, { recursive: true, mode: 0o700 });
    } catch (err) {
      return { ok: false, error: `Failed to create directory: ${errorMessage(err)}` };
    }
  }

  // 4. Temp file in the same directory, created 0o600, chmod to the original mode, then rename over realPath.
  const tempPath = path.join(
    parentDir,
    `.${path.basename(change.realPath)}.${Date.now()}.${crypto.randomBytes(4).toString('hex')}.tmp`,
  );
  const targetMode = existsNow && change.before.mode !== null ? (change.before.mode & 0o777) : 0o600;

  let created = false;
  let fd: number | null = null;
  try {
    fd = fs.openSync(tempPath, 'wx', 0o600);
    created = true;
    fs.writeFileSync(fd, change.afterText);
    fs.closeSync(fd);
    fd = null;
    // open() applies the process umask, so force 0o600 before the original mode.
    fs.chmodSync(tempPath, 0o600);
    fs.chmodSync(tempPath, targetMode);
    fs.renameSync(tempPath, change.realPath);
    return { ok: true, backupPath };
  } catch (err) {
    if (fd !== null) {
      try {
        fs.closeSync(fd);
      } catch {
        // Closing the temp file failed; it is removed next when we created it.
      }
    }
    if (created) {
      try {
        fs.unlinkSync(tempPath);
      } catch {
        // The temp file could not be removed; the destination was not replaced.
      }
    }
    return { ok: false, error: errorMessage(err) };
  }
}
