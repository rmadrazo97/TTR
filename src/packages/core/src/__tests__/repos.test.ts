import { describe, it, expect, vi, beforeEach } from 'vitest';

// Shared capture state, created via vi.hoisted so it exists before the hoisted vi.mock
// factory runs (vitest hoists vi.mock above imports).
const h = vi.hoisted(() => {
  const calls: Array<{ sql: string; params?: readonly unknown[] }> = [];
  const state = { nextRows: [] as unknown[] };
  return { calls, state };
});

vi.mock('../db.js', () => ({
  query: vi.fn(async (sql: string, params?: readonly unknown[]) => {
    h.calls.push({ sql, params });
    return h.state.nextRows;
  }),
  getPool: vi.fn(),
  withTx: vi.fn(),
}));

// Import AFTER the mock is registered.
const { claims } = await import('../repos/claims.js');
const { metrics } = await import('../repos/metrics.js');
const { documents } = await import('../repos/documents.js');
const { query: queryMock } = (await import('../db.js')) as unknown as {
  query: ReturnType<typeof vi.fn>;
};

const lastSql = () => h.calls[h.calls.length - 1]!.sql.replace(/\s+/g, ' ').trim();
const lastParams = () => h.calls[h.calls.length - 1]!.params!;

beforeEach(() => {
  h.calls.length = 0;
  h.state.nextRows = [];
  queryMock.mockClear();
  // default implementation (some tests override per-call)
  queryMock.mockImplementation(async (sql: string, params?: readonly unknown[]) => {
    h.calls.push({ sql, params });
    return h.state.nextRows;
  });
});

describe('claims.update — partial patch SQL', () => {
  it('only writes the keys present on the patch', async () => {
    h.state.nextRows = [{ id: 'c1' }];
    await claims.update('c1', { status: 'ready', recoverable_eur: 1234.5 });
    const sql = lastSql();
    const params = lastParams();

    expect(sql).toContain('update claim set');
    expect(sql).toContain('where id = $1');
    expect(sql).not.toContain('country');

    // claims.update applies patch keys in declaration order:
    // type, disposition, country, period, document_ids, recoverable_eur, asesor_minutes, status, ...
    // So with { recoverable_eur, status } the emit order is recoverable_eur=$2 then status=$3.
    expect(sql).toContain('recoverable_eur = $2');
    expect(sql).toContain('status = $3');
    expect(params).toEqual(['c1', 1234.5, 'ready']);
  });

  it('throws on an empty patch (never issues a no-op UPDATE)', async () => {
    await expect(claims.update('c1', {})).rejects.toThrow(/empty patch/);
  });
});

describe('claims.create — defaults and array coercion', () => {
  it('passes carrier/type/disposition and defaults document_ids to empty', async () => {
    h.state.nextRows = [{ id: 'c2' }];
    await claims.create({
      carrier_id: 'carrier-1',
      type: 'foreign_vat',
      disposition: 'file',
    });
    const sql = lastSql();
    expect(sql).toContain('insert into claim');
    expect(sql).toContain("coalesce($6::uuid[], '{}')");
    const p = lastParams();
    expect(p[0]).toBe('carrier-1');
    expect(p[1]).toBe('foreign_vat');
    expect(p[2]).toBe('file');
  });
});

describe('documents.insert — dedupe semantics', () => {
  it('reports created:true when the insert returns a row', async () => {
    h.state.nextRows = [{ id: 'd1', message_id: 'm1', attachment_index: 0 }];
    const res = await documents.insert({ r2_key: 'k', message_id: 'm1' });
    expect(res.created).toBe(true);
    expect(lastSql()).toContain('on conflict (message_id, attachment_index) do nothing');
  });

  it('reports created:false and returns the existing row on conflict', async () => {
    const existing = { id: 'd1', message_id: 'm1', attachment_index: 0 };
    // First call (insert) returns no rows → conflict; second call (select) returns the row.
    queryMock.mockImplementationOnce(async (sql: string, params?: readonly unknown[]) => {
      h.calls.push({ sql, params });
      return [];
    });
    queryMock.mockImplementationOnce(async (sql: string, params?: readonly unknown[]) => {
      h.calls.push({ sql, params });
      return [existing];
    });
    const res = await documents.insert({ r2_key: 'k', message_id: 'm1' });
    expect(res.created).toBe(false);
    expect(res.document).toEqual(existing);
  });
});

describe('metrics.emit — refs mapping', () => {
  it('maps ref ids to positional params and json-encodes payload', async () => {
    await metrics.emit('extraction_done', { documentId: 'doc-1' }, { model: 'mock-vision-0' });
    const sql = lastSql();
    expect(sql).toContain('insert into metric_event');
    const p = lastParams();
    expect(p[0]).toBe('extraction_done');
    expect(p[3]).toBe('doc-1'); // document_id column
    expect(p[5]).toBe(JSON.stringify({ model: 'mock-vision-0' }));
  });
});
