import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { ConfigService } from '@nestjs/config';
import { BadRequestException } from '@nestjs/common';
import { MockGatewayService } from './mock-gateway.service.js';
import { MOCK_ACCESS_KEY } from './gateways/mock.gateway.js';
import { buildMomoSignature } from './gateways/momo-signature.js';

describe('MockGatewayService (S-19 & S-22)', () => {
  let service: MockGatewayService;
  const mockSecret = 'secret_test_mock_321';
  let originalFetch: typeof globalThis.fetch;
  let mockDelay = '0';

  beforeEach(() => {
    originalFetch = globalThis.fetch;
    mockDelay = '0';
    const config = {
      get: vi.fn((key: string, defaultValue?: string) => {
        if (key === 'PAYMENT_WEBHOOK_SECRET') return mockSecret;
        if (key === 'API_ORIGIN') return 'http://localhost:3001';
        if (key === 'MOCK_WEBHOOK_DELAY_MS') return mockDelay;
        return defaultValue;
      }),
    } as unknown as ConfigService;

    service = new MockGatewayService(config);
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
    vi.useRealTimers();
  });

  it('rejects invalid or missing outcome', async () => {
    await expect(
      service.submitPayment({
        orderId: '123',
        amount: 100000,
        gatewayRef: 'ref_123',
        returnUrl: '/result',
        outcome: 'UNKNOWN' as any,
      }),
    ).rejects.toThrow(BadRequestException);
  });

  it('dispatches valid MoMo IPN format signed webhook and attaches MoMo params to redirectUrl (S-22)', async () => {
    let capturedUrl = '';
    let capturedBody: any = null;

    globalThis.fetch = vi.fn().mockImplementation((url, options) => {
      capturedUrl = String(url);
      capturedBody = JSON.parse(options.body);
      return Promise.resolve({
        ok: true,
        json: () => Promise.resolve({ received: true }),
      });
    });

    const orderId = '11111111-2222-3333-4444-555555555555';
    const gatewayRef = `${orderId}_123456_test`;
    const res = await service.submitPayment({
      orderId,
      amount: 200000,
      gatewayRef,
      returnUrl: 'http://localhost:3000/payment/result/11111111-2222-3333-4444-555555555555',
      outcome: 'SUCCESS',
    });

    expect(res.success).toBe(true);
    expect(res.status).toBe('SUCCESS');
    expect(capturedUrl).toBe('http://localhost:3001/payments/webhook');
    expect(capturedBody.resultCode).toBe(0);
    expect(capturedBody.amount).toBe(200000);
    expect(capturedBody.orderId).toBe(gatewayRef);
    expect(capturedBody.transId).toContain('mock_tx_');

    // S-22: Verify attached MoMo-like query parameters in redirectUrl
    const urlObj = new URL(res.redirectUrl);
    expect(urlObj.searchParams.get('partnerCode')).toBe('MOCK');
    expect(urlObj.searchParams.get('orderId')).toBe(gatewayRef);
    expect(urlObj.searchParams.get('resultCode')).toBe('0');
    expect(urlObj.searchParams.get('transId')).toContain('mock_tx_');
    expect(urlObj.searchParams.get('signature')).toBeTruthy();

    // Verify signature on dispatched body
    const expectedSig = buildMomoSignature(capturedBody, MOCK_ACCESS_KEY, mockSecret);
    expect(capturedBody.signature).toBe(expectedSig);
  });

  it('dispatches failed resultCode=49 on FAILED outcome and sets resultCode=49 in redirectUrl', async () => {
    let capturedBody: any = null;
    globalThis.fetch = vi.fn().mockImplementation((_url, options) => {
      capturedBody = JSON.parse(options.body);
      return Promise.resolve({
        ok: true,
        json: () => Promise.resolve({ received: true }),
      });
    });

    const res = await service.submitPayment({
      orderId: '11111111-2222-3333-4444-555555555555',
      amount: 200000,
      gatewayRef: 'ref_fail_123',
      returnUrl: '/result',
      outcome: 'FAILED',
    });

    expect(res.status).toBe('FAILED');
    expect(capturedBody.resultCode).toBe(49);

    const urlObj = new URL(res.redirectUrl, 'http://localhost:3000');
    expect(urlObj.searchParams.get('resultCode')).toBe('49');
  });

  it('MOCK_WEBHOOK_DELAY_MS=-1 skips webhook dispatch (S-22)', async () => {
    mockDelay = '-1';
    const fetchSpy = vi.fn();
    globalThis.fetch = fetchSpy;

    const res = await service.submitPayment({
      orderId: '11111111-2222-3333-4444-555555555555',
      amount: 200000,
      gatewayRef: 'ref_nodelay',
      returnUrl: '/result',
      outcome: 'SUCCESS',
    });

    expect(res.success).toBe(true);
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it('MOCK_WEBHOOK_DELAY_MS > 0 delays webhook dispatch via setTimeout (S-22)', async () => {
    vi.useFakeTimers();
    mockDelay = '1000';
    let fetchCalled = false;

    globalThis.fetch = vi.fn().mockImplementation(() => {
      fetchCalled = true;
      return Promise.resolve({
        ok: true,
        json: () => Promise.resolve({ received: true }),
      });
    });

    const res = await service.submitPayment({
      orderId: '11111111-2222-3333-4444-555555555555',
      amount: 200000,
      gatewayRef: 'ref_delay_1000',
      returnUrl: '/result',
      outcome: 'SUCCESS',
    });

    expect(res.success).toBe(true);
    // Not called immediately
    expect(fetchCalled).toBe(false);

    // Fast-forward 1000ms
    await vi.advanceTimersByTimeAsync(1000);
    expect(fetchCalled).toBe(true);
  });
});
