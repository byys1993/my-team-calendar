import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  cleanSelections,
  deleteUser,
  endSession,
  hitRateLimit,
  issueCode,
  normalizeEmail,
  updateUser,
  userFromToken,
  verifyCode,
} from "@/lib/auth/core";
import type { Db } from "@/lib/db";
import { createMemoryDb } from "@/lib/db/pglite";
import { migrate } from "@/lib/db/migrate";

let db: Db & { close(): Promise<void> };
beforeEach(async () => {
  db = await createMemoryDb();
  await migrate(db);
});
afterEach(() => db.close());

const at = (min: number) => new Date(Date.UTC(2026, 9, 22, 12, 0) + min * 60_000);

describe("이메일 코드 로그인", () => {
  it("이메일 정규화", () => {
    expect(normalizeEmail("  Fan@Example.COM ")).toBe("fan@example.com");
    expect(normalizeEmail("not-an-email")).toBeNull();
    expect(normalizeEmail(42)).toBeNull();
  });

  it("코드를 맞히면 계정과 세션이 생기고, 같은 코드는 다시 쓸 수 없다", async () => {
    const issued = await issueCode(db, "fan@example.com", at(0));
    expect(issued.ok).toBe(true);
    const code = (issued as { code: string }).code;
    expect(code).toMatch(/^\d{6}$/);

    const r = await verifyCode(db, "fan@example.com", code, at(1));
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.user.email).toBe("fan@example.com");
    expect((await userFromToken(db, r.token, at(2)))?.email).toBe("fan@example.com");
    expect(await userFromToken(db, "wrong-token", at(2))).toBeNull();

    // 재사용 불가
    expect(await verifyCode(db, "fan@example.com", code, at(2))).toMatchObject({ ok: false, reason: "invalid" });
    // 로그아웃하면 세션이 사라진다
    await endSession(db, r.token);
    expect(await userFromToken(db, r.token, at(3))).toBeNull();
  });

  it("코드는 10분 뒤 만료되고, 5번 틀리면 막힌다", async () => {
    const { code } = (await issueCode(db, "a@b.co", at(0))) as { code: string };
    expect(await verifyCode(db, "a@b.co", code, at(11))).toMatchObject({ ok: false, reason: "invalid" });

    const again = (await issueCode(db, "a@b.co", at(12))) as { code: string };
    const wrong = again.code === "000000" ? "111111" : "000000";
    for (let i = 0; i < 4; i++) expect((await verifyCode(db, "a@b.co", wrong, at(13))).ok).toBe(false);
    expect(await verifyCode(db, "a@b.co", wrong, at(13))).toMatchObject({ reason: "limit" });
    // 막힌 뒤에는 맞는 코드도 안 된다
    expect(await verifyCode(db, "a@b.co", again.code, at(13))).toMatchObject({ ok: false, reason: "limit" });
  });

  it("재발송은 60초 간격, 시간당 5번까지", async () => {
    expect((await issueCode(db, "c@d.co", at(0))).ok).toBe(true);
    expect(await issueCode(db, "c@d.co", at(0.5))).toMatchObject({ ok: false, reason: "wait" });
    for (let i = 1; i <= 4; i++) expect((await issueCode(db, "c@d.co", at(i * 2))).ok).toBe(true);
    expect(await issueCode(db, "c@d.co", at(12))).toMatchObject({ ok: false, reason: "limit" });
    // 한 시간이 지나면 다시 된다
    expect((await issueCode(db, "c@d.co", at(61))).ok).toBe(true);
  });

  it("내 팀 저장과 계정 삭제", async () => {
    const { code } = (await issueCode(db, "e@f.co", at(0))) as { code: string };
    const r = await verifyCode(db, "e@f.co", code, at(1));
    if (!r.ok) throw new Error("login failed");
    const selections = cleanSelections([
      { slug: "arsenal", color: 0, enabled: true },
      { slug: "kbo-kia", color: 3, enabled: false },
    ])!;
    await updateUser(db, r.user.id, { selections, locale: "ja" });
    const me = await userFromToken(db, r.token, at(2));
    expect(me).toMatchObject({ locale: "ja", selections });

    await deleteUser(db, me!);
    expect(await userFromToken(db, r.token, at(3))).toBeNull();
    const [{ n }] = await db.query<{ n: number }>("select count(*)::int as n from login_code");
    expect(n).toBe(0);
  });

  it("선택 목록 검증", () => {
    expect(cleanSelections([{ slug: "bad slug!", color: 0 }])).toBeNull();
    expect(cleanSelections([{ slug: "arsenal", color: 12 }])).toBeNull();
    expect(cleanSelections(Array.from({ length: 11 }, (_, i) => ({ slug: `t${i}`, color: 0 })))).toBeNull();
    expect(cleanSelections([{ slug: "arsenal", color: 1 }, { slug: "arsenal", color: 2 }])).toEqual([
      { slug: "arsenal", color: 1, enabled: true },
    ]);
  });

  it("IP 당 요청 제한", async () => {
    for (let i = 0; i < 10; i++) expect(await hitRateLimit(db, "code-ip:1.2.3.4", 10, 3600, at(i))).toBe(true);
    expect(await hitRateLimit(db, "code-ip:1.2.3.4", 10, 3600, at(11))).toBe(false);
    expect(await hitRateLimit(db, "code-ip:5.6.7.8", 10, 3600, at(11))).toBe(true);
    expect(await hitRateLimit(db, "code-ip:1.2.3.4", 10, 3600, at(70))).toBe(true);
  });
});
