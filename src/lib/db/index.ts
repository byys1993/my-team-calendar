import { createPostgresDb } from "./postgres";
import type { Db } from "./types";

export type { Db } from "./types";

// 사이트에서 쓰는 DB 연결. 개발 서버의 핫 리로드와 서버리스 인스턴스마다 연결이 늘지 않도록
// 전역에 하나만 두고, 연결 수는 1개로 제한한다 (Supabase 풀러·로컬 PGlite 모두 연결 수가 적다).
const g = globalThis as unknown as { __mtcDb?: Db };

export function getDb(): Db {
  if (g.__mtcDb) return g.__mtcDb;
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error("DATABASE_URL 환경변수가 없습니다.");
  // 풀러가 연결을 몰래 끊어 응답이 멈추면 15초 뒤 새 연결로 바꾼다 (postgres.ts 의 queryTimeoutMs)
  g.__mtcDb = createPostgresDb(url, { max: 1, queryTimeoutMs: 15_000 });
  return g.__mtcDb;
}
