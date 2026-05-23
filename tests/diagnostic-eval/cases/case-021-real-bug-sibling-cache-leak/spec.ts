import { expect, test } from '@playwright/test'

// Two <InvoiceFields> siblings on the same page, each driven by its own
// useSuspenseQuery(invoiceQueryOptions(id)). When the queryKey carries the
// id discriminator (correct), each pane loads its own invoice. When the
// discriminator is missing (planted regression), both panes share a single
// cache entry and render whichever invoice resolved first — the bug is
// only visible at runtime by inspecting the component tree, not by reading
// the InvoiceFields source.
//
// Used by reactlens corpus harvest to produce a snapshot-distinguishable
// eval case. See reactlens/harvest-corpus.json entry
// `tanstack-router-kitchen-sink-cache-leak`.

test.beforeEach(async ({ page }) => {
  await page.goto('/dashboard/invoices-compare/1/2')
})

test('Compare view shows invoice 1 in pane A and invoice 2 in pane B', async ({
  page,
}) => {
  const paneA = page.getByTestId('invoice-pane-a')
  const paneB = page.getByTestId('invoice-pane-b')

  await expect(paneA.locator('input[name="title"]')).toHaveValue('Invoice 1')
  await expect(paneB.locator('input[name="title"]')).toHaveValue('Invoice 2')
})
