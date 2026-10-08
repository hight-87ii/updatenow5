import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Inject,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { Prisma, ShowtimeStatus } from '@prisma/client';
import type { Redis } from 'ioredis';
import { randomUUID, createHash } from 'node:crypto';
import { ConfigService } from '@nestjs/config';
import { SEAT_STATUS_SQL } from './seat-status.sql.js';
import { PrismaService } from '../prisma/prisma.service.js';
import { validateSeatMap, type ImportedSeat } from './seat-map.js';
import { parseTicketLimit } from '../holds/holds.service.js';
type Tx = Prisma.TransactionClient;
type SeatRow = {
  id: string;
  row: string;
  seatNumber: number;
  category: string;
  price: number | null;
  status: 'AVAILABLE' | 'HELD' | 'SOLD';
};
type PublicRow = {
  id: string;
  eventId: string;
  posterPath: string | null;
  mobilePosterPath: string | null;
  categoryLabel: string | null;
  categories: { name: string; price: number | null }[];
  startTime: Date;
  name: string;
  description: string;
  location: string;
  minPrice: number;
  maxPrice: number;
};
@Injectable()
export class ShowtimesService {
  private readonly cacheNamespace: string;
  constructor(
    private readonly db: PrismaService,
    @Inject('REDIS_CLIENT') private readonly redis: Redis,
    config: ConfigService,
  ) {
    const target = new URL(config.getOrThrow<string>('DATABASE_URL'));
    const identity = `${target.hostname}:${target.port}${target.pathname}`;
    this.cacheNamespace = `catalog:showtimes:contract-v3:${createHash('sha256').update(identity).digest('hex').slice(0, 16)}`;
  }
  private async owned(tx: Tx, id: string, owner: string, lock = false) {
    if (lock)
      await tx.$queryRaw`SELECT id FROM showtimes WHERE id = ${id}::uuid FOR UPDATE`;
    const show = await tx.showtime.findUnique({
      where: { id },
      include: {
        event: true,
        categories: { orderBy: { name: 'asc' } },
        _count: { select: { seats: true } },
      },
    });
    if (!show) throw new NotFoundException('Không tìm thấy suất diễn.');
    if (show.event.organizerId !== owner)
      throw new ForbiddenException('Bạn không có quyền sửa suất diễn này.');
    return show;
  }
  async manage(id: string, owner: string) {
    const show = await this.owned(this.db, id, owner);
    const siblings = await this.db.showtime.findMany({
      where: { eventId: show.eventId },
      orderBy: [{ startTime: 'asc' }, { id: 'asc' }],
      select: { id: true, startTime: true, status: true },
    });
    return { ...show, siblings };
  }
  private invalidate(tx: Tx) {
    return tx.catalogRevision.update({
      where: { id: 1 },
      data: { version: { increment: 1 } },
    });
  }
  async importMap(id: string, owner: string, body: unknown) {
    const errors = validateSeatMap(body);
    if (errors.length)
      throw new BadRequestException({
        message: 'Kiểm tra lại tệp sơ đồ.',
        errors,
      });
    const seats = (body as { seats: ImportedSeat[] }).seats;
    return this.db.$transaction(
      async (tx) => {
        const show = await this.owned(tx, id, owner, true);
        if (show.structureLocked || show.status !== 'DRAFT')
          throw new ConflictException('Sơ đồ đã khóa từ lần mở bán đầu tiên.');
        // T-22 is gated. No hold/ticket storage exists yet. Before enabling either,
        // add its authoritative occupancy predicate inside this same row lock.
        await tx.seat.deleteMany({ where: { showtimeId: id } });
        await tx.seatCategory.deleteMany({ where: { showtimeId: id } });
        const categories = [
          ...new Set(seats.map((s) => s.category.trim())),
        ].map((name) => ({ id: randomUUID(), showtimeId: id, name }));
        await tx.seatCategory.createMany({ data: categories });
        const categoryIds = new Map(categories.map((c) => [c.name, c.id]));
        await tx.seat.createMany({
          data: seats.map((s) => ({
            id: randomUUID(),
            showtimeId: id,
            categoryId: categoryIds.get(s.category.trim())!,
            row: s.row.trim(),
            seatNumber: s.seatNumber,
          })),
        });
        await tx.showtime.update({ where: { id }, data: { seatMapId: id } });
        return { count: seats.length, categories: categories.length };
      },
      { timeout: 10000 },
    );
  }
  async prices(id: string, owner: string, body: unknown) {
    const entries =
      body && typeof body === 'object'
        ? (body as Record<string, unknown>).prices
        : undefined;
    if (!Array.isArray(entries) || !entries.length || entries.length > 2000)
      throw new BadRequestException('Cần danh sách giá theo hạng.');
    const parsed: { id: string; price: number }[] = [];
    for (const value of entries) {
      const entry =
        value && typeof value === 'object'
          ? (value as Record<string, unknown>)
          : {};
      if (
        typeof entry.id !== 'string' ||
        !Number.isInteger(entry.price) ||
        Number(entry.price) < 0 ||
        Number(entry.price) > 2147483647
      )
        throw new BadRequestException(
          'Giá phải là số nguyên từ 0 đến 2.147.483.647 đồng.',
        );
      parsed.push({ id: entry.id, price: Number(entry.price) });
    }
    if (new Set(parsed.map((p) => p.id)).size !== parsed.length)
      throw new BadRequestException('Hạng ghế trùng trong danh sách giá.');
    return this.db.$transaction(async (tx) => {
      const show = await this.owned(tx, id, owner, true);
      if (parsed.some((p) => !show.categories.some((c) => c.id === p.id)))
        throw new BadRequestException('Hạng ghế không thuộc suất diễn.');
      for (const p of parsed)
        await tx.seatCategory.update({
          where: { id: p.id },
          data: { price: p.price },
        });
      await this.invalidate(tx);
      return { saved: parsed.length };
    });
  }
  async ticketLimit(id: string, owner: string, body: unknown) {
    const limit = parseTicketLimit(body);
    return this.db.$transaction(async (tx) => {
      await this.owned(tx, id, owner, true);
      return tx.showtime.update({
        where: { id },
        data: { maxTicketsPerUser: limit },
      });
    });
  }
  async status(id: string, owner: string, body: unknown) {    const next =
      body && typeof body === 'object'
        ? (body as Record<string, unknown>).status
        : undefined;
    if (next !== 'ON_SALE' && next !== 'CLOSED')
      throw new BadRequestException('Chọn mở bán hoặc đóng bán.');
    return this.db.$transaction(async (tx) => {
      const show = await this.owned(tx, id, owner, true);
      if (next === 'ON_SALE') {
        const reasons: string[] = [];
        if (!show._count.seats) reasons.push('Chưa có sơ đồ ghế.');
        const missing = show.categories
          .filter((c) => c.price === null)
          .map((c) => c.name);
        if (missing.length)
          reasons.push(`Chưa đặt giá: ${missing.join(', ')}.`);
        if (reasons.length)
          throw new ConflictException({ message: reasons.join(' '), reasons });
      } else if (show.status === 'DRAFT')
        throw new ConflictException('Suất nháp chưa mở bán.');
      const updated = await tx.showtime.update({
        where: { id },
        data: {
          status: next as ShowtimeStatus,
          ...(next === 'ON_SALE' ? { structureLocked: true } : {}),
        },
      });
      await this.invalidate(tx);
      return updated;
    });
  }
  async detail(id: string) {
    const show = await this.db.showtime.findUnique({
      where: { id },
      select: {
        id: true,
        startTime: true,
        status: true,
        event: {
          select: {
            id: true,
            name: true,
            description: true,
            location: true,
            posterPath: true,
            mobilePosterPath: true,
            bannerPath: true,
            categoryLabel: true,
          },
        },
        eventId: true,
        categories: { select: { name: true, price: true } },
      },
    });
    if (!show || show.status !== 'ON_SALE')
      throw new NotFoundException('Suất diễn chưa mở bán hoặc đã đóng.');
    const siblings = await this.db.showtime.findMany({
      where: {
        eventId: show.eventId,
        OR: [
          { status: 'ON_SALE' },
          { status: 'CLOSED', structureLocked: true },
        ],
      },
      orderBy: [{ startTime: 'asc' }, { id: 'asc' }],
      select: {
        id: true,
        startTime: true,
        status: true,
        categories: { select: { name: true, price: true } },
      },
    });
    const { eventId: _eventId, ...publicShow } = show;
    return { ...publicShow, siblings };
  }
  async list(cursor?: string) {
    let after: { time: string; id: string } | null = null;
    if (cursor) {
      try {
        const value: unknown = JSON.parse(
          Buffer.from(cursor, 'base64url').toString(),
        );
        if (!value || typeof value !== 'object') throw new Error();
        const v = value as Record<string, unknown>;
        if (
          typeof v.time !== 'string' ||
          Number.isNaN(Date.parse(v.time)) ||
          typeof v.id !== 'string' ||
          !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(
            v.id,
          )
        )
          throw new Error();
        after = { time: v.time, id: v.id };
      } catch {
        throw new BadRequestException('Con trỏ trang không hợp lệ.');
      }
    }
    // Revision is committed WITH status/price writes. Old in-flight cache fills
    // cannot poison the new revision, even when Redis is unavailable at mutation.
    const revision = await this.db.catalogRevision.findUniqueOrThrow({
      where: { id: 1 },
    });
    const key = `${this.cacheNamespace}:v${revision.version}:${cursor ?? 'first'}`;
    try {
      const cached = await this.redis.get(key);
      if (cached)
        return JSON.parse(cached) as {
          items: PublicRow[];
          nextCursor: string | null;
        };
    } catch {
      /* DB fallback; never fake data. */
    }
    const filter = after
      ? Prisma.sql`AND (s."startTime", s.id) > (${new Date(after.time)}::timestamptz, ${after.id}::uuid)`
      : Prisma.empty;
    const rows = await this.db.$queryRaw<PublicRow[]>(Prisma.sql`
      SELECT s.id, e.id AS "eventId", s."startTime", e.name, e.description, e.location, e."posterPath", e."mobilePosterPath", e."categoryLabel",
        json_agg(json_build_object('name',c.name,'price',c.price) ORDER BY c.name) AS categories,
        MIN(c.price)::int AS "minPrice", MAX(c.price)::int AS "maxPrice"
      FROM showtimes s JOIN events e ON e.id = s."eventId"
      JOIN seat_categories c ON c."showtimeId" = s.id
      WHERE s.status = 'ON_SALE' ${filter}
      GROUP BY s.id, e.id ORDER BY s."startTime", s.id LIMIT 13`);
    const items = rows.slice(0, 12);
    const last = items.at(-1);
    const result = {
      items,
      nextCursor:
        rows.length > 12 && last
          ? Buffer.from(
              JSON.stringify({
                time: last.startTime.toISOString(),
                id: last.id,
              }),
            ).toString('base64url')
          : null,
    };
    try {
      await this.redis.set(key, JSON.stringify(result), 'EX', 30);
    } catch {
      /* Cache optional; database result still authoritative. */
    }
    return result;
  }
  async publicSeats(id: string) {
    // One live snapshot for visibility and inventory, not two network queries.
    // A single JSON column avoids parsing six driver fields for each of 2000 rows.
    const [show] = await this.db.seatReadQuery<
      { status: string; seats: SeatRow[] }[]
    >(
      Prisma.sql`SELECT sh.status, (${this.seatProjection(id)}) AS seats
        FROM showtimes sh WHERE sh.id=${id}::uuid AND sh.status='ON_SALE'`,
    );
    if (!show || show.status !== 'ON_SALE')
      throw new NotFoundException('Suất diễn chưa mở bán hoặc đã đóng.');
    return show.seats;
  }
  async ownedSeats(id: string, owner: string) {
    const [show] = await this.db.seatReadQuery<{ organizerId: string }[]>(
      Prisma.sql`SELECT e."organizerId" FROM showtimes s JOIN events e ON e.id=s."eventId" WHERE s.id=${id}::uuid`,
    );
    if (!show) throw new NotFoundException('Không tìm thấy suất diễn.');
    if (show.organizerId !== owner)
      throw new ForbiddenException('Bạn không có quyền sửa suất diễn này.');
    return this.querySeats(id);
  }
  private async querySeats(id: string) {
    const [result] = await this.db.seatReadQuery<{ seats: SeatRow[] }[]>(
      Prisma.sql`SELECT (${this.seatProjection(id)}) AS seats`,
    );
    return result.seats;
  }
  private seatProjection(id: string) {
    // DEC-12: held uses the same PostgreSQL authority and DB clock as claims.
    // Sold remains a future ticket seam; Sprint 3 has no ticket model yet.
    return Prisma.sql`SELECT COALESCE(json_agg(seat ORDER BY seat.row,seat."seatNumber"),'[]'::json)
      FROM (SELECT s.id, s.row, s."seatNumber", c.name AS category, c.price, ${SEAT_STATUS_SQL} AS status
      FROM seats s JOIN seat_categories c ON c.id = s."categoryId" AND c."showtimeId" = s."showtimeId"
      LEFT JOIN seat_holds h ON h."seatId"=s.id
      LEFT JOIN LATERAL (SELECT s."isSold" AS sold, h."expiresAt") inventory ON true
      WHERE s."showtimeId" = ${id}::uuid) seat`;
  }
}
