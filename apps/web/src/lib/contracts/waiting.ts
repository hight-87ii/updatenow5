import { ApiError, object } from "@/lib/api/client";

export type WaitingStatus =
  | {
      state: "admitted";
      admittedUntil: string;
      turnRemainingSec: number;
      activeCount: number;
      queueTotal: number;
    }
  | {
      state: "waiting";
      position: number;
      activeCount: number;
      queueTotal: number;
    }
  | {
      state: "none";
      activeCount: number;
      queueTotal: number;
      queueActive: boolean;
    };

const invalid = (): never => {
  throw new ApiError(
    "Không đọc được trạng thái phòng chờ. Hãy tải lại.",
    502,
    "INVALID_RESPONSE",
  );
};
const num = (value: unknown): number =>
  typeof value === "number" && Number.isFinite(value) && value >= 0
    ? value
    : invalid();
const time = (value: unknown): string =>
  typeof value === "string" && Number.isFinite(Date.parse(value))
    ? value
    : invalid();

export function decodeWaitingStatus(value: unknown): WaitingStatus {
  const state = object(value);
  if (state.state === "admitted")
    return {
      state: "admitted",
      admittedUntil: time(state.admittedUntil),
      turnRemainingSec: num(state.turnRemainingSec),
      activeCount: num(state.activeCount),
      queueTotal: num(state.queueTotal),
    };
  if (state.state === "waiting") {
    const position = num(state.position);
    if (!Number.isInteger(position) || position < 1) return invalid();
    return {
      state: "waiting",
      position,
      activeCount: num(state.activeCount),
      queueTotal: num(state.queueTotal),
    };
  }
  if (state.state === "none")
    return {
      state: "none",
      activeCount: num(state.activeCount),
      queueTotal: num(state.queueTotal),
      queueActive: typeof state.queueActive === "boolean" ? state.queueActive : invalid(),
    };
  return invalid();
}
