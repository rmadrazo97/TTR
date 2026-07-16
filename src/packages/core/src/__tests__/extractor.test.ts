import { describe, it, expect } from 'vitest';
import { MockExtractor, LlmVisionExtractor, makeExtractor } from '../extractor.js';

const input = (filename: string) => ({
  buffer: Buffer.from('synthetic'),
  mime: 'image/jpeg',
  filename,
});

describe('MockExtractor determinism', () => {
  it('returns identical output for the same filename', async () => {
    const ex = new MockExtractor();
    const a = await ex.extract(input('receipt-fr-001.jpg'));
    const b = await ex.extract(input('receipt-fr-001.jpg'));
    expect(a).toEqual(b);
  });

  it('returns different fields for different filenames', async () => {
    const ex = new MockExtractor();
    const a = await ex.extract(input('receipt-fr-001.jpg'));
    const b = await ex.extract(input('receipt-de-002.jpg'));
    expect(a.fields).not.toEqual(b.fields);
  });

  it('always produces the 4 key fields plus context', async () => {
    const ex = new MockExtractor();
    const { fields, confidence, model } = await ex.extract(input('fuelcard-jan.pdf'));
    expect(typeof fields.vatId).toBe('string');
    expect(typeof fields.date).toBe('string');
    expect(typeof fields.gross).toBe('number');
    expect(typeof fields.vat).toBe('number');
    expect(fields.currency).toBe('EUR');
    expect(typeof fields.country).toBe('string');
    expect(typeof fields.supplier).toBe('string');
    expect(typeof fields.category).toBe('string');
    expect(model).toBe('mock-vision-0');
    // confidence: overall + a per-field map covering the 4 scored fields
    expect(confidence.overall).toBeGreaterThan(0);
    expect(confidence.overall).toBeLessThanOrEqual(1);
    for (const f of ['vatId', 'date', 'gross', 'vat']) {
      expect(confidence.perField[f]).toBeGreaterThan(0);
    }
  });

  it('produces an ISO date in 2025 and a VAT amount below the gross', async () => {
    const ex = new MockExtractor();
    const { fields } = await ex.extract(input('receipt-it-toll.png'));
    expect(fields.date).toMatch(/^2025-\d{2}-\d{2}$/);
    expect(fields.vat!).toBeLessThan(fields.gross!);
  });

  it('does not fabricate fields for an illegible image', async () => {
    const ex = new MockExtractor();
    const { fields, confidence } = await ex.extract(input('illegible-blur.jpg'));
    expect(fields).toEqual({});
    expect(confidence.overall).toBeLessThan(0.5);
  });
});

describe('makeExtractor factory', () => {
  it('returns a MockExtractor when extractionMock is true', () => {
    const ex = makeExtractor({ extractionMock: true, llmApiKey: '' });
    expect(ex).toBeInstanceOf(MockExtractor);
  });

  it('returns an LlmVisionExtractor when extractionMock is false', () => {
    const ex = makeExtractor({ extractionMock: false, llmApiKey: 'sk-test' });
    expect(ex).toBeInstanceOf(LlmVisionExtractor);
  });

  it('LlmVisionExtractor throws clearly with no key', async () => {
    const ex = new LlmVisionExtractor('');
    await expect(ex.extract(input('x.jpg'))).rejects.toThrow(/LLM_API_KEY/);
  });
});
