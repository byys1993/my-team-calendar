"use client";

import { useEffect, useRef, useState } from "react";
import { useI18n } from "@/i18n/client";
import type { Account, AuthError } from "./useAccount";

interface Props {
  account: Account | null;
  requestCode(email: string, locale: string): Promise<AuthError | null>;
  verify(email: string, code: string): Promise<AuthError | Account>;
  logout(): Promise<void>;
  deleteAccount(): Promise<void>;
}

// 헤더의 로그인 버튼 → 이메일 입력 → 6자리 코드 입력. 로그인 후에는 계정 메뉴(로그아웃·계정 삭제)
export function AccountMenu(props: Props) {
  const { m } = useI18n();
  const [open, setOpen] = useState(false);
  // 로그인·로그아웃으로 상태가 바뀌면 창을 닫는다 (로그인 창이 계정 창으로 바뀌어 남지 않게)
  const signedIn = !!props.account;
  useEffect(() => setOpen(false), [signedIn]);
  return (
    <>
      <button type="button" className={props.account ? "ghost account-btn" : "ghost"} onClick={() => setOpen(true)}>
        {props.account ? props.account.email : m.auth.login}
      </button>
      {open &&
        (props.account ? (
          <AccountDialog {...props} account={props.account} onClose={() => setOpen(false)} />
        ) : (
          <LoginDialog {...props} onClose={() => setOpen(false)} />
        ))}
    </>
  );
}

function useModal(onClose: () => void) {
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    ref.current?.showModal();
  }, []);
  return { ref, onClose, close: () => ref.current?.close() };
}

function LoginDialog({ requestCode, verify, onClose }: Props & { onClose(): void }) {
  const { m, t, locale } = useI18n();
  const modal = useModal(onClose);
  const [step, setStep] = useState<"email" | "code">("email");
  const [email, setEmail] = useState("");
  const [code, setCode] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const message = (e: AuthError) =>
    ({
      invalid_email: m.auth.invalidEmail,
      invalid_code: m.auth.invalidCode,
      wait: m.auth.tooMany,
      too_many: m.auth.tooMany,
      send_failed: m.auth.failed,
      failed: m.auth.failed,
    })[e];

  async function send() {
    setBusy(true);
    setError(null);
    const err = await requestCode(email, locale);
    setBusy(false);
    if (err) setError(message(err));
    else setStep("code");
  }

  async function submitCode() {
    setBusy(true);
    setError(null);
    const r = await verify(email, code);
    setBusy(false);
    if (typeof r === "string") setError(message(r));
    else modal.close();
  }

  return (
    <dialog ref={modal.ref} className="picker auth-dialog" onClose={onClose} aria-labelledby="auth-title">
      <div className="picker-head">
        <h2 id="auth-title">{m.auth.title}</h2>
        <button type="button" className="icon-btn" onClick={modal.close} aria-label={m.picker.close}>
          ✕
        </button>
      </div>
      <div className="auth-body">
        {step === "email" ? (
          <form
            onSubmit={(e) => {
              e.preventDefault();
              void send();
            }}
          >
            <p className="muted">{m.auth.why}</p>
            <label>
              {m.auth.email}
              <input
                type="email"
                autoComplete="email"
                required
                autoFocus
                value={email}
                onChange={(e) => setEmail(e.target.value)}
              />
            </label>
            {error && <p className="error">{error}</p>}
            <button type="submit" className="primary" disabled={busy}>
              {m.auth.sendCode}
            </button>
          </form>
        ) : (
          <form
            onSubmit={(e) => {
              e.preventDefault();
              void submitCode();
            }}
          >
            <p>{t(m.auth.codeSent, { email })}</p>
            <label>
              {m.auth.code}
              <input
                className="code-input"
                inputMode="numeric"
                autoComplete="one-time-code"
                pattern="\d{6}"
                maxLength={6}
                required
                autoFocus
                value={code}
                onChange={(e) => setCode(e.target.value.replace(/\D/g, ""))}
              />
            </label>
            {error && <p className="error">{error}</p>}
            <button type="submit" className="primary" disabled={busy || code.length !== 6}>
              {m.auth.verify}
            </button>
            <div className="auth-links">
              <button type="button" className="link-btn" disabled={busy} onClick={() => void send()}>
                {m.auth.resend}
              </button>
              <button
                type="button"
                className="link-btn"
                onClick={() => {
                  setStep("email");
                  setCode("");
                  setError(null);
                }}
              >
                {m.auth.changeEmail}
              </button>
            </div>
          </form>
        )}
      </div>
    </dialog>
  );
}

function AccountDialog({ account, logout, deleteAccount, onClose }: Props & { account: Account; onClose(): void }) {
  const { m, t } = useI18n();
  const modal = useModal(onClose);
  return (
    <dialog ref={modal.ref} className="picker auth-dialog" onClose={onClose} aria-labelledby="account-title">
      <div className="picker-head">
        <h2 id="account-title">{m.auth.account}</h2>
        <button type="button" className="icon-btn" onClick={modal.close} aria-label={m.picker.close}>
          ✕
        </button>
      </div>
      <div className="auth-body">
        <p>{t(m.auth.signedInAs, { email: account.email })}</p>
        <p className="muted">{m.auth.synced}</p>
        <p>
          <a href="/privacy">{m.app.privacy}</a>
        </p>
        <button
          type="button"
          className="primary"
          onClick={async () => {
            await logout();
            modal.close();
          }}
        >
          {m.auth.logout}
        </button>
        <button
          type="button"
          className="danger"
          onClick={async () => {
            if (!confirm(m.auth.confirmDelete)) return;
            await deleteAccount();
            alert(m.auth.deleted);
            modal.close();
          }}
        >
          {m.auth.deleteAccount}
        </button>
      </div>
    </dialog>
  );
}
