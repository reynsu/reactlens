// Catalog-level invariants. Doubles as a regression test for the matchers,
// page.route recipes, and assertion lists — if one entry's behaviour changes
// by accident during a future refactor, the test fails loudly here instead of
// surfacing as a wrong-shape generated spec way downstream.
import { describe, expect, it } from 'vitest';
import { VISUAL_STATES, type VisualStateName } from '../../src/visual-states/visual-states';

describe('VISUAL_STATES — catalog invariants', () => {
  it('lists exactly the eight documented state names', () => {
    expect(Object.keys(VISUAL_STATES).sort()).toEqual(
      ['declined', 'empty', 'error', 'idle', 'loading', 'network-error', 'submitting', 'success'].sort(),
    );
  });

  it('every entry has a non-empty description', () => {
    for (const [name, entry] of Object.entries(VISUAL_STATES)) {
      expect(entry.description.length, `${name}.description`).toBeGreaterThan(0);
    }
  });

  it('every entry has a non-empty assertions list', () => {
    for (const [name, entry] of Object.entries(VISUAL_STATES)) {
      expect(entry.assertions.length, `${name}.assertions`).toBeGreaterThan(0);
    }
  });

  it('only `idle` has a null matcher (added as default by component-analyzer)', () => {
    for (const [name, entry] of Object.entries(VISUAL_STATES)) {
      if (name === 'idle') {
        expect(entry.matcher, 'idle.matcher').toBeNull();
      } else {
        expect(entry.matcher, `${name}.matcher`).not.toBeNull();
      }
    }
  });

  it('only `submitting` has a null routeRecipe (purely a UI state, no API to mock)', () => {
    for (const [name, entry] of Object.entries(VISUAL_STATES)) {
      if (name === 'submitting') {
        expect(entry.routeRecipe, 'submitting.routeRecipe').toBeNull();
      } else {
        expect(entry.routeRecipe, `${name}.routeRecipe`).not.toBeNull();
      }
    }
  });
});

describe('VISUAL_STATES — matchers (regression for AST condition discovery)', () => {
  it('loading matches isLoading / isPending / isFetching', () => {
    const m = VISUAL_STATES.loading.matcher!;
    expect(m.test('query.isLoading')).toBe(true);
    expect(m.test('isPending')).toBe(true);
    expect(m.test('isFetching')).toBe(true);
    expect(m.test('isErroring')).toBe(false);
  });

  it('error matches isError and `error !== null`', () => {
    const m = VISUAL_STATES.error.matcher!;
    expect(m.test('isError')).toBe(true);
    expect(m.test('error !== null')).toBe(true);
    expect(m.test('error != undefined')).toBe(true);
  });

  it('success matches isSuccess', () => {
    expect(VISUAL_STATES.success.matcher!.test('isSuccess')).toBe(true);
  });

  it('empty matches `.length === 0`', () => {
    const m = VISUAL_STATES.empty.matcher!;
    expect(m.test('orders.length === 0')).toBe(true);
    expect(m.test('items.length == 0')).toBe(true);
  });

  it('declined matches the word "declined"', () => {
    expect(VISUAL_STATES.declined.matcher!.test('payment.status === "declined"')).toBe(true);
  });

  it('network-error matches several spellings', () => {
    const m = VISUAL_STATES['network-error'].matcher!;
    expect(m.test('NetworkError')).toBe(true);
    expect(m.test('network-error')).toBe(true);
    expect(m.test('network error')).toBe(true);
    expect(m.test('network_error')).toBe(true);
  });

  it('submitting matches the word "submitting" (word-boundary, not camelCase)', () => {
    const m = VISUAL_STATES.submitting.matcher!;
    expect(m.test('status === "submitting"')).toBe(true);
    expect(m.test('submitting')).toBe(true);
    // Word boundary semantics: camelCase like `isSubmitting` does NOT match
    // because there's no \b between `is` and `S`. Documenting the regression
    // surface so future cleanups don't widen this without intent.
    expect(m.test('isSubmitting')).toBe(false);
  });
});

describe('VISUAL_STATES — routeRecipe (each state → its page.route snippet)', () => {
  const ep = '/api/orders';

  it('every recipe produces a page.route(...) snippet targeting the endpoint', () => {
    for (const [name, entry] of Object.entries(VISUAL_STATES)) {
      if (entry.routeRecipe === null) continue;
      const snippet = entry.routeRecipe(ep);
      expect(snippet, `${name}.routeRecipe`).toContain('page.route');
      expect(snippet, `${name}.routeRecipe`).toContain(ep);
    }
  });

  it('loading leaves the request pending (no fulfill)', () => {
    const snippet = VISUAL_STATES.loading.routeRecipe!(ep);
    expect(snippet).toContain(`page.route('**${ep}'`);
    expect(snippet).not.toContain('fulfill');
  });

  it('error fulfills with a 500', () => {
    expect(VISUAL_STATES.error.routeRecipe!(ep)).toBe(
      `await page.route('**${ep}', (route) => route.fulfill({ status: 500 }));`,
    );
  });

  it('network-error aborts the request', () => {
    expect(VISUAL_STATES['network-error'].routeRecipe!(ep)).toBe(
      `await page.route('**${ep}', (route) => route.abort());`,
    );
  });

  it('empty fulfills with a 200 empty array body', () => {
    expect(VISUAL_STATES.empty.routeRecipe!(ep)).toBe(
      `await page.route('**${ep}', (route) => route.fulfill({ status: 200, contentType: 'application/json', body: '[]' }));`,
    );
  });

  it('declined fulfills with a 402', () => {
    expect(VISUAL_STATES.declined.routeRecipe!(ep)).toBe(
      `await page.route('**${ep}', (route) => route.fulfill({ status: 402 }));`,
    );
  });

  it('success and idle both fulfill with a default 200', () => {
    const expected = `await page.route('**${ep}', (route) => route.fulfill({ status: 200, contentType: 'application/json', body: '{}' }));`;
    expect(VISUAL_STATES.success.routeRecipe!(ep)).toBe(expected);
    expect(VISUAL_STATES.idle.routeRecipe!(ep)).toBe(expected);
  });
});

describe('VisualStateName — type-level guard', () => {
  it('keyof typeof VISUAL_STATES is the canonical name union', () => {
    // Compile-time check: this assignment fails if the type drifts from the
    // documented set. The runtime check just exercises the const, but the
    // value of the test is the line below typechecking.
    const valid: VisualStateName = 'loading';
    expect(VISUAL_STATES[valid]).toBeDefined();
  });
});
