/**
 * Warms the SQLite upstream cache for the anonymous home feed (trending).
 * Run from cron inside Docker or on the host, e.g. every 15–30 minutes.
 */
import fs from "node:fs";
import path from "node:path";
import Database from "better-sqlite3";
import { drizzle } from "drizzle-orm/better-sqlite3";
import { runSqlMigrations } from "../src/server/db/run-migrations";
import * as schema from "../src/server/db/schema";
import { fetchTrendingVideos } from "../src/server/services/proxy";

const defaultPath = path.join(process.cwd(), "data", "owntube.db");
const dbPath = process.env.DATABASE_PATH ?? defaultPath;
const region = (process.env.OWNTUBE_WARM_REGION ?? "US").trim().toUpperCase();
const limit = Number.parseInt(process.env.OWNTUBE_WARM_LIMIT ?? "48", 10);

fs.mkdirSync(path.dirname(dbPath), { recursive: true });

const sqlite = new Database(dbPath);
sqlite.pragma("foreign_keys = ON");
const db = drizzle(sqlite, { schema });

const migrationsFolder = path.join(process.cwd(), "src/server/db/migrations");
runSqlMigrations(sqlite, migrationsFolder);

const safeLimit =
  Number.isFinite(limit) && limit > 0 ? Math.min(limit, 200) : 48;

fetchTrendingVideos(db, { region, limit: safeLimit })
  .then((result) => {
    process.stdout.write(
      `warm-home-feed: ${result.videos.length} videos (${result.sourceUsed}, region=${region})\n`,
    );
  })
  .catch((error: unknown) => {
    const message = error instanceof Error ? error.message : String(error);
    process.stderr.write(`warm-home-feed failed: ${message}\n`);
    process.exitCode = 1;
  })
  .finally(() => {
    sqlite.close();
  });
