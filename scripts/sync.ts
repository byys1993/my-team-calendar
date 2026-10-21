// 일정 수집: npm run sync [-- --force] [-- --only epl,laliga]
// GitHub Actions가 매시간 실행하며, 대회별 갱신 주기는 collector/run.ts 의 isDue 가 판단한다.
import { config } from "dotenv";
import { defaultAdapters } from "../src/collector/adapters";
import { syncAll } from "../src/collector/run";
import { createPostgresDb } from "../src/lib/db/postgres";

config({ path: [".env.local", ".env"], quiet: true });

const args = process.argv.slice(2);
const force = args.includes("--force");
const onlyIdx = args.indexOf("--only");
const only = onlyIdx >= 0 ? args[onlyIdx + 1]?.split(",") : undefined;

async function main() {
  const db = createPostgresDb(process.env.DATABASE_URL!, { max: 1 });
  try {
    const results = await syncAll(db, defaultAdapters(), { force, only, log: console.log });
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
