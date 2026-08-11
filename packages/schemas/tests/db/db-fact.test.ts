import { describe, expect, it } from "vitest";
import {
  DB_FACT_SCHEMA_VERSION,
  dbCommandFactSummarySchema,
  dbDiagnosticsPayloadSchema,
  dbFactSnapshotSchema,
  dbInspectionSummarySchema,
} from "../../src/index";

describe("db fact schemas", () => {
  const authSnapshot = {
    subject: "auth",
    mode: "runtime",
    bindingName: "OPENMELD_DB",
    schemaSources: [
      {
        kind: "schema_entrypoint",
        owner: "packages/db",
        path: "packages/db/src/auth/schema.ts",
        note: null,
      },
    ],
    migrationSources: [
      {
        kind: "migration_dir",
        owner: "packages/db",
        path: "packages/db/drizzle",
        note: null,
      },
    ],
    target: {
      targetKind: "worker_binding",
      bindingName: "OPENMELD_DB",
      databaseId: null,
      databaseName: null,
      localPath: null,
      resolvedFrom: "worker_binding",
    },
    d1LocalDbPath: null,
    notes: ["auth runtime snapshot"],
  } as const;

  it("accepts a canonical runtime snapshot", () => {
    const parsed = dbFactSnapshotSchema.safeParse(authSnapshot);
    expect(parsed.success).toBe(true);
  });

  it("rejects malformed snapshot payloads", () => {
    const parsed = dbFactSnapshotSchema.safeParse({
      ...authSnapshot,
      bindingName: "",
    });
    expect(parsed.success).toBe(false);
  });

  it("rejects legacy fallback fields that no longer belong to the db fact contract", () => {
    const parsed = dbFactSnapshotSchema.safeParse({
      ...authSnapshot,
      declaredFallbackPaths: [],
      observedFallbackHits: [],
    });
    expect(parsed.success).toBe(false);
  });

  it("accepts diagnostics payloads for auth and core", () => {
    const parsed = dbDiagnosticsPayloadSchema.safeParse({
      contractVersion: DB_FACT_SCHEMA_VERSION,
      auth: authSnapshot,
      core: {
        ...authSnapshot,
        subject: "core",
        notes: ["core runtime snapshot"],
      },
    });
    expect(parsed.success).toBe(true);
  });

  it("rejects diagnostics payloads that omit the contract version", () => {
    const parsed = dbDiagnosticsPayloadSchema.safeParse({
      auth: authSnapshot,
      core: {
        ...authSnapshot,
        subject: "core",
        notes: ["core runtime snapshot"],
      },
    });
    expect(parsed.success).toBe(false);
  });

  it("accepts command summaries with the canonical contract version", () => {
    const parsed = dbCommandFactSummarySchema.safeParse({
      contractVersion: DB_FACT_SCHEMA_VERSION,
      command: "db:check",
      cwd: "/Users/felix/Desktop/felix-projects/openmeld/openmeld/packages/db",
      phase: "migration_phase",
      subject: "shared",
      result: "no_diff",
      blockedReason: null,
      snapshot: {
        ...authSnapshot,
        subject: "shared",
        mode: "tooling",
        target: {
          targetKind: "d1_local_sqlite",
          bindingName: "OPENMELD_DB",
          databaseId: null,
          databaseName: null,
          localPath: "/tmp/openmeld.sqlite",
          resolvedFrom: "D1_LOCAL_DB_PATH",
        },
        d1LocalDbPath: "/tmp/openmeld.sqlite",
      },
    });
    expect(parsed.success).toBe(true);
  });

  it("rejects unsupported command results", () => {
    const parsed = dbCommandFactSummarySchema.safeParse({
      contractVersion: DB_FACT_SCHEMA_VERSION,
      command: "db:check",
      cwd: "/Users/felix/Desktop/felix-projects/openmeld/openmeld/packages/db",
      phase: "migration_phase",
      subject: "shared",
      result: "failed",
      blockedReason: null,
      snapshot: {
        ...authSnapshot,
        subject: "shared",
      },
    });
    expect(parsed.success).toBe(false);
  });

  it("accepts shared db inspection summaries", () => {
    const parsed = dbInspectionSummarySchema.safeParse({
      contractVersion: DB_FACT_SCHEMA_VERSION,
      command: "db:inspect:dev",
      cwd: "/Users/felix/Desktop/felix-projects/openmeld/openmeld/packages/db",
      subject: "shared",
      mode: "dev",
      result: "ready",
      blockedReason: null,
      snapshot: {
        ...authSnapshot,
        subject: "shared",
        mode: "tooling",
      },
      checks: {
        legacyCoreDispatchShape: {
          status: "ok",
          detail: null,
        },
        sharedCoreDispatchPhysicalContract: {
          status: "ok",
          detail: null,
        },
      },
      notes: ["This is a read-only shared DB migration readiness inspection."],
    });
    expect(parsed.success).toBe(true);
  });

  it("accepts shared db inspection summaries with empty notes", () => {
    const parsed = dbInspectionSummarySchema.safeParse({
      contractVersion: DB_FACT_SCHEMA_VERSION,
      command: "db:inspect:dev",
      cwd: "/Users/felix/Desktop/felix-projects/openmeld/openmeld/packages/db",
      subject: "shared",
      mode: "dev",
      result: "ready",
      blockedReason: null,
      snapshot: {
        ...authSnapshot,
        subject: "shared",
        mode: "tooling",
      },
      checks: {
        legacyCoreDispatchShape: {
          status: "ok",
          detail: null,
        },
        sharedCoreDispatchPhysicalContract: {
          status: "ok",
          detail: null,
        },
      },
      notes: [],
    });
    expect(parsed.success).toBe(true);
  });

  it("rejects invalid db inspection mode values", () => {
    const parsed = dbInspectionSummarySchema.safeParse({
      contractVersion: DB_FACT_SCHEMA_VERSION,
      command: "db:inspect:dev",
      cwd: "/Users/felix/Desktop/felix-projects/openmeld/openmeld/packages/db",
      subject: "shared",
      mode: "stage",
      result: "ready",
      blockedReason: null,
      snapshot: {
        ...authSnapshot,
        subject: "shared",
        mode: "tooling",
      },
      checks: {
        legacyCoreDispatchShape: {
          status: "ok",
          detail: null,
        },
        sharedCoreDispatchPhysicalContract: {
          status: "ok",
          detail: null,
        },
      },
      notes: ["still valid"],
    });
    expect(parsed.success).toBe(false);
  });

  it("rejects unknown db inspection check statuses", () => {
    const parsed = dbInspectionSummarySchema.safeParse({
      contractVersion: DB_FACT_SCHEMA_VERSION,
      command: "db:inspect:dev",
      cwd: "/Users/felix/Desktop/felix-projects/openmeld/openmeld/packages/db",
      subject: "shared",
      mode: "dev",
      result: "ready",
      blockedReason: null,
      snapshot: {
        ...authSnapshot,
        subject: "shared",
        mode: "tooling",
      },
      checks: {
        legacyCoreDispatchShape: {
          status: "unknown",
          detail: null,
        },
        sharedCoreDispatchPhysicalContract: {
          status: "ok",
          detail: null,
        },
      },
      notes: ["valid note"],
    });
    expect(parsed.success).toBe(false);
  });

  it("rejects db inspection summaries that omit required checks", () => {
    const parsed = dbInspectionSummarySchema.safeParse({
      contractVersion: DB_FACT_SCHEMA_VERSION,
      command: "db:inspect:dev",
      cwd: "/Users/felix/Desktop/felix-projects/openmeld/openmeld/packages/db",
      subject: "shared",
      mode: "dev",
      result: "ready",
      blockedReason: null,
      snapshot: {
        ...authSnapshot,
        subject: "shared",
        mode: "tooling",
      },
      checks: {
        legacyCoreDispatchShape: {
          status: "ok",
          detail: null,
        },
      },
      notes: ["valid note"],
    });
    expect(parsed.success).toBe(false);
  });

  it("rejects db inspection summaries with invalid snapshot fields", () => {
    const parsed = dbInspectionSummarySchema.safeParse({
      contractVersion: DB_FACT_SCHEMA_VERSION,
      command: "db:inspect:dev",
      cwd: "/Users/felix/Desktop/felix-projects/openmeld/openmeld/packages/db",
      subject: "shared",
      mode: "dev",
      result: "ready",
      blockedReason: null,
      snapshot: {
        ...authSnapshot,
        subject: "shared",
        mode: "runtime",
      },
      checks: {
        legacyCoreDispatchShape: {
          status: "ok",
          detail: null,
        },
        sharedCoreDispatchPhysicalContract: {
          status: "ok",
          detail: null,
        },
      },
      notes: ["valid note"],
    });
    expect(parsed.success).toBe(false);
  });
});
