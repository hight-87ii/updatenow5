"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { Button } from "@/components/ui/button";
import { UserRound } from "@/components/ui/material-icon";
import { loadCurrentUser } from "@/lib/api";

interface SessionActionsProps {
  readonly accountLink?: boolean;
}

export function SessionActions({ accountLink = true }: SessionActionsProps) {
  const router = useRouter();
  const [pending, setPending] = useState(false);
  const [error, setError] = useState("");
  const [isAccountant, setIsAccountant] = useState(false);
  useEffect(() => {
    void loadCurrentUser().then((user) =>
      setIsAccountant(Boolean(user?.roles.includes("ACCOUNTANT"))),
    );
  }, []);
  async function logout() {
    if (pending) return;
    setPending(true);
    setError("");
    try {
      const response = await fetch("/api/auth/logout", { method: "POST" });
      if (!response.ok) throw new Error();
      router.replace("/login");
      router.refresh();
    } catch {
      setError("Không thể đăng xuất. Hãy thử lại.");
    } finally {
      setPending(false);
    }
  }
  return (
    <div className="session-actions">
      {accountLink && (
        <Link href="/account">
          <UserRound />
          Tài khoản
        </Link>
      )}
      {isAccountant && <Link href="/accounting/reconciliation">Đối soát</Link>}
      <Button variant="outline" onClick={logout} disabled={pending}>
        {pending ? "Đang đăng xuất…" : "Đăng xuất"}
      </Button>
      {error && <p role="alert">{error}</p>}
    </div>
  );
}
