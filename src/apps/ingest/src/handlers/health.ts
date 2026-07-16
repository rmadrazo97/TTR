/**
 * GET /health — a cheap liveness probe. Does NOT touch Postgres/S3/SMTP so it stays fast
 * and dependency-free (the compose healthchecks and the extraction worker can poll it).
 */
export interface HealthBody {
  status: 'ok';
  service: '@ttr/ingest';
  time: string;
}

export function health(): HealthBody {
  return { status: 'ok', service: '@ttr/ingest', time: new Date().toISOString() };
}
