import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  CreatePaymentParams,
  CreatePaymentResult,
  PaymentGateway,
  PaymentWebhookEvent,
} from './payment-gateway.interface.js';
import {
  buildMomoCreateRawString,
  buildMomoSignature,
  calculateHmacSha256,
  verifyTimingSafeSignature,
} from './momo-signature.js';

const uuidRegex =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

@Injectable()
export class MomoGateway implements PaymentGateway {
  readonly name = 'momo';
  private readonly logger = new Logger(MomoGateway.name);

  constructor(private readonly config: ConfigService) {}

  private get partnerCode(): string {
    return this.config.get<string>('MOMO_PARTNER_CODE') ?? 'MOMO';
  }

  private get accessKey(): string {
    return this.config.get<string>('MOMO_ACCESS_KEY') ?? 'F8BBA842ECF85';
  }

  private get secretKey(): string {
    return (
      this.config.get<string>('MOMO_SECRET_KEY') ??
      this.config.get<string>('PAYMENT_WEBHOOK_SECRET') ??
      'K951B6PE1waDMi640xX08PD3vg6EkVlz'
    );
  }

  private get endpoint(): string {
    return (
      this.config.get<string>('MOMO_ENDPOINT') ??
      'https://test-payment.momo.vn'
    ).replace(/\/$/, '');
  }

  async createPayment(params: CreatePaymentParams): Promise<CreatePaymentResult> {
    // Generate unique gatewayRef per attempt mapping back to orderId
    const nonce = Math.random().toString(36).substring(2, 8);
    const gatewayRef = `${params.orderId}_${Date.now()}_${nonce}`;
    const requestId = gatewayRef;
    const orderInfo = `Thanh toán đơn hàng ${params.orderId}`;
    const requestType = 'captureWallet';

    // Store internal orderId in extraData
    const extraData = Buffer.from(
      JSON.stringify({ orderId: params.orderId }),
    ).toString('base64');

    const ipnUrl =
      params.ipnUrl ??
      `${this.config.get<string>('API_ORIGIN') ?? 'http://localhost:3001'}/payments/webhook`;

    const rawSignature = buildMomoCreateRawString({
      accessKey: this.accessKey,
      amount: params.amount,
      extraData,
      ipnUrl,
      orderId: gatewayRef,
      orderInfo,
      partnerCode: this.partnerCode,
      redirectUrl: params.returnUrl,
      requestId,
      requestType,
    });

    const signature = calculateHmacSha256(rawSignature, this.secretKey);

    const requestBody = {
      partnerCode: this.partnerCode,
      requestId,
      amount: params.amount,
      orderId: gatewayRef,
      orderInfo,
      redirectUrl: params.returnUrl,
      ipnUrl,
      requestType,
      extraData,
      lang: 'vi',
      signature,
    };

    try {
      const response = await fetch(`${this.endpoint}/v2/gateway/api/create`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(requestBody),
        signal: AbortSignal.timeout(10000),
      });

      if (response.ok) {
        const data = (await response.json()) as {
          payUrl?: string;
          shortLink?: string;
          deeplink?: string;
          resultCode?: number;
          message?: string;
        };

        if (data.payUrl) {
          return {
            redirectUrl: data.payUrl,
            gatewayRef,
          };
        }
        if (data.shortLink) {
          return {
            redirectUrl: data.shortLink,
            gatewayRef,
          };
        }
        if (data.resultCode !== undefined && data.resultCode !== 0) {
          this.logger.warn(
            `MoMo payment API returned resultCode=${data.resultCode}: ${data.message}`,
          );
        }
      }
    } catch (err) {
      this.logger.warn(
        `Failed to call MoMo endpoint (${this.endpoint}/v2/gateway/api/create): ${
          err instanceof Error ? err.message : String(err)
        }. Falling back to sandbox payment URL.`,
      );
    }

    // Fallback sandbox payment URL when external network is not available
    const fallbackUrl = `${this.endpoint}/gw_payment/transactionProcessor?partnerCode=${this.partnerCode}&orderId=${gatewayRef}&amount=${params.amount}&returnUrl=${encodeURIComponent(
      params.returnUrl,
    )}`;

    return {
      redirectUrl: fallbackUrl,
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
        // If extraData is raw UUID
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
