import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { upsertMatches } from "@/collector/upsert";
import { normalizeName } from "@/collector/normalize";
import type { Db } from "@/lib/db";
import { espnMatch, fdMatch, setupDb } from "./helpers";

let db: Db & { close(): Promise<void> };
let eplId: number;

beforeEach(async () => {
  ({ db, eplId } = await setupDb());
});
afterEach(async () => {
  await db.close();
});

const matches = () =>
  db.query<{ id: string; start_at: Date; status: string; sequence: number; venue: string | null }>(
    "select id, start_at, status, sequence, venue from match",
  );

describe("normalizeName", () => {
  it("소스별 표기 차이를 같은 값으로 만든다", () => {
    expect(normalizeName("Arsenal FC")).toBe("arsenal");
    expect(normalizeName("AFC Bournemouth")).toBe("bournemouth");
    expect(normalizeName("Brighton & Hove Albion FC")).toBe(normalizeName("Brighton and Hove Albion"));
    expect(normalizeName("Atlético Madrid")).toBe("atletico madrid");
  });
});

describe("upsertMatches", () => {
  it("이름으로 팀을 자동 연결하고 경기를 저장한다", async () => {
    const r = await upsertMatches(db, eplId, "football-data", [fdMatch()]);
    expect(r).toMatchObject({ inserted: 1, updated: 0, skipped: 0 });
    const refs = await db.query<{ external_id: string; slug: string }>(
      `select r.external_id, t.slug from team_source_ref r join team t on t.id = r.team_id
       where r.source = 'football-data' order by t.slug`,
    );
    expect(refs).toEqual([
      { external_id: "57", slug: "arsenal" },
      { external_id: "62", slug: "everton" },
    ]);
  });

  it("일정이 바뀌어도 같은 경기 ID를 유지하고 날짜·시간만 갱신한다", async () => {
    await upsertMatches(db, eplId, "football-data", [fdMatch()]);
    const [before] = await matches();

    const r = await upsertMatches(db, eplId, "football-data", [
      fdMatch({ startAt: "2026-10-25T16:30:00Z", status: "scheduled" }),
    ]);
    expect(r).toMatchObject({ inserted: 0, updated: 1 });
    const after = await matches();
    expect(after).toHaveLength(1);
    expect(after[0].id).toBe(before.id);
    expect(after[0].start_at.toISOString()).toBe("2026-10-25T16:30:00.000Z");
    expect(after[0].sequence).toBe(1);
  });

  it("변경이 없으면 갱신하지 않는다", async () => {
    await upsertMatches(db, eplId, "football-data", [fdMatch()]);
    const r = await upsertMatches(db, eplId, "football-data", [fdMatch()]);
    expect(r).toMatchObject({ inserted: 0, updated: 0 });
  });

  it("대체 소스에서 온 같은 경기는 기존 ID에 연결한다", async () => {
    await upsertMatches(db, eplId, "football-data", [fdMatch()]);
    const [before] = await matches();

    const r = await upsertMatches(db, eplId, "espn", [espnMatch()]);
    expect(r.inserted).toBe(0);
    const after = await matches();
    expect(after).toHaveLength(1);
    expect(after[0].id).toBe(before.id);
    // 주 소스에 없던 장소 정보는 채워진다
    expect(after[0].venue).toBe("Emirates Stadium");

    const refs = await db.query<{ source: string }>(
      "select source from match_source_ref where match_id = $1 order by source",
      [before.id],
    );
    expect(refs.map((x) => x.source)).toEqual(["espn", "football-data"]);
  });

  it("대체 소스가 먼저 만든 경기에도 주 소스가 나중에 연결된다", async () => {
    await upsertMatches(db, eplId, "espn", [espnMatch({ startAt: "2026-10-24T14:00:00Z" })]);
    const [before] = await matches();
    // 그 사이 연기된 상태로 주 소스가 복구됨
    await upsertMatches(db, eplId, "football-data", [fdMatch({ startAt: "2026-11-04T19:45:00Z" })]);
    const after = await matches();
    expect(after).toHaveLength(1);
    expect(after[0].id).toBe(before.id);
    expect(after[0].venue).toBe("Emirates Stadium");
  });

  it("매핑할 수 없는 팀이 있으면 저장하지 않고 기록한다", async () => {
    const r = await upsertMatches(db, eplId, "football-data", [
      fdMatch({ externalId: "9", away: { externalId: "999", name: "Unknown Rovers FC" } }),
    ]);
    expect(r).toMatchObject({ inserted: 0, skipped: 1, unmapped: ["Unknown Rovers FC"] });
    expect(await matches()).toHaveLength(0);
    const unmapped = await db.query<{ raw_name: string }>("select raw_name from unmapped_team");
    expect(unmapped).toEqual([{ raw_name: "Unknown Rovers FC" }]);
  });

  it("주 소스에서는 처음 보는 상대팀을 검토 필요 상태로 만들어 경기를 저장한다", async () => {
    const r = await upsertMatches(
      db,
      eplId,
      "football-data",
      [fdMatch({ externalId: "10", away: { externalId: "999", name: "Unknown Rovers FC", shortName: "Rovers" } })],
      { autoCreateTeams: true },
    );
    expect(r).toMatchObject({ inserted: 1, skipped: 0, unmapped: [] });
    const [team] = await db.query<{ slug: string; name_ko: string; needs_review: boolean }>(
      "select slug, name_ko, needs_review from team where needs_review",
    );
    expect(team).toEqual({ slug: "football-data-999", name_ko: "Unknown Rovers FC", needs_review: true });
  });

  it("경기가 많아도 질의 수는 일정하다 (멀리 있는 DB 대비)", async () => {
    let queries = 0;
    const counting: Db = {
      query: (text, params) => {
        queries++;
        return db.query(text, params);
      },
      tx: (fn) => db.tx((t) => fn({ query: (q, p) => (queries++, t.query(q, p)), tx: t.tx })),
    };
    const many = (n: number, hour: number) =>
      Array.from({ length: n }, (_, i) =>
        fdMatch({
          externalId: `bulk-${i}`,
          startAt: new Date(Date.UTC(2026, 8, 1, hour) + i * 86_400_000).toISOString(),
        }),
      );
    // 처음 저장 (팀 자동 연결 포함)
    const first = await upsertMatches(counting, eplId, "football-data", many(1500, 14));
    expect(first.inserted).toBe(1500);
    expect(queries).toBeLessThan(20);
    // 변경 없음
    queries = 0;
    expect(await upsertMatches(counting, eplId, "football-data", many(1500, 14))).toMatchObject({ inserted: 0, updated: 0 });
    expect(queries).toBeLessThan(10);
    // 전부 시각 변경 → 같은 ID로 갱신, sequence +1
    queries = 0;
    expect(await upsertMatches(counting, eplId, "football-data", many(1500, 16))).toMatchObject({ updated: 1500 });
    expect(queries).toBeLessThan(10);
    const [{ n }] = await db.query<{ n: number }>("select count(*)::int as n from match where sequence = 1");
    expect(n).toBe(1500);
  });

  it("대진 미정 경기는 팀 없이 저장한다", async () => {
    const r = await upsertMatches(db, eplId, "football-data", [
      fdMatch({ externalId: "77", away: null, awayPlaceholder: "미정", status: "draw_pending" }),
    ]);
    expect(r.inserted).toBe(1);
    const [m] = await matches();
    expect(m.status).toBe("draw_pending");
  });
});
