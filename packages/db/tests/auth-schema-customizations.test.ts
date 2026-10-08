import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import { is } from "drizzle-orm";
import { getTableConfig, PgTable } from "drizzle-orm/pg-core";
import { ModuleKind, transpileModule } from "typescript";
import { describe, expect, it } from "vitest";
import { applyAuthSchemaCustomizations } from "../src/tooling/auth-schema-customizations";

// Captured from auth@1.6.30 generate using the real OpenMeld CLI config.
const generated = readFileSync(
  new URL(
    "./fixtures/better-auth-1.6.30-postgresql.schema.txt",
    import.meta.url
  ),
  "utf8"
);

describe("native Better Auth schema generation", () => {
  it("preserves the canonical namespace, fields, native representations, relations, and owner indexes", () => {
    const source = applyAuthSchemaCustomizations(generated);
    const require = createRequire(
      new URL("../src/auth/auth.schema.ts", import.meta.url)
    );
    const module = { exports: {} as Record<string, unknown> };
    const compiled = transpileModule(source, {
      compilerOptions: { module: ModuleKind.CommonJS },
    });
    // Execute the emitted schema as its real consumer does; do not inspect text as proof of the model.
    const load = new Function(
      "require",
      "module",
      "exports",
      compiled.outputText
    );
    load(require, module, module.exports);
    const tables = Object.values(module.exports).filter(
      (value): value is PgTable => is(value, PgTable)
    );
    expect(tables.map((table) => getTableConfig(table).name).sort()).toEqual([
      "accounts",
      "device_codes",
      "invitations",
      "members",
      "organizations",
      "passkeys",
      "sessions",
      "users",
      "verifications",
    ]);
    for (const table of tables) {
      expect(getTableConfig(table).schema).toBe("openmeld");
    }
    const users = module.exports.users as PgTable;
    const columns = getTableConfig(users).columns;
    const emailVerified = columns.find(
      (column) => column.name === "email_verified"
    );
    const createdAt = columns.find((column) => column.name === "created_at");
    expect(columns.find((column) => column.name === "id")?.getSQLType()).toBe(
      "text"
    );
    expect(createdAt?.getSQLType()).toBe("bigint");
    expect(createdAt?.mapFromDriverValue("1700000000000")).toEqual(
      new Date(1_700_000_000_000)
    );
    expect(createdAt?.mapToDriverValue(new Date(1_700_000_000_000))).toBe(
      "1700000000000"
    );
    expect(emailVerified?.getSQLType()).toBe("integer");
    expect(emailVerified?.mapFromDriverValue(0)).toBe(false);
    expect(emailVerified?.mapToDriverValue(true)).toBe(1);
    expect(columns.map((column) => column.name)).toContain(
      "last_selected_organization_id"
    );
    const organizations = getTableConfig(
      module.exports.organizations as PgTable
    );
    expect(
      organizations.indexes.map((index) => index.config.name).sort()
    ).toEqual([
      "organizations_personal_created_by_user_uidx",
      "organizations_slug_uidx",
    ]);
    expect(organizations.indexes.every((index) => index.config.unique)).toBe(
      true
    );
    expect(
      organizations.indexes.find(
        (index) =>
          index.config.name === "organizations_personal_created_by_user_uidx"
      )?.config.where
    ).toBeDefined();
    expect(
      getTableConfig(
        module.exports.sessions as PgTable
      ).foreignKeys[0]?.reference().foreignTable
    ).toBe(users);
    expect(module.exports.usersRelations).toBeDefined();
  });

  it("leaves the canonical schema unchanged when the official tool cannot run", () => {
    const schema = new URL("../src/auth/auth.schema.ts", import.meta.url);
    const before = readFileSync(schema, "utf8");
    const result = spawnSync(
      process.execPath,
      ["--experimental-strip-types", "scripts/auth-generate.ts"],
      {
        cwd: fileURLToPath(new URL("../", import.meta.url)),
        env: { ...process.env, PATH: "" },
        encoding: "utf8",
      }
    );
    expect(result.status).toBe(1);
    expect(result.stderr).toContain("ENOENT");
    expect(readFileSync(schema, "utf8")).toBe(before);
  });

  it.each([
    generated.replace(
      'export const organizations = pgTable("organizations", {',
      'export const organizations = pgTable("renamed", {'
    ),
    "export const users = {};",
  ])("rejects unsupported official output before it can replace the canonical model", (source) => {
    expect(() => applyAuthSchemaCustomizations(source)).toThrow(
      "supported contract"
    );
  });
});
