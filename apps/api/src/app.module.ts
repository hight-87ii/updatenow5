import { Module } from '@nestjs/common';
import { APP_FILTER } from '@nestjs/core';
import { ConfigModule } from '@nestjs/config';
import { resolve } from 'node:path';
import { AppController } from './app.controller.js';
import { AppService } from './app.service.js';
import { PrismaModule } from './prisma/prisma.module.js';
import { RedisModule } from './redis/redis.module.js';
import { AuthModule } from './auth/auth.module.js';
import { UsersModule } from './users/users.module.js';
import { EventsModule } from './events/events.module.js';
import { ShowtimesModule } from './showtimes/showtimes.module.js';
import { HoldsModule } from './holds/holds.module.js';
import { OrdersModule } from './orders/orders.module.js';
import { PaymentsModule } from './payments/payments.module.js';
import { MonitoringModule } from './monitoring/monitoring.module.js';
import { WaitingModule } from './waiting/waiting.module.js';
import { WebhookSecurityFilter } from './payments/webhook-security.filter.js';

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      envFilePath: resolve(process.cwd(), '../../.env'),
    }),
    PrismaModule,
    RedisModule,
    AuthModule,
    UsersModule,
    EventsModule,
    ShowtimesModule,
    HoldsModule,
    OrdersModule,
    PaymentsModule,
    MonitoringModule,
    WaitingModule,
  ],
  controllers: [AppController],
  providers: [
    AppService,
    {
      provide: APP_FILTER,
      useClass: WebhookSecurityFilter,
    },
  ],
})
export class AppModule {}
