import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { PaymentStatus, ReconciliationLineType } from '@prisma/client';
import { randomUUID } from 'node:crypto';
import { PrismaService } from '../prisma/prisma.service.js';

type StatementRow = { transactionId: string; amount: number; gatewayRef?: string };
const MAX_FILE_BYTES = 5 * 1024 * 1024;

function parseCsv(content: string): StatementRow[] {
  if (Buffer.byteLength(content, 'utf8') > MAX_FILE_BYTES) throw new BadRequestException('Tệp sao kê vượt quá giới hạn 5 MB.');
  const rows = content.replace(/^\uFEFF/, '').split(/\r?\n/).filter((line) => line.trim());
  if (rows.length < 2) throw new BadRequestException('Sao kê phải có tiêu đề và ít nhất một giao dịch.');
  const headers = rows[0].split(',').map((s) => s.trim().toLowerCase());
  const txIndex = headers.indexOf('transaction_id');
  const amountIndex = headers.indexOf('amount');
  const refIndex = headers.indexOf('gateway_ref');
  if (txIndex < 0 || amountIndex < 0) throw new BadRequestException('CSV phải có cột transaction_id, amount.');
  const seen = new Set<string>();
  return rows.slice(1).map((line, offset) => {
    const values = line.split(',').map((s) => s.trim());
    const transactionId = values[txIndex];
    const amount = Number(values[amountIndex]);
    if (!transactionId || !Number.isSafeInteger(amount) || amount < 0) throw new BadRequestException(`Dòng ${offset + 2}: giao dịch hoặc số tiền không hợp lệ.`);
    if (seen.has(transactionId)) throw new BadRequestException(`Dòng ${offset + 2}: transaction_id bị trùng.`);
    seen.add(transactionId);
    return { transactionId, amount, gatewayRef: refIndex >= 0 ? values[refIndex] || undefined : undefined };
  });
}

function readInput(body: unknown) {
  if (!body || typeof body !== 'object' || Array.isArray(body)) throw new BadRequestException('Dữ liệu đối soát không hợp lệ.');
  const value = body as Record<string, unknown>;
  const provider = typeof value.provider === 'string' ? value.provider.trim() : '';
  const fileName = typeof value.fileName === 'string' ? value.fileName.trim() : '';
  const content = typeof value.content === 'string' ? value.content : '';
  const periodStart = new Date(String(value.periodStart));
  const periodEnd = new Date(String(value.periodEnd));
  if (!provider) throw new BadRequestException('Thiếu provider.');
  if (!fileName) throw new BadRequestException('Thiếu fileName.');
  if (!content) throw new BadRequestException('Thiếu nội dung file sao kê.');
  if (Number.isNaN(periodStart.valueOf())) throw new BadRequestException('periodStart không hợp lệ.');
  if (Number.isNaN(periodEnd.valueOf())) throw new BadRequestException('periodEnd không hợp lệ.');
  if (periodStart >= periodEnd) throw new BadRequestException('periodStart phải trước periodEnd.');
  return { provider, fileName, content, periodStart, periodEnd };
}

@Injectable()
export class ReconciliationService {
  constructor(private readonly db: PrismaService) {}

  async create(userId: string, body: unknown) {
    const input = readInput(body);
    const statement = parseCsv(input.content);
    const payments = await this.db.payment.findMany({
      where: { status: PaymentStatus.SUCCEEDED, transactionId: { not: null }, createdAt: { gte: input.periodStart, lte: input.periodEnd } },
      select: { id: true, transactionId: true, gatewayRef: true, amount: true },
    });
    const system = new Map(payments.map((payment) => [payment.transactionId!, payment]));
    const provider = new Map(statement.map((row) => [row.transactionId, row]));
    const ids = new Set([...system.keys(), ...provider.keys()]);
    const lines = [...ids].sort().map((transactionId) => {
      const left = system.get(transactionId); const right = provider.get(transactionId);
      const type = !left ? ReconciliationLineType.PROVIDER_ONLY : !right ? ReconciliationLineType.SYSTEM_ONLY : left.amount === right.amount ? ReconciliationLineType.MATCHED : ReconciliationLineType.AMOUNT_MISMATCH;
      return { id: randomUUID(), type, transactionId, gatewayRef: left?.gatewayRef ?? right?.gatewayRef ?? null, paymentId: left?.id ?? null, systemAmount: left?.amount ?? null, providerAmount: right?.amount ?? null };
    });
    const run = await this.db.reconciliationRun.create({ data: { createdById: userId, provider: input.provider, fileName: input.fileName, periodStart: input.periodStart, periodEnd: input.periodEnd, lines: { create: lines } }, include: { lines: true } });
    return this.summary(run);
  }

  async list() { return (await this.db.reconciliationRun.findMany({ orderBy: { createdAt: 'desc' }, include: { lines: true } })).map((run) => this.summary(run)); }
  async detail(id: string) { const run = await this.db.reconciliationRun.findUnique({ where: { id }, include: { lines: true } }); if (!run) throw new NotFoundException('Không tìm thấy lần đối soát.'); return this.summary(run); }
  private summary(run: { id: string; provider: string; fileName: string; periodStart: Date; periodEnd: Date; createdAt: Date; lines: Array<{ type: ReconciliationLineType; transactionId: string; gatewayRef: string | null; paymentId: string | null; systemAmount: number | null; providerAmount: number | null }> }) {
    const counts = Object.fromEntries(Object.values(ReconciliationLineType).map((type) => [type, run.lines.filter((line) => line.type === type).length]));
    return { id: run.id, provider: run.provider, fileName: run.fileName, periodStart: run.periodStart, periodEnd: run.periodEnd, createdAt: run.createdAt, counts, total: run.lines.length, lines: run.lines };
  }
}
