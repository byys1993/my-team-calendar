import { describe, expect, it } from "vitest";
import { FdThrottle } from "@/collector/sources/footballData";

function response(status: number, headers: Record<string, string>) {
  return new Response(JSON.stringify({ matches: [] }), { status, headers });
}

describe("FdThrottle", () => {
  it("남은 요청이 0이면 다음 요청 전에 초기화 시각까지 기다린다", async () => {
    let now = 0;
    const waits: number[] = [];
    const t = new FdThrottle(async (ms) => {
      waits.push(ms);
      now += ms;
    }, () => now);
    const replies = [
      response(200, { "x-requests-available-minute": "0", "x-requestcounter-reset": "42" }),
      response(200, { "x-requests-available-minute": "9", "x-requestcounter-reset": "60" }),
    ];
    const fetcher = async () => replies.shift()!;

    await t.getJson(fetcher, "https://x/1", "key");
    expect(waits).toEqual([]);
    await t.getJson(fetcher, "https://x/2", "key");
    expect(waits).toEqual([42_000]);
  });

  it("429를 받으면 초기화 후 한 번만 다시 시도한다", async () => {
    let now = 0;
    const waits: number[] = [];
    const t = new FdThrottle(async (ms) => {
      waits.push(ms);
      now += ms;
    }, () => now);
    let calls = 0;
    const fetcher = async () => {
      calls++;
      return calls === 1 ? response(429, { "x-requestcounter-reset": "30" }) : response(200, {});
    };
    await expect(t.getJson(fetcher, "https://x", "key")).resolves.toEqual({ matches: [] });
    expect(calls).toBe(2);
    expect(waits).toEqual([30_000]);

    const always429 = async () => response(429, { "x-requestcounter-reset": "1" });
    await expect(t.getJson(always429, "https://x", "key")).rejects.toThrow("429");
  });
});
