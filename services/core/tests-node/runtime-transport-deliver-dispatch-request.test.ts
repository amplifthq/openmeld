import {
  CURRENT_DAEMON_EXECUTION_CONTRACT_EPOCH,
  RUNTIME_EXECUTION_IDENTITY_MODEL_VERSION,
} from "@openmeld/schemas";
import { describe, expect, it } from "vitest";
import { buildRuntimeTransportDeliverDispatchRequest } from "../src/dispatch/infrastructure/runtime-transport/runtime-coordinator-client";

describe("RuntimeTransport dispatch delivery request", () => {
  it("forwards image attachments only to a capable daemon", () => {
    const input = {
      attemptId: "attempt-1",
      executionIdentity: {
        authority: "core_runtime_registry_binding_route",
        core: {
          modelVersion: RUNTIME_EXECUTION_IDENTITY_MODEL_VERSION,
          spaceId: "space-1",
          dispatchId: "dispatch-1",
          targetProfileId: "agent-profile-1",
          openMeldServiceRuntimeId: {
            source: "runtime_registry_authority",
            value: "runtime-1",
          },
          bindingId: "binding-1",
          agentControllerRef: "builtin:codex",
        },
      },
      ownerUserId: "owner-1",
      route: {
        online: true,
        daemonSessionId: "daemon-session-1",
        deviceId: "device-1",
        lane: "dev-local",
        connectionGeneration: 1,
        leaseEpoch: 1,
        lastHeartbeatMs: 1_700_000_000_000,
        capabilities: {
          runtimeAdapters: [
            {
              adapterId: "codex",
              capabilityDeclaration: {
                continuationCapability: "standard" as const,
                imageInputCapability: "local_file_path" as const,
                preparationRequirement: "none" as const,
                runtimeWorkingDirectoryMode: "spawn_cwd" as const,
                streamingCapability: "preview_capable" as const,
                workspaceResumeBehavior: "transparent" as const,
              },
              defaultStreamingMode: "final" as const,
              transportModes: ["codex-app-server" as const],
            },
          ],
        },
        executionCompatibility: {
          expectedEpoch: CURRENT_DAEMON_EXECUTION_CONTRACT_EPOCH,
          observedEpoch: CURRENT_DAEMON_EXECUTION_CONTRACT_EPOCH,
          reasonCode: "daemon.runtime_contract.compatible",
          status: "compatible",
        },
      },
      message: {
        v: 2,
        dispatchId: "dispatch-1",
        spaceId: "space-1",
        sourceEventId: "signal-1",
        sourceClientMessageId: "client-message-1",
        dispatchOwner: {
          id: "owner-1",
          kind: "owner_account",
        },
        targetProfileId: "agent-profile-1",
        dispatchChainId: "dispatch-chain-1",
        autoRelayDepth: 0,
        visitedProfileIds: [],
        visitedProfileIdsHash: "stable32:11111111",
        dispatchContractVersion: 2,
        dispatchPolicy: "mention_only",
        ruleSource: "registry",
        ruleId: "registry.default.all_members.v1",
        ruleReason: "default allow all members mention",
        taskId: "task-1",
        transportMode: "local-cli",
        controllerSnapshot: {
          targetBindingState: "bound",
          targetBindingEnabled: true,
          agentControllerRef: "builtin:codex",
        },
        contextIdMappingSpec: null,
        dispatchRulesSnapshot: {
          dispatchPolicy: "mention_only",
          ruleSource: "registry",
          ruleId: "registry.default.all_members.v1",
          ruleReason: "default allow all members mention",
        },
        dispatchSnapshot: {
          dispatchPolicy: "mention_only",
          ruleSource: "registry",
          ruleId: "registry.default.all_members.v1",
          ruleReason: "default allow all members mention",
          targetBindingState: "bound",
          targetBindingEnabled: true,
        },
        idempotencyKey: "signal-1::agent-profile-1",
        enqueuedAtMs: 1_700_000_000_000,
        sourceSignalSnapshot: {
          callerContext: {
            relationship: "external" as const,
            spaceRole: "member" as const,
            audience: "external" as const,
          },
          quotedMessage: {
            signalId: "old-source",
            author: "Avery",
            text: "The agreed launch date is October 12.",
            status: "available" as const,
          },
          contextMessages: [
            {
              signalId: "previous",
              author: "Avery",
              text: "Please review this diagram",
              attachments: [
                {
                  id: "attachment-2",
                  mimeType: "image/png" as const,
                  sizeBytes: 8,
                  fileName: "previous.png",
                },
              ],
            },
          ],
          pinnedFiles: [
            {
              fileId: "launch-file",
              name: "Launch.md",
              revision: 3,
              mimeType: "text/markdown",
              sizeBytes: 42,
            },
          ],
          attachments: [
            {
              id: "attachment-1",
              mimeType: "image/png" as const,
              sizeBytes: 4,
              fileName: "diagram.png",
            },
          ],
          profileId: "human-profile-1",
          profileKind: "human" as const,
          text: "Please handle this.",
        },
      },
      sourceSignal: {
        profileId: "human-profile-1",
        profileKind: "human",
        text: "Please handle this.",
      },
    } satisfies Parameters<
      typeof buildRuntimeTransportDeliverDispatchRequest
    >[0];

    const request = buildRuntimeTransportDeliverDispatchRequest({
      ...input,
      defaultProjectId: "project-1",
      workingLanguage: { languageTag: "zh-Hans", mode: "selected" },
    });

    expect(request.payload.defaultProjectId).toBe("project-1");
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
  });
});
