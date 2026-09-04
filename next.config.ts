import type { NextConfig } from "next";

const config: NextConfig = {
  // The domain layer imports the Prisma client, which loads a native better-sqlite3
  // binding. Bundling it into the server chunks makes `next build` succeed and the
  // first query at runtime fail with a missing module.
  serverExternalPackages: [
    "@prisma/client",
    "@prisma/adapter-better-sqlite3",
    "better-sqlite3",
    "@node-rs/argon2",
  ],
  typedRoutes: true,
};

export default config;
