import Link from "next/link";
import {
  ArrowLeft,
  Ticket,
  Search,
  MapPin,
  ChevronDown,
  Armchair,
  Menu,
  LifeBuoy,
  Home,
  Theater,
  Schedule,
  Map,
  Sell,
  Person,
  Admin,
} from "@/components/ui/material-icon";
import { SessionActions } from "./session-actions";
import { AuthenticatedHeader } from "./authenticated-header";
import { Input } from "@/components/ui/input";
interface MobileShowHeaderProps {
  readonly href: string;
  readonly title: string;
  readonly subtitle?: string;
  readonly children?: React.ReactNode;
}
interface PublicLayoutProps {
  readonly children: React.ReactNode;
  readonly compact?: boolean;
  readonly context?: React.ReactNode;
  readonly signedIn?: boolean;
}
interface OrganizerLayoutProps {
  readonly children: React.ReactNode;
  readonly id?: string;
  readonly title: string;
  readonly mode: "manage" | "import" | "prices" | "map" | "events" | "account";
}

export function MobileShowHeader({
  href,
  title,
  subtitle,
  children,
}: MobileShowHeaderProps) {
  return (
    <header className="mobile-show-header">
      <Link href={href} aria-label="Quay lại">
        <ArrowLeft />
      </Link>
      <div>
        <strong>{title}</strong>
        {subtitle && <p>{subtitle}</p>}
      </div>
      {children}
    </header>
  );
}
export function PublicLayout({
  children,
  compact = false,
  context,
  signedIn = false,
}: PublicLayoutProps) {
  return (
    <div className={`product public-layout ${compact ? "public-compact" : ""}`}>
      {compact && (
        <header className="mobile-login-header">
          <Link href="/" aria-label="Về danh sách sự kiện">
            <ArrowLeft />
          </Link>
          <strong>Đăng nhập</strong>
          <span />
        </header>
      )}
      <header className="public-header">
        <div className="public-header-inner">
          <Link href="/" className="product-brand">
            <Ticket />
            Vé Sự Kiện
          </Link>
          {context ? (
            <div className="header-event-context">
              <Theater />
              {context}
            </div>
          ) : (
            <div className="header-search">
              <Search />
              <Input
                aria-label="Tìm sự kiện"
                placeholder="Tìm sự kiện, nghệ sĩ, địa điểm..."
                disabled
                title="Tìm kiếm chưa khả dụng"
              />
            </div>
          )}
          <nav className="public-links">
            <Link href="/" aria-current="page">
              Sự kiện
            </Link>
            <button disabled title="Chưa khả dụng">
              Nhà hát
            </button>
            <button disabled title="Chưa khả dụng">
              Vé của tôi
            </button>
          </nav>
          <button
            className="location-control"
            disabled
            title="Lọc địa điểm chưa khả dụng"
          >
            <MapPin /> <span>TP. Hồ Chí Minh</span>
            <ChevronDown />
          </button>
          <AuthenticatedHeader compact={compact} />
        </div>
      </header>
      <main className="public-main">{children}</main>
      <ProductFooter />
      <nav className="mobile-public-nav" aria-label="Điều hướng">
        <Link href="/">
          <Home filled />
          Sự kiện
        </Link>
        <button disabled title="Chọn một suất diễn để xem sơ đồ ghế">
          <Armchair />
          Sơ đồ vé
        </button>
        <button disabled title="Chưa khả dụng">
          <Ticket />
          Vé của tôi
        </button>
        <Link href="/events">
          <Admin />
          Quản trị
        </Link>
      </nav>
    </div>
  );
}
export function OrganizerLayout({
  children,
  id,
  title,
  mode,
}: OrganizerLayoutProps) {
  const links = [
    { href: "/events", name: "Sự kiện", Icon: Theater },
    ...(id
      ? [
          {
            href: `/showtimes/${id}/manage`,
            name: "Suất diễn",
            Icon: Schedule,
          },
          {
            href: `/scanner?showtimeId=${id}`,
            name: "Soát vé",
            Icon: Ticket,
          },
          { href: `/showtimes/${id}/import`, name: "Sơ đồ ghế", Icon: Map },
          { href: `/showtimes/${id}/prices`, name: "Giá vé", Icon: Sell },
        ]
      : []),
    { href: "/account", name: "Tài khoản", Icon: Person },
  ];
  return (
    <div className="product organizer-layout" data-mode={mode}>
      <aside className="organizer-sidebar">
        <Link className="product-brand" href="/events">
          <Ticket />
          Vé Sự Kiện · Quản trị
        </Link>
        <small>Vận hành sự kiện</small>
        <nav>
          {links.map(({ href, name, Icon }) => (
            <Link
              href={href}
              key={href}
              aria-current={
                (mode === "events" && href === "/events") ||
                (mode === "account" && href === "/account") ||
                href === `/showtimes/${id}/${mode}` ||
                (mode === "map" && href.endsWith("/import"))
                  ? "page"
                  : undefined
              }
            >
              <Icon />
              {name}
            </Link>
          ))}
        </nav>
        <Link href="/account" className="organizer-help">
          <LifeBuoy />
          Hỗ trợ tài khoản
        </Link>
      </aside>
      <header className="organizer-header">
        <div>
          {id && mode !== "manage" && (
            <Link
              className="organizer-mobile-back"
              href={`/showtimes/${id}/manage`}
              aria-label="Về quản lý suất diễn"
            >
              <ArrowLeft />
            </Link>
          )}
          <details
            className={`organizer-mobile-menu ${id && mode !== "manage" ? "organizer-menu-secondary" : ""}`}
          >
            <summary aria-label="Mở điều hướng quản trị">
              <Menu />
            </summary>
            <nav>
              {links.map(({ href, name, Icon }) => (
                <Link key={href} href={href}>
                  <Icon />
                  {name}
                </Link>
              ))}
              <SessionActions accountLink={false} />
            </nav>
          </details>
          <strong>{title}</strong>
        </div>
        <div className="organizer-header-actions">
          <Link href="/">Khám phá sự kiện</Link>
          <SessionActions />
        </div>
      </header>
      <main className="organizer-main">{children}</main>
      <ProductFooter />
    </div>
  );
}
function ProductFooter() {
  return (
    <footer className="product-footer">
      <div>
        <Link href="/" className="product-brand">
          <Ticket />
          Vé Sự Kiện
        </Link>
        <p>© 2026 Vé Sự Kiện</p>
      </div>
      <nav aria-label="Thông tin">
        <button disabled title="Nội dung chưa khả dụng">
          Điều khoản dịch vụ
        </button>
        <button disabled title="Nội dung chưa khả dụng">
          Chính sách hoàn vé
        </button>
        <button disabled title="Nội dung chưa khả dụng">
          Quy định sơ đồ ghế
        </button>
        <button disabled title="Chưa khả dụng">
          Hỗ trợ
        </button>
      </nav>
    </footer>
  );
}
