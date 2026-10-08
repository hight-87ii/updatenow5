import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  CreatePaymentParams,
  CreatePaymentResult,
  PaymentGateway,
  PaymentWebhookEvent,
} from './payment-gateway.interface.js';
import {
  buildMomoSignature,
  verifyTimingSafeSignature,
} from './momo-signature.js';

export const MOCK_ACCESS_KEY = 'MOCK_ACCESS_KEY';

const uuidRegex =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

@Injectable()
export class MockPaymentGateway implements PaymentGateway {
  readonly name = 'mock';
  private readonly logger = new Logger(MockPaymentGateway.name);

  constructor(private readonly config: ConfigService) {}

  get accessKey(): string {
    return MOCK_ACCESS_KEY;
  }

  get secretKey(): string {
    return (
      this.config.get<string>('PAYMENT_WEBHOOK_SECRET') ??
      'mock_webhook_secret_dev'
    );
  }

  private get webOrigin(): string {
    return (
      this.config.get<string>('WEB_ORIGIN') ?? 'http://localhost:3000'
    ).replace(/\/$/, '');
  }

  async createPayment(params: CreatePaymentParams): Promise<CreatePaymentResult> {
    const nonce = Math.random().toString(36).substring(2, 8);
    const gatewayRef = `${params.orderId}_${Date.now()}_${nonce}`;

    const redirectUrl = `${this.webOrigin}/mock-gateway/pay?orderId=${encodeURIComponent(
      params.orderId,
    )}&amount=${params.amount}&gatewayRef=${encodeURIComponent(
      gatewayRef,
    )}&returnUrl=${encodeURIComponent(params.returnUrl)}`;

    return {
      redirectUrl,
      gatewayRef,
    };
  }

  private extractPayload(rawBody: unknown): Record<string, unknown> | null {
    if (!rawBody) return null;
    if (Buffer.isBuffer(rawBody)) {
      try {
        const text = rawBody.toString('utf8');
        const parsed = JSON.parse(text);
        return parsed && typeof parsed === 'object' && !Array.isArray(parsed)
          ? parsed
          : null;
      } catch {
        return null;
      }
    }
    if (typeof rawBody === 'string') {
      try {
        const parsed = JSON.parse(rawBody);
        return parsed && typeof parsed === 'object' && !Array.isArray(parsed)
          ? parsed
          : null;
      } catch {
        return null;
      }
    }
    if (typeof rawBody === 'object' && !Array.isArray(rawBody)) {
      return rawBody as Record<string, unknown>;
    }
    return null;
  }

  async verifyWebhook(
    rawBody: unknown,
    _headers: Record<string, string | string[] | undefined>,
  ): Promise<boolean> {
    const payload = this.extractPayload(rawBody);
    if (!payload) {
      return false;
    }

    const receivedSignature = payload.signature;
    if (typeof receivedSignature !== 'string' || !receivedSignature.trim()) {
      return false;
    }

    const expectedSignature = buildMomoSignature(
      payload,
      this.accessKey,
      this.secretKey,
    );

    return verifyTimingSafeSignature(receivedSignature, expectedSignature);
  }

  async parseWebhook(rawBody: unknown): Promise<PaymentWebhookEvent> {
    const payload = this.extractPayload(rawBody);
    if (!payload) {
      throw new Error('Dữ liệu webhook không hợp lệ.');
    }

    const gatewayRef =
      typeof payload.orderId === 'string'
        ? payload.orderId
        : String(payload.orderId ?? '');
    const transId =
      typeof payload.transId === 'string'
        ? payload.transId
        : typeof payload.transId === 'number'
          ? String(payload.transId)
          : gatewayRef;
    const amount = Number(payload.amount ?? 0);
    const resultCode = Number(payload.resultCode ?? -1);

    // Resolve internal orderId
    let orderId = '';
    if (typeof payload.extraData === 'string' && payload.extraData) {
      try {
        const decoded = JSON.parse(
          Buffer.from(payload.extraData, 'base64').toString('utf8'),
        ) as Record<string, unknown>;
        if (typeof decoded.orderId === 'string' && uuidRegex.test(decoded.orderId)) {
          orderId = decoded.orderId;
        }
      } catch {
        if (uuidRegex.test(payload.extraData)) {
          orderId = payload.extraData;
        }
      }
    }

    // Fallback: extract orderId from gatewayRef prefix
    if (!orderId && gatewayRef) {
      const match = gatewayRef.match(
        /^([0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12})/i,
      );
      if (match) {
        orderId = match[1];
      }
    }

    const status = resultCode === 0 ? 'SUCCESS' : 'FAILED';

    return {
      transactionId: transId,
      orderId,
      gatewayRef,
      amount,
      status,
      rawPayload: payload,
    };
  }
}
