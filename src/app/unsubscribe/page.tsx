import type { Metadata } from "next";
import Link from "next/link";
import { MESSAGES } from "@/i18n";
import { getLocale } from "@/i18n/server";

export async function generateMetadata(): Promise<Metadata> {
  const m = MESSAGES[await getLocale()];
  return { title: `${m.notify.unsubTitle} · ${m.meta.title}`, robots: { index: false } };
}

// 알림 메일의 '그만 받기' 링크. 메일 보안 검사기가 링크를 미리 열어도 꺼지지 않게, 버튼을 눌러야 끈다.
export default async function UnsubscribePage({
  searchParams,
}: {
  searchParams: Promise<{ u?: string; s?: string; done?: string; invalid?: string }>;
}) {
  const { notify, privacyPage } = MESSAGES[await getLocale()];
  const q = await searchParams;
  const action = `/api/unsubscribe?u=${encodeURIComponent(q.u ?? "")}&s=${encodeURIComponent(q.s ?? "")}`;
  return (
    <main className="app privacy">
      <h1>{notify.unsubTitle}</h1>
      {q.done ? (
        <p>{notify.unsubDone}</p>
      ) : q.invalid || !q.u || !q.s ? (
        <p className="error">{notify.unsubInvalid}</p>
      ) : (
        <form method="post" action={action}>
          <p>{notify.unsubConfirm}</p>
          <input type="hidden" name="confirm" value="1" />
          <button type="submit" className="primary">
            {notify.unsubButton}
          </button>
        </form>
      )}
      <p>
        <Link href="/">{privacyPage.back}</Link>
      </p>
    </main>
  );
}
