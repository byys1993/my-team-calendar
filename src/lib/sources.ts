// 사이트 하단 출처 표기. 한국어 화면은 ko, 그 외 언어는 en 문구를 쓴다 (출처 이름은 고유명사라 영어로 둔다).
// football-data.org 는 약관상 영어 문구 표기가 의무, Jolpica 데이터는 CC BY-NC-SA 4.0 이라 출처·라이선스 표기가 필요하다.
export const SOURCE_CREDITS: Record<string, { label: string; url: string; text: { ko: string; en: string } }> = {
  "football-data": {
    label: "football-data.org",
    url: "https://www.football-data.org/",
    text: {
      ko: "Football data provided by the Football-Data.org API",
      en: "Football data provided by the Football-Data.org API",
    },
  },
  jolpica: {
    label: "Jolpica F1",
    url: "https://github.com/jolpica/jolpica-f1",
    text: { ko: "F1 일정: Jolpica F1 API (CC BY-NC-SA 4.0)", en: "F1 schedule: Jolpica F1 API (CC BY-NC-SA 4.0)" },
  },
  openf1: {
    label: "OpenF1",
    url: "https://openf1.org/",
    text: { ko: "F1 일정(대체): OpenF1", en: "F1 schedule (fallback): OpenF1" },
  },
  mlb: {
    label: "MLB",
    url: "https://www.mlb.com/",
    text: { ko: "MLB 일정: © MLB Advanced Media, L.P.", en: "MLB schedule: © MLB Advanced Media, L.P." },
  },
  nhl: {
    label: "NHL",
    url: "https://www.nhl.com/",
    text: { ko: "NHL 일정: NHL.com", en: "NHL schedule: NHL.com" },
  },
  lolesports: {
    label: "LoL Esports",
    url: "https://lolesports.com/",
    text: { ko: "LoL 일정: LoL Esports (Riot Games)", en: "LoL schedule: LoL Esports (Riot Games)" },
  },
  kbo: {
    label: "KBO",
    url: "https://www.koreabaseball.com/",
    text: { ko: "KBO 리그 일정: KBO 공식 홈페이지", en: "KBO League schedule: KBO official website" },
  },
  kbl: {
    label: "KBL",
    url: "https://www.kbl.or.kr/",
    text: { ko: "KBL 일정: KBL 공식 홈페이지", en: "KBL schedule: KBL official website" },
  },
  kleague: {
    label: "K League",
    url: "https://www.kleague.com/",
    text: { ko: "K리그 일정: K리그 공식 홈페이지", en: "K League schedule: K League official website" },
  },
  espn: {
    label: "ESPN",
    url: "https://www.espn.com/",
    text: {
      ko: "NBA·NFL·국가대표 일정 및 일부 대체 정보: ESPN",
      en: "NBA/NFL/national team schedules and some fallback data: ESPN",
    },
  },
};

export const SOURCE_LABEL = (source: string | null) => (source ? (SOURCE_CREDITS[source]?.label ?? source) : "—");
