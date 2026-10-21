import type { Fetcher, SourceAdapter, SourceMatch, SourceTeam } from "../types";
import { getJson } from "./http";

// F1은 팀 대신 '시리즈' 하나(시드의 f1 팀)를 선택하고, 그랑프리의 결승·예선·스프린트를 이벤트로 저장한다.
const SERIES: SourceTeam = { externalId: "f1", name: "Formula 1" };

const GP_KO: Record<string, string> = {
  "Australian Grand Prix": "호주 GP",
  "Chinese Grand Prix": "중국 GP",
  "Japanese Grand Prix": "일본 GP",
  "Bahrain Grand Prix": "바레인 GP",
  "Bahrain Grand Prix in Malaysia": "바레인 GP (말레이시아 개최)",
  "Saudi Arabian Grand Prix": "사우디아라비아 GP",
  "Miami Grand Prix": "마이애미 GP",
  "Emilia Romagna Grand Prix": "에밀리아로마냐 GP",
  "Canadian Grand Prix": "캐나다 GP",
  "Monaco Grand Prix": "모나코 GP",
  "Barcelona Grand Prix": "바르셀로나 GP",
  "Spanish Grand Prix": "스페인 GP",
  "Austrian Grand Prix": "오스트리아 GP",
  "British Grand Prix": "영국 GP",
  "Belgian Grand Prix": "벨기에 GP",
  "Hungarian Grand Prix": "헝가리 GP",
  "Dutch Grand Prix": "네덜란드 GP",
  "Italian Grand Prix": "이탈리아 GP",
  "Azerbaijan Grand Prix": "아제르바이잔 GP",
  "Malaysian Grand Prix": "말레이시아 GP",
  "Singapore Grand Prix": "싱가포르 GP",
  "United States Grand Prix": "미국 GP",
  "Mexico City Grand Prix": "멕시코시티 GP",
  "Brazilian Grand Prix": "브라질 GP",
  "São Paulo Grand Prix": "상파울루 GP",
  "Las Vegas Grand Prix": "라스베이거스 GP",
  "Qatar Grand Prix": "카타르 GP",
  "Abu Dhabi Grand Prix": "아부다비 GP",
  "Portuguese Grand Prix": "포르투갈 GP",
};

export const gpKo = (name: string) => GP_KO[name] ?? name.replace(/ Grand Prix/, " GP");

const SESSION_KO = { race: "결승", quali: "예선", sprint: "스프린트" } as const;
type SessionKind = keyof typeof SESSION_KO;

// --- Jolpica (Ergast 호환) https://github.com/jolpica/jolpica-f1
interface JolpicaSession {
  date: string;
  time?: string;
}
interface JolpicaRace extends JolpicaSession {
  season: string;
  round: string;
  raceName: string;
  Circuit: { circuitName: string };
  Qualifying?: JolpicaSession;
  Sprint?: JolpicaSession;
}

function session(race: JolpicaRace, kind: SessionKind, s: JolpicaSession): SourceMatch {
  const hasTime = !!s.time;
  return {
    externalId: `${race.season}-${race.round}-${kind}`,
    season: race.season,
    roundLabel: `${race.round}라운드`,
    title: `${gpKo(race.raceName)} ${SESSION_KO[kind]}`,
    home: SERIES,
    away: null,
    startAt: hasTime ? new Date(`${s.date}T${s.time}`).toISOString() : null,
    dateOnly: hasTime ? null : s.date,
    status: hasTime ? "scheduled" : "time_tbd",
    venue: race.Circuit.circuitName,
  };
}

export function parseJolpica(races: JolpicaRace[]): SourceMatch[] {
  return races.flatMap((r) => [
    session(r, "race", r),
    ...(r.Qualifying ? [session(r, "quali", r.Qualifying)] : []),
    ...(r.Sprint ? [session(r, "sprint", r.Sprint)] : []),
  ]);
}

export function jolpica(fetcher: Fetcher = fetch): SourceAdapter {
  return {
    source: "jolpica",
    async fetchMatches(season) {
      const json = await getJson<{ MRData: { RaceTable: { Races: JolpicaRace[] } } }>(
        fetcher,
        `https://api.jolpi.ca/ergast/f1/${encodeURIComponent(season)}/races/?limit=100`,
      );
      return parseJolpica(json.MRData.RaceTable.Races);
    },
  };
}

// --- OpenF1 https://openf1.org (키 없이 일정 조회 가능, 초당 3회)
interface OpenF1Session {
  session_key: number;
  session_name: string;
  date_start: string;
  meeting_key: number;
  circuit_short_name: string;
  year: number;
  is_cancelled?: boolean;
}
interface OpenF1Meeting {
  meeting_key: number;
  meeting_name: string;
}

const OPENF1_KIND: Record<string, SessionKind> = { Race: "race", Qualifying: "quali", Sprint: "sprint" };

export function parseOpenF1(sessions: OpenF1Session[], meetings: OpenF1Meeting[]): SourceMatch[] {
  const names = new Map(meetings.map((m) => [m.meeting_key, m.meeting_name]));
  return sessions
    .filter((s) => OPENF1_KIND[s.session_name])
    .map((s) => {
      const kind = OPENF1_KIND[s.session_name];
      const meeting = names.get(s.meeting_key) ?? s.circuit_short_name;
      return {
        externalId: String(s.session_key),
        season: String(s.year),
        title: `${gpKo(meeting)} ${SESSION_KO[kind]}`,
        home: SERIES,
        away: null,
        startAt: new Date(s.date_start).toISOString(),
        status: s.is_cancelled ? "cancelled" : "scheduled",
        venue: s.circuit_short_name,
      };
    });
}

export function openF1(fetcher: Fetcher = fetch, now = () => new Date()): SourceAdapter {
  return {
    source: "openf1",
    async fetchMatches() {
      // 시즌 막바지에는 다음 시즌 일정이 먼저 올라오기도 하므로 올해와 내년을 함께 본다
      const year = now().getUTCFullYear();
      const result: SourceMatch[] = [];
      for (const y of [year, year + 1]) {
        const sessions = await getJson<OpenF1Session[]>(fetcher, `https://api.openf1.org/v1/sessions?year=${y}`);
        if (sessions.length === 0) continue;
        const meetings = await getJson<OpenF1Meeting[]>(fetcher, `https://api.openf1.org/v1/meetings?year=${y}`);
        result.push(...parseOpenF1(sessions, meetings));
      }
      return result;
    },
  };
}
