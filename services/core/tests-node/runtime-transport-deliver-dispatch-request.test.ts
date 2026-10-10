import { spaceContextWorkHandoffSchema } from "@openmeld/schemas";
import { describe, expect, it } from "vitest";
import { buildRuntimeTransportDeliverDispatchRequest } from "../src/dispatch/infrastructure/runtime-transport/runtime-coordinator-client";
import { projectPluginConnectionExecutionSource } from "../src/runtime-transport/application/runtime-coordinator-plugin-connection-source";

const envelopeDigestPattern = /^[a-f0-9]{64}$/u;

import {
  createRetainedRuntimeCommandState,
  createRuntimeTransportDeliveryInput,
} from "../test-support/runtime-transport-delivery.test-support";

describe("RuntimeTransport dispatch delivery request", () => {
  it.each([
    "accepted",
    "wrong-owner",
    "wrong-target",
    "wrong-space",
    "missing-envelope",
  ])("projects retained Local admission without exposing the private delivery: %s", (kind) => {
    const input = createRuntimeTransportDeliveryInput();
    const delivery = buildRuntimeTransportDeliverDispatchRequest({
      ...input,
      organizationProtectedInformation: "private-test-information",
      message: {
        ...input.message,
        spacePassword: "private-test-password",
        sourceMessageEnvelope: {
          text: "Please handle this.",
          activationTargets: ["agt_33333333-3333-4333-8333-333333333333"],
          referenceTargets: [],
        },
      },
    });
    const state = createRetainedRuntimeCommandState(delivery);
    const request = {
      ownerUserId: delivery.ownerUserId,
      executionId: delivery.payload.runtimeCoordinatorExecutionId,
      spaceId: delivery.payload.spaceId,
      dispatchId: delivery.dispatchId,
      targetProfileId: delivery.profileId,
    };
    if (kind === "wrong-owner") {
      request.ownerUserId = "another-owner";
    }
    if (kind === "wrong-target") {
      request.targetProfileId = "another-target";
    }
    if (kind === "wrong-space") {
      request.spaceId = "another-space";
    }
    if (kind === "missing-envelope") {
      state.sanitizedDeliveryRequest.payload.sourceMessageEnvelope = undefined;
    }
    const source = projectPluginConnectionExecutionSource(request, state);
    if (kind !== "accepted") {
      expect(source).toBeNull();
      return;
    }
    expect(source).toMatchObject({
      bindingId: "binding-1",
      sourceSignalId: "signal-1",
      requesterProfileId: "human-profile-1",
      createdAtMs: 1_700_000_000_100,
      threadContext: null,
    });
    expect(source?.sourceEnvelopeDigest).toMatch(envelopeDigestPattern);
    for (const privateValue of [
      "private-test-information",
      "private-test-password",
      "Please handle this.",
    ]) {
      expect(JSON.stringify(source)).not.toContain(privateValue);
    }
  });
  it("forwards image attachments only to a capable daemon", () => {
    const input = createRuntimeTransportDeliveryInput();

    const request = buildRuntimeTransportDeliverDispatchRequest({
      ...input,
      defaultProjectId: "project-1",
      workingLanguage: { languageTag: "zh-Hans", mode: "selected" },
      requesterIsAgentOwner: true,
    });

    expect(request.payload.defaultProjectId).toBe("project-1");
    expect(request.payload.requesterIsAgentOwner).toBe(true);
    expect(request.payload.workingLanguage).toEqual({
      languageTag: "zh-Hans",
      mode: "selected",
    });
    expect(request.payload.sourceClientMessageId).toBe("client-message-1");
    expect(request.payload.sourceSignalSnapshot?.callerContext).toEqual({
      relationship: "external",
      spaceRole: "member",
      audience: "external",
    });
    expect(request.payload.sourceSignalSnapshot?.attachments).toEqual([
      {
        id: "attachment-1",
        mimeType: "image/png",
        sizeBytes: 4,
        fileName: "diagram.png",
      },
      {
        id: "attachment-2",
        mimeType: "image/png",
        sizeBytes: 8,
        fileName: "previous.png",
      },
    ]);

    const legacyRequest = buildRuntimeTransportDeliverDispatchRequest({
      ...input,
      route: {
        ...input.route,
        capabilities: {},
      },
    });
    expect(legacyRequest.payload).not.toHaveProperty("requesterIsAgentOwner");
    expect(
      legacyRequest.payload.sourceSignalSnapshot?.attachments
    ).toBeUndefined();
    expect(legacyRequest.payload.sourceSignalSnapshot).not.toHaveProperty(
      "quotedMessage"
    );
    expect(legacyRequest.payload.sourceSignalSnapshot).not.toHaveProperty(
      "pinnedFiles"
    );
    expect(legacyRequest.payload.sourceSignalSnapshot).not.toHaveProperty(
      "contextMessages"
    );
    expect(legacyRequest.payload.sourceSignalSnapshot?.text).toContain(
      "Please review this diagram"
    );
    expect(legacyRequest.payload.sourceSignalSnapshot?.text).toContain(
      "October 12"
    );
    expect(legacyRequest.payload.sourceSignalSnapshot?.text).toContain(
      "launch-file"
    );
    expect(legacyRequest.payload.sourceSignalSnapshot?.text).toContain(
      "Please handle this."
    );
    const workHandoff = spaceContextWorkHandoffSchema.parse({
      schemaVersion: 2,
      sourceSignalId: "reviewed",
      sourceRevision: 1,
      files: [],
      skills: [],
      requirements: [],
      execution: { workspace: "isolated", access: "space_context" },
      work: {
        goal: "Review",
        completed: "Draft",
        nextSteps: "Summarize",
        evidence: [],
        attemptedApproaches: [],
        decisions: [],
        constraints: [],
        openQuestions: [],
        completionCriteria: ["Return findings"],
      },
    });
    const handoffInput = {
      ...input,
      message: {
        ...input.message,
        sourceSignalSnapshot: {
          ...input.message.sourceSignalSnapshot,
          workHandoff,
        },
      },
    };
    expect(() =>
      buildRuntimeTransportDeliverDispatchRequest(handoffInput)
    ).toThrow("service.update_required");
    const capableRoute = {
      ...input.route,
      capabilities: {
        ...input.route.capabilities,
        runtimeAdapters: input.route.capabilities.runtimeAdapters.map(
          (adapter) => ({
            ...adapter,
            capabilityDeclaration: {
              ...adapter.capabilityDeclaration,
              executionContextVersion: 5 as const,
            },
          })
        ),
      },
    };
    // A brief needs the versioned reader, but no writable selected-file capability.
    expect(
      buildRuntimeTransportDeliverDispatchRequest({
        ...handoffInput,
        route: capableRoute,
      }).payload.sourceSignalSnapshot?.workHandoff
    ).toEqual(workHandoff);
    workHandoff.files.push({
      fileId: "report",
      revision: 3,
      relativePath: "report.md",
    });
    expect(() =>
      buildRuntimeTransportDeliverDispatchRequest({
        ...handoffInput,
        route: capableRoute,
      })
    ).toThrow("before handing off selected files");
  });
});
