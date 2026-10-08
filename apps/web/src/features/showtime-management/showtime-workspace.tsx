"use client";
import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { Button } from "@/components/ui/button";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Skeleton } from "@/components/ui/skeleton";
import { api } from "@/lib/api/client";
import {
  decodeOwnedShowtime,
  decodeSeats,
  type OwnedShowtime,
  type Seat,
} from "@/lib/contracts/showtimes";
import { formatShowtime } from "@/lib/formatting";
import { SeatMap } from "@/components/seat-map/seat-map";
import { SeatPricingForm } from "@/features/seat-pricing/seat-pricing-form";
import { SeatMapImportForm } from "@/features/seat-map-import/seat-map-import-form";
import { SaleStatusControl } from "./sale-status-control";
import { ShowtimeCloneForm } from "./showtime-clone-form";
export function ShowtimeWorkspace({
  id,
  mode,
}: {
  id: string;
  mode: "manage" | "import" | "prices" | "map";
}) {
  const [show, setShow] = useState<OwnedShowtime | null>(null),
    [seats, setSeats] = useState<Seat[]>([]),
    [loading, setLoading] = useState(true),
    [error, setError] = useState("");
  const fetchWorkspace = useCallback(
    async (signal?: AbortSignal) => {
      const [detail, map] = await Promise.all([
        api(`/showtimes/${id}/manage`, decodeOwnedShowtime, { signal }),
        api(`/showtimes/${id}/manage/seats`, decodeSeats, { signal }),
      ]);
      if (signal?.aborted) throw new DOMException("Aborted", "AbortError");
      detail.categories.sort(
        (a, b) =>
          map.findIndex((s) => s.category === a.name) -
          map.findIndex((s) => s.category === b.name),
      );
      return { detail, map };
    },
    [id],
  );
  async function refresh() {
    const { detail, map } = await fetchWorkspace();
    setShow(detail);
    setSeats(map);
  }
  useEffect(() => {
    const controller = new AbortController();
    fetchWorkspace(controller.signal)
      .then(({ detail, map }) => {
        if (!controller.signal.aborted) {
          setShow(detail);
          setSeats(map);
        }
      })
      .catch((e) => {
        if (!controller.signal.aborted) setError(e.message);
      })
      .finally(() => {
        if (!controller.signal.aborted) setLoading(false);
      });
    return () => controller.abort();
  }, [fetchWorkspace]);
  if (loading) return <Skeleton className="h-64 w-full" />;
  if (error)
    return (
      <Alert variant="destructive">
        <AlertDescription>
          {error}
          <Button
            variant="outline"
            onClick={() => {
              setError("");
              refresh().catch((e) => setError(e.message));
            }}
          >
            Thử lại
          </Button>
        </AlertDescription>
      </Alert>
    );
  if (!show) return null;
  const titles = {
    manage: "Quản lý suất diễn",
    import: "Nạp sơ đồ JSON",
    prices: "Đặt giá theo hạng",
    map: "Xem sơ đồ ghế",
  };
  return (
    <>
      <div className="page-heading">
        <div>
          <h1>{titles[mode]}</h1>
          <p>
            {mode === "prices"
              ? "Thiết lập đơn giá cho từng phân khu ghế trước khi mở bán."
              : mode === "import"
                ? "Kiểm tra tọa độ và nạp dữ liệu sơ đồ cho suất diễn."
                : mode === "map"
                  ? "Kiểm tra vị trí, hạng vé và giá từng ghế."
                  : "Kiểm soát trạng thái phát hành từng suất biểu diễn."}
          </p>
        </div>
        <div className="page-heading-actions">
          {mode === "prices" ? (
            <Button variant="outline" asChild>
              <Link href={`/showtimes/${id}/map`}>
                Xem sơ đồ ghế kiểm tra vị trí
              </Link>
            </Button>
          ) : (
            <Button
              variant="outline"
              onClick={() => refresh().catch((e) => setError(e.message))}
            >
              Làm mới
            </Button>
          )}
          {mode === "manage" && (
            <Button asChild>
              <Link href={`/events/${show.event.id}`}>Tạo suất diễn mới</Link>
            </Button>
          )}
        </div>
      </div>
      {mode !== "manage" && (
        <section
          className={`product-show-context ${mode !== "prices" ? "mobile-show-context" : ""}`}
        >
          <div>
            <strong>{show.event.name}</strong>
            <p>{show.event.location}</p>
          </div>
          <div>
            <strong>{formatShowtime(show.startTime, "short")}</strong>
            <p>
              {show.status === "ON_SALE"
                ? "Đang mở bán"
                : show.status === "CLOSED"
                  ? "Đã đóng bán"
                  : "Nháp"}
            </p>
          </div>
        </section>
      )}
      {mode === "manage" && (
        <nav className="workflow-mobile-nav" aria-label="Thao tác suất diễn">
          <Link href={`/showtimes/${id}/manage`}>Suất diễn</Link>
          <Link href={`/showtimes/${id}/import`}>Nạp sơ đồ JSON</Link>
          <Link href={`/showtimes/${id}/prices`}>Giá vé</Link>
          <Link href={`/showtimes/${id}/map`}>Xem sơ đồ</Link>
        </nav>
      )}
      {mode === "manage" && (
        <div className="manage-layout">
          <aside className="showtime-list">
            <h2>Danh sách suất diễn</h2>
            {show.siblings.map((s, i) => (
              <Link
                key={s.id}
                href={`/showtimes/${s.id}/manage`}
                aria-current={s.id === id ? "page" : undefined}
              >
                <div className="showtime-card-heading">
                  <small>Suất {i + 1}</small>
                  <span>
                    {s.status === "ON_SALE"
                      ? "Đang bán"
                      : s.status === "CLOSED"
                        ? "Đã đóng"
                        : "Nháp"}
                  </span>
                </div>
                <strong>{formatShowtime(s.startTime, "full")}</strong>
                <div className="showtime-card-meta">
                  {s.id === id
                    ? `${show._count.seats.toLocaleString("vi-VN")} ghế · ${show.categories.length} phân khu`
                    : show.event.location}
                </div>
                <div className="showtime-card-state">
                  {s.id === id && show.structureLocked
                    ? "Cấu trúc sơ đồ đã khóa"
                    : "Xem chi tiết suất diễn"}
                </div>
              </Link>
            ))}
          </aside>
          <div>
            <SaleStatusControl key={id} show={show} onChanged={refresh} />
            <ShowtimeCloneForm key={`clone-${id}`} id={id} />
          </div>
        </div>
      )}
      {mode === "import" && (
        <SeatMapImportForm
          key={id}
          id={id}
          locked={show.structureLocked}
          context={{
            name: show.event.name,
            location: show.event.location,
            date: formatShowtime(show.startTime, "short"),
          }}
          onSaved={refresh}
        />
      )}
      {mode === "prices" && (
        <SeatPricingForm
          key={id}
          id={id}
          categories={show.categories}
          seats={seats}
          onSaved={refresh}
        />
      )}
      {mode === "map" && (
        <>
          <p className="readonly-notice">
            Chế độ chỉ xem. Chạm hoặc dùng phím mũi tên để đọc thông tin ghế;
            không thay đổi trạng thái.
          </p>
          <div className="map-route-actions">
            <Link href={`/showtimes/${id}/import`}>Nạp sơ đồ JSON</Link>
            <Link href={`/showtimes/${id}/prices`}>Chỉnh sửa bảng giá</Link>
          </div>
          <SeatMap seats={seats} inspection="aside" />
        </>
      )}
    </>
  );
}
