import { describe, expect, it } from "vitest";
import { applyAuthSchemaCustomizations } from "../src/tooling/auth-schema-customizations";

const generatedSchema = `export const organizations = sqliteTable(
  "organizations",
  {},
  (table) => [uniqueIndex("organizations_slug_uidx").on(table.slug)],
);`;

describe("Better Auth schema customizations", () => {
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
