// reactlens test fixture — extends Playwright's `test` with per-page
// instrumentation that's a no-op when REACTLENS_WS_URL is unset.
//
// Two things happen automatically per test:
//   1. The component-bridge probe is injected via addInitScript before any
//      page navigation, with __REACTLENS__/__REACTLENS_TEST__ globals so it
//      knows where to send snapshots.
//   2. A CDP screencast is started on the page, forwarding frames over the
//      same dashboard WS as `frame` events.
//
// USAGE in your specs:
//   import { test, expect } from '../reactlens/fixtures';
//
// You don't need to change anything else; `test`/`expect` here are the same
// types as `@playwright/test`, just augmented.
import { test as base, expect, type Page } from '@playwright/test';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import WebSocket from 'ws';

let cachedProbeSource: string | null | undefined;

function locateProbeBundle(): string | null {
  const candidates: string[] = [];
  // Highest priority: explicit override from the runner (used during reactlens
  // development when reactlens is not installed into the user's project).
  const override = process.env.REACTLENS_PROBE_PATH;
  if (override !== undefined && override.length > 0) candidates.push(override);
  try {
    const pkg = require.resolve('reactlens/package.json');
    candidates.push(join(dirname(pkg), 'dist', 'probe', 'probe.global.js'));
  } catch {
    /* not installed */
  }
  candidates.push(join(process.cwd(), 'node_modules', 'reactlens', 'dist', 'probe', 'probe.global.js'));
  for (const p of candidates) {
    try {
      readFileSync(p);
      return p;
    } catch {
      /* try next */
    }
  }
  return null;
}

function loadProbeSource(): string | null {
  if (cachedProbeSource !== undefined) return cachedProbeSource;
  const path = locateProbeBundle();
  cachedProbeSource = path !== null ? readFileSync(path, 'utf8') : null;
  return cachedProbeSource;
}

type FrameSocket = { send: (e: unknown) => void; close: () => void };

function openFrameSocket(wsUrl: string): FrameSocket {
  let socket: WebSocket | null = null;
  const buffer: unknown[] = [];

  function connect(): void {
    try {
      socket = new WebSocket(wsUrl);
    } catch {
      return;
    }
    socket.on('open', () => {
      while (buffer.length > 0) {
        const next = buffer.shift();
        if (next !== undefined) {
          try {
            socket?.send(JSON.stringify(next));
          } catch {
            /* ignore */
          }
        }
      }
    });
    socket.on('error', () => undefined);
    socket.on('close', () => {
      socket = null;
    });
  }
  connect();

  return {
    send(e: unknown): void {
      if (socket !== null && socket.readyState === WebSocket.OPEN) {
        try {
          socket.send(JSON.stringify(e));
        } catch {
          /* ignore */
        }
        return;
      }
      buffer.push(e);
    },
    close(): void {
      try {
        socket?.close();
      } catch {
        /* ignore */
      }
      socket = null;
    },
  };
}

// P12 part 2: capture the accessibility tree once at end-of-test and ship
// it as `a11y:snapshot` over the same probe socket.
//
// Playwright removed page.accessibility.snapshot() in 1.45+, so we call
// CDP's Accessibility.getFullAXTree directly and flatten the parent/child
// array into our nested AxNode shape. Wrapped in try/catch because CDP
// can fail on a closed page or in non-Chromium browsers.
type CdpAxValue = { type?: string; value?: unknown };
type CdpAxProp = { name: string; value: CdpAxValue };
type CdpAxNode = {
  nodeId: string;
  ignored?: boolean;
  role?: CdpAxValue;
  name?: CdpAxValue;
  value?: CdpAxValue;
  description?: CdpAxValue;
  properties?: CdpAxProp[];
  parentId?: string;
  childIds?: string[];
};

type AxNodeOut = {
  role: string;
  name?: string;
  value?: string | number;
  description?: string;
  disabled?: boolean;
  expanded?: boolean;
  focused?: boolean;
  modal?: boolean;
  multiline?: boolean;
  multiselectable?: boolean;
  readonly?: boolean;
  required?: boolean;
  selected?: boolean;
  checked?: boolean | 'mixed';
  pressed?: boolean | 'mixed';
  level?: number;
  valuemin?: number;
  valuemax?: number;
  autocomplete?: string;
  haspopup?: string;
  invalid?: string;
  orientation?: string;
  keyshortcuts?: string;
  roledescription?: string;
  valuetext?: string;
  children: AxNodeOut[];
};

// CDP property names we surface 1:1 onto our AxNode. Keep in sync with
// AxNode in src/runner/events.ts; unknown keys are dropped silently.
const KNOWN_AX_PROPS = new Set([
  'disabled', 'expanded', 'focused', 'modal', 'multiline', 'multiselectable',
  'readonly', 'required', 'selected', 'checked', 'pressed', 'level',
  'valuemin', 'valuemax', 'autocomplete', 'haspopup', 'invalid',
  'orientation', 'keyshortcuts', 'roledescription', 'valuetext',
]);

function cdpAxToTree(nodes: CdpAxNode[]): AxNodeOut | null {
  const byId = new Map<string, CdpAxNode>();
  for (const n of nodes) byId.set(n.nodeId, n);
  // Root = first non-ignored node without a parentId, or the first node
  // outright. CDP's getFullAXTree typically returns root first.
  let root: CdpAxNode | undefined = nodes.find((n) => n.parentId === undefined);
  if (root === undefined) root = nodes[0];
  if (root === undefined) return null;
  return convert(root, byId);
}

function convert(node: CdpAxNode, byId: Map<string, CdpAxNode>): AxNodeOut {
  const out: AxNodeOut = {
    role: typeof node.role?.value === 'string' ? node.role.value : 'unknown',
    children: [],
  };
  if (typeof node.name?.value === 'string') out.name = node.name.value;
  if (typeof node.value?.value === 'string' || typeof node.value?.value === 'number') {
    out.value = node.value.value;
  }
  if (typeof node.description?.value === 'string') out.description = node.description.value;
  for (const prop of node.properties ?? []) {
    if (!KNOWN_AX_PROPS.has(prop.name)) continue;
    const v = prop.value?.value;
    if (v !== undefined) (out as unknown as Record<string, unknown>)[prop.name] = v;
  }
  for (const childId of node.childIds ?? []) {
    const childCdp = byId.get(childId);
    if (childCdp !== undefined && childCdp.ignored !== true) {
      out.children.push(convert(childCdp, byId));
    }
  }
  return out;
}

// P13: run axe-core against the page at end-of-test, emit one event per
// violation. Resolves axe-core from reactlens' own install rather than the
// user's, so users don't have to add it as a dep themselves.
let cachedAxeSource: string | null | undefined;

function locateAxeSource(): string | null {
  if (cachedAxeSource !== undefined) return cachedAxeSource;
  // Highest priority: explicit path from the runner (set by reactlens-dev
  // when pnpm's strict isolation hides axe-core from require.resolve in
  // the integration suite). Published users get the require.resolve path
  // for free since axe-core is a regular dep of reactlens.
  const override = process.env.REACTLENS_AXE_PATH;
  if (override !== undefined && override.length > 0) {
    try {
      cachedAxeSource = readFileSync(override, 'utf8');
      return cachedAxeSource;
    } catch {
      /* fall through to require.resolve */
    }
  }
  try {
    cachedAxeSource = readFileSync(require.resolve('axe-core/axe.min.js'), 'utf8');
  } catch {
    cachedAxeSource = null;
  }
  return cachedAxeSource;
}

type AxeViolationNode = { target: string[] };
type AxeViolation = {
  id: string;
  impact: 'minor' | 'moderate' | 'serious' | 'critical' | null;
  description: string;
  help: string;
  helpUrl: string;
  nodes: AxeViolationNode[];
};

async function captureA11yViolations(page: Page, testId: string, frameSocket: FrameSocket): Promise<void> {
  const axeSource = locateAxeSource();
  if (axeSource === null) return;
  try {
    // Inject axe into the page if not already present, then run it. Using
    // page.evaluate(axeSource) is safe even if axe is already loaded — the
    // IIFE re-binds window.axe idempotently.
    await page.evaluate(axeSource);
    const result = await page.evaluate(async () =>
      (window as unknown as { axe: { run: () => Promise<{ violations: AxeViolation[] }> } }).axe.run(),
    );
    for (const v of result.violations) {
      frameSocket.send({
        t: 'a11y:violation',
        testId,
        stepId: testId,
        ruleId: v.id,
        impact: v.impact,
        description: v.description,
        help: v.help,
        helpUrl: v.helpUrl,
        targets: v.nodes.flatMap((n) => n.target),
      });
    }
  } catch {
    /* axe failed or page closed; treat as no violations */
  }
}

async function captureA11ySnapshot(page: Page, testId: string, frameSocket: FrameSocket): Promise<void> {
  let cdp: Awaited<ReturnType<Page['context']>['newCDPSession']> | null = null;
  try {
    cdp = await page.context().newCDPSession(page);
    await cdp.send('Accessibility.enable');
    // Walk the tree via getChildAXNodes so the CDP backend builds each level
    // on demand. getFullAXTree returned the root but its childIds came back
    // empty in real fixture contexts — likely a CDP+Chromium edge case
    // where the on-demand cache isn't populated until the protocol explicitly
    // descends. Manual descent forces the build.
    const rootResult = (await cdp.send('Accessibility.getRootAXNode')) as { node: CdpAxNode };
    const tree = await descendAx(cdp, rootResult.node);
    frameSocket.send({ t: 'a11y:snapshot', testId, stepId: testId, tree });
  } catch {
    /* CDP unavailable, page closed, or non-Chromium browser */
  } finally {
    try {
      await cdp?.detach();
    } catch {
      /* already detached */
    }
  }
}

type CdpSession = Awaited<ReturnType<Page['context']>['newCDPSession']>;

async function descendAx(cdp: CdpSession, node: CdpAxNode): Promise<AxNodeOut> {
  const out: AxNodeOut = {
    role: typeof node.role?.value === 'string' ? node.role.value : 'unknown',
    children: [],
  };
  if (typeof node.name?.value === 'string') out.name = node.name.value;
  if (typeof node.value?.value === 'string' || typeof node.value?.value === 'number') {
    out.value = node.value.value;
  }
  if (typeof node.description?.value === 'string') out.description = node.description.value;
  for (const prop of node.properties ?? []) {
    if (!KNOWN_AX_PROPS.has(prop.name)) continue;
    const v = prop.value?.value;
    if (v !== undefined) (out as unknown as Record<string, unknown>)[prop.name] = v;
  }
  try {
    const result = (await cdp.send('Accessibility.getChildAXNodes', { id: node.nodeId })) as {
      nodes: CdpAxNode[];
    };
    for (const child of result.nodes) {
      if (child.ignored === true) continue;
      out.children.push(await descendAx(cdp, child));
    }
  } catch {
    /* leaf or CDP refused — leave children empty */
  }
  return out;
}

async function attachScreencast(page: Page, testId: string, frameSocket: FrameSocket): Promise<() => Promise<void>> {
  const cdp = await page.context().newCDPSession(page);
  cdp.on('Page.screencastFrame', async (params: { data: string; sessionId: number }) => {
    frameSocket.send({ t: 'frame', testId, data: params.data, sessionId: String(params.sessionId) });
    try {
      await cdp.send('Page.screencastFrameAck', { sessionId: params.sessionId });
    } catch {
      /* page closed */
    }
  });
  try {
    await cdp.send('Page.startScreencast', { format: 'jpeg', quality: 60, maxWidth: 1280 });
  } catch {
    /* CDP unavailable, continue silently */
  }
  return async () => {
    try {
      await cdp.send('Page.stopScreencast');
    } catch {
      /* already stopped */
    }
    try {
      await cdp.detach();
    } catch {
      /* already detached */
    }
  };
}

export const test = base.extend<{ reactlens: void }>({
  reactlens: [
    async ({ page }, use, testInfo) => {
      const wsUrl = process.env.REACTLENS_WS_URL;
      if (wsUrl === undefined) {
        await use();
        return;
      }
      const probeSource = loadProbeSource();
      if (probeSource !== null) {
        await page.addInitScript(
          ({ wsUrl: url, testId }) => {
            (window as unknown as { __REACTLENS__: { wsUrl: string } }).__REACTLENS__ = { wsUrl: url };
            (window as unknown as { __REACTLENS_TEST__: { testId: string; stepId: string } }).__REACTLENS_TEST__ = {
              testId,
              stepId: testId,
            };
          },
          { wsUrl, testId: testInfo.testId },
        );
        await page.addInitScript({ content: probeSource });
      }
      const frameSocket = openFrameSocket(wsUrl);
      const detach = await attachScreencast(page, testInfo.testId, frameSocket);
      try {
        await use();
      } finally {
        // Capture a11y BEFORE detaching the CDP session — the page must
        // still be alive and the screencast still streaming so the WS has
        // an open path to the server. The send is buffered if the socket
        // is mid-handshake; the small 100 ms grace below gives the buffer
        // a chance to drain before close().
        await captureA11ySnapshot(page, testInfo.testId, frameSocket);
        await captureA11yViolations(page, testInfo.testId, frameSocket);
        await detach();
        await new Promise((r) => setTimeout(r, 100));
        frameSocket.close();
      }
    },
    { auto: true },
  ],
});

export { expect };
