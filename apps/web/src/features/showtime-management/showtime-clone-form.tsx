"use client";
import { useState } from "react";
import Link from "next/link";
import { Button } from "@/components/ui/button";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { api } from "@/lib/api/client";
import { decodeCloneResult, type CloneResult } from "@/lib/contracts/showtimes";

export function ShowtimeCloneForm({ id }: { id: string }) {
  const [startTime, setStartTime] = useState("");
  const [pending, setPending] = useState(false);
  const [error, setError] = useState("");
  const [result, setResult] = useState<CloneResult | null>(null);

  async function clone() {
    if (pending || !startTime) return;
    setPending(true);
    setError("");
    setResult(null);
    try {
      // datetime-local has no offset; server requires one (Asia/Ho_Chi_Minh).
      const next = await api(`/showtimes/${id}/clone`, decodeCloneResult, {
        method: "POST",
        body: { startTime: `${startTime}:00+07:00` },
      });
      setResult(next);
      setStartTime("");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Không nhân bản được suất diễn.");
    } finally {
      setPending(false);
    }
  }

  return (
    <section aria-label="Nhân bản suất diễn">
      <h2>Nhân bản suất này</h2>
      <p className="text-muted-foreground">
        Tạo suất mới ở trạng thái nháp với cùng sơ đồ và bảng giá, chỉ khác giờ diễn.
        Ghế của suất mới đều trống.
      </p>
      <div className="flex gap-2">
        <input
          type="datetime-local"
          aria-label="Giờ diễn của suất mới"
          value={startTime}
          onChange={(e) => setStartTime(e.target.value)}
          disabled={pending}
        />
        <Button onClick={clone} disabled={pending || !startTime}>
          {pending ? "Đang nhân bản…" : "Nhân bản"}
        </Button>
      </div>
      {error && (
        <Alert variant="destructive">
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      )}
      {result && (
        <Alert>
          <AlertTitle>Đã tạo suất nháp</AlertTitle>
          <AlertDescription>
            {result.seatCount.toLocaleString("vi-VN")} ghế · {result.categoryCount} hạng giá.
            {result.warning ? ` ${result.warning}` : ""}{" "}
            <Button variant="link" asChild>
              <Link href={`/showtimes/${result.id}/manage`}>Mở suất mới</Link>
            </Button>
          </AlertDescription>
        </Alert>
      )}
    </section>
  );
}
