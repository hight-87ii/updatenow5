// S-40: waiting-room tuning. Env-driven, no hard-coded thresholds in logic.
// [CẦN CHỐT] PO chốt ngưỡng, thời gian giữ lượt và tầng đặt hàng đợi trước khi lên Next.
export type WaitingConfig = { activeLimit: number; turnTtlSec: number };

const int = (raw: string | undefined, fallback: number): number => {
  const value = raw === undefined ? NaN : Number.parseInt(raw, 10);
  return Number.isInteger(value) && value > 0 ? value : fallback;
};

export function resolveWaitingConfig(env: Record<string, string | undefined> = process.env): WaitingConfig {
  return {
    // Số người cùng lúc được chọn ghế cho một suất; vượt thì xếp hàng.
    activeLimit: int(env.S40_ACTIVE_LIMIT, 200),
    // Thời hạn một lượt vào chọn ghế (giây); hết lượt không thao tác thì mất chỗ.
    turnTtlSec: int(env.S40_TURN_TTL_SEC, 300),
  };
}
