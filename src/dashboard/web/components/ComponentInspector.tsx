import { useMemo, useState } from 'react';
import type { ComponentNode, HookSnapshot } from '../types';

type Props = {
  tree?: ComponentNode;
  // The step Playwright is currently inside (set by the parent from
  // step:start/step:end events). When provided we surface the step title
  // as a context banner and highlight the owning component fiber.
  activeStep?: { title: string };
  // P9: data-testid → ComponentNode.id, built by the probe during snapshot
  // serialization. When present and a step's testid is in the index, we
  // highlight the exact owning fiber by id (ground truth). When absent or
  // the testid isn't indexed (older probe build, getByRole locator, etc.),
  // we fall back to Gap 4's name heuristic.
  testIdIndex?: Record<string, string>;
};

type FlatNode = { node: ComponentNode; path: number[]; depth: number };

// Convert "checkout-submit" → "CheckoutSubmit" so we can fuzzy-match a
// testid against a typical PascalCase component name. Returns lower-case for
// case-insensitive comparison.
function kebabToPascalLower(s: string): string {
  return s
    .split('-')
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join('')
    .toLowerCase();
}

// Extract raw testid strings from a step title like:
//   Click getByTestId('checkout-submit')
//   Fill "ada@example.com" getByTestId('email')
//   Expect "toBeVisible" getByTestId('checkout-card')
function testIdsFromStep(stepTitle: string): string[] {
  const matches = stepTitle.matchAll(/getByTestId\(['"]([^'"]+)['"]\)/g);
  const out: string[] = [];
  for (const m of matches) {
    if (m[1] !== undefined) out.push(m[1]);
  }
  return out;
}

// Heuristic fallback when testIdIndex is unavailable or a particular testid
// isn't in the index. Returns lower-case PascalCase forms ready to compare
// against component names.
function activeComponentMatchers(stepTitle: string): string[] {
  return testIdsFromStep(stepTitle).map(kebabToPascalLower);
}

function flatten(tree: ComponentNode | undefined, expanded: Set<string>): FlatNode[] {
  if (tree === undefined) return [];
  const out: FlatNode[] = [];
  function walk(node: ComponentNode, path: number[], depth: number): void {
    out.push({ node, path, depth });
    const key = path.join('.');
    if (!expanded.has(key)) return;
    for (let i = 0; i < node.children.length; i += 1) {
      const child = node.children[i];
      if (child !== undefined) walk(child, [...path, i], depth + 1);
    }
  }
  walk(tree, [], 0);
  return out;
}

function HooksTable({ hooks }: { hooks: HookSnapshot[] }): JSX.Element {
  return (
    <table className="kv-table">
      <thead>
        <tr><th>kind</th><th>value</th></tr>
      </thead>
      <tbody>
        {hooks.map((h, i) => (
          <tr key={i}>
            <td>{h.kind}</td>
            <td><pre>{JSON.stringify(h.value, null, 2)}</pre></td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

function PropsTable({ props }: { props: Record<string, unknown> }): JSX.Element {
  const entries = Object.entries(props);
  if (entries.length === 0) return <div className="empty-state" style={{ padding: 8 }}>(no props)</div>;
  return (
    <table className="kv-table">
      <thead>
        <tr><th>name</th><th>value</th></tr>
      </thead>
      <tbody>
        {entries.map(([k, v]) => (
          <tr key={k}>
            <td>{k}</td>
            <td><pre>{typeof v === 'string' ? v : JSON.stringify(v, null, 2)}</pre></td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

export function ComponentInspector({ tree, activeStep, testIdIndex }: Props): JSX.Element {
  const [expanded, setExpanded] = useState<Set<string>>(new Set(['']));
  const [selectedPath, setSelectedPath] = useState<string | null>(null);

  const flat = useMemo(() => flatten(tree, expanded), [tree, expanded]);

  // P9: resolve the active step's testids against the probe-built index.
  // Each testid produces either an exact id match (ground truth) or falls
  // back to a name-heuristic matcher. We keep the two channels separate so
  // the banner can be honest about which one fired.
  const { exactIds, fallbackMatchers } = useMemo(() => {
    if (activeStep === undefined) return { exactIds: new Set<string>(), fallbackMatchers: [] as string[] };
    const ids = new Set<string>();
    const fallbacks: string[] = [];
    for (const testid of testIdsFromStep(activeStep.title)) {
      const id = testIdIndex?.[testid];
      if (id !== undefined) ids.add(id);
      else fallbacks.push(kebabToPascalLower(testid));
    }
    return { exactIds: ids, fallbackMatchers: fallbacks };
  }, [activeStep, testIdIndex]);
  // Retained for the "no testIdIndex at all" path — when the snapshot
  // predates P9 we still get the Gap 4 highlight.
  const matchers = useMemo(
    () =>
      activeStep !== undefined && testIdIndex === undefined ? activeComponentMatchers(activeStep.title) : fallbackMatchers,
    [activeStep, testIdIndex, fallbackMatchers],
  );
  const selectedNode = useMemo(() => {
    if (selectedPath === null) return undefined;
    return flat.find((f) => f.path.join('.') === selectedPath)?.node;
  }, [flat, selectedPath]);

  function toggle(path: number[]): void {
    const key = path.join('.');
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  }

  if (tree === undefined) {
    return (
      <>
        <div className="panel-header">Component Tree</div>
        <div className="empty-state">Run a test to see its React tree</div>
      </>
    );
  }

  return (
    <>
      <div className="panel-header">Component Tree</div>
      {activeStep !== undefined && (
        <div
          className="active-step-banner"
          style={{
            padding: '6px 10px',
            fontSize: 12,
            color: 'var(--muted)',
            borderBottom: '1px solid var(--border)',
            fontFamily: 'ui-monospace, monospace',
          }}
          title={
            exactIds.size > 0
              ? 'The Playwright step currently in flight. Highlighted tree nodes are exact matches via the probe-built testIdIndex (P9).'
              : "The Playwright step currently in flight. Highlighted tree nodes are heuristic name matches against the step's testid."
          }
        >
          ▸ {activeStep.title}
          {(exactIds.size > 0 || matchers.length > 0) && (
            <span style={{ marginLeft: 6, fontSize: 10, opacity: 0.7 }}>
              · {exactIds.size > 0 ? 'exact' : 'heuristic'}
            </span>
          )}
        </div>
      )}
      <div className="tree">
        {flat.map(({ node, path, depth }) => {
          const key = path.join('.');
          const open = expanded.has(key);
          const hasChildren = node.children.length > 0;
          const nameLower = node.name.toLowerCase();
          // Prefer the exact id match (P9 ground truth). Fall back to the
          // name heuristic only when this snapshot's testIdIndex didn't
          // resolve the active step's testid.
          const isExact = node.id !== undefined && exactIds.has(node.id);
          const isActive =
            isExact || matchers.some((m) => nameLower === m || nameLower.includes(m));
          return (
            <div
              key={key}
              className={`tree-node ${selectedPath === key ? 'selected' : ''}${isActive ? ' tree-node--active' : ''}`}
              style={{
                paddingLeft: depth * 12,
                ...(isActive ? { background: 'var(--active-bg, rgba(255,200,0,0.12))' } : {}),
              }}
            >
              <span className="label" onClick={() => setSelectedPath(key)}>
                <span
                  className="toggle"
                  onClick={(ev) => {
                    ev.stopPropagation();
                    if (hasChildren) toggle(path);
                  }}
                >
                  {hasChildren ? (open ? '▾' : '▸') : ' '}
                </span>
                {node.name}
                {node.key !== undefined && node.key !== null && (
                  <span style={{ color: 'var(--muted)', marginLeft: 4 }}>key={node.key}</span>
                )}
                {isActive && (
                  <span
                    style={{ color: 'var(--muted)', marginLeft: 6, fontSize: 11 }}
                    title={
                      isExact
                        ? 'Exact match: the active step\'s testid resolves to this fiber via the probe-built index (P9).'
                        : "Heuristic match: this component's name kebab-cased equals the active step's testid."
                    }
                  >
                    · {isExact ? 'active (exact)' : 'active'}
                  </span>
                )}
              </span>
            </div>
          );
        })}
      </div>
      {selectedNode !== undefined && (
        <>
          <div className="panel-header">Props</div>
          <PropsTable props={selectedNode.props} />
          {selectedNode.hooks !== undefined && selectedNode.hooks.length > 0 && (
            <>
              <div className="panel-header">Hooks</div>
              <HooksTable hooks={selectedNode.hooks} />
            </>
          )}
          {selectedNode.source !== undefined && (
            <>
              <div className="panel-header">Source</div>
              <div style={{ padding: 8, fontSize: 12, fontFamily: 'ui-monospace, monospace' }}>
                {selectedNode.source.file}:{selectedNode.source.line}
              </div>
            </>
          )}
        </>
      )}
    </>
  );
}
