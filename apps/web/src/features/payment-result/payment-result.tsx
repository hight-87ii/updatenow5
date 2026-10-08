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
import {
  decodeOrderDetail,
  decodeOrderStatus,
  type OrderDetail,
  type OrderStatusResult,
} from "@/lib/contracts/orders";
import { formatVnd, formatShowtime } from "@/lib/formatting";

export interface PaymentResultProps {
  orderId: string;
}

export function PaymentResult({ orderId }: PaymentResultProps) {
  const router = useRouter();
  const [order, setOrder] = useState<OrderDetail | null>(null);
  const [orderStatus, setOrderStatus] = useState<OrderStatusResult | null>(null);
  const [loading, setLoading] = useState<boolean>(true);
  const [unauthorized, setUnauthorized] = useState<boolean>(false);
  const [error, setError] = useState<string>("");
  const [isTimeout, setIsTimeout] = useState<boolean>(false);

  const aliveRef = useRef<boolean>(true);
  const timeoutRef = useRef<NodeJS.Timeout | null>(null);
  const startTimeRef = useRef<number>(0);

  // Poll server state every 2 seconds sequentially
  const startPolling = useCallback(() => {
    setIsTimeout(false);
    startTimeRef.current = Date.now();

    const scheduleNextPoll = () => {
      if (!aliveRef.current) return;
      if (timeoutRef.current) clearTimeout(timeoutRef.current);

      timeoutRef.current = setTimeout(async () => {
        if (!aliveRef.current) return;

        // Check 60-second wall-clock limit
        if (Date.now() - startTimeRef.current >= 60000) {
          setIsTimeout(true);
          return;
        }

        try {
          const statusData = await api(
            `/orders/${orderId}/status`,
            decodeOrderStatus,
          );
          if (!aliveRef.current) return;

          setOrderStatus(statusData);

          // Stop polling on terminal states
          if (statusData.status === "PAID") {
            try {
              const fullDetail = await api(
                `/orders/${orderId}`,
                decodeOrderDetail,
              );
              if (aliveRef.current) setOrder(fullDetail);
            } catch {
              // Ignore failure to fetch detail; status is already PAID
            }
            return;
          }

          if (
            statusData.status === "EXPIRED" ||
            statusData.status === "NEEDS_REVIEW" ||
            statusData.latestPayment?.status === "FAILED"
          ) {
            return;
          }
        } catch (err) {
          if (!aliveRef.current) return;
          if (err instanceof ApiError && err.status === 401) {
            setUnauthorized(true);
            return;
          }
          // Network errors during polling: continue retrying next cycle per spec
        }

        // Schedule next request only after current finishes (no overlapping requests)
        if (aliveRef.current && Date.now() - startTimeRef.current < 60000) {
          scheduleNextPoll();
        } else if (aliveRef.current) {
          setIsTimeout(true);
        }
      }, 2000);
    };

    scheduleNextPoll();
  }, [orderId]);

  useEffect(() => {
    aliveRef.current = true;

    async function initialLoad() {
      if (!orderId) {
        setError("Không tìm thấy đơn hàng.");
        setLoading(false);
        return;
      }

      setLoading(true);
      try {
        const user = await loadCurrentUser();
        if (!aliveRef.current) return;
        if (!user) {
          setUnauthorized(true);
          setLoading(false);
          return;
        }

        // Initial fetch: query server status and order detail concurrently
        const [statusRes, detailRes] = await Promise.allSettled([
          api(`/orders/${orderId}/status`, decodeOrderStatus),
          api(`/orders/${orderId}`, decodeOrderDetail),
        ]);

        if (!aliveRef.current) return;

        if (statusRes.status === "rejected") {
          const err = statusRes.reason;
          if (err instanceof ApiError && err.status === 401) {
            setUnauthorized(true);
          } else if (
            err instanceof ApiError &&
            (err.status === 404 || err.status === 403)
          ) {
            setError("Không tìm thấy đơn hàng.");
          } else {
            setError(
              err instanceof Error
                ? err.message
                : "Không thể lấy thông tin đơn hàng.",
            );
          }
          setLoading(false);
          return;
        }

        const currentStatus = statusRes.value;
        setOrderStatus(currentStatus);

        if (detailRes.status === "fulfilled") {
          setOrder(detailRes.value);
        }

        setLoading(false);

        // If PENDING and latest payment is INITIATED or pending, begin 2s polling
        if (
          (currentStatus.status === "PENDING" ||
            currentStatus.status === "PENDING_PAYMENT") &&
          (!currentStatus.latestPayment ||
            currentStatus.latestPayment.status === "INITIATED")
        ) {
          startPolling();
        }
      } catch (err) {
        if (!aliveRef.current) return;
        setError(err instanceof Error ? err.message : "Có lỗi xảy ra.");
        setLoading(false);
      }
    }

    void initialLoad();

    return () => {
      aliveRef.current = false;
      if (timeoutRef.current) clearTimeout(timeoutRef.current);
    };
  }, [orderId, startPolling]);

  const handleManualRefresh = async () => {
    setLoading(true);
    setIsTimeout(false);
    try {
      const [statusRes, detailRes] = await Promise.allSettled([
        api(`/orders/${orderId}/status`, decodeOrderStatus),
        api(`/orders/${orderId}`, decodeOrderDetail),
      ]);
      if (statusRes.status === "fulfilled") {
        setOrderStatus(statusRes.value);
        if (
          (statusRes.value.status === "PENDING" ||
            statusRes.value.status === "PENDING_PAYMENT") &&
          (!statusRes.value.latestPayment ||
            statusRes.value.latestPayment.status === "INITIATED")
        ) {
          startPolling();
        }
      }
      if (detailRes.status === "fulfilled") {
        setOrder(detailRes.value);
      }
    } catch {
      // Ignore manual refresh error
    } finally {
      setLoading(false);
    }
  };

  const handleRetryPolling = () => {
    handleManualRefresh();
  };

  const currentStatus = orderStatus?.status ?? order?.status;
  const latestPayStatus =
    orderStatus?.latestPayment?.status ?? order?.latestPayment?.status;

  return (
    <PublicLayout signedIn={!unauthorized}>
      <main className="max-w-3xl mx-auto px-4 py-12">
        {/* Neutral loading state before first server response */}
        {loading && (
          <div
            className="space-y-6 text-center py-12"
            data-testid="payment-result-loading"
          >
            <div className="w-20 h-20 bg-amber-100 text-amber-600 dark:bg-amber-950/60 dark:text-amber-400 rounded-full flex items-center justify-center mx-auto shadow-inner">
              <RotateCw className="h-10 w-10 animate-spin" />
            </div>
            <div className="space-y-2">
              <h1 className="text-2xl sm:text-3xl font-extrabold tracking-tight text-foreground">
                Đang xác nhận thanh toán…
              </h1>
              <p className="text-muted-foreground text-sm max-w-md mx-auto">
                Hệ thống đang đồng bộ dữ liệu giao dịch từ máy chủ. Vui lòng đợi trong giây lát.
              </p>
            </div>
            <Skeleton className="h-28 w-full rounded-2xl max-w-lg mx-auto" />
          </div>
        )}

        {/* Unauthorized state */}
        {!loading && unauthorized && (
          <div
            className="py-12 text-center"
            data-testid="payment-result-unauthorized"
          >
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
                  `/login?returnTo=${encodeURIComponent(
                    `/payment/result/${orderId}`,
                  )}`,
                )
              }
            >
              Đăng nhập ngay
            </Button>
          </div>
        )}

        {/* Generic / Not found error */}
        {!loading && !unauthorized && error && (
          <div className="py-12 text-center" data-testid="payment-result-error">
            <Alert
              variant="destructive"
              className="max-w-md mx-auto mb-6 text-left"
            >
              <CircleAlert className="h-4 w-4" />
              <AlertTitle>Không tìm thấy đơn hàng</AlertTitle>
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

        {/* Normal views based on server status */}
        {!loading && !unauthorized && !error && (
          <div className="bg-card border rounded-2xl shadow-sm p-6 sm:p-10 text-center">
            {/* 1. PAID: "Đã thanh toán" */}
            {currentStatus === "PAID" && (
              <div data-testid="payment-result-paid" className="space-y-6">
                <div className="w-20 h-20 bg-emerald-100 text-emerald-600 dark:bg-emerald-950/60 dark:text-emerald-400 rounded-full flex items-center justify-center mx-auto shadow-inner">
                  <CheckCircle className="h-10 w-10" />
                </div>
                <div className="space-y-2">
                  <h1 className="text-2xl sm:text-3xl font-extrabold tracking-tight text-foreground">
                    Đã thanh toán
                  </h1>
                  <p className="text-muted-foreground text-sm max-w-md mx-auto">
                    Đơn hàng của bạn đã được thanh toán thành công và vé đã sẵn sàng. Mã đơn:{" "}
                    <span className="font-mono text-foreground font-semibold">
                      {orderId.slice(0, 8)}
                    </span>
                  </p>
                </div>

                {order && (
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
                )}

                <div className="flex flex-col sm:flex-row items-center justify-center gap-3 pt-4">
                  <Button asChild size="lg" className="w-full sm:w-auto">
                    <Link href={`/orders/${orderId}`}>
                      Xem chi tiết đơn hàng / vé
                      <ArrowRight className="ml-2 h-4 w-4" />
                    </Link>
                  </Button>
                  <Button
                    asChild
                    variant="outline"
                    size="lg"
                    className="w-full sm:w-auto"
                  >
                    <Link href="/">
                      <Home className="mr-2 h-4 w-4" />
                      Về trang chủ
                    </Link>
                  </Button>
                </div>
              </div>
            )}

            {/* 2. TIMEOUT (60s without server confirmation): DO NOT CONCLUDE FAILED */}
            {isTimeout &&
              currentStatus === "PENDING" &&
              (!latestPayStatus || latestPayStatus === "INITIATED") && (
                <div data-testid="payment-result-timeout" className="space-y-6">
                  <div className="w-20 h-20 bg-amber-100 text-amber-600 dark:bg-amber-950/60 dark:text-amber-400 rounded-full flex items-center justify-center mx-auto shadow-inner">
                    <Info className="h-10 w-10" />
                  </div>
                  <div className="space-y-2">
                    <h1 className="text-2xl sm:text-3xl font-extrabold tracking-tight text-foreground">
                      Chưa nhận được xác nhận từ cổng thanh toán
                    </h1>
                    <p className="text-muted-foreground text-sm max-w-lg mx-auto">
                      Vui lòng kiểm tra lại trong lịch sử / chi tiết đơn hàng của bạn sau ít phút.
                      Nếu tài khoản của bạn đã bị trừ tiền, vui lòng liên hệ ban tổ chức kèm mã đơn hàng bên dưới để được hỗ trợ kiểm tra.
                    </p>
                  </div>

                  <div className="p-4 bg-muted/40 rounded-xl border max-w-md mx-auto text-xs text-muted-foreground">
                    <div className="flex items-center justify-between mb-1 font-medium text-foreground">
                      <span>Mã đơn hàng:</span>
                      <span className="font-mono font-bold">{orderId}</span>
                    </div>
                    <span>Trạng thái máy chủ: Đang chờ xác nhận giao dịch</span>
                  </div>

                  <div className="flex flex-col sm:flex-row items-center justify-center gap-3 pt-2">
                    <Button
                      onClick={handleRetryPolling}
                      size="lg"
                      className="w-full sm:w-auto"
                    >
                      <RotateCw className="mr-2 h-4 w-4" />
                      Kiểm tra lại
                    </Button>
                    <Button
                      asChild
                      variant="outline"
                      size="lg"
                      className="w-full sm:w-auto"
                    >
                      <Link href={`/orders/${orderId}`}>
                        Chi tiết đơn hàng
                      </Link>
                    </Button>
                  </div>
                </div>
              )}

            {/* 3. PENDING & FAILED latest payment: "Thanh toán không thành công" */}
            {!isTimeout &&
              (currentStatus === "PENDING" ||
                currentStatus === "PENDING_PAYMENT") &&
              latestPayStatus === "FAILED" && (
                <div
                  data-testid="payment-result-payment-failed"
                  className="space-y-6"
                >
                  <div className="w-20 h-20 bg-destructive/10 text-destructive rounded-full flex items-center justify-center mx-auto shadow-inner">
                    <CircleAlert className="h-10 w-10" />
                  </div>
                  <div className="space-y-2">
                    <h1 className="text-2xl sm:text-3xl font-extrabold tracking-tight text-foreground">
                      Thanh toán không thành công
                    </h1>
                    <p className="text-muted-foreground text-sm max-w-md mx-auto">
                      Giao dịch qua cổng thanh toán chưa thành công hoặc đã bị huỷ. Bạn có thể quay lại đơn hàng để thực hiện lại thanh toán.
                    </p>
                  </div>

                  <div className="flex flex-col sm:flex-row items-center justify-center gap-3 pt-4">
                    <Button asChild size="lg" className="w-full sm:w-auto">
                      <Link href={`/orders/${orderId}`}>
                        Quay lại đơn hàng để thanh toán lại
                        <ArrowRight className="ml-2 h-4 w-4" />
                      </Link>
                    </Button>
                    <Button
                      asChild
                      variant="outline"
                      size="lg"
                      className="w-full sm:w-auto"
                    >
                      <Link href="/">
                        <Home className="mr-2 h-4 w-4" />
                        Về trang chủ
                      </Link>
                    </Button>
                  </div>
                </div>
              )}

            {/* 4. PENDING & INITIATED: "Đang xác nhận thanh toán" */}
            {!isTimeout &&
              (currentStatus === "PENDING" ||
                currentStatus === "PENDING_PAYMENT") &&
              (!latestPayStatus || latestPayStatus === "INITIATED") && (
                <div
                  data-testid="payment-result-confirming"
                  className="space-y-6"
                >
                  <div className="w-20 h-20 bg-amber-100 text-amber-600 dark:bg-amber-950/60 dark:text-amber-400 rounded-full flex items-center justify-center mx-auto shadow-inner">
                    <RotateCw className="h-10 w-10 animate-spin" />
                  </div>
                  <div className="space-y-2">
                    <h1 className="text-2xl sm:text-3xl font-extrabold tracking-tight text-foreground">
                      Đang xác nhận thanh toán
                    </h1>
                    <p className="text-muted-foreground text-sm max-w-md mx-auto">
                      Hệ thống đang đồng bộ dữ liệu giao dịch từ cổng thanh toán. Vui lòng không đóng trang.
                    </p>
                  </div>

                  <div className="p-4 bg-muted/40 rounded-xl border max-w-md mx-auto text-xs text-muted-foreground">
                    <div className="flex items-center justify-between mb-2 font-medium text-foreground">
                      <span>Mã đơn: {orderId.slice(0, 8)}</span>
                      {order && (
                        <span className="font-extrabold text-primary">
                          {formatVnd(order.totalAmount)}
                        </span>
                      )}
                    </div>
                    <span>Trạng thái máy chủ: Đang chờ xác nhận giao dịch</span>
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
                    <Button
                      asChild
                      variant="ghost"
                      className="w-full sm:w-auto"
                    >
                      <Link href={`/orders/${orderId}`}>
                        Quay lại đơn hàng
                      </Link>
                    </Button>
                  </div>
                </div>
              )}

            {/* 5. NEEDS_REVIEW: "Đơn đang được kiểm tra" */}
            {currentStatus === "NEEDS_REVIEW" && (
              <div data-testid="payment-result-review" className="space-y-6">
                <div className="w-20 h-20 bg-amber-100 text-amber-600 dark:bg-amber-950/60 dark:text-amber-400 rounded-full flex items-center justify-center mx-auto shadow-inner">
                  <Info className="h-10 w-10" />
                </div>
                <div className="space-y-2">
                  <h1 className="text-2xl sm:text-3xl font-extrabold tracking-tight text-foreground">
                    Đơn đang được kiểm tra
                  </h1>
                  <p className="text-muted-foreground text-sm max-w-md mx-auto">
                    Giao dịch đã được ghi nhận nhưng cần nhân viên kiểm tra hoặc đối soát. Vui lòng liên hệ ban tổ chức để được hỗ trợ. Không tự ý thanh toán lại.
                  </p>
                </div>

                <div className="flex flex-col sm:flex-row items-center justify-center gap-3 pt-4">
                  <Button asChild size="lg" className="w-full sm:w-auto">
                    <Link href={`/orders/${orderId}`}>
                      Xem chi tiết đơn hàng
                    </Link>
                  </Button>
                  <Button
                    asChild
                    variant="outline"
                    size="lg"
                    className="w-full sm:w-auto"
                  >
                    <Link href="/">
                      <Home className="mr-2 h-4 w-4" />
                      Về trang chủ
                    </Link>
                  </Button>
                </div>
              </div>
            )}

            {/* 6. EXPIRED: "Đơn đã hết hạn" */}
            {currentStatus === "EXPIRED" && (
              <div
                data-testid="payment-result-failed"
                className="space-y-6"
              >
                <div className="w-20 h-20 bg-destructive/10 text-destructive rounded-full flex items-center justify-center mx-auto shadow-inner">
                  <CircleAlert className="h-10 w-10" />
                </div>
                <div className="space-y-2">
                  <h1 className="text-2xl sm:text-3xl font-extrabold tracking-tight text-foreground">
                    Đơn đã hết hạn
                  </h1>
                  <p className="text-muted-foreground text-sm max-w-md mx-auto">
                    Thời gian thanh toán cho đơn hàng này đã kết thúc. Các ghế đã được giải phóng để người khác có thể chọn.
                  </p>
                </div>

                <div className="flex flex-col sm:flex-row items-center justify-center gap-3 pt-4">
                  {order ? (
                    <Button asChild size="lg" className="w-full sm:w-auto">
                      <Link href={`/shows/${order.showtime.id}/seats`}>
                        <RotateCw className="mr-2 h-4 w-4" />
                        Chọn lại ghế mới
                      </Link>
                    </Button>
                  ) : (
                    <Button asChild size="lg" className="w-full sm:w-auto">
                      <Link href="/">
                        <Home className="mr-2 h-4 w-4" />
                        Về trang chủ
                      </Link>
                    </Button>
                  )}
                  <Button
                    asChild
                    variant="outline"
                    size="lg"
                    className="w-full sm:w-auto"
                  >
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
