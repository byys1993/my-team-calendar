import { afterEach, describe, expect, it } from "vitest";
import { turnstileSiteKey, verifyTurnstile } from "@/lib/auth/turnstile";

const env = { ...process.env };
afterEach(() => {
  process.env = { ...env };
});

describe("Turnstile 사람 확인", () => {
  it("키가 없으면 꺼져 있고 그냥 통과한다", async () => {
    delete process.env.TURNSTILE_SITE_KEY;
    delete process.env.TURNSTILE_SECRET_KEY;
    expect(turnstileSiteKey()).toBeNull();
    expect(await verifyTurnstile(undefined, null)).toBe(true);
  });

  it("키가 있으면 토큰을 Cloudflare 에 확인한다", async () => {
    process.env.TURNSTILE_SITE_KEY = "site";
    process.env.TURNSTILE_SECRET_KEY = "secret";
    expect(turnstileSiteKey()).toBe("site");
    const bodies: string[] = [];
    const fetcher = (async (_url: string, init?: RequestInit) => {
      bodies.push(String(init?.body));
      const ok = String(init?.body).includes("response=good");
      return new Response(JSON.stringify({ success: ok }));
    }) as typeof fetch;
    expect(await verifyTurnstile("good", "1.2.3.4", fetcher)).toBe(true);
    expect(bodies[0]).toBe("secret=secret&response=good&remoteip=1.2.3.4");
    expect(await verifyTurnstile("bad", null, fetcher)).toBe(false);
    expect(await verifyTurnstile("", null, fetcher)).toBe(false);
    expect(await verifyTurnstile(undefined, null, fetcher)).toBe(false);
    // Cloudflare 가 응답하지 않으면 막는다
    const broken = (async () => {
      throw new Error("down");
    }) as typeof fetch;
    expect(await verifyTurnstile("good", null, broken)).toBe(false);
  });
});
