import { describe, expect, it } from "vitest";
import { inspectCoreDbState } from "../db/runtime-facts";
import type { CoreBindings } from "../lib/bindings";

describe("core runtime db facts", () => {
  it("does not expose retired runtime fallback fields after the shared DB gate takes ownership", () => {
    const snapshot = inspectCoreDbState({
      OPENMELD_DB: {} as D1Database,
    } as CoreBindings);

    expect(snapshot.subject).toBe("core");
    expect(snapshot.schemaSources.map((item) => item.path)).toEqual([
      "packages/db/src/core/inbox.schema.ts",
      "packages/db/src/core/organization-information-protection.schema.ts",
      "packages/db/src/core/center-agent-tasks.schema.ts",
      "packages/db/src/core/center-agent-member-research.schema.ts",
      "packages/db/src/core/organization-document.schema.ts",
      "packages/db/src/core/organization-document-operation.schema.ts",
      "packages/db/src/core/center-agent-publication.schema.ts",
      "packages/db/src/core/eval-report.schema.ts",
      "packages/db/src/core/agent-activity.schema.ts",
      "packages/db/src/core/project.schema.ts",
      "packages/db/src/core/routine.schema.ts",
      "packages/db/src/core/connector-connection.schema.ts",
      "packages/db/src/core/dispatch.schema.ts",
      "packages/db/src/core/space-index.schema.ts",
      "packages/db/src/core/space-attachment.schema.ts",
      "packages/db/src/core/feedback.schema.ts",
    ]);
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
