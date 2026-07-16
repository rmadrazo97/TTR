/**
 * Shared-password Basic-Auth middleware (POC only — PRD 04 §5.1).
 *
 * A single shared credential gates the whole console; there are no per-user accounts
 * in the POC (one asesor + ops). Credentials come from env; sensible dev defaults so
 * the app runs offline. NOT for production — this is deliberately minimal.
 */
import type { MiddlewareHandler } from 'hono';

const USER = process.env.CONSOLE_USER ?? 'asesor';
const PASS = process.env.CONSOLE_PASSWORD ?? 'ttr_dev_pw';

/** Constant-time-ish equality (length-independent short-circuit avoided). */
function eq(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

export const basicAuth: MiddlewareHandler = async (c, next) => {
  const header = c.req.header('Authorization') ?? '';
  const m = /^Basic\s+(.+)$/i.exec(header);
  if (m) {
    let decoded = '';
    try {
      decoded = Buffer.from(m[1]!, 'base64').toString('utf8');
    } catch {
      decoded = '';
    }
    const idx = decoded.indexOf(':');
    const user = idx === -1 ? decoded : decoded.slice(0, idx);
    const pass = idx === -1 ? '' : decoded.slice(idx + 1);
    if (eq(user, USER) && eq(pass, PASS)) {
      return next();
    }
  }
  return c.body('Autenticación requerida', 401, {
    'WWW-Authenticate': 'Basic realm="TTR Consola", charset="UTF-8"',
  });
};
