"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { CurrentUser, loadCurrentUser } from "@/lib/api";
import {
  OrganizerLayout,
  PublicLayout,
} from "@/components/layout/product-layout";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { SessionActions } from "@/components/layout/session-actions";
import { Skeleton } from "@/components/ui/skeleton";

export default function AccountPage() {
  const router = useRouter();
  const [user, setUser] = useState<CurrentUser | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  useEffect(() => {
    let mounted = true;
    loadCurrentUser()
      .then((result) => {
        if (!mounted) return;
        if (!result) router.replace("/login");
        else setUser(result);
      })
      .catch(
        () =>
          mounted && setError("Không tải được tài khoản. Hãy tải lại trang."),
      )
      .finally(() => mounted && setLoading(false));
    return () => {
      mounted = false;
    };
  }, [router]);

  const content = (
    <div className="operations-page account-page">
      <div className="page-heading">
        <div>
          <h1>Tài khoản</h1>
          <p>Thông tin tài khoản và vai trò được cấp.</p>
        </div>
      </div>
      {loading && (
        <div role="status" aria-label="Đang tải tài khoản">
          <Skeleton className="h-48 w-full" />
        </div>
      )}
      {error && (
        <section className="operations-panel" role="alert">
          <p>{error}</p>
          <Button variant="outline" onClick={() => window.location.reload()}>
            Tải lại trang
          </Button>
        </section>
      )}
      {user && (
        <>
          {!user.roles.includes("ORGANIZER") && (
            <div className="account-mobile-session">
              <SessionActions accountLink={false} />
            </div>
          )}
          <section className="operations-panel">
            <h2>Thông tin tài khoản</h2>
            <dl className="account-facts">
              <div>
                <dt>Email</dt>
                <dd>{user.email}</dd>
              </div>
              <div>
                <dt>Vai trò</dt>
                <dd>
                  {user.roles.map((role) => (
                    <Badge key={role} variant="outline">
                      {role === "ORGANIZER"
                        ? "Ban tổ chức"
                        : role === "BUYER"
                          ? "Người mua"
                          : role}
                    </Badge>
                  ))}
                </dd>
              </div>
              <div>
                <dt>Đăng nhập</dt>
                <dd>Phiên hiện tại đã được xác nhận.</dd>
              </div>
            </dl>
          </section>
          <section className="operations-panel">
            <h2>Chức năng của bạn</h2>
            <p>
              {user.roles.includes("ORGANIZER")
                ? "Quản lý sự kiện, suất diễn, sơ đồ ghế và giá vé thuộc quyền của bạn."
                : "Khám phá sự kiện đang mở bán, chọn và giữ ghế."}
            </p>
            <div className="operations-actions">
              <Button asChild>
                <Link href={user.roles.includes("ORGANIZER") ? "/events" : "/"}>
                  {user.roles.includes("ORGANIZER")
                    ? "Quản lý sự kiện"
                    : "Khám phá sự kiện"}
                </Link>
              </Button>
              {user.roles.includes("ORGANIZER") && (
                <Button variant="outline" asChild>
                  <Link href="/">Khám phá sự kiện</Link>
                </Button>
              )}
              {user.roles.includes("ACCOUNTANT") && (
                <Button variant="outline" asChild>
                  <Link href="/account/reconciliation">Đối soát thanh toán</Link>
                </Button>
              )}
            </div>
          </section>
        </>
      )}
    </div>
  );
  return user?.roles.includes("ORGANIZER") ? (
    <OrganizerLayout title="Tài khoản" mode="account">
      {content}
    </OrganizerLayout>
  ) : (
    <PublicLayout signedIn={!!user}>{content}</PublicLayout>
  );
}
