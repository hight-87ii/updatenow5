"use client";

import { useEffect, useState, useRef, useCallback } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  Clock3,
  CircleAlert,
  ArrowLeft,
  RotateCw,
  Armchair,
  MapPin,
  CalendarDays,
  Ticket,
  Theater,
  Close,
} from "@/components/ui/material-icon";
import { Button } from "@/components/ui/button";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Table,
  TableHeader,
  TableBody,
  TableHead,
  TableRow,
  TableCell,
} from "@/components/ui/table";
import { PublicLayout } from "@/components/layout/product-layout";
import { api, ApiError } from "@/lib/api/client";
import { loadCurrentUser } from "@/lib/api";
import {
  decodeOrderDetail,
  decodePayResponse,
  decodeApplyDiscountResponse,
  type OrderDetail,
} from "@/lib/contracts/orders";
import { formatVnd, formatShowtime } from "@/lib/formatting";
import {
  countdownLabel,
  remainingSeconds,
  type ServerClock,
} from "@/features/seat-selection/server-countdown";
import { Input } from "@/components/ui/input";

export interface OrderReviewProps {
  id: string;
  onPay?: () => void;
}

export function OrderReview({ id, onPay }: OrderReviewProps) {
  const router = useRouter();
  const [order, setOrder] = useState<OrderDetail | null>(null);
  const [clock, setClock] = useState<ServerClock | null>(null);
  const [remaining, setRemaining] = useState<number>(0);
  const [expired, setExpired] = useState<boolean>(false);
  const [loading, setLoading] = useState<boolean>(true);
  const [error, setError] = useState<string>("");
  const [unauthorized, setUnauthorized] = useState<boolean>(false);
  const [notFound, setNotFound] = useState<boolean>(false);
  const [paying, setPaying] = useState<boolean>(false);
  const [payError, setPayError] = useState<string>("");
  const [discountCode, setDiscountCode] = useState<string>("");
  const [applyingDiscount, setApplyingDiscount] = useState<boolean>(false);
  const [discountError, setDiscountError] = useState<string>("");
  const [discountSuccess, setDiscountSuccess] = useState<string>("");
  const alive = useRef(true);

  const refresh = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const data = await api(`/orders/${id}`, decodeOrderDetail);
      setOrder(data);
      const serverAnchor: ServerClock = {
        serverMs: Date.parse(data.serverTime),
        receivedAt: performance.now(),
      };
      setClock(serverAnchor);
      const rem = remainingSeconds(
        data.expiresAt,
        serverAnchor,
        serverAnchor.receivedAt,
      );
      setRemaining(rem);
      setExpired(data.isExpired || rem <= 0);
    } catch (err) {
      if (err instanceof ApiError && (err.status === 404 || err.status === 403)) {
        setNotFound(true);
      } else {
        setError(
          err instanceof Error
            ? err.message
            : "Không thể tải thông tin đơn hàng. Vui lòng thử lại.",
        );
      }
    } finally {
      setLoading(false);
    }
  }, [id]);

  useEffect(() => {
    alive.current = true;
    const controller = new AbortController();

    async function load() {
      const user = await loadCurrentUser();
      if (controller.signal.aborted) return;
      if (!user) {
        setUnauthorized(true);
        setLoading(false);
        return;
      }

      const data = await api(`/orders/${id}`, decodeOrderDetail, {
        signal: controller.signal,
      });
      if (controller.signal.aborted) return;
      setOrder(data);

      const serverAnchor: ServerClock = {
        serverMs: Date.parse(data.serverTime),
        receivedAt: performance.now(),
      };
      setClock(serverAnchor);

      const rem = remainingSeconds(
        data.expiresAt,
        serverAnchor,
        serverAnchor.receivedAt,
      );
      setRemaining(rem);
      setExpired(data.isExpired || rem <= 0);
      setLoading(false);
    }

    void load().catch((err: unknown) => {
      if (controller.signal.aborted) return;
      if (
        err instanceof ApiError &&
        (err.status === 404 || err.status === 403)
      ) {
        setNotFound(true);
      } else if (err instanceof ApiError && err.status === 401) {
        setUnauthorized(true);
      } else {
        setError(
          err instanceof Error
            ? err.message
            : "Không thể tải thông tin đơn hàng. Vui lòng thử lại.",
        );
      }
      setLoading(false);
    });

    return () => {
      alive.current = false;
      controller.abort();
    };
  }, [id]);

  // Live countdown timer based on server clock synchronization
  useEffect(() => {
    if (!order || expired || !clock) return;
    const interval = setInterval(() => {
      const rem = remainingSeconds(order.expiresAt, clock, performance.now());
      setRemaining(rem);
      if (rem <= 0) {
        setExpired(true);
        clearInterval(interval);
      }
    }, 1000);
    return () => clearInterval(interval);
  }, [order, expired, clock]);

  const defaultPayHandler = async () => {
    if (onPay) {
      onPay();
      return;
    }
    if (paying) return;
    setPaying(true);
    setPayError("");
    try {
      const result = await api(`/orders/${id}/pay`, decodePayResponse, {
        method: "POST",
      });
      if (result.redirectUrl) {
        window.location.href = result.redirectUrl;
      }
    } catch (err) {
      setPayError(
        err instanceof Error
          ? err.message
          : "Không thể khởi tạo thanh toán. Vui lòng thử lại.",
      );
      setPaying(false);
    }
  };

  const handleApplyDiscount = async () => {
    const code = discountCode.trim().toUpperCase();
    if (!code) {
      setDiscountError("Vui lòng nhập mã giảm giá.");
      return;
    }
    setApplyingDiscount(true);
    setDiscountError("");
    setDiscountSuccess("");
    try {
      const result = await api(
        `/orders/${id}/discount`,
        decodeApplyDiscountResponse,
        {
          method: "POST",
          body: JSON.stringify({ code }),
        },
      );
      setOrder((prev) =>
        prev
          ? {
              ...prev,
              totalAmount: result.finalTotal,
              discountAmount: result.discountAmount,
              discountCode: result.discountCode,
            }
          : null,
      );
      setDiscountSuccess(`Đã áp dụng mã "${result.discountCode.code}" giảm ${formatVnd(result.discountAmount)}.`);
      setDiscountCode("");
    } catch (err) {
      setDiscountError(
        err instanceof Error
          ? err.message
          : "Không thể áp dụng mã giảm giá. Vui lòng thử lại.",
      );
    } finally {
      setApplyingDiscount(false);
    }
  };

  const handleRemoveDiscount = async () => {
    if (!order?.discountCode) return;
    setApplyingDiscount(true);
    setDiscountError("");
    try {
      await api(`/orders/${id}/discount`, () => undefined, {
        method: "DELETE",
      });
      setOrder((prev) =>
        prev
          ? {
              ...prev,
              totalAmount: prev.totalAmount + prev.discountAmount,
              discountAmount: 0,
              discountCode: null,
            }
          : null,
      );
      setDiscountSuccess("Đã xoá mã giảm giá.");
    } catch (err) {
      setDiscountError(
        err instanceof Error
          ? err.message
          : "Không thể xoá mã giảm giá. Vui lòng thử lại.",
      );
    } finally {
      setApplyingDiscount(false);
    }
  };

  return (
    <PublicLayout signedIn={!unauthorized}>
      <main className="order-review-container max-w-4xl mx-auto px-4 py-8">
        {loading && (
          <div className="space-y-6" data-testid="order-loading">
            <Skeleton className="h-10 w-48" />
            <Skeleton className="h-32 w-full rounded-xl" />
            <Skeleton className="h-64 w-full rounded-xl" />
          </div>
        )}

        {unauthorized && (
          <div className="py-12 text-center" data-testid="order-unauthorized">
            <Alert variant="destructive" className="max-w-md mx-auto mb-6">
              <CircleAlert className="h-4 w-4" />
              <AlertTitle>Cần đăng nhập</AlertTitle>
              <AlertDescription>
                Bạn cần đăng nhập tài khoản người mua để xem chi tiết đơn hàng này.
              </AlertDescription>
            </Alert>
            <Button
              onClick={() =>
                router.replace(
                  `/login?returnTo=${encodeURIComponent(`/orders/${id}`)}`,
                )
              }
            >
              Đăng nhập ngay
            </Button>
          </div>
        )}

        {notFound && (
          <div className="py-12 text-center" data-testid="order-not-found">
            <Alert variant="destructive" className="max-w-md mx-auto mb-6">
              <CircleAlert className="h-4 w-4" />
              <AlertTitle>Không tìm thấy đơn hàng</AlertTitle>
              <AlertDescription>
                Đơn hàng không tồn tại hoặc bạn không có quyền xem đơn hàng này.
              </AlertDescription>
            </Alert>
            <Button variant="outline" asChild>
              <Link href="/">
                <ArrowLeft className="mr-2 h-4 w-4" /> Về trang chủ
              </Link>
            </Button>
          </div>
        )}

        {error && (
          <div className="py-8" data-testid="order-error">
            <Alert variant="destructive" className="mb-4">
              <CircleAlert className="h-4 w-4" />
              <AlertTitle>Có lỗi xảy ra</AlertTitle>
              <AlertDescription>{error}</AlertDescription>
            </Alert>
            <Button onClick={() => void refresh()}>
              <RotateCw className="mr-2 h-4 w-4" /> Thử lại
            </Button>
          </div>
        )}

        {!loading && !unauthorized && !notFound && !error && order && (
          <div className="space-y-6" data-testid="order-detail">
            {/* Page Header */}
            <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4 border-b pb-4">
              <div>
                <div className="flex items-center gap-2 mb-1">
                  <Link
                    href={`/shows/${order.showtime.id}/seats`}
                    className="text-muted-foreground hover:text-foreground text-sm flex items-center gap-1"
                  >
                    <ArrowLeft className="h-4 w-4" /> Chọn ghế
                  </Link>
                </div>
                <h1 className="text-2xl sm:text-3xl font-bold tracking-tight">
                  Xem lại chi tiết đơn hàng
                </h1>
                <p className="text-sm text-muted-foreground mt-1">
                  Mã đơn hàng: <span className="font-mono">{order.id}</span>
                </p>
              </div>
              <div>
                {expired ? (
                  <Badge
                    variant="destructive"
                    className="text-sm px-3 py-1 font-semibold"
                    data-testid="status-expired-badge"
                  >
                    Đã hết hạn
                  </Badge>
                ) : order.status === "PAID" ? (
                  <Badge
                    variant="secondary"
                    className="text-sm px-3 py-1 font-semibold"
                  >
                    Đã thanh toán
                  </Badge>
                ) : (
                  <Badge
                    variant="outline"
                    className="text-sm px-3 py-1 font-semibold border-primary text-primary"
                  >
                    Chờ thanh toán
                  </Badge>
                )}
              </div>
            </div>

            {/* Countdown / Expiration Notice */}
            {expired ? (
              <Alert
                variant="destructive"
                className="bg-destructive/10 border-destructive/30"
                data-testid="expired-notice"
              >
                <CircleAlert className="h-5 w-5 text-destructive" />
                <AlertTitle className="text-base font-bold">
                  Đơn đã hết hạn thanh toán
                </AlertTitle>
                <AlertDescription className="text-sm mt-1">
                  Thời gian giữ chỗ cho đơn hàng này đã kết thúc. Các ghế đã được
                  giải phóng. Vui lòng quay lại sơ đồ ghế để chọn lại.
                </AlertDescription>
              </Alert>
            ) : (
              <div
                className="flex items-center justify-between p-4 rounded-lg bg-secondary/50 border border-secondary text-secondary-foreground"
                data-testid="countdown-banner"
              >
                <div className="flex items-center gap-3">
                  <Clock3 className="h-6 w-6 text-primary animate-pulse" />
                  <div>
                    <strong className="block text-sm font-semibold">
                      Thời gian còn lại để hoàn tất thanh toán
                    </strong>
                    <span className="text-xs text-muted-foreground">
                      Ghế sẽ được giữ cho đến khi hết thời gian đếm ngược.
                    </span>
                  </div>
                </div>
                <div
                  className="font-mono text-2xl font-bold text-primary tracking-wider"
                  data-testid="countdown-timer"
                >
                  {countdownLabel(remaining)}
                </div>
              </div>
            )}

            {/* Event & Showtime Summary */}
            <div className="rounded-xl border bg-card p-5 shadow-sm space-y-4">
              <h2 className="text-lg font-semibold flex items-center gap-2">
                <Ticket className="h-5 w-5 text-primary" />
                Thông tin sự kiện & Suất diễn
              </h2>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4 text-sm">
                <div>
                  <span className="text-xs text-muted-foreground uppercase tracking-wider block">
                    Tên sự kiện
                  </span>
                  <strong className="text-base text-foreground font-semibold">
                    {order.event.name}
                  </strong>
                </div>
                <div>
                  <span className="text-xs text-muted-foreground uppercase tracking-wider block">
                    Thời gian suất diễn
                  </span>
                  <div className="flex items-center gap-1.5 mt-0.5 font-medium">
                    <CalendarDays className="h-4 w-4 text-primary" />
                    <span>{formatShowtime(order.showtime.startTime)}</span>
                  </div>
                </div>
                <div className="md:col-span-2">
                  <span className="text-xs text-muted-foreground uppercase tracking-wider block">
                    Địa điểm tổ chức
                  </span>
                  <div className="flex items-center gap-1.5 mt-0.5 text-muted-foreground">
                    <MapPin className="h-4 w-4 text-primary shrink-0" />
                    <span>{order.event.location}</span>
                  </div>
                </div>
              </div>
            </div>

            {/* Seats Breakdown Table */}
            <div className="rounded-xl border bg-card overflow-hidden shadow-sm">
              <div className="p-4 bg-muted/40 border-b flex items-center justify-between">
                <h2 className="text-lg font-semibold flex items-center gap-2">
                  <Armchair className="h-5 w-5 text-primary" />
                  Danh sách ghế đã chọn ({order.items.length})
                </h2>
                <span className="text-xs text-muted-foreground">
                  Đơn giá niêm yết từ ban tổ chức
                </span>
              </div>
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead className="w-16 text-center">STT</TableHead>
                    <TableHead>Vị trí ghế</TableHead>
                    <TableHead>Hạng ghế</TableHead>
                    <TableHead className="text-right">Đơn giá</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {order.items.map((item, idx) => (
                    <TableRow key={item.id} data-testid={`order-seat-${item.seatId}`}>
                      <TableCell className="text-center text-muted-foreground font-mono text-xs">
                        {idx + 1}
                      </TableCell>
                      <TableCell className="font-semibold">
                        <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded bg-secondary font-mono text-xs text-secondary-foreground">
                          {item.label}
                        </span>
                        <span className="ml-2 text-xs text-muted-foreground">
                          (Hàng {item.row}, Số {item.seatNumber})
                        </span>
                      </TableCell>
                      <TableCell>
                        <Badge variant="outline" className="font-normal text-xs">
                          {item.tierName}
                        </Badge>
                      </TableCell>
                      <TableCell className="text-right font-medium">
                        {formatVnd(item.unitPrice)}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
              <Separator />
              
              {/* Discount Code Input */}
              {!expired && (order.status === "PENDING" || order.status === "PENDING_PAYMENT") && (
                <div className="p-4 bg-muted/30 border-y space-y-3">
                  <div className="flex items-center gap-2">
                    <Theater className="h-5 w-5 text-primary" />
                    <span className="text-sm font-medium">Mã giảm giá</span>
                  </div>
                  {order.discountCode ? (
                    <div className="flex items-center justify-between p-3 bg-green-50 border border-green-200 rounded-lg">
                      <div className="flex items-center gap-2">
                        <Theater className="h-4 w-4 text-green-600" />
                        <div>
                          <div className="text-sm font-medium text-green-800">
                            Mã: {order.discountCode.code}
                          </div>
                          <div className="text-xs text-green-600">
                            {order.discountCode.type === "PERCENTAGE"
                              ? `Giảm ${order.discountCode.value}%`
                              : `Giảm ${formatVnd(order.discountCode.value)}`}
                          </div>
                        </div>
                      </div>
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={handleRemoveDiscount}
                        disabled={applyingDiscount}
                        className="text-red-600 hover:text-red-700"
                      >
                        <Close className="h-4 w-4 mr-1" /> Xoá
                      </Button>
                    </div>
                  ) : (
                    <div className="flex gap-2">
                      <Input
                        type="text"
                        placeholder="Nhập mã giảm giá"
                        value={discountCode}
                        onChange={(e) => setDiscountCode(e.target.value.toUpperCase())}
                        onKeyDown={(e) => e.key === "Enter" && handleApplyDiscount()}
                        disabled={applyingDiscount}
                        className="flex-1"
                        maxLength={20}
                      />
                      <Button
                        onClick={handleApplyDiscount}
                        disabled={applyingDiscount || !discountCode.trim()}
                        className="whitespace-nowrap"
                      >
                        {applyingDiscount ? (
                          <>
                            <RotateCw className="mr-2 h-4 w-4 animate-spin" />
                            Đang áp dụng...
                          </>
                        ) : (
                          "Áp dụng"
                        )}
                      </Button>
                    </div>
                  )}
                  {discountError && (
                    <p className="text-sm text-destructive" role="alert">
                      {discountError}
                    </p>
                  )}
                  {discountSuccess && (
                    <p className="text-sm text-green-600" role="status">
                      {discountSuccess}
                    </p>
                  )}
                </div>
              )}

              <div className="p-5 bg-card flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
                <div className="text-sm text-muted-foreground">
                  Tổng cộng:{" "}
                  <strong className="text-foreground">
                    {order.items.length} vé
                  </strong>
                </div>
                <div className="text-right w-full sm:w-auto">
                  {order.discountCode && order.discountAmount > 0 ? (
                    <div className="space-y-1">
                      <div className="flex justify-between text-sm">
                        <span className="text-muted-foreground">Tạm tính</span>
                        <span className="text-foreground line-through">
                          {formatVnd(order.totalAmount + order.discountAmount)}
                        </span>
                      </div>
                      <div className="flex justify-between text-sm text-green-600">
                        <span>Giảm giá ({order.discountCode.code})</span>
                        <span>-{formatVnd(order.discountAmount)}</span>
                      </div>
                      <div className="flex justify-between text-xs text-muted-foreground border-t pt-1">
                        <span>Tổng tiền thanh toán</span>
                        <span
                          className="text-2xl sm:text-3xl font-extrabold text-primary"
                          data-testid="total-amount"
                        >
                          {formatVnd(order.totalAmount)}
                        </span>
                      </div>
                    </div>
                  ) : (
                    <div>
                      <span className="text-xs text-muted-foreground uppercase tracking-wider block">
                        Tổng tiền thanh toán
                      </span>
                      <span
                        className="text-2xl sm:text-3xl font-extrabold text-primary"
                        data-testid="total-amount"
                      >
                        {formatVnd(order.totalAmount)}
                      </span>
                    </div>
                  )}
                </div>
              </div>
            </div>

            {/* Pay Error Alert */}
            {payError && (
              <Alert variant="destructive" className="mt-4" data-testid="pay-error-alert">
                <CircleAlert className="h-4 w-4" />
                <AlertTitle>Lỗi thanh toán</AlertTitle>
                <AlertDescription>{payError}</AlertDescription>
              </Alert>
            )}

            {/* Actions */}
            <div className="flex flex-col-reverse sm:flex-row items-center justify-between gap-4 pt-4 border-t">
              <Button
                variant="outline"
                asChild
                className="w-full sm:w-auto"
                disabled={paying}
              >
                <Link href={`/shows/${order.showtime.id}/seats`}>
                  <RotateCw className="mr-2 h-4 w-4" />
                  {expired ? "Chọn lại ghế mới" : "Thay đổi ghế"}
                </Link>
              </Button>

              {/* Pay button is rendered ONLY when pending and not expired */}
              {!expired &&
                (order.status === "PENDING" ||
                  order.status === "PENDING_PAYMENT") && (
                <Button
                  size="lg"
                  className="w-full sm:w-auto min-w-[200px] text-base font-semibold shadow-md"
                  onClick={defaultPayHandler}
                  disabled={paying}
                  data-testid="pay-button"
                >
                  {paying ? (
                    <>
                      <RotateCw className="mr-2 h-4 w-4 animate-spin" />
                      Đang kết nối cổng thanh toán...
                    </>
                  ) : (
                    "Thanh toán ngay"
                  )}
                </Button>
              )}
            </div>
          </div>
        )}
      </main>
    </PublicLayout>
  );
}
