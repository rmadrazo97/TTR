/**
 * The extraction seam (PRD 02). The automated intelligence in the POC is a single
 * step behind a small `Extractor` interface so the model swaps without rework.
 *
 * - {@link MockExtractor} — deterministic, offline. Produces plausible fields +
 *   calibrated-looking confidence keyed off the filename, so the whole pipeline runs
 *   with no API key (EXTRACTION_MOCK=true, the default POC path).
 * - {@link LlmVisionExtractor} — provider-agnostic guarded stub. Throws unless an
 *   LLM_API_KEY is present; the real vision call is MVP work. Kept behind the same
 *   interface so wiring a provider later is a localised change.
 */
import type { Config } from './config.js';
import type { ExtractionFields, Confidence } from './types.js';

export interface ExtractInput {
  buffer: Buffer;
  mime: string;
  filename: string;
}

export interface ExtractResult {
  fields: ExtractionFields;
  confidence: Confidence;
  model: string;
}

export interface Extractor {
  extract(input: ExtractInput): Promise<ExtractResult>;
}

// ---------------------------------------------------------------------------
// Deterministic helpers — all derived from the filename so runs are reproducible.
// ---------------------------------------------------------------------------

/** A small, stable 32-bit hash (FNV-1a) over a string. */
function hash32(s: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

/** Deterministic float in [min, max) from a seed + salt. */
function seededFloat(seed: number, salt: string, min: number, max: number): number {
  const h = hash32(`${seed}:${salt}`);
  return min + (h / 0xffffffff) * (max - min);
}

/** Round to 2 decimals. */
function money(n: number): number {
  return Math.round(n * 100) / 100;
}

/** Country + supplier catalogues so different filenames yield different, plausible data. */
const CATALOG = [
  { country: 'FR', supplier: 'TotalEnergies', vatPrefix: 'FR', rate: 0.2 },
  { country: 'DE', supplier: 'Aral', vatPrefix: 'DE', rate: 0.19 },
  { country: 'PT', supplier: 'Galp', vatPrefix: 'PT', rate: 0.23 },
  { country: 'IT', supplier: 'Eni', vatPrefix: 'IT', rate: 0.22 },
  { country: 'BE', supplier: 'Q8', vatPrefix: 'BE', rate: 0.21 },
] as const;

const CATEGORIES = ['fuel', 'toll', 'adblue'] as const;

function pick<T>(arr: readonly T[], seed: number, salt: string): T {
  const idx = hash32(`${seed}:${salt}`) % arr.length;
  return arr[idx] as T;
}

/** Format a YYYY-MM-DD date deterministically within the 2025 claim year. */
function seededDate(seed: number): string {
  const month = (hash32(`${seed}:month`) % 12) + 1; // 1..12
  const day = (hash32(`${seed}:day`) % 28) + 1; // 1..28 (safe for all months)
  const mm = String(month).padStart(2, '0');
  const dd = String(day).padStart(2, '0');
  return `2025-${mm}-${dd}`;
}

/**
 * Deterministic mock. Given a filename it returns the same fields + confidence every
 * time. It always produces the 4 key fields (vatId, date, gross, vat) plus
 * currency/country/supplier/category and an overall + per-field confidence. Filenames
 * containing "illegible", "blank", or "unknown" simulate an unreadable image: no
 * fabricated fields, low confidence + a reason (PRD 02 FR7).
 */
export class MockExtractor implements Extractor {
  readonly model = 'mock-vision-0';

  async extract(input: ExtractInput): Promise<ExtractResult> {
    const name = input.filename.toLowerCase();
    const seed = hash32(input.filename);

    // Simulate an illegible / non-receipt input: don't hallucinate fields.
    if (/illegible|blank|unknown|unreadable/.test(name)) {
      return {
        model: this.model,
        fields: {},
        confidence: {
          overall: 0.15,
          perField: { vatId: 0, date: 0, gross: 0, vat: 0 },
        },
      };
    }

    const entry = pick(CATALOG, seed, 'catalog');
    const category = pick(CATEGORIES, seed, 'category');

    const gross = money(seededFloat(seed, 'gross', 40, 900));
    const vat = money((gross * entry.rate) / (1 + entry.rate)); // VAT portion of a gross total
    const litres = category === 'fuel' ? money(seededFloat(seed, 'litres', 20, 600)) : undefined;
    const vatNumber = String(100000000 + (seed % 900000000));
    const vatId = `${entry.vatPrefix}${vatNumber}`;

    const fields: ExtractionFields = {
      vatId,
      date: seededDate(seed),
      gross,
      vat,
      currency: 'EUR',
      country: entry.country,
      supplier: entry.supplier,
      category,
      ...(litres !== undefined ? { litres } : {}),
    };

    // Confidence: high on the numeric fields the mock is sure of, a touch lower on the
    // format-sensitive VAT ID, all deterministic from the seed. Overall is the min of
    // the four scored fields (a wrong VAT ID must be able to drag the queue priority).
    const perField: Record<string, number> = {
      vatId: money(seededFloat(seed, 'c_vatId', 0.7, 0.95)),
      date: money(seededFloat(seed, 'c_date', 0.85, 0.99)),
      gross: money(seededFloat(seed, 'c_gross', 0.9, 0.99)),
      vat: money(seededFloat(seed, 'c_vat', 0.82, 0.97)),
      supplier: money(seededFloat(seed, 'c_supplier', 0.8, 0.98)),
      country: money(seededFloat(seed, 'c_country', 0.85, 0.99)),
    };
    const overall = money(
      Math.min(
        perField.vatId as number,
        perField.date as number,
        perField.gross as number,
        perField.vat as number,
      ),
    );

    return { model: this.model, fields, confidence: { overall, perField } };
  }
}

/**
 * Provider-agnostic guarded stub for the real vision path. Deliberately not
 * implemented in the POC: with no key it throws a clear error, so an app that
 * accidentally runs with EXTRACTION_MOCK=false and no LLM_API_KEY fails loudly
 * instead of silently. Wiring a concrete provider (e.g. an EU-DPA vision model)
 * is MVP work and lands here behind the unchanged {@link Extractor} interface.
 */
export class LlmVisionExtractor implements Extractor {
  readonly model: string;
  private readonly apiKey: string;
  constructor(apiKey: string, model = 'llm-vision') {
    this.apiKey = apiKey;
    this.model = model;
  }

  async extract(_input: ExtractInput): Promise<ExtractResult> {
    if (!this.apiKey) {
      throw new Error(
        '[@ttr/core extractor] LlmVisionExtractor requires LLM_API_KEY. ' +
          'Set EXTRACTION_MOCK=true to use the deterministic mock (default POC path).',
      );
    }
    throw new Error(
      '[@ttr/core extractor] LlmVisionExtractor is a guarded stub in the POC; ' +
        'the real vision call is MVP work. Use the MockExtractor for the POC.',
    );
  }
}

/**
 * Factory: return the {@link MockExtractor} when `cfg.extractionMock` is true (the
 * default POC path, no network), otherwise the {@link LlmVisionExtractor}.
 */
export function makeExtractor(cfg: Pick<Config, 'extractionMock' | 'llmApiKey'>): Extractor {
  return cfg.extractionMock ? new MockExtractor() : new LlmVisionExtractor(cfg.llmApiKey);
}
