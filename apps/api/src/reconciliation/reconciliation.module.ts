import { Module } from '@nestjs/common';
import { ReconciliationController } from './reconciliation.controller.js';
import { ReconciliationService } from './reconciliation.service.js';

@Module({ controllers: [ReconciliationController], providers: [ReconciliationService] })
export class ReconciliationModule {}
