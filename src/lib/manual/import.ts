import { upsertMatches } from "@/collector/upsert";
import type { MatchStatus, SourceMatch } from "@/collector/types";
import type { Db } from "@/lib/db";
import { parseCsv } from "./csv";

// KBO·KBL 일정 CSV. 시각은 모두 한국 시간(KST)으로 적는다.
// 같은 game_key 로 다시 올리면 같은 경기(같은 고유 ID)로 보고 내용만 고친다.
export const COLUMNS = [
  "game_key",
  "league",
  "date",
  "time",
  "home",
  "away",
  "status",
  "round",
  "home_placeholder",
  "away_placeholder",
  "venue",
] as const;
type Column = (typeof COLUMNS)[number];

const HEADER_ALIASES: Record<string, Column> = {
  경기키: "game_key",
  리그: "league",
  날짜: "date",
  시간: "time",
  홈: "home",
  원정: "away",
  상태: "status",
  라운드: "round",
  홈미정표시: "home_placeholder",
  원정미정표시: "away_placeholder",
  구장: "venue",
};

export const STATUS_INPUT: Record<string, MatchStatus> = {
  확정: "scheduled",
  scheduled: "scheduled",
  미정: "time_tbd",
  시간미정: "time_tbd",
  time_tbd: "time_tbd",
  진출시: "conditional",
  conditional: "conditional",
  추첨대기: "draw_pending",
  대진미정: "draw_pending",
  draw_pending: "draw_pending",
  연기: "postponed",
  우천취소: "postponed",
  postponed: "postponed",
  취소: "cancelled",
  cancelled: "cancelled",
};

export interface ManualTeam {
  slug: string;
  name_ko: string;
  short_ko: string | null;
  name_en: string;
  aliases: string[];
}

export interface ManualCompetition {
  id: number;
  slug: string; // 'kbo' | 'kbl'
  teams: ManualTeam[];
}

export interface ImportError {
  line: number;
  message: string;
}

export interface ParsedImport {
  byCompetition: Map<number, SourceMatch[]>;
  rows: number;
  errors: ImportError[];
}

const norm = (s: string) => s.replace(/\s+/g, "").toLowerCase();

// 'LG', 'LG 트윈스', 'kbo-lg', 'lg' 처럼 여러 표기를 팀 slug 로 바꾸는 표
export function teamLookup(c: ManualCompetition): Map<string, string> {
  const map = new Map<string, string>();
  for (const t of c.teams) {
    const suffix = t.slug.replace(`${c.slug}-`, "");
    for (const label of [t.slug, suffix, t.name_ko, t.short_ko, t.name_en, ...t.aliases]) {
      if (label) map.set(norm(label), t.slug);
    }
  }
  return map;
}

export function normalizeDate(input: string): string | null {
  const m = input.trim().match(/^(\d{4})[-./](\d{1,2})[-./](\d{1,2})\.?$/);
  if (!m) return null;
  const [, y, mo, d] = m;
  const iso = `${y}-${mo.padStart(2, "0")}-${d.padStart(2, "0")}`;
  const date = new Date(`${iso}T00:00:00Z`);
  return date.getUTCMonth() + 1 === Number(mo) && date.getUTCDate() === Number(d) ? iso : null;
}

export function normalizeTime(input: string): string | null | undefined {
  const s = input.trim();
  if (!s) return null; // 시간 미정
  const m = s.match(/^(\d{1,2}):(\d{2})(?::\d{2})?$/);
  if (!m || Number(m[1]) > 23 || Number(m[2]) > 59) return undefined; // 형식 오류
  return `${m[1].padStart(2, "0")}:${m[2]}`;
}

// KBO 는 연도, KBL 처럼 가을에 시작하는 리그는 '2026-27'
export function seasonOf(league: string, date: string): string {
  const y = Number(date.slice(0, 4));
  if (league !== "kbl") return String(y);
  const start = Number(date.slice(5, 7)) >= 8 ? y : y - 1;
  return `${start}-${String(start + 1).slice(2)}`;
}

export function kstToUtc(date: string, time: string): string {
  return new Date(`${date}T${time}:00+09:00`).toISOString();
}

export interface ManualRow {
  gameKey: string;
  league: string; // competition slug
  date: string;
  time: string | null;
  home: string | null; // team slug
  away: string | null;
  status: MatchStatus;
  round: string | null;
  homePlaceholder: string | null;
  awayPlaceholder: string | null;
  venue: string | null;
}

// 화면 입력과 CSV 가 같은 규칙으로 SourceMatch 를 만든다
export function toSourceMatch(r: ManualRow): SourceMatch {
  // 시간이 없으면 '확정'이어도 시간 미정으로 본다
  const status = !r.time && r.status === "scheduled" ? "time_tbd" : r.status;
  return {
    externalId: `${r.league}:${r.gameKey}`,
    season: seasonOf(r.league, r.date),
    roundLabel: r.round,
    home: r.home ? { externalId: r.home, name: r.home } : null,
    away: r.away ? { externalId: r.away, name: r.away } : null,
    homePlaceholder: r.home ? null : (r.homePlaceholder ?? "@tbd"),
    awayPlaceholder: r.away ? null : (r.awayPlaceholder ?? "@tbd"),
    startAt: r.time ? kstToUtc(r.date, r.time) : null,
    dateOnly: r.time ? null : r.date,
    status,
    venue: r.venue,
  };
}

export function parseImport(text: string, competitions: ManualCompetition[]): ParsedImport {
  const result: ParsedImport = { byCompetition: new Map(), rows: 0, errors: [] };
  const rows = parseCsv(text);
  if (rows.length === 0) {
    result.errors.push({ line: 1, message: "내용이 없습니다." });
    return result;
  }
  const [header, ...body] = rows;
  const index = new Map<Column, number>();
  header.cells.forEach((h, i) => {
    const key = h.trim().toLowerCase().replace(/\s+/g, "");
    const col = (COLUMNS as readonly string[]).includes(key) ? (key as Column) : HEADER_ALIASES[h.trim().replace(/\s+/g, "")];
    if (col) index.set(col, i);
  });
  for (const required of ["game_key", "league", "date"] as const) {
    if (!index.has(required)) result.errors.push({ line: header.line, message: `필수 열이 없습니다: ${required}` });
  }
  if (result.errors.length) return result;

  const comps = new Map(competitions.map((c) => [c.slug, { comp: c, teams: teamLookup(c) }]));
  const seenKeys = new Set<string>();

  for (const { line, cells } of body) {
    const get = (c: Column) => (index.has(c) ? (cells[index.get(c)!] ?? "").trim() : "");
    const err = (message: string) => result.errors.push({ line, message });
    const errorsBefore = result.errors.length;

    const gameKey = get("game_key");
    const leagueInput = get("league").toLowerCase();
    const entry = comps.get(leagueInput);
    if (!gameKey) err("game_key 가 비어 있습니다.");
    else if (!/^[\w가-힣-]+$/.test(gameKey)) err(`game_key 에는 글자·숫자·-·_ 만 쓸 수 있습니다: ${gameKey}`);
    if (!entry) err(`리그는 ${[...comps.keys()].map((k) => k.toUpperCase()).join(" 또는 ")} 이어야 합니다: ${get("league")}`);
    const uniqueKey = `${leagueInput}:${gameKey}`;
    if (gameKey && seenKeys.has(uniqueKey)) err(`같은 game_key 가 파일 안에 두 번 있습니다: ${gameKey}`);
    seenKeys.add(uniqueKey);

    const date = normalizeDate(get("date"));
    if (!date) err(`날짜 형식이 올바르지 않습니다 (예: 2027-03-28): ${get("date")}`);
    const time = normalizeTime(get("time"));
    if (time === undefined) err(`시간 형식이 올바르지 않습니다 (예: 18:30, 비우면 시간 미정): ${get("time")}`);

    const statusInput = get("status").replace(/\s+/g, "").toLowerCase();
    const status = statusInput ? STATUS_INPUT[statusInput] : "scheduled";
    if (!status) err(`상태는 확정·미정·진출시·추첨대기·연기·취소 중 하나여야 합니다: ${get("status")}`);

    const resolveTeam = (col: "home" | "away") => {
      const label = get(col);
      if (!label) return null;
      const slug = entry?.teams.get(norm(label));
      if (!slug && entry) err(`${col === "home" ? "홈" : "원정"} 팀을 찾을 수 없습니다: ${label}`);
      return slug ?? null;
    };
    const home = resolveTeam("home");
    const away = resolveTeam("away");
    if (!get("home") && !get("away")) err("홈·원정 중 적어도 한 팀은 있어야 합니다 (상대가 미정이면 미정표시 열을 쓰세요).");
    if (home && home === away) err("홈과 원정이 같은 팀입니다.");

    if (result.errors.length > errorsBefore || !entry || !date || time === undefined || !status) continue;
    const list = result.byCompetition.get(entry.comp.id) ?? [];
    list.push(
      toSourceMatch({
        gameKey,
        league: entry.comp.slug,
        date,
        time,
        home,
        away,
        status,
        round: get("round") || null,
        homePlaceholder: get("home_placeholder") || null,
        awayPlaceholder: get("away_placeholder") || null,
        venue: get("venue") || null,
      }),
    );
    result.byCompetition.set(entry.comp.id, list);
    result.rows++;
  }
  return result;
}

export async function loadManualCompetitions(db: Db): Promise<ManualCompetition[]> {
  const comps = await db.query<{ id: number; slug: string }>(
    "select id, slug from competition where feed = 'manual' order by display_order, id",
  );
  const teams = await db.query<ManualTeam & { competition_id: number }>(
    `select slug, name_ko, short_ko, name_en, aliases, primary_competition_id as competition_id
     from team where primary_competition_id = any(string_to_array($1, ',')::int[])`,
    [comps.map((c) => c.id).join(",")],
  );
  return comps.map((c) => ({ ...c, teams: teams.filter((t) => t.competition_id === c.id) }));
}

// 수동 입력 내용을 저장하고, 수집 기록과 '마지막 업데이트'를 남긴다.
export async function saveManualMatches(db: Db, competitionId: number, matches: SourceMatch[]) {
  return db.tx(async (t) => {
    const r = await upsertMatches(t, competitionId, "manual", matches);
    await t.query(
      `insert into sync_run (competition_id, source, finished_at, ok, fetched, inserted, updated, skipped)
       values ($1, 'manual', now(), true, $2, $3, $4, $5)`,
      [competitionId, matches.length, r.inserted, r.updated, r.skipped],
    );
    await t.query(
      `insert into competition_status (competition_id, last_attempt_at, last_success_at, last_full_at, last_source)
       values ($1, now(), now(), now(), 'manual')
       on conflict (competition_id) do update set last_attempt_at = now(), last_success_at = now(),
         last_full_at = now(), last_source = 'manual'`,
      [competitionId],
    );
    return r;
  });
}
