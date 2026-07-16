import { describe, it, expect, vi } from 'vitest';

// metrics.ts imports `query` from @ttr/core at module load; stub it so importing the
// module never touches a real database. The pure functions under test don't use it.
vi.mock('@ttr/core', () => ({ query: vi.fn(async () => []) }));

const { normaliseField, scoreExtraction, median, SCORED_FIELDS } = await import('../metrics.js');

describe('normaliseField', () => {
  it('rounds money to cents', () => {
    expect(normaliseField('gross', 100)).toBe('100.00');
    expect(normaliseField('vat', '21')).toBe('21.00');
  });
  it('date takes the ISO date prefix', () => {
    expect(normaliseField('date', '2026-05-01T00:00:00Z')).toBe('2026-05-01');
  });
  it('vatId strips spaces + upper-cases', () => {
    expect(normaliseField('vatId', 'fr 123 45')).toBe('FR12345');
  });
  it('blank/absent -> null', () => {
    expect(normaliseField('vatId', '')).toBeNull();
    expect(normaliseField('gross', null)).toBeNull();
  });
});

describe('scoreExtraction', () => {
  it('counts a confirmed-correct extraction as no edits', () => {
    const fields = { vatId: 'FR123', date: '2026-05-01', gross: 100, vat: 21 };
    const { correct, edited } = scoreExtraction(fields, { ...fields });
    expect(edited).toBe(false);
    for (const f of SCORED_FIELDS) expect(correct[f]).toBe(true);
  });
  it('flags edited fields and normalises formatting differences as correct', () => {
    const fields = { vatId: 'fr 123', date: '2026-05-01', gross: 100.0, vat: 21 };
    const corrected = { vatId: 'FR123', date: '2026-05-01', gross: 100, vat: 22 }; // vat edited
    const { correct, edited } = scoreExtraction(fields, corrected);
    expect(correct.vatId).toBe(true); // cosmetic formatting normalised
    expect(correct.gross).toBe(true);
    expect(correct.vat).toBe(false); // real edit
    expect(edited).toBe(true);
  });
});

describe('median', () => {
  it('odd + even + empty', () => {
    expect(median([1, 3, 2])).toBe(2);
    expect(median([1, 2, 3, 4])).toBe(2.5);
    expect(median([])).toBeNull();
  });
});
