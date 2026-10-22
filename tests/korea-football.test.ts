import { describe, expect, it } from "vitest";
import { intlLabel, parseEspnEvent, type EspnEvent } from "@/collector/sources/espn";
import { espn } from "@/collector/sources/espn";
import { parseKleague, type KleagueGame } from "@/collector/sources/kleague";
import { formatLabel } from "@/i18n/format";
import { ko } from "@/i18n/messages/ko";

const g = (o: Partial<KleagueGame>): KleagueGame => ({
  year: 2026,
  leagueId: 1,
  meetSeq: 1,
  meetName: "하나은행 K리그1 2026",
  roundId: 33,
  gameId: 198,
  gameDate: "2026.10.24",
  gameTime: "14:00",
  homeTeam: "K09",
  homeTeamName: "서울",
  awayTeam: "K21",
  awayTeamName: "강원",
  fieldNameFull: "서울 월드컵 경기장",
  codeName: "스플릿일반",
  ...o,
});

describe("K리그", () => {
  it("일정 변환: 한국 시간, 라운드, 경기장", () => {
    const [m] = parseKleague([g({})]);
    expect(m).toMatchObject({
      externalId: "2026-1-198",
      season: "2026",
      roundLabel: "@round:33",
      home: { externalId: "K09" },
      away: { externalId: "K21" },
      startAt: "2026-10-24T05:00:00.000Z",
      status: "scheduled",
      venue: "서울 월드컵 경기장",
    });
    expect(formatLabel(m.roundLabel, ko)).toBe("33라운드");
  });

  it("시각 미정, 파이널 라운드, K리그2 플레이오프, 승강 플레이오프", () => {
    const out = parseKleague([
      g({ gameId: 1, gameTime: "" }),
      g({ gameId: 2, codeName: "파이널A", roundId: 35 }),
      g({ gameId: 3, leagueId: 2, meetSeq: 2, codeName: "Play Off", roundId: 40 }),
      g({ gameId: 4, leagueId: 2, meetSeq: 2, codeName: "Play Off", roundId: 41 }),
      g({ gameId: 5, meetSeq: 3, meetName: "하나은행 K리그 승강 PO 2026", codeName: "Play Off", roundId: 2 }),
    ]);
    expect(out[0]).toMatchObject({ startAt: null, dateOnly: "2026-10-24", status: "time_tbd" });
    expect(out.slice(1).map((m) => formatLabel(m.roundLabel, ko))).toEqual([
      "파이널A · 35라운드",
      "준플레이오프",
      "플레이오프",
      "승강 플레이오프 · 2차전",
    ]);
  });
});

describe("국가대표 A매치 (ESPN 팀 일정)", () => {
  const ev = (o: Partial<EspnEvent> = {}): EspnEvent => ({
    id: "401872245",
    date: "2027-01-10T20:00Z",
    league: { slug: "afc.asian.cup", name: "AFC Asian Cup" },
    competitions: [
      {
        venue: { fullName: "King Abdullah Sports City" },
        competitors: [
          { homeAway: "home", team: { id: "451", displayName: "South Korea" } },
          { homeAway: "away", team: { id: "6014", displayName: "Yemen" } },
        ],
        status: { type: { name: "STATUS_SCHEDULED" } },
      },
    ],
    ...o,
  });

  it("대회 구분 라벨", () => {
    expect(formatLabel(intlLabel({ slug: "fifa.friendly" }), ko)).toBe("친선 경기");
    expect(formatLabel(intlLabel({ slug: "afc.asian.cup" }), ko)).toBe("AFC 아시안컵");
    expect(intlLabel({ slug: "xyz", name: "Some Cup" })).toBe("@t:Some Cup");
    expect(parseEspnEvent(ev(), "soccer/all")?.home?.externalId).toBe("451");
  });

  it("남은 일정과 올해 경기를 합치고 상대국에 한국어 이름을 붙인다", async () => {
    const urls: string[] = [];
    const fetcher = async (url: string) => {
      urls.push(url);
      const events = url.includes("fixture=true") ? [ev()] : [ev(), ev({ id: "1", date: "2026-10-06T11:00Z", league: { slug: "fifa.friendly" } })];
      return new Response(JSON.stringify({ events }));
    };
    const out = await espn(fetcher, { delayMs: 0, now: () => new Date("2026-10-22T00:00:00Z") }).fetchMatches("team:451");
    expect(urls).toEqual([
      "https://site.api.espn.com/apis/site/v2/sports/soccer/all/teams/451/schedule?fixture=true",
      "https://site.api.espn.com/apis/site/v2/sports/soccer/all/teams/451/schedule?season=2026",
    ]);
    expect(out).toHaveLength(2);
    const cup = out.find((m) => m.externalId === "401872245")!;
    expect(cup).toMatchObject({ season: "2027", roundLabel: "@intl:asian_cup", away: { name: "Yemen", nameKo: "예멘" } });
  });
});
