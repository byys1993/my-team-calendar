// 팀 색상표. 선택 목록에는 이 배열의 번호(color)만 저장하므로 번호의 뜻을 함부로 바꾸지 않는다.
// (2026-10 색상표 교체 때도 예전 번호가 비슷한 색을 가리키도록 맞췄다: 0 파랑, 1 빨강, 2 초록 …)
export const PALETTE = [
  "#204E9C", // 0 파랑
  "#D42E26", // 1 빨강
  "#316E44", // 2 초록
  "#EDB94E", // 3 머스타드
  "#531F82", // 4 보라
  "#D32D63", // 5 진분홍
  "#7DC3EE", // 6 하늘
  "#FDF04F", // 7 노랑
  "#636363", // 8 회색
  "#DA6B2A", // 9 주황
  "#22296C", // 10 남색
  "#7D1623", // 11 와인
  "#489C88", // 12 청록
  "#DFCC9A", // 13 베이지
  "#B7A5CB", // 14 라벤더
  "#000000", // 15 검정
  "#D84A27", // 16 다홍
  "#E6A8C6", // 17 연분홍
  "#FFFFFF", // 18 흰색
  "#B4B4B5", // 19 연회색
] as const;

// 색 고르기 창에 보여 줄 순서 (5칸씩 4줄: 무채색·베이지 / 빨강·보라 계열 / 파랑·초록 계열 / 주황·노랑·분홍)
export const PICKER_ORDER = [18, 15, 8, 19, 13, 1, 11, 5, 14, 4, 0, 10, 6, 2, 12, 16, 9, 3, 7, 17] as const;

// 밝은 색(흰색·노랑 등)은 흰 바탕에서 글자·테두리가 안 보이고, 검정은 어두운 화면에서 안 보이므로
// 글자·테두리에는 따로 정한 진한 색을 쓴다. 흰색·검정은 화면 글자색(--text)을 따라가게 한다.
const INK: Partial<Record<number, string>> = {
  3: "#B98A22",
  6: "#3A8FC6",
  7: "#B3A100",
  13: "#A68C4E",
  14: "#8A70AE",
  15: "var(--text)",
  17: "#C26896",
  18: "var(--text)",
  19: "#808082",
};

export const teamInk = (i: number) => INK[i] ?? PALETTE[i] ?? PALETTE[0];

// 화면 요소에 붙이는 CSS 변수: --team(채우기), --team-ink(글자·테두리)
export const teamVars = (i: number) =>
  ({ "--team": PALETTE[i] ?? PALETTE[0], "--team-ink": teamInk(i) }) as Record<string, string>;

export const isPaletteIndex = (n: unknown): n is number =>
  typeof n === "number" && Number.isInteger(n) && n >= 0 && n < PALETTE.length;
