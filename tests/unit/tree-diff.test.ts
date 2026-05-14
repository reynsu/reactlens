import { describe, expect, it } from 'vitest';
import { diffComponentTree, type SemanticDiff } from '../../src/analyzer/tree-diff';
import type { ComponentNode } from '../../src/runner/events';

function node(name: string, props: Record<string, unknown> = {}, children: ComponentNode[] = [], extras: Partial<ComponentNode> = {}): ComponentNode {
  return { id: '0', name, props, children, ...extras };
}

describe('diffComponentTree', () => {
  it('returns an empty diff for identical trees', () => {
    const a = node('App', {}, [node('Button', { disabled: true })]);
    const b = node('App', {}, [node('Button', { disabled: true })]);
    expect(diffComponentTree(a, b)).toEqual<SemanticDiff[]>([]);
  });

  it('detects a prop change on a matched component', () => {
    const a = node('Submit', { disabled: true });
    const b = node('Submit', { disabled: false });
    expect(diffComponentTree(a, b)).toEqual<SemanticDiff[]>([
      {
        kind: 'prop-changed',
        path: 'Submit',
        component: 'Submit',
        prop: 'disabled',
        before: true,
        after: false,
      },
    ]);
  });

  it('detects a prop added or removed (not just value changes)', () => {
    const a = node('Input', { value: 'hello' });
    const b = node('Input', { value: 'hello', placeholder: 'type here' });
    const diffs = diffComponentTree(a, b);
    expect(diffs).toContainEqual<SemanticDiff>({
      kind: 'prop-changed',
      path: 'Input',
      component: 'Input',
      prop: 'placeholder',
      before: undefined,
      after: 'type here',
    });
  });

  it('detects a child component added in the after tree', () => {
    const a = node('Form', {}, []);
    const b = node('Form', {}, [node('Submit', {})]);
    expect(diffComponentTree(a, b)).toContainEqual<SemanticDiff>({
      kind: 'component-added',
      path: 'Form > Submit',
      component: 'Submit',
    });
  });

  it('detects a child component removed from the after tree', () => {
    const a = node('Form', {}, [node('Submit', {})]);
    const b = node('Form', {}, []);
    expect(diffComponentTree(a, b)).toContainEqual<SemanticDiff>({
      kind: 'component-removed',
      path: 'Form > Submit',
      component: 'Submit',
    });
  });

  it('matches siblings of the same name by React key when available', () => {
    const a = node('List', {}, [
      node('Item', { count: 1 }, [], { key: 'a' }),
      node('Item', { count: 2 }, [], { key: 'b' }),
    ]);
    // The 'a'-keyed item moved (index swap) and its count changed.
    const b = node('List', {}, [
      node('Item', { count: 2 }, [], { key: 'b' }),
      node('Item', { count: 9 }, [], { key: 'a' }),
    ]);
    const diffs = diffComponentTree(a, b);
    // Only one prop change (on the 'a' key), no add/remove — reorder isn't
    // a "semantic" diff for this v1.
    expect(diffs.filter((d) => d.kind === 'component-added' || d.kind === 'component-removed')).toEqual([]);
    expect(diffs).toContainEqual<SemanticDiff>({
      kind: 'prop-changed',
      path: 'List > Item[key=a]',
      component: 'Item',
      prop: 'count',
      before: 1,
      after: 9,
    });
  });

  it('falls back to ordinal among same-name siblings when keys are absent', () => {
    const a = node('Row', {}, [node('Cell', { v: 'x' }), node('Cell', { v: 'y' })]);
    const b = node('Row', {}, [node('Cell', { v: 'x' }), node('Cell', { v: 'z' })]);
    expect(diffComponentTree(a, b)).toEqual<SemanticDiff[]>([
      {
        kind: 'prop-changed',
        path: 'Row > Cell[1]',
        component: 'Cell',
        prop: 'v',
        before: 'y',
        after: 'z',
      },
    ]);
  });

  it('reports a name change at the same position as remove + add (no synthetic rename)', () => {
    const a = node('Panel', {}, [node('Loading', {})]);
    const b = node('Panel', {}, [node('Error', {})]);
    const diffs = diffComponentTree(a, b);
    expect(diffs).toContainEqual<SemanticDiff>({
      kind: 'component-removed',
      path: 'Panel > Loading',
      component: 'Loading',
    });
    expect(diffs).toContainEqual<SemanticDiff>({
      kind: 'component-added',
      path: 'Panel > Error',
      component: 'Error',
    });
  });

  it('recurses into nested subtrees and reports diffs at full path', () => {
    const a = node('App', {}, [node('Header', {}, [node('Title', { text: 'hi' })])]);
    const b = node('App', {}, [node('Header', {}, [node('Title', { text: 'bye' })])]);
    expect(diffComponentTree(a, b)).toEqual<SemanticDiff[]>([
      {
        kind: 'prop-changed',
        path: 'App > Header > Title',
        component: 'Title',
        prop: 'text',
        before: 'hi',
        after: 'bye',
      },
    ]);
  });
});
