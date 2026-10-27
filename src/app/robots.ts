import type { MetadataRoute } from "next";
import { SITE_URL } from "@/lib/site";

// 검색엔진·AI 검색 수집기 모두 허용 (관리자·API·수신 거부 화면만 제외)
export default function robots(): MetadataRoute.Robots {
  return {
    rules: [{ userAgent: "*", allow: "/", disallow: ["/admin", "/api/", "/unsubscribe"] }],
    sitemap: `${SITE_URL}/sitemap.xml`,
    host: SITE_URL,
  };
}
