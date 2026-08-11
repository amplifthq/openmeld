import { createHash } from "node:crypto";
import type { OrganizationSkillsApi } from "@openmeld/api-client";
import { stringifyOrganizationSkillBundleCanonicalJson } from "@openmeld/schemas";
import type {
  OrganizationSkill,
  OrganizationSkillBundle,
} from "@openmeld/schemas/types";
import { describe, expect, it, vi } from "vitest";
import type {
  StoredActiveOrganization,
  StoredAuthSession,
} from "../src/config/auth-session";
import type { OpenMeldProfile } from "../src/config/openmeld-profiles-api";
import {
  type OrganizationSkillsCommandDependencies,
  runOrganizationSkillsList,
  runOrganizationSkillsLoad,
  runOrganizationSkillsShow,
} from "../src/organization-skills/command";
import { withCapturedStdio, withTempHome } from "./helpers/fs";

const organization: StoredActiveOrganization = {
  id: "org-1",
  name: "Acme",
  role: "member",
  slug: "acme",
};

const bundle: OrganizationSkillBundle = {
  files: [],
  instructions: "# Review\n\nFollow the exact checklist.",
  portable: {
    allowedTools: null,
    compatibility: null,
    description: "Review one release consistently.",
    license: null,
    metadata: {},
    name: "release-review",
  },
};

const skill: OrganizationSkill = {
  activeRelease: {
    createdAt: "2026-07-26T00:00:00.000Z",
    createdByUserId: "user-1",
    digest: createHash("sha256")
      .update(stringifyOrganizationSkillBundleCanonicalJson(bundle))
      .digest("hex"),
    id: "release-1",
    source: { kind: "created" },
  },
  bundle,
  createdAt: "2026-07-26T00:00:00.000Z",
  description: bundle.portable.description,
  enabled: true,
  id: "skill-1",
  maintainerUserIds: [],
  name: bundle.portable.name,
  organizationId: organization.id,
  permissions: {
    canEdit: false,
    canManage: false,
  },
  releases: [],
  source: { kind: "created" },
  updatedAt: "2026-07-26T00:00:00.000Z",
  version: 1,
};

describe("Organization Skills CLI", () => {
  it("lists the active Organization catalog in Agent View", async () => {
    await withTempHome(async () => {
      const { dependencies, list } = createDependencies();
      const { plainStdout } = await withCapturedStdio(async () => {
        await runOrganizationSkillsList({ view: "agent" }, dependencies);
      });

      expect(list).toHaveBeenCalledOnce();
      expect(plainStdout).toContain('"code":"skills.list"');
      expect(plainStdout).toContain('"organizationId":"org-1"');
      expect(plainStdout).toContain('"name":"release-review"');
    });
  });

  it("resolves a Skill by portable name and emits the strict JSON contract", async () => {
    await withTempHome(async () => {
      const { dependencies, get } = createDependencies();
      const { plainStdout } = await withCapturedStdio(async () => {
        await runOrganizationSkillsShow(
          {
            json: true,
            skill: "release-review",
            view: "human",
          },
          dependencies
        );
      });

      expect(get).toHaveBeenCalledWith(
        expect.objectContaining({ skillId: "skill-1" })
      );
      expect(JSON.parse(plainStdout)).toEqual(
        expect.objectContaining({
          schemaVersion: 1,
          type: "skills.show",
          skill: expect.objectContaining({
            id: "skill-1",
            name: "release-review",
          }),
        })
      );
    });
  });

  it("loads an enabled exact release without installing it globally", async () => {
    await withTempHome(async (home) => {
      const { dependencies } = createDependencies();
      const { plainStdout } = await withCapturedStdio(async () => {
        await runOrganizationSkillsLoad(
          {
            skill: "skill-1",
            view: "agent",
          },
          dependencies
        );
      });

      const result = JSON.parse(plainStdout) as {
        payload: {
          organizationId: string;
          releaseId: string;
          skillMarkdownPath: string;
        };
      };
      expect(result.payload).toEqual(
        expect.objectContaining({
          organizationId: "org-1",
          releaseId: "release-1",
          skillMarkdownPath: expect.stringContaining(
            "/organization-skills/org-1/skill-1/release-1/SKILL.md"
          ),
        })
      );
      expect(result.payload.skillMarkdownPath).toContain(home);
      expect(result.payload.skillMarkdownPath).not.toContain(
        "/.agents/skills/"
      );
    });
  });

  it("does not load a disabled Skill", async () => {
    await withTempHome(async () => {
      const { dependencies } = createDependencies({
        ...skill,
        enabled: false,
      });
      await expect(
        runOrganizationSkillsLoad(
          {
            skill: "skill-1",
            view: "agent",
          },
          dependencies
        )
      ).rejects.toThrow("is disabled");
    });
  });
});

function createDependencies(selectedSkill: OrganizationSkill = skill): {
  dependencies: Partial<OrganizationSkillsCommandDependencies>;
  get: ReturnType<typeof vi.fn>;
  list: ReturnType<typeof vi.fn>;
} {
  const list = vi.fn(async () => ({
    canManage: false,
    organizationId: organization.id,
    skills: [
      {
        activeRelease: selectedSkill.activeRelease,
        createdAt: selectedSkill.createdAt,
        description: selectedSkill.description,
        enabled: selectedSkill.enabled,
        id: selectedSkill.id,
        name: selectedSkill.name,
        organizationId: selectedSkill.organizationId,
        permissions: selectedSkill.permissions,
        source: selectedSkill.source,
        updatedAt: selectedSkill.updatedAt,
        version: selectedSkill.version,
      },
    ],
  }));
  const get = vi.fn(async () => ({ skill: selectedSkill }));
  const api = {
    get,
    list,
  } as unknown as OrganizationSkillsApi;
  return {
    dependencies: {
      getAuthState: async () => ({
        session: createSession(),
        state: "valid",
      }),
      resolveApi: async () => api,
      resolveHumanProfile: async () => createHumanProfile(),
    },
    get,
    list,
  };
}

function createSession(): StoredAuthSession {
  return {
    accessToken: "test-token",
    activeOrganization: organization,
    authBaseUrl: "https://auth.example.com",
    clientId: "test-client",
    createdAt: "2026-07-26T00:00:00.000Z",
    tokenType: "Bearer",
    user: {
      id: "user-1",
    },
    v: 1,
  };
}

function createHumanProfile(): OpenMeldProfile {
  return {
    createdAt: "2026-07-26T00:00:00.000Z",
    createdByUserId: "user-1",
    lastUsedAt: null,
    ownerUserId: "user-1",
    profileHandle: "@felix",
    profileKind: "human",
    profileName: "Felix",
    source: "test",
    status: "active",
    updatedAt: "2026-07-26T00:00:00.000Z",
    openMeldProfileId: "human-1",
  };
}
