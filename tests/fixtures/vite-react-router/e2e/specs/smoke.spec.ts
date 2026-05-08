import { test, expect } from '@playwright/test';

test('reporter smoke', async () => {
  await test.step('arithmetic', async () => {
    expect(1 + 1).toBe(2);
  });
});
