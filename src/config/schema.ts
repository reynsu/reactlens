import { z } from 'zod';

// `withDefault` lets a nested object schema accept `undefined` as input and
// fill in field-level defaults. Avoids having to repeat default values both at
// the leaves and at the parent.
function withDefault<T extends z.ZodTypeAny>(schema: T): z.ZodType<z.output<T>, z.input<T> | undefined> {
  return z.preprocess((v) => (v === undefined ? {} : v), schema) as z.ZodType<
    z.output<T>,
    z.input<T> | undefined
  >;
}

const outputSchema = z.object({
  pages: z.string().default('e2e/pages'),
  specs: z.string().default('e2e/specs'),
});

const mswSchema = z.object({
  handlers: z.string().default('src/mocks/handlers.ts'),
});

const dashboardSchema = z.object({
  port: z.number().int().min(1).max(65535).default(7777),
  open: z.boolean().default(true),
});

export const reactlensConfigSchema = z.object({
  componentGlobs: z
    .array(z.string())
    .default(['src/pages/**/*.tsx', 'src/components/**/*.tsx']),
  output: withDefault(outputSchema),
  msw: withDefault(mswSchema),
  dashboard: withDefault(dashboardSchema),
  // v0.3 slice 6 (ADR-0006): test pattern selection.
  //   - 'pom' (default): generated specs use Page Object Pattern, portable
  //     under plain Playwright without reactlens.
  //   - 'component-object': generated specs assert via Component(name).props,
  //     which requires reactlens at runtime. See docs/design/snapshot-accessor.md.
  pattern: z.enum(['pom', 'component-object']).default('pom'),
});

export type ReactLensConfig = z.infer<typeof reactlensConfigSchema>;
export type ReactLensConfigInput = z.input<typeof reactlensConfigSchema>;

// Helper users import from `reactlens/config` in their reactlens.config.ts.
// At runtime this is the identity function; the value is what TypeScript and
// Zod check against. Validation happens in loadConfig.
export function defineConfig(input: ReactLensConfigInput): ReactLensConfigInput {
  return input;
}
