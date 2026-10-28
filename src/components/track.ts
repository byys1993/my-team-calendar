// 핵심 행동 기록 (익명 방문자 ID 기준, 실패해도 화면에는 영향 없음)
const ID_KEY = "mtc.vid.v1";
// 운영자가 관리자 화면에서 "이 브라우저는 집계에서 빼기"를 누르면 생긴다
export const NO_TRACK_KEY = "mtc.notrack.v1";

export function trackingOff(): boolean {
  try {
    return localStorage.getItem(NO_TRACK_KEY) === "1";
  } catch {
    return false;
  }
}

export function visitorId(): string {
  try {
    const saved = localStorage.getItem(ID_KEY);
    if (saved) return saved;
    const id = crypto.randomUUID();
    localStorage.setItem(ID_KEY, id);
    return id;
  } catch {
    return crypto.randomUUID();
  }
}

export function track(name: string): void {
  if (trackingOff()) return;
  try {
    void fetch("/api/event", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id: visitorId(), name }),
      keepalive: true,
    }).catch(() => {});
  } catch {
    // 무시
  }
}
