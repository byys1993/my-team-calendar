"use client";

import { useEffect, useRef, useState } from "react";
import { useI18n } from "@/i18n/client";
import { Turnstile } from "./Turnstile";

const MAX = 2000;

// 하단 '문의·제안 보내기': 운영자 이메일 주소를 화면에 드러내지 않고 사이트 안에서 바로 보낸다.
export function ContactButton({ turnstileSiteKey }: { turnstileSiteKey: string | null }) {
  const { m } = useI18n();
  const [open, setOpen] = useState(false);
  return (
    <>
      <button type="button" className="ghost" onClick={() => setOpen(true)}>
        ✉️ {m.contact.button}
      </button>
      {open && <ContactDialog turnstileSiteKey={turnstileSiteKey} onClose={() => setOpen(false)} />}
    </>
  );
}

function ContactDialog({ turnstileSiteKey, onClose }: { turnstileSiteKey: string | null; onClose(): void }) {
  const { m, locale } = useI18n();
  const ref = useRef<HTMLDialogElement>(null);
  const [message, setMessage] = useState("");
  const [email, setEmail] = useState("");
  const [website, setWebsite] = useState(""); // 사람에게는 보이지 않는 칸 (자동 입력 프로그램 걸러내기)
  const [captcha, setCaptcha] = useState<string | null>(null);
  const [captchaReset, setCaptchaReset] = useState(0);
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    ref.current?.showModal();
  }, []);

  const errorText = (code: string) =>
    ({
      invalid_message: m.contact.tooShort,
      invalid_email: m.auth.invalidEmail,
      captcha: m.auth.captcha,
      too_many: m.auth.tooMany,
    })[code] ?? m.auth.failed;

  async function submit() {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch("/api/contact", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ message, email, website, turnstile: captcha, locale }),
      });
      const data = (await res.json().catch(() => ({}))) as { error?: string };
      if (res.ok) setDone(true);
      else setError(errorText(data.error ?? "failed"));
    } catch {
      setError(m.auth.failed);
    } finally {
      setBusy(false);
      // 사람 확인 토큰은 한 번만 쓸 수 있다
      if (turnstileSiteKey) setCaptchaReset((n) => n + 1);
    }
  }

  return (
    <dialog ref={ref} className="picker auth-dialog" onClose={onClose} aria-labelledby="contact-title">
      <div className="picker-head">
        <h2 id="contact-title">{m.contact.title}</h2>
        <button type="button" className="icon-btn" onClick={() => ref.current?.close()} aria-label={m.picker.close}>
          ✕
        </button>
      </div>
      <div className="auth-body">
        {done ? (
          <>
            <p>{m.contact.sent}</p>
            <button type="button" className="primary" onClick={() => ref.current?.close()}>
              {m.picker.close}
            </button>
          </>
        ) : (
          <form
            onSubmit={(e) => {
              e.preventDefault();
              void submit();
            }}
          >
            <p className="muted">{m.contact.intro}</p>
            <label>
              {m.contact.message}
              <textarea
                required
                autoFocus
                rows={6}
                maxLength={MAX}
                value={message}
                onChange={(e) => setMessage(e.target.value)}
              />
              <span className="muted small">
                {message.length}/{MAX}
              </span>
            </label>
            <label>
              {m.contact.email}
              <input type="email" autoComplete="email" value={email} onChange={(e) => setEmail(e.target.value)} />
            </label>
            <input
              className="hp"
              tabIndex={-1}
              autoComplete="off"
              aria-hidden="true"
              name="website"
              value={website}
              onChange={(e) => setWebsite(e.target.value)}
            />
            {error && <p className="error">{error}</p>}
            {turnstileSiteKey && <Turnstile siteKey={turnstileSiteKey} onToken={setCaptcha} resetSignal={captchaReset} />}
            <button
              type="submit"
              className="primary"
              disabled={busy || message.trim().length < 5 || (!!turnstileSiteKey && !captcha)}
            >
              {m.contact.send}
            </button>
            <p className="muted small">{m.contact.privacy}</p>
          </form>
        )}
      </div>
    </dialog>
  );
}
