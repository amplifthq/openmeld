import { describe, expect, it } from "vitest";
import {
  organizationSkillBundleSchema,
  organizationSkillRuntimeSnapshotResponseSchema,
  updateOrganizationSkillBodySchema,
} from "../../src/schemas/http/organization-skills";

const bundle = {
  files: [
    {
      content: "# Checklist",
      encoding: "utf8",
      mediaType: "text/markdown",
      path: "references/checklist.md",
      size: 11,
    },
  ],
  instructions: "Follow the checklist.",
  portable: {
    allowedTools: null,
    compatibility: null,
    description: "Review a release.",
    license: null,
    metadata: {},
    name: "release-review",
  },
};

describe("Organization Skill contracts", () => {
  it("accepts a portable exact-release runtime snapshot", () => {
    expect(
      organizationSkillRuntimeSnapshotResponseSchema.parse({
        organizationId: "org_123",
        releases: [
          {
            bundle,
            digest: "a".repeat(64),
            releaseId: "release_123",
            skillId: "skill_123",
          },
        ],
      })
    ).toMatchObject({ organizationId: "org_123" });
  });

  it("rejects unsafe and normalized duplicate bundle paths", () => {
    expect(() =>
      organizationSkillBundleSchema.parse({
        ...bundle,
        files: [
          bundle.files[0],
          { ...bundle.files[0], path: "../secrets.txt" },
        ],
      })
    ).toThrow();
    expect(() =>
      organizationSkillBundleSchema.parse({
        ...bundle,
        files: [
          { ...bundle.files[0], path: "references/café.md" },
          { ...bundle.files[0], path: "references/café.md" },
        ],
      })
    ).toThrow();
  });

  it("verifies encoded file bytes instead of trusting declared sizes", () => {
    expect(() =>
      organizationSkillBundleSchema.parse({
        ...bundle,
        files: [{ ...bundle.files[0], size: 10 }],
      })
    ).toThrow("Skill file size does not match its content.");
    expect(() =>
      organizationSkillBundleSchema.parse({
        ...bundle,
        files: [
          {
            content: "not base64!",
            encoding: "base64",
            mediaType: "application/octet-stream",
            path: "asset.bin",
            size: 7,
          },
        ],
      })
    ).toThrow("Skill file content is not valid base64.");
  });

  it("requires optimistic concurrency for every save", () => {
    expect(() =>
      updateOrganizationSkillBodySchema.parse({
        bundle,
        expectedOrganizationId: "org_123",
        expectedVersion: 1,
      })
    ).toThrow();
  });
});
