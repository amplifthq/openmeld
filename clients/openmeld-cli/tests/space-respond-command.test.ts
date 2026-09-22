import {
  buildWorkingFolderRecoveryQuestion,
  getActiveSpaceWakeProgressResponseSchema,
} from "@openmeld/schemas";
import { beforeEach, expect, it, vi } from "vitest";
import { runSpaceRespond } from "../src/space/respond-command";

const mocks = vi.hoisted(() => ({
  read: vi.fn(),
  respond: vi.fn(),
  data: vi.fn(),
  line: vi.fn(),
}));
vi.mock("../src/space/cli-space-api", () => ({
  createCliSpaceApi: () => ({
    getActiveWakeProgress: mocks.read,
    respondToAgentInteraction: mocks.respond,
  }),
}));
vi.mock("../src/space/command-context", () => ({
  assertValidSpaceIdTarget: vi.fn(),
  prepareAuthenticatedSpaceCommandContext: () =>
    Promise.resolve({
      status: "ready",
      runtime: { resolvedView: "agent" },
      interactive: false,
      baseUrl: "https://gateway.example.test",
      presenter: { data: mocks.data, line: mocks.line },
    }),
  resolveOpenMeldProfileForSpaceCommand: () =>
    Promise.resolve({ openMeldProfileId: "owner-profile" }),
}));
vi.mock("../src/config/openmeld-request-context", () => ({
  buildOpenMeldRequestContextFromProfile: () => ({
    profileKind: "human",
    profileId: "owner-profile",
    profileName: "Owner",
  }),
}));

const request = {
  ...buildWorkingFolderRecoveryQuestion({
    previousFolder: "available",
    previousFolderLabel: "previous",
    selectedFolderLabel: "current",
  }),
  v: 1 as const,
  interactionId: "folder-choice",
  requestedAtMs: 1000,
  expiresAtMs: 2000,
};
const response = {
  kind: "question",
  answers: [
    {
      questionId: "working_folder_recovery",
      values: ["start_new_conversation"],
    },
  ],
};
beforeEach(() => {
  vi.clearAllMocks();
  mocks.read.mockResolvedValue(
    getActiveSpaceWakeProgressResponseSchema.parse({
      query: { spaceId: "space-1", targetProfileId: null },
      items: [
        {
          clientMessageId: "message-1",
          sourceSignalId: "signal-1",
          dispatchId: "dispatch-1",
          runtimeCoordinatorExecutionId: "execution-1",
          targetProfileId: "agent-1",
          targetLabel: "Agent",
          phase: "running",
          message: "Waiting for your answer",
          updatedAtMs: 1000,
          terminal: false,
          pendingInteraction: {
            canRespond: true,
            interactionId: request.interactionId,
            kind: request.kind,
            requestedAtMs: request.requestedAtMs,
            expiresAtMs: request.expiresAtMs,
            request,
          },
        },
      ],
    })
  );
  mocks.respond.mockResolvedValue({
    ok: true,
    status: "accepted",
    respondedAtMs: 1500,
  });
});

it("exposes the pending choices to Agents without answering automatically", async () => {
  await runSpaceRespond({ space: "space-1", view: "agent" });
  expect(mocks.respond).not.toHaveBeenCalled();
  expect(mocks.data).toHaveBeenCalledWith(
    expect.objectContaining({
      code: "space.respond.needs_action",
      payload: expect.objectContaining({
        requests: [
          expect.objectContaining({
            execution: "execution-1",
            interaction: "folder-choice",
            request,
          }),
        ],
      }),
    })
  );
});

it("sends the explicit answer with its exact execution and interaction", async () => {
  await runSpaceRespond({
    space: "space-1",
    execution: "execution-1",
    interaction: "folder-choice",
    response: JSON.stringify(response),
    view: "agent",
  });
  expect(mocks.respond).toHaveBeenCalledOnce();
  expect(mocks.respond).toHaveBeenCalledWith(
    expect.objectContaining({
      body: {
        runtimeCoordinatorExecutionId: "execution-1",
        interactionId: "folder-choice",
        response,
      },
    })
  );
  expect(mocks.line).toHaveBeenCalledWith({
    code: "space.respond.sent",
    text: "Response sent. Check this task for its final result.",
  });
});

it("does not apply an old answer to a newer request", async () => {
  await runSpaceRespond({
    space: "space-1",
    execution: "execution-1",
    interaction: "old-choice",
    response: JSON.stringify(response),
  });
  expect(mocks.respond).not.toHaveBeenCalled();
  expect(mocks.line).toHaveBeenCalledWith(
    expect.objectContaining({ code: "space.respond.not_pending" })
  );
});

it("never reports success when Core rejects an expired answer", async () => {
  mocks.respond.mockResolvedValue({
    ok: false,
    status: "expired",
    message: "This request expired. Send the task again when you’re ready.",
  });
  await runSpaceRespond({
    space: "space-1",
    execution: "execution-1",
    interaction: "folder-choice",
    response: JSON.stringify(response),
  });
  expect(mocks.line).toHaveBeenCalledWith(
    expect.objectContaining({ code: "space.respond.rejected" })
  );
  expect(mocks.line).not.toHaveBeenCalledWith(
    expect.objectContaining({ code: "space.respond.sent" })
  );
});
