// 사이트 하단 출처 표기.
// football-data.org 는 약관상 이 문구가 의무, Jolpica 데이터는 CC BY-NC-SA 4.0 이라 출처·라이선스 표기가 필요하다.
export const SOURCE_CREDITS: Record<string, { label: string; url: string; text: string }> = {
  "football-data": {
    label: "football-data.org",
    url: "https://www.football-data.org/",
    text: "Football data provided by the Football-Data.org API",
  },
  jolpica: {
    label: "Jolpica F1",
    url: "https://github.com/jolpica/jolpica-f1",
    text: "F1 일정: Jolpica F1 API (CC BY-NC-SA 4.0)",
  },
  openf1: {
    label: "OpenF1",
    url: "https://openf1.org/",
    text: "F1 일정(대체): OpenF1",
  },
  mlb: {
    label: "MLB",
    url: "https://www.mlb.com/",
    text: "MLB 일정: © MLB Advanced Media, L.P.",
  },
  nhl: {
    label: "NHL",
    url: "https://www.nhl.com/",
    text: "NHL 일정: NHL.com",
  },
  lolesports: {
    label: "LoL Esports",
    url: "https://lolesports.com/",
    text: "LoL 일정: LoL Esports (Riot Games)",
  },
  kbo: {
    label: "KBO",
    url: "https://www.koreabaseball.com/",
    text: "KBO 리그 일정: KBO 공식 홈페이지",
  },
  manual: {
    label: "수동 입력",
    url: "https://www.kbl.or.kr/",
    text: "KBL 일정: KBL 발표 일정을 운영자가 직접 입력",
  },
  espn: {
    label: "ESPN",
    url: "https://www.espn.com/",
    text: "NBA·NFL 일정 및 일부 대체 정보: ESPN",
  },
};

export const SOURCE_LABEL = (source: string | null) => (source ? (SOURCE_CREDITS[source]?.label ?? source) : "—");
