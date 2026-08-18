import { getCoreDbSchemaSources } from "@openmeld/db/core";
import { describe, expect, it } from "vitest";
import { inspectCoreDbState } from "../db/runtime-facts";
import type { CoreBindings } from "../lib/bindings";

describe("core runtime db facts", () => {
  it("does not expose retired runtime fallback fields after the shared DB gate takes ownership", () => {
    const snapshot = inspectCoreDbState({
      OPENMELD_DB: {} as D1Database,
    } as CoreBindings);

    expect(snapshot.subject).toBe("core");
    expect(snapshot.schemaSources).toEqual(getCoreDbSchemaSources());
    expect(snapshot.migrationSources.map((item) => item.path)).toEqual([
      "packages/db/drizzle",
    ]);
    expect(snapshot.target.databaseId).toBeNull();
    expect(snapshot.target.databaseName).toBeNull();
    expect(snapshot.target.resolvedFrom).toBe("runtime_binding_present");
    expect("declaredFallbackPaths" in snapshot).toBe(false);
    expect("observedFallbackHits" in snapshot).toBe(false);
  });

  it("reports when the current core runtime does not have an OPENMELD_DB binding", () => {
    const snapshot = inspectCoreDbState({});

    expect(snapshot.target.databaseId).toBeNull();
    expect(snapshot.target.databaseName).toBeNull();
    expect(snapshot.target.resolvedFrom).toBe("runtime_binding_missing");
  });
});
