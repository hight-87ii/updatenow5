import { describe, it, expect } from 'vitest';
import { validatePaymentGatewayConfig } from './payments-config.validator.js';

describe('validatePaymentGatewayConfig', () => {
  it('allows mock gateway in development or test environment', () => {
    expect(() =>
      validatePaymentGatewayConfig({
        NODE_ENV: 'development',
        PAYMENT_GATEWAY: 'mock',
      }),
    ).not.toThrow();

    expect(() =>
      validatePaymentGatewayConfig({
        NODE_ENV: 'test',
        PAYMENT_GATEWAY: 'mock',
      }),
    ).not.toThrow();
  });

  it('allows momo gateway in production environment', () => {
    expect(() =>
      validatePaymentGatewayConfig({
        NODE_ENV: 'production',
        PAYMENT_GATEWAY: 'momo',
      }),
    ).not.toThrow();
  });

  it('throws Error and blocks startup when NODE_ENV is production and PAYMENT_GATEWAY is mock', () => {
    expect(() =>
      validatePaymentGatewayConfig({
        NODE_ENV: 'production',
        PAYMENT_GATEWAY: 'mock',
      }),
    ).toThrow(
      /Cổng thanh toán giả lập \(PAYMENT_GATEWAY=mock\) chỉ dùng cho môi trường dev\/test/,
    );
  });

  it('throws Error and blocks startup when APP_ENV is production and PAYMENT_GATEWAY is mock', () => {
    expect(() =>
      validatePaymentGatewayConfig({
        APP_ENV: 'production',
        PAYMENT_GATEWAY: 'mock',
      }),
    ).toThrow(
      /Cổng thanh toán giả lập \(PAYMENT_GATEWAY=mock\) chỉ dùng cho môi trường dev\/test/,
    );
  });
});
