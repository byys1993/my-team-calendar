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
  // Vercel 서버는 요청 사이에 오래 살아 있어서, 풀러가 몰래 끊은 연결을 붙잡고 응답을 하염없이 기다릴 수 있다.
  // → 20초 쉰 연결과 5분 넘은 연결은 먼저 닫고 다음 요청에서 새로 연결한다.
  const sql = postgres(url, {
    prepare: false,
    max: opts.max ?? 5,
    connect_timeout: 15,
    idle_timeout: 20,
    max_lifetime: 5 * 60,
    onnotice: () => {},
  });
  return Object.assign(wrap(sql), { end: () => sql.end() });
}
