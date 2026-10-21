import { CalendarApp } from "@/components/CalendarApp";
import { getDb } from "@/lib/db";
import { getCatalog } from "@/lib/schedule";

// 팀·대회 목록과 '마지막 업데이트'는 5분마다 다시 읽는다
export const revalidate = 300;

export default async function Home() {
  const catalog = await getCatalog(getDb());
  return <CalendarApp catalog={catalog} />;
}
