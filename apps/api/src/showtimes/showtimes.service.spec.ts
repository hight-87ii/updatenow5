import { ConfigService } from '@nestjs/config';
import { ShowtimesService } from './showtimes.service.js';
import type { PrismaService } from '../prisma/prisma.service.js';
import type { Redis } from 'ioredis';

describe('live seat-map reads without detail overfetch', () => {
  const id = '00000000-0000-4000-8000-000000000001';
  function fixture() {
    const db = { seatReadQuery: vi.fn() };
    const service = new ShowtimesService(
      db as unknown as PrismaService,
      {} as Redis,
      new ConfigService({
        DATABASE_URL: 'postgresql://fixture@127.0.0.1:15432/fixture',
      }),
    );
    return { db, service };
  }

  it.each([
    { show: [] },
    { show: [{ status: 'DRAFT' }] },
    { show: [{ status: 'CLOSED' }] },
  ])(
    'rejects a nonpublic show before reading inventory (%j)',
    async ({ show }) => {
      const { db, service } = fixture();
      db.seatReadQuery.mockResolvedValue(show);
      await expect(service.publicSeats(id)).rejects.toMatchObject({
        status: 404,
      });
      expect(db.seatReadQuery).toHaveBeenCalledOnce();
    },
  );

  it('keeps empty inventory distinct from a missing show and rereads status', async () => {
    const { db, service } = fixture();
    db.seatReadQuery
      .mockResolvedValueOnce([{ status: 'ON_SALE', seats: [] }])
      .mockResolvedValueOnce([{ status: 'CLOSED' }]);
    await expect(service.publicSeats(id)).resolves.toEqual([]);
    await expect(service.publicSeats(id)).rejects.toMatchObject({
      status: 404,
    });
    expect(db.seatReadQuery.mock.calls[0][0].values).toEqual([id, id]);
  });

  it('reads current prices/status with the unchanged public projection and ordering', async () => {
    const { db, service } = fixture();
    const rows = [
      {
        id,
        row: 'A',
        seatNumber: 1,
        category: 'VIP',
        price: 0,
        status: 'HELD',
      },
    ];
    db.seatReadQuery.mockResolvedValueOnce([
      { status: 'ON_SALE', seats: rows },
    ]);
    await expect(service.publicSeats(id)).resolves.toBe(rows);
    const sql = db.seatReadQuery.mock.calls[0][0];
    expect(sql.text).toContain('clock_timestamp()');
    expect(sql.text).toContain('ORDER BY seat.row,seat."seatNumber"');
    expect(sql.text).toContain("sh.status='ON_SALE'");
    expect(db.seatReadQuery).toHaveBeenCalledOnce();
    expect(sql.text).not.toContain('holderId');
    expect(sql.text).not.toContain('sessionHash');
    expect(sql.values).toEqual([id, id]);
  });

  it('keeps organizer ownership enforcement for draft preview', async () => {
    const { db, service } = fixture();
    db.seatReadQuery
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([{ organizerId: 'other' }])
      .mockResolvedValueOnce([{ organizerId: 'owner' }])
      .mockResolvedValueOnce([{ seats: [] }]);
    await expect(service.ownedSeats(id, 'owner')).rejects.toMatchObject({
      status: 404,
    });
    await expect(service.ownedSeats(id, 'owner')).rejects.toMatchObject({
      status: 403,
    });
    await expect(service.ownedSeats(id, 'owner')).resolves.toEqual([]);
    expect(db.seatReadQuery).toHaveBeenCalledTimes(4);
  });
});

describe('S-58 clone showtime with map and prices', () => {
  const id = '00000000-0000-4000-8000-000000000001';
  const future = new Date(Date.now() + 86400000).toISOString();
  function fixture(show: unknown, seats: unknown[] = []) {
    const tx = {
      $queryRaw: vi.fn().mockResolvedValue([]),
      showtime: {
        findUnique: vi.fn().mockResolvedValue(show),
        count: vi.fn().mockResolvedValue(0),
        create: vi.fn((args: { data: Record<string, unknown> }) =>
          Promise.resolve({
            id: '00000000-0000-4000-8000-000000000002',
            status: 'DRAFT',
            ...args.data,
          }),
        ),
        update: vi.fn(),
      },
      seat: {
        findMany: vi.fn().mockResolvedValue(seats),
        createMany: vi.fn().mockResolvedValue({ count: seats.length }),
      },
      seatCategory: { create: vi.fn() },
    };
    const db = {
      $transaction: vi.fn((cb: (tx: unknown) => unknown) => cb(tx)),
    };
    const service = new ShowtimesService(
      db as never,
      {} as never,
      new ConfigService({
        DATABASE_URL: 'postgresql://fixture@127.0.0.1:15432/fixture',
      }),
    );
    return { db, tx, service };
  }
  const ownedShow = (organizerId = 'owner') => ({
    id,
    eventId: 'event-1',
    seatMapId: id,
    event: { organizerId },
    categories: [
      { id: 'cat-vip', name: 'VIP', price: 500000 },
      { id: 'cat-std', name: 'Standard', price: 200000 },
    ],
  });
  const sourceSeats = [
    { row: 'A', seatNumber: 1, categoryId: 'cat-vip' },
    { row: 'A', seatNumber: 2, categoryId: 'cat-std' },
  ];

  it.each([{ startTime: 'not-a-date' }, { startTime: '2030-01-01T10:00:00' }])(
    'rejects startTime without timezone (%j) before touching the database',
    async (body) => {
      const { db, service } = fixture(ownedShow(), sourceSeats);
      await expect(service.clone(id, 'owner', body)).rejects.toMatchObject({
        status: 400,
      });
      expect(db.$transaction).not.toHaveBeenCalled();
    },
  );

  it('rejects a past startTime', async () => {
    const { db, service } = fixture(ownedShow(), sourceSeats);
    await expect(
      service.clone(id, 'owner', { startTime: '2000-01-01T10:00:00+07:00' }),
    ).rejects.toMatchObject({ status: 400 });
    expect(db.$transaction).not.toHaveBeenCalled();
  });

  it('returns 404 for a missing source and 403 for another organizer', async () => {
    const missing = fixture(null, []);
    await expect(
      missing.service.clone(id, 'owner', { startTime: future }),
    ).rejects.toMatchObject({ status: 404 });
    const foreign = fixture(ownedShow('someone-else'), []);
    await expect(
      foreign.service.clone(id, 'owner', { startTime: future }),
    ).rejects.toMatchObject({ status: 403 });
  });

  it('creates a DRAFT copy with the same prices and empty seats', async () => {
    const { tx, service } = fixture(ownedShow(), sourceSeats);
    const result = await service.clone(id, 'owner', { startTime: future });
    expect(tx.showtime.create).toHaveBeenCalledWith({
      data: { eventId: 'event-1', startTime: new Date(future) },
    });
    expect(result).toMatchObject({
      status: 'DRAFT',
      seatCount: 2,
      categoryCount: 2,
      warning: null,
    });
    // Prices carried over per category name.
    const createdPrices = tx.seatCategory.create.mock.calls.map(
      (call) => call[0].data,
    );
    expect(createdPrices).toHaveLength(2);
    expect(
      createdPrices.find((c) => c.name === 'VIP'),
    ).toMatchObject({ price: 500000 });
    expect(
      createdPrices.find((c) => c.name === 'Standard'),
    ).toMatchObject({ price: 200000 });
    // Seats get fresh ids on the new showtime; nothing sold or held.
    const copied = tx.seat.createMany.mock.calls[0][0].data;
    expect(copied).toHaveLength(2);
    for (const seat of copied) {
      expect(seat.showtimeId).toBe(result.id);
      expect(seat).not.toHaveProperty('isSold', true);
    }
    expect(
      new Set(copied.map((s: { id: string }) => s.id)).size,
    ).toBe(2);
    expect(tx.showtime.update).toHaveBeenCalledWith({
      where: { id: result.id },
      data: { seatMapId: result.id },
    });
  });

  it('warns on a duplicate start time but still clones', async () => {
    const { tx, service } = fixture(ownedShow(), []);
    tx.showtime.count.mockResolvedValue(1);
    const result = await service.clone(id, 'owner', { startTime: future });
    expect(result.seatCount).toBe(0);
    expect(result.warning).toContain('cùng giờ');
    expect(tx.seat.createMany).not.toHaveBeenCalled();
  });
});
