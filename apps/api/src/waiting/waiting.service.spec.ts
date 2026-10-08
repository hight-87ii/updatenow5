import { ConfigService } from '@nestjs/config';
import { WaitingService } from './waiting.service.js';
import { resolveWaitingConfig } from './waiting.config.js';

// Minimal in-memory Redis sorted-set fake: only the commands WaitingService uses.
function fakeRedis() {
  const sets = new Map<string, Map<string, number>>();
  const get = (key: string): Map<string, number> => {
    let set = sets.get(key);
    if (!set) {
      set = new Map();
      sets.set(key, set);
    }
    return set;
  };
  return {
    async zadd(key: string, ...args: (string | number)[]): Promise<number> {
      const set = get(key);
      // Supports zadd(key, score, member) and zadd(key, 'NX', score, member).
      const nx = args[0] === 'NX';
      const [score, member] = nx ? [args[1], args[2]] : [args[0], args[1]];
      if (nx && set.has(String(member))) return 0;
      set.set(String(member), Number(score));
      return 1;
    },
    async zscore(key: string, member: string): Promise<string | null> {
      const value = get(key).get(member);
      return value === undefined ? null : String(value);
    },
    async zrank(key: string, member: string): Promise<number | null> {
      const ordered = [...get(key).entries()].sort((a, b) => a[1] - b[1] || (a[0] < b[0] ? -1 : 1));
      const index = ordered.findIndex(([m]) => m === member);
      return index < 0 ? null : index;
    },
    async zcard(key: string): Promise<number> {
      return get(key).size;
    },
    async zcount(key: string, min: number | string, max: number | string): Promise<number> {
      const lo = min === '-inf' ? -Infinity : Number(min);
      const hi = max === '+inf' ? Infinity : Number(max);
      return [...get(key).values()].filter((s) => s >= lo && s <= hi).length;
    },
    async zrem(key: string, member: string): Promise<number> {
      return get(key).delete(member) ? 1 : 0;
    },
    async zremrangebyscore(key: string, min: number | string, max: number | string): Promise<number> {
      const lo = min === '-inf' ? -Infinity : Number(min);
      const hi = max === '+inf' ? Infinity : Number(max);
      let removed = 0;
      for (const [m, s] of [...get(key).entries()]) {
        if (s >= lo && s <= hi && get(key).delete(m)) removed += 1;
      }
      return removed;
    },
    async zpopmin(key: string, count: number): Promise<string[]> {
      const set = get(key);
      const ordered = [...set.entries()].sort((a, b) => a[1] - b[1] || (a[0] < b[0] ? -1 : 1));
      const out: string[] = [];
      for (const [m, s] of ordered.slice(0, count)) {
        set.delete(m);
        out.push(m, String(s));
      }
      return out;
    },
  };
}

describe('S-40 waiting room', () => {
  const showtime = '00000000-0000-4000-8000-000000000001';
  const config = new ConfigService({ S40_ACTIVE_LIMIT: '2', S40_TURN_TTL_SEC: '300' });

  // NOTE: limits come from the injected ConfigService (S40_ACTIVE_LIMIT=2 in tests).
  function service() {
    return new WaitingService(fakeRedis() as never, config);
  }

  it('admits everyone under the threshold without queuing', async () => {
    const waiting = service();
    const first = await waiting.join(showtime, 'u1:s1', 1000);
    expect(first.state).toBe('admitted');
    const gate = await waiting.requireAdmission(showtime, ' stranger:s9', 1000);
    expect(gate).toEqual({ admitted: true });
  });

  it('queues FIFO over the threshold and reports positions', async () => {
    const waiting = service();
    await waiting.join(showtime, 'u1:s1', 1000);
    await waiting.join(showtime, 'u2:s2', 1001);
    const third = await waiting.join(showtime, 'u3:s3', 1002);
    expect(third.state).toBe('waiting');
    if (third.state === 'waiting') expect(third.position).toBe(1);
    const fourth = await waiting.join(showtime, 'u4:s4', 1003);
    if (fourth.state === 'waiting') expect(fourth.position).toBe(2);
    const gate = await waiting.requireAdmission(showtime, 'u3:s3', 1002);
    expect(gate.admitted).toBe(false);
    expect(gate.position).toBe(1);
  });

  it('re-join never jumps the queue', async () => {
    const waiting = service();
    await waiting.join(showtime, 'u1:s1', 1000);
    await waiting.join(showtime, 'u2:s2', 1001);
    await waiting.join(showtime, 'u3:s3', 1002);
    const again = await waiting.join(showtime, 'u3:s3', 9999);
    if (again.state === 'waiting') expect(again.position).toBe(1);
    else expect.fail('expected waiting');
  });

  it('expired turns free slots and the next in line is admitted', async () => {
    const waiting = service();
    await waiting.join(showtime, 'u1:s1', 1000);
    await waiting.join(showtime, 'u2:s2', 1001);
    await waiting.join(showtime, 'u3:s3', 1002);
    // turn TTL 300s from t=1000 → expired at t=301000.
    const later = await waiting.status(showtime, 'u3:s3', 302000);
    expect(later.state).toBe('admitted');
  });

  it('leave removes queue entries and frees admission', async () => {
    const waiting = service();
    await waiting.join(showtime, 'u1:s1', 1000);
    await waiting.join(showtime, 'u2:s2', 1001);
    await waiting.join(showtime, 'u3:s3', 1002);
    expect(await waiting.leave(showtime, 'u3:s3')).toEqual({ left: true });
    const gate = await waiting.requireAdmission(showtime, 'u3:s3', 1002);
    expect(gate.admitted).toBe(false);
    expect(gate.position).toBe(1); // rejoins at the back
  });

  it('fails open when Redis is down so sales never block', async () => {
    const broken = {
      zadd: () => Promise.reject(new Error('down')),
      zscore: () => Promise.reject(new Error('down')),
      zrank: () => Promise.reject(new Error('down')),
      zcard: () => Promise.reject(new Error('down')),
      zcount: () => Promise.reject(new Error('down')),
      zrem: () => Promise.reject(new Error('down')),
      zremrangebyscore: () => Promise.reject(new Error('down')),
      zpopmin: () => Promise.reject(new Error('down')),
    };
    const waiting = new WaitingService(broken as never, config);
    expect((await waiting.requireAdmission(showtime, 'u1:s1')).admitted).toBe(true);
    const state = await waiting.status(showtime, 'u1:s1');
    expect(state.state).toBe('none');
  });

  it('config falls back to safe defaults on bad env', () => {
    expect(resolveWaitingConfig({ S40_ACTIVE_LIMIT: 'abc', S40_TURN_TTL_SEC: '-5' } as never))
      .toEqual({ activeLimit: 200, turnTtlSec: 300 });
  });
});
