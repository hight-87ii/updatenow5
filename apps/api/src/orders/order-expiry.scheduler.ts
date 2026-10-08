import {
  Injectable,
  Logger,
  OnModuleInit,
  OnModuleDestroy,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { OrdersService } from './orders.service.js';

@Injectable()
export class OrderExpiryScheduler implements OnModuleInit, OnModuleDestroy {
  private timer?: ReturnType<typeof setInterval>;
  private running?: Promise<void>;
  private readonly logger = new Logger(OrderExpiryScheduler.name);

  constructor(
    private readonly ordersService: OrdersService,
    private readonly config: ConfigService,
  ) {}

  onModuleInit() {
    const mode =
      this.config.get<string>('ORDER_EXPIRY_MODE') ??
      this.config.get<string>('HOLD_EXPIRY_MODE') ??
      'off';
    if (!['off', 'api', 'worker'].includes(mode)) {
      throw new Error('ORDER_EXPIRY_MODE must be off, api or worker');
    }
    if (mode === 'off') return;

    const intervalSec = parseInt(
      this.config.get<string>('ORDER_EXPIRY_JOB_INTERVAL_SECONDS') ?? '60',
      10,
    );
    const intervalMs = Math.max(1, intervalSec) * 1000;

    void this.tick();
    this.timer = setInterval(() => {
      void this.tick();
    }, intervalMs);
  }

  tick(): Promise<void> {
    if (this.running) return this.running;
    this.running = this.ordersService
      .processExpiredOrdersBatch()
      .then(() => {})
      .catch((err) => {
        this.logger.error(
          JSON.stringify({
            event: 'order_expiry_job_failed',
            message: err instanceof Error ? err.message : String(err),
            retryOnNextInterval: true,
          }),
        );
      })
      .finally(() => {
        this.running = undefined;
      });
    return this.running;
  }

  async onModuleDestroy() {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = undefined;
    }
    await this.running;
  }
}
