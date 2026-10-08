import { Module } from '@nestjs/common';
import { WaitingController } from './waiting.controller.js';
import { WaitingService } from './waiting.service.js';
import { WaitingAdmissionGuard } from './waiting.guard.js';

@Module({
  controllers: [WaitingController],
  providers: [WaitingService, WaitingAdmissionGuard],
  exports: [WaitingService, WaitingAdmissionGuard],
})
export class WaitingModule {}
