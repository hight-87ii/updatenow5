export function validatePaymentGatewayConfig(
  env: Record<string, string | undefined> = process.env,
): void {
  const nodeEnv = (env.NODE_ENV ?? '').toLowerCase();
  const appEnv = (env.APP_ENV ?? '').toLowerCase();
  const isProduction = nodeEnv === 'production' || appEnv === 'production';
  const gatewayRaw = env.PAYMENT_GATEWAY?.trim();

  if (!gatewayRaw) {
    return;
  }

  const gateway = gatewayRaw.toLowerCase();

  if (isProduction && gateway === 'mock') {
    throw new Error(
      'Không thể khởi động ứng dụng: Cổng thanh toán giả lập (PAYMENT_GATEWAY=mock) chỉ dùng cho môi trường dev/test và bị nghiêm cấm trên môi trường production.',
    );
  }

  if (gateway === 'momo') {
    if (!env.MOMO_ACCESS_KEY || !env.MOMO_SECRET_KEY) {
      throw new Error(
        'Không thể khởi động ứng dụng: Thiếu biến môi trường MOMO_ACCESS_KEY hoặc MOMO_SECRET_KEY khi PAYMENT_GATEWAY=momo.',
      );
    }
  } else if (gateway === 'mock') {
    if (!env.PAYMENT_WEBHOOK_SECRET) {
      throw new Error(
        'Không thể khởi động ứng dụng: Thiếu biến môi trường PAYMENT_WEBHOOK_SECRET khi PAYMENT_GATEWAY=mock.',
      );
    }
  }
}
