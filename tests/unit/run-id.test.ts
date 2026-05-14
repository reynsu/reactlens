import { describe, expect, it } from 'vitest';
import { generateRunId } from '../../src/utils/run-id';

describe('generateRunId', () => {
  it('returns a filesystem-safe sortable id with timestamp + 8-hex suffix', () => {
    const id = generateRunId(new Date('2026-05-14T15:30:22.123Z'));
    expect(id).toMatch(/^2026-05-14T15-30-22-123Z-[0-9a-f]{8}$/);
  });

  it('returns lexicographically-ordered ids when called in chronological order', () => {
    const earlier = generateRunId(new Date('2026-01-01T00:00:00.000Z'));
    const later = generateRunId(new Date('2026-12-31T23:59:59.999Z'));
    expect(earlier < later).toBe(true);
  });

  it('returns unique ids when called twice with the same Date', () => {
    const t = new Date('2026-05-14T15:30:22.123Z');
    expect(generateRunId(t)).not.toBe(generateRunId(t));
  });

  it('produces a directory-safe string (no colons, no dots, no slashes)', () => {
    const id = generateRunId();
    expect(id).not.toMatch(/[:./\\]/);
  });
});
