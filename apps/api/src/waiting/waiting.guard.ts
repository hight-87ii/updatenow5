import { CanActivate, ExecutionContext, HttpException, HttpStatus, Injectable, Logger } from '@nestjs/common';
import { hashSessionToken } from '../auth/auth.service.js';
import type { AuthenticatedRequest } from '../auth/guards/session-auth.guard.js';
import { metrics } from '../monitoring/metrics.js';
import { WaitingService } from './waiting.service.js';

// Runs after the global session/roles guards: req.user is present.
// Under threshold it passes everyone (zero change to hold flow); over
// threshold non-admitted claims get 429 + queue position for the web redirect.
// S-40c: every rejection is logged with queue counters for S-41 abuse review.
// Only the user UUID is logged (no email, session token, or seat data).
@Injectable()
export class WaitingAdmissionGuard implements CanActivate {
  private readonly logger = new Logger(WaitingAdmissionGuard.name);
  constructor(private readonly waiting: WaitingService) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const req = context.switchToHttp().getRequest<AuthenticatedRequest>();
    const showtimeId = req.params?.id as string | undefined;
    if (!showtimeId || !req.user) return true;
    const member = this.waiting.memberKey(
      req.user.id,
      req.sessionHash ?? hashSessionToken(req.sessionToken),
    );
    const { admitted, position, activeCount, queueTotal } =
      await this.waiting.requireAdmission(showtimeId, member);
    if (admitted) return true;
    metrics.noteWaitingBlocked();
    this.logger.warn(
      JSON.stringify({
        event: 'waiting_gate_blocked',
        showtimeId,
        userId: req.user.id,
        position,
        activeCount,
        queueTotal,
      }),
    );
    throw new HttpException(
      {
        code: 'WAITING_ROOM',
        message: `Đang đông người chọn ghế. Bạn ở vị trí thứ ${position ?? '?'} trong hàng chờ.`,
        position,
      },
      HttpStatus.TOO_MANY_REQUESTS,
    );
  }
}
