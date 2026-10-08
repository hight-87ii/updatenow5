"use client";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { api, object } from "@/lib/api/client";
import type { OwnedShowtime } from "@/lib/contracts/showtimes";

// S-42: organizer sets the per-account ticket limit for one showtime.
// null = unlimited (default for shows created before S-42).
export function TicketLimitControl({
  show,
  onChanged,
}: {
  show: OwnedShowtime;
  onChanged: () => Promise<void>;
}) {
  const [value, setValue] = useState(
    show.maxTicketsPerUser === null ? "" : String(show.maxTicketsPerUser),
  );
  const [pending, setPending] = useState(false),
    [error, setError] = useState(""),
    [message, setMessage] = useState("");
  async function save(limit: number | null) {
    if (pending) return;
    setPending(true);
    setError("");
    setMessage("");
    try {
      const saved = await api<{ maxTicketsPerUser: number | null }>(
        `/showtimes/${show.id}/ticket-limit`,
        (v) => object(v) as { maxTicketsPerUser: number | null },
        { method: "PATCH", body: { maxTicketsPerUser: limit } },
      );
      setValue(saved.maxTicketsPerUser === null ? "" : String(saved.maxTicketsPerUser));
      await onChanged();
      setMessage(
        saved.maxTicketsPerUser === null
          ? "Đã tắt giới hạn."
          : `Giới hạn ${saved.maxTicketsPerUser} vé/tài khoản.`,
      );
    } catch (e) {
      setError(e instanceof Error ? e.message : "Không lưu được giới hạn.");
    } finally {
      setPending(false);
    }
  }
  return (
    <section className="product-panel">
      <h2>Giới hạn vé mỗi tài khoản</h2>
      {error && (
        <Alert variant="destructive">
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      )}
      {message && (
        <p role="status" className="product-success">
          {message}
        </p>
      )}
      <p>
        Tổng ghế đang giữ cộng đã mua của một tài khoản vượt giới hạn thì không
        giữ thêm được. Để trống là không giới hạn.
      </p>
      <div className="form-actions">
        <label>
          Tối đa vé/tài khoản
          <input
            type="number"
            min={1}
            max={2000}
            inputMode="numeric"
            value={value}
            disabled={pending}
            onChange={(e) => setValue(e.target.value)}
            aria-label="Tối đa vé mỗi tài khoản"
          />
        </label>
        <Button
          disabled={pending}
          onClick={() => {
            const parsed = value.trim() === "" ? null : Number(value);
            if (parsed !== null && (!Number.isInteger(parsed) || parsed < 1 || parsed > 2000)) {
              setError("Giới hạn từ 1 đến 2000 vé, hoặc để trống.");
              return;
            }
            void save(parsed);
          }}
        >
          {pending ? "Đang lưu…" : "Lưu giới hạn"}
        </Button>
        {show.maxTicketsPerUser !== null && (
          <Button variant="outline" disabled={pending} onClick={() => void save(null)}>
            Tắt giới hạn
          </Button>
        )}
      </div>
    </section>
  );
}
