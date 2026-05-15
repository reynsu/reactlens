// Bridges component AST analysis to a list of TestCase IRs that the agent
// will turn into Page Object + spec code. Each TestCase represents one
// visual state to provoke + the actions to exit it.
//
// Per-state data (msw recipes, assertions, descriptions) lives in the
// VISUAL_STATES catalog. This module owns the orthogonal axis: per-component
// action heuristics (login, checkout) that aren't state-specific.
import type { ComponentAnalysis, VisualState } from '../ast/component-analyzer';
import { VISUAL_STATES, type VisualStateName } from '../visual-states/visual-states';

export type TestCase = {
  componentName: string;
  state: VisualState;
  // Suggested test title — the agent may rephrase but must keep the intent.
  title: string;
  // MSW handler overrides needed to provoke this state, expressed as
  // human-readable hints. Eg: "GET /api/orders → 500".
  mswHandlers: string[];
  // Steps the test should perform after the state activates.
  actions: string[];
  // Assertions the agent should generate in the spec.
  assertions: string[];
};

function entryFor(state: VisualState): (typeof VISUAL_STATES)[VisualStateName] | undefined {
  return VISUAL_STATES[state.name as VisualStateName];
}

function mswForState(state: VisualState): string[] {
  const entry = entryFor(state);
  if (entry === undefined || entry.mswRecipe === null) return [];
  const recipe = entry.mswRecipe;
  return state.apiCalls.map((ep) => recipe(ep));
}

function actionsForState(state: VisualState, componentName: string): string[] {
  const lower = componentName.toLowerCase();
  if (lower.includes('login') && state.name === 'idle') {
    return ['fill email', 'fill password', 'submit form'];
  }
  if (lower.includes('login') && state.name === 'error') {
    return ['fill bad credentials', 'submit form'];
  }
  if (lower.includes('checkout') && state.name === 'success') {
    return ['fill valid card details', 'submit form'];
  }
  if (lower.includes('checkout') && state.name === 'declined') {
    return ['fill declined card (4000…)', 'submit form'];
  }
  return ['navigate to the page'];
}

function assertionsForState(state: VisualState): string[] {
  const entry = entryFor(state);
  // Catch-all for any state name not in the catalog. Pre-catalog behaviour
  // returned the same string from the switch's default branch.
  if (entry === undefined) return ['component renders without crashing'];
  return [...entry.assertions];
}

export function statesToTestCases(analysis: ComponentAnalysis): TestCase[] {
  return analysis.states.map((state) => ({
    componentName: analysis.componentName,
    state,
    title: `${analysis.componentName} renders ${state.name} state`,
    mswHandlers: mswForState(state),
    actions: actionsForState(state, analysis.componentName),
    assertions: assertionsForState(state),
  }));
}
