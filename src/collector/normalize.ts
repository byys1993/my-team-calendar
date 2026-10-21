// 소스마다 다른 팀 표기("Arsenal FC", "AFC Bournemouth", "Brighton & Hove Albion")를
// 비교 가능한 형태로 바꾼다. 자동 매칭 후보를 찾을 때만 쓰고, 저장은 소스 ID 기준이다.
const NOISE_TOKENS = new Set(["fc", "afc", "cf", "sc", "ac", "the"]);

export function normalizeName(name: string): string {
  return name
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/&/g, " and ")
    .replace(/[^a-z0-9 ]+/g, " ")
    .split(/\s+/)
    .filter((tok) => tok && !NOISE_TOKENS.has(tok))
    .join(" ");
}
