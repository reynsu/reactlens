// Canonical catalog of the visual states a React component can be in. Single
// source of truth for:
//   - the AST condition matchers component-analyzer uses to enumerate states
//   - the Playwright `page.route` recipe snippet state-machine emits per endpoint
//   - the human-readable description prompts and behavior-contract docs render
//   - the assertion list state-machine attaches to each generated TestCase
//
// Adding a new visual state used to require coordinated edits in
// component-analyzer.ts (regex + name) AND three switch branches in
// state-machine.ts. With this catalog it is one entry below.
//
// Backend-state provocation is standardized on Playwright `page.route`
// (ADR-0011) — there is no MSW layer in the out-of-the-box path. Each recipe
// returns a ready-to-paste `page.route(...)` snippet the agent specializes.
//
// Layered above neither ast nor generator so both can import it as a peer
// without inverting the existing layering (same precedent as src/runs/).

export type RouteRecipe = (endpoint: string) => string;

export type VisualStateEntry = {
  // Human-readable description used in prompts and behavior-contract markdown.
  description: string;
  // Regex matched against AST condition text (`isLoading`, `error !== null`,
  // etc) to discover which states a component can be in. Null when the state
  // is the default — component-analyzer adds it explicitly via getDefaultState.
  matcher: RegExp | null;
  // Per-endpoint Playwright `page.route` recipe used to provoke this state.
  // Null when this state needs no API override (`submitting` is purely a UI
  // state — preserve the pre-pivot behaviour where routeForState returned [].)
  routeRecipe: RouteRecipe | null;
  // Assertions the agent should generate in the spec for this state. Always
  // non-empty so the spec has something to assert; the catch-all
  // `component renders without crashing` is what `idle` carries.
  assertions: readonly string[];
};

export const VISUAL_STATES = {
  loading: {
    description: 'data fetch in progress',
    matcher: /\b(isLoading|isPending|isFetching)\b/i,
    routeRecipe: (ep) =>
      `await page.route('**${ep}', () => {}); // leave pending — never resolve the request`,
    assertions: ['loading indicator visible'],
  },
  error: {
    description: 'fetch or submit failed',
    matcher: /\b(isError|error\s*!==?\s*(null|undefined))\b/i,
    routeRecipe: (ep) => `await page.route('**${ep}', (route) => route.fulfill({ status: 500 }));`,
    assertions: ['error banner visible', 'retry control visible (when present)'],
  },
  success: {
    description: 'happy-path render',
    matcher: /\bisSuccess\b/i,
    routeRecipe: (ep) =>
      `await page.route('**${ep}', (route) => route.fulfill({ status: 200, contentType: 'application/json', body: '{}' }));`,
    assertions: ['success indicator visible'],
  },
  empty: {
    description: 'collection was empty',
    matcher: /\.length\s*===?\s*0\b/,
    routeRecipe: (ep) =>
      `await page.route('**${ep}', (route) => route.fulfill({ status: 200, contentType: 'application/json', body: '[]' }));`,
    assertions: ['empty-state element visible'],
  },
  declined: {
    description: 'payment declined',
    matcher: /\bdeclined\b/i,
    routeRecipe: (ep) => `await page.route('**${ep}', (route) => route.fulfill({ status: 402 }));`,
    assertions: ['declined banner visible'],
  },
  'network-error': {
    description: 'network failure',
    matcher: /\bnetwork[- _]?error\b/i,
    routeRecipe: (ep) => `await page.route('**${ep}', (route) => route.abort());`,
    assertions: ['error banner visible', 'retry control visible (when present)'],
  },
  submitting: {
    description: 'in-flight submit',
    matcher: /\bsubmitting\b/i,
    // Pre-pivot behaviour: routeForState had no 'submitting' branch, so
    // recipes came back empty. Preserved exactly — nothing to mock here.
    routeRecipe: null,
    assertions: ['submit button is disabled while in flight'],
  },
  idle: {
    description: 'default render path',
    // No AST condition activates idle — component-analyzer adds it as the
    // default render path via getDefaultState().
    matcher: null,
    routeRecipe: (ep) =>
      `await page.route('**${ep}', (route) => route.fulfill({ status: 200, contentType: 'application/json', body: '{}' }));`,
    assertions: ['component renders without crashing'],
  },
} as const satisfies Record<string, VisualStateEntry>;

export type VisualStateName = keyof typeof VISUAL_STATES;
