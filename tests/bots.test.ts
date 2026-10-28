import { describe, expect, it } from "vitest";
import { isBot } from "@/lib/bots";

describe("집계에서 뺄 접속", () => {
  it("검색엔진·미리보기 로봇, 자동화 브라우저, 명령줄 도구", () => {
    for (const ua of [
      "Mozilla/5.0 AppleWebKit/537.36 (KHTML, like Gecko; compatible; Googlebot/2.1; +http://www.google.com/bot.html) Chrome/120.0 Safari/537.36",
      "Mozilla/5.0 (compatible; Yeti/1.1; +https://naver.me/spd)",
      "Mozilla/5.0 (compatible; Daumoa/4.0)",
      "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) HeadlessChrome/120.0 Safari/537.36",
      "facebookexternalhit/1.1",
      "kakaotalk-scrap/1.0",
      "curl/8.4.0",
      "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Claude/1.0 Chrome/130.0 Electron/33.0 Safari/537.36",
      "",
      null,
    ]) {
      expect(isBot(ua), String(ua)).toBe(true);
    }
  });

  it("사람의 브라우저와 캘린더 앱은 센다", () => {
    for (const ua of [
      "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36",
      "Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1",
      "Mozilla/5.0 (Linux; Android 14; SM-S921N) AppleWebKit/537.36 (KHTML, like Gecko) SamsungBrowser/26.0 Chrome/122.0 Mobile Safari/537.36",
      "Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148 KAKAOTALK 10.8.0",
      "Mozilla/5.0 (Linux; Android 14) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0 Mobile Safari/537.36 NAVER(inapp; search; 1000; 12.0.0)",
      "Mozilla/5.0 (Linux; Android 14) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0 Mobile Safari/537.36 DaumApps/8.0",
      "Google-Calendar-Importer",
      "iOS/18.0 (22A3354) dataaccessd/1.0",
      "Mac OS X/15.0 (24A335) CalendarAgent/1000",
    ]) {
      expect(isBot(ua), ua).toBe(false);
    }
  });
});
