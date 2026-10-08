export function validatePaymentGatewayConfig(
  env: Record<string, string | undefined> = process.env,
): void {
  const nodeEnv = (env.NODE_ENV ?? '').toLowerCase();
  const appEnv = (env.APP_ENV ?? '').toLowerCase();
  const isProduction = nodeEnv === 'production' || appEnv === 'production';
  const gateway = (env.PAYMENT_GATEWAY ?? 'momo').toLowerCase();

  if (isProduction && gateway === 'mock') {
    throw new Error(
      'Không thể khởi động ứng dụng: Cổng thanh toán giả lập (PAYMENT_GATEWAY=mock) chỉ dùng cho môi trường dev/test và bị nghiêm cấm trên môi trường production.',
    );
  }
}
