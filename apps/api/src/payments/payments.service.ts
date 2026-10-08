import {
  BadRequestException,
  Inject,
  Injectable,
  Logger,
  NotFoundException,
  Optional,
  UnauthorizedException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { OrderStatus, PaymentStatus, Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service.js';
import { isOrderExpired } from '../orders/order-expiration.js';
import { OrdersService } from '../orders/orders.service.js';
import {
  PAYMENT_GATEWAY,
  type PaymentGateway,
} from './gateways/payment-gateway.interface.js';
import { AccountantNotifier } from './accountant-notifier.js';

@Injectable()
export class PaymentsService {
  private readonly logger = new Logger(PaymentsService.name);

  constructor(
    private readonly db: PrismaService,
    @Inject(PAYMENT_GATEWAY) private readonly gateway: PaymentGateway,
    private readonly accountantNotifier: AccountantNotifier,
    private readonly config: ConfigService,
    @Optional() private readonly ordersService?: OrdersService,
  ) {}

  async initiatePayment(
    orderId: string,
    userId: string,
    returnUrl?: string,
  ): Promise<{ redirectUrl: string; gatewayRef: string; paymentId: string }> {
    const order = await this.db.order.findUnique({
      where: { id: orderId },
      include: {
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

    const now = new Date();
    const isPending =
      order.status === OrderStatus.PENDING ||
      order.status === OrderStatus.PENDING_PAYMENT;
    if (!isPending || isOrderExpired(order, now)) {
      // Record RETRY_REJECTED_EXPIRED event if rejected due to expiration / non-pending status
      await this.db.orderLog.create({
        data: {
          orderId: order.id,
          type: 'RETRY_REJECTED_EXPIRED',
          attemptNo: null,
          detail: {
            status: order.status,
            reason: isOrderExpired(order, now)
              ? 'ORDER_EXPIRED'
              : 'ORDER_NOT_PENDING',
          },
        },
      });

      throw new BadRequestException({
        code: 'ORDER_EXPIRED',
        message: 'Đơn hàng đã hết hạn hoặc không ở trạng thái chờ thanh toán.',
      });
    }

    // Authoritative calculation strictly from DB prices
    let authoritativeTotal = 0;
    for (const item of order.items) {
      const price = item.seat?.category?.price ?? item.unitPrice;
      authoritativeTotal += price;
    }

    if (authoritativeTotal <= 0) {
      throw new BadRequestException('Tổng tiền đơn hàng không hợp lệ.');
    }

    const webOrigin =
      this.config.get<string>('WEB_ORIGIN') ?? 'http://localhost:3000';
    const finalReturnUrl =
      returnUrl || `${webOrigin}/payment/result/${order.id}`;

    const gatewayResult = await this.gateway.createPayment({
      orderId: order.id,
      amount: authoritativeTotal,
      returnUrl: finalReturnUrl,
    });

    const payment = await this.db.$transaction(async (tx) => {
      // Lock order to serialize concurrent attempt creations
      if (typeof (tx as any).$executeRaw === 'function') {
        await (tx as any).$executeRaw`SELECT id FROM orders WHERE id = ${order.id}::uuid FOR UPDATE`;
      }

      const previousPayment = await tx.payment.findFirst({
        where: { orderId: order.id },
        orderBy: { attemptNo: 'desc' },
      });

      const attemptNo = (previousPayment?.attemptNo ?? 0) + 1;

      const createdPayment = await tx.payment.create({
        data: {
          orderId: order.id,
          amount: authoritativeTotal,
          status: PaymentStatus.INITIATED,
          gateway: this.gateway.name,
          gatewayRef: gatewayResult.gatewayRef,
          attemptNo,
        },
      });

      await tx.orderLog.create({
        data: {
          orderId: order.id,
          type: 'PAYMENT_ATTEMPT',
          attemptNo,
          detail:
            attemptNo > 1
              ? {
                  previousPaymentId: previousPayment?.id,
                  previousStatus: previousPayment?.status,
                  previousGatewayRef: previousPayment?.gatewayRef,
                }
              : {
                  gateway: this.gateway.name,
                  gatewayRef: gatewayResult.gatewayRef,
                },
        },
      });

      return createdPayment;
    });

    return {
      redirectUrl: gatewayResult.redirectUrl,
      gatewayRef: gatewayResult.gatewayRef,
      paymentId: payment.id,
    };
  }

  async handleWebhook(
    body: unknown,
    headers: Record<string, string | string[] | undefined>,
    clientIp?: string,
  ): Promise<{ received: boolean; status: string }> {
    // 1. Verify signature
    const isValid = await this.gateway.verifyWebhook(body, headers);
    if (!isValid) {
      this.logger.warn(
        `Webhook signature verification failed from IP: ${clientIp ?? 'unknown'}`,
      );
      throw new UnauthorizedException('Chữ ký không hợp lệ.');
    }

    // 2. Parse webhook
    const event = await this.gateway.parseWebhook(body);
    if (!event.orderId) {
      this.logger.warn(
        `Webhook payload missing valid orderId from IP: ${clientIp ?? 'unknown'}`,
      );
      throw new NotFoundException('Không tìm thấy đơn hàng.');
    }

    const order = await this.db.order.findUnique({
      where: { id: event.orderId },
      include: {
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

    if (!order) {
      this.logger.warn(
        `Webhook order not found: ${event.orderId} from IP: ${clientIp ?? 'unknown'}`,
      );
      throw new NotFoundException('Không tìm thấy đơn hàng.');
    }

    // Fast check: If order is already PAID
    if (order.status === OrderStatus.PAID) {
      const existingPaymentCheck = await this.db.payment.findFirst({
        where: { gatewayRef: event.gatewayRef },
      });

      if (
        existingPaymentCheck?.status === PaymentStatus.SUCCEEDED ||
        (existingPaymentCheck?.transactionId &&
          existingPaymentCheck.transactionId === event.transactionId)
      ) {
        this.logger.log(
          `Order ${order.id} is already PAID. Duplicate webhook received, returning success.`,
        );
        return { received: true, status: 'PAID' };
      }

      if (existingPaymentCheck?.status === PaymentStatus.LATE) {
        return { received: true, status: 'LATE' };
      }

      if (event.status === 'SUCCESS') {
        // S-24 Mục 5: Second attempt succeeded after order was already PAID by another attempt
        // Mark this payment as LATE, do NOT touch order or seats, notify accountant
        await this.db.$transaction(async (tx) => {
          if (existingPaymentCheck) {
            await tx.payment.update({
              where: { id: existingPaymentCheck.id },
              data: {
                status: PaymentStatus.LATE,
                transactionId: event.transactionId,
              },
            });
          } else {
            const previousPayment = await tx.payment.findFirst({
              where: { orderId: order.id },
              orderBy: { attemptNo: 'desc' },
            });
            const attemptNo = (previousPayment?.attemptNo ?? 0) + 1;
            await tx.payment.create({
              data: {
                orderId: order.id,
                amount: event.amount,
                status: PaymentStatus.LATE,
                gateway: this.gateway.name,
                gatewayRef: event.gatewayRef,
                transactionId: event.transactionId,
                attemptNo,
              },
            });
          }
        });

        await this.accountantNotifier.notifyLatePayment({
          orderId: order.id,
          amount: event.amount,
          transactionId: event.transactionId,
          gatewayRef: event.gatewayRef,
          reason: 'Trả trùng khi đơn đã được thanh toán, cần hoàn tiền',
        });

        return { received: true, status: 'LATE' };
      } else {
        // FAILED event for already PAID order: record FAILED payment, do not touch order or seats
        if (existingPaymentCheck) {
          await this.db.payment.update({
            where: { id: existingPaymentCheck.id },
            data: {
              status: PaymentStatus.FAILED,
              transactionId: event.transactionId,
            },
          });
        }
        return { received: true, status: 'FAILED' };
      }
    }

    // Check if payment with this gatewayRef was already processed successfully
    const existingPaymentCheck = await this.db.payment.findFirst({
      where: { gatewayRef: event.gatewayRef },
    });
    if (existingPaymentCheck?.status === PaymentStatus.SUCCEEDED) {
      return { received: true, status: 'PAID' };
    }
    if (existingPaymentCheck?.status === PaymentStatus.LATE) {
      return { received: true, status: 'LATE' };
    }
    if (
      existingPaymentCheck?.status === PaymentStatus.FAILED &&
      event.status !== 'SUCCESS'
    ) {
      return { received: true, status: 'FAILED' };
    }

    // 3. Check expired order
    const isExpired = isOrderExpired(order, new Date());
    if (isExpired) {
      if (event.status === 'SUCCESS') {
        // S-23: Late payment path when webhook arrives for an expired order.
        // If order is still PENDING / PENDING_PAYMENT, expire the order first to release seats.
        if (
          order.status === OrderStatus.PENDING ||
          order.status === OrderStatus.PENDING_PAYMENT
        ) {
          if (this.ordersService) {
            await this.ordersService.expireOrder(order.id);
          }
        }

        await this.db.$transaction(async (tx) => {
          // Release any holds remaining for this order if not already released
          await tx.$executeRaw(Prisma.sql`
            DELETE FROM seat_holds
            WHERE "seatId" IN (
              SELECT oi."seatId"
              FROM order_items oi
              JOIN seats s ON s.id = oi."seatId"
              WHERE oi."orderId" = ${order.id}::uuid
                AND s."isSold" = false
            )
            ${order.holdSessionId ? Prisma.sql`AND "holdSessionId" = ${order.holdSessionId}::uuid` : Prisma.empty}
          `);

          await tx.order.update({
            where: { id: order.id },
            data: { status: OrderStatus.NEEDS_REVIEW },
          });

          const payment = await tx.payment.findFirst({
            where: { gatewayRef: event.gatewayRef },
          });

          if (payment) {
            await tx.payment.update({
              where: { id: payment.id },
              data: {
                status: PaymentStatus.LATE,
                transactionId: event.transactionId,
              },
            });
          } else {
            const previousPayment = await tx.payment.findFirst({
              where: { orderId: order.id },
              orderBy: { attemptNo: 'desc' },
            });
            const attemptNo = (previousPayment?.attemptNo ?? 0) + 1;
            await tx.payment.create({
              data: {
                orderId: order.id,
                amount: event.amount,
                status: PaymentStatus.LATE,
                gateway: this.gateway.name,
                gatewayRef: event.gatewayRef,
                transactionId: event.transactionId,
                attemptNo,
              },
            });
          }
        });

        await this.accountantNotifier.notifyLatePayment({
          orderId: order.id,
          amount: event.amount,
          transactionId: event.transactionId,
          gatewayRef: event.gatewayRef,
          reason: 'Thanh toán sau khi đơn hết hạn, cần hoàn tiền',
        });

        return { received: true, status: 'LATE' };
      } else {
        const payment = await this.db.payment.findFirst({
          where: { gatewayRef: event.gatewayRef },
        });

        if (payment?.status === PaymentStatus.FAILED) {
          return { received: true, status: 'FAILED' };
        }

        await this.db.$transaction(async (tx) => {
          let currentPayment = payment;
          if (payment) {
            currentPayment = await tx.payment.update({
              where: { id: payment.id },
              data: {
                status: PaymentStatus.FAILED,
                transactionId: event.transactionId,
              },
            });
          } else {
            const previousPayment = await tx.payment.findFirst({
              where: { orderId: order.id },
              orderBy: { attemptNo: 'desc' },
            });
            const attemptNo = (previousPayment?.attemptNo ?? 0) + 1;
            currentPayment = await tx.payment.create({
              data: {
                orderId: order.id,
                amount: event.amount,
                status: PaymentStatus.FAILED,
                gateway: this.gateway.name,
                gatewayRef: event.gatewayRef,
                transactionId: event.transactionId,
                attemptNo,
              },
            });
          }

          await tx.orderLog.create({
            data: {
              orderId: order.id,
              type: 'PAYMENT_FAILED',
              attemptNo: currentPayment.attemptNo,
              detail: {
                gatewayRef: event.gatewayRef,
                transactionId: event.transactionId,
                reason: (event as any).message ?? 'Payment failed',
              },
            },
          });
        });

        return { received: true, status: 'FAILED' };
      }
    }

    // 4. Calculate authoritative order total from DB
    let orderTotal = 0;
    for (const item of order.items) {
      orderTotal += item.seat?.category?.price ?? item.unitPrice;
    }

    // 5. Amount mismatch check
    if (event.status === 'SUCCESS' && event.amount !== orderTotal) {
      await this.db.$transaction(async (tx) => {
        await tx.order.update({
          where: { id: order.id },
          data: { status: OrderStatus.NEEDS_REVIEW },
        });

        const payment = await tx.payment.findFirst({
          where: { gatewayRef: event.gatewayRef },
        });

        if (payment) {
          await tx.payment.update({
            where: { id: payment.id },
            data: {
              status: PaymentStatus.AMOUNT_MISMATCH,
              transactionId: event.transactionId,
            },
          });
        } else {
          await tx.payment.create({
            data: {
              orderId: order.id,
              amount: event.amount,
              status: PaymentStatus.AMOUNT_MISMATCH,
              gateway: this.gateway.name,
              gatewayRef: event.gatewayRef,
              transactionId: event.transactionId,
            },
          });
        }
      });

      await this.accountantNotifier.notifyAmountMismatch({
        orderId: order.id,
        expectedAmount: orderTotal,
        receivedAmount: event.amount,
        transactionId: event.transactionId,
        gatewayRef: event.gatewayRef,
        reason:
          'Số tiền thanh toán nhận từ cổng không khớp với tổng tiền đơn hàng',
      });

      return { received: true, status: 'AMOUNT_MISMATCH' };
    }

    // 6. Successful event with matched amount in a SINGLE TRANSACTION
    if (event.status === 'SUCCESS') {
      try {
        return await this.db.$transaction(async (tx) => {
          // Advisory lock using gatewayRef to prevent race conditions
          if (typeof (tx as any).$executeRaw === 'function') {
            await (tx as any).$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${event.gatewayRef}))`;
          }

          // Check if order was already updated to PAID while waiting for lock
          const freshOrder = await tx.order.findUnique({
            where: { id: order.id },
          });
          if (!freshOrder || freshOrder.status === OrderStatus.PAID) {
            return { received: true, status: 'PAID' };
          }

          // (a) Conditional atomic update: only update if order is still PENDING / PENDING_PAYMENT
          // AND expiration time has NOT yet passed (S-23 mutual exclusion)
          const serverNow = new Date();
          const updateResult = await tx.order.updateMany({
            where: {
              id: order.id,
              status: { in: [OrderStatus.PENDING, OrderStatus.PENDING_PAYMENT] },
              ...(order.paymentExpiresAt
                ? { paymentExpiresAt: { gt: serverNow } }
                : order.expiresAt
                  ? { expiresAt: { gt: serverNow } }
                  : {}),
            },
            data: { status: OrderStatus.PAID },
          });

          if (updateResult.count === 0) {
            const postCheck = await tx.order.findUnique({
              where: { id: order.id },
            });
            if (postCheck?.status === OrderStatus.PAID) {
              return { received: true, status: 'PAID' };
            }

            // S-23: Order expired or collided with expiry job. Enter late payment path:
            // Release holds for this order
            await tx.$executeRaw(Prisma.sql`
              DELETE FROM seat_holds
              WHERE "seatId" IN (
                SELECT oi."seatId"
                FROM order_items oi
                JOIN seats s ON s.id = oi."seatId"
                WHERE oi."orderId" = ${order.id}::uuid
                  AND s."isSold" = false
              )
              ${order.holdSessionId ? Prisma.sql`AND "holdSessionId" = ${order.holdSessionId}::uuid` : Prisma.empty}
            `);

            // Mark order as NEEDS_REVIEW
            await tx.order.update({
              where: { id: order.id },
              data: { status: OrderStatus.NEEDS_REVIEW },
            });

            // Mark payment as LATE
            const existingPayment = await tx.payment.findFirst({
              where: { gatewayRef: event.gatewayRef },
            });

            if (existingPayment) {
              await tx.payment.update({
                where: { id: existingPayment.id },
                data: {
                  status: PaymentStatus.LATE,
                  transactionId: event.transactionId,
                },
              });
            } else {
              await tx.payment.create({
                data: {
                  orderId: order.id,
                  amount: event.amount,
                  status: PaymentStatus.LATE,
                  gateway: this.gateway.name,
                  gatewayRef: event.gatewayRef,
                  transactionId: event.transactionId,
                },
              });
            }

            setTimeout(() => {
              void this.accountantNotifier.notifyLatePayment({
                orderId: order.id,
                amount: event.amount,
                transactionId: event.transactionId,
                gatewayRef: event.gatewayRef,
                reason: 'Thanh toán sau khi đơn hết hạn, cần hoàn tiền',
              });
            }, 0);

            return { received: true, status: 'LATE' };
          }

          // (b) Seats -> SOLD (isSold = true) & release holds (executed strictly ONCE)
          const seatIds = order.items.map((item) => item.seatId);
          if (seatIds.length > 0) {
            await tx.seat.updateMany({
              where: { id: { in: seatIds } },
              data: { isSold: true },
            });

            await tx.seatHold.deleteMany({
              where: { seatId: { in: seatIds } },
            });
          }

          // (c) Payment -> SUCCEEDED with gateway transaction ID
          const existingPayment = await tx.payment.findFirst({
            where: { gatewayRef: event.gatewayRef },
          });

          if (existingPayment) {
            await tx.payment.update({
              where: { id: existingPayment.id },
              data: {
                status: PaymentStatus.SUCCEEDED,
                transactionId: event.transactionId,
              },
            });
          } else {
            await tx.payment.create({
              data: {
                orderId: order.id,
                amount: event.amount,
                status: PaymentStatus.SUCCEEDED,
                gateway: this.gateway.name,
                gatewayRef: event.gatewayRef,
                transactionId: event.transactionId,
              },
            });
          }

          return { received: true, status: 'PAID' };
        });
      } catch (error: any) {
        // Catch duplicate key / concurrency errors (Prisma P2002) and treat as idempotent success
        if (
          error?.code === 'P2002' ||
          error?.message?.includes('Unique constraint failed') ||
          error?.message?.includes('duplicate key value')
        ) {
          this.logger.warn(
            `Duplicate webhook caught by unique constraint for order ${event.orderId}: ${error.message}`,
          );
          return { received: true, status: 'PAID' };
        }
        throw error;
      }
    }

    // 7. Failed event: Payment -> FAILED, order remains PENDING
    const existingPayment = await this.db.payment.findFirst({
      where: { gatewayRef: event.gatewayRef },
    });

    if (existingPayment?.status === PaymentStatus.FAILED) {
      return { received: true, status: 'FAILED' };
    }

    await this.db.$transaction(async (tx) => {
      let currentPayment = existingPayment;
      if (existingPayment) {
        currentPayment = await tx.payment.update({
          where: { id: existingPayment.id },
          data: {
            status: PaymentStatus.FAILED,
            transactionId: event.transactionId,
          },
        });
      } else {
        const previousPayment = await tx.payment.findFirst({
          where: { orderId: order.id },
          orderBy: { attemptNo: 'desc' },
        });
        const attemptNo = (previousPayment?.attemptNo ?? 0) + 1;
        currentPayment = await tx.payment.create({
          data: {
            orderId: order.id,
            amount: event.amount,
            status: PaymentStatus.FAILED,
            gateway: this.gateway.name,
            gatewayRef: event.gatewayRef,
            transactionId: event.transactionId,
            attemptNo,
          },
        });
      }

      await tx.orderLog.create({
        data: {
          orderId: order.id,
          type: 'PAYMENT_FAILED',
          attemptNo: currentPayment.attemptNo,
          detail: {
            gatewayRef: event.gatewayRef,
            transactionId: event.transactionId,
            reason: (event as any).message ?? 'Payment failed',
          },
        },
      });
    });

    return { received: true, status: 'FAILED' };
  }
}
