import { describe, it, expect } from 'vitest';
import {
  eur,
  pct,
  shortDate,
  parseMoney,
  parseIntOrNull,
  nullIfBlank,
  daysUntil,
  confBucket,
} from '../fmt.js';

describe('parseMoney', () => {
  it('parses plain and es-ES formats', () => {
    expect(parseMoney('1234.56')).toBe(1234.56);
    expect(parseMoney('1.234,56')).toBe(1234.56); // es-ES thousands '.' decimal ','
    expect(parseMoney('1,234.56')).toBe(1234.56); // en thousands ',' decimal '.'
    expect(parseMoney('€ 1.000,00')).toBe(1000);
    expect(parseMoney('42,5')).toBe(42.5); // lone comma = decimal
  });
  it('returns null for blank / unparseable', () => {
    expect(parseMoney('')).toBeNull();
    expect(parseMoney('   ')).toBeNull();
    expect(parseMoney(null)).toBeNull();
    expect(parseMoney(undefined)).toBeNull();
    expect(parseMoney('abc')).toBeNull();
  });
});

describe('parseIntOrNull / nullIfBlank', () => {
  it('parseIntOrNull', () => {
    expect(parseIntOrNull('45')).toBe(45);
    expect(parseIntOrNull('')).toBeNull();
    expect(parseIntOrNull('x')).toBeNull();
  });
  it('nullIfBlank trims and blanks', () => {
    expect(nullIfBlank('  FR12  ')).toBe('FR12');
    expect(nullIfBlank('   ')).toBeNull();
    expect(nullIfBlank(undefined)).toBeNull();
  });
});

describe('formatters', () => {
  it('eur formats and handles null', () => {
    expect(eur(null)).toBe('—');
    // ICU-robust: assert decimal comma and € symbol rather than the thousands dot
    // (es-ES minimumGroupingDigits=2 suppresses the separator for 4-digit integers).
    expect(eur('1234.5')).toContain('234,50');
    expect(eur('1234.5')).toContain('€');
    // 5+ digit integer parts DO group: 12345.6 → '12.345,60 €'
    expect(eur('12345.6')).toContain('12.345');
    expect(typeof eur(10)).toBe('string');
  });
  it('pct 0..1', () => {
    expect(pct(0.923)).toBe('92%');
    expect(pct(null)).toBe('—');
  });
  it('shortDate slices ISO', () => {
    expect(shortDate('2026-07-16T10:00:00Z')).toBe('2026-07-16');
    expect(shortDate(null)).toBe('—');
  });
});

describe('daysUntil / confBucket', () => {
  it('daysUntil counts forward days', () => {
    const from = new Date('2026-09-01T00:00:00Z');
    const to = new Date('2026-09-30T00:00:00Z');
    expect(daysUntil(to, from)).toBe(29);
  });
  it('confBucket thresholds', () => {
    expect(confBucket(0.9)).toBe('high');
    expect(confBucket(0.7)).toBe('mid');
    expect(confBucket(0.3)).toBe('low');
    expect(confBucket(null)).toBe('none');
  });
});
