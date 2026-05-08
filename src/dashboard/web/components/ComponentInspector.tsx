import { useMemo, useState } from 'react';
import type { ComponentNode, HookSnapshot } from '../types';

type Props = { tree?: ComponentNode };

type FlatNode = { node: ComponentNode; path: number[]; depth: number };

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

export function ComponentInspector({ tree }: Props): JSX.Element {
  const [expanded, setExpanded] = useState<Set<string>>(new Set(['']));
  const [selectedPath, setSelectedPath] = useState<string | null>(null);

  const flat = useMemo(() => flatten(tree, expanded), [tree, expanded]);
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
      <div className="tree">
        {flat.map(({ node, path, depth }) => {
          const key = path.join('.');
          const open = expanded.has(key);
          const hasChildren = node.children.length > 0;
          return (
            <div
              key={key}
              className={`tree-node ${selectedPath === key ? 'selected' : ''}`}
              style={{ paddingLeft: depth * 12 }}
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
