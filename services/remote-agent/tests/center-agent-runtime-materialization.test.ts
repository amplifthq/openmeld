import { describe, expect, it, vi } from "vitest";
import {
  materializeCenterAgentRuntime,
  resolveCenterAgentRuntimeContextPlan,
} from "../flue-adapter/center-agent-runtime-materialization";
import { createSubmitTurnRequest } from "./fixtures";

type Deferred<T> = {
  promise: Promise<T>;
  resolve: (value: T) => void;
};

function deferred<T>(): Deferred<T> {
  let resolve: ((value: T) => void) | undefined;
  const promise = new Promise<T>((next) => {
    resolve = next;
  });
  return {
    promise,
    resolve: (value) => resolve?.(value),
  };
}

describe("Center Agent runtime materialization", () => {
  it("does not materialize Organization Documents or Skills for an external participant", () => {
    const envelope = createSubmitTurnRequest().turnEnvelope;

    expect(
      resolveCenterAgentRuntimeContextPlan({
        ...envelope,
        interactionEnvironment: "externally_shared",
        sender: {
          displayName: "External guest",
          id: "slack:T123:U_EXTERNAL",
          kind: "member",
          verified: false,
        },
        space: {
          id: "slack:T123:C123:1710000000.000100",
          isCenterAgentDm: false,
          kind: "space",
          name: "#partners",
        },
        trigger: { source: "slack" },
      })
    ).toEqual({
      includeOrganizationDocuments: false,
      materializeOrganizationSkills: false,
    });
  });

  it("materializes shared Organization context for a connected internal channel member", () => {
    const envelope = createSubmitTurnRequest().turnEnvelope;

    expect(
      resolveCenterAgentRuntimeContextPlan({
        ...envelope,
        interactionEnvironment: "externally_shared",
        sender: {
          displayName: "Ashley",
          id: "lark:connection-1:user-1",
          kind: "member",
          messageChannelIdentity: {
            connectionId: "connection-1",
            provider: "lark",
            providerUserId: "user-1",
          },
          verified: false,
        },
        space: {
          id: "lark:connection-1:chat-1:message-1",
          isCenterAgentDm: false,
          kind: "space",
          name: "Lark conversation",
        },
        trigger: {
          connectionId: "connection-1",
          conversationId: "lark:connection-1:chat-1:message-1",
          provider: "lark",
          source: "message_channel",
        },
      })
    ).toEqual({
      includeOrganizationDocuments: true,
      materializeOrganizationSkills: true,
    });
  });

  it("rejects a frozen scope plan that was widened after Core admission", () => {
    const envelope = createSubmitTurnRequest().turnEnvelope;

    expect(() =>
      resolveCenterAgentRuntimeContextPlan({
        ...envelope,
        contextScopePlan: {
          authenticationSecrets: "never_available",
          interactionEnvironment: "externally_shared",
          memberMemory: "use_and_share",
          organizationDocuments: "share_when_authorized",
          organizationMemory: "share_when_authorized",
          organizationSkills: "share_when_authorized",
          protectedInformation: "share_when_authorized",
          requesterIdentity: "verified_member",
          resultAudience: "requester_only",
          v: 1,
        },
        interactionEnvironment: "externally_shared",
        space: {
          id: "slack:T123:C123:1710000000.000100",
          isCenterAgentDm: false,
          kind: "space",
          name: "#launch",
        },
        trigger: { source: "slack" },
      })
    ).toThrow("Center Agent Context Scope Plan no longer matches this turn");
  });

  it("materializes one heavy runtime stage at a time", async () => {
    vi.spyOn(console, "info").mockImplementation(() => undefined);
    const started: string[] = [];
    const reportStage = vi.fn();
    const progress = deferred<void>();
    const model = deferred<"model">();
    const documents = deferred<"documents">();
    const skills = deferred<"skills">();
    const sandbox = deferred<"sandbox">();
    const tools = deferred<"tools">();

    const materialization = materializeCenterAgentRuntime({
      createSandbox: () => {
        started.push("sandbox");
        return sandbox.promise;
      },
      createTools: (sandboxCapability) => {
        started.push(`tools:${sandboxCapability}`);
        return tools.promise;
      },
      markProgress: () => {
        started.push("progress");
        return progress.promise;
      },
      materializeSkills: () => {
        started.push("skills");
        return skills.promise;
      },
      readDocuments: () => {
        started.push("documents");
        return documents.promise;
      },
      registerModel: () => {
        started.push("model");
        return model.promise;
      },
      reportStage,
      submissionId: "submission_123",
    });

    expect(started).toEqual(["progress"]);

    progress.resolve();
    await Promise.resolve();
    await Promise.resolve();
    expect(started).toEqual(["progress", "model"]);

    model.resolve("model");
    await Promise.resolve();
    await Promise.resolve();
    expect(started).toEqual(["progress", "model", "documents"]);

    documents.resolve("documents");
    await Promise.resolve();
    await Promise.resolve();
    expect(started).toEqual(["progress", "model", "documents", "skills"]);

    skills.resolve("skills");
    await Promise.resolve();
    await Promise.resolve();
    expect(started).toEqual([
      "progress",
      "model",
      "documents",
      "skills",
      "sandbox",
    ]);

    sandbox.resolve("sandbox");
    await Promise.resolve();
    await Promise.resolve();
    expect(started).toEqual([
      "progress",
      "model",
      "documents",
      "skills",
      "sandbox",
      "tools:sandbox",
    ]);

    tools.resolve("tools");

    await expect(materialization).resolves.toEqual({
      documents: "documents",
      model: "model",
      sandbox: "sandbox",
      skills: "skills",
      tools: "tools",
    });
    expect(reportStage).toHaveBeenCalledTimes(12);
    expect(reportStage).toHaveBeenCalledWith({
      stage: "skills",
      status: "started",
      submissionId: "submission_123",
    });
    expect(reportStage).toHaveBeenCalledWith(
      expect.objectContaining({
        durationMs: expect.any(Number),
        stage: "skills",
        status: "succeeded",
        submissionId: "submission_123",
      })
    );
  });

  it("reports a failed stage without changing the original failure", async () => {
    vi.spyOn(console, "info").mockImplementation(() => undefined);
    vi.spyOn(console, "error").mockImplementation(() => undefined);
    const failure = new TypeError("Skill snapshot is unavailable.");
    const reportStage = vi.fn();

    await expect(
      materializeCenterAgentRuntime({
        createSandbox: async () => "sandbox",
        createTools: async () => "tools",
        markProgress: async () => undefined,
        materializeSkills: () => Promise.reject(failure),
        readDocuments: async () => "documents",
        registerModel: async () => "model",
        reportStage,
        submissionId: "submission_failed",
      })
    ).rejects.toBe(failure);

    expect(reportStage).toHaveBeenCalledWith(
      expect.objectContaining({
        durationMs: expect.any(Number),
        errorName: "TypeError",
        stage: "skills",
        status: "failed",
        submissionId: "submission_failed",
      })
    );
  });
});
