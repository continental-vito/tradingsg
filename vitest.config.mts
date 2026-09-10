import { defineConfig } from "vitest/config";
import { fileURLToPath } from "node:url";

export default defineConfig({
  test: {
    // Suites that touch the database each create their own SQLite file, so they
    // must not share a process-wide Prisma client or a working directory.
    environment: "node",
    include: ["src/**/*.test.ts", "prisma/**/*.test.ts"],
    reporters: process.env.CI ? ["default", "github-actions"] : ["default"],
    // Set here rather than in a beforeAll: src/lib/env.ts parses process.env at
    // import time, which happens before any hook runs — so a test that assigned
    // these in setup would still have written into the real outbox.
    env: {
      EMAIL_PROVIDER: "console",
      EMAIL_OUTBOX_DIR: ".mail-test",
      MARKET_DATA_PROVIDER: "mock",
      COMPANY_NAME: "Acme Corp",
      APP_URL: "http://localhost:3000",
    },
  },
  resolve: {
    alias: {
      "@": fileURLToPath(new URL("./src", import.meta.url)),
      // `server-only` throws on import outside a React Server Component build,
      // which is the whole point of it — but it means any module carrying the
      // guard is untestable until it is stubbed here. Aliasing it to an empty
      // module keeps the guard real in the app and out of the way in tests.
      "server-only": fileURLToPath(new URL("./src/test/server-only-stub.ts", import.meta.url)),
    },
  },
});
