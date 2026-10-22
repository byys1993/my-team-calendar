import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import type { Db } from "@/lib/db";
import { createMemoryDb } from "@/lib/db/pglite";
import { migrate } from "@/lib/db/migrate";
import { issueCode, unsubscribe, unsubscribeSig, verifyCode } from "@/lib/auth/core";

// 실제 /api/me 처리 코드를 그대로 불러, 쿠키(세션)만 바꿔 가며 계정 A·B 가 서로의 정보를 보거나 바꿀 수 없는지 확인한다.
let db: Db & { close(): Promise<void> };
let cookie: string | undefined;
vi.mock("@/lib/db", () => ({ getDb: () => db }));
vi.mock("next/headers", () => ({
  cookies: async () => ({ get: (name: string) => (name === "mtc_session" && cookie ? { value: cookie } : undefined) }),
}));
const me = await import("@/app/api/me/route");

const json = (method: string, body: unknown) =>
  new Request("http://localhost/api/me", { method, headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });

async function login(email: string) {
  const { code } = (await issueCode(db, email)) as { code: string };
  const r = await verifyCode(db, email, code);
  if (!r.ok) throw new Error("login failed");
  return { id: r.user.id, token: r.token };
}
async function getMe(token: string | undefined) {
  cookie = token;
  return (await (await me.GET()).json()).user;
}

let A: { id: string; token: string };
let B: { id: string; token: string };
beforeAll(async () => {
  db = await createMemoryDb();
  await migrate(db);
  A = await login("a@example.com");
  B = await login("b@example.com");
});
afterAll(() => db.close());

describe("계정 A/B 데이터 격리", () => {
  it("각자 자기 세션으로 자기 정보만 받는다 (내부 ID 는 내려보내지 않는다)", async () => {
    expect((await getMe(A.token)).email).toBe("a@example.com");
    expect((await getMe(B.token)).email).toBe("b@example.com");
    expect(await getMe(undefined)).toBeNull();
    expect(await getMe("forged-token")).toBeNull();
    expect(await getMe(A.token)).not.toHaveProperty("id");
  });

  it("A 가 저장한 팀·설정은 B 에게 영향이 없고, 본문에 남의 ID 를 넣어도 무시된다", async () => {
    cookie = A.token;
    const res = await me.PUT(
      json("PUT", { id: B.id, email: "b@example.com", selections: [{ slug: "arsenal", color: 3 }], notifyMode: "daily" }),
    );
    expect(res.status).toBe(200);
    expect(await getMe(A.token)).toMatchObject({ selections: [{ slug: "arsenal", color: 3, enabled: true }], notifyMode: "daily" });
    expect(await getMe(B.token)).toMatchObject({ email: "b@example.com", selections: [], notifyMode: "off" });
  });

  it("로그인하지 않으면 저장·삭제가 거부된다", async () => {
    cookie = undefined;
    expect((await me.PUT(json("PUT", { selections: [] }))).status).toBe(401);
    expect((await me.DELETE(json("DELETE", {}))).status).toBe(401);
  });

  it("다른 사이트에서 보낸 요청(CSRF)은 거부된다", async () => {
    cookie = A.token;
    const evil = new Request("http://localhost/api/me", {
      method: "PUT",
      headers: { "Content-Type": "application/json", Origin: "https://evil.example" },
      body: JSON.stringify({ selections: [] }),
    });
    expect((await me.PUT(evil)).status).toBe(400);
    expect((await getMe(A.token)).selections).toHaveLength(1);
  });

  it("A 의 수신 거부 서명으로 B 의 알림을 끌 수 없다", async () => {
    cookie = B.token;
    await me.PUT(json("PUT", { notifyMode: "weekly" }));
    expect(await unsubscribe(db, B.id, unsubscribeSig(A.id))).toBe(false);
    expect((await getMe(B.token)).notifyMode).toBe("weekly");
  });

  it("A 가 계정을 지우면 A 만 사라지고 B 는 그대로다", async () => {
    cookie = A.token;
    expect((await me.DELETE(json("DELETE", {}))).status).toBe(200);
    expect(await getMe(A.token)).toBeNull();
    expect((await getMe(B.token)).email).toBe("b@example.com");
  });
});
