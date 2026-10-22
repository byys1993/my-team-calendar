import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { Db } from "@/lib/db";
import { createMemoryDb } from "@/lib/db/pglite";
import { migrate } from "@/lib/db/migrate";

let db: Db & { close(): Promise<void> };
beforeAll(async () => {
  db = await createMemoryDb();
  await migrate(db);
});
afterAll(() => db.close());

describe("RLS", () => {
  it("public 스키마의 모든 테이블에 RLS 가 켜져 있다 (Supabase 공개 API 차단)", async () => {
    const rows = await db.query<{ table: string }>(
      `select c.relname as table from pg_class c join pg_namespace n on n.oid = c.relnamespace
       where n.nspname = 'public' and c.relkind = 'r' and not c.relrowsecurity order by 1`,
    );
    expect(rows.map((r) => r.table)).toEqual([]);
  });

  it("테이블 주인(서버)은 RLS 가 켜져 있어도 그대로 읽고 쓴다", async () => {
    await db.query("insert into sport (slug, name_ko) values ('rls-test', '테스트')");
    const [row] = await db.query<{ n: number }>("select count(*)::int as n from sport where slug = 'rls-test'");
    expect(row.n).toBe(1);
  });
});
