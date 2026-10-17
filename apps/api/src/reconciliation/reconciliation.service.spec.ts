import { ReconciliationService } from './reconciliation.service.js';

const payment = (transactionId: string, amount: number) => ({
  id: `${transactionId}-payment`, transactionId, gatewayRef: `${transactionId}-ref`, amount,
});

describe('S-51 reconciliation', () => {
  it('classifies matched, system-only, provider-only and amount mismatch rows', async () => {
    const db = {
      payment: { findMany: async () => [payment('TX-MATCH', 100), payment('TX-SYSTEM', 200), payment('TX-DIFF', 300)] },
      reconciliationRun: {
        create: async ({ data }: any) => ({ ...data, id: 'run-1', createdAt: new Date(), lines: data.lines.create }),
      },
    };
    const service = new ReconciliationService(db as never);
    const result = await service.create('accountant-1', {
      provider: 'momo', fileName: 'statement.csv', periodStart: '2026-01-01', periodEnd: '2026-02-01',
      content: 'transaction_id,amount,gateway_ref\nTX-MATCH,100,REF-M\nTX-DIFF,350,REF-D\nTX-PROVIDER,400,REF-P',
    });
    expect(result.counts).toEqual({ MATCHED: 1, SYSTEM_ONLY: 1, PROVIDER_ONLY: 1, AMOUNT_MISMATCH: 1 });
    expect(result.total).toBe(4);
  });

  it('rejects missing columns, malformed amount and duplicate transaction IDs', async () => {
    const db = { payment: { findMany: async () => [] }, reconciliationRun: { create: async () => { throw new Error('must not write'); } } };
    const service = new ReconciliationService(db as never);
    for (const content of [
      'id,total\nTX-1,100',
      'transaction_id,amount\nTX-1,abc',
      'transaction_id,amount\nTX-1,100\nTX-1,100',
    ]) {
      await expect(service.create('accountant-1', { provider: 'momo', fileName: 'bad.csv', periodStart: '2026-01-01', periodEnd: '2026-02-01', content })).rejects.toThrow();
    }
  });

  it('rejects an invalid period before reading or writing the statement', async () => {
    const service = new ReconciliationService({ payment: { findMany: vi.fn() }, reconciliationRun: { create: vi.fn() } } as never);
    await expect(service.create('accountant-1', { provider: 'momo', fileName: 'statement.csv', periodStart: '2026-02-01', periodEnd: '2026-01-01', content: 'transaction_id,amount\nTX-1,100' })).rejects.toThrow();
  });
});
