// Structural diff over AxNode trees (P12 part 2). Produces "semantic" a11y
// changes — nodes added/removed, attributes changed — by aligning each
// node with its counterpart in the other tree using (role, name) as the
// match key. Reorders are ignored; a screen-reader user cares that "the
// Submit button exists with these properties", not that it's the third
// child of the form.
//
// Pure function, no I/O. Companion to src/analyzer/tree-diff.ts which does
// the same job for the React component tree. Both feed src/commands/diff.ts.
import type { AxNode } from '../runner/events';

export type A11ySemanticDiff =
  | { kind: 'node-added'; path: string; role: string; name?: string }
  | { kind: 'node-removed'; path: string; role: string; name?: string }
  | {
      kind: 'attr-changed';
      path: string;
      role: string;
      name?: string;
      attr: string;
      before: unknown;
      after: unknown;
    };

// Attributes worth diffing. Children handled separately; role/name are the
// match key (changing either is reported as remove + add, not attr-changed).
const COMPARED_ATTRS = [
  'value',
  'description',
  'keyshortcuts',
  'roledescription',
  'valuetext',
  'disabled',
  'expanded',
  'focused',
  'modal',
  'multiline',
  'multiselectable',
  'readonly',
  'required',
  'selected',
  'checked',
  'pressed',
  'level',
  'valuemin',
  'valuemax',
  'autocomplete',
  'haspopup',
  'invalid',
  'orientation',
] as const satisfies ReadonlyArray<Exclude<keyof AxNode, 'role' | 'name' | 'children'>>;

export function diffA11yTree(before: AxNode, after: AxNode): A11ySemanticDiff[] {
  const out: A11ySemanticDiff[] = [];
  // Top-level role+name forms the path root. If they differ, both trees
  // become remove + add at the root — rare for real apps (the document
  // root is almost always 'WebArea' with the same name).
  if (before.role !== after.role || (before.name ?? '') !== (after.name ?? '')) {
    out.push({ kind: 'node-removed', path: pathSegment(before), role: before.role, ...(before.name !== undefined ? { name: before.name } : {}) });
    out.push({ kind: 'node-added', path: pathSegment(after), role: after.role, ...(after.name !== undefined ? { name: after.name } : {}) });
    return out;
  }
  walk(before, after, pathSegment(after), out);
  return out;
}

function walk(before: AxNode, after: AxNode, path: string, out: A11ySemanticDiff[]): void {
  diffAttrs(before, after, path, out);
  diffChildren(before.children ?? [], after.children ?? [], path, out);
}

function diffAttrs(before: AxNode, after: AxNode, path: string, out: A11ySemanticDiff[]): void {
  for (const attr of COMPARED_ATTRS) {
    const bv = before[attr];
    const av = after[attr];
    if (bv === av) continue;
    out.push({
      kind: 'attr-changed',
      path,
      role: after.role,
      ...(after.name !== undefined ? { name: after.name } : {}),
      attr,
      before: bv,
      after: av,
    });
  }
}

function diffChildren(before: AxNode[], after: AxNode[], parentPath: string, out: A11ySemanticDiff[]): void {
  // Match by (role, name). Reorders within a parent don't surface as diffs —
  // a screen reader user perceives the same set of affordances regardless
  // of DOM order in most cases.
  const consumedBefore = new Set<number>();
  for (const a of after) {
    const idx = before.findIndex(
      (b, i) => !consumedBefore.has(i) && b.role === a.role && (b.name ?? '') === (a.name ?? ''),
    );
    const childPath = `${parentPath} > ${pathSegment(a)}`;
    if (idx >= 0) {
      consumedBefore.add(idx);
      walk(before[idx]!, a, childPath, out);
    } else {
      out.push({ kind: 'node-added', path: childPath, role: a.role, ...(a.name !== undefined ? { name: a.name } : {}) });
    }
  }
  for (let i = 0; i < before.length; i += 1) {
    if (consumedBefore.has(i)) continue;
    const b = before[i]!;
    out.push({
      kind: 'node-removed',
      path: `${parentPath} > ${pathSegment(b)}`,
      role: b.role,
      ...(b.name !== undefined ? { name: b.name } : {}),
    });
  }
}

function pathSegment(n: AxNode): string {
  if (n.name !== undefined && n.name.length > 0) return `${n.role}[${n.name}]`;
  return n.role;
}
