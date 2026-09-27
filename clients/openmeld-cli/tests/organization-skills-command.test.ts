import { createHash } from "node:crypto";
import { mkdir, readFile, symlink, writeFile } from "node:fs/promises";
import { join } from "node:path";
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
  runOrganizationSkillsAdd,
  runOrganizationSkillsAddAll,
  runOrganizationSkillsList,
  runOrganizationSkillsLoad,
  runOrganizationSkillsScan,
  runOrganizationSkillsShow,
} from "../src/organization-skills/command";
import { readLocalSkillFiles } from "../src/organization-skills/local-source";
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
  it("returns a failing process status after a JSON batch with no successful installs", async () => {
    await withTempHome(async () => {
      const previousExitCode = process.exitCode;
      process.exitCode = undefined;
      try {
        const commitSha = "a".repeat(40);
        const repository = "https://github.com/example/skills";
        const { dependencies } = createDependencies();
        const preview = {
          catalogLimitBytes: 1024,
          commitSha,
          repository,
          skills: [
            {
              blocker: null,
              fileCount: 1,
              path: "broken",
              totalBytes: 100,
              url: `${repository}/tree/${commitSha}/broken`,
              warnings: [],
            },
          ],
          totalDeclaredBytes: 100,
          warnings: [],
        };
        let batchId = "";
        const resolveApi = async () =>
          ({
            previewRepositoryFromGitHub: async () => ({
              organizationId: organization.id,
              preview,
            }),
            beginImportBatch: (input: { batchId: string }) => {
              batchId = input.batchId;
              return Promise.resolve({
                batch: {
                  batchId,
                  createdAt: "2026-07-26T00:00:00.000Z",
                  organizationId: organization.id,
                  preview,
                  sourceUrl: repository,
                  results: [
                    { path: "broken", selected: true, status: "pending" },
                  ],
                },
              });
            },
            getImportBatch: async () => ({
              batch: {
                batchId,
                createdAt: "2026-07-26T00:00:00.000Z",
                organizationId: organization.id,
                preview,
                sourceUrl: repository,
                results: [
                  {
                    path: "broken",
                    selected: true,
                    status: "failed",
                    error: "Repository file unavailable",
                  },
                ],
              },
            }),
            importFromGitHub: () =>
              Promise.reject(new Error("Repository file unavailable")),
            list: async () => ({ organizationId: organization.id, skills: [] }),
          }) as unknown as OrganizationSkillsApi;
        const { plainStdout } = await withCapturedStdio(() =>
          runOrganizationSkillsAddAll(
            { json: true, source: repository },
            { ...dependencies, resolveApi }
          )
        );
        expect(JSON.parse(plainStdout).results).toMatchObject([
          { status: "failed" },
        ]);
        expect(process.exitCode).toBe(1);
      } finally {
        process.exitCode = previousExitCode;
      }
    });
  });

  it("installs repository Skills one by one with stable retry IDs and per-item results", async () => {
    await withTempHome(async () => {
      const commitSha = "a".repeat(40);
      const baseUrl = "https://github.com/example/skills";
      const installUrl = `${baseUrl}/tree/${commitSha}/review`;
      const blockedUrl = `${baseUrl}/tree/${commitSha}/too-large`;
      const failedUrl = `${baseUrl}/tree/${commitSha}/broken`;
      const previewRepositoryFromGitHub = vi.fn(async () => ({
        organizationId: organization.id,
        preview: {
          catalogLimitBytes: 1024,
          commitSha,
          repository: baseUrl,
          skills: [
            {
              blocker: null,
              fileCount: 1,
              path: "review",
              totalBytes: 100,
              url: installUrl,
              warnings: [],
            },
            {
              blocker: { code: "too_large", message: "Too large" },
              fileCount: 1,
              path: "too-large",
              totalBytes: 5000,
              url: blockedUrl,
              warnings: [],
            },
            {
              blocker: null,
              fileCount: 1,
              path: "broken",
              totalBytes: 100,
              url: failedUrl,
              warnings: [],
            },
          ],
          totalDeclaredBytes: 5200,
          warnings: [],
        },
      }));
      let batchId = "";
      const batchResults = [
        { path: "review", selected: true, status: "pending" },
        {
          path: "too-large",
          selected: true,
          status: "skipped",
          error: "Too large",
        },
        { path: "broken", selected: true, status: "pending" },
      ];
      const savedBatch = () => ({
        batchId,
        createdAt: "2026-07-26T00:00:00.000Z",
        organizationId: organization.id,
        preview: {
          catalogLimitBytes: 1024,
          commitSha,
          repository: baseUrl,
          skills: [
            {
              blocker: null,
              fileCount: 1,
              path: "review",
              totalBytes: 100,
              url: installUrl,
              warnings: [],
            },
            {
              blocker: { code: "too_large", message: "Too large" },
              fileCount: 1,
              path: "too-large",
              totalBytes: 5000,
              url: blockedUrl,
              warnings: [],
            },
            {
              blocker: null,
              fileCount: 1,
              path: "broken",
              totalBytes: 100,
              url: failedUrl,
              warnings: [],
            },
          ],
          totalDeclaredBytes: 5200,
          warnings: [],
        },
        results: batchResults,
        sourceUrl: baseUrl,
      });
      const importFromGitHub = vi.fn((request: { url: string }) => {
        if (request.url === failedUrl) {
          batchResults[2] = {
            path: "broken",
            selected: true,
            status: "failed",
            error: "Repository file unavailable",
          };
          return Promise.reject(new Error("Repository file unavailable"));
        }
        batchResults[0] = {
          path: "review",
          selected: true,
          status: "installed",
        };
        return Promise.resolve({ skill });
      });
      const { dependencies } = createDependencies();
      const resolveApi = async () =>
        ({
          previewRepositoryFromGitHub,
          beginImportBatch: (input: { batchId: string }) => {
            batchId = input.batchId;
            return Promise.resolve({ batch: savedBatch() });
          },
          getImportBatch: async () => ({ batch: savedBatch() }),
          importFromGitHub,
        }) as unknown as OrganizationSkillsApi;
      const { plainStdout } = await withCapturedStdio(async () => {
        await runOrganizationSkillsAddAll(
          { json: true, source: baseUrl },
          { ...dependencies, resolveApi }
        );
      });
      const payload = JSON.parse(plainStdout.trim());
      expect(payload.type).toBe("skills.add.all");
      expect(payload.operationId).toBeTruthy();
      expect(payload.retrySource).toBe(`${baseUrl}/tree/${commitSha}`);
      expect(
        payload.results.map((item: { status: string }) => item.status)
      ).toEqual(["installed", "skipped", "failed"]);
      expect(importFromGitHub).toHaveBeenCalledTimes(2);
      expect(importFromGitHub).toHaveBeenCalledWith(
        expect.objectContaining({
          expectedCommitSha: commitSha,
          batchId: payload.operationId,
          timeoutMs: 60_000,
          url: installUrl,
        })
      );
      const secondRun = await withCapturedStdio(async () => {
        await runOrganizationSkillsAddAll(
          {
            json: true,
            operationId: payload.operationId,
            source: payload.retrySource,
          },
          { ...dependencies, resolveApi }
        );
      });
      const retryPayload = JSON.parse(secondRun.plainStdout.trim());
      expect(
        retryPayload.results.map((item: { status: string }) => item.status)
      ).toEqual(["installed", "skipped", "failed"]);
      expect(importFromGitHub).toHaveBeenCalledTimes(3);
      await expect(
        runOrganizationSkillsAddAll(
          { json: true, operationId: payload.operationId, source: baseUrl },
          { ...dependencies, resolveApi }
        )
      ).rejects.toThrow("pinned commit URL");
    });
  });

  it("reports a pinned repository inventory to a Local Agent without installing anything", async () => {
    await withTempHome(async () => {
      const commitSha = "a".repeat(40);
      const previewRepositoryFromGitHub = vi.fn(async () => ({
        organizationId: organization.id,
        preview: {
          catalogLimitBytes: 1024,
          commitSha,
          repository: "https://github.com/example/skills",
          skills: [
            {
              blocker: null,
              fileCount: 2,
              path: "review",
              totalBytes: 450,
              url: `https://github.com/example/skills/tree/${commitSha}/review`,
              warnings: [],
            },
          ],
          totalDeclaredBytes: 450,
          warnings: [],
        },
      }));
      const { dependencies } = createDependencies();
      const resolveApi = async () =>
        ({ previewRepositoryFromGitHub }) as unknown as OrganizationSkillsApi;
      const { plainStdout } = await withCapturedStdio(async () => {
        await runOrganizationSkillsScan(
          { json: true, url: "https://github.com/example/skills" },
          { ...dependencies, resolveApi }
        );
      });
      expect(previewRepositoryFromGitHub).toHaveBeenCalledWith(
        expect.objectContaining({
          expectedOrganizationId: organization.id,
          url: "https://github.com/example/skills",
        })
      );
      expect(plainStdout).toContain('"type":"skills.scan"');
      expect(plainStdout).toContain(commitSha);
      expect(plainStdout).toContain('"path":"review"');
    });
  });
  it("pins the previewed GitHub commit when a Local Agent adds a Team Skill", async () => {
    await withTempHome(async () => {
      const commitSha = "a".repeat(40);
      const previewFromGitHub = vi.fn(async () => ({
        organizationId: organization.id,
        preview: {
          files: [],
          instructionsCharacters: bundle.instructions.length,
          portable: bundle.portable,
          source: {
            commitSha,
            kind: "github" as const,
            path: "release-review",
            repository: "https://github.com/example/skills",
          },
          warnings: [],
        },
      }));
      const importFromGitHub = vi.fn(async () => ({ skill }));
      const { dependencies } = createDependencies();
      const resolveApi = async () =>
        ({
          previewFromGitHub,
          importFromGitHub,
        }) as unknown as OrganizationSkillsApi;
      const { plainStdout } = await withCapturedStdio(async () => {
        await runOrganizationSkillsAdd(
          {
            source:
              "https://github.com/example/skills/tree/main/release-review",
            json: true,
            operationId: "install-release-review",
          },
          { ...dependencies, resolveApi }
        );
      });
      expect(previewFromGitHub).toHaveBeenCalledWith(
        expect.objectContaining({ timeoutMs: 60_000 })
      );
      expect(importFromGitHub).toHaveBeenCalledWith(
        expect.objectContaining({
          expectedCommitSha: commitSha,
          expectedOrganizationId: organization.id,
          operationId: "install-release-review",
          timeoutMs: 60_000,
        })
      );
      expect(plainStdout).toContain('"type":"skills.add"');
      expect(plainStdout).toContain('"skillId":"skill-1"');
    });
  });

  it("only previews a GitHub Skill when requested", async () => {
    await withTempHome(async () => {
      const { dependencies } = createDependencies();
      const importFromGitHub = vi.fn();
      const resolveApi = async () =>
        ({
          previewFromGitHub: async () => ({
            organizationId: organization.id,
            preview: {
              files: [],
              instructionsCharacters: 10,
              portable: bundle.portable,
              source: {
                commitSha: "a".repeat(40),
                kind: "github",
                path: "release-review",
                repository: "https://github.com/example/skills",
              },
              warnings: [],
            },
          }),
          importFromGitHub,
        }) as unknown as OrganizationSkillsApi;
      const { plainStdout } = await withCapturedStdio(async () => {
        await runOrganizationSkillsAdd(
          {
            source: "https://github.com/example/skills",
            previewOnly: true,
            json: true,
          },
          { ...dependencies, resolveApi }
        );
      });
      expect(importFromGitHub).not.toHaveBeenCalled();
      expect(plainStdout).toContain('"type":"skills.add.preview"');
    });
  });

  it("previews and adds a local Skill directory through authorized API calls", async () => {
    await withTempHome(async (home) => {
      const directory = join(home, "local-review");
      await mkdir(join(directory, "references"), { recursive: true });
      await writeFile(
        join(directory, "SKILL.md"),
        "---\nname: local-review\ndescription: Review local notes.\n---\nRead the checklist."
      );
      await writeFile(
        join(directory, "references", "checklist.md"),
        "# Checklist"
      );
      const importFromFiles = vi.fn(async () => ({
        skill: { ...skill, name: "local-review" },
      }));
      const previewFromFiles = vi.fn(async () => ({
        organizationId: organization.id,
        preview: {
          files: [
            {
              encoding: "utf8" as const,
              mediaType: "text/markdown",
              path: "references/checklist.md",
              size: 11,
            },
          ],
          instructionsCharacters: 19,
          portable: { ...bundle.portable, name: "local-review" },
          warnings: [],
        },
      }));
      const { dependencies } = createDependencies();
      const resolveApi = async () =>
        ({
          importFromFiles,
          previewFromFiles,
        }) as unknown as OrganizationSkillsApi;
      const { plainStdout } = await withCapturedStdio(async () => {
        await runOrganizationSkillsAdd(
          { source: directory, json: true },
          { ...dependencies, resolveApi }
        );
      });

      expect(importFromFiles).toHaveBeenCalledOnce();
      expect(previewFromFiles).toHaveBeenCalledOnce();
      expect(importFromFiles).toHaveBeenCalledWith(
        expect.objectContaining({
          expectedOrganizationId: organization.id,
          files: expect.arrayContaining([
            expect.objectContaining({ path: "SKILL.md", encoding: "utf8" }),
            expect.objectContaining({ path: "references/checklist.md" }),
          ]),
        })
      );
      expect(plainStdout).toContain('"type":"skills.add"');
      expect(plainStdout).toContain('"name":"local-review"');
      expect(plainStdout).not.toContain("commitSha");

      importFromFiles.mockClear();
      const previewOutput = await withCapturedStdio(async () => {
        await runOrganizationSkillsAdd(
          { source: directory, previewOnly: true, json: true },
          { ...dependencies, resolveApi }
        );
      });
      expect(importFromFiles).not.toHaveBeenCalled();
      expect(previewOutput.plainStdout).toContain(
        '"type":"skills.add.preview"'
      );
    });
  });

  it("rejects symbolic links before uploading a local Skill", async () => {
    await withTempHome(async (home) => {
      const directory = join(home, "local-review");
      await mkdir(directory);
      await writeFile(join(directory, "SKILL.md"), "valid placeholder");
      await symlink(join(home, "secret.txt"), join(directory, "secret.txt"));
      await expect(readLocalSkillFiles(directory)).rejects.toThrow(
        "cannot contain symbolic links"
      );
    });
  });

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

  it.each([
    undefined,
    "historical-release",
  ])("loads the selected release %s without installing it globally", async (releaseId) => {
    await withTempHome(async (home) => {
      const { dependencies, get } = createDependencies();
      if (releaseId) {
        const historicalBundle = {
          ...bundle,
          instructions: "Use the historical method.",
        };
        const selectedRelease = {
          bundle: historicalBundle,
          digest: createHash("sha256")
            .update(
              stringifyOrganizationSkillBundleCanonicalJson(historicalBundle)
            )
            .digest("hex"),
          releaseId,
          skillId: skill.id,
        };
        get.mockResolvedValue({ skill, selectedRelease });
      }
      const { plainStdout } = await withCapturedStdio(async () => {
        await runOrganizationSkillsLoad(
          {
            skill: "skill-1",
            releaseId,
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
          releaseId: releaseId ?? "release-1",
          skillMarkdownPath: expect.stringContaining(
            `/organization-skills/org-1/skill-1/${releaseId ?? "release-1"}/SKILL.md`
          ),
        })
      );
      expect(result.payload.skillMarkdownPath).toContain(home);
      expect(
        await readFile(result.payload.skillMarkdownPath, "utf8")
      ).toContain(
        releaseId ? "Use the historical method." : bundle.instructions
      );
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

  it("does not substitute the active release when the server omits an exact selection", async () => {
    await withTempHome(async () => {
      const { dependencies } = createDependencies();
      const materialize = vi.fn();
      await expect(
        runOrganizationSkillsLoad(
          { skill: skill.id, releaseId: "missing-release", view: "agent" },
          { ...dependencies, materialize }
        )
      ).rejects.toThrow("requested Skill release was not returned");
      expect(materialize).not.toHaveBeenCalled();
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
  const get = vi.fn<OrganizationSkillsApi["get"]>(async () => ({
    skill: selectedSkill,
  }));
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
