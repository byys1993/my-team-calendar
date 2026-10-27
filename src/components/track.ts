// 핵심 행동 기록 (익명 방문자 ID 기준, 실패해도 화면에는 영향 없음)
const ID_KEY = "mtc.vid.v1";

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
