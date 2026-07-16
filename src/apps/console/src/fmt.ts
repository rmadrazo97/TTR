/**
 * Small formatting + parsing helpers for the console's server-rendered views and
 * form handlers. Kept dependency-free and pure so they're trivially unit-testable.
 */

/** Format a EUR amount (number | numeric-string | null) as e.g. "€1.234,56". */
export function eur(v: number | string | null | undefined): string {
  const n = typeof v === 'string' ? Number.parseFloat(v) : v;
  if (n === null || n === undefined || Number.isNaN(n)) return '—';
  return new Intl.NumberFormat('es-ES', {
    style: 'currency',
    currency: 'EUR',
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(n);
}

/** Format a percentage 0..1 (or null) as e.g. "92%". */
export function pct(v: number | null | undefined, digits = 0): string {
  if (v === null || v === undefined || Number.isNaN(v)) return '—';
  return `${(v * 100).toFixed(digits)}%`;
}

/** Short date (YYYY-MM-DD) from a Date (pg returns timestamptz as Date), ISO string, epoch, or null. */
export function shortDate(v: string | Date | number | null | undefined): string {
  if (v === null || v === undefined || v === '') return '—';
  if (v instanceof Date) return Number.isNaN(v.getTime()) ? '—' : v.toISOString().slice(0, 10);
  if (typeof v === 'number') {
    const d = new Date(v);
    return Number.isNaN(d.getTime()) ? '—' : d.toISOString().slice(0, 10);
  }
  return v.slice(0, 10);
}

/**
 * Parse a form-posted money string ("1234.56", "1.234,56", "€1,234.56", "") into a
 * number, or null if blank/unparseable. Tolerates both es-ES and plain formats by
 * stripping currency symbols/spaces and normalising the last separator as decimal.
 */
export function parseMoney(raw: string | undefined | null): number | null {
  if (raw === undefined || raw === null) return null;
  let s = String(raw).trim();
  if (s === '') return null;
  s = s.replace(/[€$\s]/g, '');
  if (!/^[0-9.,]+$/.test(s)) return null; // digits + separators only — no partial coercion
  const dots = (s.match(/\./g) || []).length;
  const commas = (s.match(/,/g) || []).length;
  if (dots > 0 && commas > 0) {
    // Both present: the LAST separator is the decimal; the other is the thousands grouping.
    if (s.lastIndexOf(',') > s.lastIndexOf('.')) {
      s = s.replace(/\./g, '').replace(',', '.'); // es-ES: 1.234,56
    } else {
      s = s.replace(/,/g, ''); // en: 1,234.56
    }
  } else if (commas > 0) {
    // Comma(s) only: several commas can only be thousands grouping; a single comma is the
    // es-ES decimal separator.
    s = commas > 1 ? s.replace(/,/g, '') : s.replace(',', '.');
  } else if (dots > 1) {
    // Several dots, no comma (e.g. "1.234.567"): ambiguous — REJECT rather than let
    // parseFloat silently truncate at the second dot.
    return null;
  }
  const n = Number.parseFloat(s);
  return Number.isNaN(n) || !Number.isFinite(n) ? null : n;
}

/** Parse an integer form field, or null when blank/unparseable. */
export function parseIntOrNull(raw: string | undefined | null): number | null {
  if (raw === undefined || raw === null) return null;
  const s = String(raw).trim();
  if (s === '') return null;
  const n = Number.parseInt(s, 10);
  return Number.isNaN(n) ? null : n;
}

/** Coerce a blank/whitespace-only form string to null; otherwise return trimmed. */
export function nullIfBlank(raw: string | undefined | null): string | null {
  if (raw === undefined || raw === null) return null;
  const s = String(raw).trim();
  return s === '' ? null : s;
}

/** Number of whole days from `from` until `to` (negative if past). */
export function daysUntil(to: Date, from: Date = new Date()): number {
  const ms = to.getTime() - from.getTime();
  return Math.ceil(ms / (1000 * 60 * 60 * 24));
}

/** Confidence colour bucket for UI cues. 0..1 or null. */
export function confBucket(v: number | null | undefined): 'high' | 'mid' | 'low' | 'none' {
  if (v === null || v === undefined || Number.isNaN(v)) return 'none';
  if (v >= 0.85) return 'high';
  if (v >= 0.6) return 'mid';
  return 'low';
}
