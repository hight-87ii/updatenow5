import { BadRequestException, Injectable } from '@nestjs/common';
import { PaymentStatus } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service.js';

export type StatementRow = {
  transactionId: string;
  amount: number;
  rowNumber: number;
};

export type ReconciliationRequest = {
  gateway?: unknown;
  from?: unknown;
  to?: unknown;
  csv?: unknown;
};

export type ReconciliationResult = {
  gateway: string;
  period: { from: string; to: string };
  totals: {
    statementRows: number;
    systemRows: number;
    matched: number;
    amountMismatches: number;
    systemOnly: number;
    statementOnly: number;
  };
  matched: Array<{
    transactionId: string;
    amount: number;
    paymentId: string;
    orderId: string;
  }>;
  amountMismatches: Array<{
    transactionId: string;
    systemAmount: number;
    statementAmount: number;
    paymentId: string;
    orderId: string;
  }>;
  systemOnly: Array<{
    transactionId: string;
    amount: number;
    paymentId: string;
    orderId: string;
  }>;
  statementOnly: StatementRow[];
};

type SystemPayment = {
  id: string;
  orderId: string;
  amount: number;
  transactionId: string | null;
};

const gatewayPattern = /^[a-z][a-z0-9_-]{1,31}$/i;

function parseDate(value: unknown, field: 'from' | 'to'): Date {
  if (typeof value !== 'string' || Number.isNaN(Date.parse(value))) {
    throw new BadRequestException(`${field} phải là thời điểm ISO hợp lệ.`);
  }
  return new Date(value);
}

function parseCsvLine(line: string): string[] {
  const cells: string[] = [];
  let current = '';
  let quoted = false;
  for (let i = 0; i < line.length; i += 1) {
    const char = line[i];
    if (char === '"') {
      if (quoted && line[i + 1] === '"') {
        current += '"';
        i += 1;
      } else quoted = !quoted;
    } else if (char === ',' && !quoted) {
      cells.push(current.trim());
      current = '';
    } else current += char;
  }
  cells.push(current.trim());
  return cells;
}

export function parseStatementCsv(csv: unknown): StatementRow[] {
  if (typeof csv !== 'string' || csv.length > 1024 * 1024) {
    throw new BadRequestException('CSV sao kê phải là chuỗi, tối đa 1 MB.');
  }
  const lines = csv
    .replace(/^\uFEFF/, '')
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);
  if (lines.length < 2) {
    throw new BadRequestException(
      'CSV sao kê cần header và ít nhất một dòng giao dịch.',
    );
  }
  const header = parseCsvLine(lines[0]).map((h) => h.toLowerCase());
  const txIndex = header.indexOf('transactionid');
  const amountIndex = header.indexOf('amount');
  if (txIndex < 0 || amountIndex < 0) {
    throw new BadRequestException(
      'CSV cần cột transactionId và amount (số nguyên VND).',
    );
  }
  const rows: StatementRow[] = [];
  const seen = new Set<string>();
  for (let i = 1; i < lines.length; i += 1) {
    const cells = parseCsvLine(lines[i]);
    const transactionId = cells[txIndex]?.trim();
    const rawAmount = cells[amountIndex]?.trim();
    if (!transactionId) {
      throw new BadRequestException(`Dòng ${i + 1}: thiếu transactionId.`);
    }
    if (seen.has(transactionId)) {
      throw new BadRequestException(
        `Dòng ${i + 1}: transactionId bị trùng trong sao kê.`,
      );
    }
    if (!/^\d+$/.test(rawAmount ?? '')) {
      throw new BadRequestException(
        `Dòng ${i + 1}: amount phải là số nguyên VND không âm.`,
      );
    }
    const amount = Number(rawAmount);
    if (!Number.isSafeInteger(amount)) {
      throw new BadRequestException(`Dòng ${i + 1}: amount quá lớn.`);
    }
    seen.add(transactionId);
    rows.push({ transactionId, amount, rowNumber: i + 1 });
  }
  return rows;
}

@Injectable()
export class ReconciliationService {
  constructor(private readonly db: PrismaService) {}

  async reconcile(body: ReconciliationRequest): Promise<ReconciliationResult> {
    const gateway = typeof body.gateway === 'string' ? body.gateway : '';
    if (!gatewayPattern.test(gateway)) {
      throw new BadRequestException('gateway không hợp lệ.');
    }
    const from = parseDate(body.from, 'from');
    const to = parseDate(body.to, 'to');
    if (to <= from) {
      throw new BadRequestException('to phải sau from.');
    }
    const statementRows = parseStatementCsv(body.csv);
    const systemRows = await this.db.payment.findMany({
      where: {
        gateway,
        status: PaymentStatus.SUCCEEDED,
        transactionId: { not: null },
        updatedAt: { gte: from, lt: to },
      },
      select: {
        id: true,
        orderId: true,
        amount: true,
        transactionId: true,
      },
      orderBy: [{ updatedAt: 'asc' }, { id: 'asc' }],
    });
    return this.compare(gateway, from, to, statementRows, systemRows);
  }

  private compare(
    gateway: string,
    from: Date,
    to: Date,
    statementRows: StatementRow[],
    systemRows: SystemPayment[],
  ): ReconciliationResult {
    const statementByTx = new Map(
      statementRows.map((row) => [row.transactionId, row]),
    );
    const systemByTx = new Map(
      systemRows
        .filter((row): row is SystemPayment & { transactionId: string } =>
          Boolean(row.transactionId),
        )
        .map((row) => [row.transactionId, row]),
    );
    const matched: ReconciliationResult['matched'] = [];
    const amountMismatches: ReconciliationResult['amountMismatches'] = [];
    const systemOnly: ReconciliationResult['systemOnly'] = [];
    const statementOnly: StatementRow[] = [];

    for (const system of systemByTx.values()) {
      const statement = statementByTx.get(system.transactionId);
      if (!statement) {
        systemOnly.push({
          transactionId: system.transactionId,
          amount: system.amount,
          paymentId: system.id,
          orderId: system.orderId,
        });
      } else if (statement.amount !== system.amount) {
        amountMismatches.push({
          transactionId: system.transactionId,
          systemAmount: system.amount,
          statementAmount: statement.amount,
          paymentId: system.id,
          orderId: system.orderId,
        });
      } else {
        matched.push({
          transactionId: system.transactionId,
          amount: system.amount,
          paymentId: system.id,
          orderId: system.orderId,
        });
      }
    }
    for (const statement of statementRows) {
      if (!systemByTx.has(statement.transactionId)) statementOnly.push(statement);
    }
    return {
      gateway,
      period: { from: from.toISOString(), to: to.toISOString() },
      totals: {
        statementRows: statementRows.length,
        systemRows: systemByTx.size,
        matched: matched.length,
        amountMismatches: amountMismatches.length,
        systemOnly: systemOnly.length,
        statementOnly: statementOnly.length,
      },
      matched,
      amountMismatches,
      systemOnly,
      statementOnly,
    };
  }
}
