import { ApiError, object } from "@/lib/api/client";

export type OrderStatus =
  | "PENDING"
  | "PENDING_PAYMENT"
  | "PAID"
  | "EXPIRED"
  | "CANCELLED"
  | "NEEDS_REVIEW";

export type OrderResult = {
  serverTime: string;
  created: boolean;
  order: {
    id: string;
    status: OrderStatus;
    paymentExpiresAt: string;
    totalAmount: number;
    items: {
      seatId: string;
      row: string;
      seatNumber: number;
      categoryName: string;
      unitPrice: number;
    }[];
  };
};

export type OrderItem = {
  id: string;
  seatId: string;
  row: string;
  seatNumber: number;
  label: string;
  tierName: string;
  unitPrice: number;
};

export type LatestPaymentInfo = {
  id: string;
  status: "INITIATED" | "SUCCEEDED" | "FAILED" | "AMOUNT_MISMATCH" | "LATE";
  attemptNo: number;
  amount?: number;
  gateway?: string;
  transactionId?: string | null;
  createdAt?: string;
};

export type OrderDetail = {
  id: string;
  status: OrderStatus;
  rawStatus: string;
  totalAmount: number;
  expiresAt: string;
  serverTime: string;
  remainingSeconds: number;
  isExpired: boolean;
  createdAt: string;
  event: {
    id: string;
    name: string;
    description: string;
    location: string;
    posterPath: string | null;
    bannerPath: string | null;
  };
  showtime: {
    id: string;
    startTime: string;
  };
  items: OrderItem[];
  latestPayment?: LatestPaymentInfo | null;
  paymentAttempts?: number;
};

const invalid = (field?: string): never => {
  throw new ApiError(
    `Không đọc được dữ liệu đơn hàng${field ? `: ${field}` : ""}.`,
    502,
    "INVALID_RESPONSE",
  );
};

const text = (value: unknown): string =>
  typeof value === "string" && value.length > 0 ? value : invalid();
const time = (value: unknown): string => {
  const result = text(value);
  return Number.isFinite(Date.parse(result)) ? result : invalid();
};
const money = (value: unknown): number =>
  typeof value === "number" &&
  Number.isSafeInteger(value) &&
  value >= 0
    ? value
    : invalid();

const orderStatus = (value: unknown): OrderStatus =>
  value === "PENDING_PAYMENT" ||
  value === "PENDING" ||
  value === "PAID" ||
  value === "EXPIRED" ||
  value === "CANCELLED" ||
  value === "NEEDS_REVIEW"
    ? value
    : invalid();

export function decodeOrder(value: unknown): OrderResult {
  const result = object(value);
  const order = object(result.order);
  if (
    typeof result.created !== "boolean" ||
    !Array.isArray(order.items) ||
    order.items.length === 0
  )
    return invalid();
  const items = order.items.map((value) => {
    const item = object(value);
    const seat = object(item.seat);
    return {
      seatId: text(item.seatId),
      row: text(seat.row),
      seatNumber:
        Number.isInteger(seat.seatNumber) && Number(seat.seatNumber) > 0
          ? Number(seat.seatNumber)
          : invalid(),
      categoryName: text(item.categoryName ?? item.tierName),
      unitPrice: money(item.unitPrice),
    };
  });
  if (new Set(items.map((item) => item.seatId)).size !== items.length)
    return invalid();
  return {
    serverTime: time(result.serverTime),
    created: result.created,
    order: {
      id: text(order.id),
      status: orderStatus(order.status),
      paymentExpiresAt: time(order.paymentExpiresAt ?? order.expiresAt),
      totalAmount: money(order.totalAmount),
      items,
    },
  };
}

export function decodePendingOrder(value: unknown): OrderResult {
  const result = decodeOrder(value);
  return result.order.status === "PENDING_PAYMENT" ||
    result.order.status === "PENDING"
    ? result
    : invalid();
}

export function decodeOrderDetail(value: unknown): OrderDetail {
  const o = object(value);
  if (
    typeof o.id !== "string" ||
    typeof o.status !== "string" ||
    typeof o.totalAmount !== "number" ||
    (typeof o.expiresAt !== "string" && typeof o.paymentExpiresAt !== "string") ||
    typeof o.serverTime !== "string" ||
    typeof o.remainingSeconds !== "number" ||
    typeof o.isExpired !== "boolean" ||
    typeof o.createdAt !== "string"
  ) {
    return invalid();
  }

  const eventObj = object(o.event);
  if (
    typeof eventObj.id !== "string" ||
    typeof eventObj.name !== "string" ||
    typeof eventObj.location !== "string"
  ) {
    return invalid("event");
  }

  const showtimeObj = object(o.showtime);
  if (
    typeof showtimeObj.id !== "string" ||
    typeof showtimeObj.startTime !== "string"
  ) {
    return invalid("showtime");
  }

  if (!Array.isArray(o.items)) {
    return invalid("items");
  }

  const items: OrderItem[] = o.items.map((itemRaw) => {
    const item = object(itemRaw);
    if (
      typeof item.id !== "string" ||
      typeof item.seatId !== "string" ||
      typeof item.row !== "string" ||
      typeof item.seatNumber !== "number" ||
      typeof item.label !== "string" ||
      (typeof item.tierName !== "string" && typeof item.categoryName !== "string") ||
      typeof item.unitPrice !== "number"
    ) {
      return invalid("item");
    }
    return {
      id: item.id,
      seatId: item.seatId,
      row: item.row,
      seatNumber: item.seatNumber,
      label: item.label,
      tierName: (item.tierName ?? item.categoryName) as string,
      unitPrice: item.unitPrice,
    };
  });

  const expiresAt = (o.expiresAt ?? o.paymentExpiresAt) as string;

  return {
    id: o.id,
    status: (o.status === "PENDING_PAYMENT" ? "PENDING" : o.status) as OrderStatus,
    rawStatus: typeof o.rawStatus === "string" ? o.rawStatus : (o.status as string),
    totalAmount: o.totalAmount,
    expiresAt,
    serverTime: o.serverTime,
    remainingSeconds: o.remainingSeconds,
    isExpired: o.isExpired,
    createdAt: o.createdAt,
    event: {
      id: eventObj.id,
      name: eventObj.name,
      description:
        typeof eventObj.description === "string" ? eventObj.description : "",
      location: eventObj.location,
      posterPath:
        typeof eventObj.posterPath === "string" ? eventObj.posterPath : null,
      bannerPath:
        typeof eventObj.bannerPath === "string" ? eventObj.bannerPath : null,
    },
    showtime: {
      id: showtimeObj.id,
      startTime: showtimeObj.startTime,
    },
    items,
    latestPayment: decodeLatestPayment(o.latestPayment),
    paymentAttempts: typeof o.paymentAttempts === "number" ? o.paymentAttempts : 0,
  };
}

export type PayResponse = {
  redirectUrl: string;
  gatewayRef: string;
  paymentId: string;
};

export function decodePayResponse(value: unknown): PayResponse {
  const o = object(value);
  if (
    typeof o.redirectUrl !== "string" ||
    typeof o.gatewayRef !== "string" ||
    typeof o.paymentId !== "string"
  ) {
    throw new ApiError(
      "Không đọc được thông tin khởi tạo thanh toán.",
      502,
      "INVALID_RESPONSE",
    );
  }
  return {
    redirectUrl: o.redirectUrl,
    gatewayRef: o.gatewayRef,
    paymentId: o.paymentId,
  };
}

function decodeLatestPayment(value: unknown): LatestPaymentInfo | null {
  if (!value) return null;
  const p = object(value);
  if (
    typeof p.id !== "string" ||
    typeof p.status !== "string" ||
    typeof p.attemptNo !== "number"
  ) {
    return null;
  }
  return {
    id: p.id,
    status: p.status as LatestPaymentInfo["status"],
    attemptNo: p.attemptNo,
    amount: typeof p.amount === "number" ? p.amount : undefined,
    gateway: typeof p.gateway === "string" ? p.gateway : undefined,
    transactionId:
      typeof p.transactionId === "string" ? p.transactionId : null,
    createdAt: typeof p.createdAt === "string" ? p.createdAt : undefined,
  };
}

export type OrderStatusResult = {
  id: string;
  orderId: string;
  status: OrderStatus;
  expiresAt: string;
  paymentExpiresAt: string;
  serverTime: string;
  latestPayment: LatestPaymentInfo | null;
};

export function decodeOrderStatus(value: unknown): OrderStatusResult {
  const o = object(value);
  const id =
    typeof o.id === "string"
      ? o.id
      : typeof o.orderId === "string"
        ? o.orderId
        : invalid("id");
  const orderId = typeof o.orderId === "string" ? o.orderId : id;
  const rawStatus = orderStatus(o.status);
  const status = (rawStatus === "PENDING_PAYMENT" ? "PENDING" : rawStatus) as OrderStatus;
  const expiresAt =
    typeof o.expiresAt === "string"
      ? o.expiresAt
      : typeof o.paymentExpiresAt === "string"
        ? o.paymentExpiresAt
        : invalid("expiresAt");
  const paymentExpiresAt =
    typeof o.paymentExpiresAt === "string" ? o.paymentExpiresAt : expiresAt;
  const serverTime =
    typeof o.serverTime === "string" ? o.serverTime : invalid("serverTime");

  return {
    id,
    orderId,
    status,
    expiresAt,
    paymentExpiresAt,
    serverTime,
    latestPayment: decodeLatestPayment(o.latestPayment),
  };
}
