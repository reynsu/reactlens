import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import * as ts from 'typescript';
import { describe, expect, it } from 'vitest';

const TEMPLATES_DIR = join(__dirname, '..', '..', 'templates');

describe('templates', () => {
  const files = readdirSync(TEMPLATES_DIR).filter((f) => f.endsWith('.ts'));

  it('finds template files', () => {
    expect(files).toEqual(
      expect.arrayContaining([
        'playwright.config.ts',
        'streaming-reporter.ts',
        'global-setup.ts',
        'reactlens.config.ts',
      ]),
    );
  });

  for (const f of files) {
    it(`${f} parses as valid TypeScript`, () => {
      const source = readFileSync(join(TEMPLATES_DIR, f), 'utf8');
      const result = ts.transpileModule(source, {
        compilerOptions: {
          target: ts.ScriptTarget.ES2022,
          module: ts.ModuleKind.ESNext,
          jsx: ts.JsxEmit.Preserve,
        },
        reportDiagnostics: true,
      });
      const syntactic = (result.diagnostics ?? []).filter(
        (d) => d.category === ts.DiagnosticCategory.Error,
      );
      expect(syntactic).toEqual([]);
    });
  }
});
