import { describe, expect, it, vi } from "vitest";
import app from "../src/index";

const PROFILE_ID = "11111111-1111-4111-8111-111111111111";
const SKILL_ID = "skill-1";
const RELEASE_ID = "release-1";
const BUNDLE = {
  files: [],
  instructions: "Review the release evidence.",
  portable: {
    allowedTools: null,
    compatibility: null,
    description: "Review a release before it ships.",
    license: null,
    metadata: {},
    name: "release-review",
  },
};
const RELEASE = {
  createdAt: "2026-07-26T00:00:00.000Z",
  createdByUserId: "owner-1",
  digest: "a".repeat(64),
  id: RELEASE_ID,
  source: { kind: "created" as const },
};
const SKILL = {
  activeRelease: RELEASE,
  bundle: BUNDLE,
  createdAt: "2026-07-26T00:00:00.000Z",
  description: BUNDLE.portable.description,
  enabled: true,
  id: SKILL_ID,
  maintainerUserIds: [],
  name: BUNDLE.portable.name,
  organizationId: "org-1",
  permissions: { canEdit: true, canManage: true },
  releases: [RELEASE],
  source: { kind: "created" as const },
  updatedAt: "2026-07-26T00:00:00.000Z",
  version: 1,
};
const GITHUB_PREVIEW = {
  files: [],
  instructionsCharacters: BUNDLE.instructions.length,
  portable: BUNDLE.portable,
  source: {
    commitSha: "b".repeat(40),
    kind: "github" as const,
    path: "release-review",
    repository: "https://github.com/acme/skills",
  },
  warnings: [],
};

const TEST_EXECUTION_CONTEXT = {
  exports: {},
  passThroughOnException: () => undefined,
  props: {},
  waitUntil: () => undefined,
} as unknown as ExecutionContext;

describe("Organization Skill routes", () => {
  it("forwards the complete management surface to Core", async () => {
    const { coreRpc, env } = makeEnv();
    const route = `http://local/v1/organizations/current/skills/${SKILL_ID}`;
    const responses = await Promise.all([
      app.fetch(
        new Request("http://local/v1/organizations/current/skills"),
        env,
        TEST_EXECUTION_CONTEXT
      ),
      app.fetch(new Request(route), env, TEST_EXECUTION_CONTEXT),
      app.fetch(
        jsonRequest("http://local/v1/organizations/current/skills", "POST", {
          description: BUNDLE.portable.description,
          expectedOrganizationId: "org-1",
          instructions: BUNDLE.instructions,
          name: BUNDLE.portable.name,
        }),
        env,
        TEST_EXECUTION_CONTEXT
      ),
      app.fetch(
        jsonRequest(
          "http://local/v1/organizations/current/skills/import-github",
          "POST",
          {
            expectedOrganizationId: "org-1",
            url: "https://github.com/acme/skills/tree/main/release-review",
          }
        ),
        env,
        TEST_EXECUTION_CONTEXT
      ),
      app.fetch(
        jsonRequest(
          "http://local/v1/organizations/current/skills/preview-github",
          "POST",
          {
            expectedOrganizationId: "org-1",
            url: "https://github.com/acme/skills/tree/main/release-review",
          }
        ),
        env,
        TEST_EXECUTION_CONTEXT
      ),
      app.fetch(
        jsonRequest(route, "PATCH", {
          bundle: BUNDLE,
          expectedActiveReleaseId: RELEASE_ID,
          expectedOrganizationId: "org-1",
          expectedVersion: 1,
        }),
        env,
        TEST_EXECUTION_CONTEXT
      ),
      app.fetch(
        jsonRequest(`${route}/enabled`, "PATCH", {
          enabled: false,
          expectedOrganizationId: "org-1",
          expectedVersion: 1,
        }),
        env,
        TEST_EXECUTION_CONTEXT
      ),
      app.fetch(
        jsonRequest(`${route}/maintainers`, "PUT", {
          expectedOrganizationId: "org-1",
          expectedVersion: 1,
          maintainerUserIds: ["member-1"],
        }),
        env,
        TEST_EXECUTION_CONTEXT
      ),
      app.fetch(
        jsonRequest(route, "DELETE", {
          expectedOrganizationId: "org-1",
          expectedVersion: 1,
        }),
        env,
        TEST_EXECUTION_CONTEXT
      ),
    ]);

    expect(responses.map((response) => response.status)).toEqual([
      200, 200, 201, 201, 200, 200, 200, 200, 200,
    ]);
    expect(coreRpc.listOrganizationSkills).toHaveBeenCalledWith({
      context: expect.objectContaining({ activeOrganizationId: "org-1" }),
    });
    expect(coreRpc.getOrganizationSkill).toHaveBeenCalledWith(
      expect.objectContaining({ skillId: SKILL_ID })
    );
    expect(coreRpc.createOrganizationSkill).toHaveBeenCalledWith(
      expect.objectContaining({
        expectedOrganizationId: "org-1",
        name: BUNDLE.portable.name,
      })
    );
    expect(coreRpc.importOrganizationSkillFromGitHub).toHaveBeenCalledWith(
      expect.objectContaining({
        expectedOrganizationId: "org-1",
        url: "https://github.com/acme/skills/tree/main/release-review",
      })
    );
    expect(coreRpc.previewOrganizationSkillFromGitHub).toHaveBeenCalledWith(
      expect.objectContaining({
        expectedOrganizationId: "org-1",
        url: "https://github.com/acme/skills/tree/main/release-review",
      })
    );
    expect(coreRpc.updateOrganizationSkill).toHaveBeenCalledWith(
      expect.objectContaining({
        expectedActiveReleaseId: RELEASE_ID,
        skillId: SKILL_ID,
      })
    );
    expect(coreRpc.setOrganizationSkillEnabled).toHaveBeenCalledWith(
      expect.objectContaining({ enabled: false, skillId: SKILL_ID })
    );
    expect(coreRpc.setOrganizationSkillMaintainers).toHaveBeenCalledWith(
      expect.objectContaining({
        expectedVersion: 1,
        maintainerUserIds: ["member-1"],
        skillId: SKILL_ID,
      })
    );
    expect(coreRpc.deleteOrganizationSkill).toHaveBeenCalledWith(
      expect.objectContaining({ skillId: SKILL_ID })
    );
  });

  it("rejects an invalid bundle before Core", async () => {
    const { coreRpc, env } = makeEnv();
    const response = await app.fetch(
      jsonRequest(
        `http://local/v1/organizations/current/skills/${SKILL_ID}`,
        "PATCH",
        {
          bundle: {
            ...BUNDLE,
            files: [
              {
                content: "secret",
                encoding: "utf8",
                mediaType: "text/plain",
                path: "../secret",
                size: 6,
              },
            ],
          },
          expectedActiveReleaseId: RELEASE_ID,
          expectedOrganizationId: "org-1",
          expectedVersion: 1,
        }
      ),
      env,
      TEST_EXECUTION_CONTEXT
    );

    expect(response.status).toBe(400);
    expect(coreRpc.updateOrganizationSkill).not.toHaveBeenCalled();
  });
});

function makeEnv() {
  const coreRpc = {
    createOrganizationSkill: vi.fn(async () => ({ skill: SKILL })),
    deleteOrganizationSkill: vi.fn(async () => ({
      deleted: true,
      organizationId: "org-1",
      skillId: SKILL_ID,
    })),
    getOrganizationSkill: vi.fn(async () => ({ skill: SKILL })),
    importOrganizationSkillFromGitHub: vi.fn(async () => ({ skill: SKILL })),
    listOrganizationSkills: vi.fn(async () => ({
      canManage: true,
      organizationId: "org-1",
      skills: [
        {
          activeRelease: SKILL.activeRelease,
          createdAt: SKILL.createdAt,
          description: SKILL.description,
          enabled: SKILL.enabled,
          id: SKILL.id,
          name: SKILL.name,
          organizationId: SKILL.organizationId,
          permissions: SKILL.permissions,
          source: SKILL.source,
          updatedAt: SKILL.updatedAt,
          version: SKILL.version,
        },
      ],
    })),
    previewOrganizationSkillFromGitHub: vi.fn(async () => ({
      organizationId: "org-1",
      preview: GITHUB_PREVIEW,
    })),
    setOrganizationSkillEnabled: vi.fn(async () => ({
      skill: { ...SKILL, enabled: false, version: 2 },
    })),
    setOrganizationSkillMaintainers: vi.fn(async () => ({
      skill: { ...SKILL, maintainerUserIds: ["member-1"], version: 2 },
    })),
    updateOrganizationSkill: vi.fn(async () => ({ skill: SKILL })),
  };
  const authResult = {
    claims: {
      activeOrganizationId: "org-1",
      authenticated: true,
      authMethod: "session",
      ownerIds: ["owner-1"],
      requestId: "req-skill-route",
    },
    ok: true,
  } as const;
  const resolvedProfile = {
    ownerUserId: "owner-1",
    profileKind: "human" as const,
    profileName: "Mira",
    openMeldProfileId: PROFILE_ID,
  };
  const authRpc = {
    resolveProfile: vi.fn(async () => ({ ok: true, resolvedProfile })),
    resolveRequestAuth: vi.fn(async () => authResult),
    resolveRequestAuthWithProfile: vi.fn(async () => ({
      ...authResult,
      profile: { ok: true, resolvedProfile },
    })),
  };
  return {
    coreRpc,
    env: {
      OPENMELD_AUTH_WORKER: authRpc,
      OPENMELD_CORE_WORKER: coreRpc,
    } as unknown as CloudflareBindings,
  };
}

function jsonRequest(
  url: string,
  method: "DELETE" | "PATCH" | "POST" | "PUT",
  body: unknown
): Request {
  return new Request(url, {
    body: JSON.stringify(body),
    headers: { "content-type": "application/json" },
    method,
  });
}
