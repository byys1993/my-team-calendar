import type { Fetcher } from "../types";

export class SourceError extends Error {}

export function request(fetcher: Fetcher, url: string, headers: Record<string, string> = {}): Promise<Response> {
  return fetcher(url, {
    headers: { "User-Agent": "my-team-calendar (non-commercial fan project)", Accept: "application/json", ...headers },
    signal: AbortSignal.timeout(30_000),
  });
}

export async function getJson<T>(fetcher: Fetcher, url: string, headers: Record<string, string> = {}): Promise<T> {
  const res = await request(fetcher, url, headers);
  if (!res.ok) throw new SourceError(`${res.status} ${res.statusText} — ${url}`);
  return (await res.json()) as T;
}

// 유럽 축구 시즌 표기: 7월 이후 시작하면 그 해, 아니면 전년도 (예: 2027-02 → "2026")
export function europeanSeason(iso: string): string {
  const d = new Date(iso);
  const y = d.getUTCFullYear();
  return String(d.getUTCMonth() >= 6 ? y : y - 1);
}

export const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
