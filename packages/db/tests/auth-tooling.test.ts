import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  AUTH_DB_BETTER_AUTH_GENERATED_SCHEMA_PATH,
  AUTH_DB_DRIZZLE_CONFIG_PATH,
  AUTH_DB_MIGRATIONS_PATH,
  AUTH_DB_SCHEMA_GLOB_PATH,
  D1_LOCAL_DB_PATH_ENV_NAME,
  SHARED_DB_DATABASE_ID,
  SHARED_DB_DATABASE_NAME,
} from "../src/index";
import {
  buildAuthToolingDbFactSnapshot,
  findLocalD1DatabasePath,
  getAuthDbMigrationDirectoryAbsolutePath,
  getAuthDbSchemaGlobAbsolutePath,
  getAuthDbWranglerConfigAbsolutePath,
  getAuthServiceDirectoryPath,
  getRepoRootDirectoryPath,
  resolveAuthDrizzleConfigInput,
  resolveAuthToolingDbTarget,
} from "../src/tooling";
import { runAuthDbCheck } from "../src/tooling/auth-db-check.ts";
import { runAuthDbGenerate } from "../src/tooling/auth-db-generate.ts";
import { runAuthDbMigrate } from "../src/tooling/auth-db-migrate.ts";
import { runAuthDbOptimize } from "../src/tooling/auth-db-optimize.ts";
import { runAuthDbVerify } from "../src/tooling/auth-db-verify.ts";
import { parseJsoncObject } from "../src/tooling/parse-jsonc.ts";
import {
  captureDbToolingEnv,
  restoreDbToolingEnv,
} from "./helpers/db-tooling-env.ts";
import { createSharedPhysicalContractRunner } from "./helpers/shared-physical-contract-runner.ts";

const originalDbToolingEnv = captureDbToolingEnv();
const ALL_PRODUCTION_CREDENTIALS_MISSING_PATTERN =
  /Missing production database credentials:[\s\S]*- CLOUDFLARE_ACCOUNT_ID: [^\n]+[\s\S]*- CLOUDFLARE_D1_DATABASE_ID: [^\n]+[\s\S]*- CLOUDFLARE_API_TOKEN: [^\n]+/u;
const BOTH_ACCOUNT_CREDENTIALS_MISSING_PATTERN =
  /Missing production database credentials:[\s\S]*- CLOUDFLARE_ACCOUNT_ID: [^\n]+[\s\S]*- CLOUDFLARE_API_TOKEN: [^\n]+/u;
const ONE_PRODUCTION_CREDENTIAL_MISSING_PATTERN =
  /Missing production database credentials:\n- CLOUDFLARE_ACCOUNT_ID: Selects [^\n]+ Get it [^\n]+/u;
const WRANGLER_FALLBACK_UNAVAILABLE_PATTERN =
  /- CLOUDFLARE_D1_DATABASE_ID: [^\n]+ Wrangler fallback unavailable: wrangler config unreadable/u;
const WRANGLER_MUST_NOT_RESOLVE_ACCOUNT_CREDENTIALS_PATTERN =
  /Missing production database credentials:[\s\S]*- CLOUDFLARE_ACCOUNT_ID:[\s\S]*- CLOUDFLARE_API_TOKEN:/u;
const unsetEnv = (name: string) => {
  Reflect.deleteProperty(process.env, name);
};

const buildProductionWranglerConfig = (databaseId: string): string => {
  return `{
    // Production binding is the non-secret database identity source.
    "env": {
      "prod": {
        "d1_databases": [
          {
            "binding": "OPENMELD_DB",
            "database_id": "${databaseId}",
          },
        ],
      },
    },
  }`;
};

const resolveProductionDrizzleConfig = (input: {
  env: NodeJS.ProcessEnv;
  readWranglerConfigSource?: () => string;
  writeDiagnostic?: (message: string) => void;
}) => {
  return resolveAuthDrizzleConfigInput(undefined, "prod", input);
};

afterEach(() => {
  restoreDbToolingEnv(originalDbToolingEnv);
});

describe("auth db tooling", () => {
  it("reports both missing account credentials together when database id falls back to Wrangler", () => {
    expect(() =>
      resolveProductionDrizzleConfig({
        env: {},
        readWranglerConfigSource: () =>
          buildProductionWranglerConfig("database-from-wrangler"),
      })
    ).toThrowError(BOTH_ACCOUNT_CREDENTIALS_MISSING_PATTERN);

    try {
      resolveProductionDrizzleConfig({
        env: {},
        readWranglerConfigSource: () =>
          buildProductionWranglerConfig("database-from-wrangler"),
      });
    } catch (error) {
      expect(String(error)).not.toContain("\n- CLOUDFLARE_D1_DATABASE_ID:");
    }
  });

  it("reports one missing production credential with its purpose and acquisition guidance", () => {
    expect(() =>
      resolveProductionDrizzleConfig({
        env: {
          CLOUDFLARE_API_TOKEN: "token",
          CLOUDFLARE_D1_DATABASE_ID: "database-from-env",
        },
      })
    ).toThrowError(ONE_PRODUCTION_CREDENTIAL_MISSING_PATTERN);
  });

  it("reports all production credentials together when every source is missing", () => {
    expect(() =>
      resolveProductionDrizzleConfig({
        env: {},
        readWranglerConfigSource: () => "{ invalid jsonc",
      })
    ).toThrowError(ALL_PRODUCTION_CREDENTIALS_MISSING_PATTERN);
  });

  it("falls back to the production OPENMELD_DB database id and logs its source", () => {
    const diagnostics: string[] = [];
    const config = resolveProductionDrizzleConfig({
      env: {
        CLOUDFLARE_ACCOUNT_ID: "account",
        CLOUDFLARE_API_TOKEN: "token",
      },
      readWranglerConfigSource: () =>
        buildProductionWranglerConfig("database-from-wrangler"),
      writeDiagnostic: (message) => diagnostics.push(message),
    });

    expect(config.dbCredentials.databaseId).toBe("database-from-wrangler");
    expect(diagnostics).toEqual([
      "CLOUDFLARE_D1_DATABASE_ID resolved from services/auth/wrangler.jsonc env.prod OPENMELD_DB database_id.",
    ]);
  });

  it("prefers the explicit database id without reading or logging the fallback", () => {
    const readWranglerConfigSource = vi.fn(() => {
      throw new Error("fallback must not be read");
    });
    const writeDiagnostic = vi.fn();
    const config = resolveProductionDrizzleConfig({
      env: {
        CLOUDFLARE_ACCOUNT_ID: "account",
        CLOUDFLARE_API_TOKEN: "token",
        CLOUDFLARE_D1_DATABASE_ID: "database-from-env",
      },
      readWranglerConfigSource,
      writeDiagnostic,
    });

    expect(config.dbCredentials.databaseId).toBe("database-from-env");
    expect(readWranglerConfigSource).not.toHaveBeenCalled();
    expect(writeDiagnostic).not.toHaveBeenCalled();
  });

  it("treats an unreadable Wrangler database id fallback as missing", () => {
    const readError = new Error("wrangler config unreadable");
    expect(() =>
      resolveProductionDrizzleConfig({
        env: {
          CLOUDFLARE_ACCOUNT_ID: "account",
          CLOUDFLARE_API_TOKEN: "token",
        },
        readWranglerConfigSource: () => {
          throw readError;
        },
      })
    ).toThrowError(WRANGLER_FALLBACK_UNAVAILABLE_PATTERN);

    try {
      resolveProductionDrizzleConfig({
        env: {
          CLOUDFLARE_ACCOUNT_ID: "account",
          CLOUDFLARE_API_TOKEN: "token",
        },
        readWranglerConfigSource: () => {
          throw readError;
        },
      });
    } catch (error) {
      expect(error).toHaveProperty("cause", readError);
    }
  });

  it("never resolves account credentials from Wrangler configuration", () => {
    expect(() =>
      resolveProductionDrizzleConfig({
        env: {},
        readWranglerConfigSource: () => `{
          "env": {
            "prod": {
              "vars": {
                "CLOUDFLARE_ACCOUNT_ID": "must-not-be-used",
                "CLOUDFLARE_API_TOKEN": "must-not-be-used"
              },
              "d1_databases": [{
                "binding": "OPENMELD_DB",
                "database_id": "database-from-wrangler"
              }]
            }
          }
        }`,
      })
    ).toThrowError(WRANGLER_MUST_NOT_RESOLVE_ACCOUNT_CREDENTIALS_PATTERN);
  });

  it("reports an explicit database id as env-sourced even when it equals Wrangler", () => {
    process.env.CLOUDFLARE_D1_DATABASE_ID = SHARED_DB_DATABASE_ID;

    expect(resolveAuthToolingDbTarget(undefined, "prod").resolvedFrom).toBe(
      "cloudflare_env"
    );
  });

  it("builds a tooling snapshot from packages/db metadata", () => {
    const snapshot = buildAuthToolingDbFactSnapshot();
    expect(snapshot.mode).toBe("tooling");
    expect(snapshot.schemaSources.map((item) => item.path)).toEqual(
      expect.arrayContaining([
        AUTH_DB_SCHEMA_GLOB_PATH,
        AUTH_DB_DRIZZLE_CONFIG_PATH,
      ])
    );
    expect(snapshot.migrationSources.map((item) => item.path)).toEqual([
      AUTH_DB_MIGRATIONS_PATH,
    ]);
    expect(snapshot.schemaSources.map((item) => item.path)).toContain(
      AUTH_DB_BETTER_AUTH_GENERATED_SCHEMA_PATH
    );
  });

  it("prefers the explicit D1_LOCAL_DB_PATH override for the local sqlite target", () => {
    process.env.NODE_ENV = "development";

    const tempDir = fs.mkdtempSync(
      path.join(os.tmpdir(), "openmeld-db-auth-tooling-")
    );
    const explicitSqlitePath = path.join(tempDir, "explicit-shared.sqlite");
    fs.writeFileSync(explicitSqlitePath, "explicit");
    process.env[D1_LOCAL_DB_PATH_ENV_NAME] = explicitSqlitePath;

    expect(findLocalD1DatabasePath()).toBe(path.resolve(explicitSqlitePath));
  });

  it("resolves absolute drizzle input paths from packages/db", () => {
    const repoRootDirectoryPath = getRepoRootDirectoryPath();
    expect(getAuthDbSchemaGlobAbsolutePath()).toBe(
      path.resolve(repoRootDirectoryPath, AUTH_DB_SCHEMA_GLOB_PATH)
    );
    expect(getAuthDbMigrationDirectoryAbsolutePath()).toBe(
      path.resolve(repoRootDirectoryPath, AUTH_DB_MIGRATIONS_PATH)
    );
    expect(getAuthDbWranglerConfigAbsolutePath()).toBe(
      path.resolve(repoRootDirectoryPath, "services/auth/wrangler.jsonc")
    );
    expect(getAuthServiceDirectoryPath()).toBe(
      path.resolve(repoRootDirectoryPath, "services/auth")
    );
  });

  it("parses JSONC config sources with comments and trailing commas", () => {
    const parsed = parseJsoncObject<{
      binding: {
        name: string;
        values: string[];
      };
    }>(`{
      // runtime comment
      "binding": {
        "name": "OPENMELD_DB",
        "values": [
          "openmeld-db",
        ],
      },
    }`);

    expect(parsed).toEqual({
      binding: {
        name: "OPENMELD_DB",
        values: ["openmeld-db"],
      },
    });
  });

  it("keeps the shared OPENMELD_DB identity aligned across auth and core wrangler configs", () => {
    const repoRootDirectoryPath = getRepoRootDirectoryPath();
    const readBindingMetadata = (configPath: string) => {
      const parsed = parseJsoncObject<{
        d1_databases?: Array<{
          binding?: string;
          database_id?: string;
          database_name?: string;
          migrations_dir?: string;
        }>;
      }>(fs.readFileSync(configPath, "utf8"));

      return parsed.d1_databases?.find(
        (entry) => entry.binding === "OPENMELD_DB"
      );
    };

    const authBinding = readBindingMetadata(
      path.resolve(repoRootDirectoryPath, "services/auth/wrangler.jsonc")
    );
    const coreBinding = readBindingMetadata(
      path.resolve(repoRootDirectoryPath, "services/core/wrangler.jsonc")
    );

    expect(authBinding).toMatchObject({
      database_id: SHARED_DB_DATABASE_ID,
      database_name: SHARED_DB_DATABASE_NAME,
      migrations_dir: "../../packages/db/drizzle",
    });
    expect(coreBinding).toMatchObject({
      database_id: SHARED_DB_DATABASE_ID,
      database_name: SHARED_DB_DATABASE_NAME,
      migrations_dir: "../../packages/db/drizzle",
    });
  });

  it("returns no_diff when drizzle-kit check succeeds", () => {
    process.env.CLOUDFLARE_ACCOUNT_ID = "acc";
    process.env.CLOUDFLARE_D1_DATABASE_ID = "db";
    process.env.CLOUDFLARE_API_TOKEN = "token";
    const summary = runAuthDbCheck({
      mode: "prod",
      runner: () => ({
        status: 0,
        stdout: "Everything's fine\n",
        stderr: "",
      }),
    });

    expect(summary.subject).toBe("shared");
    expect(summary.phase).toBe("migration_phase");
    expect(summary.result).toBe("no_diff");
    expect(summary.snapshot.schemaSources.map((item) => item.path)).toContain(
      AUTH_DB_DRIZZLE_CONFIG_PATH
    );
    expect(summary.blockedReason).toBeNull();
  });

  it("returns diff_detected when drizzle-kit check reports schema drift", () => {
    process.env.CLOUDFLARE_ACCOUNT_ID = "acc";
    process.env.CLOUDFLARE_D1_DATABASE_ID = "db";
    process.env.CLOUDFLARE_API_TOKEN = "token";
    const summary = runAuthDbCheck({
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
    expect(summary.blockedReason).toContain("schema drift detected");
  });

  it("returns no_diff when db:generate sees no new migration artifacts", () => {
    process.env.CLOUDFLARE_ACCOUNT_ID = "acc";
    process.env.CLOUDFLARE_D1_DATABASE_ID = "db";
    process.env.CLOUDFLARE_API_TOKEN = "token";
    const tempDirectoryPath = fs.mkdtempSync(
      path.join(os.tmpdir(), "openmeld-db-generate-no-diff-")
    );
    const migrationDirectoryPath = path.join(tempDirectoryPath, "drizzle");
    fs.mkdirSync(migrationDirectoryPath, { recursive: true });
    fs.writeFileSync(path.join(migrationDirectoryPath, "_journal.json"), "{}");

    const summary = runAuthDbGenerate({
      migrationDirectoryPath,
      mode: "prod",
      packagesDbDirectoryPath: tempDirectoryPath,
      runner: ({ args }) => {
        if (args.includes("check")) {
          return { status: 0, stdout: "", stderr: "" };
        }

        return { status: 0, stdout: "", stderr: "" };
      },
    });

    expect(summary.command).toBe("db:generate");
    expect(summary.subject).toBe("shared");
    expect(summary.phase).toBe("migration_phase");
    expect(summary.result).toBe("no_diff");
    expect(summary.blockedReason).toBeNull();
  });

  it("returns applied when db:generate writes a migration artifact", () => {
    process.env.CLOUDFLARE_ACCOUNT_ID = "acc";
    process.env.CLOUDFLARE_D1_DATABASE_ID = "db";
    process.env.CLOUDFLARE_API_TOKEN = "token";
    const tempDirectoryPath = fs.mkdtempSync(
      path.join(os.tmpdir(), "openmeld-db-generate-applied-")
    );
    const migrationDirectoryPath = path.join(tempDirectoryPath, "drizzle");
    fs.mkdirSync(migrationDirectoryPath, { recursive: true });
    fs.writeFileSync(path.join(migrationDirectoryPath, "_journal.json"), "{}");

    const summary = runAuthDbGenerate({
      migrationDirectoryPath,
      mode: "prod",
      packagesDbDirectoryPath: tempDirectoryPath,
      runner: ({ args }) => {
        if (args.includes("check")) {
          return { status: 0, stdout: "", stderr: "" };
        }

        if (args.includes("generate")) {
          fs.writeFileSync(
            path.join(migrationDirectoryPath, "0005_shared_gate.sql"),
            "-- migration"
          );
        }

        return { status: 0, stdout: "", stderr: "" };
      },
    });

    expect(summary.subject).toBe("shared");
    expect(summary.phase).toBe("migration_phase");
    expect(summary.result).toBe("applied");
    expect(summary.blockedReason).toBeNull();
  });

  it("applies shared db migrations through the auth worker wrangler config without Cloudflare Drizzle env", () => {
    const tempDirectoryPath = fs.mkdtempSync(
      path.join(os.tmpdir(), "openmeld-db-migrate-")
    );
    process.env[D1_LOCAL_DB_PATH_ENV_NAME] = path.join(
      tempDirectoryPath,
      "preflight.sqlite"
    );
    unsetEnv("CLOUDFLARE_ACCOUNT_ID");
    unsetEnv("CLOUDFLARE_D1_DATABASE_ID");
    unsetEnv("CLOUDFLARE_API_TOKEN");

    const commands: string[][] = [];
    const summary = runAuthDbMigrate({
      mode: "prod",
      packagesDbDirectoryPath: tempDirectoryPath,
      runner: ({ args }) => {
        commands.push(args);
        return { status: 0, stdout: "", stderr: "" };
      },
    });

    expect(summary.command).toBe("db:migrate:prod");
    expect(summary.subject).toBe("shared");
    expect(summary.phase).toBe("migration_phase");
    expect(summary.snapshot.subject).toBe("shared");
    expect(summary.result).toBe("applied");
    expect(commands[0]).toEqual([
      "exec",
      "drizzle-kit",
      "check",
      "--config",
      "drizzle.config.ts",
    ]);
    const migrationListCommandIndex = commands.findIndex((args) => {
      return args.includes("migrations") && args.includes("list");
    });
    const migrationListCommand = commands[migrationListCommandIndex];
    expect(migrationListCommand).toEqual(
      expect.arrayContaining([
        "exec",
        "wrangler",
        "--config",
        path.relative(tempDirectoryPath, getAuthDbWranglerConfigAbsolutePath()),
        "--env",
        "prod",
        "d1",
        "migrations",
        "list",
        "OPENMELD_DB",
        "--remote",
      ])
    );
    const migrationApplyCommandIndex = commands.findIndex((args) => {
      return args.includes("migrations") && args.includes("apply");
    });
    const migrationApplyCommand = commands[migrationApplyCommandIndex];
    expect(migrationApplyCommand).toEqual(
      expect.arrayContaining([
        "exec",
        "wrangler",
        "--config",
        path.relative(tempDirectoryPath, getAuthDbWranglerConfigAbsolutePath()),
        "--env",
        "prod",
        "d1",
        "migrations",
        "apply",
        "OPENMELD_DB",
        "--remote",
      ])
    );
    expect(commands).toHaveLength(3);
    expect(migrationListCommandIndex).toBeGreaterThanOrEqual(0);
    expect(migrationApplyCommandIndex).toBeGreaterThanOrEqual(0);
    expect(migrationListCommandIndex).toBeLessThan(migrationApplyCommandIndex);
  });

  it("blocks production shared db migrations when the read-only preflight cannot list pending migrations", () => {
    process.env[D1_LOCAL_DB_PATH_ENV_NAME] = path.join(
      os.tmpdir(),
      "openmeld-db-migrate-preflight.sqlite"
    );
    unsetEnv("CLOUDFLARE_ACCOUNT_ID");
    unsetEnv("CLOUDFLARE_D1_DATABASE_ID");
    unsetEnv("CLOUDFLARE_API_TOKEN");

    const commands: string[][] = [];
    const summary = runAuthDbMigrate({
      mode: "prod",
      runner: ({ args }) => {
        commands.push(args);
        if (args.includes("check")) {
          return { status: 0, stdout: "Everything's fine\n", stderr: "" };
        }
        if (args.includes("migrations") && args.includes("list")) {
          return { status: 1, stdout: "", stderr: "cannot read pending list" };
        }

        return { status: 0, stdout: "", stderr: "" };
      },
    });

    expect(summary.command).toBe("db:migrate:prod");
    expect(summary.result).toBe("blocked");
    expect(summary.blockedReason).toContain(
      "production migration preflight migrations list failed"
    );
    expect(summary.blockedReason).toContain("cannot read pending list");
    expect(
      commands.some((args) => {
        return args.includes("migrations") && args.includes("apply");
      })
    ).toBe(false);
  });

  it("verifies shared db state through the auth worker wrangler config", () => {
    process.env.CLOUDFLARE_ACCOUNT_ID = "acc";
    process.env.CLOUDFLARE_D1_DATABASE_ID = "db";
    process.env.CLOUDFLARE_API_TOKEN = "token";

    const commands: string[][] = [];
    const runSharedPhysicalContractCommand =
      createSharedPhysicalContractRunner();
    const summary = runAuthDbVerify({
      mode: "prod",
      runner: ({ args }) => {
        commands.push(args);
        return runSharedPhysicalContractCommand({ args });
      },
    });

    expect(summary.command).toBe("db:verify:prod");
    expect(summary.subject).toBe("shared");
    expect(summary.phase).toBe("migration_phase");
    expect(summary.result).toBe("no_diff");
    expect(summary.blockedReason).toBeNull();
    expect(
      commands.some((args) => {
        return (
          args.includes("execute") &&
          args.includes("--json") &&
          args.includes("--env") &&
          args.includes("prod")
        );
      })
    ).toBe(true);
  });

  it("optimizes the shared OPENMELD_DB through the auth worker wrangler config", () => {
    const tempDirectoryPath = fs.mkdtempSync(
      path.join(os.tmpdir(), "openmeld-db-optimize-")
    );
    const commands: string[][] = [];
    const summary = runAuthDbOptimize({
      mode: "dev",
      packagesDbDirectoryPath: tempDirectoryPath,
      runner: ({ args }) => {
        commands.push(args);
        return { status: 0, stdout: "", stderr: "" };
      },
    });

    expect(summary.command).toBe("db:optimize:dev");
    expect(summary.subject).toBe("shared");
    expect(summary.phase).toBe("migration_phase");
    expect(summary.snapshot.subject).toBe("shared");
    expect(summary.result).toBe("applied");
    expect(commands[0]).toEqual(
      expect.arrayContaining([
        "exec",
        "wrangler",
        "--config",
        path.relative(tempDirectoryPath, getAuthDbWranglerConfigAbsolutePath()),
        "d1",
        "execute",
        "OPENMELD_DB",
        "--local",
      ])
    );
  });
});
