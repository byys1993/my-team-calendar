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

export type PostgresDbOptions = {
  max?: number;
  // 조회 하나가 이 시간(ms)을 넘으면 오류로 끝내고 연결을 통째로 버린 뒤 다음 조회에서 새로 연결한다.
  // 트랜잭션은 안의 조회를 모두 합쳐 이 시간의 4배까지 기다린다. 없으면 제한 없음(수집·마이그레이션).
  queryTimeoutMs?: number;
};

export function createPostgresDb(url: string, opts: PostgresDbOptions = {}): Db & { end(): Promise<void> } {
  // Supabase 트랜잭션 풀러(6543)는 prepared statement를 지원하지 않는다.
  // 주소·비밀번호가 틀렸을 때 하염없이 기다리지 않고 15초 안에 오류를 내도록 접속 제한 시간을 둔다.
  // Vercel 서버는 요청 사이에 오래 살아 있어서, 풀러가 몰래 끊은 연결을 붙잡고 응답을 하염없이 기다릴 수 있다.
  // → 20초 쉰 연결과 5분 넘은 연결은 먼저 닫고 다음 요청에서 새로 연결한다.
  const make = () =>
    postgres(url, {
      prepare: false,
      max: opts.max ?? 5,
      connect_timeout: 15,
      idle_timeout: 20,
      max_lifetime: 5 * 60,
      onnotice: () => {},
    });
  let sql = make();
  const limit = opts.queryTimeoutMs;

  // 조회 도중에 연결이 멈추면(응답 없음) 그 연결 뒤에 줄 선 요청까지 함수 시간 제한(5분)까지 모두 멈춘다.
  // 2026-11 운영에서 며칠에 걸쳐 수백 건이 이렇게 끊겼다 → 제한 시간을 넘기면 클라이언트를 바꿔 끼운다.
  async function guard<R>(ms: number | undefined, run: (s: postgres.Sql) => Promise<R>): Promise<R> {
    if (!ms) return run(sql);
    const s = sql;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const timeout = new Promise<never>((_, reject) => {
      timer = setTimeout(() => {
        if (sql === s) {
          sql = make();
          s.end({ timeout: 0 }).catch(() => {});
        }
        reject(new Error(`DB 응답이 ${ms / 1000}초 안에 오지 않아 연결을 새로 맺습니다`));
      }, ms);
    });
    try {
      return await Promise.race([run(s), timeout]);
    } finally {
      clearTimeout(timer);
    }
  }

  return {
    query<T>(text: string, params: unknown[] = []) {
      return guard(limit, (s) => wrap(s).query<T>(text, params));
    },
    tx<R>(fn: (db: Db) => Promise<R>) {
      return guard(limit && limit * 4, (s) => wrap(s).tx(fn));
    },
    end: () => sql.end(),
  };
}
