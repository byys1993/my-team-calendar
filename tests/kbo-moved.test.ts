import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createMemoryDb } from "@/lib/db/pglite";
import { migrate } from "@/lib/db/migrate";
import { seed } from "@/lib/db/seed";
import { upsertMatches } from "@/collector/upsert";
import { syncCompetition } from "@/collector/run";
import { kbo, markMovedGames, type KboGame } from "@/collector/sources/kbo";
import type { Coverage, SourceMatch } from "@/collector/types";
import type { Db } from "@/lib/db";

// KBO 포스트시즌 순연: 공식 일정은 옛 날짜 줄을 지우고 날짜가 든 새 경기 ID(20261026HTSS0)로 다시 올린다.
let db: Db & { close(): Promise<void> };
let kboId: number;

beforeEach(async () => {
  db = await createMemoryDb();
  await migrate(db);
  await seed(db, {
    sports: [{ slug: "baseball", name_ko: "야구" }],
    competitions: [{ slug: "kbo", sport: "baseball", name_ko: "KBO 리그", type: "league", sources: [{ source: "kbo", external_id: "1" }] }],
    teams: [
      { slug: "kbo-samsung", sport: "baseball", competition: "kbo", name_ko: "삼성", name_en: "Samsung", refs: { kbo: "SS" } },
      { slug: "kbo-kia", sport: "baseball", competition: "kbo", name_ko: "KIA", name_en: "KIA", refs: { kbo: "HT" } },
    ],
  });
  [{ id: kboId }] = await db.query<{ id: number }>("select id from competition where slug = 'kbo'");
});
afterEach(async () => {
  await db.close();
});

// PO n차전. 1·2차전은 삼성 홈, 3·4차전은 KIA 홈
function po(no: number, date: string, over: Partial<SourceMatch> = {}): SourceMatch {
  const [home, away] = no === 3 || no === 4 ? ["HT", "SS"] : ["SS", "HT"];
  return {
    externalId: `${date.replace(/-/g, "")}${away}${home}0`,
    season: "2026",
    roundLabel: `@series:kbo_po|@game:${no}`,
    home: { externalId: home, name: home },
    away: { externalId: away, name: away },
    startAt: new Date(`${date}T18:30:00+09:00`).toISOString(),
    status: "scheduled",
    ...over,
  };
}
const OCT: Coverage[] = [{ from: "2026-09-30T15:00:00.000Z", to: "2026-10-31T15:00:00.000Z" }];
const save = (list: SourceMatch[], coverage = OCT) => upsertMatches(db, kboId, "kbo", list, { coverage, datedIds: true });
const rows = () =>
  db.query<{ id: string; round_label: string; day: string; status: string; sequence: number; home_score: number | null; external_id: string | null }>(
    `select m.id, m.round_label, to_char(m.start_at at time zone 'Asia/Seoul', 'MM-DD') as day, m.status, m.sequence, m.home_score,
       r.external_id
     from match m left join match_source_ref r on r.match_id = m.id order by m.start_at`,
  );

describe("KBO 순연 경기", () => {
  it("시리즈가 하루씩 밀리면 같은 N차전에 새 ID를 이어 붙인다 (경기 ID 유지, sequence+1)", async () => {
    await save([po(1, "2026-10-25"), po(2, "2026-10-26"), po(3, "2026-10-28"), po(4, "2026-10-29")]);
    const before = await rows();

    // 10/25 우천 순연 → 1차전 10/26, 2차전 10/27, 3차전 10/29, 4차전 10/30. 1차전 새 ID는 옛 2차전 ID와 같다.
    const r = await save([
      po(1, "2026-10-26", { homeScore: 5, awayScore: 1 }),
      po(2, "2026-10-27"),
      po(3, "2026-10-29"),
      po(4, "2026-10-30"),
    ]);
    expect(r).toMatchObject({ inserted: 0, updated: 4, removed: 0 });
    const after = await rows();
    expect(after.map((x) => [x.round_label.slice(-1), x.day, x.external_id])).toEqual([
      ["1", "10-26", "20261026HTSS0"],
      ["2", "10-27", "20261027HTSS0"],
      ["3", "10-29", "20261029SSHT0"],
      ["4", "10-30", "20261030SSHT0"],
    ]);
    // 각 N차전이 원래 경기 ID를 그대로 갖고 일정 변경 횟수가 하나 늘었다
    expect(after.map((x) => x.id)).toEqual(before.map((x) => x.id));
    expect(after.map((x) => x.sequence)).toEqual([1, 1, 1, 1]);

    // 다시 받아도 그대로
    expect(
      await save([po(1, "2026-10-26", { homeScore: 5, awayScore: 1 }), po(2, "2026-10-27"), po(3, "2026-10-29"), po(4, "2026-10-30")]),
    ).toMatchObject({ inserted: 0, updated: 0, removed: 0 });
  });

  it("이미 쌓인 옛 날짜 중복 행은 다음 수집 때 지운다", async () => {
    // 고치기 전 수집이 남긴 상태: 10/25 1차전(옛 ID)과 10/26 1차전(새 ID), 10/28 3차전과 10/29 3차전
    await upsertMatches(db, kboId, "kbo", [po(1, "2026-10-25"), po(3, "2026-10-28")]);
    await upsertMatches(db, kboId, "kbo", [po(1, "2026-10-26", { homeScore: 5, awayScore: 1 }), po(3, "2026-10-29")]);
    expect(await rows()).toHaveLength(4);

    const r = await save([po(1, "2026-10-26", { homeScore: 5, awayScore: 1 }), po(3, "2026-10-29")]);
    expect(r.removed).toBe(2);
    expect((await rows()).map((x) => [x.round_label.slice(-1), x.day, x.home_score])).toEqual([
      ["1", "10-26", 5],
      ["3", "10-29", null],
    ]);
  });

  it("시리즈가 일찍 끝나 지워진 '진출 시' 경기는 지우고, 그 밖에 사라진 경기는 취소로 바꾼다", async () => {
    await save([
      po(1, "2026-10-25"),
      po(4, "2026-10-29", { status: "conditional" }),
      { ...po(1, "2026-10-20"), externalId: "20261020HTSS0", roundLabel: null },
      // 지난달·다른 시즌 경기는 이번 응답 범위 밖이라 건드리지 않는다
      { ...po(2, "2026-09-20"), externalId: "20260920HTSS0", roundLabel: null },
    ]);
    const r = await save([po(1, "2026-10-25")]);
    expect(r).toMatchObject({ removed: 1, updated: 1 });
    expect((await rows()).map((x) => [x.day, x.status, x.sequence])).toEqual([
      ["09-20", "scheduled", 0],
      ["10-20", "cancelled", 1],
      ["10-25", "scheduled", 0],
    ]);
  });

  it("끝난 경기와 응답 범위(coverage)가 없는 수집에서는 아무것도 정리하지 않는다", async () => {
    await save([po(1, "2026-10-25", { homeScore: 5, awayScore: 1 }), po(2, "2026-10-26")]);
    expect(await upsertMatches(db, kboId, "kbo", [], { datedIds: true })).toMatchObject({ removed: 0, updated: 0 });
    expect(await save([])).toMatchObject({ removed: 0, updated: 1 }); // 2차전만 취소, 끝난 1차전은 그대로
    expect((await rows()).map((x) => x.status)).toEqual(["scheduled", "cancelled"]);
  });

  it("옛 날짜 줄이 비고 그대로 함께 오면 늦은 날짜(점수가 있으면 그 줄)만 남기고 연기로 바꾼다", () => {
    const g = (date: string, over: Partial<KboGame> = {}): KboGame => ({ ...po(1, date), winner: null, ...over });
    const [old, moved] = markMovedGames([g("2026-10-25"), g("2026-10-26")]);
    expect(old).toMatchObject({ status: "postponed", roundLabel: "@postseason" });
    expect(moved).toMatchObject({ status: "scheduled", roundLabel: "@series:kbo_po|@game:1" });
    const [played, later] = markMovedGames([g("2026-10-25", { homeScore: 5, awayScore: 1 }), g("2026-10-26")]);
    expect(played.status).toBe("scheduled");
    expect(later.status).toBe("postponed");
  });

  it("KBO 수집은 응답이 있는 달만 coverage 로 넘기고, 수집 전체가 순연을 이어 붙인다", async () => {
    const cell = (Text: string, Class: string | null = null) => ({ Text, Class });
    const row = (day: string, away: string, home: string, note: string) => ({
      row: [cell(day, "day"), cell("<b>18:30</b>", "time"), cell(`<span>${away}</span><em><span>vs</span></em><span>${home}</span>`, "play"),
        cell("", "relay"), cell(""), cell(""), cell(""), cell("대구"), cell(note)],
    });
    let octRows = [row("10.25(일)", "KIA", "삼성", "PO 1차전"), row("10.26(월)", "KIA", "삼성", "PO 2차전")];
    const fetcher = async (url: string, init?: RequestInit) => {
      const body = new URLSearchParams(String(init?.body));
      const rows = url.includes("GetScheduleList") && body.get("gameMonth") === "10" && body.get("srIdList") !== "0,9,6" ? octRows : [];
      return new Response(JSON.stringify(url.includes("GetScheduleList") ? { rows } : { game: [] }));
    };
    const adapter = kbo(fetcher, { delayMs: 0, now: () => new Date("2026-10-27T03:00:00Z") });
    const result = await adapter.fetchMatches("1");
    expect(result.coverage).toEqual([{ from: "2026-09-30T15:00:00.000Z", to: "2026-10-31T15:00:00.000Z" }]);

    const comp = { id: kboId, slug: "kbo", postseason: true, type: "league" };
    await syncCompetition(db, comp, { kbo: adapter });
    const [first] = await rows();
    octRows = [row("10.26(월)", "KIA", "삼성", "PO 1차전"), row("10.27(화)", "KIA", "삼성", "PO 2차전")];
    expect(await syncCompetition(db, comp, { kbo: adapter })).toMatchObject({ ok: true, inserted: 0, updated: 2, removed: 0 });
    const after = await rows();
    expect(after.map((x) => [x.day, x.external_id])).toEqual([
      ["10-26", "20261026HTSS0"],
      ["10-27", "20261027HTSS0"],
    ]);
    expect(after[0].id).toBe(first.id);
  });
});
