// 마이그레이션 적용 후 시드 반영: npm run db:setup
import { config } from "dotenv";
import { describeDatabaseUrl } from "../src/lib/db/describeUrl";
import { createPostgresDb } from "../src/lib/db/postgres";
import { migrate } from "../src/lib/db/migrate";
import { loadCatalog, seed } from "../src/lib/db/seed";

config({ path: [".env.local", ".env"], quiet: true });

async function main() {
  const db = createPostgresDb(process.env.DATABASE_URL!, { max: 1 });
  try {
    await migrate(db, console.log);
    await seed(db, await loadCatalog());
    console.log("seed applied");
  } finally {
    await db.end();
  }
}

main().catch((err) => {
  console.error(err);
  // 접속 실패면 주소를 안전하게 요약해 원인을 찾기 쉽게 한다
  if (/password authentication|ENOTFOUND|ECONNREFUSED|timeout|Tenant or user/i.test(String(err))) {
    console.error(`\n--- DATABASE_URL 점검 (비밀번호는 표시하지 않음) ---\n${describeDatabaseUrl(process.env.DATABASE_URL)}`);
  }
  process.exit(1);
});
