import { describe, expect, it } from "vitest";
import {
  decodePayResponse,
  decodeOrderDetail,
  type PayResponse,
} from "@/lib/contracts/orders";

describe("Payment and Result Contracts (S-18)", () => {
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
