import { describe, expect, it } from "vitest";
import { decodeOrderDetail, type OrderDetail } from "@/lib/contracts/orders";
import { formatVnd, formatShowtime } from "@/lib/formatting";
import {
  countdownLabel,
  remainingSeconds,
  type ServerClock,
} from "@/features/seat-selection/server-countdown";

describe("Order Review contracts and countdown (S-17)", () => {
  const validOrderPayload = {
    id: "55555555-5555-4555-8555-555555555555",
    status: "PENDING",
    rawStatus: "PENDING",
    totalAmount: 1500000,
    expiresAt: "2026-10-07T12:00:00.000Z",
    serverTime: "2026-10-07T11:50:00.000Z",
    remainingSeconds: 600,
    isExpired: false,
    createdAt: "2026-10-07T11:50:00.000Z",
    event: {
      id: "33333333-3333-4333-8333-333333333333",
      name: "Đêm Nhạc Mùa Thu",
      description: "Hòa nhạc đặc biệt",
      location: "Nhà hát Lớn Hà Nội",
      posterPath: "/posters/autumn.jpg",
      bannerPath: null,
    },
    showtime: {
      id: "22222222-2222-4222-8222-222222222222",
      startTime: "2026-11-01T19:30:00.000Z",
    },
    items: [
      {
        id: "item-1",
        seatId: "44444444-4444-4444-8444-444444444441",
        row: "A",
        seatNumber: 1,
        label: "A-1",
        tierName: "VIP",
        unitPrice: 750000,
      },
      {
        id: "item-2",
        seatId: "44444444-4444-4444-8444-444444444442",
        row: "A",
        seatNumber: 2,
        label: "A-2",
        tierName: "VIP",
        unitPrice: 750000,
      },
    ],
  };

  it("decodes valid order response and matches expected types", () => {
    const decoded: OrderDetail = decodeOrderDetail(validOrderPayload);
    expect(decoded.id).toBe("55555555-5555-4555-8555-555555555555");
    expect(decoded.status).toBe("PENDING");
    expect(decoded.totalAmount).toBe(1500000);
    expect(decoded.event.name).toBe("Đêm Nhạc Mùa Thu");
    expect(decoded.items).toHaveLength(2);
    expect(decoded.items[0].label).toBe("A-1");
    expect(decoded.items[0].unitPrice).toBe(750000);
    expect(decoded.isExpired).toBe(false);
  });

  it("rejects malformed or incomplete order response", () => {
    expect(() =>
      decodeOrderDetail({ id: "invalid" }),
    ).toThrow();

    expect(() =>
      decodeOrderDetail({
        ...validOrderPayload,
        items: [{ seatId: "no-tier" }],
      }),
    ).toThrow();
  });

  it("formats order total amount and unit prices correctly in VND", () => {
    expect(formatVnd(1500000)).toBe("1.500.000 ₫");
    expect(formatVnd(750000)).toBe("750.000 ₫");
    expect(formatVnd(0)).toBe("0 ₫");
  });

  it("formats showtime correctly with Vietnamese locale and timezone", () => {
    const formatted = formatShowtime("2026-11-01T19:30:00.000Z");
    expect(formatted).toContain("02/11/2026");
    expect(formatted).toContain("02:30");
  });

  it("calculates server-synchronized remaining seconds and transitions to 0 without page reload", () => {
    const clock: ServerClock = {
      serverMs: Date.parse("2026-10-07T11:50:00.000Z"),
      receivedAt: 100,
    };
    const expiresAt = "2026-10-07T12:00:00.000Z";

    // Immediate
    expect(remainingSeconds(expiresAt, clock, 100)).toBe(600);
    expect(countdownLabel(600)).toBe("10:00");

    // 5 minutes elapsed monotonically
    expect(remainingSeconds(expiresAt, clock, 300100)).toBe(300);
    expect(countdownLabel(300)).toBe("05:00");

    // 10 minutes elapsed (expired)
    expect(remainingSeconds(expiresAt, clock, 600100)).toBe(0);
    expect(countdownLabel(0)).toBe("00:00");

    // Way past expiration: clamped at 0
    expect(remainingSeconds(expiresAt, clock, 900100)).toBe(0);
  });

  it("S-24: decodes order with failed latestPayment and paymentAttempts", () => {
    const payloadWithFailedPayment = {
      ...validOrderPayload,
      paymentAttempts: 2,
      latestPayment: {
        id: "pay-1",
        status: "FAILED",
        attemptNo: 1,
        amount: 1500000,
        gateway: "mock",
        transactionId: "tx-fail-1",
        createdAt: "2026-10-07T11:51:00.000Z",
      },
    };

    const decoded = decodeOrderDetail(payloadWithFailedPayment);
    expect(decoded.paymentAttempts).toBe(2);
    expect(decoded.latestPayment?.status).toBe("FAILED");
    expect(decoded.latestPayment?.attemptNo).toBe(1);
  });

  it("S-24: decodes order with initiated latestPayment", () => {
    const payloadWithInitiatedPayment = {
      ...validOrderPayload,
      paymentAttempts: 1,
      latestPayment: {
        id: "pay-2",
        status: "INITIATED",
        attemptNo: 1,
        amount: 1500000,
        gateway: "mock",
        transactionId: null,
        createdAt: "2026-10-07T11:51:00.000Z",
      },
    };

    const decoded = decodeOrderDetail(payloadWithInitiatedPayment);
    expect(decoded.paymentAttempts).toBe(1);
    expect(decoded.latestPayment?.status).toBe("INITIATED");
  });
});
