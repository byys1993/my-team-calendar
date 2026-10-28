// 사람이 아닌 접속(검색엔진·미리보기 로봇, 자동화 브라우저, 명령줄 도구)인지 User-Agent 로 고른다.
// 방문자 수·이용 흐름·캘린더 구독 집계에서 뺄 때 쓴다 (화면이나 캘린더 내용은 그대로 내려준다).
const BOT_UA =
  /bot|crawl|spider|slurp|yeti|daumoa|scrap|bingpreview|facebookexternalhit|embedly|preview|headless|lighthouse|pagespeed|chrome-lighthouse|vercel|curl|wget|python|node-fetch|undici|axios|go-http|java\/|okhttp|postman|insomnia|httpie|monitor|uptime|pingdom|scrapy|phantomjs|selenium|puppeteer|playwright|electron|claude/i;

export function isBot(userAgent: string | null | undefined): boolean {
  return !userAgent || BOT_UA.test(userAgent);
}
