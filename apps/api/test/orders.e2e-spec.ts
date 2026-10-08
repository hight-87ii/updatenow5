import { randomBytes, randomUUID } from 'node:crypto';
import type { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { describe, beforeAll, afterAll, it, expect } from 'vitest';
import { AppModule } from '../src/app.module.js';
import { PrismaService } from '../src/prisma/prisma.service.js';
import { hashSessionToken, SESSION_COOKIE } from '../src/auth/auth.service.js';
import { OrderStatus } from '@prisma/client';

describe('Orders S-17 E2E Integration', () => {
  let app: INestApplication;
  let db: PrismaService;
  let buyer1Cookie: string;
  let buyer1Id: string;
  let buyer2Cookie: string;
  let showtimeId: string;
  let eventId: string;
  let seat1Id: string;
  let seat2Id: string;

  async function createAccount(role: string) {
    await db.role.createMany({ data: [{ name: role }], skipDuplicates: true });
    const r = await db.role.findUniqueOrThrow({ where: { name: role } });
    const user = await db.user.create({
      data: {
        email: `${randomUUID()}@order-e2e.test`,
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
    const b1 = await createAccount('BUYER');
    const b2 = await createAccount('BUYER');

    buyer1Id = b1.id;
    buyer1Cookie = b1.cookie;
    buyer2Cookie = b2.cookie;

    // Create event
    const event = await db.event.create({
      data: {
        name: 'Đêm Hòa Nhạc Giao Hưởng',
        description: 'Chương trình đỉnh cao',
        location: 'Nhà hát Hòa Bình',
        organizerId: organizer.id,
        status: 'PUBLISHED',
      },
    });
    eventId = event.id;

    // Create showtime
    const showtime = await db.showtime.create({
      data: {
        eventId: event.id,
        startTime: new Date('2026-12-25T19:00:00Z'),
        status: 'ON_SALE',
      },
    });
    showtimeId = showtime.id;

    // Create seat categories with prices
    const catVip = await db.seatCategory.create({
      data: {
        showtimeId: showtime.id,
        name: 'VIP',
        price: 500000,
      },
    });

    const catStandard = await db.seatCategory.create({
      data: {
        showtimeId: showtime.id,
        name: 'Standard',
        price: 300000,
      },
    });

    // Create seats
    const s1 = await db.seat.create({
      data: {
        showtimeId: showtime.id,
        categoryId: catVip.id,
        row: 'A',
        seatNumber: 1,
      },
    });
    const s2 = await db.seat.create({
      data: {
        showtimeId: showtime.id,
        categoryId: catStandard.id,
        row: 'A',
        seatNumber: 2,
      },
    });

    seat1Id = s1.id;
    seat2Id = s2.id;
  }, 30000);

  afterAll(async () => {
    if (app) await app.close();
  });

  it('AC 1 & AC 2: creates order from held seats, ignores client-forged total, and views order details', async () => {
    // 1. Buyer 1 holds seats s1 and s2
    const claimRes = await request(app.getHttpServer())
      .post(`/showtimes/${showtimeId}/holds`)
      .set('Cookie', buyer1Cookie)
      .send({ seatIds: [seat1Id, seat2Id] })
      .expect(200);

    expect(claimRes.body.hold).toBeDefined();
    expect(claimRes.body.hold.seatIds).toEqual(
      expect.arrayContaining([seat1Id, seat2Id]),
    );

    // 2. Buyer 1 creates order, attempting to spoof totalAmount: 1000 and unitPrice: 50
    const createRes = await request(app.getHttpServer())
      .post('/orders')
      .set('Cookie', buyer1Cookie)
      .send({
        showtimeId,
        seatIds: [seat1Id, seat2Id],
        totalAmount: 1000,
        unitPrice: 50,
      })
      .expect(201);

    const order = createRes.body;
    expect(order.id).toBeDefined();
    expect(order.status).toBe(OrderStatus.PENDING);
    // Expected total: 500000 (VIP) + 300000 (Standard) = 800000
    expect(order.totalAmount).toBe(800000);
    expect(order.event.name).toBe('Đêm Hòa Nhạc Giao Hưởng');
    expect(order.showtime.id).toBe(showtimeId);
    expect(order.items).toHaveLength(2);
    expect(order.remainingSeconds).toBeGreaterThan(0);
    expect(order.isExpired).toBe(false);

    // 3. Buyer 1 views order details via GET /orders/:id
    const getRes = await request(app.getHttpServer())
      .get(`/orders/${order.id}`)
      .set('Cookie', buyer1Cookie)
      .expect(200);

    expect(getRes.body.id).toBe(order.id);
    expect(getRes.body.totalAmount).toBe(800000);
    expect(getRes.body.event.name).toBe('Đêm Hòa Nhạc Giao Hưởng');
    expect(getRes.body.event.location).toBe('Nhà hát Hòa Bình');
    expect(getRes.body.items).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          seatId: seat1Id,
          tierName: 'VIP',
          unitPrice: 500000,
          label: 'A-1',
        }),
        expect.objectContaining({
          seatId: seat2Id,
          tierName: 'Standard',
          unitPrice: 300000,
          label: 'A-2',
        }),
      ]),
    );
  });

  it('AC 4: rejects access for unauthenticated user (401) and different user (404)', async () => {
    // Create an order for buyer 1
    const order = await db.order.create({
      data: {
        userId: buyer1Id,
        eventId,
        showtimeId,
        status: OrderStatus.PENDING,
        totalAmount: 500000,
        expiresAt: new Date(Date.now() + 600000),
        paymentExpiresAt: new Date(Date.now() + 600000),
        items: {
          create: [{ seatId: seat1Id, tierName: 'VIP', categoryName: 'VIP', unitPrice: 500000 }],
        },
      },
    });

    // Unauthenticated request
    await request(app.getHttpServer())
      .get(`/orders/${order.id}`)
      .expect(401);

    // Buyer 2 attempting to view Buyer 1's order -> 404 (do not leak existence)
    await request(app.getHttpServer())
      .get(`/orders/${order.id}`)
      .set('Cookie', buyer2Cookie)
      .expect(404);
  });

  it('AC 3: marks expired order as EXPIRED and isExpired=true', async () => {
    // Create an expired order directly in DB
    const expiredOrder = await db.order.create({
      data: {
        userId: buyer1Id,
        eventId,
        showtimeId,
        status: OrderStatus.PENDING,
        totalAmount: 300000,
        expiresAt: new Date(Date.now() - 5000), // expired 5 seconds ago
        paymentExpiresAt: new Date(Date.now() - 5000),
        items: {
          create: [{ seatId: seat2Id, tierName: 'Standard', categoryName: 'Standard', unitPrice: 300000 }],
        },
      },
    });

    const res = await request(app.getHttpServer())
      .get(`/orders/${expiredOrder.id}`)
      .set('Cookie', buyer1Cookie)
      .expect(200);

    expect(res.body.isExpired).toBe(true);
    expect(res.body.status).toBe(OrderStatus.EXPIRED);
    expect(res.body.remainingSeconds).toBe(0);
  });
});
