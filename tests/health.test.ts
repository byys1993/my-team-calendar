import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { Db } from "@/lib/db";
import { checkHealth, pickAlerts, recordSyncHeartbeat } from "@/lib/health";
import { setupDb } from "./helpers";

let db: Db & { close(): Promise<void> };
let eplId: number;
beforeEach(async () => {
  ({ db, eplId } = (await setupDb()) as { db: Db & { close(): Promise<void> }; eplId: number });
});
afterEach(() => db.close());

const now = new Date("2026-10-27T09:00:00Z");
const hoursAgo = (h: number) => new Date(now.getTime() - h * 3600_000).toISOString();

describe("데이터 이상 감지", () => {
  it("정상이면 문제 없음", async () => {
    await db.query("insert into competition_status (competition_id, last_success_at) values ($1, $2)", [eplId, hoursAgo(1)]);
    expect(await checkHealth(db, now)).toEqual([]);
  });

  it("수집 전체가 3시간 넘게 멈추면 알린다", async () => {
    await db.query("insert into competition_status (competition_id, last_success_at) values ($1, $2)", [eplId, hoursAgo(5)]);
    const issues = await checkHealth(db, now);
    expect(issues.map((i) => i.key)).toEqual(["stale-all"]);
    expect(issues[0].message).toContain("5시간째");
  });

  it("갱신할 대회가 없어도 수집이 돌고 있으면 알리지 않는다", async () => {
    await db.query("insert into competition_status (competition_id, last_success_at) values ($1, $2)", [eplId, hoursAgo(5)]);
    await recordSyncHeartbeat(db, new Date(hoursAgo(1)));
    expect((await checkHealth(db, now)).map((i) => i.key)).not.toContain("stale-all");
  });

  it("3번 연속 실패, 한국어 이름 없는 팀", async () => {
    await db.query("insert into competition_status (competition_id, last_success_at) values ($1, $2)", [eplId, hoursAgo(1)]);
    for (let i = 0; i < 3; i++) {
      await db.query("insert into sync_run (competition_id, source, ok, error, started_at) values ($1, 'espn', false, 'HTTP 500', $2)", [
        eplId,
        hoursAgo(3 - i),
      ]);
    }
    const [{ id }] = await db.query<{ id: number }>(
      "insert into team (sport_id, slug, name_ko, name_en, needs_review) select sport_id, 'espn-999', 'New FC', 'New FC', true from competition where id = $1 returning id",
      [eplId],
    );
    await db.query(
      "insert into match (competition_id, season, home_team_id, start_at, status) values ($1, '2026', $2, $3, 'scheduled')",
      [eplId, id, new Date(now.getTime() + 2 * 86_400_000).toISOString()],
    );
    const keys = (await checkHealth(db, now)).map((i) => i.key);
    expect(keys).toContain("fail:epl");
    expect(keys).toContain("needs-review");
  });

  it("같은 문제는 12시간에 한 번만 알린다", async () => {
    const issues = [{ key: "stale-all", message: "x" }];
    expect(await pickAlerts(db, issues, now)).toHaveLength(1);
    expect(await pickAlerts(db, issues, new Date(now.getTime() + 3600_000))).toHaveLength(0);
    expect(await pickAlerts(db, issues, new Date(now.getTime() + 13 * 3600_000))).toHaveLength(1);
  });
});
