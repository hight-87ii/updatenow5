"use client";

import { useEffect, useState, useRef, useCallback } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  CheckCircle,
  CircleAlert,
  RotateCw,
  Ticket,
  CalendarDays,
  MapPin,
  Home,
  ArrowRight,
  Info,
} from "@/components/ui/material-icon";
import { Button } from "@/components/ui/button";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { PublicLayout } from "@/components/layout/product-layout";
import { api, ApiError } from "@/lib/api/client";
import { loadCurrentUser } from "@/lib/api";
import { decodeOrderDetail, type OrderDetail } from "@/lib/contracts/orders";
import { formatVnd, formatShowtime } from "@/lib/formatting";

export interface PaymentResultProps {
  orderId: string;
}

export function PaymentResult({ orderId }: PaymentResultProps) {
  const router = useRouter();
  const [order, setOrder] = useState<OrderDetail | null>(null);
  const [loading, setLoading] = useState<boolean>(true);
  const [polling, setPolling] = useState<boolean>(false);
  const [unauthorized, setUnauthorized] = useState<boolean>(false);
  const [error, setError] = useState<string>("");
  const pollCountRef = useRef(0);
  const maxPolls = 15; // 15 polls * 2s = 30 seconds max
  const aliveRef = useRef(true);

  const fetchOrder = useCallback(async (): Promise<OrderDetail | null> => {
    try {
      const data = await api(`/orders/${orderId}`, decodeOrderDetail);
      return data;
    } catch (err) {
      if (err instanceof ApiError && err.status === 401) {
        setUnauthorized(true);
      } else {
        setError(
          err instanceof Error
            ? err.message
            : "Không thể lấy thông tin đơn hàng.",
        );
      }
      return null;
    }
  }, [orderId]);

  useEffect(() => {
    aliveRef.current = true;
    pollCountRef.current = 0;

    async function initialLoad() {
      if (!orderId) {
        setError("Mã đơn hàng không hợp lệ.");
        setLoading(false);
        return;
      }

      const user = await loadCurrentUser();
      if (!aliveRef.current) return;
      if (!user) {
        setUnauthorized(true);
        setLoading(false);
        return;
      }

      const data = await fetchOrder();
      if (!aliveRef.current) return;

      if (data) {
        setOrder(data);
        if (data.status === "PENDING" && !data.isExpired) {
          setPolling(true);
        }
      }
      setLoading(false);
    }

    void initialLoad();

    return () => {
      aliveRef.current = false;
    };
  }, [orderId, fetchOrder]);

  // Polling every 2 seconds if status is PENDING
  useEffect(() => {
    if (!polling || !orderId || order?.status !== "PENDING") return;

    const interval = setInterval(async () => {
      pollCountRef.current += 1;
      const data = await fetchOrder();
      if (!aliveRef.current) return;

      if (data) {
        setOrder(data);
        if (data.status !== "PENDING" || pollCountRef.current >= maxPolls) {
          setPolling(false);
          clearInterval(interval);
        }
      } else {
        setPolling(false);
        clearInterval(interval);
      }
    }, 2000);

    return () => clearInterval(interval);
  }, [polling, orderId, order?.status, fetchOrder]);

  const handleManualRefresh = async () => {
    setLoading(true);
    const data = await fetchOrder();
    if (data) setOrder(data);
    setLoading(false);
  };

  return (
    <PublicLayout signedIn={!unauthorized}>
      <main className="max-w-3xl mx-auto px-4 py-12">
        {loading && (
          <div className="space-y-6 text-center py-12" data-testid="payment-result-loading">
            <Skeleton className="h-16 w-16 rounded-full mx-auto" />
            <Skeleton className="h-8 w-64 mx-auto" />
            <Skeleton className="h-4 w-96 mx-auto" />
            <Skeleton className="h-40 w-full rounded-2xl max-w-lg mx-auto" />
          </div>
        )}

        {unauthorized && (
          <div className="py-12 text-center" data-testid="payment-result-unauthorized">
            <Alert variant="destructive" className="max-w-md mx-auto mb-6">
              <CircleAlert className="h-4 w-4" />
              <AlertTitle>Cần đăng nhập</AlertTitle>
              <AlertDescription>
                Bạn cần đăng nhập tài khoản để kiểm tra kết quả thanh toán.
              </AlertDescription>
            </Alert>
            <Button
              onClick={() =>
                router.replace(
                  `/login?returnTo=${encodeURIComponent(`/payment/result?orderId=${orderId}`)}`,
                )
              }
            >
              Đăng nhập ngay
            </Button>
          </div>
        )}

        {!loading && !unauthorized && error && (
          <div className="py-12 text-center" data-testid="payment-result-error">
            <Alert variant="destructive" className="max-w-md mx-auto mb-6 text-left">
              <CircleAlert className="h-4 w-4" />
              <AlertTitle>Có lỗi xảy ra</AlertTitle>
              <AlertDescription>{error}</AlertDescription>
            </Alert>
            <Button asChild variant="outline">
              <Link href="/">
                <Home className="mr-2 h-4 w-4" />
                Về trang chủ
              </Link>
            </Button>
          </div>
        )}

        {!loading && !unauthorized && !error && order && (
          <div className="bg-card border rounded-2xl shadow-sm p-6 sm:p-10 text-center">
            {/* SUCCESS / PAID */}
            {order.status === "PAID" && (
              <div data-testid="payment-result-paid" className="space-y-6">
                <div className="w-20 h-20 bg-emerald-100 text-emerald-600 dark:bg-emerald-950/60 dark:text-emerald-400 rounded-full flex items-center justify-center mx-auto shadow-inner">
                  <CheckCircle className="h-10 w-10" />
                </div>
                <div className="space-y-2">
                  <h1 className="text-2xl sm:text-3xl font-extrabold tracking-tight text-foreground">
                    Thanh toán thành công!
                  </h1>
                  <p className="text-muted-foreground text-sm max-w-md mx-auto">
                    Đơn hàng của bạn đã được ghi nhận và vé đã sẵn sàng. Mã đơn:{" "}
                    <span className="font-mono text-foreground font-semibold">
                      {order.id.slice(0, 8)}
                    </span>
                  </p>
                </div>

                {/* Order Summary Card */}
                <div className="bg-muted/30 border rounded-xl p-5 text-left space-y-3 max-w-lg mx-auto">
                  <div className="flex items-start justify-between border-b pb-3">
                    <div>
                      <h2 className="font-bold text-foreground text-base">
                        {order.event.name}
                      </h2>
                      <div className="flex items-center gap-1.5 text-xs text-muted-foreground mt-1">
                        <MapPin className="h-3.5 w-3.5 text-primary" />
                        <span>{order.event.location}</span>
                      </div>
                    </div>
                    <Badge variant="secondary" className="font-mono text-xs">
                      {order.items.length} vé
                    </Badge>
                  </div>

                  <div className="flex items-center justify-between text-xs text-muted-foreground pt-1">
                    <span className="flex items-center gap-1">
                      <CalendarDays className="h-3.5 w-3.5" />
                      {formatShowtime(order.showtime.startTime)}
                    </span>
                    <span className="flex items-center gap-1 font-mono">
                      <Ticket className="h-3.5 w-3.5" />
                      {order.items.map((i) => i.label).join(", ")}
                    </span>
                  </div>

                  <div className="flex items-center justify-between border-t pt-3 font-semibold">
                    <span className="text-sm">Tổng thanh toán:</span>
                    <span className="text-lg font-extrabold text-primary">
                      {formatVnd(order.totalAmount)}
                    </span>
                  </div>
                </div>

                <div className="flex flex-col sm:flex-row items-center justify-center gap-3 pt-4">
                  <Button asChild size="lg" className="w-full sm:w-auto">
                    <Link href={`/orders/${order.id}`}>
                      Xem chi tiết đơn hàng
                      <ArrowRight className="ml-2 h-4 w-4" />
                    </Link>
                  </Button>
                  <Button asChild variant="outline" size="lg" className="w-full sm:w-auto">
                    <Link href="/">
                      <Home className="mr-2 h-4 w-4" />
                      Về trang chủ
                    </Link>
                  </Button>
                </div>
              </div>
            )}

            {/* PENDING / CONFIRMING */}
            {order.status === "PENDING" && (
              <div data-testid="payment-result-confirming" className="space-y-6">
                <div className="w-20 h-20 bg-amber-100 text-amber-600 dark:bg-amber-950/60 dark:text-amber-400 rounded-full flex items-center justify-center mx-auto shadow-inner">
                  <RotateCw className="h-10 w-10 animate-spin" />
                </div>
                <div className="space-y-2">
                  <h1 className="text-2xl sm:text-3xl font-extrabold tracking-tight text-foreground">
                    Đang xác nhận kết quả thanh toán...
                  </h1>
                  <p className="text-muted-foreground text-sm max-w-md mx-auto">
                    Hệ thống đang đồng bộ dữ liệu giao dịch từ cổng thanh toán MoMo. Vui lòng không đóng trang.
                  </p>
                </div>

                <div className="p-4 bg-muted/40 rounded-xl border max-w-md mx-auto text-xs text-muted-foreground">
                  <div className="flex items-center justify-between mb-2 font-medium text-foreground">
                    <span>Mã đơn: {order.id.slice(0, 8)}</span>
                    <span className="font-extrabold text-primary">
                      {formatVnd(order.totalAmount)}
                    </span>
                  </div>
                  <span>Trạng thái: Đang chờ xác nhận giao dịch</span>
                </div>

                <div className="flex flex-col sm:flex-row items-center justify-center gap-3 pt-2">
                  <Button
                    onClick={handleManualRefresh}
                    variant="outline"
                    className="w-full sm:w-auto"
                  >
                    <RotateCw className="mr-2 h-4 w-4" />
                    Kiểm tra lại ngay
                  </Button>
                  <Button asChild variant="ghost" className="w-full sm:w-auto">
                    <Link href={`/orders/${order.id}`}>
                      Quay lại đơn hàng
                    </Link>
                  </Button>
                </div>
              </div>
            )}

            {/* NEEDS REVIEW */}
            {order.status === "NEEDS_REVIEW" && (
              <div data-testid="payment-result-review" className="space-y-6">
                <div className="w-20 h-20 bg-amber-100 text-amber-600 dark:bg-amber-950/60 dark:text-amber-400 rounded-full flex items-center justify-center mx-auto shadow-inner">
                  <Info className="h-10 w-10" />
                </div>
                <div className="space-y-2">
                  <h1 className="text-2xl sm:text-3xl font-extrabold tracking-tight text-foreground">
                    Đang chờ đối soát kế toán
                  </h1>
                  <p className="text-muted-foreground text-sm max-w-md mx-auto">
                    Giao dịch đã được ghi nhận nhưng cần nhân viên kế toán đối soát số tiền. Vui lòng liên hệ ban tổ chức hoặc chờ xử lý.
                  </p>
                </div>

                <div className="flex flex-col sm:flex-row items-center justify-center gap-3 pt-4">
                  <Button asChild size="lg" className="w-full sm:w-auto">
                    <Link href={`/orders/${order.id}`}>
                      Xem chi tiết đơn hàng
                    </Link>
                  </Button>
                  <Button asChild variant="outline" size="lg" className="w-full sm:w-auto">
                    <Link href="/">
                      <Home className="mr-2 h-4 w-4" />
                      Về trang chủ
                    </Link>
                  </Button>
                </div>
              </div>
            )}

            {/* EXPIRED OR FAILED */}
            {order.status === "EXPIRED" && (
              <div data-testid="payment-result-failed" className="space-y-6">
                <div className="w-20 h-20 bg-destructive/10 text-destructive rounded-full flex items-center justify-center mx-auto shadow-inner">
                  <CircleAlert className="h-10 w-10" />
                </div>
                <div className="space-y-2">
                  <h1 className="text-2xl sm:text-3xl font-extrabold tracking-tight text-foreground">
                    Đơn hàng đã hết hạn
                  </h1>
                  <p className="text-muted-foreground text-sm max-w-md mx-auto">
                    Thời gian thanh toán cho đơn hàng này đã kết thúc. Các ghế đã được giải phóng để người khác có thể chọn.
                  </p>
                </div>

                <div className="flex flex-col sm:flex-row items-center justify-center gap-3 pt-4">
                  <Button asChild size="lg" className="w-full sm:w-auto">
                    <Link href={`/shows/${order.showtime.id}/seats`}>
                      <RotateCw className="mr-2 h-4 w-4" />
                      Chọn lại ghế mới
                    </Link>
                  </Button>
                  <Button asChild variant="outline" size="lg" className="w-full sm:w-auto">
                    <Link href="/">
                      <Home className="mr-2 h-4 w-4" />
                      Về trang chủ
                    </Link>
                  </Button>
                </div>
              </div>
            )}
          </div>
        )}
      </main>
    </PublicLayout>
  );
}
