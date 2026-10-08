-- S-42: per-account ticket limit per showtime. Nullable = unlimited, so existing
-- rows need no backfill and the check is skipped until an organizer sets a limit.
ALTER TABLE "showtimes" ADD COLUMN "maxTicketsPerUser" INTEGER;
