// Smoke test for the `@reynsu/reactlens/component-object` subpath export.
//
// Loads the published surface as a user would — through Node's exports map
// resolution — and confirms the named exports come through both ESM and CJS.
// Catches packaging mistakes (missing entry, wrong dist path, wrong file
// extension) before they hit users.
//
// Pre-condition: `pnpm build` must have produced dist/component-object/.
import { existsSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const repoRoot = join(__dirname, '..', '..');
const distEntry = join(repoRoot, 'dist', 'component-object', 'snapshot-accessor.js');

function assertBuilt(): void {
  if (!existsSync(distEntry)) {
    throw new Error(
      `dist/component-object/snapshot-accessor.js missing — run \`pnpm build\` before \`pnpm test:integration\`.`,
    );
  }
}

describe('@reynsu/reactlens/component-object subpath export', () => {
  it('CJS require resolves and surfaces the named exports', () => {
    assertBuilt();
    const script = `
      const m = require('@reynsu/reactlens/component-object');
      if (typeof m.Component !== 'function') throw new Error('Component missing');
      if (typeof m.bindTestId !== 'function') throw new Error('bindTestId missing');
      if (typeof m.connectAccessor !== 'function') throw new Error('connectAccessor missing');
      if (typeof m.ComponentNotMountedError !== 'function') throw new Error('ComponentNotMountedError missing');
      if (typeof m.SnapshotStreamDisconnectedError !== 'function') throw new Error('SnapshotStreamDisconnectedError missing');
      const e = new m.ComponentNotMountedError('Foo', 'test-A');
      if (e.kind !== 'ComponentNotMountedError') throw new Error('kind discriminator wrong');
      console.log('ok');
    `;
    const out = execFileSync('node', ['-e', script], {
      cwd: repoRoot,
      encoding: 'utf8',
    });
    expect(out.trim()).toBe('ok');
  });

  it('ESM import resolves and surfaces the same named exports', () => {
    assertBuilt();
    const script = `
      import('@reynsu/reactlens/component-object').then((m) => {
        if (typeof m.Component !== 'function') throw new Error('Component missing');
        if (typeof m.bindTestId !== 'function') throw new Error('bindTestId missing');
        if (typeof m.ComponentNotMountedError !== 'function') throw new Error('ComponentNotMountedError missing');
        console.log('ok');
      }).catch((err) => { console.error(err.message); process.exit(1); });
    `;
    const out = execFileSync('node', ['-e', script], {
      cwd: repoRoot,
      encoding: 'utf8',
    });
    expect(out.trim()).toBe('ok');
  });
});
