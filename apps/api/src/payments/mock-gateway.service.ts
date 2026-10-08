import {
  BadRequestException,
  Injectable,
  Logger,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { randomBytes } from 'node:crypto';
import { buildMomoSignature } from './gateways/momo-signature.js';
import { MOCK_ACCESS_KEY } from './gateways/mock.gateway.js';

export class MockGatewaySubmitDto {
  orderId!: string;
  amount!: number;
  gatewayRef!: string;
  returnUrl!: string;
  outcome!: 'SUCCESS' | 'FAILED';
}

@Injectable()
export class MockGatewayService {
  private readonly logger = new Logger(MockGatewayService.name);

  constructor(private readonly config: ConfigService) {}

  private get secretKey(): string {
    return (
      this.config.get<string>('PAYMENT_WEBHOOK_SECRET') ??
      'mock_webhook_secret_dev'
    );
  }

  private get webhookEndpoint(): string {
    const apiOrigin =
      this.config.get<string>('API_INTERNAL_URL') ??
      this.config.get<string>('API_ORIGIN') ??
      `http://127.0.0.1:${this.config.get<string>('PORT') ?? '3001'}`;

    return `${apiOrigin.replace(/\/$/, '')}/payments/webhook`;
  }

  async submitPayment(
    dto: MockGatewaySubmitDto,
  ): Promise<{ success: boolean; redirectUrl: string; status: string }> {
    if (!dto.orderId || !dto.gatewayRef || !dto.returnUrl || !dto.outcome) {
      throw new BadRequestException('Thiếu thông tin gửi cổng giả lập.');
    }

    if (dto.outcome !== 'SUCCESS' && dto.outcome !== 'FAILED') {
      throw new BadRequestException(
        'Kết quả cổng giả lập không hợp lệ (phải là SUCCESS hoặc FAILED).',
      );
    }

    const transId = `mock_tx_${Date.now()}_${randomBytes(4).toString('hex')}`;
    const resultCode = dto.outcome === 'SUCCESS' ? 0 : 49;
    const message =
      dto.outcome === 'SUCCESS'
        ? 'Giao dịch thành công (Cổng giả lập).'
        : 'Giao dịch thất bại / Người dùng huỷ (Cổng giả lập).';

    const extraData = Buffer.from(
      JSON.stringify({ orderId: dto.orderId }),
    ).toString('base64');

    const webhookPayload: Record<string, unknown> = {
      partnerCode: 'MOCK',
      orderId: dto.gatewayRef,
      requestId: dto.gatewayRef,
      amount: Number(dto.amount),
      orderInfo: `Thanh toán đơn hàng ${dto.orderId}`,
      orderType: 'momo_wallet',
      transId,
      resultCode,
      message,
      payType: 'qr',
      responseTime: Date.now(),
      extraData,
    };

    const signature = buildMomoSignature(
      webhookPayload,
      MOCK_ACCESS_KEY,
      this.secretKey,
    );
    webhookPayload.signature = signature;

    const url = this.webhookEndpoint;
    const sendWebhook = async () => {
      try {
        this.logger.log(
          `Sending mock IPN webhook to ${url} for order ${dto.orderId} (resultCode=${resultCode})`,
        );
        const res = await fetch(url, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(webhookPayload),
        });

        if (!res.ok) {
          const text = await res.text();
          this.logger.warn(
            `Mock webhook response status=${res.status}: ${text}`,
          );
        }
      } catch (err) {
        this.logger.error(
          `Failed to send mock webhook to ${url}: ${
            err instanceof Error ? err.message : String(err)
          }`,
        );
      }
    };

    const delayConfig = this.config.get<string>('MOCK_WEBHOOK_DELAY_MS');
    const delayMs =
      delayConfig !== undefined && delayConfig !== ''
        ? parseInt(delayConfig, 10)
        : 0;

    if (delayMs === -1) {
      this.logger.log(
        `MOCK_WEBHOOK_DELAY_MS is -1: Skipping webhook dispatch for order ${dto.orderId}`,
      );
    } else if (delayMs > 0) {
      this.logger.log(
        `MOCK_WEBHOOK_DELAY_MS is ${delayMs}ms: Delayed webhook dispatch for order ${dto.orderId}`,
      );
      setTimeout(() => {
        void sendWebhook();
      }, delayMs);
    } else {
      await sendWebhook();
    }

    // Attach MoMo-like parameters to returnUrl to simulate gateway behavior per S-22
    const baseOrigin =
      this.config.get<string>('WEB_ORIGIN') ?? 'http://localhost:3000';
    const redirectUrlObj = new URL(dto.returnUrl, baseOrigin);
    redirectUrlObj.searchParams.set('partnerCode', 'MOCK');
    redirectUrlObj.searchParams.set('orderId', dto.gatewayRef);
    redirectUrlObj.searchParams.set('requestId', dto.gatewayRef);
    redirectUrlObj.searchParams.set('amount', String(dto.amount));
    redirectUrlObj.searchParams.set('orderInfo', `Thanh toan don hang ${dto.orderId}`);
    redirectUrlObj.searchParams.set('orderType', 'momo_wallet');
    redirectUrlObj.searchParams.set('transId', transId);
    redirectUrlObj.searchParams.set('resultCode', String(resultCode));
    redirectUrlObj.searchParams.set('message', message);
    redirectUrlObj.searchParams.set('payType', 'qr');
    redirectUrlObj.searchParams.set('responseTime', String(Date.now()));
    redirectUrlObj.searchParams.set('extraData', extraData);
    redirectUrlObj.searchParams.set('signature', signature);
    const finalRedirectUrl = dto.returnUrl.startsWith('http')
      ? redirectUrlObj.toString()
      : `${redirectUrlObj.pathname}${redirectUrlObj.search}`;

    return {
      success: true,
      redirectUrl: finalRedirectUrl,
      status: dto.outcome,
    };
  }
}
