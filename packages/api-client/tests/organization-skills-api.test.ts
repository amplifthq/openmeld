import { describe, expect, it, vi } from "vitest";
import {
  buildOrganizationSkillEnabledPath,
  buildOrganizationSkillGitHubImportPath,
  buildOrganizationSkillGitHubPreviewPath,
  buildOrganizationSkillMaintainersPath,
  buildOrganizationSkillPath,
  buildOrganizationSkillsPath,
  createOpenMeldApiClient,
  createOrganizationSkillsApi,
  type OpenMeldApiClientTransport,
} from "../src";

const SKILL_ID = "skill/with spaces";
const ORGANIZATION_ID = "org-1";
const RELEASE = {
  createdAt: "2026-07-26T08:00:00.000Z",
  createdByUserId: "owner-1",
  digest: "a".repeat(64),
  id: "release-1",
  source: { kind: "created" as const },
};
const BUNDLE = {
  files: [],
  instructions: "# Review support risks",
  portable: {
    allowedTools: null,
    compatibility: null,
    description: "Review support risks every week.",
    license: null,
    metadata: {},
    name: "support-risk-review",
  },
};
const SKILL = {
  activeRelease: RELEASE,
  bundle: BUNDLE,
  createdAt: "2026-07-26T08:00:00.000Z",
  description: BUNDLE.portable.description,
  enabled: true,
  id: SKILL_ID,
  maintainerUserIds: ["maintainer-1"],
  name: BUNDLE.portable.name,
  organizationId: ORGANIZATION_ID,
  permissions: { canEdit: true, canManage: true },
  releases: [RELEASE],
  source: RELEASE.source,
  updatedAt: "2026-07-26T08:00:00.000Z",
  version: 1,
};
const {
  bundle: _,
  maintainerUserIds: __,
  releases: ___,
  ...SKILL_SUMMARY
} = SKILL;

describe("api-client Organization Skills API", () => {
  it("builds encoded Organization Skill routes", () => {
    expect(buildOrganizationSkillsPath()).toBe(
      "/v1/organizations/current/skills"
    );
    expect(buildOrganizationSkillPath(SKILL_ID)).toBe(
      "/v1/organizations/current/skills/skill%2Fwith%20spaces"
    );
    expect(buildOrganizationSkillGitHubImportPath()).toBe(
      "/v1/organizations/current/skills/import-github"
    );
    expect(buildOrganizationSkillGitHubPreviewPath()).toBe(
      "/v1/organizations/current/skills/preview-github"
    );
    expect(buildOrganizationSkillEnabledPath(SKILL_ID)).toBe(
      "/v1/organizations/current/skills/skill%2Fwith%20spaces/enabled"
    );
    expect(buildOrganizationSkillMaintainersPath(SKILL_ID)).toBe(
      "/v1/organizations/current/skills/skill%2Fwith%20spaces/maintainers"
    );
  });

  it("uses the shared API surface for every Organization Skill operation", async () => {
    const skillsUrl =
      "https://gateway.openmeld.invalid/v1/organizations/current/skills";
    const skillUrl = `${skillsUrl}/skill%2Fwith%20spaces`;
    const responseByRoute = new Map<string, () => Response>([
      [
        `GET ${skillsUrl}`,
        () =>
          jsonResponse({
            canManage: true,
            organizationId: ORGANIZATION_ID,
            skills: [SKILL_SUMMARY],
          }),
      ],
      [`GET ${skillUrl}`, () => jsonResponse({ skill: SKILL })],
      [`POST ${skillsUrl}`, () => jsonResponse({ skill: SKILL }, 201)],
      [
        `POST ${skillsUrl}/import-github`,
        () => jsonResponse({ skill: SKILL }, 201),
      ],
      [
        `POST ${skillsUrl}/preview-github`,
        () =>
          jsonResponse({
            organizationId: ORGANIZATION_ID,
            preview: {
              files: [],
              instructionsCharacters: BUNDLE.instructions.length,
              portable: BUNDLE.portable,
              source: {
                commitSha: "b".repeat(40),
                kind: "github",
                path: "support-risk-review",
                repository: "https://github.com/openmeld/example",
              },
              warnings: [],
            },
          }),
      ],
      [`PATCH ${skillUrl}`, () => jsonResponse({ skill: SKILL })],
      [`PATCH ${skillUrl}/enabled`, () => jsonResponse({ skill: SKILL })],
      [`PUT ${skillUrl}/maintainers`, () => jsonResponse({ skill: SKILL })],
      [
        `DELETE ${skillUrl}`,
        () =>
          jsonResponse({
            deleted: true,
            organizationId: ORGANIZATION_ID,
            skillId: SKILL_ID,
          }),
      ],
    ]);
    const transport = vi.fn<OpenMeldApiClientTransport>(
      (call): Promise<Response> => {
        const route = `${call.init?.method ?? "GET"} ${call.url}`;
        const createResponse = responseByRoute.get(route);
        if (!createResponse) {
          throw new Error(
            `Unexpected Organization Skill API request: ${route}`
          );
        }
        return Promise.resolve(createResponse());
      }
    );
    const api = createOrganizationSkillsApi(
      createOpenMeldApiClient({
        baseUrl: "https://gateway.openmeld.invalid",
        transport,
      })
    );

    await api.list();
    await api.get({ skillId: SKILL_ID });
    await api.create({
      description: BUNDLE.portable.description,
      expectedOrganizationId: ORGANIZATION_ID,
      instructions: BUNDLE.instructions,
      name: BUNDLE.portable.name,
    });
    await api.importFromGitHub({
      expectedCommitSha: "b".repeat(40),
      expectedOrganizationId: ORGANIZATION_ID,
      url: "https://github.com/openmeld/example/tree/main/support-risk-review",
    });
    await api.previewFromGitHub({
      expectedOrganizationId: ORGANIZATION_ID,
      url: "https://github.com/openmeld/example/tree/main/support-risk-review",
    });
    await api.update({
      bundle: BUNDLE,
      expectedActiveReleaseId: RELEASE.id,
      expectedOrganizationId: ORGANIZATION_ID,
      expectedVersion: 1,
      skillId: SKILL_ID,
    });
    await api.setEnabled({
      enabled: false,
      expectedOrganizationId: ORGANIZATION_ID,
      expectedVersion: 1,
      skillId: SKILL_ID,
    });
    await api.setMaintainers({
      expectedOrganizationId: ORGANIZATION_ID,
      expectedVersion: 1,
      maintainerUserIds: ["maintainer-1"],
      skillId: SKILL_ID,
    });
    await api.delete({
      expectedOrganizationId: ORGANIZATION_ID,
      expectedVersion: 1,
      skillId: SKILL_ID,
    });

    expect(
      transport.mock.calls.map(([call]) => ({
        body: call.init?.body,
        method: call.init?.method,
        operation: call.operation,
        url: call.url,
      }))
    ).toEqual([
      {
        body: undefined,
        method: "GET",
        operation: "organization_skill.list",
        url: skillsUrl,
      },
      {
        body: undefined,
        method: "GET",
        operation: "organization_skill.get",
        url: skillUrl,
      },
      {
        body: JSON.stringify({
          description: BUNDLE.portable.description,
          expectedOrganizationId: ORGANIZATION_ID,
          instructions: BUNDLE.instructions,
          name: BUNDLE.portable.name,
        }),
        method: "POST",
        operation: "organization_skill.create",
        url: skillsUrl,
      },
      {
        body: JSON.stringify({
          expectedCommitSha: "b".repeat(40),
          expectedOrganizationId: ORGANIZATION_ID,
          url: "https://github.com/openmeld/example/tree/main/support-risk-review",
        }),
        method: "POST",
        operation: "organization_skill.import_github",
        url: `${skillsUrl}/import-github`,
      },
      {
        body: JSON.stringify({
          expectedOrganizationId: ORGANIZATION_ID,
          url: "https://github.com/openmeld/example/tree/main/support-risk-review",
        }),
        method: "POST",
        operation: "organization_skill.preview_github",
        url: `${skillsUrl}/preview-github`,
      },
      {
        body: JSON.stringify({
          bundle: BUNDLE,
          expectedActiveReleaseId: RELEASE.id,
          expectedOrganizationId: ORGANIZATION_ID,
          expectedVersion: 1,
        }),
        method: "PATCH",
        operation: "organization_skill.update",
        url: skillUrl,
      },
      {
        body: JSON.stringify({
          enabled: false,
          expectedOrganizationId: ORGANIZATION_ID,
          expectedVersion: 1,
        }),
        method: "PATCH",
        operation: "organization_skill.set_enabled",
        url: `${skillUrl}/enabled`,
      },
      {
        body: JSON.stringify({
          expectedOrganizationId: ORGANIZATION_ID,
          expectedVersion: 1,
          maintainerUserIds: ["maintainer-1"],
        }),
        method: "PUT",
        operation: "organization_skill.set_maintainers",
        url: `${skillUrl}/maintainers`,
      },
      {
        body: JSON.stringify({
          expectedOrganizationId: ORGANIZATION_ID,
          expectedVersion: 1,
        }),
        method: "DELETE",
        operation: "organization_skill.delete",
        url: skillUrl,
      },
    ]);
  });

  it("fails before transport when a mutation body is invalid", async () => {
    const transport = vi.fn<OpenMeldApiClientTransport>();
    const api = createOrganizationSkillsApi(
      createOpenMeldApiClient({
        baseUrl: "https://gateway.openmeld.invalid",
        transport,
      })
    );

    await expect(
      api.create({
        description: "A valid description",
        expectedOrganizationId: ORGANIZATION_ID,
        instructions: "",
        name: "Not Portable",
      })
    ).rejects.toThrow("Organization Skill create request is invalid.");
    expect(transport).not.toHaveBeenCalled();
  });
});

function jsonResponse(value: unknown, status = 200): Response {
  return new Response(JSON.stringify(value), {
    headers: { "content-type": "application/json" },
    status,
  });
}
