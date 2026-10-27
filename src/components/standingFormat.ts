// 순위표 칸·값 표기 (순위 탭과 리그 페이지가 함께 쓴다)

export type StatKey = "gp" | "w" | "d" | "l" | "otl" | "pts" | "gf" | "ga" | "gd" | "pct" | "gb" | "wins" | "value";
// 순위표 칸 (개인 순위의 value 는 칸이 아니다)
export type ColKey = Exclude<StatKey, "value">;

// 종목별로 보여 줄 칸 (모든 줄이 비어 있는 칸은 숨긴다)
export const COLUMNS: Record<string, ColKey[]> = {
  soccer: ["gp", "w", "d", "l", "gd", "pts"],
  baseball: ["gp", "w", "l", "d", "pct", "gb"],
  basketball: ["gp", "w", "l", "pct", "gb"],
  "american-football": ["w", "l", "d", "pct", "gb"],
  hockey: ["gp", "w", "l", "otl", "pts"],
  esports: ["w", "l"],
  motorsport: ["wins", "pts"],
};

export function format(key: StatKey, v: number | string | null | undefined): string {
  if (v == null || v === "") return "";
  if (typeof v === "string") return v;
  if (key === "pct") return v.toFixed(3);
  if (key === "gd" && v > 0) return `+${v}`;
  if (key === "gb" && v === 0) return "-";
  return String(v);
}

// 출처가 영어로 주는 조·지구 이름의 한국어 표기
export const GROUP_KO: Record<string, string> = {
  "American League East": "AL 동부",
  "American League Central": "AL 중부",
  "American League West": "AL 서부",
  "National League East": "NL 동부",
  "National League Central": "NL 중부",
  "National League West": "NL 서부",
  "Eastern Conference": "동부 콘퍼런스",
  "Western Conference": "서부 콘퍼런스",
  Eastern: "동부 콘퍼런스",
  Western: "서부 콘퍼런스",
  "American Football Conference": "AFC",
  "National Football Conference": "NFC",
  "League Phase": "리그 페이즈",
};
