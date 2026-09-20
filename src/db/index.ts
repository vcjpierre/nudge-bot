import Database from 'better-sqlite3';
import { drizzle } from 'drizzle-orm/better-sqlite3';
import { migrate } from 'drizzle-orm/better-sqlite3/migrator';
import { mkdirSync } from 'node:fs';
import path from 'node:path';
import * as schema from './schema.js';

/** Lazily-loaded env: permite que los tests definan variables antes de importar. */
function dbPath(): string {
  return process.env.DATABASE_PATH ?? './data/bot.db';
}

export type Db = ReturnType<typeof createDb>;

function createDb(databasePath: string) {
  mkdirSync(path.dirname(databasePath), { recursive: true });
  const sqlite = new Database(databasePath);
  sqlite.pragma('journal_mode = WAL');
  sqlite.pragma('foreign_keys = ON');
  return drizzle(sqlite, { schema });
}

export const db: Db = createDb(dbPath());

/** Aplica las migraciones pendientes sobre la conexión indicada. */
export function runMigrations(target: Db = db): void {
  const migrationsFolder = path.resolve(import.meta.dirname, 'migrations');
  migrate(target, { migrationsFolder });
}

/**
 * Crea una base de datos aislada (tests): aplica migraciones y devuelve la conexión.
 * Usa ':memory:' para una DB en memoria o una ruta de archivo temporal.
 */
export function createTestDb(databasePath = ':memory:'): Db {
  const testDb = createDb(databasePath);
  migrate(testDb, { migrationsFolder: path.resolve(import.meta.dirname, 'migrations') });
  return testDb;
}

export function closeDb(target: Db = db): void {
  target.$client.close();
}
