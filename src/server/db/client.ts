import fs from "node:fs";
import path from "node:path";
import Database from "better-sqlite3";
import { drizzle } from "drizzle-orm/better-sqlite3";
import * as schema from "./schema";

const defaultPath = path.join(process.cwd(), "data", "owntube.db");

function createDb() {
  const dbPath = process.env.DATABASE_PATH ?? defaultPath;
  fs.mkdirSync(path.dirname(dbPath), { recursive: true });
  const sqlite = new Database(dbPath);
  sqlite.pragma("journal_mode = WAL");
  sqlite.pragma("foreign_keys = ON");
  return drizzle(sqlite, { schema });
}

export type AppDb = ReturnType<typeof createDb>;

const globalForDb = globalThis as unknown as {
  __owntubeDb?: AppDb;
};

export function getDb(): AppDb {
  if (!globalForDb.__owntubeDb) {
    globalForDb.__owntubeDb = createDb();
  }
  return globalForDb.__owntubeDb;
}
