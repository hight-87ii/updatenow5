import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { Redis } from 'ioredis';
import { Inject } from '@nestjs/common';
import { metrics } from '../monitoring/metrics.js';
import { resolveWaitingConfig } from './waiting.config.js';

export type WaitingState =
  | {
      state: 'admitted';
      admittedUntil: string;
      turnRemainingSec: number;
      activeCount: number;
      queueTotal: number;
    }
  | {
      state: 'waiting';
      position: number;
      activeCount: number;
      queueTotal: number;
    }
  | { state: 'none'; activeCount: number; queueTotal: number; queueActive: boolean };

const queueKey = (showtimeId: string): string => `s40:q:${showtimeId}`;
const activeKey = (showtimeId: string): string => `s40:active:${showtimeId}`;

// FIFO waiting room on Redis sorted sets. No background worker: expired turns
// are pruned and promotions happen lazily on every join/status call, so the
// queue stays correct on Render Free where no cron/worker exists.
@Injectable()
export class WaitingService {
  private readonly logger = new Logger(WaitingService.name);
  constructor(
    @Inject('REDIS_CLIENT') private readonly redis: Redis,
    private readonly configService: ConfigService,
  ) {}

  private get activeLimit(): number {
    return resolveWaitingConfig({
      S40_ACTIVE_LIMIT: this.configService.get<string>('S40_ACTIVE_LIMIT'),
      S40_TURN_TTL_SEC: this.configService.get<string>('S40_TURN_TTL_SEC'),
    }).activeLimit;
  }
  private get turnTtlMs(): number {
    return (
      resolveWaitingConfig({
        S40_ACTIVE_LIMIT: this.configService.get<string>('S40_ACTIVE_LIMIT'),
        S40_TURN_TTL_SEC: this.configService.get<string>('S40_TURN_TTL_SEC'),
      }).turnTtlSec * 1000
    );
  }

  memberKey(userId: string, sessionHash: string): string {
    return `${userId}:${sessionHash}`;
  }

  private async pruneAndPromote(
    showtimeId: string,
    now: number,
  ): Promise<{ activeCount: number; queueTotal: number; expiredTurns: number }> {
    const q = queueKey(showtimeId);
    const a = activeKey(showtimeId);
    // S-40b: turns with no activity past their TTL lose their spot here.
    // The pruned count feeds the expired-turn metric; no worker needed.
    const expiredTurns = await this.redis.zremrangebyscore(a, '-inf', now);
    if (expiredTurns > 0) {
      metrics.noteWaitingExpired(expiredTurns);
      this.logger.log(
        JSON.stringify({ event: 'waiting_turn_expired', showtimeId, expiredTurns }),
      );
    }
    let activeCount = await this.redis.zcount(a, now + 1, '+inf');
    // Admit FIFO while free slots exist.
    while (activeCount < this.activeLimit) {
      const next: unknown = await this.redis.zpopmin(q, 1);
      const first = Array.isArray(next) ? next[0] : undefined;
      if (typeof first !== 'string') break;
      await this.redis.zadd(a, now + this.turnTtlMs, first);
      activeCount += 1;
    }
    const queueTotal = await this.redis.zcard(q);
    return { activeCount, queueTotal, expiredTurns };
  }

  async join(showtimeId: string, member: string, now = Date.now()): Promise<WaitingState> {
    try {
      const admitted = await this.redis.zscore(activeKey(showtimeId), member);
      if (admitted !== null && Number(admitted) > now) {
        const { activeCount, queueTotal } = await this.pruneAndPromote(showtimeId, now);
        return {
          state: 'admitted',
          admittedUntil: new Date(Number(admitted)).toISOString(),
          turnRemainingSec: Math.max(0, Math.ceil((Number(admitted) - now) / 1000)),
          activeCount,
          queueTotal,
        };
      }
      // NX keeps the earliest join time: re-join never jumps the queue.
      await this.redis.zadd(queueKey(showtimeId), 'NX', now, member);
      return this.status(showtimeId, member, now);
    } catch {
      return this.failOpen('join');
    }
  }

  async status(showtimeId: string, member: string, now = Date.now()): Promise<WaitingState> {
    try {
      const { activeCount, queueTotal } = await this.pruneAndPromote(showtimeId, now);
      const admitted = await this.redis.zscore(activeKey(showtimeId), member);
      if (admitted !== null && Number(admitted) > now) {
        return {
          state: 'admitted',
          admittedUntil: new Date(Number(admitted)).toISOString(),
          turnRemainingSec: Math.max(0, Math.ceil((Number(admitted) - now) / 1000)),
          activeCount,
          queueTotal,
        };
      }
      const rank = await this.redis.zrank(queueKey(showtimeId), member);
      if (rank === null) {
        return { state: 'none', activeCount, queueTotal, queueActive: queueTotal > 0 };
      }
      return { state: 'waiting', position: rank + 1, activeCount, queueTotal };
    } catch {
      return this.failOpen('status');
    }
  }

  async leave(showtimeId: string, member: string): Promise<{ left: boolean }> {
    try {
      const removed = (await this.redis.zrem(queueKey(showtimeId), member)) +
        (await this.redis.zrem(activeKey(showtimeId), member));
      return { left: removed > 0 };
    } catch {
      this.logger.warn(JSON.stringify({ event: 'waiting_redis_unavailable', op: 'leave' }));
      return { left: false };
    }
  }

  // S-40b: a successful hold claim proves activity, so the turn is extended
  // by one full TTL. Returns false when the turn already expired — the spot
  // is lost and the buyer must rejoin at the back, never resume mid-queue.
  async touch(showtimeId: string, member: string, now = Date.now()): Promise<boolean> {
    try {
      const admitted = await this.redis.zscore(activeKey(showtimeId), member);
      if (admitted === null || Number(admitted) <= now) return false;
      await this.redis.zadd(activeKey(showtimeId), now + this.turnTtlMs, member);
      return true;
    } catch {
      this.logger.warn(JSON.stringify({ event: 'waiting_redis_unavailable', op: 'touch' }));
      // Fail open: a cache blip must not void a hold the DB just confirmed.
      return true;
    }
  }

  // Guard for seat-hold claim: under threshold everyone passes (zero behavior
  // change); over threshold only admitted turns may claim.
  async requireAdmission(
    showtimeId: string,
    member: string,
    now = Date.now(),
  ): Promise<{ admitted: boolean; position?: number; activeCount: number; queueTotal: number }> {
    try {
      const { activeCount, queueTotal } = await this.pruneAndPromote(showtimeId, now);
      if (queueTotal === 0 && activeCount < this.activeLimit) return { admitted: true, activeCount, queueTotal };
      const admitted = await this.redis.zscore(activeKey(showtimeId), member);
      if (admitted !== null && Number(admitted) > now) return { admitted: true, activeCount, queueTotal };
      // A buyer who reaches POST /holds before visiting the waiting page must
      // still receive a real FIFO ticket, not a transient `queueTotal + 1`.
      // NX preserves the original arrival time on retries.
      await this.redis.zadd(queueKey(showtimeId), 'NX', now, member);
      const rank = await this.redis.zrank(queueKey(showtimeId), member);
      return { admitted: false, position: rank === null ? queueTotal + 1 : rank + 1, activeCount, queueTotal };
    } catch {
      this.logger.warn(JSON.stringify({ event: 'waiting_redis_unavailable', op: 'guard' }));
      return { admitted: true, activeCount: 0, queueTotal: 0 };
    }
  }

  private failOpen(op: string): WaitingState {
    this.logger.warn(JSON.stringify({ event: 'waiting_redis_unavailable', op }));
    // Cache (Valkey Free) is ephemeral by design; never block ticket sale on it.
    return { state: 'none', activeCount: 0, queueTotal: 0, queueActive: false };
  }
}
