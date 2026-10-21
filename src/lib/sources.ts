// 사이트 하단 출처 표기. football-data.org 는 약관상 이 문구 표기가 의무다.
export const SOURCE_CREDITS: Record<string, { label: string; url: string; text: string }> = {
  "football-data": {
    label: "football-data.org",
    url: "https://www.football-data.org/",
    text: "Football data provided by the Football-Data.org API",
  },
  espn: {
    label: "ESPN",
    url: "https://www.espn.com/",
    text: "일부 일정 정보: ESPN",
  },
};

export const SOURCE_LABEL = (source: string | null) => (source ? (SOURCE_CREDITS[source]?.label ?? source) : "—");
