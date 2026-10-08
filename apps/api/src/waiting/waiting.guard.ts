import { CanActivate, ExecutionContext, HttpException, HttpStatus, Injectable } from '@nestjs/common';
import { hashSessionToken } from '../auth/auth.service.js';
import type { AuthenticatedRequest } from '../auth/guards/session-auth.guard.js';
import { WaitingService } from './waiting.service.js';

// Runs after the global session/roles guards: req.user is present.
// Under threshold it passes everyone (zero change to hold flow); over
// threshold non-admitted claims get 429 + queue position for the web redirect.
@Injectable()
export class WaitingAdmissionGuard implements CanActivate {
  constructor(private readonly waiting: WaitingService) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const req = context.switchToHttp().getRequest<AuthenticatedRequest>();
    const showtimeId = req.params?.id as string | undefined;
    if (!showtimeId || !req.user) return true;
    const member = this.waiting.memberKey(
      req.user.id,
      req.sessionHash ?? hashSessionToken(req.sessionToken),
    );
    const { admitted, position } = await this.waiting.requireAdmission(showtimeId, member);
    if (admitted) return true;
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
