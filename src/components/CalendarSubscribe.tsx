"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { track } from "./track";
import { useI18n } from "@/i18n/client";

// '캘린더에 추가': 켜 둔 팀들의 구독 주소(ICS)를 Apple 캘린더·구글 캘린더·기타 앱에 넣는 방법을 안내한다.
// 캘린더에 들어가면 Mac·iPhone 의 기본 캘린더 위젯에도 다음 경기가 보인다.
// 구독 주소에 팀 목록이 들어 있어 팀·설정을 바꾸면 주소가 바뀐다 → 마지막으로 추가한 주소를 이 브라우저에 기억해 두고
// 아직 추가하지 않았으면 버튼을 강조하고 안내 칸을, 추가한 뒤 주소가 바뀌었으면 '다시 추가' 안내 칸을 보여 준다.

const STORAGE_KEY = "mtc.sub.v1";

// path: 마지막으로 추가한 구독 주소(경로+쿼리), dismissed: 닫은 안내 ('first' 또는 그때의 주소)
interface Saved {
  path: string | null;
  dismissed: string | null;
}

function readSaved(): Saved {
  try {
    const v = JSON.parse(localStorage.getItem(STORAGE_KEY) ?? "null") as Partial<Saved> | null;
    return { path: typeof v?.path === "string" ? v.path : null, dismissed: typeof v?.dismissed === "string" ? v.dismissed : null };
  } catch {
    return { path: null, dismissed: null };
  }
}

export type Subscription = ReturnType<typeof useSubscription>;

export function useSubscription(slugs: string[], f1MainOnly: boolean) {
  const { locale } = useI18n();
  const [saved, setSaved] = useState<Saved | null>(null);
  const [open, setOpen] = useState(false);
  useEffect(() => setSaved(readSaved()), []);

  const path = slugs.length ? `/ics/${slugs.join(",")}.ics?lang=${locale}${f1MainOnly ? "&f1=main" : ""}` : null;
  const store = useCallback((next: Saved) => {
    setSaved(next);
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
    } catch {
      // 저장소를 못 쓰면 이번 화면에서만
    }
  }, []);

  // 브라우저 저장값을 읽기 전에는 아무 안내도 하지 않는다
  const notice: "first" | "changed" | null =
    !saved || !path ? null : !saved.path ? (saved.dismissed === "first" ? null : "first") : saved.path !== path && saved.dismissed !== path ? "changed" : null;

  return {
    path,
    open,
    setOpen,
    notice,
    subscribed: !!saved?.path,
    markSubscribed: () => path && store({ path, dismissed: null }),
    dismiss: () => saved && path && store({ ...saved, dismissed: saved.path ? path : "first" }),
  };
}

export function CalendarSubscribe({ sub }: { sub: Subscription }) {
  const { m } = useI18n();
  if (!sub.path) return null;
  return (
    <>
      <button
        type="button"
        // 아직 추가하지 않았으면 눈에 띄게
        className={`${sub.subscribed ? "ghost" : "primary"} cal-sub-btn`}
        onClick={() => {
          sub.setOpen(true);
          track("sub_open");
        }}
      >
        📅 {m.ics.button}
      </button>
      {sub.open && <SubscribeDialog sub={sub} path={sub.path} onClose={() => sub.setOpen(false)} />}
    </>
  );
}

// 일정 화면 위 안내 칸: 처음(아직 추가하지 않음) / 추가한 뒤 팀·설정이 바뀜
export function SubscribeNotice({ sub }: { sub: Subscription }) {
  const { m } = useI18n();
  if (!sub.notice) return null;
  return (
    <div className="notice-box sub-notice" role="status">
      <p>{sub.notice === "first" ? m.ics.hintBody : m.ics.changedBody}</p>
      <div className="sub-notice-actions">
        <button
          type="button"
          className="primary"
          onClick={() => {
            sub.setOpen(true);
            track("sub_open");
            // 안내 칸을 보고 연 사람 (상단 버튼과 구분)
            track("sub_notice");
          }}
        >
          📅 {sub.notice === "first" ? m.ics.button : m.ics.changedAction}
        </button>
        <button type="button" className="ghost" onClick={sub.dismiss}>
          {m.picker.close}
        </button>
      </div>
    </div>
  );
}

// 접속한 기기: 아이폰·아이패드·Mac 은 Apple 캘린더, 나머지는 Google 캘린더를 먼저
function deviceKind(): "apple" | "android" | "other" {
  const ua = navigator.userAgent;
  if (/iPhone|iPad|iPod|Macintosh/.test(ua)) return "apple";
  if (/Android/.test(ua)) return "android";
  return "other";
}

function SubscribeDialog({ sub, path, onClose }: { sub: Subscription; path: string; onClose(): void }) {
  const { m } = useI18n();
  const ref = useRef<HTMLDialogElement>(null);
  const [copied, setCopied] = useState(false);
  const [device] = useState(deviceKind);
  useEffect(() => {
    ref.current?.showModal();
  }, []);

  const https = `${window.location.origin}${path}`;
  const webcal = https.replace(/^https?:/, "webcal:");
  const google = `https://calendar.google.com/calendar/render?cid=${encodeURIComponent(webcal)}`;

  async function copy() {
    try {
      await navigator.clipboard.writeText(https);
      setCopied(true);
      sub.markSubscribed();
      track("sub_copy");
    } catch {
      setCopied(false);
    }
  }

  const appleLink = (primary: boolean) => (
    <>
      <a
        className={`${primary ? "primary" : "ghost"} ics-link`}
        href={webcal}
        onClick={() => {
          sub.markSubscribed();
          track("sub_apple");
        }}
      >
        {m.ics.apple}
      </a>
      <p className="muted small">{m.ics.appleHint}</p>
    </>
  );
  const googleLink = (primary: boolean) => (
    <>
      <a
        className={`${primary ? "primary" : "ghost"} ics-link`}
        href={google}
        target="_blank"
        rel="noopener noreferrer"
        onClick={() => {
          sub.markSubscribed();
          track("sub_google");
        }}
      >
        {m.ics.google}
      </a>
      <p className="muted small">{device === "android" ? m.ics.androidHint : m.ics.googleHint}</p>
    </>
  );

  return (
    <dialog ref={ref} className="picker auth-dialog" onClose={onClose} aria-labelledby="ics-title">
      <div className="picker-head">
        <h2 id="ics-title">{m.ics.title}</h2>
        <button type="button" className="icon-btn" onClick={() => ref.current?.close()} aria-label={m.picker.close}>
          ✕
        </button>
      </div>
      <div className="auth-body ics-body">
        <p className="muted">{m.ics.intro}</p>

        {/* 이 기기에 맞는 방법을 먼저, 다른 하나는 '다른 기기' 아래에 */}
        {device === "apple" ? appleLink(true) : googleLink(true)}

        <label>
          {m.ics.url}
          <div className="ics-url">
            <input readOnly value={https} onFocus={(e) => e.currentTarget.select()} />
            <button type="button" className="ghost" onClick={() => void copy()}>
              {copied ? m.ics.copied : m.ics.copy}
            </button>
          </div>
        </label>
        <p className="muted small">{m.ics.otherHint}</p>

        <details className="ics-widget">
          <summary>{m.ics.otherDevices}</summary>
          {device === "apple" ? googleLink(false) : appleLink(false)}
        </details>

        <details className="ics-widget">
          <summary>{m.ics.widgetTitle}</summary>
          <p className="small">{m.ics.widgetMac}</p>
          <p className="small">{m.ics.widgetIphone}</p>
        </details>

        <p className="muted small">{m.ics.note}</p>
      </div>
    </dialog>
  );
}
