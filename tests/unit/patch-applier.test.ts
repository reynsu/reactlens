// TDD for PatchApplier (slice #11 phase 1 of v0.3 #7).
//
// The single safe entry point for turning a {file, oldStr, newStr}
// patch into a real filesystem change. Decisive failure modes
// (oldStr-not-found, oldStr-not-unique, fs-error) return a typed
// rejection instead of throwing — the dashboard server's WS handler
// translates each into a patch:rejected event the UI can render.
//
// On success: atomic write via tmp + rename, so a crashed process
// can't leave a half-written file. The four-outcome contract is the
// surface the dashboard depends on; this test locks every branch.
import { describe, expect, it } from 'vitest';
import { chmodSync, mkdtempSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { applyPatch } from '../../src/applier/patch-applier';

function fakeFile(content: string): string {
  const dir = mkdtempSync(join(tmpdir(), 'reactlens-applier-test-'));
  const file = join(dir, 'src', 'Counter.tsx');
  mkdirSync(dirname(file), { recursive: true });
  writeFileSync(file, content);
  return file;
}

describe('applyPatch — count(oldStr) === 1 (success)', () => {
  it('writes the replacement to the file and returns ok=true with the file path', () => {
    const file = fakeFile('export function add(c: number) { return c + 1; }\n');
    const result = applyPatch({
      file,
      oldStr: 'c + 1',
      newStr: 'c - 1',
    });
    expect(result).toEqual({ ok: true, file });
    expect(readFileSync(file, 'utf8')).toBe('export function add(c: number) { return c - 1; }\n');
  });

  it('handles multi-line oldStr → multi-line newStr', () => {
    const before = 'if (x > 0) {\n  doSomething();\n  return true;\n}\n';
    const file = fakeFile(before);
    const result = applyPatch({
      file,
      oldStr: 'if (x > 0) {\n  doSomething();\n  return true;\n}',
      newStr: 'if (x > 0 && y > 0) {\n  doSomething();\n  return true;\n}',
    });
    expect(result.ok).toBe(true);
    const after = readFileSync(file, 'utf8');
    expect(after).toContain('if (x > 0 && y > 0)');
    expect(after).not.toContain('if (x > 0) {');
  });

  it('leaves bytes outside oldStr untouched', () => {
    // Use a substring that occurs exactly once. 'foo' here used to be
    // ambiguous because 'footer' also starts with 'foo' — same trap
    // the applier protects production callers from.
    const file = fakeFile('header\nMIDDLE\ntrailer\n');
    applyPatch({ file, oldStr: 'MIDDLE', newStr: 'CENTER' });
    expect(readFileSync(file, 'utf8')).toBe('header\nCENTER\ntrailer\n');
  });
});

describe('applyPatch — count(oldStr) === 0', () => {
  it('returns ok=false reason=oldStr-not-found', () => {
    const file = fakeFile('the file does not contain the pattern\n');
    const result = applyPatch({
      file,
      oldStr: 'absent string',
      newStr: 'never used',
    });
    expect(result).toEqual({ ok: false, reason: 'oldStr-not-found' });
  });

  it('leaves the file unchanged', () => {
    const original = 'unchanged content\n';
    const file = fakeFile(original);
    applyPatch({ file, oldStr: 'not there', newStr: 'whatever' });
    expect(readFileSync(file, 'utf8')).toBe(original);
  });
});

describe('applyPatch — count(oldStr) > 1', () => {
  it('returns ok=false reason=oldStr-not-unique with detail = match count', () => {
    const file = fakeFile('foo\nfoo\nfoo\n');
    const result = applyPatch({ file, oldStr: 'foo', newStr: 'bar' });
    // Detail surfaces the count so the operator knows whether the recipe
    // needs widening by a little (2 matches) or a lot (10+). Per
    // Principle 2, silent first-match replacement would mutate the
    // wrong location and the operator would never notice.
    expect(result).toEqual({ ok: false, reason: 'oldStr-not-unique', detail: '3' });
  });

  it('leaves the file unchanged on ambiguous oldStr', () => {
    const original = 'foo\nfoo\n';
    const file = fakeFile(original);
    applyPatch({ file, oldStr: 'foo', newStr: 'bar' });
    expect(readFileSync(file, 'utf8')).toBe(original);
  });
});

describe('applyPatch — fs failures', () => {
  it('returns ok=false reason=fs-error when the file does not exist', () => {
    const result = applyPatch({
      file: '/tmp/reactlens-this-truly-does-not-exist-zzz/foo.txt',
      oldStr: 'a',
      newStr: 'b',
    });
    expect(result.ok).toBe(false);
    if (result.ok) throw new Error('typing guard');
    expect(result.reason).toBe('fs-error');
    expect(typeof result.detail).toBe('string');
  });

  it('does not partially write when the rename step would fail (file unchanged)', () => {
    // Engineered with a read-only directory: the tmp file write itself
    // may fail, but the original file must remain intact. The contract
    // is "all-or-nothing"; a half-written file from a crashed rename
    // would be silent corruption.
    const dir = mkdtempSync(join(tmpdir(), 'reactlens-applier-readonly-'));
    const file = join(dir, 'sealed.txt');
    writeFileSync(file, 'original\n');
    // Make the parent directory read-only so the sibling tmp file
    // write fails (atomic-write strategy creates tmp in dirname(file)).
    // POSIX-specific; this test is portable enough for our CI matrix.
    chmodSync(dir, 0o555);
    try {
      const result = applyPatch({ file, oldStr: 'original', newStr: 'modified' });
      expect(result.ok).toBe(false);
      // Original file content must be intact regardless of where the
      // write failed — atomic-rename strategy: no partial state.
      expect(readFileSync(file, 'utf8')).toBe('original\n');
    } finally {
      // Restore so the tmpdir can be cleaned up.
      chmodSync(dir, 0o755);
    }
  });
});
