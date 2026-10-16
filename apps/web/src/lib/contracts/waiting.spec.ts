import { describe, expect, it } from 'vitest';
import { decodeWaitingStatus } from './waiting';

describe('S-40 waiting-room contract', () => {
  it('decodes an admitted turn with its server deadline', () => {
    expect(
      decodeWaitingStatus({
        state: 'admitted',
        admittedUntil: '2026-10-16T07:00:00.000Z',
        turnRemainingSec: 600,
        activeCount: 2,
        queueTotal: 1,
      }),
    ).toMatchObject({ state: 'admitted', turnRemainingSec: 600 });
  });

  it('decodes a FIFO position and rejects non-positive positions', () => {
    expect(
      decodeWaitingStatus({
        state: 'waiting',
        position: 3,
        activeCount: 2,
        queueTotal: 4,
      }),
    ).toEqual({ state: 'waiting', position: 3, activeCount: 2, queueTotal: 4 });
    expect(() =>
      decodeWaitingStatus({
        state: 'waiting',
        position: 0,
        activeCount: 2,
        queueTotal: 4,
      }),
    ).toThrow('Không đọc được trạng thái phòng chờ');
  });

  it('decodes the no-queue state used to enter seats directly', () => {
    expect(
      decodeWaitingStatus({
        state: 'none',
        activeCount: 0,
        queueTotal: 0,
        queueActive: false,
      }),
    ).toEqual({ state: 'none', activeCount: 0, queueTotal: 0, queueActive: false });
  });
});
