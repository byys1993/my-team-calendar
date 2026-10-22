import type { Locale } from "./config";
import { fmt, type Messages } from "./index";

// 수집기는 라운드·대진 미정·F1 세션 이름을 언어 중립 토큰으로 저장하고, 화면에서 이 함수로 그 언어로 바꾼다.
//
// 라운드 토큰: '@' 로 시작하는 조각을 '|' 로 잇는다. 예) '@stage:league|@md:3', '@series:ws|@game:5', '@lol:swiss|@bo:1'
//   @md:N  @round:N  @week:N  @game:N  @stage:<key>  @series:<key>  @playoffs[:N]  @postseason
//   @bo:N  @lol:<key>  @intl:<key>  @tbd  @t:<원문>
// '@' 로 시작하지 않으면 원문 그대로 보여준다 (ESPN 영문 비고, 관리자가 입력한 KBL 문구 등).
// F1 제목: '@f1:<영문 그랑프리 이름>:<race|qualifying|sprint>'

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

export function gpName(english: string, locale: Locale): string {
  if (locale === "ko") return GP_KO[english] ?? english.replace(/ Grand Prix/, " GP");
  return english.replace(/ Grand Prix/, " GP");
}

function segment(seg: string, m: Messages): string {
  const [kind, ...rest] = seg.slice(1).split(":");
  const arg = rest.join(":");
  const n = Number(arg);
  switch (kind) {
    case "md":
      return fmt(m.round.matchday, { n });
    case "round":
      return fmt(m.round.round, { n });
    case "week":
      return fmt(m.round.week, { n });
    case "game":
      return fmt(m.round.game, { n });
    case "stage":
      return (m.round.stage as Record<string, string>)[arg] ?? arg;
    case "series":
      return (m.round.series as Record<string, string>)[arg] ?? arg;
    case "intl":
      return (m.round.intl as Record<string, string>)[arg] ?? arg;
    case "lol":
      return (m.round.lol as Record<string, string>)[arg] ?? arg;
    case "playoffs":
      return arg ? fmt(m.round.playoffRound, { n }) : m.round.playoffs;
    case "postseason":
      return m.round.postseason;
    case "bo":
      return n === 1 ? m.round.bestOf1 : fmt(m.round.bestOf, { n, w: Math.ceil(n / 2) });
    case "tbd":
      return m.match.tbd;
    case "t":
      return arg;
    default:
      return seg;
  }
}

export function formatLabel(label: string | null | undefined, m: Messages): string | null {
  if (!label) return null;
  if (!label.startsWith("@")) return label;
  return label
    .split("|")
    .map((s) => segment(s, m))
    .join(" · ");
}

export function formatTitle(title: string | null | undefined, m: Messages, locale: Locale): string | null {
  if (!title) return null;
  const f1 = title.match(/^@f1:(.+):(race|qualifying|sprint)$/);
  if (f1) return `${gpName(f1[1], locale)} ${m.f1[f1[2] as "race" | "qualifying" | "sprint"]}`;
  return formatLabel(title, m);
}
