// Diagnostic harness for the shallow-snapshot bug.
// Walks the React fiber tree DIRECTLY via DevTools hook to compare against
// what serializeFiber sees. Uses a string-form page.evaluate to dodge tsx's
// transpilation polyfills.
import { chromium } from '@playwright/test';

async function main(): Promise<void> {
  const url = process.argv[2];
  if (url === undefined) {
    console.error('usage: tsx scripts/probe-debug.ts <url>');
    process.exit(2);
  }

  const browser = await chromium.launch();
  const ctx = await browser.newContext();
  const page = await ctx.newPage();
  page.on('console', (m) => console.log(`[browser ${m.type()}]`, m.text()));

  await page.goto(url);
  await page.waitForLoadState('networkidle');
  await page.waitForTimeout(500);

  // Body of the evaluate as a plain string — no transpilation, no __name.
  const body = `(() => {
    function nameOf(f) {
      var t = f.type !== undefined && f.type !== null ? f.type : f.elementType;
      if (t === null || t === undefined) return '<root>';
      if (typeof t === 'string') return t;
      if (typeof t === 'symbol') return 'Symbol(' + t.toString() + ')';
      if (typeof t === 'function') return t.displayName || t.name || '<fn>';
      if (t._context !== undefined) return 'Context(' + (t._context.displayName || '?') + ')';
      if (t.render !== undefined) return 'ForwardRef(' + ((t.render && t.render.name) || '?') + ')';
      if (t.type !== undefined) return 'Memo(' + (typeof t.type === 'function' ? (t.type.name || '?') : '?') + ')';
      if (t.displayName !== undefined) return t.displayName;
      return '<unknown>';
    }
    function walk(f, depth, accum) {
      var name = nameOf(f);
      var hasChild = !!f.child;
      var hasSibling = !!f.sibling;
      var altHasChild = !!(f.alternate && f.alternate.child);
      accum.push((depth > 0 ? new Array(depth + 1).join('  ') : '') + name +
        ' child=' + (hasChild ? 'Y' : 'N') +
        ' altChild=' + (altHasChild ? 'Y' : 'N') +
        ' sib=' + (hasSibling ? 'Y' : 'N'));
      var c = f.child || null;
      while (c !== null) { walk(c, depth + 1, accum); c = c.sibling || null; }
    }
    function find(f, name) {
      if (nameOf(f) === name) return f;
      var c = f.child || null;
      while (c !== null) { var h = find(c, name); if (h) return h; c = c.sibling || null; }
      return null;
    }

    var hook = window.__REACT_DEVTOOLS_GLOBAL_HOOK__;
    if (!hook) return { error: 'no devtools hook' };
    var rendererIds = hook.renderers ? Array.from(hook.renderers.keys()) : [];
    var roots = [];
    for (var i = 0; i < rendererIds.length; i++) {
      var id = rendererIds[i];
      var set = hook.getFiberRoots && hook.getFiberRoots(id);
      if (set) set.forEach(function (r) { roots.push(r); });
    }

    var result = { rendererIds: rendererIds, rootCount: roots.length, dumps: [] };
    for (var j = 0; j < roots.length; j++) {
      var root = roots[j];
      var lines = [];
      walk(root.current, 0, lines);
      var qcp = find(root.current, 'QueryClientProvider');
      var qcpInfo = null;
      if (qcp) {
        qcpInfo = {
          hasChild: !!qcp.child,
          childName: qcp.child ? nameOf(qcp.child) : null,
          altHasChild: !!(qcp.alternate && qcp.alternate.child),
          altChildName: qcp.alternate && qcp.alternate.child ? nameOf(qcp.alternate.child) : null,
          memoizedPropsKeys: qcp.memoizedProps ? Object.keys(qcp.memoizedProps) : []
        };
        if (qcp.child) {
          var ctxFiber = qcp.child;
          qcpInfo.contextChildName = nameOf(ctxFiber);
          qcpInfo.contextHasChild = !!ctxFiber.child;
          qcpInfo.contextAltHasChild = !!(ctxFiber.alternate && ctxFiber.alternate.child);
          if (ctxFiber.child) qcpInfo.contextChildOfContext = nameOf(ctxFiber.child);
          if (ctxFiber.alternate && ctxFiber.alternate.child) qcpInfo.contextAltChildOfContext = nameOf(ctxFiber.alternate.child);
        }
      }
      result.dumps.push({ tree: lines.join('\\n'), qcpInfo: qcpInfo });
    }
    return result;
  })()`;

  const report: any = await page.evaluate(body);

  console.log('rendererIds:', report.rendererIds);
  console.log('rootCount:', report.rootCount);
  for (var i = 0; i < (report.dumps || []).length; i++) {
    console.log('=== ROOT ' + i + ' QueryClientProvider info ===');
    console.log(JSON.stringify(report.dumps[i].qcpInfo, null, 2));
    console.log('=== ROOT ' + i + ' tree (truncated to first 60 lines) ===');
    console.log(report.dumps[i].tree.split('\n').slice(0, 60).join('\n'));
  }

  await browser.close();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
