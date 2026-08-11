import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { AuthBindings } from "../src/lib/bindings";
import {
  AUTH_DB_BETTER_AUTH_GENERATED_SCHEMA_PATH,
  AUTH_DB_DRIZZLE_CONFIG_PATH,
  AUTH_DB_SCHEMA_ENTRYPOINT_PATH,
  AUTH_DB_SCHEMA_GLOB_PATH,
  D1_LOCAL_DB_PATH_ENV_NAME,
} from "../src/lib/db/fact-metadata";
import { buildAuthRuntimeDbFactSnapshot } from "../src/lib/db/fact-snapshots";
import { runSharedDbCheck } from "../src/lib/db/tooling-check";
import { buildAuthToolingDbFactSnapshot } from "../src/lib/db/tooling-fact-snapshot";
import {
  findLocalD1DatabasePath,
  resolveAuthDrizzleConfigInput,
} from "../src/lib/db/tooling-facts";

const TRACKED_ENV_NAMES = [
  "NODE_ENV",
  D1_LOCAL_DB_PATH_ENV_NAME,
  "CLOUDFLARE_ACCOUNT_ID",
  "CLOUDFLARE_D1_DATABASE_ID",
  "CLOUDFLARE_API_TOKEN",
] as const;

type TrackedEnvName = (typeof TRACKED_ENV_NAMES)[number];

const originalEnvValues = Object.fromEntries(
  TRACKED_ENV_NAMES.map((name) => [name, process.env[name]])
) as Record<TrackedEnvName, string | undefined>;

const MISSING_PRODUCTION_DRIZZLE_ENV_ERROR =
  /Missing production database credentials:[\s\S]*CLOUDFLARE_ACCOUNT_ID[\s\S]*CLOUDFLARE_API_TOKEN/;

const unsetEnv = (name: string) => {
  Reflect.deleteProperty(process.env, name);
};

const restoreEnv = () => {
  for (const name of TRACKED_ENV_NAMES) {
    const originalValue = originalEnvValues[name];
    if (typeof originalValue === "undefined") {
      unsetEnv(name);
    } else {
      process.env[name] = originalValue;
    }
  }
};

afterEach(() => {
  restoreEnv();
});

describe("auth db facts", () => {
  it("builds a runtime snapshot without local tooling paths", () => {
    const snapshot = buildAuthRuntimeDbFactSnapshot({
      OPENMELD_DB: {} as D1Database,
    } as AuthBindings);
    expect(snapshot.mode).toBe("runtime");
    expect(snapshot.subject).toBe("auth");
    expect(snapshot.bindingName).toBe("OPENMELD_DB");
    expect(snapshot.schemaSources.map((item) => item.path)).toContain(
      AUTH_DB_SCHEMA_ENTRYPOINT_PATH
    );
    expect(snapshot.schemaSources.map((item) => item.path)).toContain(
      AUTH_DB_DRIZZLE_CONFIG_PATH
    );
    expect(snapshot.schemaSources.map((item) => item.path)).toContain(
      AUTH_DB_BETTER_AUTH_GENERATED_SCHEMA_PATH
    );
    expect(snapshot.target.databaseId).toBeNull();
    expect(snapshot.target.databaseName).toBeNull();
    expect(snapshot.target.resolvedFrom).toBe("runtime_binding_present");
    expect(snapshot.d1LocalDbPath).toBeNull();
    expect("declaredFallbackPaths" in snapshot).toBe(false);
    expect("observedFallbackHits" in snapshot).toBe(false);
  });

  it("marks the runtime target as unavailable when the auth worker cannot see OPENMELD_DB", () => {
    const snapshot = buildAuthRuntimeDbFactSnapshot(undefined);

    expect(snapshot.target.databaseId).toBeNull();
    expect(snapshot.target.databaseName).toBeNull();
    expect(snapshot.target.resolvedFrom).toBe("runtime_binding_missing");
  });

  it("builds a tooling snapshot that surfaces D1_LOCAL_DB_PATH explicitly", () => {
    process.env.NODE_ENV = "development";
    process.env[D1_LOCAL_DB_PATH_ENV_NAME] = "/tmp/openmeld-phase-zero.sqlite";

    const snapshot = buildAuthToolingDbFactSnapshot("/tmp");
    expect(snapshot.mode).toBe("tooling");
    expect(snapshot.schemaSources.map((item) => item.path)).toContain(
      AUTH_DB_SCHEMA_GLOB_PATH
    );
    expect(snapshot.schemaSources.map((item) => item.path)).toContain(
      AUTH_DB_BETTER_AUTH_GENERATED_SCHEMA_PATH
    );
    expect(snapshot.target.localPath).toBe(
      path.resolve("/tmp/openmeld-phase-zero.sqlite")
    );
    expect(snapshot.target.resolvedFrom).toBe(D1_LOCAL_DB_PATH_ENV_NAME);
    expect(snapshot.d1LocalDbPath).toBe(
      path.resolve("/tmp/openmeld-phase-zero.sqlite")
    );
    expect("declaredFallbackPaths" in snapshot).toBe(false);
    expect("observedFallbackHits" in snapshot).toBe(false);
  });

  it("resolves the newest local D1 sqlite file when no explicit path exists", () => {
    process.env.NODE_ENV = "development";
    unsetEnv(D1_LOCAL_DB_PATH_ENV_NAME);

    const tempDir = fs.mkdtempSync(
      path.join(os.tmpdir(), "openmeld-auth-db-facts-")
    );
    try {
      const d1Dir = path.join(
        tempDir,
        ".wrangler",
        "state",
        "v3",
        "d1",
        "miniflare-D1DatabaseObject"
      );
      const doDir = path.join(
        tempDir,
        ".wrangler",
        "state",
        "v3",
        "do",
        "ignored-object"
      );
      fs.mkdirSync(d1Dir, { recursive: true });
      fs.mkdirSync(doDir, { recursive: true });
      const olderPath = path.join(d1Dir, "older.sqlite");
      const newerPath = path.join(d1Dir, "newer.sqlite");
      const ignoredDoPath = path.join(doDir, "ignored.sqlite");
      fs.writeFileSync(olderPath, "older");
      fs.writeFileSync(newerPath, "newer");
      fs.writeFileSync(ignoredDoPath, "ignored");
      fs.utimesSync(
        olderPath,
        new Date("2026-04-01T00:00:00.000Z"),
        new Date("2026-04-01T00:00:00.000Z")
      );
      fs.utimesSync(
        newerPath,
        new Date("2026-04-01T00:00:01.000Z"),
        new Date("2026-04-01T00:00:01.000Z")
      );
      fs.utimesSync(
        ignoredDoPath,
        new Date("2026-04-01T00:00:02.000Z"),
        new Date("2026-04-01T00:00:02.000Z")
      );

      expect(findLocalD1DatabasePath(tempDir)).toBe(newerPath);
    } finally {
      fs.rmSync(tempDir, { recursive: true, force: true });
    }
  });

  it("throws a clear error when production drizzle env is incomplete", () => {
    process.env.NODE_ENV = "production";
    unsetEnv("CLOUDFLARE_ACCOUNT_ID");
    unsetEnv("CLOUDFLARE_D1_DATABASE_ID");
    unsetEnv("CLOUDFLARE_API_TOKEN");

    expect(() => resolveAuthDrizzleConfigInput()).toThrowError(
      MISSING_PRODUCTION_DRIZZLE_ENV_ERROR
    );
  });

  it("returns no_diff when drizzle-kit check succeeds", () => {
    process.env.CLOUDFLARE_ACCOUNT_ID = "acc";
    process.env.CLOUDFLARE_D1_DATABASE_ID = "db";
    process.env.CLOUDFLARE_API_TOKEN = "token";
    const summary = runSharedDbCheck({
      mode: "prod",
      runner: () => {
        return {
          status: 0,
          stdout: "Everything's fine\n",
          stderr: "",
        };
      },
    });

    expect(summary.subject).toBe("shared");
    expect(summary.phase).toBe("migration_phase");
    expect(summary.cwd).toBe(process.cwd());
    expect(summary.result).toBe("no_diff");
    expect(summary.blockedReason).toBeNull();
  });

  it("returns diff_detected when drizzle-kit check reports schema drift", () => {
    process.env.CLOUDFLARE_ACCOUNT_ID = "acc";
    process.env.CLOUDFLARE_D1_DATABASE_ID = "db";
    process.env.CLOUDFLARE_API_TOKEN = "token";
    const summary = runSharedDbCheck({
      mode: "prod",
      runner: () => ({
        status: 1,
        stdout: "",
        stderr: "schema drift detected",
      }),
    });

    expect(summary.subject).toBe("shared");
    expect(summary.phase).toBe("migration_phase");
    expect(summary.result).toBe("diff_detected");
    expect(summary.cwd).toBe(process.cwd());
    expect(summary.blockedReason).toContain("schema drift detected");
  });

  it("returns blocked before running drizzle-kit when production env is incomplete", () => {
    process.env.NODE_ENV = "production";
    unsetEnv("CLOUDFLARE_ACCOUNT_ID");
    unsetEnv("CLOUDFLARE_D1_DATABASE_ID");
    unsetEnv("CLOUDFLARE_API_TOKEN");
    const runner = vi.fn(() => ({
      status: 0,
      stdout: "should not run",
      stderr: "",
    }));

    const summary = runSharedDbCheck({
      runner,
    });

    expect(summary.subject).toBe("shared");
    expect(summary.phase).toBe("migration_phase");
    expect(summary.cwd).toBe(process.cwd());
    expect(summary.result).toBe("blocked");
    expect(summary.blockedReason).toContain(
      "Missing production database credentials"
    );
    expect(summary.snapshot.target.targetKind).toBe("d1_http");
    expect(summary.snapshot.target.resolvedFrom).toBe("wrangler_config");
    expect(summary.blockedReason).toContain("CLOUDFLARE_ACCOUNT_ID");
    expect(summary.blockedReason).not.toContain(
      "\n- CLOUDFLARE_D1_DATABASE_ID:"
    );
    expect(summary.blockedReason).toContain("CLOUDFLARE_API_TOKEN");
    expect(runner).not.toHaveBeenCalled();
  });
});
