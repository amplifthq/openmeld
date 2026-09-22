import { join } from "node:path";

/** Native retained-session reads shared by inventory and execution admission. */
export async function readOpenCodeSessionRows(
  databasePath: string,
  nativeSessionId?: string
): Promise<Record<string, unknown>[]> {
  const sql = `SELECT id, directory, title, time_created, time_updated, time_archived FROM session ${nativeSessionId === undefined ? "ORDER BY time_updated DESC, id ASC" : "WHERE id = ?"}`;
  const parameters = nativeSessionId === undefined ? [] : [nativeSessionId];
  if (typeof process.versions.bun === "string") {
    // @ts-expect-error bun:sqlite exists only in the standalone Bun runtime.
    const bunSqlite = await import("bun:sqlite");
    const { Database } = bunSqlite as {
      Database: new (
        path: string,
        options: { create: boolean; readonly: boolean }
      ) => {
        close: () => void;
        query: (sql: string) => {
          all: (...parameters: string[]) => Record<string, unknown>[];
        };
      };
    };
    const database = new Database(databasePath, {
      create: false,
      readonly: true,
    });
    try {
      return database.query(sql).all(...parameters);
    } finally {
      database.close();
    }
  }
  const { default: Database } = await import("better-sqlite3");
  const database = new Database(databasePath, {
    fileMustExist: true,
    readonly: true,
  });
  try {
    return database.prepare(sql).all(...parameters) as Record<
      string,
      unknown
    >[];
  } finally {
    database.close();
  }
}

export function resolveOpenCodeDatabasePath(input: {
  homeDir: string;
  xdgDataHome?: string | null;
}): string {
  const xdgDataHome = normalizeOptionalText(
    input.xdgDataHome ?? process.env.XDG_DATA_HOME
  );
  const dataHome = xdgDataHome ?? join(input.homeDir, ".local", "share");
  return join(dataHome, "opencode", "opencode.db");
}

export function resolveOpenCodeAuthPath(input: {
  homeDir: string;
  xdgDataHome?: string | null;
}): string {
  const xdgDataHome = normalizeOptionalText(
    input.xdgDataHome ?? process.env.XDG_DATA_HOME
  );
  const dataHome = xdgDataHome ?? join(input.homeDir, ".local", "share");
  return join(dataHome, "opencode", "auth.json");
}

function normalizeOptionalText(
  value: string | null | undefined
): string | null {
  const normalized = value?.trim();
  return normalized ? normalized : null;
}
