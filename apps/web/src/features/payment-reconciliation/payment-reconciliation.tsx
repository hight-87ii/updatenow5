"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { api } from "@/lib/api/client";
import {
  decodeReconciliationResult,
  type ReconciliationResult,
  type ReconciliationRow,
} from "@/lib/contracts/reconciliation";
import { formatVnd } from "@/lib/formatting";

function today(offsetDays = 0) {
  const date = new Date();
  date.setDate(date.getDate() + offsetDays);
  return date.toISOString().slice(0, 10);
}

function readFile(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result ?? ""));
    reader.onerror = () => reject(new Error("Không đọc được tệp sao kê."));
    reader.readAsText(file, "utf-8");
  });
}

function ResultTable({
  title,
  rows,
  kind,
}: {
  title: string;
  rows: ReconciliationRow[];
  kind: "matched" | "mismatch" | "system" | "statement";
}) {
  return (
    <section className="operations-panel">
      <h2>{title}</h2>
      {!rows.length ? (
        <p>Không có dòng nào.</p>
      ) : (
        <div className="operations-table-wrap">
          <table>
            <thead>
              <tr>
                <th>Mã giao dịch</th>
                <th>Số tiền</th>
                <th>Payment</th>
                <th>Đơn hàng</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => (
                <tr key={`${kind}-${row.transactionId}`}>
                  <td>{row.transactionId}</td>
                  <td>
                    {kind === "mismatch"
                      ? `${formatVnd(row.systemAmount ?? 0)} / ${formatVnd(row.statementAmount ?? 0)}`
                      : formatVnd(row.amount ?? 0)}
                  </td>
                  <td>{row.paymentId ?? `Dòng sao kê ${row.rowNumber ?? "?"}`}</td>
                  <td>{row.orderId ?? "—"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}

export function PaymentReconciliation() {
  const [gateway, setGateway] = useState("momo");
  const [from, setFrom] = useState(today(-7));
  const [to, setTo] = useState(today(1));
  const [csv, setCsv] = useState("");
  const [fileName, setFileName] = useState("");
  const [pending, setPending] = useState(false);
  const [error, setError] = useState("");
  const [result, setResult] = useState<ReconciliationResult | null>(null);

  async function reconcile() {
    setPending(true);
    setError("");
    setResult(null);
    try {
      const next = await api("/payments/reconciliation", decodeReconciliationResult, {
        method: "POST",
        body: {
          gateway,
          from: `${from}T00:00:00.000Z`,
          to: `${to}T00:00:00.000Z`,
          csv,
        },
      });
      setResult(next);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Không đối soát được.");
    } finally {
      setPending(false);
    }
  }

  return (
    <div className="operations-page">
      <div className="page-heading">
        <div>
          <h1>Đối soát thanh toán</h1>
          <p>Nạp CSV sao kê cổng và ghép với giao dịch hệ thống theo mã giao dịch.</p>
        </div>
      </div>
      <section className="operations-panel">
        <h2>Sao kê cổng</h2>
        <p>
          CSV cần header <code>transactionId,amount</code>. Số tiền là số nguyên VND.
        </p>
        <div className="operations-filters">
          <label>
            Cổng
            <input value={gateway} onChange={(e) => setGateway(e.target.value)} />
          </label>
          <label>
            Từ ngày
            <input type="date" value={from} onChange={(e) => setFrom(e.target.value)} />
          </label>
          <label>
            Đến trước ngày
            <input type="date" value={to} onChange={(e) => setTo(e.target.value)} />
          </label>
          <label>
            Tệp CSV
            <input
              type="file"
              accept=".csv,text/csv"
              onChange={(event) => {
                const file = event.target.files?.[0];
                if (!file) return;
                setFileName(file.name);
                readFile(file)
                  .then(setCsv)
                  .catch((e) => setError(e.message));
              }}
            />
          </label>
        </div>
        {fileName && <p>Đã chọn: {fileName}</p>}
        <Button onClick={reconcile} disabled={pending || !csv || !gateway || !from || !to}>
          {pending ? "Đang đối soát…" : "Đối soát"}
        </Button>
      </section>
      {error && (
        <Alert variant="destructive">
          <AlertTitle>Không đối soát được</AlertTitle>
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      )}
      {result && (
        <>
          <section className="operations-panel">
            <h2>Tổng quan</h2>
            <div className="account-facts">
              <div>
                <dt>Khớp</dt>
                <dd><Badge>{result.totals.matched}</Badge></dd>
              </div>
              <div>
                <dt>Lệch tiền</dt>
                <dd><Badge variant="destructive">{result.totals.amountMismatches}</Badge></dd>
              </div>
              <div>
                <dt>Chỉ có trong hệ thống</dt>
                <dd><Badge variant="outline">{result.totals.systemOnly}</Badge></dd>
              </div>
              <div>
                <dt>Chỉ có trong sao kê</dt>
                <dd><Badge variant="outline">{result.totals.statementOnly}</Badge></dd>
              </div>
            </div>
          </section>
          <ResultTable title="Khớp" rows={result.matched} kind="matched" />
          <ResultTable title="Lệch số tiền" rows={result.amountMismatches} kind="mismatch" />
          <ResultTable title="Có ở hệ thống, không có ở cổng" rows={result.systemOnly} kind="system" />
          <ResultTable title="Có ở cổng, không có ở hệ thống" rows={result.statementOnly} kind="statement" />
        </>
      )}
    </div>
  );
}
