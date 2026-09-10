import type {
  RuntimeTransportDeliverDispatchRequest,
  SpaceMessageAttachment,
  SpaceMessageFileReference,
} from "@openmeld/schemas/types";
import { describe, expect, it } from "vitest";
import {
  buildDispatchSessionTitle,
  parseDispatchTask,
} from "../src/local-service/dispatch/parse-dispatch-task";

it("names a new Session from the Wake request rather than the bootstrap instructions", () => {
  expect(
    buildDispatchSessionTitle({
      targetProfileName: "Monica",
      prompt: "Adjust the close button\n  and pagination",
    })
  ).toBe("OpenMeld · Monica · Adjust the close button and pagination");
  expect(
    buildDispatchSessionTitle({ targetProfileName: null, prompt: "Fix layout" })
  ).toBe("OpenMeld · Fix layout");
  expect(
    buildDispatchSessionTitle({ targetProfileName: "Monica", prompt: " \n " })
  ).toBeUndefined();
  const longTitle =
    buildDispatchSessionTitle({
      targetProfileName: "Monica",
      prompt: "🙂".repeat(200),
    }) ?? "";
  expect(longTitle.length).toBeLessThanOrEqual(120);
  expect(longTitle.isWellFormed()).toBe(true);
  expect(longTitle.endsWith("…")).toBe(true);
});

function createDeliverRequest(input: {
  activationTargets?: string[];
  attachments?: SpaceMessageAttachment[];
  files?: SpaceMessageFileReference[];
  defaultProjectId?: string;
  dispatchPolicy?: "listen_all" | "mention_only";
  sourceText?: string;
  organizationProtectedInformation?: string;
  workingLanguage?: RuntimeTransportDeliverDispatchRequest["payload"]["workingLanguage"];
  spacePassword?: string;
  targetProfileId: string;
  targetProfileIsCenterAgent?: boolean;
  targetProfileMentionLabel?: string | null;
  targetProfileName?: string | null;
  threadContext?: RuntimeTransportDeliverDispatchRequest["payload"]["threadContext"];
}): RuntimeTransportDeliverDispatchRequest {
  return {
    profileId: input.targetProfileId,
    dispatchId: "dispatch-1",
    attemptId: "attempt-1",
    payload: {
      attemptId: "attempt-1",
      dispatchId: "dispatch-1",
      runtimeCoordinatorExecutionId: "rce-space-1-dispatch-1-target",
      executionToken: {
        authorityScope: {
          bindingId: "binding-1",
          agentControllerRef: "builtin:codex",
          openMeldServiceRuntimeId: "runtime-1",
        },
        deliveryIdempotencyKey: "rce-space-1-dispatch-1-target:run-1",
        deliveryProvenance: {
          connectionGeneration: 1,
          daemonSessionId: "daemon-session-1",
          leaseEpoch: 1,
        },
        executionScope: {
          dispatchId: "dispatch-1",
          runtimeCoordinatorExecutionId: "rce-space-1-dispatch-1-target",
          sourceClientMessageId: null,
          spaceId: "space-1",
          targetProfileId: input.targetProfileId,
        },
        executionToken:
          "rcet_v1_aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
        expiresAtMs: null,
        issuedAtMs: 1_700_000_000_000,
        modelVersion: "openmeld.runtime_coordinator.execution_token.v1",
        runId: "run-1",
        tokenFingerprint: "etfp_v1_aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
        tokenStatus: "active",
      },
      taskId: "task-1",
      sourceEventId: "evt-1",
      spaceId: "space-1",
      targetProfileId: input.targetProfileId,
      ...(input.defaultProjectId
        ? { defaultProjectId: input.defaultProjectId }
        : {}),
      ...(input.organizationProtectedInformation
        ? {
            organizationProtectedInformation:
              input.organizationProtectedInformation,
          }
        : {}),
      ...(input.workingLanguage
        ? { workingLanguage: input.workingLanguage }
        : {}),
      ...(input.targetProfileIsCenterAgent === undefined
        ? {}
        : { targetProfileIsCenterAgent: input.targetProfileIsCenterAgent }),
      dispatchPolicy: input.dispatchPolicy ?? "mention_only",
      sourceSignal: {
        profileId: "11111111-1111-4111-8111-111111111111",
        profileKind: "human",
        text: input.sourceText ?? "please review this",
      },
      sourceSignalSnapshot: {
        ...(input.attachments ? { attachments: input.attachments } : {}),
        ...(input.files ? { files: input.files } : {}),
        profileId: "11111111-1111-4111-8111-111111111111",
        profileKind: "human",
        text: input.sourceText ?? "please review this",
      },
      controllerSnapshot: {
        agentControllerRef: "builtin:codex",
      },
      sourceMessageEnvelope: {
        activationTargets: input.activationTargets ?? [],
        referenceTargets: [],
        text: input.sourceText ?? "please review this",
      },
      ...(input.targetProfileMentionLabel === undefined
        ? {}
        : { targetProfileMentionLabel: input.targetProfileMentionLabel }),
      ...(input.targetProfileName === undefined
        ? {}
        : { targetProfileName: input.targetProfileName }),
      ...(input.threadContext ? { threadContext: input.threadContext } : {}),
      ...(input.spacePassword ? { spacePassword: input.spacePassword } : {}),
    },
  } as unknown as RuntimeTransportDeliverDispatchRequest;
}

describe("parseDispatchTask", () => {
  it("carries Organization information protection into local prompt assembly", () => {
    const parsed = parseDispatchTask({
      deliverRequest: createDeliverRequest({
        organizationProtectedInformation: "Private customer pricing.",
        targetProfileId: "agt-target-a",
      }),
      fallbackRouteConfig: null,
    });

    expect(parsed?.organizationProtectedInformation).toBe(
      "Private customer pricing."
    );
  });

  it("carries the advisory Organization working language into local prompt assembly", () => {
    const parsed = parseDispatchTask({
      deliverRequest: createDeliverRequest({
        targetProfileId: "agt-target-a",
        workingLanguage: { languageTag: "zh-Hans", mode: "selected" },
      }),
      fallbackRouteConfig: null,
    });

    expect(parsed?.workingLanguage).toEqual({
      languageTag: "zh-Hans",
      mode: "selected",
    });
  });

  it("carries the canonical Default Project into dispatch preflight", () => {
    const parsed = parseDispatchTask({
      deliverRequest: createDeliverRequest({
        defaultProjectId: "project-1",
        targetProfileId: "agt-target-a",
      }),
      fallbackRouteConfig: null,
    });

    expect(parsed?.defaultProjectId).toBe("project-1");
  });

  it("marks activation_targets as explicit only when the current recipient is listed", () => {
    const parsed = parseDispatchTask({
      deliverRequest: createDeliverRequest({
        activationTargets: ["agt-target-a"],
        dispatchPolicy: "listen_all",
        targetProfileId: "agt-target-a",
      }),
      fallbackRouteConfig: null,
    });

    expect(parsed).toMatchObject({
      dispatchTriggerSource: "activation_targets",
      recipientExplicitlyAddressedByActivationTargets: true,
      targetProfileId: "agt-target-a",
    });
  });

  it("keeps listen_all recipients out of explicit activation target mode when they are not listed", () => {
    const parsed = parseDispatchTask({
      deliverRequest: createDeliverRequest({
        activationTargets: ["agt-target-a"],
        dispatchPolicy: "listen_all",
        targetProfileId: "agt-target-b",
      }),
      fallbackRouteConfig: null,
    });

    expect(parsed).toMatchObject({
      dispatchTriggerSource: "listen_all",
      recipientExplicitlyAddressedByActivationTargets: false,
      targetProfileId: "agt-target-b",
    });
  });

  it("preserves thread context from the dispatch payload", () => {
    const threadContext = {
      threadId: "thr_11111111-1111-4111-8111-111111111111",
      rootSignalId: "sig-root-1",
    } as const;
    const parsed = parseDispatchTask({
      deliverRequest: createDeliverRequest({
        targetProfileId: "agt-target-a",
        threadContext,
      }),
      fallbackRouteConfig: null,
    });

    expect(parsed?.threadContext).toEqual(threadContext);
  });

  it("preserves source image attachments for local materialization", () => {
    const attachments = [
      {
        id: "attachment-1",
        mimeType: "image/png" as const,
        sizeBytes: 4,
        fileName: "diagram.png",
      },
    ];
    const parsed = parseDispatchTask({
      deliverRequest: createDeliverRequest({
        attachments,
        targetProfileId: "agt-target-a",
      }),
      fallbackRouteConfig: null,
    });

    expect(parsed?.attachments).toEqual(attachments);
  });

  it("preserves canonical Space File revisions for local agents", () => {
    const files = [
      {
        fileId: "file-1",
        revision: 3,
        name: "launch-brief.pdf",
        mimeType: "application/pdf",
        sizeBytes: 4096,
      },
    ];
    const parsed = parseDispatchTask({
      deliverRequest: createDeliverRequest({
        files,
        targetProfileId: "agt-target-a",
      }),
      fallbackRouteConfig: null,
    });

    expect(parsed?.files).toEqual(files);
  });

  it("preserves ten maximum-size image references for lazy Local Agent access", () => {
    const files = Array.from({ length: 10 }, (_, index) => ({
      fileId: `image-${index + 1}`,
      revision: 1,
      name: `screen-${index + 1}.png`,
      mimeType: "image/png",
      sizeBytes: 10 * 1024 * 1024,
    }));
    const parsed = parseDispatchTask({
      deliverRequest: createDeliverRequest({
        files,
        targetProfileId: "agt-target-a",
      }),
      fallbackRouteConfig: null,
    });

    expect(parsed?.files).toEqual(files);
  });

  it("removes multi-target Wake mentions from the task prompt without changing source envelope evidence", () => {
    const sourceText =
      "@Felix Codex Session Dogfood(wake) @Felix's Codex(wake) wake up";
    const parsed = parseDispatchTask({
      deliverRequest: createDeliverRequest({
        activationTargets: ["agt-target-a", "agt-target-b"],
        sourceText,
        targetProfileId: "agt-target-a",
        targetProfileMentionLabel: "Felix Codex Session Dogfood",
      }),
      fallbackRouteConfig: null,
    });

    expect(parsed?.prompt).toBe("wake up");
    expect(parsed?.sourceMessageEnvelope?.text).toBe(sourceText);
  });

  it("preserves the protected space password for dispatch-time reads", () => {
    const parsed = parseDispatchTask({
      deliverRequest: createDeliverRequest({
        targetProfileId: "agt-target-a",
        spacePassword: "correct-password",
      }),
      fallbackRouteConfig: null,
    });

    expect(parsed?.spacePassword).toBe("correct-password");
  });

  it("preserves target display facts from the dispatch payload", () => {
    const parsed = parseDispatchTask({
      deliverRequest: createDeliverRequest({
        targetProfileId: "agt-target-a",
        targetProfileMentionLabel: "@architect",
        targetProfileName: "OpenMeld Space Architect Agent",
      }),
      fallbackRouteConfig: null,
    });

    expect(parsed).toMatchObject({
      targetProfileMentionLabel: "@architect",
      targetProfileName: "OpenMeld Space Architect Agent",
    });
  });

  it("preserves the server-derived Center Agent designation fact", () => {
    const centerAgentDispatch = parseDispatchTask({
      deliverRequest: createDeliverRequest({
        targetProfileId: "agt-target-a",
        targetProfileIsCenterAgent: true,
      }),
      fallbackRouteConfig: null,
    });
    const ordinaryDispatch = parseDispatchTask({
      deliverRequest: createDeliverRequest({
        targetProfileId: "agt-target-b",
      }),
      fallbackRouteConfig: null,
    });

    expect(centerAgentDispatch?.targetProfileIsCenterAgent).toBe(true);
    expect(ordinaryDispatch?.targetProfileIsCenterAgent).toBe(false);
  });
});
