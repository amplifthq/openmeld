import path from "node:path";
import { getPackagesDbDirectoryPath } from "../auth/paths.ts";
import { getAuthDbWranglerConfigAbsolutePath } from "../auth/tooling-paths.ts";
import {
  normalizeBlockedReason,
  type ToolingCommandRunner,
} from "./command-runner.ts";
import type { DbExecutionMode } from "./db-execution-mode.ts";

const extractWranglerJsonRows = <TRow>(parsed: unknown): TRow[] => {
  if (Array.isArray(parsed)) {
    return parsed.flatMap((entry) => {
      if (typeof entry !== "object" || entry === null) {
        return [];
      }

      const rows = Reflect.get(entry, "results");
      return Array.isArray(rows) ? (rows as TRow[]) : [];
    });
  }

  if (typeof parsed === "object" && parsed !== null) {
    const rows = Reflect.get(parsed, "results");
    if (Array.isArray(rows)) {
      return rows as TRow[];
    }
  }

  throw new Error("unsupported wrangler d1 execute JSON shape");
};

export const buildSharedWranglerD1ExecuteArgs = (input: {
  json?: boolean;
  mode: DbExecutionMode;
  packagesDbDirectoryPath: string;
  sql: string;
  wranglerConfigAbsolutePath?: string;
}): string[] => {
  const relativeWranglerConfigPath = path.relative(
    input.packagesDbDirectoryPath,
    input.wranglerConfigAbsolutePath ?? getAuthDbWranglerConfigAbsolutePath()
  );

  return [
    "exec",
    "wrangler",
    "--config",
    relativeWranglerConfigPath,
    ...(input.mode === "prod" ? ["--env", "prod"] : []),
    "d1",
    "execute",
    "OPENMELD_DB",
    input.mode === "prod" ? "--remote" : "--local",
    "--command",
    input.sql,
    ...(input.json === false ? [] : ["--json"]),
  ];
};

export const runSharedWranglerJsonQuery = <TRow>(input: {
  mode: DbExecutionMode;
  packagesDbDirectoryPath?: string;
  runner: ToolingCommandRunner;
  sql: string;
  wranglerConfigAbsolutePath?: string;
}): { blockedReason: string | null; rows: TRow[] } => {
  const packagesDbDirectoryPath =
    input.packagesDbDirectoryPath ?? getPackagesDbDirectoryPath();
  const result = input.runner({
    args: buildSharedWranglerD1ExecuteArgs({
      json: true,
      mode: input.mode,
      packagesDbDirectoryPath,
      sql: input.sql,
      wranglerConfigAbsolutePath: input.wranglerConfigAbsolutePath,
    }),
    cwd: packagesDbDirectoryPath,
  });

  if (result.error || result.status !== 0) {
    return {
      blockedReason: normalizeBlockedReason(result),
      rows: [],
    };
  }

  try {
    return {
      blockedReason: null,
      rows: extractWranglerJsonRows<TRow>(JSON.parse(result.stdout) as unknown),
    };
  } catch (error) {
    return {
      blockedReason:
        error instanceof Error
          ? error.message
          : `failed to parse wrangler d1 execute JSON: ${String(error)}`,
      rows: [],
    };
  }
};
