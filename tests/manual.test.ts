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

describe("KBO·KBL 가져오기", () => {
  let db: Db & { close(): Promise<void> };
  beforeEach(async () => {
    db = await createMemoryDb();
    await migrate(db);
    await seed(db, await loadCatalog());
  });
  afterEach(() => db.close());

  it("예시 CSV는 오류 없이 읽히고 한국 시간을 UTC로 바꾼다", async () => {
    const comps = await loadManualCompetitions(db);
    for (const f of ["kbo_sample.csv", "kbl_sample.csv"]) {
      const text = decodeCsv(new Uint8Array(await readFile(`public/samples/${f}`)));
      const parsed = parseImport(text, comps);
      expect(parsed.errors, f).toEqual([]);
      expect(parsed.rows).toBeGreaterThan(0);
    }
    const kbo = comps.find((c) => c.slug === "kbo")!;
    const parsed = parseImport(
      decodeCsv(new Uint8Array(await readFile("public/samples/kbo_sample.csv"))),
      comps,
    );
    const [first, , tbd, , ks1, ks1Samsung] = parsed.byCompetition.get(kbo.id)!;
    expect(first).toMatchObject({
      externalId: "kbo:2027-0327-LG-DOOSAN",
      season: "2027",
      startAt: "2027-03-27T05:00:00.000Z",
      home: { externalId: "kbo-lg" },
      away: { externalId: "kbo-doosan" },
      status: "scheduled",
    });
    expect(tbd).toMatchObject({ startAt: null, dateOnly: "2027-03-28", status: "time_tbd" });
    expect(ks1).toMatchObject({ away: null, awayPlaceholder: "플레이오프 승자", status: "scheduled" });
    expect(ks1Samsung).toMatchObject({ home: null, homePlaceholder: "LG", status: "conditional" });
  });

  it("잘못된 줄은 줄 번호와 함께 모두 알려준다", async () => {
    const csv = [
      HEADER,
      "k1,KBO,2027-02-30,18:30,LG,두산,,,,,", // 없는 날짜
      "k2,KBO,2027-04-01,25:00,LG,두산,,,,,", // 잘못된 시간
      "k3,KBO,2027-04-01,18:30,LG,베어스팀,,,,,", // 없는 팀
      "k4,KBO,2027-04-01,18:30,LG,LG,,,,,", // 같은 팀
      "k5,MLB,2027-04-01,18:30,LG,두산,,,,,", // 다른 리그
      "k6,KBO,2027-04-01,18:30,LG,두산,몰라,,,,", // 상태
      "k6,KBO,2027-04-02,18:30,LG,두산,,,,,", // 키 중복
      "k8,KBO,2027-4-3,18:30,,,,,,,", // 팀 없음
    ].join("\n");
    const { errors, rows } = parseImport(csv, await loadManualCompetitions(db));
    expect(rows).toBe(0);
    expect(errors.map((e) => e.line)).toEqual([2, 3, 4, 5, 6, 7, 8, 9]);
  });

  it("같은 game_key 로 다시 올리면 같은 경기 ID로 날짜만 바뀐다 (우천 순연)", async () => {
    const comps = await loadManualCompetitions(db);
    const kbo = comps.find((c) => c.slug === "kbo")!;
    const load = (date: string, status = "확정") =>
      parseImport(`${HEADER}\nrain,KBO,${date},18:30,LG,두산,${status},정규시즌,,,잠실`, comps).byCompetition.get(kbo.id)!;
    await saveManualMatches(db, kbo.id, load("2027-04-10"));
    const [before] = await listManualMatches(db, "kbo", "2027-04");
    const r = await saveManualMatches(db, kbo.id, load("2027-04-11"));
    expect(r).toMatchObject({ inserted: 0, updated: 1 });
    const [after] = await listManualMatches(db, "kbo", "2027-04");
    expect(after.id).toBe(before.id);
    expect(after).toMatchObject({ date: "2027-04-11", time: "18:30", sequence: 1, gameKey: "rain" });

    const [st] = await db.query<{ last_source: string }>(
      "select last_source from competition_status where competition_id = $1",
      [kbo.id],
    );
    expect(st.last_source).toBe("manual");
  });

  it("관리자 화면 수정: 시간을 지우면 시간 미정, 장소를 비우면 지운다", async () => {
    const comps = await loadManualCompetitions(db);
    const kbo = comps.find((c) => c.slug === "kbo")!;
    await saveManualMatches(
      db,
      kbo.id,
      parseImport(`${HEADER}\ng1,KBO,2027-05-05,14:00,KIA,롯데,,어린이날,,,광주`, comps).byCompetition.get(kbo.id)!,
    );
    const [m] = await listManualMatches(db, "kbo", "2027-05");
    await updateManualMatch(db, m.id, {
      gameKey: "g1",
      league: "kbo",
      date: "2027-05-06",
      time: null,
      home: "kbo-kia",
      away: "kbo-lotte",
      status: "scheduled",
      round: "어린이날",
      homePlaceholder: null,
      awayPlaceholder: null,
      venue: null,
    });
    const after = await getManualMatch(db, m.id);
    expect(after).toMatchObject({ date: "2027-05-06", time: null, status: "time_tbd", venue: null, sequence: 1 });
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
