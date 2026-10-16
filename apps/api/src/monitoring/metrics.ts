import { Counter, Gauge, Histogram, Registry } from '@prometheus-io/client';
import type { Request, Response, NextFunction } from 'express';

export const latencyBuckets = [
  0.01, 0.025, 0.05, 0.1, 0.15, 0.2, 0.25, 0.3, 0.35, 0.4, 0.5, 0.75, 1, 2, 5,
  10,
];
const methods = new Set([
  'GET',
  'POST',
  'PUT',
  'PATCH',
  'DELETE',
  'HEAD',
  'OPTIONS',
]);
const reasons = ['signature', 'schema', 'replay', 'permission'] as const;
export type WebhookRejectionReason = (typeof reasons)[number];

export class Metrics {
  safe(observe: () => void) {
    if (process.env.MONITORING_ENABLED !== 'true') return;
    try {
      observe();
    } catch {
      /* Business outcomes and worker cadence are independent of telemetry. */
    }
  }
  readonly registry = new Registry();
  readonly requests = new Counter({
    name: 'ticket_http_requests_total',
    help: 'Completed responses; aborted responses use status 499.',
    labelNames: ['method', 'route', 'status'],
    registers: [this.registry],
  });
  readonly duration = new Histogram({
    name: 'ticket_http_request_duration_seconds',
    help: 'Monotonic duration through response finish, including errors and aborts.',
    labelNames: ['method', 'route', 'status'],
    buckets: latencyBuckets,
    registers: [this.registry],
  });
  readonly conflicts = new Counter({
    name: 'ticket_hold_conflicts_total',
    help: 'Failed claim requests with SEAT_CONFLICT, once per response, not seat count.',
    registers: [this.registry],
  });
  readonly webhookRejections = new Counter({
    name: 'ticket_webhook_rejections_total',
    help: 'Hook only: verified producer must call once per rejected request.',
    labelNames: ['reason'],
    registers: [this.registry],
  });
  readonly producer = new Gauge({
    name: 'ticket_producer_available',
    help: '1 means implemented producer; 0 is unavailable, not healthy zero.',
    labelNames: ['subsystem'],
    registers: [this.registry],
  });
  readonly workerEnabled = new Gauge({
    name: 'ticket_worker_enabled',
    help: 'Configured expiry worker mode.',
    registers: [this.registry],
  });
  readonly workerLastSuccess = new Gauge({
    name: 'ticket_worker_last_success_timestamp_seconds',
    help: 'Last successful complete sweep; zero means no success yet and must display Unknown.',
    registers: [this.registry],
  });
  readonly workerDuration = new Histogram({
    name: 'ticket_worker_run_duration_seconds',
    help: 'Expiry sweep duration, including failures.',
    buckets: latencyBuckets,
    registers: [this.registry],
  });
  readonly workerErrors = new Counter({
    name: 'ticket_worker_errors_total',
    help: 'Failed expiry sweeps.',
    registers: [this.registry],
  });
  readonly cleaned = new Counter({
    name: 'ticket_worker_cleaned_holds_total',
    help: 'Expired claims deleted by fenced cleanup.',
    registers: [this.registry],
  });
  readonly waitingExpired = new Counter({
    name: 'ticket_waiting_turns_expired_total',
    help: 'S-40 admission turns pruned after their TTL without activity.',
    registers: [this.registry],
  });
  readonly waitingBlocked = new Counter({
    name: 'ticket_waiting_gate_blocked_total',
    help: 'S-40 hold/order claims rejected with 429 while waiting for a turn.',
    registers: [this.registry],
  });
  constructor() {
    for (const subsystem of ['webhook', 'email_job', 'refund_job'])
      this.producer.set({ subsystem }, 0);
  }
  // This seam does not assert that a webhook subsystem exists.
  rejectWebhook(reason: WebhookRejectionReason) {
    if (!reasons.includes(reason)) return;
    this.safe(() => this.webhookRejections.inc({ reason }));
  }
  noteWaitingExpired(count: number) {
    if (!Number.isInteger(count) || count <= 0) return;
    this.safe(() => this.waitingExpired.inc(count));
  }
  noteWaitingBlocked() {
    this.safe(() => this.waitingBlocked.inc());
  }
  middleware = (req: Request, res: Response, next: NextFunction) => {
    if (process.env.MONITORING_ENABLED !== 'true') return next();
    const start = process.hrtime.bigint();
    let done = false;
    let seatConflict = false;
    const originalJson = res.json;
    res.json = function (body: unknown) {
      // Keep one bounded boolean, never payload, rejected IDs, or exception text.
      seatConflict =
        typeof body === 'object' &&
        body !== null &&
        (body as { code?: unknown }).code === 'SEAT_CONFLICT';
      return originalJson.call(this, body);
    };
    const complete = (aborted: boolean) => {
      if (done) return;
      done = true;
      try {
        const path: unknown = (req.route as { path?: unknown } | undefined)
          ?.path;
        const route = typeof path === 'string' ? path : '__unmatched__';
        if (route === '/health' || route === '/ready' || route === '/metrics')
          return;
        const status = aborted ? '499' : String(res.statusCode);
        const labels = {
          method: methods.has(req.method) ? req.method : 'OTHER',
          route,
          status,
        };
        this.requests.inc(labels);
        this.duration.observe(
          labels,
          Number(process.hrtime.bigint() - start) / 1e9,
        );
        if (
          !aborted &&
          status === '409' &&
          route === '/showtimes/:id/holds' &&
          seatConflict
        )
          this.conflicts.inc();
      } catch {
        /* Telemetry must never fail a business response. */
      }
    };
    res.once('finish', () => complete(false));
    res.once('close', () => complete(!res.writableFinished));
    next();
  };
}
export const metrics = new Metrics();
