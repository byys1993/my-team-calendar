import type { MetadataRoute } from "next";
import { SITE_URL } from "@/lib/site";

// 검색엔진에 알려 줄 페이지 목록 (팀·리그별 페이지를 만들면 여기에 더한다)
export default function sitemap(): MetadataRoute.Sitemap {
  const now = new Date();
  return [
    { url: `${SITE_URL}/`, lastModified: now, changeFrequency: "hourly", priority: 1 },
    { url: `${SITE_URL}/about`, lastModified: now, changeFrequency: "monthly", priority: 0.6 },
    { url: `${SITE_URL}/privacy`, lastModified: now, changeFrequency: "yearly", priority: 0.2 },
  ];
}
