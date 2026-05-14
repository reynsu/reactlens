// Run identifier generator. Format: <iso-timestamp-fs-safe>-<8-hex>
// e.g. 2026-05-14T15-30-22-123Z-a3f9c7e1
//
// Properties relied on elsewhere:
//   1. Filesystem-safe — used directly as a directory name under .reactlens/runs/
//   2. Lexicographically sortable by chronological order — `ls` lists newest last
//   3. Unique even when two calls share the same Date — the random suffix breaks ties
//
// Used by `reactlens run` (passed to the streaming reporter via REACTLENS_RUN_ID)
// and by the P8 time-travel persistence layer (directory key for events.jsonl).
import { randomUUID } from 'node:crypto';

export function generateRunId(now: Date = new Date()): string {
  const iso = now.toISOString().replace(/[:.]/g, '-');
  const suffix = randomUUID().replace(/-/g, '').slice(0, 8);
  return `${iso}-${suffix}`;
}
