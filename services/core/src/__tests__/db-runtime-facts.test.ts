import { describe, expect, it } from "vitest";
import { inspectCoreDbState } from "../db/runtime-facts";

describe("core runtime db facts", () => {
  it("does not expose retired runtime fallback fields after the shared DB gate takes ownership", () => {
    const snapshot = inspectCoreDbState({
      OPENMELD_POSTGRESQL: {
        connectionString:
          "postgresql://127.0.0.1:1/unexpected_test_database_access",
      },
    });

    expect(snapshot.subject).toBe("core");
    expect(snapshot.schemaSources.map((item) => item.path)).toEqual([
      "packages/db/src/schema.ts",
    ]);
    expect(snapshot.migrationSources.map((item) => item.path)).toEqual([
      "packages/db/postgresql/migrations",
    ]);
    expect(snapshot.target.databaseId).toBeNull();
    expect(snapshot.target.databaseName).toBeNull();
    expect(snapshot.target.resolvedFrom).toBe("runtime_binding_present");
    expect("declaredFallbackPaths" in snapshot).toBe(false);
    expect("observedFallbackHits" in snapshot).toBe(false);
  });

  it("reports when the current core runtime does not have a PostgreSQL binding", () => {
    const snapshot = inspectCoreDbState({});

    expect(snapshot.target.databaseId).toBeNull();
    expect(snapshot.target.databaseName).toBeNull();
    expect(snapshot.target.resolvedFrom).toBe("runtime_binding_missing");
  });
});
