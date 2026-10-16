import { HttpException } from '@nestjs/common';
import type { ExecutionContext } from '@nestjs/common';
import { WaitingAdmissionGuard } from './waiting.guard.js';

function context(overrides: Record<string, unknown> = {}): ExecutionContext {
  const request = {
    params: { id: 'showtime-1' },
    user: { id: 'buyer-1' },
    sessionToken: 'session-token',
    ...overrides,
  };
  return {
    switchToHttp: () => ({ getRequest: () => request }),
  } as unknown as ExecutionContext;
}

describe('S-40 WaitingAdmissionGuard', () => {
  it('allows an admitted buyer through', async () => {
    const waiting = {
      memberKey: () => 'buyer-1:session',
      requireAdmission: async () => ({
        admitted: true,
        activeCount: 2,
        queueTotal: 0,
      }),
    };
    await expect(
      new WaitingAdmissionGuard(waiting as never).canActivate(context()),
    ).resolves.toBe(true);
  });

  it('returns 429 with position and bounded queue data for a waiting buyer', async () => {
    const waiting = {
      memberKey: () => 'buyer-1:session',
      requireAdmission: async () => ({
        admitted: false,
        position: 3,
        activeCount: 2,
        queueTotal: 4,
      }),
    };
    try {
      await new WaitingAdmissionGuard(waiting as never).canActivate(context());
      throw new Error('expected WAITING_ROOM');
    } catch (error) {
      expect(error).toBeInstanceOf(HttpException);
      const exception = error as HttpException;
      expect(exception.getStatus()).toBe(429);
      expect(exception.getResponse()).toMatchObject({
        code: 'WAITING_ROOM',
        position: 3,
      });
    }
  });

  it('does not gate requests without a showtime or authenticated buyer', async () => {
    const waiting = {
      memberKey: () => 'never-called',
      requireAdmission: async () => {
        throw new Error('must not be called');
      },
    };
    const guard = new WaitingAdmissionGuard(waiting as never);
    await expect(
      guard.canActivate(context({ params: {}, user: undefined })),
    ).resolves.toBe(true);
  });
});
