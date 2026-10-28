// 임시 점검: 관리자 현황 화면의 조회별 걸린 시간만 돌려준다 (데이터 내용은 내보내지 않음). 확인 후 삭제.
import { getDb } from "@/lib/db";
import { funnel } from "@/lib/events";
import { getIcsStats } from "@/lib/icsStats";
import { adminOverview } from "@/lib/manual/admin";
import { getStats } from "@/lib/visitors";

export const dynamic = "force-dynamic";

export async function GET() {
  const db = getDb();
  const out: Record<string, string> = {};
  const step = async (name: string, run: () => Promise<unknown>) => {
    const s = Date.now();
    try {
      await Promise.race([run(), new Promise((_, rej) => setTimeout(() => rej(new Error("10초 초과")), 10_000))]);
      out[name] = `${Date.now() - s}ms`;
    } catch (e) {
      out[name] = `실패 ${Date.now() - s}ms ${(e as Error).message.slice(0, 120)}`;
    }
  };
  await step("ping", () => db.query("select 1"));
  await step("overview", () => adminOverview(db));
  await step("visitors", () => getStats(db));
  await step("ics", () => getIcsStats(db));
  await step("users", () => db.query("select count(*)::int from app_user"));
  await step("funnel7", () => funnel(db, 7));
  await step("funnel30", () => funnel(db, 30));
  return Response.json(out);
}
