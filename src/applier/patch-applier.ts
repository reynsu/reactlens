// PatchApplier — the single safe entry point for turning a
// {file, oldStr, newStr} patch into a real filesystem change.
//
// Slice #11 phase 1 of v0.3 #7. Provides the (Q) tier of the
// diagnosis-loop closure from ADR-0007: the WS apply round-trip
// invokes this module, and the dashboard surfaces its discriminated
// result to the user.
//
// The contract is the simplest safety guard that prevents the worst
// class of bug (wrong location overwritten) without forcing the agent
// prompt to emit unified-diff context lines:
//
//   count(oldStr) === 1  → atomic write (tmp + rename); ok=true
//   count(oldStr) === 0  → no write; ok=false, reason='oldStr-not-found'
//   count(oldStr) > 1    → no write; ok=false, reason='oldStr-not-unique'
//   fs failure           → no partial write; ok=false, reason='fs-error'
//
// Atomic write strategy: write to <file>.tmp.<random> in the same
// directory, then rename onto the target. POSIX rename is atomic
// within a filesystem, so a crashed process never leaves a half-
// written original file (the tmp file may leak — best-effort
// unlinked but not fatal if it doesn't).
//
// This module does NOT touch git state. The (R) tier (git stash /
// branch / rollback) is explicitly deferred to v0.4 per ADR-0007.
import { existsSync, readFileSync, renameSync, unlinkSync, writeFileSync } from 'node:fs';
import { randomBytes } from 'node:crypto';
import { dirname, join } from 'node:path';

export type ApplyPatchInput = {
  // Absolute path to the file to mutate. Callers (the WS handler) are
  // responsible for resolving relative paths from the diagnosis to
  // absolute paths under cwd.
  file: string;
  // Exact substring to find in the file. Must occur exactly once.
  oldStr: string;
  // Replacement. May equal oldStr in theory (then the apply is a no-op
  // write) but the caller typically rejects such patches upstream.
  newStr: string;
};

export type ApplyPatchResult =
  | { ok: true; file: string }
  | {
      ok: false;
      // Three failure modes. The dashboard maps each to a different
      // message + UX path (e.g., 'not-unique' can prompt the user to
      // widen the patch context manually).
      reason: 'oldStr-not-found' | 'oldStr-not-unique' | 'fs-error';
      // Free-form context. 'oldStr-not-unique' → match-count string;
      // 'fs-error' → nodejs error message; 'oldStr-not-found' → undefined.
      detail?: string;
    };

// Counts non-overlapping occurrences of `needle` in `haystack`. Same
// algorithm as countOccurrences in slice #12's planted-failure-applier
// — duplicated here so this module has no cross-slice dependency.
function countOccurrences(haystack: string, needle: string): number {
  let count = 0;
  let from = 0;
  while (true) {
    const idx = haystack.indexOf(needle, from);
    if (idx === -1) return count;
    count++;
    from = idx + needle.length;
  }
}

export function applyPatch(input: ApplyPatchInput): ApplyPatchResult {
  // Read step. ENOENT / permission / device errors all surface as
  // fs-error so the caller has one path to handle. We never want to
  // throw from this function — the WS handler upstream relies on the
  // discriminated result to emit patch:rejected loudly.
  let before: string;
  try {
    before = readFileSync(input.file, 'utf8');
  } catch (err) {
    return { ok: false, reason: 'fs-error', detail: (err as Error).message };
  }

  // Count step. oldStr-not-found and oldStr-not-unique are pure
  // calibration checks — no IO between read and decide, so the result
  // can never disagree with what we just read.
  const matches = countOccurrences(before, input.oldStr);
  if (matches === 0) return { ok: false, reason: 'oldStr-not-found' };
  if (matches > 1) return { ok: false, reason: 'oldStr-not-unique', detail: String(matches) };

  // Replace + atomic write. String.prototype.replace with a string
  // pattern replaces only the first match — fine because we already
  // confirmed there's exactly one.
  const after = before.replace(input.oldStr, input.newStr);
  const tmp = join(dirname(input.file), `.${randomBytes(8).toString('hex')}.tmp`);
  try {
    writeFileSync(tmp, after);
  } catch (err) {
    // Write to tmp failed. The original file is untouched and the tmp
    // may or may not exist; either way, surface the error.
    return { ok: false, reason: 'fs-error', detail: (err as Error).message };
  }

  try {
    renameSync(tmp, input.file);
  } catch (err) {
    // Rename failed — best-effort unlink the orphan tmp so we don't
    // accumulate `.<hex>.tmp` files in the user's source tree across
    // failed apply attempts.
    try {
      if (existsSync(tmp)) unlinkSync(tmp);
    } catch {
      /* leak the tmp; the rename error is what the operator cares about */
    }
    return { ok: false, reason: 'fs-error', detail: (err as Error).message };
  }

  return { ok: true, file: input.file };
}
