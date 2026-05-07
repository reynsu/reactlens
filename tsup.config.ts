import { defineConfig } from 'tsup';

export default defineConfig([
  {
    entry: { cli: 'src/cli.ts' },
    format: ['cjs'],
    target: 'node20',
    platform: 'node',
    outDir: 'dist',
    clean: true,
    sourcemap: true,
    banner: { js: '#!/usr/bin/env node' },
  },
  {
    entry: { reporter: 'src/runner/reporter.ts' },
    format: ['cjs'],
    target: 'node20',
    platform: 'node',
    outDir: 'dist/runner',
    sourcemap: true,
  },
  {
    entry: { probe: 'src/component-bridge/probe.ts' },
    format: ['iife'],
    target: 'es2020',
    platform: 'browser',
    outDir: 'dist/probe',
    sourcemap: true,
    globalName: 'ReactLensProbe',
  },
]);
