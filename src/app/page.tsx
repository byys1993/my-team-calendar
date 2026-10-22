import { unstable_cache } from "next/cache";
import { CalendarApp } from "@/components/CalendarApp";
import { getDb } from "@/lib/db";
import { getCatalog } from "@/lib/schedule";

// 빌드 때 DB에 접속하지 않도록 요청 시점에 그리고, 팀·대회 목록과 '마지막 업데이트'는 5분 캐시한다.
// (관리자에서 팀 이름을 고치면 'catalog' 태그로 바로 비운다)
export const dynamic = "force-dynamic";

const cachedCatalog = unstable_cache(() => getCatalog(getDb()), ["catalog"], { revalidate: 300, tags: ["catalog"] });

export default async function Home() {
  return <CalendarApp catalog={await cachedCatalog()} />;
}
