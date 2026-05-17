// Built-in plugin reactlens registers by default. Wraps BrowserPreview as
// the renderer for `source === 'web'`. Hosts that consume the dashboard pass
// `[builtinWebPlugin, ...theirOwnPlugins]` to keep web frames working while
// adding their own (eg nativelens prepends a plugin for `source === 'native'`).
//
// Lives inside `src/dashboard/web/` so its React-component import is JSX-
// scoped. The pure resolver + types live one level up at `../plugins.ts`.
import type { DashboardPlugin } from '../plugins';
import { BrowserPreview } from './components/BrowserPreview';

export const builtinWebPlugin: DashboardPlugin = {
  name: 'reactlens-web',
  frameRenderers: { web: BrowserPreview },
};
