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

// 출처가 잠깐 막혔을 때(요청 과다 429·서버 오류 5xx·연결 실패) 잠시 기다렸다 다시 시도한다.
// 400·404 같은 요청 자체의 문제나 30초 시간 초과는 다시 해도 같으므로 바로 실패시킨다.
export async function getJsonRetry<T>(
  fetcher: Fetcher,
  url: string,
  opts: { retries?: number; waitMs?: number; headers?: Record<string, string> } = {},
): Promise<T> {
  const retries = opts.retries ?? 1;
  const waitMs = opts.waitMs ?? 5_000;
  for (let attempt = 0; ; attempt++) {
    let res: Response;
    try {
      res = await request(fetcher, url, opts.headers);
    } catch (err) {
      const timedOut = err instanceof Error && (err.name === "TimeoutError" || err.name === "AbortError");
      if (timedOut || attempt >= retries) throw err;
      await sleep(waitMs);
      continue;
    }
    if (res.ok) return (await res.json()) as T;
    const transient = res.status === 429 || res.status >= 500;
    if (!transient || attempt >= retries) throw new SourceError(`${res.status} ${res.statusText} — ${url}`);
    await sleep(waitMs);
  }
}

// 유럽 축구 시즌 표기: 7월 이후 시작하면 그 해, 아니면 전년도 (예: 2027-02 → "2026")
export function europeanSeason(iso: string): string {
  const d = new Date(iso);
  const y = d.getUTCFullYear();
  return String(d.getUTCMonth() >= 6 ? y : y - 1);
}

export const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
