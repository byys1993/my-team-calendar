"use client";

import { useEffect, useRef, useState } from "react";
import { track } from "./track";
import { useI18n } from "@/i18n/client";
import { Turnstile } from "./Turnstile";
import type { Account, AuthError, NotifyMode } from "./useAccount";

interface Props {
  account: Account | null;
  requestCode(email: string, locale: string, turnstile?: string | null): Promise<AuthError | null>;
  verify(email: string, code: string): Promise<AuthError | Account>;
  logout(): Promise<void>;
  deleteAccount(): Promise<void>;
  saveNotify(patch: { notifyMode?: NotifyMode; notifyHour?: number }): Promise<boolean>;
  timeZone: string;
  turnstileSiteKey: string | null; // 있으면 코드 요청 전에 사람 확인
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

function LoginDialog({ requestCode, verify, turnstileSiteKey, onClose }: Props & { onClose(): void }) {
  const { m, t, locale } = useI18n();
  const modal = useModal(onClose);
  const [step, setStep] = useState<"email" | "code">("email");
  const [email, setEmail] = useState("");
  const [code, setCode] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [captcha, setCaptcha] = useState<string | null>(null);
  const [captchaReset, setCaptchaReset] = useState(0);
  const needCaptcha = !!turnstileSiteKey && !captcha;

  const message = (e: AuthError) =>
    ({
      invalid_email: m.auth.invalidEmail,
      invalid_code: m.auth.invalidCode,
      wait: m.auth.tooMany,
      too_many: m.auth.tooMany,
      send_failed: m.auth.failed,
      captcha: m.auth.captcha,
      failed: m.auth.failed,
    })[e];

  async function send() {
    setBusy(true);
    setError(null);
    const err = await requestCode(email, locale, captcha);
    setBusy(false);
    // 사람 확인 토큰은 한 번만 쓸 수 있다
    if (turnstileSiteKey) setCaptchaReset((n) => n + 1);
    if (err) setError(message(err));
    else setStep("code");
  }

  async function submitCode() {
    setBusy(true);
    setError(null);
    const r = await verify(email, code);
    setBusy(false);
    if (typeof r === "string") setError(message(r));
    else {
      track("login");
      modal.close();
    }
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
            <button type="submit" className="primary" disabled={busy || needCaptcha}>
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
              <button type="button" className="link-btn" disabled={busy || needCaptcha} onClick={() => void send()}>
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
        {turnstileSiteKey && (
          <Turnstile siteKey={turnstileSiteKey} onToken={setCaptcha} resetSignal={captchaReset} />
        )}
      </div>
    </dialog>
  );
}

// 경기 알림 메일: 받는 방식(끄기·경기 있는 날·매주 월요일)과 보낼 시각
function NotifySettings({ account, saveNotify, timeZone }: Props & { account: Account }) {
  const { m, t, intl } = useI18n();
  const [status, setStatus] = useState<"saved" | "failed" | null>(null);
  const hourLabel = (h: number) =>
    new Intl.DateTimeFormat(intl, { hour: "numeric", timeZone: "UTC" }).format(new Date(Date.UTC(2026, 0, 1, h)));
  async function change(patch: { notifyMode?: NotifyMode; notifyHour?: number }) {
    if (patch.notifyMode && patch.notifyMode !== "off") track("notify_on");
    setStatus(null);
    setStatus((await saveNotify(patch)) ? "saved" : "failed");
  }
  return (
    <fieldset className="notify-box">
      <legend>{m.notify.title}</legend>
      {/* 기본은 꺼짐. 직접 체크해야 받는다 (켜면 '경기 있는 날 아침'부터) */}
      <label className="notify-check">
        <input
          type="checkbox"
          checked={account.notifyMode !== "off"}
          onChange={(e) => void change({ notifyMode: e.target.checked ? "daily" : "off" })}
        />
        {m.notify.enable}
      </label>
      {account.notifyMode !== "off" && (
        <label>
          {m.notify.mode}
          <select value={account.notifyMode} onChange={(e) => void change({ notifyMode: e.target.value as NotifyMode })}>
            <option value="daily">{m.notify.daily}</option>
            <option value="weekly">{m.notify.weekly}</option>
          </select>
        </label>
      )}
      {account.notifyMode !== "off" && (
        <label>
          {m.notify.hour}
          <select value={account.notifyHour} onChange={(e) => void change({ notifyHour: Number(e.target.value) })}>
            {Array.from({ length: 24 }, (_, h) => (
              <option key={h} value={h}>
                {hourLabel(h)}
              </option>
            ))}
          </select>
        </label>
      )}
      {account.notifyMode !== "off" && <p className="muted">{t(m.notify.hint, { tz: timeZone.replace(/_/g, " ") })}</p>}
      {status === "saved" && <p className="muted">{m.notify.saved}</p>}
      {status === "failed" && <p className="error">{m.auth.failed}</p>}
    </fieldset>
  );
}

function AccountDialog(props: Props & { account: Account; onClose(): void }) {
  const { account, logout, deleteAccount, onClose } = props;
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
        <NotifySettings {...props} />
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
