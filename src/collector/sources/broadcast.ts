// 공식 일정 데이터의 중계 표기를 사람이 읽는 이름으로 맞춘다.

// KBO 일정표 TV 칸의 약어
const KBO_TV: Record<string, string> = {
  "SPO-T": "SPOTV",
  "SPO-2T": "SPOTV2",
  "SS-T": "SBS Sports",
  "KN-T": "KBS N SPORTS",
  "MS-T": "MBC SPORTS+",
  "K-1T": "KBS1",
  "K-2T": "KBS2",
  "M-T": "MBC",
  "S-T": "SBS",
};

const NAME: Record<string, string> = {
  COUPANGPLAY: "쿠팡플레이",
  "COUPANG PLAY": "쿠팡플레이",
};

// 'A//B', 'A, B', 'A/B' 같은 표기를 'A, B' 로 (빈 값이면 null)
export function normalizeBroadcast(raw: string | null | undefined, codes: Record<string, string> = {}): string | null {
  if (!raw) return null;
  const names = raw
    .split(/\/+|,|·/)
    .map((s) => s.trim())
    .filter(Boolean)
    .map((s) => codes[s] ?? NAME[s.toUpperCase()] ?? s.replace(/-\d?T$/, ""));
  const unique = [...new Set(names)];
  return unique.length ? unique.join(", ") : null;
}

export const kboBroadcast = (raw: string | null | undefined) => normalizeBroadcast(raw, KBO_TV);
