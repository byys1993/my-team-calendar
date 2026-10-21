import { PGlite } from "@electric-sql/pglite";
import { PGLiteSocketServer } from "@electric-sql/pglite-socket";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { upsertMatches } from "@/collector/upsert";
import { createPostgresDb } from "@/lib/db/postgres";
import { migrate } from "@/lib/db/migrate";
import { loadCatalog, seed } from "@/lib/db/seed";
import { espnMatch, fdMatch } from "./helpers";

// 다른 테스트는 PGlite 를 직접 쓰지만, 운영은 postgres.js 드라이버를 거친다.
// 매개변수 직렬화 차이(예: jsonb 이중 인코딩)를 잡기 위해 같은 경로로 한 번 돌려 본다.
const PORT = 54399;
let pg: PGlite;
let server: PGLiteSocketServer;
let db: ReturnType<typeof createPostgresDb>;

beforeAll(async () => {
  pg = await PGlite.create();
  server = new PGLiteSocketServer({ db: pg, port: PORT, host: "127.0.0.1" });
  await server.start();
  db = createPostgresDb(`postgres://postgres:postgres@127.0.0.1:${PORT}/postgres`, { max: 1 });
});

afterAll(async () => {
  await db.end();
  await server.stop();
  await pg.close();
});

describe("postgres.js 드라이버 경로", () => {
  it("마이그레이션·시드·대량 저장·대체 소스 연결이 동작한다", async () => {
    await migrate(db);
    const catalog = await loadCatalog();
    await seed(db, catalog);
    const [{ n: teams }] = await db.query<{ n: number }>("select count(*)::int as n from team");
    expect(teams).toBe(catalog.teams.length);

    const [{ id: epl }] = await db.query<{ id: number }>("select id from competition where slug = 'epl'");
    expect(await upsertMatches(db, epl, "football-data", [fdMatch()])).toMatchObject({ inserted: 1 });
    expect(await upsertMatches(db, epl, "espn", [espnMatch()])).toMatchObject({ inserted: 0 });
    expect(
      await upsertMatches(db, epl, "football-data", [fdMatch({ startAt: "2026-10-25T16:30:00Z" })]),
    ).toMatchObject({ updated: 1 });
    // 대체 소스가 장소를 채운 것(+1)과 시각 변경(+1) 모두 일정 변경으로 센다
    const rows = await db.query<{ sequence: number; venue: string }>("select sequence, venue from match");
    expect(rows).toEqual([{ sequence: 2, venue: "Emirates Stadium" }]);
  });
});
