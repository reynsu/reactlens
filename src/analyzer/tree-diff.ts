// Structural diff over ComponentNode trees (P12). Produces a list of
// "semantic" changes — components added/removed, props changed — rather
// than the pixel-level differences pixel diffing would surface. Drives the
// `reactlens diff` CLI for cross-run regression detection.
//
// Pure function. Aligns siblings by (name + React key) when keys are
// present; falls back to (name + ordinal-among-same-name) otherwise. A
// component "rename" at the same position is reported as remove + add —
// we don't synthesize a rename event because that would require heuristics
// (subtree similarity scoring) and the explicit pair is more honest.
import type { ComponentNode } from '../runner/events';

export type SemanticDiff =
  | { kind: 'component-added'; path: string; component: string }
  | { kind: 'component-removed'; path: string; component: string }
  | {
      kind: 'prop-changed';
      path: string;
      component: string;
      prop: string;
      before: unknown;
      after: unknown;
    };

export function diffComponentTree(before: ComponentNode, after: ComponentNode): SemanticDiff[] {
  const out: SemanticDiff[] = [];
  walk(before, after, before.name, out);
  return out;
}

function walk(before: ComponentNode, after: ComponentNode, path: string, out: SemanticDiff[]): void {
  diffProps(before, after, path, out);
  diffChildren(before.children, after.children, path, out);
}

function diffProps(before: ComponentNode, after: ComponentNode, path: string, out: SemanticDiff[]): void {
  const keys = new Set([...Object.keys(before.props), ...Object.keys(after.props)]);
  for (const k of keys) {
    const bv = before.props[k];
    const av = after.props[k];
    if (!deepEqual(bv, av)) {
      out.push({ kind: 'prop-changed', path, component: after.name, prop: k, before: bv, after: av });
    }
  }
}

function diffChildren(before: ComponentNode[], after: ComponentNode[], parentPath: string, out: SemanticDiff[]): void {
  // Group by name so we align same-name buckets across the two trees.
  const groupB = groupByName(before);
  const groupA = groupByName(after);
  const names = new Set([...groupB.keys(), ...groupA.keys()]);

  for (const name of names) {
    const bs = groupB.get(name) ?? [];
    const as = groupA.get(name) ?? [];
    const pairs = alignSameName(bs, as);
    const totalAfter = as.length;
    for (const pair of pairs) {
      const segment = childPathSegment(name, pair, totalAfter);
      const childPath = `${parentPath} > ${segment}`;
      if (pair.before === null && pair.after !== null) {
        out.push({ kind: 'component-added', path: childPath, component: name });
      } else if (pair.before !== null && pair.after === null) {
        out.push({ kind: 'component-removed', path: childPath, component: name });
      } else if (pair.before !== null && pair.after !== null) {
        walk(pair.before, pair.after, childPath, out);
      }
    }
  }
}

type Pair = {
  before: ComponentNode | null;
  after: ComponentNode | null;
  key?: string;
  // Index among same-name siblings in `after` (or `before` for removed) —
  // used to disambiguate path segments when keys are missing.
  afterIndex?: number;
  beforeIndex?: number;
};

function alignSameName(before: ComponentNode[], after: ComponentNode[]): Pair[] {
  const pairs: Pair[] = [];
  const consumedBefore = new Set<number>();

  // First pass: match by key on both sides.
  for (let ai = 0; ai < after.length; ai += 1) {
    const a = after[ai]!;
    const aKey = stringKey(a);
    if (aKey === undefined) continue;
    const bi = before.findIndex(
      (b, idx) => !consumedBefore.has(idx) && stringKey(b) === aKey,
    );
    if (bi >= 0) {
      consumedBefore.add(bi);
      pairs.push({ before: before[bi]!, after: a, key: aKey, afterIndex: ai, beforeIndex: bi });
    } else {
      pairs.push({ before: null, after: a, key: aKey, afterIndex: ai });
    }
  }

  // Second pass: keyless nodes match by ordinal among other keyless siblings.
  const keylessAfter: Array<{ node: ComponentNode; idx: number }> = [];
  for (let ai = 0; ai < after.length; ai += 1) {
    if (stringKey(after[ai]!) === undefined) keylessAfter.push({ node: after[ai]!, idx: ai });
  }
  const keylessBefore: Array<{ node: ComponentNode; idx: number }> = [];
  for (let bi = 0; bi < before.length; bi += 1) {
    if (stringKey(before[bi]!) === undefined && !consumedBefore.has(bi)) {
      keylessBefore.push({ node: before[bi]!, idx: bi });
    }
  }
  const len = Math.max(keylessBefore.length, keylessAfter.length);
  for (let i = 0; i < len; i += 1) {
    const b = keylessBefore[i];
    const a = keylessAfter[i];
    if (b !== undefined && a !== undefined) {
      consumedBefore.add(b.idx);
      pairs.push({ before: b.node, after: a.node, afterIndex: a.idx, beforeIndex: b.idx });
    } else if (a !== undefined) {
      pairs.push({ before: null, after: a.node, afterIndex: a.idx });
    } else if (b !== undefined) {
      pairs.push({ before: b.node, after: null, beforeIndex: b.idx });
    }
  }

  // Anything in `before` not consumed (had a key but no match in after) is a removal.
  for (let bi = 0; bi < before.length; bi += 1) {
    if (!consumedBefore.has(bi)) {
      const b = before[bi]!;
      const bKey = stringKey(b);
      pairs.push({ before: b, after: null, ...(bKey !== undefined ? { key: bKey } : {}), beforeIndex: bi });
    }
  }
  return pairs;
}

function childPathSegment(name: string, pair: Pair, totalAfterSameName: number): string {
  if (pair.key !== undefined) return `${name}[key=${pair.key}]`;
  // Only disambiguate with an ordinal when there are multiple same-name
  // siblings. Single-child cases stay readable as just the bare name.
  if (totalAfterSameName > 1) {
    const idx = pair.afterIndex ?? pair.beforeIndex ?? 0;
    return `${name}[${idx}]`;
  }
  return name;
}

function groupByName(nodes: ComponentNode[]): Map<string, ComponentNode[]> {
  const map = new Map<string, ComponentNode[]>();
  for (const n of nodes) {
    const arr = map.get(n.name);
    if (arr !== undefined) arr.push(n);
    else map.set(n.name, [n]);
  }
  return map;
}

function stringKey(n: ComponentNode): string | undefined {
  if (n.key === undefined || n.key === null) return undefined;
  return String(n.key);
}

function deepEqual(a: unknown, b: unknown): boolean {
  if (a === b) return true;
  if (a === null || b === null) return false;
  if (typeof a !== typeof b) return false;
  if (typeof a !== 'object') return false;
  if (Array.isArray(a) !== Array.isArray(b)) return false;
  if (Array.isArray(a)) {
    const ar = a as unknown[];
    const br = b as unknown[];
    if (ar.length !== br.length) return false;
    for (let i = 0; i < ar.length; i += 1) {
      if (!deepEqual(ar[i], br[i])) return false;
    }
    return true;
  }
  const ao = a as Record<string, unknown>;
  const bo = b as Record<string, unknown>;
  const keys = new Set([...Object.keys(ao), ...Object.keys(bo)]);
  for (const k of keys) {
    if (!deepEqual(ao[k], bo[k])) return false;
  }
  return true;
}
