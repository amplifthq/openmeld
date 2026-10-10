import {
  mkdir,
  mkdtemp,
  readFile,
  realpath,
  rm,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { OrganizationSkillsApi, SpaceApi } from "@openmeld/api-client";
import {
  getOrganizationSkillResponseSchema,
  stringifyOrganizationSkillBundleCanonicalJson,
} from "@openmeld/schemas";
import type { SpaceFileDescriptor } from "@openmeld/schemas/types";
import { afterEach, describe, expect, it, vi } from "vitest";
import { prepareDispatchWorkHandoff } from "../src/local-service/file-access/dispatch-work-handoff";
import {
  createDispatchSpaceActionContext,
  OPENMELD_SPACE_ACTION_CONTEXT_PATH_ENV,
  readDispatchSpaceActionRecord,
} from "../src/runtime/dispatch-space-action-context";
import { recordDispatchSpaceReply } from "../src/space/action-command";
import { runSpaceWorkingCopy } from "../src/space/working-copy-command";
import { makeTreeWritableForRemoval } from "./helpers/fs";

const network = vi.hoisted(() => ({
  streamFileContent: vi.fn<SpaceApi["streamFileContent"]>(),
  getFile: vi.fn<SpaceApi["getFile"]>(),
  updateFileContent: vi.fn<SpaceApi["updateFileContent"]>(),
  getSkill: vi.fn<OrganizationSkillsApi["get"]>(),
}));
const identity = vi.hoisted(() => ({
  account: "account",
  org: "org",
  profile: "11111111-1111-4111-8111-111111111111",
  space: "a".repeat(64),
}));
vi.mock("@openmeld/api-client", async (original) => ({
  ...(await original<typeof import("@openmeld/api-client")>()),
  createSpaceApi: () => network,
  createOrganizationSkillsApi: () => ({ get: network.getSkill }),
}));
vi.mock("../src/config/auth-session", () => ({
  getAuthSessionState: async () => ({
    session: {
      user: { id: identity.account },
      activeOrganization: { id: identity.org },
    },
  }),
}));
vi.mock("../src/config/base-url", async (original) => ({
  ...(await original<typeof import("../src/config/base-url")>()),
  resolveBaseUrl: async () => "https://example.test",
}));
// Supply authenticated entry context; the test exercises both production scope
// constructors and the real durable-copy/dispatch/reply paths, not login UX.
vi.mock("../src/space/command-context", async (original) => ({
  ...(await original<typeof import("../src/space/command-context")>()),
  prepareAuthenticatedSpaceCommandContext: async () => ({
    status: "ready",
    baseUrl: "https://example.test",
    runtime: { resolvedView: "agent" },
    presenter: {},
    interactive: false,
  }),
  resolveOpenMeldProfileForSpaceCommand: async () => ({
    openMeldProfileId: identity.profile,
    profileKind: "agent",
    profileName: "Agent",
    ownerUserId: identity.account,
  }),
}));

afterEach(() => {
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

it.each(
  ["builtin:codex", "builtin:claude-code"].flatMap((agentControllerRef) =>
    [true, false].map((hasRepository) => ({
      agentControllerRef,
      hasRepository,
    }))
  )
)("prepares the reviewed brief without borrowing a repository ($agentControllerRef, repository=$hasRepository)", async ({
  agentControllerRef,
  hasRepository,
}) => {
  const root = await realpath(
    await mkdtemp(join(tmpdir(), "openmeld-code-handoff-"))
  );
  try {
    vi.stubEnv("OPENMELD_HOME", join(root, "receiver-lane"));
    const code = {
      projectId: "project",
      repositoryFingerprint: `sha256:${"a".repeat(64)}`,
      commit: "b".repeat(40),
    };
    const task: Parameters<typeof prepareDispatchWorkHandoff>[0]["task"] = {
      taskId: "code-task",
      targetProfileName: null,
      spaceId: identity.space,
      spacePassword: null,
      targetProfileId: identity.profile,
      agentControllerRef,
      transportMode:
        agentControllerRef === "builtin:codex"
          ? "codex-app-server"
          : "local-cli",
      prompt: "Implement the plan",
      executionContext: {
        version: 1,
        id: identity.profile,
        ...(hasRepository
          ? ({
              access: "workspace",
              permissionSource: "agent_settings",
              projectWork: code,
            } as const)
          : ({ access: "space_context" } as const)),
        workspace: "isolated",
        nativeConversationId: null,
        runtimeWorkspaceFingerprint: null,
        scope: {
          organizationId: identity.org,
          spaceId: identity.space,
          requesterProfileId: "another-member",
          targetProfileId: identity.profile,
          threadId: null,
        },
      },
      workHandoff: {
        schemaVersion: 2,
        sourceSignalId: "planning-result",
        sourceRevision: 1,
        ...(hasRepository
          ? ({ code, execution: { workspace: "isolated" } } as const)
          : ({
              execution: { workspace: "isolated", access: "space_context" },
            } as const)),
        files: [],
        skills: [],
        requirements: [],
        work: {
          goal: "Fix the calculation",
          completed: "The planning result",
          nextSteps: "Implement and test",
          evidence: [],
          attemptedApproaches: [],
          decisions: [],
          constraints: [],
          openQuestions: [],
          completionCriteria: ["The calculation test passes"],
        },
      },
    };
    const input = {
      task,
      ownerUserId: identity.account,
      workingDirectory: root,
    };
    expect(await prepareDispatchWorkHandoff(input)).toBe(root);
    expect(task.prompt).toContain("The calculation test passes");
    expect(task.workingCopyId).toBeUndefined();
    if (agentControllerRef === "builtin:codex" && task.workHandoff) {
      const bundle = {
        files: [
          {
            path: "references/checklist.md",
            encoding: "utf8" as const,
            mediaType: "text/markdown",
            content: "Exact resource.\n",
            size: 16,
          },
        ],
        instructions: "# Review\nRead references/checklist.md.",
        portable: {
          name: "review",
          description: "Review the shared result",
          allowedTools: null,
          compatibility: null,
          license: null,
          metadata: {},
        },
      };
      const digest = createHash("sha256")
        .update(stringifyOrganizationSkillBundleCanonicalJson(bundle))
        .digest("hex");
      const response = getOrganizationSkillResponseSchema.parse({
        skill: {
          id: "skill",
          organizationId: identity.org,
          name: "review",
          description: bundle.portable.description,
          enabled: true,
          bundle,
          activeRelease: {
            id: "release",
            digest,
            createdAt: "2026-01-01T00:00:00Z",
            createdByUserId: identity.account,
            source: { kind: "created" },
          },
          createdAt: "2026-01-01T00:00:00Z",
          updatedAt: "2026-01-01T00:00:00Z",
          version: 1,
          permissions: { canEdit: false, canManage: false },
          source: { kind: "created" },
          maintainerUserIds: [],
          releases: [],
        },
        selectedRelease: {
          skillId: "skill",
          releaseId: "release",
          digest,
          bundle,
        },
      });
      network.getSkill.mockResolvedValue(response);
      task.workHandoff.skills = [
        { skillId: "skill", releaseId: "release", digest, name: "review" },
      ];
      expect(await prepareDispatchWorkHandoff(input)).toBe(root);
      expect(
        await readFile(
          join(root, ".openmeld-skills/0/references/checklist.md"),
          "utf8"
        )
      ).toBe("Exact resource.\n");
      expect(
        await readFile(join(root, ".openmeld-skills/0/SKILL.md"), "utf8")
      ).toContain(bundle.instructions);
      expect(task.workingCopyId).toBeUndefined();
      expect(network.getSkill).toHaveBeenLastCalledWith(
        expect.objectContaining({
          skillId: "skill",
          releaseId: "release",
          digest,
        })
      );
      network.getSkill.mockResolvedValueOnce({ skill: response.skill });
      await expect(prepareDispatchWorkHandoff(input)).rejects.toThrow(
        "selected Skill release is unavailable"
      );
    }
    await expect(
      prepareDispatchWorkHandoff({ ...input, ownerUserId: "wrong-account" })
    ).rejects.toThrow("account or Organization changed");
    await expect(
      prepareDispatchWorkHandoff({
        ...input,
        task: {
          ...task,
          executionContext: {
            ...task.executionContext,
            projectWork: { ...code, commit: "c".repeat(40) },
          } as NonNullable<typeof task.executionContext>,
        },
      })
    ).rejects.toThrow(
      hasRepository ? "code_handoff_mismatch" : "handoff_context_required"
    );
    if (!hasRepository) {
      if (agentControllerRef === "builtin:codex") {
        await expect(
          prepareDispatchWorkHandoff({
            ...input,
            task: { ...task, transportMode: "local-cli" },
          })
        ).rejects.toThrow("handoff_transport_unsupported");
      }
      expect(task.prompt).not.toContain("exact commit");
      expect(task.executionContext?.projectWork).toBeUndefined();
      if (agentControllerRef === "builtin:claude-code" && task.workHandoff) {
        await expect(
          prepareDispatchWorkHandoff({
            ...input,
            task: {
              ...task,
              workHandoff: {
                ...task.workHandoff,
                files: [
                  { fileId: "file", revision: 1, relativePath: "file.md" },
                ],
              },
            },
          })
        ).rejects.toThrow("handoff_receiver_unsupported");
      }
    }
  } finally {
    await makeTreeWritableForRemoval(root);
    await rm(root, { recursive: true, force: true });
  }
});

// Local managed copies require Darwin atomic no-symlink opens (PR #1164).
describe.skipIf(process.platform !== "darwin")(
  "dispatch-bound shared file handoffs",
  () => {
    it.each([
      "legacy",
      "repository",
      "space",
    ])("Service prepares selected files that can be saved in the original reply (%s)", async (materials) => {
      const codeHandoff = materials === "repository";
      const root = await realpath(
        await mkdtemp(join(tmpdir(), "openmeld-handoff-entry-"))
      );
      try {
        const lane = join(root, "lane");
        vi.stubEnv("OPENMELD_HOME", lane);
        await mkdir(join(root, "scratch"));
        const actor = {
          displayName: "Agent",
          ownerUserId: identity.account,
          profileId: identity.profile,
          profileKind: "agent" as const,
        };
        const date = "2026-09-19T00:00:00.000Z";
        const file: SpaceFileDescriptor = {
          id: "report",
          kind: "file",
          name: "report.txt",
          origin: "artifact",
          path: "/report.txt",
          spaceId: identity.space,
          parentId: null,
          createdAt: date,
          updatedAt: date,
          createdBy: actor,
          updatedBy: actor,
          trashedAt: null,
          trashedBy: null,
          latestRevision: {
            id: "revision-6",
            fileId: "report",
            revision: 6,
            mimeType: "text/plain",
            sizeBytes: 6,
            createdAt: date,
            createdBy: actor,
          },
        };
        network.streamFileContent.mockResolvedValue({
          bytes: new ReadableStream({
            start(controller) {
              controller.enqueue(Buffer.from("before"));
              controller.close();
            },
          }),
          revision: 5,
          mimeType: "text/plain",
        });
        network.getFile.mockResolvedValue({ file });
        network.updateFileContent.mockResolvedValue(file);
        const task: Parameters<typeof prepareDispatchWorkHandoff>[0]["task"] = {
          taskId: "task",
          spaceId: identity.space,
          targetProfileId: identity.profile,
          agentControllerRef: "builtin:codex",
          transportMode: "codex-app-server",
          prompt: "Edit the selected report",
          targetProfileName: null,
          spacePassword: null,
          executionContext: {
            version: 1,
            id: identity.profile,
            workspace: "isolated",
            nativeConversationId: null,
            runtimeWorkspaceFingerprint: null,
            access: "space_context",
            scope: {
              organizationId: identity.org,
              spaceId: identity.space,
              requesterProfileId: identity.profile,
              targetProfileId: identity.profile,
              threadId: null,
            },
          },
          workHandoff: {
            schemaVersion: 1,
            files: [
              { fileId: "report", revision: 5, relativePath: "report.txt" },
            ],
            skills: [],
            work: { goal: "Edit", completed: "", nextSteps: "Save" },
            requirements: [],
          },
        };
        if (
          materials !== "legacy" &&
          task.executionContext &&
          task.workHandoff?.schemaVersion === 1
        ) {
          const code = {
            projectId: "project",
            repositoryFingerprint: `sha256:${"a".repeat(64)}`,
            commit: "b".repeat(40),
          };
          if (codeHandoff) {
            task.executionContext = {
              ...task.executionContext,
              access: "workspace",
              projectWork: code,
            };
          }
          task.workHandoff = {
            ...task.workHandoff,
            schemaVersion: 2,
            sourceSignalId: "plan",
            sourceRevision: 1,
            ...(codeHandoff
              ? ({
                  code,
                  execution: { workspace: "isolated", access: "workspace" },
                } as const)
              : ({
                  execution: { workspace: "isolated", access: "space_context" },
                } as const)),
            work: {
              ...task.workHandoff.work,
              evidence: [],
              attemptedApproaches: [],
              decisions: [],
              constraints: [],
              openQuestions: [],
              completionCriteria: ["Save the report"],
            },
          };
          await writeFile(
            join(root, "scratch/report.txt"),
            "untouched repository file"
          );
        }
        const work = await prepareDispatchWorkHandoff({
          task,
          ownerUserId: identity.account,
          workingDirectory: join(root, "scratch"),
        });
        const { context, contextPath } = createDispatchSpaceActionContext({
          workingCopyId: task.workingCopyId,
          attemptId: "attempt",
          dispatchId: "dispatch",
          taskId: "task",
          sourceEventId: "source",
          replyToSignalId: "origin",
          spaceId: identity.space,
          targetProfileId: identity.profile,
          env: { OPENMELD_HOME: lane },
          sendTargetReference: {
            status: "loaded",
            projection: [],
            referenceLines: [],
          },
          spaceContractSnapshot: {
            allowedActions: ["post_message"],
            publicationMode: "collaboration",
          },
        });
        vi.stubEnv(OPENMELD_SPACE_ACTION_CONTEXT_PATH_ENV, contextPath);
        vi.stubEnv("OPENMELD_DISPATCH_RUNTIME_MODE", "dispatch-owned-runtime");
        vi.stubEnv("OPENMELD_DISPATCH_RUNTIME_DISPATCH_ID", "dispatch");
        vi.stubEnv(
          "OPENMELD_DISPATCH_RUNTIME_TARGET_PROFILE_ID",
          identity.profile
        );
        const output: string[] = [];
        vi.spyOn(process.stdout, "write").mockImplementation((chunk) => {
          output.push(String(chunk));
          return true;
        });
        const common = {
          space: identity.space,
          profile: identity.profile,
          copyId: task.workingCopyId,
          json: true,
          view: "agent",
        };
        await runSpaceWorkingCopy({ ...common, action: "status" });
        const copy = JSON.parse(output.join(""));
        expect(copy.files[0].status).toBe("clean");
        expect(work).toBe(codeHandoff ? join(root, "scratch") : copy.root);
        output.length = 0;
        await writeFile(join(copy.root, "report.txt"), "edited");
        expect(
          await prepareDispatchWorkHandoff({
            task,
            ownerUserId: identity.account,
            workingDirectory: join(root, "scratch"),
          })
        ).toBe(work);
        await runSpaceWorkingCopy({ ...common, action: "commit" });
        const saved = JSON.parse(output.join(""));
        if (codeHandoff) {
          expect(await readFile(join(root, "scratch/report.txt"), "utf8")).toBe(
            "untouched repository file"
          );
        }
        expect(saved.references[0]).toMatchObject({
          fileId: "report",
          revision: 6,
        });
        expect(network.updateFileContent).toHaveBeenCalledWith(
          expect.objectContaining({
            fileId: "report",
            baseRevision: 5,
            bytes: Buffer.from("edited"),
          })
        );
        await recordDispatchSpaceReply({
          text: "Updated report",
          files: saved.references,
        });
        const record = readDispatchSpaceActionRecord({ context });
        expect(record).toMatchObject({
          status: "loaded",
          record: {
            action: {
              files: saved.references,
              messageEnvelope: {
                replyToSignalId: "origin",
              },
            },
          },
        });
        await expect(
          runSpaceWorkingCopy({
            ...common,
            action: "status",
            copyId: "22222222-2222-4222-8222-222222222222",
          })
        ).rejects.toThrow();
      } finally {
        await rm(root, { recursive: true, force: true });
      }
    });
  }
);

import { createHash } from "node:crypto";
