import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import type { Db } from "./types";

const MIGRATIONS_DIR = path.join(process.cwd(), "db", "migrations");

// db/migrations/*.sql 을 파일명 순서대로 한 번씩만 적용한다.
export async function migrate(db: Db, log: (msg: string) => void = () => {}): Promise<void> {
  await db.query(`create table if not exists schema_migrations (
    name text primary key, applied_at timestamptz not null default now())`);
  const applied = new Set(
    (await db.query<{ name: string }>("select name from schema_migrations")).map((r) => r.name),
  );
  const files = (await readdir(MIGRATIONS_DIR)).filter((f) => f.endsWith(".sql")).sort();
  for (const file of files) {
    if (applied.has(file)) continue;
    const sql = await readFile(path.join(MIGRATIONS_DIR, file), "utf8");
    await db.tx(async (t) => {
      for (const stmt of splitStatements(sql)) await t.query(stmt);
      await t.query("insert into schema_migrations (name) values ($1)", [file]);
    });
    log(`migration applied: ${file}`);
  }
}

// 확장 쿼리 프로토콜은 한 번에 문장 하나만 받으므로 ; 기준으로 나눈다.
// (마이그레이션에는 함수 본문 같은 ; 포함 문자열을 쓰지 않는다는 전제)
function splitStatements(sql: string): string[] {
  return sql
    .split("\n")
    .filter((line) => !line.trim().startsWith("--"))
    .join("\n")
    .split(";")
    .map((s) => s.trim())
    .filter(Boolean);
}
