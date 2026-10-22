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
  // 주소·비밀번호가 틀렸을 때 하염없이 기다리지 않고 15초 안에 오류를 내도록 접속 제한 시간을 둔다.
  const sql = postgres(url, { prepare: false, max: opts.max ?? 5, connect_timeout: 15, onnotice: () => {} });
  return Object.assign(wrap(sql), { end: () => sql.end() });
}
