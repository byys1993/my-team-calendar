import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import type { Db } from "@/lib/db";
import { createMemoryDb } from "@/lib/db/pglite";
import { migrate } from "@/lib/db/migrate";

// 실제 /api/contact 처리 코드를 불러 검증한다 (메일은 개발 모드라 콘솔에만 찍힌다)
let db: Db & { close(): Promise<void> };
vi.mock("@/lib/db", () => ({ getDb: () => db }));
process.env.CONTACT_EMAIL = "owner@example.com";
const route = await import("@/app/api/contact/route");

let ip = 0;
const post = (body: unknown, headers: Record<string, string> = {}) =>
  route.POST(
    new Request("http://localhost/api/contact", {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-forwarded-for": `10.0.0.${ip}`, ...headers },
      body: JSON.stringify(body),
    }),
  );

beforeAll(async () => {
  db = await createMemoryDb();
  await migrate(db);
});
afterAll(() => db.close());
beforeEach(() => {
  ip++;
});

describe("문의 양식", () => {
  it("내용과 (선택) 답장 주소로 운영자에게 보낸다", async () => {
    const log = vi.spyOn(console, "log").mockImplementation(() => {});
    const res = await post({ message: "K리그 3 도 추가해 주세요", email: "Fan@Example.com", locale: "ko" });
    expect(res.status).toBe(200);
    const printed = String(log.mock.calls.at(-1)?.[0]);
    expect(printed).toContain("owner@example.com");
    expect(printed).toContain("K리그 3 도 추가해 주세요");
    expect(printed).toContain("답장 주소: fan@example.com");
    log.mockRestore();
  });

  it("너무 짧거나 긴 내용, 잘못된 이메일은 거부한다", async () => {
    expect((await post({ message: "hi" })).status).toBe(400);
    expect((await post({ message: "x".repeat(2001) })).status).toBe(400);
    expect(await (await post({ message: "괜찮은 내용입니다", email: "not-an-email" })).json()).toEqual({ error: "invalid_email" });
  });

  it("숨은 칸을 채운 자동 입력 프로그램은 보낸 척만 한다", async () => {
    const log = vi.spyOn(console, "log").mockImplementation(() => {});
    const res = await post({ message: "Great site! Buy reviews", website: "http://spam.example" });
    expect(res.status).toBe(200);
    expect(log).not.toHaveBeenCalled();
    log.mockRestore();
  });

  it("같은 IP 는 시간당 5번까지, 다른 사이트에서 보낸 요청은 거부", async () => {
    const log = vi.spyOn(console, "log").mockImplementation(() => {});
    for (let i = 0; i < 5; i++) expect((await post({ message: `의견 ${i} 입니다` })).status).toBe(200);
    expect((await post({ message: "의견 6 입니다" })).status).toBe(429);
    ip++;
    expect((await post({ message: "다른 사이트에서 옴" }, { Origin: "https://evil.example" })).status).toBe(400);
    log.mockRestore();
  });
});
