import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module.js';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { metrics } from './monitoring/metrics.js';
import { validatePaymentGatewayConfig } from './payments/payments-config.validator.js';

async function bootstrap() {
  validatePaymentGatewayConfig();
  const app = await NestFactory.create<NestExpressApplication>(AppModule, {
    bodyParser: false,
  });
  app.use(metrics.middleware);
  app.useBodyParser('json', { limit: '5mb' });
  app.enableShutdownHooks();
  await app.listen(process.env.PORT ?? 3001, '0.0.0.0');
}
await bootstrap();
