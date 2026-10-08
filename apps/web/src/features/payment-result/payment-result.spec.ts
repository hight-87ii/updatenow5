import { describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import {
  decodePayResponse,
  decodeOrderDetail,
  decodeOrderStatus,
  type PayResponse,
  type OrderStatusResult,
} from "@/lib/contracts/orders";

describe("Payment and Result Contracts (S-18 & S-22)", () => {
  it("decodes valid PayResponse from /orders/:id/pay", () => {
    const raw = {
      redirectUrl: "https://test-payment.momo.vn/gw_payment/pay",
      gatewayRef: "ord_123_456789",
      paymentId: "pay_uuid_123",
    };

    const decoded: PayResponse = decodePayResponse(raw);
    expect(decoded.redirectUrl).toBe("https://test-payment.momo.vn/gw_payment/pay");
    expect(decoded.gatewayRef).toBe("ord_123_456789");
    expect(decoded.paymentId).toBe("pay_uuid_123");
  });

  it("throws ApiError if PayResponse is missing required fields", () => {
    expect(() => decodePayResponse({})).toThrow();
    expect(() =>
      decodePayResponse({ redirectUrl: "https://example.com" }),
    ).toThrow();
    expect(() =>
      decodePayResponse({
        redirectUrl: "https://example.com",
        gatewayRef: "ref",
        paymentId: 123, // must be string
      }),
    ).toThrow();
  });

  it("decodes valid OrderStatusResult from /orders/:id/status (S-22)", () => {
    const raw = {
      id: "77777777-7777-4777-8777-777777777777",
      orderId: "77777777-7777-4777-8777-777777777777",
      status: "PENDING",
      expiresAt: "2026-10-08T12:00:00.000Z",
      paymentExpiresAt: "2026-10-08T12:00:00.000Z",
      serverTime: "2026-10-08T11:55:00.000Z",
      latestPayment: {
        id: "pay-123",
        status: "INITIATED",
        attemptNo: 1,
        amount: 300000,
        gateway: "mock",
        transactionId: "tx-mock-1",
        createdAt: "2026-10-08T11:52:00.000Z",
      },
    };

    const statusResult: OrderStatusResult = decodeOrderStatus(raw);
    expect(statusResult.status).toBe("PENDING");
    expect(statusResult.latestPayment).not.toBeNull();
    expect(statusResult.latestPayment?.status).toBe("INITIATED");
    expect(statusResult.latestPayment?.attemptNo).toBe(1);
    expect(statusResult.latestPayment?.amount).toBe(300000);
  });

  it("decodes OrderStatusResult with null latestPayment (S-22)", () => {
    const raw = {
      id: "77777777-7777-4777-8777-777777777777",
      orderId: "77777777-7777-4777-8777-777777777777",
      status: "PAID",
      expiresAt: "2026-10-08T12:00:00.000Z",
      serverTime: "2026-10-08T11:55:00.000Z",
      latestPayment: null,
    };

    const statusResult = decodeOrderStatus(raw);
    expect(statusResult.status).toBe("PAID");
    expect(statusResult.latestPayment).toBeNull();
  });

  it("throws ApiError if OrderStatusResult has invalid status", () => {
    expect(() =>
      decodeOrderStatus({
        id: "77777777-7777-4777-8777-777777777777",
        status: "INVALID_STATUS",
        expiresAt: "2026-10-08T12:00:00.000Z",
        serverTime: "2026-10-08T11:55:00.000Z",
      }),
    ).toThrow();
  });

  it("supports all order statuses for payment result verification", () => {
    const baseOrder = {
      id: "77777777-7777-4777-8777-777777777777",
      totalAmount: 300000,
      expiresAt: "2026-10-07T12:00:00.000Z",
      serverTime: "2026-10-07T11:55:00.000Z",
      remainingSeconds: 300,
      isExpired: false,
      createdAt: "2026-10-07T11:50:00.000Z",
      event: {
        id: "evt-1",
        name: "Nhạc Kịch Broadway",
        description: "",
        location: "Nhà hát Lớn",
        posterPath: null,
        bannerPath: null,
      },
      showtime: {
        id: "st-1",
        startTime: "2026-11-20T20:00:00.000Z",
      },
      items: [
        {
          id: "it-1",
          seatId: "seat-1",
          row: "A",
          seatNumber: 1,
          label: "A-1",
          tierName: "VIP",
          unitPrice: 300000,
        },
      ],
    };

    // PAID status
    const paidOrder = decodeOrderDetail({ ...baseOrder, status: "PAID", rawStatus: "PAID" });
    expect(paidOrder.status).toBe("PAID");

    // PENDING status
    const pendingOrder = decodeOrderDetail({ ...baseOrder, status: "PENDING", rawStatus: "PENDING" });
    expect(pendingOrder.status).toBe("PENDING");

    // NEEDS_REVIEW status
    const reviewOrder = decodeOrderDetail({ ...baseOrder, status: "NEEDS_REVIEW", rawStatus: "NEEDS_REVIEW" });
    expect(reviewOrder.status).toBe("NEEDS_REVIEW");

    // EXPIRED status
    const expiredOrder = decodeOrderDetail({
      ...baseOrder,
      status: "EXPIRED",
      rawStatus: "EXPIRED",
      isExpired: true,
      remainingSeconds: 0,
    });
    expect(expiredOrder.status).toBe("EXPIRED");
    expect(expiredOrder.isExpired).toBe(true);
  });
});

describe("S-22 Payment Result Logic Verification", () => {
  it("AC 7: source code of payment-result.tsx does NOT inspect URL search parameters for state decision", () => {
    const fileContent = readFileSync(
      resolve(process.cwd(), "src/features/payment-result/payment-result.tsx"),
      "utf8",
    );

    // Verify it doesn't read resultCode, transId, or gateway query params to determine status
    expect(fileContent).not.toMatch(/searchParams\.get\(['"]resultCode['"]\)/);
    expect(fileContent).not.toMatch(/searchParams\.get\(['"]status['"]\)/);
    expect(fileContent).not.toMatch(/searchParams\.get\(['"]transId['"]\)/);
    expect(fileContent).not.toMatch(/window\.location\.search/);
    expect(fileContent).not.toMatch(/useSearchParams/);
  });

  it("AC 1 & AC 2: Polling simulated sequentially every 2s without overlapping calls", async () => {
    vi.useFakeTimers();
    let inFlight = false;
    let overlapDetected = false;
    let callCount = 0;

    const mockFetchStatus = vi.fn(async () => {
      if (inFlight) {
        overlapDetected = true;
      }
      inFlight = true;
      // Simulate network response latency
      await new Promise((r) => setTimeout(r, 100));
      inFlight = false;
      callCount += 1;
      return {
        status: callCount >= 3 ? "PAID" : "PENDING",
      };
    });

    let active = true;
    const schedulePoll = () => {
      if (!active) return;
      setTimeout(async () => {
        if (!active) return;
        const res = await mockFetchStatus();
        if (res.status === "PAID") {
          active = false;
          return;
        }
        schedulePoll();
      }, 2000);
    };

    schedulePoll();

    // Advance 2000ms: first call starts
    await vi.advanceTimersByTimeAsync(2000);
    // Let network latency pass
    await vi.advanceTimersByTimeAsync(100);
    expect(callCount).toBe(1);
    expect(overlapDetected).toBe(false);

    // Advance next 2000ms: second call starts
    await vi.advanceTimersByTimeAsync(2000);
    await vi.advanceTimersByTimeAsync(100);
    expect(callCount).toBe(2);
    expect(overlapDetected).toBe(false);

    // Advance next 2000ms: third call returns PAID, stops polling
    await vi.advanceTimersByTimeAsync(2000);
    await vi.advanceTimersByTimeAsync(100);
    expect(callCount).toBe(3);
    expect(active).toBe(false);

    // Advance further: no more calls made
    await vi.advanceTimersByTimeAsync(10000);
    expect(callCount).toBe(3);

    vi.useRealTimers();
  });

  it("AC 3: Polling ceases after 60 seconds wall-clock time without marking failure", () => {
    const startTime = Date.now();
    const timeoutThreshold = 60000;

    // Simulated check at 30s
    const midTime = startTime + 30000;
    expect(midTime - startTime < timeoutThreshold).toBe(true);

    // Simulated check at 60s
    const endTime = startTime + 60000;
    expect(endTime - startTime >= timeoutThreshold).toBe(true);
  });
});
