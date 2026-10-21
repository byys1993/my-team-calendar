import path from "node:path";
import { defineConfig } from "vitest/config";

export default defineConfig({
  resolve: { alias: { "@": path.resolve(import.meta.dirname, "src") } },
  // 테스트마다 메모리 Postgres(PGlite)를 새로 띄우므로 준비(beforeEach) 시간을 넉넉히 둔다
  test: { include: ["tests/**/*.test.ts"], testTimeout: 30_000, hookTimeout: 60_000 },
});
