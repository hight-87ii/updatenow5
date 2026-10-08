import { ApiError, object } from '@/lib/api/client';

export type ReconciliationRow = {
  transactionId: string;
  amount?: number;
  systemAmount?: number;
  statementAmount?: number;
  paymentId?: string;
  orderId?: string;
  rowNumber?: number;
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
  matched: ReconciliationRow[];
  amountMismatches: ReconciliationRow[];
  systemOnly: ReconciliationRow[];
  statementOnly: ReconciliationRow[];
};

const invalid = (): never => {
  throw new ApiError('Không đọc được kết quả đối soát.', 502, 'INVALID_RESPONSE');
};
const str = (value: unknown): string =>
  typeof value === 'string' ? value : invalid();
const num = (value: unknown): number =>
  typeof value === 'number' && Number.isFinite(value) ? value : invalid();
const maybeNum = (value: unknown): number | undefined =>
  value === undefined ? undefined : num(value);
const arr = (value: unknown): unknown[] => (Array.isArray(value) ? value : invalid());
const time = (value: unknown): string =>
  Number.isNaN(Date.parse(str(value))) ? invalid() : str(value);
const row = (value: unknown): ReconciliationRow => {
  const r = object(value);
  return {
    transactionId: str(r.transactionId),
    amount: maybeNum(r.amount),
    systemAmount: maybeNum(r.systemAmount),
    statementAmount: maybeNum(r.statementAmount),
    paymentId: typeof r.paymentId === 'string' ? r.paymentId : undefined,
    orderId: typeof r.orderId === 'string' ? r.orderId : undefined,
    rowNumber: maybeNum(r.rowNumber),
  };
};

export function decodeReconciliationResult(value: unknown): ReconciliationResult {
  const r = object(value);
  const p = object(r.period);
  const t = object(r.totals);
  return {
    gateway: str(r.gateway),
    period: { from: time(p.from), to: time(p.to) },
    totals: {
      statementRows: num(t.statementRows),
      systemRows: num(t.systemRows),
      matched: num(t.matched),
      amountMismatches: num(t.amountMismatches),
      systemOnly: num(t.systemOnly),
      statementOnly: num(t.statementOnly),
    },
    matched: arr(r.matched).map(row),
    amountMismatches: arr(r.amountMismatches).map(row),
    systemOnly: arr(r.systemOnly).map(row),
    statementOnly: arr(r.statementOnly).map(row),
  };
}
