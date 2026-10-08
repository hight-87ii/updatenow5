import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { NestFactory } from '@nestjs/core';
import { PrismaModule } from './prisma/prisma.module.js';
import { HoldsService } from './holds/holds.service.js';
import { HoldExpiryScheduler } from './holds/hold-expiry.scheduler.js';
import { MonitoringModule } from './monitoring/monitoring.module.js';
import { OrdersModule } from './orders/orders.module.js';

@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true }),
    PrismaModule,
    MonitoringModule,
    OrdersModule,
  ],
  providers: [HoldsService, HoldExpiryScheduler],
})
class HoldExpiryWorkerModule {}
process.env.HOLD_EXPIRY_MODE = 'worker';
process.env.ORDER_EXPIRY_MODE = 'worker';
const app = await NestFactory.createApplicationContext(HoldExpiryWorkerModule);
app.enableShutdownHooks();
// Private parent-process IPC allows a verifiable graceful stop on Windows too.
process.on('message', (message: unknown) => {
  if (message === 'shutdown')
    void app.close().then(() => {
      if (process.connected) process.disconnect();
    });
});
