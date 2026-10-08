import { describe, it, expect } from 'vitest';
import { validatePaymentGatewayConfig } from './payments-config.validator.js';

describe('validatePaymentGatewayConfig', () => {
  it('allows mock gateway in development or test environment when secret is provided', () => {
    expect(() =>
      validatePaymentGatewayConfig({
        NODE_ENV: 'development',
        PAYMENT_GATEWAY: 'mock',
        PAYMENT_WEBHOOK_SECRET: 'mock_secret',
      }),
    ).not.toThrow();

    expect(() =>
      validatePaymentGatewayConfig({
        NODE_ENV: 'test',
        PAYMENT_GATEWAY: 'mock',
        PAYMENT_WEBHOOK_SECRET: 'mock_secret',
      }),
    ).not.toThrow();
  });

  it('allows momo gateway in production environment when credentials are provided', () => {
    expect(() =>
      validatePaymentGatewayConfig({
        NODE_ENV: 'production',
        PAYMENT_GATEWAY: 'momo',
        MOMO_ACCESS_KEY: 'access_key',
        MOMO_SECRET_KEY: 'secret_key',
      }),
    ).not.toThrow();
  });

  it('throws Error and blocks startup when NODE_ENV is production and PAYMENT_GATEWAY is mock', () => {
    expect(() =>
      validatePaymentGatewayConfig({
        NODE_ENV: 'production',
        PAYMENT_GATEWAY: 'mock',
        PAYMENT_WEBHOOK_SECRET: 'mock_secret',
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
        PAYMENT_WEBHOOK_SECRET: 'mock_secret',
      }),
    ).toThrow(
      /Cổng thanh toán giả lập \(PAYMENT_GATEWAY=mock\) chỉ dùng cho môi trường dev\/test/,
    );
  });

  it('throws Error when momo gateway is enabled but MOMO_ACCESS_KEY or MOMO_SECRET_KEY is missing', () => {
    expect(() =>
      validatePaymentGatewayConfig({
        PAYMENT_GATEWAY: 'momo',
        MOMO_ACCESS_KEY: 'only_access_key',
      }),
    ).toThrow(
      /Thiếu biến môi trường MOMO_ACCESS_KEY hoặc MOMO_SECRET_KEY/,
    );

    expect(() =>
      validatePaymentGatewayConfig({
        PAYMENT_GATEWAY: 'momo',
        MOMO_SECRET_KEY: 'only_secret_key',
      }),
    ).toThrow(
      /Thiếu biến môi trường MOMO_ACCESS_KEY hoặc MOMO_SECRET_KEY/,
    );
  });

  it('throws Error when mock gateway is enabled but PAYMENT_WEBHOOK_SECRET is missing', () => {
    expect(() =>
      validatePaymentGatewayConfig({
        PAYMENT_GATEWAY: 'mock',
      }),
    ).toThrow(
      /Thiếu biến môi trường PAYMENT_WEBHOOK_SECRET/,
    );
  });

  it('allows startup without error when PAYMENT_GATEWAY is not configured', () => {
    expect(() => validatePaymentGatewayConfig({})).not.toThrow();
    expect(() => validatePaymentGatewayConfig({ PAYMENT_GATEWAY: '' })).not.toThrow();
  });
});
