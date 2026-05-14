import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    projects: [
      {
        test: {
          name: 'unit',
          include: ['tests/unit/**/*.test.ts'],
        },
      },
      {
        test: {
          name: 'integration',
          include: ['tests/integration/**/*.test.ts'],
          testTimeout: 60_000,
          // Every integration file spawns reactlens, which binds the
          // dashboard server to a fixed port (7777) and writes into the
          // fixtures' .reactlens/runs/. Running files in parallel causes
          // port collisions and racing fixture state — force serial.
          fileParallelism: false,
        },
      },
      {
        test: {
          name: 'eval',
          include: ['tests/diagnostic-eval/**/*.test.ts'],
          testTimeout: 120_000,
        },
      },
    ],
  },
});
