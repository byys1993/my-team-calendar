import { describe, expect, it } from "vitest";
import { getJsonRetry } from "../src/collector/sources/http";
import type { Fetcher } from "../src/collector/types";

function seq(responses: (Response | Error)[]) {
  const calls: string[] = [];
  const fetcher: Fetcher = async (url) => {
    calls.push(String(url));
    const r = responses.shift();
    if (!r) throw new Error("no more responses");
    if (r instanceof Error) throw r;
    return r;
  };
  return { fetcher, calls };
}

const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status });

describe("getJsonRetry", () => {
  it("429 뒤에 한 번 더 시도해 성공한다", async () => {
    const { fetcher, calls } = seq([json({}, 429), json({ ok: 1 })]);
    await expect(getJsonRetry(fetcher, "https://x/a", { waitMs: 0 })).resolves.toEqual({ ok: 1 });
    expect(calls).toHaveLength(2);
  });

  it("5xx 뒤에도 다시 시도한다", async () => {
    const { fetcher } = seq([json({}, 530), json({ ok: 2 })]);
    await expect(getJsonRetry(fetcher, "https://x/a", { waitMs: 0 })).resolves.toEqual({ ok: 2 });
  });

  it("연결 실패 뒤에도 다시 시도한다", async () => {
    const { fetcher } = seq([new TypeError("fetch failed"), json({ ok: 3 })]);
    await expect(getJsonRetry(fetcher, "https://x/a", { waitMs: 0 })).resolves.toEqual({ ok: 3 });
  });

  it("재시도도 실패하면 오류를 낸다", async () => {
    const { fetcher, calls } = seq([json({}, 429), json({}, 429)]);
    await expect(getJsonRetry(fetcher, "https://x/a", { waitMs: 0 })).rejects.toThrow("429");
    expect(calls).toHaveLength(2);
  });

  it("404 는 다시 시도하지 않는다", async () => {
    const { fetcher, calls } = seq([json({}, 404)]);
    await expect(getJsonRetry(fetcher, "https://x/a", { waitMs: 0 })).rejects.toThrow("404");
    expect(calls).toHaveLength(1);
  });

  it("시간 초과는 다시 시도하지 않는다", async () => {
    const timeout = new DOMException("timed out", "TimeoutError");
    const { fetcher, calls } = seq([timeout as unknown as Error]);
    await expect(getJsonRetry(fetcher, "https://x/a", { waitMs: 0 })).rejects.toThrow();
    expect(calls).toHaveLength(1);
  });
});
