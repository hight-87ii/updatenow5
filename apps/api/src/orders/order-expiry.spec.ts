import { describe, it, expect, vi, beforeEach } from 'vitest';
import { OrdersService } from './orders.service.js';
import { OrderExpiryScheduler } from './order-expiry.scheduler.js';
import { ConfigService } from '@nestjs/config';

describe('S-23 Order Expiry & Seat Release', () => {
  let ordersService: OrdersService;
  let mockPrisma: any;

  const mockOrderId = '11111111-2222-3333-4444-555555555555';
  const mockUserId = '22222222-2222-4222-8222-222222222222';
  const mockHoldSessionId = '33333333-3333-4333-8333-333333333333';

  beforeEach(() => {
    mockPrisma = {
      $transaction: vi.fn(async (cb) => cb(mockPrisma)),
      $queryRaw: vi.fn(),
      $executeRaw: vi.fn(),
      order: {
        findUnique: vi.fn(),
        update: vi.fn(),
      },
      seatHold: {
        deleteMany: vi.fn(),
      },
    };
    ordersService = new OrdersService(mockPrisma);
  });

  describe('expireOrder (Unit & Acceptance Criteria)', () => {
    it('AC 1: expires overdue PENDING order, releases held seats, and returns status: expired', async () => {
      // 1. UPDATE orders returns updated order row
      mockPrisma.$queryRaw.mockResolvedValueOnce([
        {
          id: mockOrderId,
          userId: mockUserId,
          holdSessionId: mockHoldSessionId,
        },
      ]);
      // 2. DELETE FROM seat_holds returns count of deleted holds
      mockPrisma.$executeRaw.mockResolvedValueOnce(2);

      const result = await ordersService.expireOrder(mockOrderId);

      expect(result).toEqual({
        status: 'expired',
        orderId: mockOrderId,
        releasedSeatsCount: 2,
      });
      expect(mockPrisma.$queryRaw).toHaveBeenCalledTimes(1);
      expect(mockPrisma.$executeRaw).toHaveBeenCalledTimes(1);
    });

    it('AC 1: rollbacks order status to PENDING if seat release step fails', async () => {
      mockPrisma.$queryRaw.mockResolvedValueOnce([
        {
          id: mockOrderId,
          userId: mockUserId,
          holdSessionId: mockHoldSessionId,
        },
      ]);

      await expect(
        ordersService.expireOrder(mockOrderId, { failOnRelease: true }),
      ).rejects.toThrow(/Simulated seat release error/);

      // Verify transaction callback was called and threw, triggering rollback in DB
      expect(mockPrisma.$queryRaw).toHaveBeenCalledTimes(1);
    });

    it('AC 2: skips order if not yet expired (atomic update returns empty array)', async () => {
      // Not yet expired -> 0 rows updated
      mockPrisma.$queryRaw.mockResolvedValueOnce([]);

      const result = await ordersService.expireOrder(mockOrderId);

      expect(result).toEqual({
        status: 'skipped',
        orderId: mockOrderId,
        reason: expect.stringContaining('not yet expired'),
      });
      // seat holds are untouched
      expect(mockPrisma.$executeRaw).not.toHaveBeenCalled();
    });

    it('AC 3: skips order if already PAID, seats remain sold and holds untouched', async () => {
      // Order is already PAID -> atomic update returns 0 rows
      mockPrisma.$queryRaw.mockResolvedValueOnce([]);

      const result = await ordersService.expireOrder(mockOrderId);

      expect(result.status).toBe('skipped');
      expect(mockPrisma.$executeRaw).not.toHaveBeenCalled();
    });

    it('AC 4: running 3 consecutive times yields idempotent result without error', async () => {
      // First run: order expires
      mockPrisma.$queryRaw.mockResolvedValueOnce([
        {
          id: mockOrderId,
          userId: mockUserId,
          holdSessionId: mockHoldSessionId,
        },
      ]);
      mockPrisma.$executeRaw.mockResolvedValueOnce(2);

      const run1 = await ordersService.expireOrder(mockOrderId);
      expect(run1.status).toBe('expired');

      // Second run: order is already EXPIRED, skipped
      mockPrisma.$queryRaw.mockResolvedValueOnce([]);
      const run2 = await ordersService.expireOrder(mockOrderId);
      expect(run2.status).toBe('skipped');

      // Third run: still skipped
      mockPrisma.$queryRaw.mockResolvedValueOnce([]);
      const run3 = await ordersService.expireOrder(mockOrderId);
      expect(run3.status).toBe('skipped');

      expect(run2).toEqual(run3);
    });

    it('AC 5: skips order in NEEDS_REVIEW status (e.g. amount mismatch)', async () => {
      // Order is NEEDS_REVIEW -> condition status IN (PENDING, PENDING_PAYMENT) returns 0 rows
      mockPrisma.$queryRaw.mockResolvedValueOnce([]);

      const result = await ordersService.expireOrder(mockOrderId);

      expect(result.status).toBe('skipped');
      expect(mockPrisma.$executeRaw).not.toHaveBeenCalled();
    });

    it('AC 6: does not release holds when seats have already been acquired by another user (different holdSessionId)', async () => {
      mockPrisma.$queryRaw.mockResolvedValueOnce([
        {
          id: mockOrderId,
          userId: mockUserId,
          holdSessionId: mockHoldSessionId,
        },
      ]);
      // SQL query filters strictly by holdSessionId, so if only another user holds it, 0 rows deleted
      mockPrisma.$executeRaw.mockResolvedValueOnce(0);

      const result = await ordersService.expireOrder(mockOrderId);

      expect(result).toEqual({
        status: 'expired',
        orderId: mockOrderId,
        releasedSeatsCount: 0,
      });
    });
  });

  describe('processExpiredOrdersBatch', () => {
    it('queries candidate overdue orders and processes each in its own transaction', async () => {
      // Candidates query returns 2 orders
      mockPrisma.$queryRaw.mockResolvedValueOnce([
        { id: 'order-1' },
        { id: 'order-2' },
      ]);

      // Order 1 expires successfully
      mockPrisma.$queryRaw.mockResolvedValueOnce([
        { id: 'order-1', userId: mockUserId, holdSessionId: 'hold-1' },
      ]);
      mockPrisma.$executeRaw.mockResolvedValueOnce(1);

      // Order 2 is skipped (already paid or concurrent)
      mockPrisma.$queryRaw.mockResolvedValueOnce([]);

      const batchResult = await ordersService.processExpiredOrdersBatch(100);

      expect(batchResult).toEqual({
        expiredCount: 1,
        skippedCount: 1,
        errorCount: 0,
      });
    });

    it('continues processing remaining orders when an individual order throws an error', async () => {
      mockPrisma.$queryRaw.mockResolvedValueOnce([
        { id: 'order-err' },
        { id: 'order-ok' },
      ]);

      // Order 1 throws an error
      mockPrisma.$queryRaw.mockRejectedValueOnce(new Error('DB deadlock'));

      // Order 2 succeeds
      mockPrisma.$queryRaw.mockResolvedValueOnce([
        { id: 'order-ok', userId: mockUserId, holdSessionId: 'hold-2' },
      ]);
      mockPrisma.$executeRaw.mockResolvedValueOnce(2);

      const batchResult = await ordersService.processExpiredOrdersBatch(100);

      expect(batchResult).toEqual({
        expiredCount: 1,
        skippedCount: 0,
        errorCount: 1,
      });
    });
  });

  describe('OrderExpiryScheduler', () => {
    it('does not start timer when ORDER_EXPIRY_MODE is off', () => {
      const mockConfig = {
        get: vi.fn((key: string) => {
          if (key === 'ORDER_EXPIRY_MODE') return 'off';
          return undefined;
        }),
      } as unknown as ConfigService;

      const scheduler = new OrderExpiryScheduler(ordersService, mockConfig);
      scheduler.onModuleInit();

      // No tick called, no timer set
      expect(mockPrisma.$queryRaw).not.toHaveBeenCalled();
    });

    it('executes tick and schedules interval when enabled', async () => {
      vi.useFakeTimers();
      const mockConfig = {
        get: vi.fn((key: string) => {
          if (key === 'ORDER_EXPIRY_MODE') return 'worker';
          if (key === 'ORDER_EXPIRY_JOB_INTERVAL_SECONDS') return '30';
          return undefined;
        }),
      } as unknown as ConfigService;

      const scheduler = new OrderExpiryScheduler(ordersService, mockConfig);

      // Mock batch query
      mockPrisma.$queryRaw.mockResolvedValue([]);

      scheduler.onModuleInit();
      expect(mockPrisma.$queryRaw).toHaveBeenCalledTimes(1);

      // Advance 30 seconds
      await vi.advanceTimersByTimeAsync(30000);
      expect(mockPrisma.$queryRaw).toHaveBeenCalledTimes(2);

      await scheduler.onModuleDestroy();
      vi.useRealTimers();
    });
  });
});
