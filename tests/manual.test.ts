import { readFile } from "node:fs/promises";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createSessionToken, checkPassword, sessionKey, verifySessionToken } from "@/lib/admin/session";
import type { Db } from "@/lib/db";
import { createMemoryDb } from "@/lib/db/pglite";
import { migrate } from "@/lib/db/migrate";
import { loadCatalog, seed } from "@/lib/db/seed";
import { getManualMatch, listManualMatches, updateManualMatch } from "@/lib/manual/admin";
import { decodeCsv, parseCsv } from "@/lib/manual/csv";
import { loadManualCompetitions, parseImport, saveManualMatches } from "@/lib/manual/import";

const HEADER = "game_key,league,date,time,home,away,status,round,home_placeholder,away_placeholder,venue";

describe("CSV 읽기", () => {
  it("따옴표·쉼표·설명 줄·빈 줄을 처리한다", () => {
    const rows = parseCsv('# 설명\r\na,b\r\n\r\n"x, y","say ""hi"""\n');
    expect(rows).toEqual([
      { line: 2, cells: ["a", "b"] },
      { line: 4, cells: ["x, y", 'say "hi"'] },
    ]);
  });

  it("UTF-8 BOM과 엑셀 기본(EUC-KR) 저장을 모두 읽는다", () => {
    const utf8 = new Uint8Array([0xef, 0xbb, 0xbf, ...new TextEncoder().encode("LG,두산")]);
    expect(decodeCsv(utf8)).toBe("LG,두산");
    // '두산' 의 EUC-KR 바이트
    expect(decodeCsv(new Uint8Array([0x4c, 0x47, 0x2c, 0xb5, 0xce, 0xbb, 0xea]))).toBe("LG,두산");
  });
});

describe("수동 입력 (CSV·관리자 화면)", () => {
  let db: Db & { close(): Promise<void> };
  beforeEach(async () => {
    db = await createMemoryDb();
    await migrate(db);
    await seed(db, await loadCatalog());
  });
  afterEach(() => db.close());

  it("기본 시드에는 수동 입력 대회가 없다 (KBO·KBL 자동 수집)", async () => {
    expect(await loadManualCompetitions(db)).toEqual([]);
    // 아래 테스트는 자동 수집이 실패해 KBL 을 수동 입력으로 돌린 상황을 가정한다
    await db.query("update competition set feed = 'manual' where slug = 'kbl'");
    expect((await loadManualCompetitions(db)).map((c) => c.slug)).toEqual(["kbl"]);
  });

  it("예시 CSV는 오류 없이 읽히고 한국 시간을 UTC로 바꾼다", async () => {
    await db.query("update competition set feed = 'manual' where slug = 'kbl'");
    const comps = await loadManualCompetitions(db);
    const kbl = comps.find((c) => c.slug === "kbl")!;
    const parsed = parseImport(decodeCsv(new Uint8Array(await readFile("public/samples/kbl_sample.csv"))), comps);
    expect(parsed.errors).toEqual([]);
    const [first, , tbd, final] = parsed.byCompetition.get(kbl.id)!;
    expect(first).toMatchObject({
      externalId: "kbl:2026-1101-SK-LG",
      season: "2026-27",
      startAt: "2026-11-01T05:00:00.000Z",
      home: { externalId: "kbl-sk" },
      away: { externalId: "kbl-lg" },
      status: "scheduled",
    });
    expect(tbd).toMatchObject({ startAt: null, dateOnly: "2026-11-02", status: "time_tbd", home: { externalId: "kbl-jkj" } });
    expect(final).toMatchObject({ season: "2026-27", away: null, awayPlaceholder: "4강 승자", status: "scheduled" });
  });

  it("잘못된 줄은 줄 번호와 함께 모두 알려준다", async () => {
    await db.query("update competition set feed = 'manual' where slug = 'kbl'");
    const csv = [
      HEADER,
      "k1,KBL,2027-02-30,18:30,SK,LG,,,,,", // 없는 날짜
      "k2,KBL,2027-01-01,25:00,SK,LG,,,,,", // 잘못된 시간
      "k3,KBL,2027-01-01,18:30,SK,나이츠팀,,,,,", // 없는 팀
      "k4,KBL,2027-01-01,18:30,SK,SK,,,,,", // 같은 팀
      "k5,KBO,2027-01-01,18:30,SK,LG,,,,,", // 수동 입력 대회가 아님
      "k6,KBL,2027-01-01,18:30,SK,LG,몰라,,,,", // 상태
      "k6,KBL,2027-01-02,18:30,SK,LG,,,,,", // 키 중복
      "k8,KBL,2027-1-3,18:30,,,,,,,", // 팀 없음
    ].join("\n");
    const { errors, rows } = parseImport(csv, await loadManualCompetitions(db));
    expect(rows).toBe(0);
    expect(errors.map((e) => e.line)).toEqual([2, 3, 4, 5, 6, 7, 8, 9]);
  });

  it("같은 game_key 로 다시 올리면 같은 경기 ID로 날짜만 바뀐다", async () => {
    await db.query("update competition set feed = 'manual' where slug = 'kbl'");
    const comps = await loadManualCompetitions(db);
    const kbl = comps.find((c) => c.slug === "kbl")!;
    const load = (date: string) =>
      parseImport(`${HEADER}\nmove,KBL,${date},19:00,SK,LG,확정,정규리그,,,잠실학생`, comps).byCompetition.get(kbl.id)!;
    await saveManualMatches(db, kbl.id, load("2027-01-10"));
    const [before] = await listManualMatches(db, "kbl", "2027-01");
    const r = await saveManualMatches(db, kbl.id, load("2027-01-11"));
    expect(r).toMatchObject({ inserted: 0, updated: 1 });
    const [after] = await listManualMatches(db, "kbl", "2027-01");
    expect(after.id).toBe(before.id);
    expect(after).toMatchObject({ date: "2027-01-11", time: "19:00", sequence: 1, gameKey: "move" });

    const [st] = await db.query<{ last_source: string }>(
      "select last_source from competition_status where competition_id = $1",
      [kbl.id],
    );
    expect(st.last_source).toBe("manual");
  });

  it("관리자 화면 수정: 시간을 지우면 시간 미정, 장소를 비우면 지운다", async () => {
    await db.query("update competition set feed = 'manual' where slug = 'kbl'");
    const comps = await loadManualCompetitions(db);
    const kbl = comps.find((c) => c.slug === "kbl")!;
    await saveManualMatches(
      db,
      kbl.id,
      parseImport(`${HEADER}\ng1,KBL,2027-01-05,14:00,KCC,DB,,정규리그,,,부산`, comps).byCompetition.get(kbl.id)!,
    );
    const [m] = await listManualMatches(db, "kbl", "2027-01");
    await updateManualMatch(db, m.id, {
      gameKey: "g1",
      league: "kbl",
      date: "2027-01-06",
      time: null,
      home: "kbl-kcc",
      away: "kbl-db",
      status: "scheduled",
      round: "정규리그",
      homePlaceholder: null,
      awayPlaceholder: null,
      venue: null,
    });
    const after = await getManualMatch(db, m.id);
    expect(after).toMatchObject({ date: "2027-01-06", time: null, status: "time_tbd", venue: null, sequence: 1 });
  });
});

describe("관리자 세션", () => {
  const key = sessionKey("correct horse");
  it("서명이 맞고 만료 전이면 통과, 위조·만료·다른 비밀번호는 거부", () => {
    const now = Date.UTC(2026, 9, 21);
    const { token } = createSessionToken(key, now);
    expect(verifySessionToken(token, key, now + 1000)).toBe(true);
    expect(verifySessionToken(token, key, now + 8 * 86_400_000)).toBe(false);
    expect(verifySessionToken(token, sessionKey("other"), now)).toBe(false);
    const [exp] = token.split(".");
    expect(verifySessionToken(`${Number(exp) + 999999}.${token.split(".")[1]}`, key, now)).toBe(false);
    expect(verifySessionToken(undefined, key, now)).toBe(false);
  });
  it("비밀번호 비교", () => {
    expect(checkPassword("correct horse", "correct horse")).toBe(true);
    expect(checkPassword("correct", "correct horse")).toBe(false);
  });
});
