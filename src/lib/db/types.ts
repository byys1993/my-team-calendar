// 운영(postgres.js)과 테스트(PGlite)가 같은 코드를 쓰도록 하는 최소 인터페이스.
// 파라미터는 Postgres 표준인 $1, $2 ... 형식을 쓴다.
export interface Db {
  query<T = Record<string, unknown>>(text: string, params?: unknown[]): Promise<T[]>;
  tx<R>(fn: (db: Db) => Promise<R>): Promise<R>;
}
