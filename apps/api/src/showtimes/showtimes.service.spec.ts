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

describe('S-42 organizer ticket limit', () => {
  const id = '00000000-0000-4000-8000-000000000001';
  function fixture(organizerId: string | null) {
    const tx = {
      $queryRaw: vi.fn().mockResolvedValue([]),
      showtime: {
        findUnique: vi.fn().mockResolvedValue(
          organizerId === null
            ? null
            : {
                id,
                event: { organizerId },
                categories: [],
                _count: { seats: 0 },
              },
        ),
        update: vi.fn().mockImplementation(({ data }: { data: unknown }) => ({
          id,
          ...(data as Record<string, unknown>),
        })),
      },
    };
    const db = {
      $transaction: vi.fn().mockImplementation((cb: (tx: unknown) => unknown) => cb(tx)),
    };
    const service = new ShowtimesService(
      db as unknown as PrismaService,
      {} as Redis,
      new ConfigService({
        DATABASE_URL: 'postgresql://fixture@127.0.0.1:15432/fixture',
      }),
    );
    return { db, tx, service };
  }

  it('saves a valid limit for the owning organizer', async () => {
    const { tx, service } = fixture('owner-1');
    await expect(
      service.ticketLimit(id, 'owner-1', { maxTicketsPerUser: 4 }),
    ).resolves.toMatchObject({ maxTicketsPerUser: 4 });
    expect(tx.showtime.update).toHaveBeenCalledWith({
      where: { id },
      data: { maxTicketsPerUser: 4 },
    });
  });

  it('clears the limit back to unlimited', async () => {
    const { tx, service } = fixture('owner-1');
    await expect(
      service.ticketLimit(id, 'owner-1', { maxTicketsPerUser: null }),
    ).resolves.toMatchObject({ maxTicketsPerUser: null });
    expect(tx.showtime.update).toHaveBeenCalledWith({
      where: { id },
      data: { maxTicketsPerUser: null },
    });
  });

  it.each([[0], [-2], [2001], [2.5], ['4'], [[4]]])(
    'rejects invalid limit %j with 400 before touching the database',
    async (maxTicketsPerUser) => {
      const { db, service } = fixture('owner-1');
      await expect(
        service.ticketLimit(id, 'owner-1', { maxTicketsPerUser }),
      ).rejects.toMatchObject({ status: 400 });
      expect(db.$transaction).not.toHaveBeenCalled();
    },
  );

  it('rejects other organizers with 403 and missing shows with 404', async () => {
    const other = fixture('owner-1');
    await expect(
      other.service.ticketLimit(id, 'owner-2', { maxTicketsPerUser: 4 }),
    ).rejects.toMatchObject({ status: 403 });
    const missing = fixture(null);
    await expect(
      missing.service.ticketLimit(id, 'owner-1', { maxTicketsPerUser: 4 }),
    ).rejects.toMatchObject({ status: 404 });
  });
});
