import net from "node:net";
import { PGlite } from "@electric-sql/pglite";
import { PGLiteSocketServer } from "@electric-sql/pglite-socket";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createPostgresDb } from "@/lib/db/postgres";

// 운영에서 풀러가 연결을 몰래 끊으면 조회가 응답 없이 멈춘다.
// 중간에 끼운 프록시가 응답을 삼키게 해서 그 상황을 만들고, 제한 시간 뒤 새 연결로 회복하는지 본다.
const PG_PORT = 54401;
const PROXY_PORT = 54402;
let pg: PGlite;
let server: PGLiteSocketServer;
let proxy: net.Server;
let blackhole = false;
let db: ReturnType<typeof createPostgresDb>;

beforeAll(async () => {
  pg = await PGlite.create();
  server = new PGLiteSocketServer({ db: pg, port: PG_PORT, host: "127.0.0.1" });
  await server.start();
  proxy = net.createServer((client) => {
    const upstream = net.connect(PG_PORT, "127.0.0.1");
    client.on("data", (d) => {
      if (!blackhole) upstream.write(d);
    });
    upstream.on("data", (d) => {
      if (!blackhole) client.write(d);
    });
    const close = () => {
      client.destroy();
      upstream.destroy();
    };
    client.on("close", close).on("error", close);
    upstream.on("close", close).on("error", close);
  });
  await new Promise<void>((r) => proxy.listen(PROXY_PORT, "127.0.0.1", r));
  db = createPostgresDb(`postgres://postgres:postgres@127.0.0.1:${PROXY_PORT}/postgres`, {
    max: 1,
    queryTimeoutMs: 500,
  });
});

afterAll(async () => {
  await db.end();
  await new Promise((r) => proxy.close(r));
  // 프록시가 끊은 연결을 PGlite 소켓 서버가 정리할 틈을 준다 (먼저 닫으면 정리 중에 오류)
  await new Promise((r) => setTimeout(r, 200));
  await server.stop();
  await pg.close();
});

describe("DB 조회 시간 제한", () => {
  it("응답이 멈추면 제한 시간 뒤 오류를 내고, 다음 조회는 새 연결로 성공한다", async () => {
    expect(await db.query<{ n: number }>("select 1 as n")).toEqual([{ n: 1 }]);

    blackhole = true;
    const started = Date.now();
    // 같은 연결 뒤에 줄 선 조회도 함께 멈추지 않고 끝나야 한다
    const results = await Promise.allSettled([db.query("select 2"), db.query("select 3")]);
    expect(results.every((r) => r.status === "rejected")).toBe(true);
    expect(Date.now() - started).toBeLessThan(3000);

    blackhole = false;
    expect(await db.query<{ n: number }>("select 4 as n")).toEqual([{ n: 4 }]);
    expect(await db.tx((t) => t.query<{ n: number }>("select 5 as n"))).toEqual([{ n: 5 }]);
  });
});
