/**
 * A real PostgreSQL server with nothing to install: PGlite (PostgreSQL 18
 * compiled to WASM) behind a TCP socket.
 *
 *     node build/pg-server.mjs [port] [dataDir]
 *
 * With a dataDir the database persists across restarts, which is what local
 * development needs. Without one it is in-memory, which is what `make
 * ci-postgres` wants.
 *
 * This exists so that development, the test suite and production all run the
 * same engine. They did not used to: tests and local dev ran SQLite while
 * anything deployed ran PostgreSQL, so every dialect difference was invisible
 * until it reached the hosted database.
 *
 * PGlite serves ONE connection at a time. That is fine for one developer and
 * for a test suite, and it is why `prisma migrate dev` cannot be used against
 * it — its engine wants a session advisory lock on a second connection. Use
 * `prisma migrate deploy`, which does not.
 */
import { PGlite } from "@electric-sql/pglite";
import { PGLiteSocketServer } from "@electric-sql/pglite-socket";

const port = Number(process.argv[2] ?? 5433);
const dataDir = process.argv[3];

const db = await PGlite.create(dataDir ? { dataDir } : undefined);
const server = new PGLiteSocketServer({ db, port, host: "127.0.0.1" });
await server.start();

console.log(`postgres://postgres:postgres@127.0.0.1:${port}/postgres`);
if (dataDir) console.log(`persisting to ${dataDir}`);
console.log("Ctrl-C to stop.");

const stop = async () => {
  await server.stop();
  await db.close();
  process.exit(0);
};
process.on("SIGINT", stop);
process.on("SIGTERM", stop);
