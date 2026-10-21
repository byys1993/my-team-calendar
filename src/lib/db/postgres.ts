import postgres from "postgres";
import type { Db } from "./types";

type Sql = postgres.Sql | postgres.TransactionSql;

function wrap(sql: Sql): Db {
  return {
    async query<T>(text: string, params: unknown[] = []) {
      const rows = await sql.unsafe(text, params as postgres.ParameterOrJSON<never>[]);
      return rows as unknown as T[];
    },
    async tx<R>(fn: (db: Db) => Promise<R>) {
      if (!("begin" in sql)) return fn(wrap(sql));
      return (await sql.begin((t) => fn(wrap(t)))) as R;
    },
  };
}

export function createPostgresDb(url: string, opts: { max?: number } = {}): Db & { end(): Promise<void> } {
  // Supabase 트랜잭션 풀러(6543)는 prepared statement를 지원하지 않는다.
  const sql = postgres(url, { prepare: false, max: opts.max ?? 5, onnotice: () => {} });
  return Object.assign(wrap(sql), { end: () => sql.end() });
}
