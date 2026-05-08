// Bridges component AST analysis to a list of TestCase IRs that the agent
// will turn into Page Object + spec code. Each TestCase represents one
// visual state to provoke + the actions to exit it.
import type { ComponentAnalysis, VisualState } from '../ast/component-analyzer';

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

function mswForState(state: VisualState): string[] {
  const out: string[] = [];
  for (const ep of state.apiCalls) {
    if (state.name === 'loading') out.push(`${ep} → never resolve (delay) until release`);
    else if (state.name === 'error' || state.name === 'network-error') out.push(`${ep} → 500`);
    else if (state.name === 'empty') out.push(`${ep} → 200 with empty array/object`);
    else if (state.name === 'declined') out.push(`${ep} → 402`);
    else if (state.name === 'success' || state.name === 'idle') out.push(`${ep} → 200 (default)`);
  }
  return out;
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
  switch (state.name) {
    case 'loading':
      return ['loading indicator visible'];
    case 'error':
    case 'network-error':
      return ['error banner visible', 'retry control visible (when present)'];
    case 'empty':
      return ['empty-state element visible'];
    case 'success':
      return ['success indicator visible'];
    case 'declined':
      return ['declined banner visible'];
    case 'submitting':
      return ['submit button is disabled while in flight'];
    default:
      return ['component renders without crashing'];
  }
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
