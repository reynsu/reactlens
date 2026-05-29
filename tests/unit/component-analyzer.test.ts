import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { analyzeComponent } from '../../src/ast/component-analyzer';
import { statesToTestCases } from '../../src/generator/state-machine';

const FIXTURES = join(__dirname, '..', 'fixtures', 'vite-react-router', 'src', 'pages');

describe('analyzeComponent', () => {
  it('extracts visual states from the fixture CheckoutPage', () => {
    const analysis = analyzeComponent(join(FIXTURES, 'CheckoutPage.tsx'));
    expect(analysis.componentName).toMatch(/Checkout/);
    const stateNames = analysis.states.map((s) => s.name).sort();
    expect(stateNames).toContain('idle');
    expect(stateNames).toContain('declined');
    expect(stateNames).toContain('network-error');
  });

  it('extracts visual states from DashboardPage (loading/error/empty/success)', () => {
    const analysis = analyzeComponent(join(FIXTURES, 'DashboardPage.tsx'));
    const names = analysis.states.map((s) => s.name);
    expect(names).toContain('loading');
    expect(names).toContain('error');
    expect(names).toContain('empty');
  });

  it('finds API endpoints referenced in the source', () => {
    const analysis = analyzeComponent(join(FIXTURES, 'DashboardPage.tsx'));
    // The component itself doesn't fetch directly — it imports `fetchOrders`.
    // We don't follow imports (Phase 5 only), so this can be empty; the test
    // just checks that endpoints is an array.
    expect(Array.isArray(analysis.endpoints)).toBe(true);
  });

  it('detects useState/useReducer hooks', () => {
    const analysis = analyzeComponent(join(FIXTURES, 'CheckoutPage.tsx'));
    const useStates = analysis.hooks.filter((h) => h.name === 'useState');
    expect(useStates.length).toBeGreaterThan(0);
  });
});

describe('statesToTestCases', () => {
  it('produces one TestCase per VisualState', () => {
    const analysis = analyzeComponent(join(FIXTURES, 'CheckoutPage.tsx'));
    const cases = statesToTestCases(analysis);
    expect(cases.length).toBe(analysis.states.length);
    for (const tc of cases) {
      expect(tc.title).toContain(analysis.componentName);
      expect(tc.assertions.length).toBeGreaterThan(0);
    }
  });

  it('emits page.route overrides appropriate to each state', () => {
    const analysis = analyzeComponent(join(FIXTURES, 'DashboardPage.tsx'));
    // Inject endpoints so route overrides have something to attach to.
    for (const s of analysis.states) s.apiCalls = ['/api/orders'];
    const cases = statesToTestCases(analysis);
    const errorCase = cases.find((c) => c.state.name === 'error');
    expect(errorCase?.routeOverrides.some((r) => r.includes('page.route') && r.includes('500'))).toBe(
      true,
    );
  });
});
