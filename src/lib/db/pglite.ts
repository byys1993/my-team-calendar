import { PGlite, type Transaction } from "@electric-sql/pglite";
import type { Db } from "./types";

// 테스트용 메모리 DB. 운영과 같은 Postgres 문법을 그대로 쓴다.
function wrap(pg: PGlite | Transaction): Db {
  return {
    async query<T>(text: string, params: unknown[] = []) {
      const res = await pg.query<T>(text, params);
      return res.rows;
    },
    async tx<R>(fn: (db: Db) => Promise<R>) {
      if (!("transaction" in pg)) return fn(wrap(pg));
      return pg.transaction((t) => fn(wrap(t)));
    },
  };
}

export async function createMemoryDb(): Promise<Db & { close(): Promise<void> }> {
  const pg = await PGlite.create();
  return Object.assign(wrap(pg), { close: () => pg.close() });
}
