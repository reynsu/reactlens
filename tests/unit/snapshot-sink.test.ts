import { mkdtempSync, readFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { persistSnapshots } from '../../src/runner/snapshot-sink';
import type { ComponentNode } from '../../src/runner/events';

function tmp(): string {
  return mkdtempSync(join(tmpdir(), 'reactlens-snapsink-'));
}

const sampleTree: ComponentNode = {
  name: 'Pagination',
  props: { total: 11, pageSize: 5 },
  children: [],
};

describe('persistSnapshots', () => {
  it('writes one JSON file per test that has a snapshot', async () => {
    const dir = tmp();
    const result = await persistSnapshots({
      outDir: dir,
      tests: [
        { id: 't1', title: 'pagination renders', file: 'specs/eval/case-005.spec.ts', snapshot: sampleTree },
      ],
    });
    expect(result.written).toHaveLength(1);
    const file = join(dir, 't1.json');
    expect(existsSync(file)).toBe(true);
    const parsed = JSON.parse(readFileSync(file, 'utf8'));
    expect(parsed.name).toBe('Pagination');
    expect(parsed.props.total).toBe(11);
  });

  it('skips tests with no snapshot', async () => {
    const dir = tmp();
    const result = await persistSnapshots({
      outDir: dir,
      tests: [
        { id: 't1', title: 'no snapshot here', file: 'specs/x.spec.ts' },
        { id: 't2', title: 'has one', file: 'specs/y.spec.ts', snapshot: sampleTree },
      ],
    });
    expect(result.written).toHaveLength(1);
    expect(result.skipped).toEqual(['t1']);
    expect(existsSync(join(dir, 't1.json'))).toBe(false);
    expect(existsSync(join(dir, 't2.json'))).toBe(true);
  });

  it('creates the outDir if it does not exist', async () => {
    const parent = tmp();
    const dir = join(parent, 'nested', 'dir');
    await persistSnapshots({
      outDir: dir,
      tests: [{ id: 't1', title: 'x', file: 'x.ts', snapshot: sampleTree }],
    });
    expect(existsSync(join(dir, 't1.json'))).toBe(true);
  });

  it('writes a manifest mapping testId to title and spec file when requested', async () => {
    const dir = tmp();
    await persistSnapshots({
      outDir: dir,
      tests: [
        { id: 't1', title: 'pagination renders', file: 'specs/eval/case-005.spec.ts', snapshot: sampleTree },
        { id: 't2', title: 'no snap', file: 'specs/x.spec.ts' },
      ],
      writeManifest: true,
    });
    const manifest = JSON.parse(readFileSync(join(dir, 'manifest.json'), 'utf8'));
    expect(manifest.t1).toEqual({ title: 'pagination renders', file: 'specs/eval/case-005.spec.ts', hasSnapshot: true });
    expect(manifest.t2).toEqual({ title: 'no snap', file: 'specs/x.spec.ts', hasSnapshot: false });
  });
});
