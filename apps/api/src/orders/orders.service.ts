import {
  BadRequestException,
  ConflictException,
  HttpException,
  Injectable,
  Logger,
  NotFoundException,
  ServiceUnavailableException,
} from '@nestjs/common';
import { OrderStatus, Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service.js';
import { isOrderExpired } from './order-expiration.js';

const uuidRegex =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

type Clock = { serverTime: Date; paymentExpiresAt: Date };
type HoldAuthority = {
  id: string;
  token: string;
  expiresAt: Date;
  expectedSeatIds: string[];
};
type HeldSeat = {
  seatId: string;
  row: string;
  seatNumber: number;
  categoryName: string;
  price: number | null;
  expiresAt: Date;
};
type OrderView = {
  id: string;
  status: OrderStatus;
  paymentExpiresAt: Date | null;
  totalAmount: number;
  items: {
    seatId: string;
    categoryName: string | null;
    unitPrice: number;
    seat: { row: string; seatNumber: number };
  }[];
};

export type DiscountCodeInfo = {
  id: string;
  code: string;
  type: 'PERCENTAGE' | 'FIXED_AMOUNT';
  value: number;
} | null;

export type OrderDetailResponse = {
  id: string;
  status: OrderStatus;
  rawStatus: OrderStatus;
  totalAmount: number;
  discountAmount: number;
  discountCode: DiscountCodeInfo;
  expiresAt: string;
  paymentExpiresAt: string;
  serverTime: string;
  remainingSeconds: number;
  isExpired: boolean;
  createdAt: string;
  event: {
    id: string;
    name: string;
    description: string;
    location: string;
    posterPath: string | null;
    bannerPath: string | null;
  };
  showtime: {
    id: string;
    startTime: string;
  };
  items: {
    id: string;
    seatId: string;
    row: string;
    seatNumber: number;
    label: string;
    tierName: string;
    categoryName: string;
    unitPrice: number;
    seat: { row: string; seatNumber: number };
  }[];
  order: {
    id: string;
    status: OrderStatus;
    paymentExpiresAt: string;
    totalAmount: number;
    items: {
      seatId: string;
      categoryName: string;
      unitPrice: number;
      seat: { row: string; seatNumber: number };
    }[];
  };
  created: boolean;
};

const orderProjection = {
  id: true,
  status: true,
  paymentExpiresAt: true,
  totalAmount: true,
  items: {
    orderBy: { seatId: 'asc' as const },
    select: {
      seatId: true,
      categoryName: true,
      unitPrice: true,
      seat: { select: { row: true, seatNumber: true } },
    },
  },
};

@Injectable()
export class OrdersService {
  private readonly logger = new Logger(OrdersService.name);

  constructor(private readonly db: PrismaService) {}

  async createFromHold(
    showtimeId: string,
    userId: string,
    sessionHash: string,
  ) {
    try {
      return await this.db.$transaction(
        async (tx) => {
          const buyers = await tx.$queryRaw<{ id: string }[]>(
            Prisma.sql`SELECT id FROM users WHERE id=${userId}::uuid FOR UPDATE`,
          );
          if (!buyers.length)
            throw new NotFoundException('Không tìm thấy người mua.');

          const [lookupClock] = await tx.$queryRaw<{ serverTime: Date }[]>(
            Prisma.sql`SELECT clock_timestamp() AS "serverTime"`,
          );

          await tx.order.updateMany({
            where: {
              userId,
              showtimeId,
              status: { in: ['PENDING', 'PENDING_PAYMENT'] },
              paymentExpiresAt: { lte: lookupClock.serverTime },
            },
            data: { status: 'EXPIRED' },
          });

          const existing = await tx.order.findFirst({
            where: {
              userId,
              showtimeId,
              status: { in: ['PENDING', 'PENDING_PAYMENT'] },
              paymentExpiresAt: { gt: lookupClock.serverTime },
            },
            select: orderProjection,
          });
          if (existing)
            return this.response(existing, lookupClock.serverTime, false);

          const shows = await tx.$queryRaw<
            { status: string; eventId: string }[]
          >(
            Prisma.sql`SELECT status, "eventId" FROM showtimes WHERE id=${showtimeId}::uuid FOR SHARE`,
          );
          if (!shows.length)
            throw new NotFoundException('Không tìm thấy suất diễn.');
          if (shows[0].status !== 'ON_SALE')
            throw new ConflictException({
              code: 'SHOWTIME_CLOSED',
              message: 'Suất diễn đã đóng bán. Không thể tạo đơn.',
            });

          const holds = await tx.$queryRaw<HoldAuthority[]>(Prisma.sql`
            SELECT id,token,"expiresAt","expectedSeatIds" FROM hold_sessions
            WHERE "showtimeId"=${showtimeId}::uuid AND "userId"=${userId}::uuid
              AND "sessionHash"=${sessionHash}
            FOR UPDATE`);
          const hold = holds[0];
          if (!hold)
            throw new ConflictException({
              code: 'HOLD_REQUIRED',
              message: 'Hãy giữ ghế trước khi đặt vé.',
            });

          const seats = await tx.$queryRaw<HeldSeat[]>(Prisma.sql`
            SELECT h."seatId",h."expiresAt",s.row,s."seatNumber",c.name AS "categoryName",c.price
            FROM seat_holds h
            JOIN seats s ON s.id=h."seatId" AND s."showtimeId"=h."showtimeId"
            JOIN seat_categories c ON c.id=s."categoryId" AND c."showtimeId"=s."showtimeId"
            WHERE h."holdSessionId"=${hold.id}::uuid AND h.token=${hold.token}::uuid
            ORDER BY h."seatId" FOR UPDATE OF h`);

          const [clock] = await tx.$queryRaw<Clock[]>(Prisma.sql`
            WITH current_clock AS (SELECT clock_timestamp() AS now)
            SELECT now AS "serverTime", now + interval '10 minutes' AS "paymentExpiresAt"
            FROM current_clock`);
          const heldById = new Map(seats.map((seat) => [seat.seatId, seat]));
          const lostSeatIds = hold.expectedSeatIds.filter((seatId) => {
            const seat = heldById.get(seatId);
            return (
              hold.expiresAt <= clock.serverTime ||
              !seat ||
              seat.expiresAt <= clock.serverTime
            );
          });
          if (
            hold.expiresAt <= clock.serverTime ||
            !hold.expectedSeatIds.length ||
            lostSeatIds.length
          )
            throw new ConflictException({
              code: 'HOLD_EXPIRED',
              message: 'Một hoặc nhiều ghế đã hết thời gian giữ. Hãy chọn lại.',
              lostSeatIds,
            });
          if (seats.length !== hold.expectedSeatIds.length)
            throw new ConflictException({
              code: 'HOLD_CHANGED',
              message: 'Danh sách giữ ghế đã thay đổi. Hãy tải lại sơ đồ.',
            });
          if (seats.some((seat) => seat.price === null))
            throw new ConflictException({
              code: 'PRICE_UNAVAILABLE',
              message: 'Một hoặc nhiều ghế chưa có giá. Hãy tải lại sơ đồ.',
            });

          const totalAmount = seats.reduce(
            (sum, seat) => sum + seat.price!,
            0,
          );
          const order = await tx.order.create({
            data: {
              userId,
              eventId: shows[0].eventId,
              showtimeId,
              holdSessionId: hold.id,
              holdToken: hold.token,
              status: OrderStatus.PENDING_PAYMENT,
              paymentExpiresAt: clock.paymentExpiresAt,
              expiresAt: clock.paymentExpiresAt,
              totalAmount,
              items: {
                create: seats.map((seat) => ({
                  seatId: seat.seatId,
                  categoryName: seat.categoryName,
                  tierName: seat.categoryName,
                  unitPrice: seat.price!,
                })),
              },
            },
            select: orderProjection,
          });

          await tx.holdSession.update({
            where: { id: hold.id },
            data: { expiresAt: clock.paymentExpiresAt },
          });
          const extended = await tx.seatHold.updateMany({
            where: { holdSessionId: hold.id, token: hold.token },
            data: { expiresAt: clock.paymentExpiresAt },
          });
          if (extended.count !== seats.length)
            throw new ConflictException({
              code: 'HOLD_CHANGED',
              message: 'Trạng thái giữ ghế vừa thay đổi. Hãy thử lại.',
            });

          this.logger.log(
            JSON.stringify({
              event: 'order_created',
              orderId: order.id,
              showtimeId,
              seatCount: order.items.length,
            }),
          );
          return this.response(order, clock.serverTime, true);
        },
        { timeout: 10000, maxWait: 10000 },
      );
    } catch (error) {
      if (error instanceof HttpException) throw error;
      this.logger.error(
        JSON.stringify({ event: 'order_create_failed', showtimeId }),
      );
      throw new ServiceUnavailableException({
        code: 'ORDER_UNAVAILABLE',
        message: 'Chưa thể tạo đơn. Hãy thử lại.',
      });
    }
  }

  async createOrder(
    userId: string,
    sessionHash: string,
    body: unknown,
  ): Promise<OrderDetailResponse> {
    if (!body || typeof body !== 'object' || Array.isArray(body)) {
      throw new BadRequestException('Dữ liệu yêu cầu không hợp lệ.');
    }

    const payload = body as Record<string, unknown>;
    const showtimeId = payload.showtimeId;
    if (typeof showtimeId !== 'string' || !uuidRegex.test(showtimeId)) {
      throw new BadRequestException('Mã suất diễn không hợp lệ.');
    }

    let requestedSeatIds: string[] | null = null;
    if ('seatIds' in payload && payload.seatIds !== undefined) {
      if (
        !Array.isArray(payload.seatIds) ||
        payload.seatIds.length === 0 ||
        payload.seatIds.some(
          (id) => typeof id !== 'string' || !uuidRegex.test(id),
        )
      ) {
        throw new BadRequestException('Danh sách ghế không hợp lệ.');
      }
      requestedSeatIds = [
        ...new Set((payload.seatIds as string[]).map((id) => id.toLowerCase())),
      ];
    }

    return this.db.$transaction(async (tx) => {
      const now = new Date();
      const holdSession = await tx.holdSession.findFirst({
        where: {
          showtimeId,
          userId,
          sessionHash,
          expiresAt: { gt: now },
        },
        include: {
          seats: {
            where: {
              expiresAt: { gt: now },
            },
          },
          showtime: {
            include: {
              event: true,
            },
          },
        },
      });

      if (!holdSession || holdSession.seats.length === 0) {
        throw new BadRequestException(
          'Không tìm thấy ghế đang giữ hoặc phiên giữ chỗ đã hết hạn.',
        );
      }

      const heldSeatIds = holdSession.seats.map((s) => s.seatId.toLowerCase());
      const heldSet = new Set(heldSeatIds);

      const targetSeatIds = requestedSeatIds ?? heldSeatIds;
      const allHeldByBuyer = targetSeatIds.every((id) => heldSet.has(id));
      if (!allHeldByBuyer) {
        throw new BadRequestException(
          'Một số ghế không còn được giữ bởi bạn hoặc đã hết hạn.',
        );
      }

      const seats = await tx.seat.findMany({
        where: {
          id: { in: targetSeatIds },
          showtimeId,
        },
        include: {
          category: true,
        },
      });

      if (seats.length !== targetSeatIds.length) {
        throw new BadRequestException('Không tìm thấy thông tin một số ghế.');
      }

      for (const seat of seats) {
        if (seat.category.price === null || seat.category.price === undefined) {
          throw new BadRequestException(
            `Ghế ${seat.row}-${seat.seatNumber} chưa được định giá.`,
          );
        }
      }

      const totalAmount = seats.reduce(
        (sum, seat) => sum + (seat.category.price ?? 0),
        0,
      );

      const order = await tx.order.create({
        data: {
          userId,
          eventId: holdSession.showtime.eventId,
          showtimeId,
          holdSessionId: holdSession.id,
          holdToken: holdSession.token,
          status: OrderStatus.PENDING,
          totalAmount,
          paymentExpiresAt: holdSession.expiresAt,
          expiresAt: holdSession.expiresAt,
          items: {
            create: seats.map((seat) => ({
              seatId: seat.id,
              categoryName: seat.category.name,
              tierName: seat.category.name,
              unitPrice: seat.category.price!,
            })),
          },
        },
        include: {
          event: true,
          showtime: true,
          items: {
            include: {
              seat: true,
            },
          },
        },
      });

      const serverNow = new Date();
      const effectiveExpiry = order.expiresAt ?? order.paymentExpiresAt ?? serverNow;
      const remainingSeconds = Math.max(
        0,
        Math.ceil((effectiveExpiry.getTime() - serverNow.getTime()) / 1000),
      );

      const expiresIso = effectiveExpiry.toISOString();
      const serverTimeIso = serverNow.toISOString();

      const items = order.items.map((item) => ({
        id: item.id,
        seatId: item.seatId,
        row: item.seat.row,
        seatNumber: item.seat.seatNumber,
        label: `${item.seat.row}-${item.seat.seatNumber}`,
        tierName: item.tierName ?? item.categoryName ?? '',
        categoryName: item.categoryName ?? item.tierName ?? '',
        unitPrice: item.unitPrice,
        seat: { row: item.seat.row, seatNumber: item.seat.seatNumber },
      }));

      return {
        id: order.id,
        status: order.status,
        rawStatus: order.status,
        totalAmount: order.totalAmount,
        discountAmount: 0,
        discountCode: null,
        expiresAt: expiresIso,
        paymentExpiresAt: expiresIso,
        serverTime: serverTimeIso,
        remainingSeconds,
        isExpired: isOrderExpired(order, serverNow),
        createdAt: order.createdAt.toISOString(),
        event: {
          id: order.event?.id ?? holdSession.showtime.eventId,
          name: order.event?.name ?? holdSession.showtime.event.name,
          description:
            order.event?.description ?? holdSession.showtime.event.description,
          location:
            order.event?.location ?? holdSession.showtime.event.location,
          posterPath:
            order.event?.posterPath ?? holdSession.showtime.event.posterPath,
          bannerPath:
            order.event?.bannerPath ?? holdSession.showtime.event.bannerPath,
        },
        showtime: {
          id: order.showtime.id,
          startTime: order.showtime.startTime.toISOString(),
        },
        items,
        order: {
          id: order.id,
          status: order.status,
          paymentExpiresAt: expiresIso,
          totalAmount: order.totalAmount,
          items,
        },
        created: true,
      };
    });
  }

  async getOrderById(
    orderId: string,
    userId: string,
  ): Promise<OrderDetailResponse> {
    const order = await this.db.order.findUnique({
      where: { id: orderId },
      include: {
        event: true,
        showtime: true,
        discountCode: true,
        items: {
          include: {
            seat: {
              include: {
                category: true,
              },
            },
          },
        },
      },
    });

    if (!order || order.userId !== userId) {
      throw new NotFoundException('Không tìm thấy đơn hàng.');
    }

    // Prices are the snapshots captured server-side when the order was created
    // (S-16); a later category price change must not alter a pending order.
    let recalculatedTotal = 0;
    for (const item of order.items) {
      recalculatedTotal += item.unitPrice;
    }

    if (recalculatedTotal !== order.totalAmount) {
      this.logger.warn(
        `Order ${order.id} total amount mismatch: recorded=${order.totalAmount}, recalculated=${recalculatedTotal}`,
      );
    }

    const serverNow = new Date();
    const expired = isOrderExpired(order, serverNow);
    const effectiveExpiresAt =
      order.paymentExpiresAt ?? order.expiresAt ?? serverNow;
    const remainingSeconds = Math.max(
      0,
      Math.ceil((effectiveExpiresAt.getTime() - serverNow.getTime()) / 1000),
    );

    if (
      expired &&
      (order.status === OrderStatus.PENDING ||
        order.status === OrderStatus.PENDING_PAYMENT)
    ) {
      await this.db.order.update({
        where: { id: order.id },
        data: { status: OrderStatus.EXPIRED },
      });
    }

    const resolvedStatus =
      expired &&
      (order.status === OrderStatus.PENDING ||
        order.status === OrderStatus.PENDING_PAYMENT)
        ? OrderStatus.EXPIRED
        : order.status;

    const expiresIso = effectiveExpiresAt.toISOString();
    const serverTimeIso = serverNow.toISOString();

    const items = order.items.map((item) => ({
      id: item.id,
      seatId: item.seatId,
      row: item.seat.row,
      seatNumber: item.seat.seatNumber,
      label: `${item.seat.row}-${item.seat.seatNumber}`,
      tierName: item.tierName ?? item.categoryName ?? '',
      categoryName: item.categoryName ?? item.tierName ?? '',
      unitPrice: item.unitPrice,
      seat: { row: item.seat.row, seatNumber: item.seat.seatNumber },
    }));

    return {
      id: order.id,
      status: resolvedStatus,
      rawStatus: order.status,
      totalAmount: recalculatedTotal,
      discountAmount: order.discountAmount ?? 0,
      discountCode: order.discountCode
        ? {
            id: order.discountCode.id,
            code: order.discountCode.code,
            type: order.discountCode.type,
            value: order.discountCode.value,
          }
        : null,
      expiresAt: expiresIso,
      paymentExpiresAt: expiresIso,
      serverTime: serverTimeIso,
      remainingSeconds,
      isExpired: expired,
      createdAt: order.createdAt.toISOString(),
      event: {
        id: order.event?.id ?? order.showtime?.eventId ?? '',
        name: order.event?.name ?? '',
        description: order.event?.description ?? '',
        location: order.event?.location ?? '',
        posterPath: order.event?.posterPath ?? null,
        bannerPath: order.event?.bannerPath ?? null,
      },
      showtime: {
        id: order.showtime.id,
        startTime: order.showtime.startTime.toISOString(),
      },
      items,
      order: {
        id: order.id,
        status: resolvedStatus,
        paymentExpiresAt: expiresIso,
        totalAmount: recalculatedTotal,
        items,
      },
      created: false,
    };
  }

  async current(orderId: string, userId: string) {
    return this.getOrderById(orderId, userId);
  }

  private response(order: OrderView, serverTime: Date, created: boolean) {
    return {
      serverTime,
      created,
      order: {
        ...order,
        totalAmount: Number(order.totalAmount),
        discountAmount: 0,
        discountCode: null,
        paymentExpiresAt: (order.paymentExpiresAt ?? serverTime).toISOString(),
        items: order.items.map((i) => ({
          ...i,
          categoryName: i.categoryName ?? '',
        })),
      },
    };
  }
}
