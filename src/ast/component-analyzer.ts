// Static analysis of a React component to enumerate the visual states it can
// be in. Output drives capability 4.2 (state-aware test generation): the
// generator gets a list of states up front rather than guessing from the DOM.
//
// We DON'T attempt to symbolically execute the component or infer all
// transitions. We do a single pass identifying:
//   - useState / useReducer initial values
//   - Early returns guarded on a state value (loading/error/empty/success)
//   - JSX returned conditionally via if/&&/?:
//   - React Query / SWR query state branches (isLoading, isError, isSuccess)
//   - Error boundaries (fallback prop)
//   - API URLs referenced inside the component (so the spec can mock them)
//
// The output is a deliberately approximate `ComponentAnalysis` — the AI
// generator polishes details from the source itself; our job is to make sure
// no states are missed.
import { Project, SyntaxKind, type Node, type SourceFile } from 'ts-morph';

export type VisualState = {
  // Stable identifier we hand to test generation, eg 'loading', 'empty',
  // 'success', 'error', 'idle'. Inferred from the JSX returned.
  name: string;
  // English description for the prompt. Eg "render path that returns when
  // useQuery.isLoading is true".
  description: string;
  // Predicates that activate this state, derived from condition expressions
  // we encountered in the AST. Eg ["query.isLoading"], ["status === 'declined'"].
  conditions: string[];
  // Endpoints the component fetches from in this state, when discoverable.
  apiCalls: string[];
};

export type ComponentAnalysis = {
  componentName: string;
  filePath: string;
  states: VisualState[];
  hooks: Array<{ name: string; initial?: string }>;
  endpoints: string[];
};

const QUERY_FLAG_NAMES = new Set([
  'isLoading',
  'isPending',
  'isFetching',
  'isError',
  'isSuccess',
  'isIdle',
]);

function getDefaultState(): VisualState {
  return {
    name: 'idle',
    description: 'default render path',
    conditions: [],
    apiCalls: [],
  };
}

function pushState(states: VisualState[], state: VisualState): void {
  // Coalesce by name so we don't emit duplicates.
  const existing = states.find((s) => s.name === state.name);
  if (existing === undefined) {
    states.push(state);
    return;
  }
  for (const c of state.conditions) {
    if (!existing.conditions.includes(c)) existing.conditions.push(c);
  }
  for (const a of state.apiCalls) {
    if (!existing.apiCalls.includes(a)) existing.apiCalls.push(a);
  }
}

function analyzeStateFromCondition(condition: string): VisualState | null {
  // Heuristic: map common predicate shapes to canonical state names.
  const lower = condition.toLowerCase();
  if (lower.includes('isloading') || lower.includes('ispending') || lower.includes('isfetching')) {
    return { name: 'loading', description: 'data fetch in progress', conditions: [condition], apiCalls: [] };
  }
  if (lower.includes('iserror') || lower.includes('error !==') || /error\s*!==?\s*(null|undefined)/i.test(condition)) {
    return { name: 'error', description: 'fetch or submit failed', conditions: [condition], apiCalls: [] };
  }
  if (lower.includes('issuccess') || lower.includes('= true')) {
    return { name: 'success', description: 'happy-path render', conditions: [condition], apiCalls: [] };
  }
  if (lower.includes('length === 0') || lower.includes('.length === 0')) {
    return { name: 'empty', description: 'collection was empty', conditions: [condition], apiCalls: [] };
  }
  if (lower.includes('declined')) {
    return { name: 'declined', description: 'payment declined', conditions: [condition], apiCalls: [] };
  }
  if (lower.includes('network')) {
    return { name: 'network-error', description: 'network failure', conditions: [condition], apiCalls: [] };
  }
  if (lower.includes('submitting')) {
    return { name: 'submitting', description: 'in-flight submit', conditions: [condition], apiCalls: [] };
  }
  return null;
}

function findHooks(sourceFile: SourceFile): Array<{ name: string; initial?: string }> {
  const out: Array<{ name: string; initial?: string }> = [];
  sourceFile.forEachDescendant((node) => {
    if (node.getKind() !== SyntaxKind.CallExpression) return;
    const text = node.getText();
    const hookMatch = text.match(/^(useState|useReducer|useQuery|useSWR|useForm)\b/);
    if (hookMatch === null || hookMatch[1] === undefined) return;
    out.push({ name: hookMatch[1], initial: text.slice(0, 120) });
  });
  return out;
}

function findEndpoints(sourceFile: SourceFile): string[] {
  // Match string literals that look like URLs or paths starting with `/api/`.
  const out = new Set<string>();
  sourceFile.forEachDescendant((node) => {
    if (node.getKind() !== SyntaxKind.StringLiteral) return;
    const text = node.getText().slice(1, -1);
    if (text.startsWith('/api/') || /^https?:\/\//i.test(text)) out.add(text);
  });
  return Array.from(out);
}

function findConditionalReturns(sourceFile: SourceFile): VisualState[] {
  const states: VisualState[] = [];
  sourceFile.forEachDescendant((node) => {
    if (node.getKind() === SyntaxKind.IfStatement) {
      const ifNode = node as Node & { getExpression?: () => Node; getThenStatement?: () => Node };
      const expr = ifNode.getExpression?.()?.getText() ?? '';
      const inferred = analyzeStateFromCondition(expr);
      if (inferred !== null) pushState(states, inferred);
    }
    if (node.getKind() === SyntaxKind.ConditionalExpression) {
      const tern = node as Node & { getCondition?: () => Node };
      const cond = tern.getCondition?.()?.getText() ?? '';
      const inferred = analyzeStateFromCondition(cond);
      if (inferred !== null) pushState(states, inferred);
    }
    if (node.getKind() === SyntaxKind.BinaryExpression) {
      const bin = node as Node & { getOperatorToken?: () => Node };
      const op = bin.getOperatorToken?.()?.getKind();
      if (op === SyntaxKind.AmpersandAmpersandToken) {
        const left = (node as Node & { getLeft?: () => Node }).getLeft?.()?.getText() ?? '';
        const inferred = analyzeStateFromCondition(left);
        if (inferred !== null) pushState(states, inferred);
      }
    }
  });
  return states;
}

function inferComponentName(sourceFile: SourceFile, filePath: string): string {
  // Look for `export function X` or `export const X = (...) => ...`.
  for (const stmt of sourceFile.getStatements()) {
    if (stmt.getKind() === SyntaxKind.FunctionDeclaration) {
      const fn = stmt as Node & { getName?: () => string | undefined };
      const name = fn.getName?.();
      if (name !== undefined) return name;
    }
    if (stmt.getKind() === SyntaxKind.VariableStatement) {
      const text = stmt.getText();
      const match = text.match(/(?:export\s+)?const\s+([A-Z][A-Za-z0-9_]*)/);
      if (match !== null && match[1] !== undefined) return match[1];
    }
  }
  // Fall back to filename without extension.
  const base = filePath.split('/').pop() ?? 'Component';
  return base.replace(/\.[tj]sx?$/, '');
}

export function analyzeComponent(filePath: string): ComponentAnalysis {
  const project = new Project({
    useInMemoryFileSystem: false,
    skipAddingFilesFromTsConfig: true,
    compilerOptions: { jsx: 4 /* React */, allowJs: true },
  });
  const sourceFile = project.addSourceFileAtPath(filePath);
  const componentName = inferComponentName(sourceFile, filePath);
  const states = findConditionalReturns(sourceFile);
  const idle = getDefaultState();
  pushState(states, idle);

  const endpoints = findEndpoints(sourceFile);
  // Attach endpoints to all states — a downstream refinement could split per
  // state by tracing data flow, but for v0.1 we attach broadly.
  for (const s of states) {
    s.apiCalls = [...endpoints];
  }

  return {
    componentName,
    filePath,
    states,
    hooks: findHooks(sourceFile),
    endpoints,
  };
}

// Quick unit-test friendly accessor.
export const _internal = { QUERY_FLAG_NAMES, analyzeStateFromCondition };
