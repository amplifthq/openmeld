import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const repoRootDirectoryPath = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../../.."
);

const readRepoFile = (relativePath: string): string => {
  return fs.readFileSync(
    path.resolve(repoRootDirectoryPath, relativePath),
    "utf8"
  );
};

const readSharedMigrationSources = (): string => {
  const migrationDirectoryPath = path.resolve(
    repoRootDirectoryPath,
    "packages/db/drizzle"
  );

  return fs
    .readdirSync(migrationDirectoryPath)
    .filter((entry) => entry.endsWith(".sql"))
    .sort((left, right) => left.localeCompare(right))
    .map((entry) => readRepoFile(`packages/db/drizzle/${entry}`))
    .join("\n");
};

describe("dispatch owner evidence storage schema", () => {
  it("keeps creation-time dispatch owner evidence on the dispatch ledger", () => {
    const schemaSource = readRepoFile(
      "packages/db/src/core/dispatch.schema.ts"
    );
    const migrationSource = readSharedMigrationSources();

    expect(schemaSource).toContain('text("dispatch_owner_kind")');
    expect(schemaSource).toContain('text("dispatch_owner_id")');
    expect(migrationSource).toContain("`dispatch_owner_kind` text");
    expect(migrationSource).toContain("`dispatch_owner_id` text");
  });
});
