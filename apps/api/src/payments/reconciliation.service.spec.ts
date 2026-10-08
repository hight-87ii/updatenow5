import { BadRequestException } from '@nestjs/common';
import { PaymentStatus } from '@prisma/client';
import type { PrismaService } from '../prisma/prisma.service.js';
import {
  parseStatementCsv,
  ReconciliationService,
} from './reconciliation.service.js';

describe('S-51 payment reconciliation', () => {
  const from = '2026-10-01T00:00:00.000Z';
  const to = '2026-11-01T00:00:00.000Z';

  it('parses gateway statement CSV and rejects duplicate transaction ids', () => {
    expect(
      parseStatementCsv('transactionId,amount\n"tx,quoted",1000\ntx2,0'),
    ).toEqual([
      { transactionId: 'tx,quoted', amount: 1000, rowNumber: 2 },
      { transactionId: 'tx2', amount: 0, rowNumber: 3 },
    ]);
    expect(() =>
      parseStatementCsv('transactionId,amount\ntx1,100\ntx1,100'),
    ).toThrow(BadRequestException);
  });

  it('reports matched, system-only, statement-only and amount mismatch rows', async () => {
    const db = {
      payment: {
        findMany: vi.fn().mockResolvedValue([
          {
            id: 'pay-match',
            orderId: 'order-match',
            amount: 100000,
            transactionId: 'tx-match',
          },
          {
            id: 'pay-mismatch',
            orderId: 'order-mismatch',
            amount: 200000,
            transactionId: 'tx-mismatch',
          },
          {
            id: 'pay-system-only',
            orderId: 'order-system-only',
            amount: 300000,
            transactionId: 'tx-system-only',
          },
        ]),
      },
    };
    const service = new ReconciliationService(db as unknown as PrismaService);

    const result = await service.reconcile({
      gateway: 'momo',
      from,
      to,
      csv: [
        'transactionId,amount',
        'tx-match,100000',
        'tx-mismatch,250000',
        'tx-statement-only,400000',
      ].join('\n'),
    });

    expect(db.payment.findMany).toHaveBeenCalledWith({
      where: {
        gateway: 'momo',
        status: PaymentStatus.SUCCEEDED,
        transactionId: { not: null },
        updatedAt: { gte: new Date(from), lt: new Date(to) },
      },
      select: {
        id: true,
        orderId: true,
        amount: true,
        transactionId: true,
      },
      orderBy: [{ updatedAt: 'asc' }, { id: 'asc' }],
    });
    expect(result.totals).toEqual({
      statementRows: 3,
      systemRows: 3,
      matched: 1,
      amountMismatches: 1,
      systemOnly: 1,
      statementOnly: 1,
    });
    expect(result.matched).toEqual([
      {
        transactionId: 'tx-match',
        amount: 100000,
        paymentId: 'pay-match',
        orderId: 'order-match',
      },
    ]);
    expect(result.amountMismatches).toEqual([
      {
        transactionId: 'tx-mismatch',
        systemAmount: 200000,
        statementAmount: 250000,
        paymentId: 'pay-mismatch',
        orderId: 'order-mismatch',
      },
    ]);
    expect(result.systemOnly[0].transactionId).toBe('tx-system-only');
    expect(result.statementOnly).toEqual([
      { transactionId: 'tx-statement-only', amount: 400000, rowNumber: 4 },
    ]);
  });

  it('validates period, gateway and CSV shape before querying payments', async () => {
    const db = { payment: { findMany: vi.fn() } };
    const service = new ReconciliationService(db as unknown as PrismaService);
    await expect(
      service.reconcile({ gateway: '../bad', from, to, csv: 'transactionId,amount\na,1' }),
    ).rejects.toThrow(BadRequestException);
    await expect(
      service.reconcile({ gateway: 'momo', from: to, to: from, csv: 'transactionId,amount\na,1' }),
    ).rejects.toThrow(BadRequestException);
    await expect(
      service.reconcile({ gateway: 'momo', from, to, csv: 'id,total\na,1' }),
    ).rejects.toThrow(BadRequestException);
    expect(db.payment.findMany).not.toHaveBeenCalled();
  });
});
