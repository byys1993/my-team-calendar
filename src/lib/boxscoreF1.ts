import type { BoxScore } from "@/lib/boxscore";

// F1 기록지: 결승·스프린트는 전체 순위(출발 순위·랩·기록 또는 차이·포인트), 예선은 Q1~Q3 기록 (Jolpica)

export type F1Kind = "race" | "sprint" | "quali";

export interface F1Row {
  pos: string; // '1' … 또는 'DNF' 'DSQ' 'DNS' 'NC'
  driverId: string;
  name: string; // 영문 성 (화면에서 f1Driver 로 바꾼다)
  team: string; // 영문 팀 이름 (화면에서 f1Team)
  grid?: string;
  laps?: string;
  time?: string; // 1위는 총 기록, 나머지는 '+13.078', 랩 뒤처지면 '+1L'
  pts?: string;
  fastest?: boolean; // 패스티스트 랩
  q?: string[]; // 예선 Q1 Q2 Q3
}

export interface F1Result {
  kind: F1Kind;
  rows: F1Row[];
  fastestLap?: { driverId: string; name: string; time: string };
}

export interface JolpicaClassified {
  position: string;
  positionText?: string;
  points?: string;
  grid?: string;
  laps?: string;
  status?: string;
  Time?: { time?: string };
  FastestLap?: { rank?: string; Time?: { time?: string } };
  Q1?: string;
  Q2?: string;
  Q3?: string;
  Driver: { driverId: string; familyName: string };
  Constructor: { name: string };
}
export interface JolpicaRaceResult {
  Results?: JolpicaClassified[];
  SprintResults?: JolpicaClassified[];
  QualifyingResults?: JolpicaClassified[];
}

const NOT_CLASSIFIED: Record<string, string> = { R: "DNF", D: "DSQ", E: "DSQ", W: "DNS", F: "DNS", N: "NC" };

// 경기 ID '2026-18-race' → 시즌·라운드·세션 (Jolpica 에서 받은 경기만. OpenF1 대체 출처 ID 는 숫자뿐이라 null)
export function parseF1Ref(ref: string): { season: string; round: string; kind: F1Kind } | null {
  const m = /^(\d{4})-(\d+)-(race|sprint|quali)$/.exec(ref);
  return m ? { season: m[1], round: m[2], kind: m[3] as F1Kind } : null;
}

export function parseF1(kind: F1Kind, race: JolpicaRaceResult): BoxScore | null {
  const list = (kind === "race" ? race.Results : kind === "sprint" ? race.SprintResults : race.QualifyingResults) ?? [];
  if (list.length === 0) return null;
  const sorted = [...list].sort((a, b) => Number(a.position) - Number(b.position));
  const leaderLaps = Number(sorted[0].laps ?? 0);
  let fastestLap: F1Result["fastestLap"];
  const rows = sorted.map((x): F1Row => {
    const base = { driverId: x.Driver.driverId, name: x.Driver.familyName, team: x.Constructor.name };
    if (kind === "quali") {
      return { ...base, pos: x.position, q: [x.Q1 ?? "", x.Q2 ?? "", x.Q3 ?? ""] };
    }
    const text = x.positionText ?? x.position;
    const pos = NOT_CLASSIFIED[text] ?? x.position;
    const laps = Number(x.laps ?? 0);
    // 랩이 뒤처진 차는 출처가 이상한 차이 값을 주기도 해서 랩 수로 표시한다
    const time = NOT_CLASSIFIED[text] ? "" : laps < leaderLaps ? `+${leaderLaps - laps}L` : (x.Time?.time ?? "");
    const fastest = x.FastestLap?.rank === "1";
    if (fastest && x.FastestLap?.Time?.time) fastestLap = { ...base, time: x.FastestLap.Time.time };
    return { ...base, pos, grid: x.grid === "0" ? "PL" : x.grid, laps: x.laps, time, pts: x.points, fastest };
  });
  return { source: "jolpica", line: null, stats: [], away: [], home: [], f1: { kind, rows, fastestLap } };
}
