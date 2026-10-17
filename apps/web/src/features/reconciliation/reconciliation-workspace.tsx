'use client';

import { useEffect, useState } from 'react';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { api, object } from '@/lib/api/client';

type Run = { id: string; provider: string; fileName: string; total: number; counts: Record<string, number>; createdAt: string };
const decodeRuns = (value: unknown): Run[] => {
  if (!Array.isArray(value)) throw new Error('Phản hồi đối soát không hợp lệ.');
  return value.map((item) => {
    const row = object(item);
    return { id: String(row.id), provider: String(row.provider), fileName: String(row.fileName), total: Number(row.total), counts: object(row.counts) as Record<string, number>, createdAt: String(row.createdAt) };
  });
};

export function ReconciliationWorkspace() {
  const [runs, setRuns] = useState<Run[]>([]);
  const [provider, setProvider] = useState('momo');
  const [periodStart, setPeriodStart] = useState('');
  const [periodEnd, setPeriodEnd] = useState('');
  const [fileName, setFileName] = useState('');
  const [content, setContent] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  useEffect(() => { void api('/accounting/reconciliations', decodeRuns).then(setRuns).catch((e) => setError(e instanceof Error ? e.message : 'Không tải được lịch sử đối soát.')); }, []);

  async function submit() {
    setBusy(true); setError('');
    try {
      const start = new Date(periodStart);
      const end = new Date(periodEnd);
      if (Number.isNaN(start.valueOf()) || Number.isNaN(end.valueOf())) {
        throw new Error('Hãy chọn đầy đủ thời gian đối soát.');
      }
      const run = await api('/accounting/reconciliations', (value) => object(value) as unknown as Run, { method: 'POST', body: { provider: provider.trim(), fileName: fileName.trim() || 'statement.csv', periodStart: start.toISOString(), periodEnd: end.toISOString(), content } });
      setRuns((current) => [run, ...current]); setContent(''); setFileName('');
    } catch (e) { setError(e instanceof Error ? e.message : 'Không thể đối soát sao kê.'); }
    finally { setBusy(false); }
  }

  return <main className="mx-auto w-full max-w-5xl space-y-6 p-6">
    <header><h1 className="text-2xl font-semibold">Đối soát giao dịch</h1><p className="text-muted-foreground">Nạp CSV sao kê để so với các payment đã thành công trong hệ thống.</p></header>
    {error && <Alert variant="destructive"><AlertDescription>{error}</AlertDescription></Alert>}
    <section className="space-y-3 rounded-xl border p-4">
      <div className="grid gap-3 md:grid-cols-4">
        <Input aria-label="Cổng thanh toán" value={provider} onChange={(e) => setProvider(e.target.value)} placeholder="momo" />
        <Input aria-label="Tên tệp" value={fileName} onChange={(e) => setFileName(e.target.value)} placeholder="statement.csv" />
        <Input aria-label="Từ ngày" type="datetime-local" value={periodStart} onChange={(e) => setPeriodStart(e.target.value)} />
        <Input aria-label="Đến ngày" type="datetime-local" value={periodEnd} onChange={(e) => setPeriodEnd(e.target.value)} />
      </div>
      <input aria-label="Tệp sao kê CSV" type="file" accept=".csv,text/csv" onChange={(event) => {
        const file = event.target.files?.[0];
        if (!file) return;
        setFileName(file.name);
        void file.text().then(setContent);
      }} />
      <textarea className="min-h-40 w-full rounded-md border bg-transparent p-3 font-mono text-sm" aria-label="Nội dung CSV" value={content} onChange={(e) => setContent(e.target.value)} placeholder={'transaction_id,amount,gateway_ref\nTX-001,250000,REF-001'} />
      <Button disabled={busy} onClick={() => void submit()}>{busy ? 'Đang đối soát…' : 'Nạp và đối soát'}</Button>
    </section>
    <section className="space-y-3"><h2 className="text-lg font-medium">Lịch sử lần đối soát</h2>{runs.length === 0 ? <p className="text-muted-foreground">Chưa có lần đối soát.</p> : runs.map((run) => <article className="rounded-xl border p-4" key={run.id}><div className="flex flex-wrap justify-between gap-2"><strong>{run.provider} · {run.fileName}</strong><span>{run.total} giao dịch</span></div><p className="mt-2 text-sm">Khớp: {run.counts.MATCHED ?? 0} · Chỉ hệ thống: {run.counts.SYSTEM_ONLY ?? 0} · Chỉ cổng: {run.counts.PROVIDER_ONLY ?? 0} · Lệch tiền: {run.counts.AMOUNT_MISMATCH ?? 0}</p></article>)}</section>
  </main>;
}
