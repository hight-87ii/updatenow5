"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { loadCurrentUser } from "@/lib/api";
import { SessionActions } from "./session-actions";

export function AuthenticatedHeader({ compact = false }: { compact?: boolean }) {
  const [checked, setChecked] = useState(false);
  const [signedIn, setSignedIn] = useState(false);
  useEffect(() => {
    void loadCurrentUser().then((user) => {
      setSignedIn(Boolean(user));
      setChecked(true);
    });
  }, []);
  if (!checked || !signedIn)
    return (
      <Link className="header-login-link" href="/login" aria-current={compact ? "page" : undefined}>
        Đăng nhập
      </Link>
    );
  return <SessionActions />;
}
