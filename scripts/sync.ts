// 일정 수집: npm run sync [-- --force] [-- --only epl,laliga]
// GitHub Actions가 매시간 실행하며, 대회별 갱신 주기는 collector/run.ts 의 isDue 가 판단한다.
import { config } from "dotenv";
import { defaultAdapters } from "../src/collector/adapters";
import { syncAll } from "../src/collector/run";
import { syncStandings } from "../src/collector/standings";
import { createPostgresDb } from "../src/lib/db/postgres";
import { recordSyncHeartbeat } from "../src/lib/health";

config({ path: [".env.local", ".env"], quiet: true });

const args = process.argv.slice(2);
const force = args.includes("--force");
const onlyIdx = args.indexOf("--only");
const only = onlyIdx >= 0 ? args[onlyIdx + 1]?.split(",") : undefined;

async function main() {
  const db = createPostgresDb(process.env.DATABASE_URL!, { max: 1 });
  try {
    const results = await syncAll(db, defaultAdapters(), { force, only, log: console.log });
    // 순위표 (3시간마다). 실패해도 일정 수집 결과에는 영향을 주지 않는다.
    await syncStandings(db, { force, only, log: console.log, footballDataKey: process.env.FOOTBALL_DATA_API_KEY });
    // 끝까지 돈 수집만 '실행됨'으로 남긴다 (사이트의 일정 업데이트 시각·멈춤 점검에 쓴다)
    await recordSyncHeartbeat(db);
    // 대회 하나라도 모든 소스가 실패하면 Actions 실행을 실패로 표시해 알 수 있게 한다.
    if (results.some((r) => !r.ok)) process.exitCode = 1;
  } finally {
    await db.end();
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
