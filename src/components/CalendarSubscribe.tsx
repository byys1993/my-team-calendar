"use client";

import { useEffect, useRef, useState } from "react";
import { track } from "./track";
import { useI18n } from "@/i18n/client";

// '캘린더에 추가': 켜 둔 팀들의 구독 주소(ICS)를 Apple 캘린더·구글 캘린더·기타 앱에 넣는 방법을 안내한다.
// 캘린더에 들어가면 Mac·iPhone 의 기본 캘린더 위젯에도 다음 경기가 보인다.
export function CalendarSubscribe({ slugs, f1MainOnly }: { slugs: string[]; f1MainOnly: boolean }) {
  const { m } = useI18n();
  const [open, setOpen] = useState(false);
  if (slugs.length === 0) return null;
  return (
    <>
      <button
        type="button"
        className="ghost cal-sub-btn"
        onClick={() => {
          setOpen(true);
          track("sub_open");
        }}
      >
        📅 {m.ics.button}
      </button>
      {open && <SubscribeDialog slugs={slugs} f1MainOnly={f1MainOnly} onClose={() => setOpen(false)} />}
    </>
  );
}

function SubscribeDialog({ slugs, f1MainOnly, onClose }: { slugs: string[]; f1MainOnly: boolean; onClose(): void }) {
  const { m, locale } = useI18n();
  const ref = useRef<HTMLDialogElement>(null);
  const [copied, setCopied] = useState(false);
  useEffect(() => {
    ref.current?.showModal();
  }, []);

  // F1 주요 세션만이면 f1=main (설정을 바꾸면 주소가 바뀌므로 다시 추가해야 한다)
  const https = `${window.location.origin}/ics/${slugs.join(",")}.ics?lang=${locale}${f1MainOnly ? "&f1=main" : ""}`;
  const webcal = https.replace(/^https?:/, "webcal:");
  const google = `https://calendar.google.com/calendar/render?cid=${encodeURIComponent(webcal)}`;

  async function copy() {
    try {
      await navigator.clipboard.writeText(https);
      setCopied(true);
      track("sub_copy");
    } catch {
      setCopied(false);
    }
  }

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

        <a className="primary ics-link" href={webcal} onClick={() => track("sub_apple")}>
          {m.ics.apple}
        </a>
        <p className="muted small">{m.ics.appleHint}</p>

        <a className="ghost ics-link" href={google} target="_blank" rel="noopener noreferrer" onClick={() => track("sub_google")}>
          {m.ics.google}
        </a>
        <p className="muted small">{m.ics.googleHint}</p>

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
          <summary>{m.ics.widgetTitle}</summary>
          <p className="small">{m.ics.widgetMac}</p>
          <p className="small">{m.ics.widgetIphone}</p>
        </details>

        <p className="muted small">{m.ics.note}</p>
      </div>
    </dialog>
  );
}
