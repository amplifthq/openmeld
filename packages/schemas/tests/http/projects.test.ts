import { describe, expect, it } from "vitest";
import {
  archiveProjectBodySchema,
  createProjectBodySchema,
  createProjectRpcInputSchema,
  listProjectsQuerySchema,
  projectSchema,
  updateProjectBodySchema,
} from "../../src";

const VALID_RPC_CONTEXT = {
  activeOrganizationId: "org-1",
  actorContext: {
    callerPrincipalId: "user-1",
    ownerUserId: "user-1",
    profileKind: "human" as const,
    requestId: "request-projects",
    openMeldProfileId: "11111111-1111-4111-8111-111111111111",
  },
};

describe("Project contracts", () => {
  it("accepts creation with or without an explicit CLI slug", () => {
    expect(
      createProjectBodySchema.safeParse({
        expectedOrganizationId: "org-1",
        name: "OpenMeld",
      })
    ).toMatchObject({ success: true });
    expect(
      createProjectBodySchema.safeParse({
        expectedOrganizationId: "org-1",
        name: "OpenMeld",
        repositoryFingerprint:
          "sha256:504348ce28faa64ec08482e9139c257e5fb68ff1790c9e5a01e9fd9b3a400136",
        repositoryUrl: "https://github.com/openmeld/openmeld",
        slug: "openmeld",
      })
    ).toMatchObject({ success: true });
  });

  it.each([
    "absolutePath",
    "canonicalRepoUrl",
    "cwd",
  ])("rejects cloud storage field %s", (forbiddenField) => {
    expect(
      createProjectBodySchema.safeParse({
        [forbiddenField]: "/Users/example/private/work",
        expectedOrganizationId: "org-1",
        name: "OpenMeld",
      })
    ).toMatchObject({ success: false });
  });

  it("keeps Project authority projections explicit and strict", () => {
    const project = {
      archivedAtMs: null,
      canArchive: false,
      canManage: true,
      createdAtMs: 1_783_892_400_000,
      createdByUserId: "user-1",
      id: "project-1",
      name: "OpenMeld",
      organizationId: "org-1",
      repositoryFingerprint: null,
      repositoryUrl: null,
      slug: "openmeld",
      updatedAtMs: 1_783_892_400_000,
    };
    expect(projectSchema.safeParse(project)).toMatchObject({ success: true });
    expect(
      projectSchema.safeParse({ ...project, unexpected: true })
    ).toMatchObject({ success: false });
  });

  it("keeps list, update, and archive intent strict", () => {
    expect(
      listProjectsQuerySchema.safeParse({ includeArchived: "true" })
    ).toMatchObject({ success: false });
    expect(updateProjectBodySchema.safeParse({})).toMatchObject({
      success: false,
    });
    expect(
      updateProjectBodySchema.safeParse({
        expectedOrganizationId: "org-1",
        repositoryFingerprint: null,
        repositoryUrl: null,
      })
    ).toMatchObject({ success: true });
    expect(
      archiveProjectBodySchema.safeParse({
        expectedOrganizationId: "org-1",
        force: true,
      })
    ).toMatchObject({ success: false });
  });

  it("keeps Project RPC inputs strict and Organization-scoped", () => {
    const input = {
      context: VALID_RPC_CONTEXT,
      expectedOrganizationId: "org-1",
      name: "OpenMeld",
    };
    expect(createProjectRpcInputSchema.safeParse(input)).toMatchObject({
      success: true,
    });
    expect(
      createProjectRpcInputSchema.safeParse({
        ...input,
        organizationId: "org-2",
      })
    ).toMatchObject({ success: false });
  });
});
