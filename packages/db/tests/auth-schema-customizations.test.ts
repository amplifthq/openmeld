import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { applyAuthSchemaCustomizations } from "../src/tooling/auth-schema-customizations";

const generatedSchema = `export const organizations = sqliteTable(
  "organizations",
  {},
  (table) => [uniqueIndex("organizations_slug_uidx").on(table.slug)],
);`;

describe("historical Better Auth D1 schema customizations", () => {
  it("rejects the retired generator before invoking external tools or replacing the PostgreSQL schema", () => {
    const schemaPath = new URL("../src/auth/auth.schema.ts", import.meta.url);
    const before = readFileSync(schemaPath, "utf8");
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
    expect(result.stderr).toContain(
      "Historical Better Auth D1 schema generation is retired"
    );
    expect(result.stderr).not.toContain("ENOENT");
    expect(readFileSync(schemaPath, "utf8")).toBe(before);
  });
  it("adds the canonical personal Organization owner index", () => {
    const customizedSchema = applyAuthSchemaCustomizations(generatedSchema);

    expect(customizedSchema).toContain(
      'uniqueIndex("organizations_personal_created_by_user_uidx")'
    );
    expect(customizedSchema).toContain("json_valid");
    expect(customizedSchema).toContain("json_extract");
  });

  it("is idempotent", () => {
    const customizedSchema = applyAuthSchemaCustomizations(generatedSchema);

    expect(applyAuthSchemaCustomizations(customizedSchema)).toBe(
      customizedSchema
    );
  });

  it("fails when upstream generation no longer matches", () => {
    expect(() =>
      applyAuthSchemaCustomizations("export const users = {};")
    ).toThrow(
      "Generated Better Auth Organization schema did not match the expected index block."
    );
  });
});
