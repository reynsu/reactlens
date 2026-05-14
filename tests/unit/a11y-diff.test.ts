import { describe, expect, it } from 'vitest';
import { diffA11yTree, type A11ySemanticDiff } from '../../src/analyzer/a11y-diff';
import type { AxNode } from '../../src/runner/events';

function ax(role: string, attrs: Partial<AxNode> = {}, children: AxNode[] = []): AxNode {
  return { role, children, ...attrs };
}

describe('diffA11yTree', () => {
  it('returns an empty diff for identical trees', () => {
    const a = ax('WebArea', { name: 'Checkout' }, [
      ax('button', { name: 'Submit' }),
    ]);
    const b = ax('WebArea', { name: 'Checkout' }, [
      ax('button', { name: 'Submit' }),
    ]);
    expect(diffA11yTree(a, b)).toEqual<A11ySemanticDiff[]>([]);
  });

  it('detects a name change on a matched node and reports the path with role+name', () => {
    const a = ax('WebArea', { name: 'Page' }, [ax('button', { name: 'Submit' })]);
    const b = ax('WebArea', { name: 'Page' }, [ax('button', { name: 'Pay now' })]);
    const diffs = diffA11yTree(a, b);
    // A name change on a leaf with no other ancestor reads as a removed
    // 'Submit' button and an added 'Pay now' button — same role at the
    // same path-slot, but distinguishable to a screen reader user.
    expect(diffs).toContainEqual<A11ySemanticDiff>({
      kind: 'node-removed',
      path: 'WebArea[Page] > button[Submit]',
      role: 'button',
      name: 'Submit',
    });
    expect(diffs).toContainEqual<A11ySemanticDiff>({
      kind: 'node-added',
      path: 'WebArea[Page] > button[Pay now]',
      role: 'button',
      name: 'Pay now',
    });
  });

  it('detects an attribute change (disabled/value/checked) on a matched node', () => {
    const a = ax('WebArea', { name: 'P' }, [ax('button', { name: 'Submit', disabled: true })]);
    const b = ax('WebArea', { name: 'P' }, [ax('button', { name: 'Submit', disabled: false })]);
    expect(diffA11yTree(a, b)).toEqual<A11ySemanticDiff[]>([
      {
        kind: 'attr-changed',
        path: 'WebArea[P] > button[Submit]',
        role: 'button',
        name: 'Submit',
        attr: 'disabled',
        before: true,
        after: false,
      },
    ]);
  });

  it('detects a node added in the after tree', () => {
    const a = ax('WebArea', { name: 'P' }, [ax('heading', { name: 'Welcome' })]);
    const b = ax('WebArea', { name: 'P' }, [
      ax('heading', { name: 'Welcome' }),
      ax('button', { name: 'Get started' }),
    ]);
    const diffs = diffA11yTree(a, b);
    expect(diffs).toContainEqual<A11ySemanticDiff>({
      kind: 'node-added',
      path: 'WebArea[P] > button[Get started]',
      role: 'button',
      name: 'Get started',
    });
  });

  it('detects a node removed', () => {
    const a = ax('WebArea', { name: 'P' }, [ax('button', { name: 'Cancel' })]);
    const b = ax('WebArea', { name: 'P' }, []);
    expect(diffA11yTree(a, b)).toEqual<A11ySemanticDiff[]>([
      {
        kind: 'node-removed',
        path: 'WebArea[P] > button[Cancel]',
        role: 'button',
        name: 'Cancel',
      },
    ]);
  });

  it('matches nodes by role+name across reorders without emitting spurious add/remove', () => {
    const a = ax('WebArea', { name: 'P' }, [
      ax('button', { name: 'A' }),
      ax('button', { name: 'B' }),
    ]);
    const b = ax('WebArea', { name: 'P' }, [
      ax('button', { name: 'B' }),
      ax('button', { name: 'A' }),
    ]);
    expect(diffA11yTree(a, b)).toEqual<A11ySemanticDiff[]>([]);
  });

  it('treats role changes as remove + add (different semantic affordance)', () => {
    const a = ax('WebArea', { name: 'P' }, [ax('button', { name: 'Apply' })]);
    const b = ax('WebArea', { name: 'P' }, [ax('link', { name: 'Apply' })]);
    const diffs = diffA11yTree(a, b);
    expect(diffs).toContainEqual<A11ySemanticDiff>({
      kind: 'node-removed',
      path: 'WebArea[P] > button[Apply]',
      role: 'button',
      name: 'Apply',
    });
    expect(diffs).toContainEqual<A11ySemanticDiff>({
      kind: 'node-added',
      path: 'WebArea[P] > link[Apply]',
      role: 'link',
      name: 'Apply',
    });
  });

  it('recurses into nested subtrees and reports diffs at full path', () => {
    const a = ax('WebArea', { name: 'Root' }, [
      ax('region', { name: 'Form' }, [ax('textbox', { name: 'Email', value: 'a@b.com' })]),
    ]);
    const b = ax('WebArea', { name: 'Root' }, [
      ax('region', { name: 'Form' }, [ax('textbox', { name: 'Email', value: 'x@y.com' })]),
    ]);
    expect(diffA11yTree(a, b)).toEqual<A11ySemanticDiff[]>([
      {
        kind: 'attr-changed',
        path: 'WebArea[Root] > region[Form] > textbox[Email]',
        role: 'textbox',
        name: 'Email',
        attr: 'value',
        before: 'a@b.com',
        after: 'x@y.com',
      },
    ]);
  });
});
