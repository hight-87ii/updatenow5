"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { Clock3, CircleAlert, Armchair } from "@/components/ui/material-icon";
import { Button } from "@/components/ui/button";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Skeleton } from "@/components/ui/skeleton";
import { api, ApiError } from "@/lib/api/client";
import { decodeWaitingStatus, type WaitingStatus } from "@/lib/contracts/waiting";

export function WaitingRoom({ id }: { id: string }) {
  const router = useRouter();
  const [status, setStatus] = useState<WaitingStatus | null>(null);
  const [error, setError] = useState("");
  const alive = useRef(true);

  const poll = useCallback(async () => {
    const next = await api(`/showtimes/${id}/waiting`, decodeWaitingStatus);
    if (!alive.current) return next;
    setStatus(next);
    if (next.state === "admitted") router.replace(`/shows/${id}/seats`);
    return next;
  }, [id, router]);

  useEffect(() => {
    alive.current = true;
    // Join on mount: first visit takes a queue ticket.
    api(`/showtimes/${id}/waiting`, decodeWaitingStatus, { method: "POST", body: {} })
      .then((next) => {
        if (!alive.current) return;
        setStatus(next);
        if (next.state === "admitted") router.replace(`/shows/${id}/seats`);
      })
      .catch((e) => {
        if (alive.current)
          setError(e instanceof Error ? e.message : "Không vào được phòng chờ. Hãy thử lại.");
      });
    const timer = setInterval(() => {
      void poll().catch((e) => {
        if (alive.current && e instanceof ApiError && e.status === 401)
          router.replace(`/login?returnTo=${encodeURIComponent(`/shows/${id}/waiting`)}`);
      });
    }, 2000);
    return () => {
      alive.current = false;
      clearInterval(timer);
    };
  }, [id, poll, router]);

  async function leave() {
    try {
      await api(`/showtimes/${id}/waiting`, () => true, { method: "DELETE" });
    } finally {
      router.replace(`/shows/${id}`);
    }
  }

  if (error)
    return (
      <Alert variant="destructive">
        <CircleAlert />
        <AlertTitle>Không vào được phòng chờ</AlertTitle>
        <AlertDescription>{error}</AlertDescription>
      </Alert>
    );
  if (!status)
    return (
      <div className="space-y-2" aria-label="Đang lấy vị trí hàng chờ">
        <Skeleton className="h-8 w-48" />
        <Skeleton className="h-4 w-72" />
      </div>
    );
  if (status.state === "none")
    return (
      <Alert>
        <Armchair />
        <AlertTitle>Không cần xếp hàng</AlertTitle>
        <AlertDescription>
          Suất này hiện còn chỗ trống.{" "}
          <Button variant="link" onClick={() => router.replace(`/shows/${id}/seats`)}>
            Vào chọn ghế
          </Button>
        </AlertDescription>
      </Alert>
    );
  if (status.state === "admitted") return null; // redirecting to seat map
  const minutes = Math.max(1, Math.ceil(status.position / 10));
  return (
    <div className="space-y-4" role="status" aria-live="polite">
      <div className="flex items-center gap-2">
        <Clock3 />
        <h1 className="text-xl font-semibold">Vị trí thứ {status.position} trong hàng chờ</h1>
      </div>
      <p className="text-muted-foreground">
        Còn khoảng {minutes} phút chờ. Đừng tải lại liên tục — vị trí của bạn được giữ theo thứ tự đến,
        trang tự cập nhật mỗi 2 giây và tự chuyển vào chọn ghế khi tới lượt.
      </p>
      <p className="text-sm text-muted-foreground">
        Đang chọn ghế: {status.activeCount} người · đang chờ: {status.queueTotal} người.
      </p>
      <Button variant="outline" onClick={leave}>
        Rời hàng chờ
      </Button>
    </div>
  );
}
