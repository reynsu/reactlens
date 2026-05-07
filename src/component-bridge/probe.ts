/// <reference lib="dom" />
/**
 * In-app probe injected into the user's React application. Stub for Phase 0;
 * real implementation in Phase 3. Bundled as a self-contained IIFE with no
 * external imports — must run in any browser context without module resolution.
 */
(() => {
  if (typeof window === 'undefined') return;
  // eslint-disable-next-line no-console
  console.log('[reactlens] probe loaded');
})();
