"use client";

import { useCallback, useEffect, useState } from "react";
import type { Selection } from "./selection";

export interface Account {
  email: string;
  locale: string | null;
  selections: Selection[];
}

export type AuthError = "invalid_email" | "wait" | "too_many" | "invalid_code" | "send_failed" | "failed";

async function call<T>(method: string, url: string, body?: unknown): Promise<T> {
  const res = await fetch(url, {
    method,
    headers: body === undefined ? undefined : { "Content-Type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error((data as { error?: string }).error ?? "failed");
  return data as T;
}

const asAuthError = (e: unknown): AuthError => {
  const msg = e instanceof Error ? e.message : "failed";
  return (["invalid_email", "wait", "too_many", "invalid_code", "send_failed"].includes(msg) ? msg : "failed") as AuthError;
};

// 로그인 상태와 계정 API. 로그인하지 않아도 사이트는 그대로 쓸 수 있다.
export function useAccount() {
  const [account, setAccount] = useState<Account | null>(null);
  const [checked, setChecked] = useState(false);

  useEffect(() => {
    call<{ user: Account | null }>("GET", "/api/me")
      .then((d) => setAccount(d.user))
      .catch(() => setAccount(null))
      .finally(() => setChecked(true));
  }, []);

  const requestCode = useCallback(async (email: string, locale: string): Promise<AuthError | null> => {
    try {
      await call("POST", "/api/auth/request", { email, locale });
      return null;
    } catch (e) {
      return asAuthError(e);
    }
  }, []);

  const verify = useCallback(async (email: string, code: string): Promise<AuthError | Account> => {
    try {
      const d = await call<{ user: Account }>("POST", "/api/auth/verify", { email, code });
      setAccount(d.user);
      return d.user;
    } catch (e) {
      return asAuthError(e);
    }
  }, []);

  const logout = useCallback(async () => {
    await call("POST", "/api/auth/logout", {}).catch(() => {});
    setAccount(null);
  }, []);

  const deleteAccount = useCallback(async () => {
    await call("DELETE", "/api/me", {});
    setAccount(null);
  }, []);

  const save = useCallback(async (patch: { selections?: Selection[]; locale?: string }) => {
    await call("PUT", "/api/me", patch).catch(() => {});
  }, []);

  return { account, checked, requestCode, verify, logout, deleteAccount, save };
}
