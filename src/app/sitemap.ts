import type { MetadataRoute } from "next";
import { getDb } from "@/lib/db";
import { sitemapEntries } from "@/lib/pages";
import { SITE_URL } from "@/lib/site";

// 검색엔진에 알려 줄 페이지 목록: 첫 화면·소개 + 모든 리그·팀 페이지 (요청할 때 DB 에서 만든다)
export const dynamic = "force-dynamic";

export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  const now = new Date();
  const { teams, leagues } = await sitemapEntries(getDb());
  return [
    { url: `${SITE_URL}/`, lastModified: now, changeFrequency: "hourly", priority: 1 },
    { url: `${SITE_URL}/about`, lastModified: now, changeFrequency: "monthly", priority: 0.5 },
    ...leagues.map((slug) => ({ url: `${SITE_URL}/league/${slug}`, lastModified: now, changeFrequency: "hourly" as const, priority: 0.8 })),
    ...teams.map((slug) => ({ url: `${SITE_URL}/team/${slug}`, lastModified: now, changeFrequency: "daily" as const, priority: 0.7 })),
    { url: `${SITE_URL}/privacy`, lastModified: now, changeFrequency: "yearly", priority: 0.2 },
  ];
}
