import { mkdir, mkdtemp, realpath, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { SpaceApi } from "@openmeld/api-client";
import type { SpaceFileDescriptor } from "@openmeld/schemas/types";
import { afterEach, expect, it, vi } from "vitest";
import { prepareDispatchWorkHandoff } from "../src/local-service/file-access/dispatch-work-handoff";
import {
  createDispatchSpaceActionContext,
  OPENMELD_SPACE_ACTION_CONTEXT_PATH_ENV,
  readDispatchSpaceActionRecord,
} from "../src/runtime/dispatch-space-action-context";
import { recordDispatchSpaceReply } from "../src/space/action-command";
import { runSpaceWorkingCopy } from "../src/space/working-copy-command";

const network = vi.hoisted(() => ({
  streamFileContent: vi.fn<SpaceApi["streamFileContent"]>(),
  getFile: vi.fn<SpaceApi["getFile"]>(),
  updateFileContent: vi.fn<SpaceApi["updateFileContent"]>(),
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
}));
vi.mock("../src/config/auth-session", () => ({
  getAuthSessionState: async () => ({
    session: {
      user: { id: identity.account },
      activeOrganization: { id: identity.org },
    },
  }),
}));
vi.mock("../src/config/base-url", () => ({
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

// Local managed copies require Darwin atomic no-symlink opens (PR #1164).
it.skipIf(process.platform !== "darwin")(
  "Service prepares a copy that the dispatch-bound CLI can save and select in the original reply",
  async () => {
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
      expect(JSON.parse(output.join("")).files[0].status).toBe("clean");
      output.length = 0;
      await writeFile(join(work, "report.txt"), "edited");
      expect(
        await prepareDispatchWorkHandoff({
          task,
          ownerUserId: identity.account,
          workingDirectory: join(root, "scratch"),
        })
      ).toBe(work);
      await runSpaceWorkingCopy({ ...common, action: "commit" });
      const saved = JSON.parse(output.join(""));
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
  }
);
