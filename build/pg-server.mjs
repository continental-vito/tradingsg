/**
 * A real PostgreSQL server, speaking the real wire protocol, with no Docker and
 * no cloud account: PGlite (PostgreSQL compiled to WASM) behind a TCP socket.
 *
 * This exists so the PostgreSQL deployment path can be *tested* rather than
 * merely asserted to be portable. docs/deployment.md used to say the Postgres
 * migration set had never been run against a live Postgres; `make ci-postgres`
 * is what changed that.
 *
 *     node build/pg-server.mjs [port]
 *
 * Prints the connection string on stdout and serves until killed.
 */
import { PGlite } from "@electric-sql/pglite";
import { PGLiteSocketServer } from "@electric-sql/pglite-socket";

const port = Number(process.argv[2] ?? 5433);
const db = await PGlite.create();
const server = new PGLiteSocketServer({ db, port, host: "127.0.0.1" });
await server.start();

// The database name is ignored by PGlite but Prisma insists on parsing one.
console.log(`postgres://postgres:postgres@127.0.0.1:${port}/postgres`);

const stop = async () => {
  await server.stop();
  await db.close();
  process.exit(0);
};
process.on("SIGINT", stop);
process.on("SIGTERM", stop);
