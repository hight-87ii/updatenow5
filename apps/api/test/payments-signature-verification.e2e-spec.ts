import { randomBytes, randomUUID } from 'node:crypto';
import type { INestApplication } from '@nestjs/common';
import { Logger } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { describe, beforeAll, afterAll, it, expect, vi } from 'vitest';
import { AppModule } from '../src/app.module.js';
import { PrismaService } from '../src/prisma/prisma.service.js';
import { hashSessionToken, SESSION_COOKIE } from '../src/auth/auth.service.js';
import { OrderStatus, PaymentStatus } from '@prisma/client';
import { buildMomoSignature } from '../src/payments/gateways/momo-signature.js';

describe('Payments S-21 Signature Verification E2E Integration', () => {
  let app: INestApplication;
  let db: PrismaService;
  let buyerId: string;
  let showtimeId: string;
  let seatCatId: string;
  let seatId: string;
  let orderId: string;
  let gatewayRef: string;

  const momoAccessKey = process.env.MOMO_ACCESS_KEY ?? 'F8BBA842ECF85';
  const momoSecretKey =
    process.env.MOMO_SECRET_KEY ??
    process.env.PAYMENT_WEBHOOK_SECRET ??
    'K951B6PE1waDMi640xX08PD3vg6EkVlz';

  // Spy on console/logger to assert logs do not leak secrets or signatures
  const logWarnSpy = vi.spyOn(Logger.prototype, 'warn');

  async function createAccount(role: string) {
    await db.role.createMany({ data: [{ name: role }], skipDuplicates: true });
    const r = await db.role.findUniqueOrThrow({ where: { name: role } });
    const user = await db.user.create({
      data: {
        email: `${randomUUID()}@s21-e2e.test`,
        password: 'secure-test-password',
        isEmailVerified: true,
        userRoles: { create: { roleId: r.id } },
      },
    });
    const token = randomBytes(32).toString('base64url');
    await db.session.create({
      data: {
        tokenHash: hashSessionToken(token),
        userId: user.id,
        expiresAt: new Date(Date.now() + 600000),
      },
    });
    return { id: user.id, cookie: `${SESSION_COOKIE}=${token}` };
  }

  function signPayload(payload: Record<string, unknown>, secret = momoSecretKey) {
    const signed = { ...payload };
    signed.signature = buildMomoSignature(signed, momoAccessKey, secret);
    return signed;
  }

  beforeAll(async () => {
    const target = new URL(process.env.DATABASE_URL ?? '');
    if (
      target.hostname !== '127.0.0.1' ||
      target.port !== '15432' ||
      target.pathname !== '/sprint2_integration'
    ) {
      throw new Error('Run only on the isolated sprint2_integration database');
    }

    const moduleRef = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();

    app = moduleRef.createNestApplication();
    await app.init();
    db = app.get(PrismaService);

    const organizer = await createAccount('ORGANIZER');
    const buyer = await createAccount('BUYER');
    buyerId = buyer.id;

    const event = await db.event.create({
      data: {
        name: 'S21 Signature Verification Event',
        description: 'Testing webhook signature verification',
        location: 'Hà Nội',
        organizerId: organizer.id,
        status: 'PUBLISHED',
      },
    });

    const showtime = await db.showtime.create({
      data: {
        eventId: event.id,
        startTime: new Date('2026-11-20T20:00:00Z'),
        status: 'ON_SALE',
      },
    });
    showtimeId = showtime.id;

    const cat = await db.seatCategory.create({
      data: {
        showtimeId: showtime.id,
        name: 'VIP',
        price: 350000,
      },
    });
    seatCatId = cat.id;

    const seat = await db.seat.create({
      data: {
        showtimeId,
        categoryId: seatCatId,
        row: 'S',
        seatNumber: 21,
      },
    });
    seatId = seat.id;

    const order = await db.order.create({
      data: {
        userId: buyerId,
        showtimeId,
        status: OrderStatus.PENDING,
        paymentExpiresAt: new Date(Date.now() + 600000),
        expiresAt: new Date(Date.now() + 600000),
        totalAmount: 350000,
        items: {
          create: [
            {
              seatId: seat.id,
              categoryName: 'VIP',
              unitPrice: 350000,
            },
          ],
        },
      },
    });
    orderId = order.id;
    gatewayRef = `${order.id}_${Date.now()}`;

    await db.payment.create({
      data: {
        orderId: order.id,
        amount: 350000,
        status: PaymentStatus.INITIATED,
        gateway: 'momo',
        gatewayRef,
      },
    });
  });

  afterAll(async () => {
    if (db) {
      await db.payment.deleteMany();
      await db.orderItem.deleteMany();
      await db.order.deleteMany();
      await db.seatHold.deleteMany();
      await db.holdSession.deleteMany();
      await db.seat.deleteMany();
      await db.seatCategory.deleteMany();
      await db.showtime.deleteMany();
      await db.event.deleteMany();
    }
    await app.close();
  });

  it('AC 1: Webhook with invalid signature returns 401, leaves DB unchanged and logs client IP without secrets', async () => {
    const invalidSignaturePayload = {
      partnerCode: 'MOMO',
      orderId: gatewayRef,
      requestId: gatewayRef,
      amount: 350000,
      orderInfo: `Thanh toan don hang ${orderId}`,
      orderType: 'momo_wallet',
      transId: `trans_fake_${Date.now()}`,
      resultCode: 0,
      message: 'Giao dich thanh cong.',
      payType: 'qr',
      responseTime: Date.now(),
      extraData: Buffer.from(JSON.stringify({ orderId })).toString('base64'),
      signature: 'this_is_a_completely_fake_invalid_signature_hex_value',
    };

    const res = await request(app.getHttpServer())
      .post('/payments/webhook')
      .set('X-Forwarded-For', '203.0.113.195')
      .send(invalidSignaturePayload)
      .expect(401);

    expect(res.body.message).toMatch(/Chữ ký không hợp lệ/i);

    // Verify DB was NOT touched
    const order = await db.order.findUniqueOrThrow({ where: { id: orderId } });
    expect(order.status).toBe(OrderStatus.PENDING);

    const seat = await db.seat.findUniqueOrThrow({ where: { id: seatId } });
    expect(seat.isSold).toBe(false);

    const payment = await db.payment.findFirstOrThrow({ where: { gatewayRef } });
    expect(payment.status).toBe(PaymentStatus.INITIATED);

    // Assert log contains client IP and does NOT leak signature or secret
    expect(logWarnSpy).toHaveBeenCalledWith(
      expect.stringContaining('203.0.113.195'),
    );
    for (const call of logWarnSpy.mock.calls) {
      const logMessage = String(call[0]);
      expect(logMessage).not.toContain(momoSecretKey);
      expect(logMessage).not.toContain('this_is_a_completely_fake_invalid_signature_hex_value');
    }
  });

  it('AC 1 (Bonus): Webhook with malformed non-JSON body returns 401 instead of 400', async () => {
    const res = await request(app.getHttpServer())
      .post('/payments/webhook')
      .set('Content-Type', 'application/json')
      .set('X-Forwarded-For', '198.51.100.42')
      .send('{"not_valid_json": incomplete string without closing bracket...')
      .expect(401);

    expect(res.body.message).toMatch(/Chữ ký không hợp lệ/i);
  });

  it('AC 2: Webhook missing signature field returns 401', async () => {
    const payloadWithoutSignature = {
      partnerCode: 'MOMO',
      orderId: gatewayRef,
      requestId: gatewayRef,
      amount: 350000,
      orderInfo: `Thanh toan don hang ${orderId}`,
      transId: `trans_no_sig_${Date.now()}`,
      resultCode: 0,
      message: 'Giao dich thanh cong.',
    };

    const res = await request(app.getHttpServer())
      .post('/payments/webhook')
      .send(payloadWithoutSignature)
      .expect(401);

    expect(res.body.message).toMatch(/Chữ ký không hợp lệ/i);
  });

  it('AC 3: Webhook with valid signature but non-existent orderId returns 404 and logs orderId and IP', async () => {
    const nonExistentOrderId = randomUUID();
    const fakeGatewayRef = `${nonExistentOrderId}_${Date.now()}`;
    const extraData = Buffer.from(JSON.stringify({ orderId: nonExistentOrderId })).toString('base64');

    const validSignedPayload = signPayload({
      partnerCode: 'MOMO',
      orderId: fakeGatewayRef,
      requestId: fakeGatewayRef,
      amount: 350000,
      orderInfo: `Thanh toan don hang ${nonExistentOrderId}`,
      orderType: 'momo_wallet',
      transId: `trans_${Date.now()}`,
      resultCode: 0,
      message: 'Giao dich thanh cong.',
      payType: 'qr',
      responseTime: Date.now(),
      extraData,
    });

    const res = await request(app.getHttpServer())
      .post('/payments/webhook')
      .set('X-Forwarded-For', '192.0.2.77')
      .send(validSignedPayload)
      .expect(404);

    expect(res.body.message).toMatch(/Không tìm thấy đơn hàng/i);

    // Verify warning log includes IP and orderId
    expect(logWarnSpy).toHaveBeenCalledWith(
      expect.stringContaining('192.0.2.77'),
    );
    expect(logWarnSpy).toHaveBeenCalledWith(
      expect.stringContaining(nonExistentOrderId),
    );
  });

  it('AC 4: Webhook with valid signature and existing order proceeds to normal processing (order PAID, seat SOLD, payment SUCCEEDED)', async () => {
    const extraData = Buffer.from(JSON.stringify({ orderId })).toString('base64');
    const validTransId = `momo_trans_s21_valid_${Date.now()}`;

    const validSignedPayload = signPayload({
      partnerCode: 'MOMO',
      orderId: gatewayRef,
      requestId: gatewayRef,
      amount: 350000,
      orderInfo: `Thanh toan don hang ${orderId}`,
      orderType: 'momo_wallet',
      transId: validTransId,
      resultCode: 0,
      message: 'Giao dich thanh cong.',
      payType: 'qr',
      responseTime: Date.now(),
      extraData,
    });

    const res = await request(app.getHttpServer())
      .post('/payments/webhook')
      .send(validSignedPayload)
      .expect(200);

    expect(res.body).toEqual({ received: true, status: 'PAID' });

    // Verify DB updates
    const updatedOrder = await db.order.findUniqueOrThrow({ where: { id: orderId } });
    expect(updatedOrder.status).toBe(OrderStatus.PAID);

    const updatedSeat = await db.seat.findUniqueOrThrow({ where: { id: seatId } });
    expect(updatedSeat.isSold).toBe(true);

    const updatedPayment = await db.payment.findFirstOrThrow({ where: { gatewayRef } });
    expect(updatedPayment.status).toBe(PaymentStatus.SUCCEEDED);
    expect(updatedPayment.transactionId).toBe(validTransId);
  });
});
