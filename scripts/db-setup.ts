// 마이그레이션 적용 후 시드 반영: npm run db:setup
import { config } from "dotenv";
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
  process.exit(1);
});
