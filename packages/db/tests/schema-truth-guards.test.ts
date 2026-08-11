import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const repoRootDirectoryPath = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../../.."
);
const CORE_CANONICAL_DDL_ARRAY_PATTERN =
  /const\s+(OPENMELD_DAEMON_DISPATCH_SCHEMA_OBJECTS|DISPATCH_RESULT_SCHEMA_OBJECTS)\s*=/;

const readRepoFile = (relativePath: string): string => {
  return fs.readFileSync(
    path.resolve(repoRootDirectoryPath, relativePath),
    "utf8"
  );
};

describe("schema truth guards", () => {
  it("keeps packages/auth db files as compat wrappers without local schema truth", () => {
    const compatFiles = [
      "packages/auth/src/db/openmeld-profile.schema.ts",
      "packages/auth/src/db/auth.schema.ts",
      "packages/auth/src/db/index.ts",
      "packages/auth/src/db/profile-space-history.schema.ts",
      "packages/auth/src/db/schema.ts",
      "packages/auth/src/db/space-deletion-tombstone.schema.ts",
      "packages/auth/src/db/waitlist-email.schema.ts",
    ];

    for (const relativePath of compatFiles) {
      const source = readRepoFile(relativePath);
      expect(source).not.toContain("sqliteTable(");
      expect(source).not.toContain("drizzle(");
      expect(source).not.toContain("export const schema =");
      expect(source).toContain("@openmeld/db/auth");
    }
  });

  it("keeps core dispatch runtime files free of local canonical DDL truth", () => {
    const runtimeFiles = [
      "services/core/src/dispatch/infrastructure/d1/dispatch-ledger-d1.ts",
      "services/core/src/dispatch/infrastructure/d1/dispatch-result-repo.ts",
    ];

    for (const relativePath of runtimeFiles) {
      const source = readRepoFile(relativePath);
      expect(source).not.toContain(
        "CREATE TABLE IF NOT EXISTS openMeldDaemon_"
      );
      expect(source).not.toContain("ALTER TABLE openMeldDaemon_");
      expect(source).not.toContain("recordObservedFallbackHit");
      expect(source).not.toContain("ensureOpenMeldDaemonDispatch");
      expect(source).not.toMatch(CORE_CANONICAL_DDL_ARRAY_PATTERN);
    }
  });

  it("does not keep a second handwritten core DDL truth alongside shared migrations", () => {
    expect(
      fs.existsSync(
        path.resolve(
          repoRootDirectoryPath,
          "packages/db/src/core/dispatch-ddl.ts"
        )
      )
    ).toBe(false);

    const migrateToolSource = readRepoFile(
      "packages/db/src/tooling/auth-db-migrate.ts"
    );
    expect(migrateToolSource).not.toContain("reconcileCoreDispatchSchema");
    expect(migrateToolSource).not.toContain(
      "OPENMELD_DAEMON_ALL_DISPATCH_SCHEMA_OBJECTS"
    );
    expect(migrateToolSource).not.toContain(
      "OPENMELD_DAEMON_ALL_DISPATCH_COLUMN_PATCHES"
    );
    expect(migrateToolSource).not.toContain(
      "prepareLegacyCoreDispatchColumnsForSharedMigration"
    );
  });

  it("does not keep a pre-apply shared DB schema mutation helper in DB tooling", () => {
    expect(
      fs.existsSync(
        path.resolve(
          repoRootDirectoryPath,
          "packages/db/src/tooling/shared-db-legacy-column-adoption.ts"
        )
      )
    ).toBe(false);

    for (const relativePath of [
      "packages/db/src/tooling/auth-db-migrate.ts",
      "packages/db/src/tooling/shared-db-migrate.ts",
      "packages/db/src/tooling/shared-db-unsupported-legacy-shape.ts",
    ]) {
      const source = readRepoFile(relativePath);
      expect(source).not.toContain("ALTER TABLE `openMeldDaemon_");
    }
  });

  it("does not keep retired runtime fallback diagnostics files in packages/db", () => {
    expect(
      fs.existsSync(
        path.resolve(
          repoRootDirectoryPath,
          "packages/db/src/registry/fallback-registry.ts"
        )
      )
    ).toBe(false);
    expect(
      fs.existsSync(
        path.resolve(
          repoRootDirectoryPath,
          "packages/db/src/diagnostics/fallback-hit-recorder.ts"
        )
      )
    ).toBe(false);
  });
});
