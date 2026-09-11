import {
  OPENMELD_HEADER_SPACE_ADDRESSING_VERSION,
  OPENMELD_SPACE_ADDRESSING_VERSION,
} from "@openmeld/gateway-contract";
import type { SignalEnvelope } from "@openmeld/protocol";
import {
  catchupResponseSchema,
  createSpaceDiagnosticReportResponseSchema,
  getActiveSpaceWakeProgressResponseSchema,
  getSpaceStatusResponseSchema,
  getSpaceUpdatesResponseSchema,
  getSpaceWakeProgressResponseSchema,
  getSpaceWakeTraceWaterfallResponseSchema,
  postNormalMessageResponseSchema,
  spaceBootstrapResponseSchema,
  spaceMembersSnapshotSchema,
  spaceViewerMembershipResponseSchema,
} from "@openmeld/schemas";
import type {
  ExecutionRecoveryProjection,
  GetSpaceMessageDetailsResponse,
  GetSpaceWakeTraceWaterfallResponse,
} from "@openmeld/schemas/types";
import { describe, expect, it, vi } from "vitest";
import { createOpenMeldApiClient, createSpaceApi } from "../src";
import { buildSpaceSignalsReadPath } from "../src/space";

const REQUEST_CONTEXT = {
  actorContext: {
    requestId: "req-space-api-123",
    openMeldProfileId: "human_profile_1",
    profileKind: "human" as const,
    profileName: "Mira",
  },
};

const EXECUTION_RECOVERY_IDENTITY = {
  spaceId: "space-123",
  dispatchId: "dispatch-1",
  attemptId: "attempt-1",
  taskId: "task-1",
  targetProfileId: "agt_target_1",
  runtimeCoordinatorExecutionId: "rce-1",
  resultRef: "result-1",
  agentControllerRef: "builtin:codex",
  agentControllerConversationId: "conversation-1",
} as const;

const EXECUTION_RECOVERY_DESTINATION = {
  surface: "space",
  spaceId: "space-123",
  threadId: null,
} as const;

function createExecutionRecoveryProjection(
  input: { recovered?: boolean } = {}
): ExecutionRecoveryProjection {
  const recovered = input.recovered ?? false;
  return {
    identity: EXECUTION_RECOVERY_IDENTITY,
    destination: EXECUTION_RECOVERY_DESTINATION,
    tier: "durable_result_replay",
    status: recovered ? "recovered" : "available",
    recommendedAction: recovered ? null : "recover_result",
    actions: {
      recoverResult: {
        action: "recover_result",
        enabled: !recovered,
        label: "Recover result",
        reasonCode: recovered
          ? "execution_recovery.result_already_recovered"
          : "execution_recovery.retained_result_available",
        warning: null,
      },
      resumeControllerConversation: {
        action: "resume_controller_conversation",
        enabled: false,
        label: "Continue conversation",
        reasonCode: "execution_recovery.durable_result_preferred",
        warning: null,
      },
      retryAsNewExecution: {
        action: "retry_as_new_execution",
        enabled: false,
        label: "Retry as new execution",
        reasonCode: "execution_recovery.durable_result_preferred",
        warning:
          "This starts a new execution and can repeat external side effects.",
      },
    },
    recoveredPublicationId: recovered ? "signal-recovered-1" : null,
    updatedAtMs: 1_806_000_000_000,
  };
}

function createWakeTraceWaterfallResponse(input?: {
  targetProfileId?: string;
}) {
  const targetProfileId = input?.targetProfileId ?? null;
  const itemTargetProfileId = targetProfileId ?? "agt_target_1";
  const ids = {
    clientMessageId: "client-message-1",
    sourceSignalId: "sig-source-1",
    targetProfileId: itemTargetProfileId,
    targetWakeLifecycleId: null,
    dispatchId: "dispatch-1",
    attemptId: null,
    claimLeaseId: null,
    bindingId: null,
    openMeldServiceRuntimeId: null,
    agentControllerRef: null,
    resultKey: null,
    resultRef: null,
    publishedSignalId: "sig-reply-1",
    replySignalId: "sig-reply-1",
  };
  return {
    query: {
      spaceId: "space-123",
      clientMessageId: "client-message-1",
      sourceSignalId: null,
      targetProfileId,
    },
    items: [
      {
        targetProfileId: itemTargetProfileId,
        targetLabel: "@watcher",
        correlation: {
          modelVersion: "openmeld.observability.wake.v1",
          selector: {
            kind: "client_message",
            spaceId: "space-123",
            clientMessageId: "client-message-1",
            targetProfileId: itemTargetProfileId,
          },
          spaceId: "space-123",
          clientMessageId: "client-message-1",
          sourceSignalId: "sig-source-1",
          targetProfileId: itemTargetProfileId,
          dispatchId: "dispatch-1",
          runtimeCoordinatorExecutionId: "rce-1",
          latestAttemptId: null,
          claimLeaseId: null,
          bindingId: null,
          openMeldServiceRuntimeId: null,
          agentControllerRef: null,
          resultRef: null,
          publishedSignalId: "sig-reply-1",
          replySignalId: "sig-reply-1",
          cloudflare: {
            cfRayId: null,
            requestId: null,
            traceId: null,
          },
        },
        executionContext: {
          resolutionStatus: "resolved",
          factSource: "dispatch_trace_origin",
          reasonCode: null,
          bindingId: "binding-1",
          openMeldServiceRuntimeId: "runtime-1",
          agentControllerRef: "builtin:codex",
          agentControllerConversationId: "conv-1",
          agentControllerConversationKind: "thread",
          runtimeWorkspacePath: "/tmp/openmeld-workspace",
          runtimeWorkspaceFingerprint: "sha256:workspace-1",
        },
        summary: {
          status: "replied",
          terminalStep: "reply_signal",
          reasonCode: "final_visible_message.reply_signal",
        },
        steps: [
          "source_signal",
          "planner",
          "dispatch",
          "head_lifecycle",
          "attempt",
          "result_inbox",
          "result",
          "reply_signal",
        ].map((name, order) => ({
          order,
          name,
          status: name === "reply_signal" ? "found" : "not_applicable",
          factSource:
            name === "reply_signal"
              ? "space_signal_by_published_signal_id"
              : null,
          observedAt: null,
          reasonCode: name === "reply_signal" ? "reply_signal.found" : null,
          ids,
        })),
      },
    ],
  };
}

function createMessageDetailsResponse(): GetSpaceMessageDetailsResponse {
  return {
    query: {
      spaceId: "space-123",
      signalId: "sig-reply-1",
    },
    message: {
      signalId: "sig-reply-1",
      signalType: "signal.text",
      sentAtMs: 1_803_000_000_000,
      actor: {
        profileId: "agt_target_1",
        profileKind: "agent",
        displayName: "@watcher",
        profileName: "@watcher",
        profileHandle: null,
      },
    },
    agentContext: {
      state: "recorded",
      profileId: recordedMessageDetailsFact(
        "agt_target_1",
        "space_signal_profile"
      ),
      profileName: recordedMessageDetailsFact(
        "@watcher",
        "space_signal_profile"
      ),
      agentControllerRef: recordedMessageDetailsFact(
        "builtin:codex",
        "space_signal_profile"
      ),
      agentControllerConversationId: recordedMessageDetailsFact(
        "conv-1",
        "space_signal_profile"
      ),
      workspacePath: recordedMessageDetailsFact(
        "/tmp/openmeld-workspace",
        "space_signal_profile"
      ),
      openMeldServiceRuntimeId: notRecordedMessageDetailsFact(
        "space_signal_profile"
      ),
      bindingId: notRecordedMessageDetailsFact("space_signal_profile"),
      workspaceFingerprint: notRecordedMessageDetailsFact(
        "space_signal_profile"
      ),
    },
    wakeContext: {
      state: "recorded",
      sourceSignalId: recordedMessageDetailsFact(
        "sig-source-1",
        "space_signal"
      ),
      clientMessageId: recordedMessageDetailsFact(
        "client-message-1",
        "space_signal"
      ),
      targets: [
        {
          targetProfileId: "agt_target_1",
          targetLabel: "@watcher",
          status: "replied",
          terminalStep: "reply_signal",
          reasonCode: "final_visible_message.reply_signal",
          agentContext: {
            state: "recorded",
            profileId: recordedMessageDetailsFact("agt_target_1", "wake_trace"),
            profileName: recordedMessageDetailsFact("@watcher", "wake_trace"),
            agentControllerRef: recordedMessageDetailsFact(
              "builtin:codex",
              "wake_trace_execution_context"
            ),
            agentControllerConversationId: recordedMessageDetailsFact(
              "conv-1",
              "wake_trace_execution_context"
            ),
            workspacePath: recordedMessageDetailsFact(
              "/tmp/openmeld-workspace",
              "wake_trace_execution_context"
            ),
            openMeldServiceRuntimeId: recordedMessageDetailsFact(
              "runtime-1",
              "wake_trace_execution_context"
            ),
            bindingId: recordedMessageDetailsFact(
              "binding-1",
              "wake_trace_execution_context"
            ),
            workspaceFingerprint: recordedMessageDetailsFact(
              "sha256:workspace-1",
              "wake_trace_execution_context"
            ),
          },
          steps:
            (
              createWakeTraceWaterfallResponse() as GetSpaceWakeTraceWaterfallResponse
            ).items[0]?.steps ?? [],
        },
      ],
    },
    replyContext: {
      state: "recorded",
      replyingToSignalId: recordedMessageDetailsFact(
        "sig-source-1",
        "reply_signal"
      ),
      replyingToAuthor: recordedMessageDetailsFact("Mira", "reply_signal"),
      previewText: recordedMessageDetailsFact(
        "@watcher(wake) please check",
        "reply_signal"
      ),
      resolved: true,
    },
    diagnostics: {
      signalId: "sig-reply-1",
      traceSelectors: [
        {
          kind: "signal",
          label: "Message ID",
          value: "sig-reply-1",
          targetProfileId: null,
        },
        {
          kind: "wake_source_signal",
          label: "Wake source signal ID",
          value: "sig-source-1",
          targetProfileId: null,
        },
      ],
    },
  };
}

function recordedMessageDetailsFact(
  value: string,
  source: GetSpaceMessageDetailsResponse["agentContext"]["profileId"]["source"]
): GetSpaceMessageDetailsResponse["agentContext"]["profileId"] {
  return {
    state: "recorded",
    value,
    source,
  };
}

function notRecordedMessageDetailsFact(
  source: GetSpaceMessageDetailsResponse["agentContext"]["profileId"]["source"]
): GetSpaceMessageDetailsResponse["agentContext"]["profileId"] {
  return {
    state: "not_recorded",
    value: null,
    source,
  };
}

describe("api-client space api", () => {
  it("exposes only the approved shared space methods", () => {
    const client = createOpenMeldApiClient({
      baseUrl: "https://gateway.openmeld.invalid",
      transport: vi.fn(() => Promise.resolve(new Response("ok"))),
    });

    expect(Object.keys(createSpaceApi(client)).sort()).toEqual([
      "addCenterAgentToSpace",
      "addMembers",
      "addOrganizationDirectoryProfilesToSpace",
      "createDiagnosticReport",
      "createFolder",
      "createSpace",
      "createThread",
      "deleteSpace",
      "discardComposerUpload",
      "downloadFileContent",
      "executeExecutionRecovery",
      "fileUpdateSettings",
      "getActiveWakeProgress",
      "getBootstrap",
      "getFile",
      "getHistoryNavigation",
      "getIdentityDirectory",
      "getLinkPreviews",
      "getMemberDirectory",
      "getMembersSnapshot",
      "getMessageDetails",
      "getMessageReactions",
      "getStatus",
      "getThread",
      "getUpdates",
      "getViewerMembership",
      "getWakeProgress",
      "getWakeTraceWaterfall",
      "inspectExecutionRecovery",
      "joinSpace",
      "leaveSpace",
      "listFileRevisions",
      "listFiles",
      "listSignalEnvelopes",
      "listSignals",
      "listThreadEvents",
      "listThreadSignals",
      "listThreads",
      "mutateMessage",
      "postNormalMessage",
      "postThreadSignal",
      "postWakeStop",
      "publishComposerUpload",
      "removeMembers",
      "resolveEntry",
      "respondToAgentInteraction",
      "restoreFileEntry",
      "restoreFileRevision",
      "setAccessMode",
      "setMessageReaction",
      "stageComposerUpload",
      "streamFileContent",
      "trashFileEntry",
      "updateFileContent",
      "updateFileEntry",
      "updateMeta",
      "uploadAttachment",
      "uploadFile",
    ]);
  });

  it("uses one shared Space Files contract for list and binary upload", async () => {
    const actor = {
      profileId: "11111111-1111-4111-8111-111111111111",
      profileKind: "human" as const,
      displayName: "Mira Stone",
      ownerUserId: "owner-1",
    };
    const file = {
      id: "file-1",
      spaceId: "space-123",
      parentId: null,
      name: "launch notes.md",
      path: "/launch notes.md",
      kind: "file" as const,
      createdAt: "2026-08-22T08:00:00.000Z",
      updatedAt: "2026-08-22T08:00:00.000Z",
      createdBy: actor,
      updatedBy: actor,
      trashedAt: null,
      trashedBy: null,
      latestRevision: {
        id: "revision-1",
        fileId: "file-1",
        revision: 1,
        mimeType: "text/markdown",
        sizeBytes: 5,
        createdAt: "2026-08-22T08:00:00.000Z",
        createdBy: actor,
      },
    };
    const transport = vi.fn((request: { init?: RequestInit; url: string }) => {
      let responseBody: unknown;
      if (
        request.url.includes("/revisions/") &&
        request.url.endsWith("/restore")
      ) {
        responseBody = { file };
      } else if (request.url.endsWith("/restore")) {
        responseBody = { entry: file };
      } else if (request.init?.method === "POST") {
        responseBody = { file };
      } else {
        responseBody = {
          breadcrumbs: [{ id: null, name: "Files" }],
          capabilities: { canRead: true, canWrite: true },
          entries: [],
          parentId: null,
          spaceId: "space-123",
          view: "trash",
        };
      }
      return Promise.resolve(Response.json(responseBody));
    });
    const api = createSpaceApi(
      createOpenMeldApiClient({
        baseUrl: "https://gateway.openmeld.invalid",
        transport,
      })
    );

    await expect(
      api.listFiles({ spaceId: "space-123", query: { view: "trash" } })
    ).resolves.toMatchObject({ entries: [], capabilities: { canWrite: true } });
    await expect(
      api.uploadFile({
        spaceId: "space-123",
        name: "launch notes.md",
        clientMutationId: "mutation-1",
        mimeType: "text/markdown",
        bytes: new TextEncoder().encode("hello"),
      })
    ).resolves.toEqual(file);
    await expect(
      api.restoreFileEntry({
        spaceId: "space-123",
        entryId: "file-1",
        clientMutationId: "restore-1",
      })
    ).resolves.toEqual(file);
    await expect(
      api.restoreFileRevision({
        spaceId: "space-123",
        fileId: "file-1",
        revision: 1,
        baseRevision: 4,
        clientMutationId: "restore-version-1",
      })
    ).resolves.toEqual(file);
    expect(transport).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({
        operation: "space.files.list",
        url: "https://gateway.openmeld.invalid/v1/spaces/space-123/files?view=trash",
      })
    );
    expect(transport).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({
        operation: "space.files.upload",
        url: "https://gateway.openmeld.invalid/v1/spaces/space-123/files?clientMutationId=mutation-1&name=launch+notes.md",
        init: expect.objectContaining({
          method: "POST",
          headers: expect.objectContaining({ "content-type": "text/markdown" }),
        }),
      })
    );
    expect(transport).toHaveBeenNthCalledWith(
      3,
      expect.objectContaining({
        operation: "space.files.entry.restore",
        url: "https://gateway.openmeld.invalid/v1/spaces/space-123/files/file-1/restore",
        init: expect.objectContaining({ method: "POST" }),
      })
    );
    expect(transport).toHaveBeenNthCalledWith(
      4,
      expect.objectContaining({
        operation: "space.files.revision.restore",
        url: "https://gateway.openmeld.invalid/v1/spaces/space-123/files/file-1/revisions/1/restore",
        init: expect.objectContaining({ method: "POST" }),
      })
    );
  });

  it("fails closed instead of showing active files as Trash during rollout", async () => {
    const transport = vi.fn(() =>
      Promise.resolve(
        Response.json({
          breadcrumbs: [{ id: null, name: "Files" }],
          capabilities: { canRead: true, canWrite: true },
          entries: [],
          parentId: null,
          spaceId: "space-123",
        })
      )
    );
    const api = createSpaceApi(
      createOpenMeldApiClient({
        baseUrl: "https://gateway.openmeld.invalid",
        transport,
      })
    );

    await expect(
      api.listFiles({ spaceId: "space-123", query: { view: "trash" } })
    ).rejects.toMatchObject({
      code: "gateway.invalid_response",
      schemaIssuePath: "view",
    });
  });

  it("inspects exact execution recovery through the shared space api", async () => {
    const recovery = createExecutionRecoveryProjection();
    const transport = vi.fn(() =>
      Promise.resolve(
        new Response(JSON.stringify({ recovery }), {
          status: 200,
          headers: { "content-type": "application/json" },
        })
      )
    );
    const api = createSpaceApi(
      createOpenMeldApiClient({
        baseUrl: "https://gateway.openmeld.invalid",
        transport,
      })
    );

    await expect(
      api.inspectExecutionRecovery({
        spaceId: "space-123",
        dispatchId: "dispatch-1",
        requestContext: REQUEST_CONTEXT,
      })
    ).resolves.toEqual({ recovery });
    expect(transport).toHaveBeenCalledWith(
      expect.objectContaining({
        url: "https://gateway.openmeld.invalid/v1/spaces/space-123/dispatches/dispatch-1/recovery",
        operation: "space.execution_recovery.inspect",
        init: expect.objectContaining({
          method: "GET",
        }),
      })
    );
  });

  it("executes exact execution recovery through the shared space api", async () => {
    const operationId = "recovery-operation-1";
    const recovered = createExecutionRecoveryProjection({ recovered: true });
    const transport = vi.fn(() =>
      Promise.resolve(
        new Response(
          JSON.stringify({
            status: "completed",
            action: "recover_result",
            operationId,
            recovery: recovered,
            publicationId: "signal-recovered-1",
            newExecutionId: null,
            reasonCode: "execution_recovery.result_recovered",
          }),
          {
            status: 200,
            headers: { "content-type": "application/json" },
          }
        )
      )
    );
    const api = createSpaceApi(
      createOpenMeldApiClient({
        baseUrl: "https://gateway.openmeld.invalid",
        transport,
      })
    );
    const body = {
      action: "recover_result",
      operationId,
      expectedIdentity: EXECUTION_RECOVERY_IDENTITY,
      destination: EXECUTION_RECOVERY_DESTINATION,
    } as const;

    await expect(
      api.executeExecutionRecovery({
        spaceId: "space-123",
        dispatchId: "dispatch-1",
        requestContext: REQUEST_CONTEXT,
        body,
      })
    ).resolves.toEqual({
      status: "completed",
      action: "recover_result",
      operationId,
      recovery: recovered,
      publicationId: "signal-recovered-1",
      newExecutionId: null,
      reasonCode: "execution_recovery.result_recovered",
    });
    expect(transport).toHaveBeenCalledWith(
      expect.objectContaining({
        url: "https://gateway.openmeld.invalid/v1/spaces/space-123/dispatches/dispatch-1/recovery",
        operation: "space.execution_recovery.execute",
        init: expect.objectContaining({
          method: "POST",
          headers: {
            "content-type": "application/json",
          },
          body: JSON.stringify(body),
        }),
      })
    );
  });

  it("rejects mismatched execution recovery identity before transport", async () => {
    const transport = vi.fn(() => Promise.resolve(new Response("ok")));
    const api = createSpaceApi(
      createOpenMeldApiClient({
        baseUrl: "https://gateway.openmeld.invalid",
        transport,
      })
    );

    await expect(
      api.executeExecutionRecovery({
        spaceId: "space-123",
        dispatchId: "dispatch-other",
        requestContext: REQUEST_CONTEXT,
        body: {
          action: "recover_result",
          operationId: "recovery-operation-1",
          expectedIdentity: EXECUTION_RECOVERY_IDENTITY,
          destination: EXECUTION_RECOVERY_DESTINATION,
        },
      })
    ).rejects.toThrow("dispatchId does not match expected execution identity");
    expect(transport).not.toHaveBeenCalled();
  });

  it("reads bootstrap through the shared space api", async () => {
    const transport = vi.fn(() =>
      Promise.resolve(
        new Response(
          JSON.stringify({
            status: {
              spaceId: "space-123",
              generatedAt: "2026-04-03T00:00:00.000Z",
              name: "phase-4-room",
              accessMode: "public",
              passwordProtected: false,
              dispatchPolicy: { mode: "mention_only" },
              publicationMode: "collaboration",
              allowedActions: ["post_message", "post_status", "stay_silent"],
              resultArchivePolicy: { mode: "all_final_results" },
              entryBrief: "default",
              dispatchBrief: "default",
              members: {
                totalCount: 1,
                humanCount: 1,
                agentCount: 0,
                liveNowCount: 0,
                liveHumanCount: 0,
                liveAgentCount: 0,
              },
            },
            members: {
              spaceId: "space-123",
              generatedAt: "2026-04-03T00:00:00.000Z",
              summary: {
                totalCount: 0,
                humanCount: 0,
                agentCount: 0,
                liveNowCount: 0,
              },
              humans: [],
              agents: [],
            },
            history: {
              signals: [],
              nextCursor: null,
            },
            threads: {
              threads: [],
              previews: [],
            },
          }),
          {
            status: 200,
            headers: { "content-type": "application/json" },
          }
        )
      )
    );
    const api = createSpaceApi(
      createOpenMeldApiClient({
        baseUrl: "https://gateway.openmeld.invalid",
        transport,
      })
    );

    const result = await api.getBootstrap({
      spaceId: "space-123",
      requestContext: REQUEST_CONTEXT,
      includeAgentStreamPresence: true,
      historyQuery: {
        recent: true,
        limit: 30,
        kinds: ["text", "status"],
      },
    });

    expect(result.status.spaceId).toBe("space-123");
    expect(transport).toHaveBeenCalledWith(
      expect.objectContaining({
        url: "https://gateway.openmeld.invalid/v1/spaces/space-123/bootstrap?recent=1&limit=30&signalType=signal.text&signalType=signal.status&includeAgentStreamPresence=true",
        operation: "space.bootstrap.read",
      })
    );
  });

  it("reads status through the shared space api", async () => {
    const transport = vi.fn(() =>
      Promise.resolve(
        new Response(
          JSON.stringify({
            spaceId: "space-123",
            generatedAt: "2026-04-03T00:00:00.000Z",
            name: "phase-4-room",
            accessMode: "public",
            passwordProtected: false,
            dispatchPolicy: { mode: "mention_only" },
            publicationMode: "collaboration",
            allowedActions: ["post_message", "post_status", "stay_silent"],
            resultArchivePolicy: { mode: "all_final_results" },
            entryBrief: "default",
            dispatchBrief: "default",
            members: {
              totalCount: 2,
              humanCount: 1,
              agentCount: 1,
              liveNowCount: 1,
              wakeableAgentCount: 0,
              offlineAgentCount: 0,
              liveHumanCount: 1,
              liveAgentCount: 0,
            },
          }),
          {
            status: 200,
            headers: { "content-type": "application/json" },
          }
        )
      )
    );
    const api = createSpaceApi(
      createOpenMeldApiClient({
        baseUrl: "https://gateway.openmeld.invalid",
        transport,
      })
    );

    const result = await api.getStatus({
      spaceId: "space-123",
      requestContext: REQUEST_CONTEXT,
      spacePassword: "pw-123",
    });

    expect(result.name).toBe("phase-4-room");
    expect(transport).toHaveBeenCalledWith(
      expect.objectContaining({
        url: "https://gateway.openmeld.invalid/v1/spaces/space-123/status",
        operation: "space.status.read",
      })
    );
  });

  it("passes abort signals through shared space api reads", async () => {
    const controller = new AbortController();
    const transport = vi.fn(() =>
      Promise.resolve(
        new Response(
          JSON.stringify({
            spaceId: "space-123",
            generatedAt: "2026-04-03T00:00:00.000Z",
            name: "phase-4-room",
            accessMode: "public",
            passwordProtected: false,
            dispatchPolicy: { mode: "mention_only" },
            publicationMode: "collaboration",
            allowedActions: ["post_message", "post_status", "stay_silent"],
            resultArchivePolicy: { mode: "all_final_results" },
            entryBrief: "default",
            dispatchBrief: "default",
            members: {
              totalCount: 0,
              humanCount: 0,
              agentCount: 0,
              liveNowCount: 0,
              wakeableAgentCount: 0,
              offlineAgentCount: 0,
              liveHumanCount: 0,
              liveAgentCount: 0,
            },
          }),
          {
            status: 200,
            headers: { "content-type": "application/json" },
          }
        )
      )
    );
    const api = createSpaceApi(
      createOpenMeldApiClient({
        baseUrl: "https://gateway.openmeld.invalid",
        transport,
      })
    );

    await api.getStatus({
      spaceId: "space-123",
      requestContext: REQUEST_CONTEXT,
      signal: controller.signal,
    });

    expect(transport).toHaveBeenCalledWith(
      expect.objectContaining({
        url: "https://gateway.openmeld.invalid/v1/spaces/space-123/status",
        operation: "space.status.read",
        init: expect.objectContaining({
          signal: controller.signal,
        }),
      })
    );
  });

  it("preserves message focus when resolving Space entry", async () => {
    const transport = vi.fn(() =>
      Promise.resolve(
        Response.json({
          target: {
            spaceId: "space-123",
            signalId: "signal-1",
            threadRootSignalId: "thread-1",
          },
          view: { state: "allowed", experience: "member" },
          participation: { state: "active_member" },
          safeContext: {
            organizationId: "org-1",
            organizationSlug: "acme",
            spaceName: "Launch planning",
          },
          recovery: null,
        })
      )
    );
    const api = createSpaceApi(
      createOpenMeldApiClient({
        baseUrl: "https://gateway.openmeld.invalid",
        transport,
      })
    );

    await expect(
      api.resolveEntry({
        spaceId: "space-123",
        signalId: "signal-1",
        threadRootSignalId: "thread-1",
        requestContext: REQUEST_CONTEXT,
      })
    ).resolves.toMatchObject({
      target: { signalId: "signal-1", threadRootSignalId: "thread-1" },
      view: { state: "allowed", experience: "member" },
    });
    expect(transport).toHaveBeenCalledWith(
      expect.objectContaining({
        operation: "space.entry.resolve",
        url: "https://gateway.openmeld.invalid/v1/spaces/space-123/entry-resolution?signalId=signal-1&threadRootSignalId=thread-1",
      })
    );
  });

  it("sets access mode through the shared space api", async () => {
    const transport = vi.fn(() =>
      Promise.resolve(
        new Response(
          JSON.stringify({
            spaceId: "space-123",
            accessMode: "public_view_join_password",
            passwordProtected: true,
          }),
          {
            status: 200,
            headers: { "content-type": "application/json" },
          }
        )
      )
    );
    const api = createSpaceApi(
      createOpenMeldApiClient({
        baseUrl: "https://gateway.openmeld.invalid",
        transport,
      })
    );

    const result = await api.setAccessMode({
      spaceId: "space-123",
      requestContext: REQUEST_CONTEXT,
      accessMode: "public_view_join_password",
      password: "pw-123",
    });

    expect(result).toEqual({
      spaceId: "space-123",
      accessMode: "public_view_join_password",
      passwordProtected: true,
    });
    expect(transport).toHaveBeenCalledWith(
      expect.objectContaining({
        url: "https://gateway.openmeld.invalid/v1/spaces/space-123/access-mode",
        operation: "space.access_mode.set",
        init: expect.objectContaining({
          method: "PUT",
          body: JSON.stringify({
            accessMode: "public_view_join_password",
            password: "pw-123",
          }),
        }),
      })
    );
  });

  it("updates and normalizes Space metadata through the shared space api", async () => {
    const transport = vi.fn(() =>
      Promise.resolve(
        new Response(
          JSON.stringify({
            spaceId: "space-123",
            organizationId: "org-123",
            visibility: "private",
            name: "Launch Room",
          }),
          {
            status: 200,
            headers: { "content-type": "application/json" },
          }
        )
      )
    );
    const api = createSpaceApi(
      createOpenMeldApiClient({
        baseUrl: "https://gateway.openmeld.invalid",
        transport,
      })
    );

    await expect(
      api.updateMeta({
        spaceId: "space-123",
        requestContext: REQUEST_CONTEXT,
        name: "  Launch Room  ",
      })
    ).resolves.toMatchObject({ name: "Launch Room" });
    expect(transport).toHaveBeenCalledWith(
      expect.objectContaining({
        url: "https://gateway.openmeld.invalid/v1/spaces/space-123/meta",
        operation: "space.meta.update",
        init: expect.objectContaining({
          method: "PATCH",
          body: JSON.stringify({ name: "Launch Room" }),
        }),
      })
    );
  });

  it("reads members snapshot through the shared space api", async () => {
    const transport = vi.fn(() =>
      Promise.resolve(
        new Response(
          JSON.stringify({
            spaceId: "space-123",
            generatedAt: "2026-04-03T00:00:00.000Z",
            humans: [],
            agents: [],
            summary: {
              totalCount: 0,
              humanCount: 0,
              agentCount: 0,
              liveNowCount: 0,
              wakeableAgentCount: 0,
              offlineAgentCount: 0,
            },
          }),
          {
            status: 200,
            headers: { "content-type": "application/json" },
          }
        )
      )
    );
    const api = createSpaceApi(
      createOpenMeldApiClient({
        baseUrl: "https://gateway.openmeld.invalid",
        transport,
      })
    );

    const result = await api.getMembersSnapshot({
      spaceId: "space-123",
      requestContext: REQUEST_CONTEXT,
    });

    expect(result.spaceId).toBe("space-123");
    expect(transport).toHaveBeenCalledWith(
      expect.objectContaining({
        url: "https://gateway.openmeld.invalid/v1/spaces/space-123/members",
        operation: "space.members.list",
      })
    );
  });

  it("reads member directory through the shared space api", async () => {
    const transport = vi.fn(() =>
      Promise.resolve(
        new Response(
          JSON.stringify({
            spaceId: "space-123",
            generatedAt: "2026-04-03T00:00:00.000Z",
            members: [
              {
                profileId: "11111111-1111-4111-8111-111111111111",
                profileKind: "human",
                displayName: "Mira",
                primaryMentionLabel: "Mira",
                mentionLabels: ["Mira"],
                mentionAlias: null,
                labelSource: "profile_name",
                lookupTokens: ["mira"],
                preferredLookupToken: "mira",
                profileIdShort: "11111111",
                allowedRelations: {
                  wake: false,
                  reference: false,
                  mention: true,
                },
                ownerUserId: "owner-1",
                ownerName: "Mira",
                agentCard: null,
                spaceRole: null,
              },
            ],
          }),
          {
            status: 200,
            headers: { "content-type": "application/json" },
          }
        )
      )
    );
    const api = createSpaceApi(
      createOpenMeldApiClient({
        baseUrl: "https://gateway.openmeld.invalid",
        transport,
      })
    );

    const result = await api.getMemberDirectory({
      spaceId: "space-123",
      requestContext: REQUEST_CONTEXT,
    });

    expect(result.members).toHaveLength(1);
    expect(result.members[0]?.allowedRelations.mention).toBe(true);
    expect(transport).toHaveBeenCalledWith(
      expect.objectContaining({
        url: "https://gateway.openmeld.invalid/v1/spaces/space-123/member-directory",
        operation: "space.member_directory.read",
        init: expect.objectContaining({
          headers: {
            [OPENMELD_HEADER_SPACE_ADDRESSING_VERSION]:
              OPENMELD_SPACE_ADDRESSING_VERSION,
          },
        }),
      })
    );
  });

  it("reads identity directory through the shared space api", async () => {
    const transport = vi.fn(() =>
      Promise.resolve(
        new Response(
          JSON.stringify({
            spaceId: "space-123",
            generatedAt: "2026-04-03T00:00:00.000Z",
            entries: [
              {
                profileId: "11111111-1111-4111-8111-111111111111",
                profileName: "Mira",
                profileKind: "human",
                mentionAlias: null,
                ownerUserId: "owner-1",
                ownerName: "Mira",
                agentControllerRef: null,
              },
              {
                profileId: "agt_11111111-1111-4111-8111-111111111111",
                profileName: "Mira Codex",
                profileKind: "agent",
                mentionAlias: "codex",
                ownerUserId: "owner-1",
                ownerName: "Mira",
                agentControllerRef: "builtin:codex",
              },
            ],
          }),
          {
            status: 200,
            headers: { "content-type": "application/json" },
          }
        )
      )
    );
    const api = createSpaceApi(
      createOpenMeldApiClient({
        baseUrl: "https://gateway.openmeld.invalid",
        transport,
      })
    );

    const result = await api.getIdentityDirectory({
      spaceId: "space-123",
      requestContext: REQUEST_CONTEXT,
    });

    expect(result.entries).toHaveLength(2);
    expect(transport).toHaveBeenCalledWith(
      expect.objectContaining({
        url: "https://gateway.openmeld.invalid/v1/spaces/space-123/identity-directory",
        operation: "space.identity_directory.read",
      })
    );
  });

  it("reads viewer membership through the shared space api", async () => {
    const transport = vi.fn(() =>
      Promise.resolve(
        new Response(
          JSON.stringify({
            spaceId: "space-123",
            activeMemberProfiles: [
              {
                profileId: "agt_11111111-1111-4111-8111-111111111111",
                profileKind: "agent",
                profileName: "Mira Agent",
                lastEnteredAt: null,
              },
            ],
            preferredOpenProfileId: "agt_11111111-1111-4111-8111-111111111111",
          }),
          {
            status: 200,
            headers: { "content-type": "application/json" },
          }
        )
      )
    );
    const api = createSpaceApi(
      createOpenMeldApiClient({
        baseUrl: "https://gateway.openmeld.invalid",
        transport,
      })
    );

    const result = await api.getViewerMembership({
      spaceId: "space-123",
      requestContext: REQUEST_CONTEXT,
    });

    expect(result.preferredOpenProfileId).toBe(
      "agt_11111111-1111-4111-8111-111111111111"
    );
    expect(transport).toHaveBeenCalledWith(
      expect.objectContaining({
        url: "https://gateway.openmeld.invalid/v1/spaces/space-123/viewer-membership",
        operation: "space.viewer_membership.read",
      })
    );
  });

  it("leaves a space through the shared space api", async () => {
    const transport = vi.fn(() =>
      Promise.resolve(
        new Response(
          JSON.stringify({
            leftProfileId: "11111111-1111-4111-8111-111111111111",
            status: "left",
          }),
          {
            status: 200,
            headers: { "content-type": "application/json" },
          }
        )
      )
    );
    const api = createSpaceApi(
      createOpenMeldApiClient({
        baseUrl: "https://gateway.openmeld.invalid",
        transport,
      })
    );

    const result = await api.leaveSpace({
      spaceId: "space-123",
      requestContext: REQUEST_CONTEXT,
      spacePassword: "pw-123",
    });

    expect(result).toEqual({
      leftProfileId: "11111111-1111-4111-8111-111111111111",
      status: "left",
    });
    expect(transport).toHaveBeenCalledWith(
      expect.objectContaining({
        url: "https://gateway.openmeld.invalid/v1/spaces/space-123/leave",
        operation: "space.leave",
        init: expect.objectContaining({
          method: "POST",
        }),
      })
    );
  });

  it("removes members through the shared space api", async () => {
    const transport = vi.fn(() =>
      Promise.resolve(
        new Response(
          JSON.stringify({
            removedMemberIds: ["11111111-1111-4111-8111-111111111111"],
            alreadyAbsentMemberIds: [],
          }),
          {
            status: 200,
            headers: { "content-type": "application/json" },
          }
        )
      )
    );
    const api = createSpaceApi(
      createOpenMeldApiClient({
        baseUrl: "https://gateway.openmeld.invalid",
        transport,
      })
    );

    const result = await api.removeMembers({
      memberProfileIds: ["11111111-1111-4111-8111-111111111111"],
      requestContext: REQUEST_CONTEXT,
      spaceId: "space-123",
      spacePassword: "pw-123",
    });

    expect(result).toEqual({
      removedMemberIds: ["11111111-1111-4111-8111-111111111111"],
      alreadyAbsentMemberIds: [],
    });
    expect(transport).toHaveBeenCalledWith(
      expect.objectContaining({
        url: "https://gateway.openmeld.invalid/v1/spaces/space-123/members/remove",
        operation: "space.members.remove",
        init: expect.objectContaining({
          body: JSON.stringify({
            memberProfileIds: ["11111111-1111-4111-8111-111111111111"],
          }),
          method: "POST",
        }),
      })
    );
  });

  it("joins a public Organization Space through the shared space api", async () => {
    const transport = vi.fn(() =>
      Promise.resolve(
        new Response(
          JSON.stringify({
            addedMemberIds: ["11111111-1111-4111-8111-111111111111"],
            alreadyMemberIds: [],
            items: [],
          }),
          {
            status: 200,
            headers: { "content-type": "application/json" },
          }
        )
      )
    );
    const api = createSpaceApi(
      createOpenMeldApiClient({
        baseUrl: "https://gateway.openmeld.invalid",
        transport,
      })
    );

    const result = await api.joinSpace({
      spaceId: "space-123",
      requestContext: REQUEST_CONTEXT,
      spacePassword: "  pw-123  ",
    });

    expect(result).toEqual({
      addedMemberIds: ["11111111-1111-4111-8111-111111111111"],
      alreadyMemberIds: [],
      items: [],
    });
    expect(transport).toHaveBeenCalledWith(
      expect.objectContaining({
        url: "https://gateway.openmeld.invalid/v1/spaces/space-123/join",
        operation: "space.join",
        init: expect.objectContaining({
          headers: expect.objectContaining({
            "x-openmeld-space-password": "pw-123",
          }),
          method: "POST",
        }),
      })
    );
  });

  it("sends the displayed Center Agent identity through the shared space api", async () => {
    const expectedCenterAgentProfileId =
      "agt_22222222-2222-4222-8222-222222222222";
    const transport = vi.fn(() =>
      Promise.resolve(
        new Response(
          JSON.stringify({
            addedMemberIds: [expectedCenterAgentProfileId],
            alreadyMemberIds: [],
            items: [],
          }),
          {
            status: 200,
            headers: { "content-type": "application/json" },
          }
        )
      )
    );
    const api = createSpaceApi(
      createOpenMeldApiClient({
        baseUrl: "https://gateway.openmeld.invalid",
        transport,
      })
    );

    await api.addCenterAgentToSpace({
      expectedCenterAgentProfileId,
      requestContext: REQUEST_CONTEXT,
      spaceId: "space-123",
    });

    expect(transport).toHaveBeenCalledWith(
      expect.objectContaining({
        url: "https://gateway.openmeld.invalid/v1/spaces/space-123/center-agent",
        operation: "space.center_agent_member.add",
        init: expect.objectContaining({
          body: JSON.stringify({ expectedCenterAgentProfileId }),
          method: "POST",
        }),
      })
    );
  });

  it("adds selected Organization Directory profiles through one shared space request", async () => {
    const humanProfileId = "11111111-1111-4111-8111-111111111111";
    const centerAgentProfileId = "agt_22222222-2222-4222-8222-222222222222";
    const transport = vi.fn(() =>
      Promise.resolve(
        new Response(
          JSON.stringify({
            addedMemberIds: [humanProfileId, centerAgentProfileId],
            alreadyMemberIds: [],
            items: [],
          }),
          {
            status: 200,
            headers: { "content-type": "application/json" },
          }
        )
      )
    );
    const api = createSpaceApi(
      createOpenMeldApiClient({
        baseUrl: "https://gateway.openmeld.invalid",
        transport,
      })
    );

    await api.addOrganizationDirectoryProfilesToSpace({
      directoryProfileIds: [humanProfileId, centerAgentProfileId],
      expectedCenterAgentProfileId: centerAgentProfileId,
      requestContext: REQUEST_CONTEXT,
      spaceId: "space-123",
    });

    expect(transport).toHaveBeenCalledWith(
      expect.objectContaining({
        url: "https://gateway.openmeld.invalid/v1/spaces/space-123/organization-directory-profiles",
        operation: "space.organization_directory_profiles.add",
        init: expect.objectContaining({
          body: JSON.stringify({
            directoryProfileIds: [humanProfileId, centerAgentProfileId],
            expectedCenterAgentProfileId: centerAgentProfileId,
          }),
          method: "POST",
        }),
      })
    );
  });

  it("deletes a space through the shared space api", async () => {
    const transport = vi.fn(() =>
      Promise.resolve(
        new Response(
          JSON.stringify({
            deleted: true,
            spaceId: "space-123",
          }),
          {
            status: 200,
            headers: { "content-type": "application/json" },
          }
        )
      )
    );
    const api = createSpaceApi(
      createOpenMeldApiClient({
        baseUrl: "https://gateway.openmeld.invalid",
        transport,
      })
    );

    const result = await api.deleteSpace({
      requestContext: REQUEST_CONTEXT,
      spaceId: "space-123",
      spacePassword: "pw-123",
    });

    expect(result).toEqual({
      deleted: true,
      spaceId: "space-123",
    });
    expect(transport).toHaveBeenCalledWith(
      expect.objectContaining({
        url: "https://gateway.openmeld.invalid/v1/spaces/space-123",
        operation: "space.delete",
        init: expect.objectContaining({
          method: "DELETE",
        }),
      })
    );
  });

  it("normalizes signal query semantics through the shared space api", async () => {
    const transport = vi.fn(() =>
      Promise.resolve(
        new Response(
          JSON.stringify({
            signals: [],
            nextCursor: null,
          }),
          {
            status: 200,
            headers: { "content-type": "application/json" },
          }
        )
      )
    );
    const api = createSpaceApi(
      createOpenMeldApiClient({
        baseUrl: "https://gateway.openmeld.invalid",
        transport,
      })
    );

    await api.listSignals({
      spaceId: "space-123",
      requestContext: REQUEST_CONTEXT,
      query: {
        recent: true,
        limit: 0,
      },
    });

    expect(transport).toHaveBeenCalledWith(
      expect.objectContaining({
        url: "https://gateway.openmeld.invalid/v1/spaces/space-123/signals?recent=1&limit=200",
        operation: "space.signals.read",
      })
    );
  });

  it("preserves after-signal limit=0 semantics through the shared space api", async () => {
    const transport = vi.fn(() =>
      Promise.resolve(
        new Response(
          JSON.stringify({
            signals: [],
            nextCursor: null,
          }),
          {
            status: 200,
            headers: { "content-type": "application/json" },
          }
        )
      )
    );
    const api = createSpaceApi(
      createOpenMeldApiClient({
        baseUrl: "https://gateway.openmeld.invalid",
        transport,
      })
    );

    await api.listSignals({
      spaceId: "space-123",
      requestContext: REQUEST_CONTEXT,
      query: {
        afterSignalId: "sig-anchor-1",
        limit: 0,
      },
    });

    expect(transport).toHaveBeenCalledWith(
      expect.objectContaining({
        url: "https://gateway.openmeld.invalid/v1/spaces/space-123/signals?limit=0&afterSignalId=sig-anchor-1",
      })
    );
  });

  it("serializes timestamp and cursor history pagination through the shared space api", async () => {
    const transport = vi.fn(() =>
      Promise.resolve(
        new Response(
          JSON.stringify({
            signals: [],
            nextCursor: null,
          }),
          {
            status: 200,
            headers: { "content-type": "application/json" },
          }
        )
      )
    );
    const api = createSpaceApi(
      createOpenMeldApiClient({
        baseUrl: "https://gateway.openmeld.invalid",
        transport,
      })
    );

    await api.listSignals({
      spaceId: "space-123",
      requestContext: REQUEST_CONTEXT,
      query: {
        afterTs: 1_786_291_200_000,
        cursor: "2026-08-10T08:00:00.000Z::signal-30",
        limit: 30,
      },
    });

    expect(transport).toHaveBeenCalledWith(
      expect.objectContaining({
        url: "https://gateway.openmeld.invalid/v1/spaces/space-123/signals?afterTs=1786291200000&cursor=2026-08-10T08%3A00%3A00.000Z%3A%3Asignal-30&limit=30",
      })
    );
  });

  it("serializes an exact anchored history read with zero surrounding messages", () => {
    expect(
      buildSpaceSignalsReadPath("space-123", {
        aroundSignalId: "sig-anchor-exact",
        beforeCount: 0,
        afterCount: 0,
        kinds: ["text"],
      })
    ).toBe(
      "/v1/spaces/space-123/signals?aroundSignalId=sig-anchor-exact&beforeCount=0&afterCount=0&signalType=signal.text"
    );
  });

  it("rejects signal anchors combined with timestamp pagination", async () => {
    const api = createSpaceApi(
      createOpenMeldApiClient({
        baseUrl: "https://gateway.openmeld.invalid",
        transport: vi.fn(() => Promise.resolve(new Response("ok"))),
      })
    );

    await expect(
      api.listSignals({
        spaceId: "space-123",
        requestContext: REQUEST_CONTEXT,
        query: {
          afterSignalId: "sig-anchor-1",
          afterTs: 1_786_291_200_000,
          limit: 30,
        },
      })
    ).rejects.toThrow(
      "Signal anchors cannot be combined with afterTs or cursor."
    );
  });

  it("rejects conflicting signal anchor modes", async () => {
    const api = createSpaceApi(
      createOpenMeldApiClient({
        baseUrl: "https://gateway.openmeld.invalid",
        transport: vi.fn(() => Promise.resolve(new Response("ok"))),
      })
    );

    await expect(
      api.listSignals({
        spaceId: "space-123",
        requestContext: REQUEST_CONTEXT,
        query: {
          afterSignalId: "sig-anchor-1",
          aroundSignalId: "sig-anchor-2",
          limit: 10,
        },
      })
    ).rejects.toThrow("Cannot use both afterSignalId and aroundSignalId.");
  });

  it("drops invalid signal envelopes while preserving nextCursor", async () => {
    const transport = vi.fn(() =>
      Promise.resolve(
        new Response(
          JSON.stringify({
            signals: [
              {
                v: 1,
                id: "evt-1",
                spaceId: "space-123",
                ts: 1,
                profile: { kind: "agent", profileId: "agt-1" },
                type: "signal.text",
                data: { text: "hello" },
              },
              {
                bad: true,
              },
            ],
            nextCursor: "cursor-2",
          }),
          {
            status: 200,
            headers: { "content-type": "application/json" },
          }
        )
      )
    );
    const api = createSpaceApi(
      createOpenMeldApiClient({
        baseUrl: "https://gateway.openmeld.invalid",
        transport,
      })
    );

    const result = await api.listSignalEnvelopes({
      spaceId: "space-123",
      requestContext: REQUEST_CONTEXT,
    });

    expect(result.nextCursor).toBe("cursor-2");
    expect(result.envelopes).toEqual([
      expect.objectContaining({
        type: "signal.text",
        id: "evt-1",
      }) satisfies Partial<SignalEnvelope>,
    ]);
  });

  it("reads incremental updates through the shared space api", async () => {
    const transport = vi.fn(() =>
      Promise.resolve(
        new Response(
          JSON.stringify({
            signals: [],
          }),
          {
            status: 200,
            headers: { "content-type": "application/json" },
          }
        )
      )
    );
    const api = createSpaceApi(
      createOpenMeldApiClient({
        baseUrl: "https://gateway.openmeld.invalid",
        transport,
      })
    );

    const result = await api.getUpdates({
      spaceId: "space-123",
      afterSignalId: "sig-123",
      limit: 50,
      requestContext: REQUEST_CONTEXT,
    });

    expect(result.signals).toEqual([]);
    expect(transport).toHaveBeenCalledWith(
      expect.objectContaining({
        url: "https://gateway.openmeld.invalid/v1/spaces/space-123/updates?afterSignalId=sig-123&limit=50",
        operation: "space.updates.read",
      })
    );
  });

  it("reads a bounded thread delta after an observation cursor", async () => {
    const transport = vi.fn(() =>
      Promise.resolve(
        new Response(JSON.stringify({ placements: [], signals: [] }), {
          status: 200,
          headers: { "content-type": "application/json" },
        })
      )
    );
    const api = createSpaceApi(
      createOpenMeldApiClient({
        baseUrl: "https://gateway.openmeld.invalid",
        transport,
      })
    );

    await expect(
      api.listThreadSignals({
        afterSignalId: "sig-thread-source",
        limit: 20,
        requestContext: REQUEST_CONTEXT,
        spaceId: "space-123",
        threadId: "thread-123",
      })
    ).resolves.toEqual({ placements: [], signals: [] });
    expect(transport).toHaveBeenCalledWith(
      expect.objectContaining({
        operation: "space.thread.signals",
        url: "https://gateway.openmeld.invalid/v1/spaces/space-123/threads/thread-123/signals?afterSignalId=sig-thread-source&limit=20",
      })
    );
  });

  it("rejects invalid incremental updates input before transport", async () => {
    const transport = vi.fn(() => Promise.resolve(new Response("ok")));
    const api = createSpaceApi(
      createOpenMeldApiClient({
        baseUrl: "https://gateway.openmeld.invalid",
        transport,
      })
    );

    await expect(
      api.getUpdates({
        spaceId: "space-123",
        afterSignalId: "   ",
        limit: 50,
        requestContext: REQUEST_CONTEXT,
      })
    ).rejects.toThrow("afterSignalId is required");
    expect(transport).not.toHaveBeenCalled();
  });

  it("rejects non-positive incremental updates limits before transport", async () => {
    const transport = vi.fn(() => Promise.resolve(new Response("ok")));
    const api = createSpaceApi(
      createOpenMeldApiClient({
        baseUrl: "https://gateway.openmeld.invalid",
        transport,
      })
    );

    await expect(
      api.getUpdates({
        spaceId: "space-123",
        afterSignalId: "sig-123",
        limit: 0,
        requestContext: REQUEST_CONTEXT,
      })
    ).rejects.toThrow("limit must be a positive integer");

    await expect(
      api.getUpdates({
        spaceId: "space-123",
        afterSignalId: "sig-123",
        limit: -1,
        requestContext: REQUEST_CONTEXT,
      })
    ).rejects.toThrow("limit must be a positive integer");

    expect(transport).not.toHaveBeenCalled();
  });

  it("posts normal messages through the shared space api", async () => {
    const attachments = [
      {
        id: "attachment-1",
        mimeType: "image/png" as const,
        sizeBytes: 1024,
        width: 800,
        height: 600,
        fileName: "diagram.png",
      },
    ];
    const transport = vi.fn(() =>
      Promise.resolve(
        new Response(
          JSON.stringify({
            v: 1,
            id: "evt-1",
            spaceId: "space-123",
            ts: 1,
            profile: { kind: "human", profileId: "human_profile_1" },
            type: "signal.text",
            data: {
              text: "hello",
              attachments,
              messageEnvelope: {
                activationTargets: [],
                ccTargets: [],
                referenceTargets: ["11111111-1111-4111-8111-111111111111"],
                mentionTargets: ["22222222-2222-4222-8222-222222222222"],
                text: "hello",
              },
            },
          }),
          {
            status: 200,
            headers: { "content-type": "application/json" },
          }
        )
      )
    );
    const api = createSpaceApi(
      createOpenMeldApiClient({
        baseUrl: "https://gateway.openmeld.invalid",
        transport,
      })
    );

    const result = await api.postNormalMessage({
      spaceId: "space-123",
      requestContext: REQUEST_CONTEXT,
      timeoutMs: 30_000,
      text: "hello",
      attachments,
      messageEnvelope: {
        activationTargets: [],
        referenceTargets: ["11111111-1111-4111-8111-111111111111"],
        mentionTargets: ["22222222-2222-4222-8222-222222222222"],
        text: "hello",
      },
      meta: {
        purpose: "smoke",
      },
    });

    expect(result.type).toBe("signal.text");
    expect(result.data.attachments).toEqual(attachments);
    expect(result.data.messageEnvelope).not.toHaveProperty("ccTargets");
    expect(transport).toHaveBeenCalledWith(
      expect.objectContaining({
        url: "https://gateway.openmeld.invalid/v1/spaces/space-123/signals",
        operation: "space.send",
        timeoutMs: 30_000,
        init: expect.objectContaining({
          method: "POST",
          headers: {
            "content-type": "application/json",
            [OPENMELD_HEADER_SPACE_ADDRESSING_VERSION]:
              OPENMELD_SPACE_ADDRESSING_VERSION,
          },
          body: JSON.stringify({
            text: "hello",
            attachments,
            messageEnvelope: {
              activationTargets: [],
              referenceTargets: ["11111111-1111-4111-8111-111111111111"],
              mentionTargets: ["22222222-2222-4222-8222-222222222222"],
              text: "hello",
            },
            meta: {
              purpose: "smoke",
            },
          }),
        }),
      })
    );
  });

  it("forwards per-request timeouts when posting thread messages", async () => {
    const threadId = "thr_11111111-1111-4111-8111-111111111111";
    const transport = vi.fn(() =>
      Promise.resolve(
        new Response(
          JSON.stringify({
            signal: {
              v: 1,
              id: "evt-thread-1",
              spaceId: "space-123",
              ts: 1,
              profile: { kind: "human", profileId: "human_profile_1" },
              type: "signal.text",
              data: {
                text: "thread reply",
                meta: { clientMessageId: "client-message-thread-1" },
              },
            },
            placement: {
              threadId,
              signalId: "evt-thread-1",
              placement: "thread",
              createdAt: "2026-07-15T00:00:00.000Z",
            },
          }),
          {
            status: 200,
            headers: { "content-type": "application/json" },
          }
        )
      )
    );
    const api = createSpaceApi(
      createOpenMeldApiClient({
        baseUrl: "https://gateway.openmeld.invalid",
        transport,
      })
    );

    await api.postThreadSignal({
      spaceId: "space-123",
      threadId,
      requestContext: REQUEST_CONTEXT,
      timeoutMs: 30_000,
      body: {
        text: "thread reply",
        clientMessageId: "client-message-thread-1",
        messageEnvelope: {
          activationTargets: [],
          referenceTargets: ["11111111-1111-4111-8111-111111111111"],
          mentionTargets: ["22222222-2222-4222-8222-222222222222"],
          text: "thread reply",
        },
      },
    });

    expect(transport).toHaveBeenCalledWith(
      expect.objectContaining({
        operation: "space.thread.send",
        timeoutMs: 30_000,
        init: expect.objectContaining({
          body: JSON.stringify({
            text: "thread reply",
            messageEnvelope: {
              activationTargets: [],
              referenceTargets: ["11111111-1111-4111-8111-111111111111"],
              mentionTargets: ["22222222-2222-4222-8222-222222222222"],
              text: "thread reply",
            },
            clientMessageId: "client-message-thread-1",
          }),
          headers: {
            "content-type": "application/json",
            [OPENMELD_HEADER_SPACE_ADDRESSING_VERSION]:
              OPENMELD_SPACE_ADDRESSING_VERSION,
          },
        }),
      })
    );
  });

  it("reads Wake progress through the shared space api", async () => {
    const transport = vi.fn(() =>
      Promise.resolve(
        new Response(
          JSON.stringify({
            query: {
              spaceId: "space-123",
              clientMessageId: "client-message-1",
              targetProfileId: null,
            },
            items: [
              {
                clientMessageId: "client-message-1",
                sourceSignalId: "sig-source-1",
                dispatchId: "dispatch-1",
                targetProfileId: "agt_33333333-3333-4333-8333-333333333333",
                targetLabel: "@watcher",
                phase: "running",
                message: "@watcher is working on this computer...",
                updatedAtMs: 1_805_000_000_000,
                terminal: false,
              },
            ],
          }),
          {
            status: 200,
            headers: { "content-type": "application/json" },
          }
        )
      )
    );
    const api = createSpaceApi(
      createOpenMeldApiClient({
        baseUrl: "https://gateway.openmeld.invalid",
        transport,
      })
    );

    const result = await api.getWakeProgress({
      spaceId: "space-123",
      requestContext: REQUEST_CONTEXT,
      clientMessageId: "client-message-1",
      timeoutMs: 15_000,
    });

    expect(result.items[0]?.phase).toBe("running");
    expect(transport).toHaveBeenCalledWith(
      expect.objectContaining({
        url: "https://gateway.openmeld.invalid/v1/spaces/space-123/wake-progress?clientMessageId=client-message-1",
        operation: "space.wake_progress",
        timeoutMs: 15_000,
        init: expect.objectContaining({
          method: "GET",
        }),
      })
    );
  });

  it("reads active Space Wake progress through the shared space api", async () => {
    const transport = vi.fn(() =>
      Promise.resolve(
        new Response(
          JSON.stringify({
            query: {
              spaceId: "space-123",
              targetProfileId: null,
            },
            items: [
              {
                clientMessageId: "client-message-1",
                sourceSignalId: "sig-source-1",
                dispatchId: "dispatch-1",
                targetProfileId: "agt_33333333-3333-4333-8333-333333333333",
                targetLabel: "@watcher",
                phase: "running",
                message: "@watcher is working on this computer...",
                updatedAtMs: 1_805_000_000_000,
                terminal: false,
              },
            ],
          }),
          {
            status: 200,
            headers: { "content-type": "application/json" },
          }
        )
      )
    );
    const api = createSpaceApi(
      createOpenMeldApiClient({
        baseUrl: "https://gateway.openmeld.invalid",
        transport,
      })
    );

    const result = await api.getActiveWakeProgress({
      spaceId: "space-123",
      requestContext: REQUEST_CONTEXT,
    });

    expect(result.items[0]?.phase).toBe("running");
    expect(transport).toHaveBeenCalledWith(
      expect.objectContaining({
        url: "https://gateway.openmeld.invalid/v1/spaces/space-123/active-wake-progress",
        operation: "space.active_wake_progress",
        init: expect.objectContaining({
          method: "GET",
        }),
      })
    );
  });

  it("passes optional Wake progress projections through Wake progress routes", async () => {
    const transport = vi.fn((request: { url: string }) => {
      const url = String(request.url);
      const isActiveWakeProgress = url.includes("/active-wake-progress");
      return Promise.resolve(
        new Response(
          JSON.stringify({
            query: isActiveWakeProgress
              ? {
                  spaceId: "space-123",
                  sourceProfileId: "human-source-1",
                  targetProfileId: null,
                }
              : {
                  spaceId: "space-123",
                  clientMessageId: "client-message-1",
                  targetProfileId: null,
                },
            ...(isActiveWakeProgress
              ? { pageInfo: { hasMore: false, limit: 25 } }
              : {}),
            items: [
              {
                clientMessageId: "client-message-1",
                sourceSignalId: "sig-source-1",
                dispatchId: "dispatch-1",
                targetProfileId: "agt_33333333-3333-4333-8333-333333333333",
                targetLabel: "@watcher",
                phase: "running",
                message: "@watcher is working on this computer...",
                updatedAtMs: 1_805_000_000_000,
                terminal: false,
                wakeStopEligibility: {
                  controlMode: "cancel",
                  reasonCode: null,
                  reliability: "native_cancel",
                  status: "eligible",
                },
              },
            ],
          }),
          {
            status: 200,
            headers: { "content-type": "application/json" },
          }
        )
      );
    });
    const api = createSpaceApi(
      createOpenMeldApiClient({
        baseUrl: "https://gateway.openmeld.invalid",
        transport,
      })
    );

    await api.getWakeProgress({
      clientMessageId: "client-message-1",
      includePreviewText: true,
      includeSourceContext: true,
      includeTiming: true,
      includeWaitReason: true,
      includeWakeStopEligibility: true,
      requestContext: REQUEST_CONTEXT,
      spaceId: "space-123",
    });
    await api.getActiveWakeProgress({
      includePageInfo: true,
      includePreviewText: true,
      includeSourceContext: true,
      includeTiming: true,
      includeWaitReason: true,
      includeWakeStopEligibility: true,
      sourceProfileId: "human-source-1",
      requestContext: REQUEST_CONTEXT,
      spaceId: "space-123",
    });

    expect(transport).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({
        url: "https://gateway.openmeld.invalid/v1/spaces/space-123/wake-progress?clientMessageId=client-message-1&includePreviewText=true&includeSourceContext=true&includeTiming=true&includeWaitReason=true&includeWakeStopEligibility=true",
      })
    );
    expect(transport).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({
        url: "https://gateway.openmeld.invalid/v1/spaces/space-123/active-wake-progress?includePageInfo=true&includePreviewText=true&includeSourceContext=true&includeTiming=true&includeWaitReason=true&includeWakeStopEligibility=true&sourceProfileId=human-source-1",
      })
    );
  });

  it("fails closed when an older server ignores the active Wake source filter", async () => {
    const transport = vi.fn(() =>
      Promise.resolve(
        new Response(
          JSON.stringify({
            query: {
              spaceId: "space-123",
              targetProfileId: null,
            },
            items: [],
          }),
          {
            status: 200,
            headers: { "content-type": "application/json" },
          }
        )
      )
    );
    const api = createSpaceApi(
      createOpenMeldApiClient({
        baseUrl: "https://gateway.openmeld.invalid",
        transport,
      })
    );

    await expect(
      api.getActiveWakeProgress({
        requestContext: REQUEST_CONTEXT,
        sourceProfileId: "human-source-1",
        spaceId: "space-123",
      })
    ).rejects.toMatchObject({
      code: "gateway.invalid_response",
      operation: "space.active_wake_progress",
      schemaIssuePath: "query.sourceProfileId",
    });
  });

  it("fails closed when an older server omits requested active Wake page information", async () => {
    const transport = vi.fn(() =>
      Promise.resolve(
        Response.json({
          query: { spaceId: "space-123", targetProfileId: null },
          items: [],
        })
      )
    );
    const api = createSpaceApi(
      createOpenMeldApiClient({
        baseUrl: "https://gateway.openmeld.invalid",
        transport,
      })
    );

    await expect(
      api.getActiveWakeProgress({
        includePageInfo: true,
        requestContext: REQUEST_CONTEXT,
        spaceId: "space-123",
      })
    ).rejects.toMatchObject({
      code: "gateway.invalid_response",
      operation: "space.active_wake_progress",
      schemaIssuePath: "pageInfo",
    });
  });

  it("posts Space Wake Stop through the shared space api", async () => {
    const transport = vi.fn(() =>
      Promise.resolve(
        new Response(
          JSON.stringify({
            ok: true,
            runtimeCoordinatorExecutionId: "rce_01HZX6ZAQ2JX1K7K3X3HYD6P8C",
            status: "cancellation_requested",
            targetProfileId: "agt_33333333-3333-4333-8333-333333333333",
            cancellationState: {
              observedAtMs: 1_805_000_000_000,
              reasonCode: "runtime_coordinator.wake_stop_requested",
              status: "requested",
            },
          }),
          {
            status: 200,
            headers: { "content-type": "application/json" },
          }
        )
      )
    );
    const api = createSpaceApi(
      createOpenMeldApiClient({
        baseUrl: "https://gateway.openmeld.invalid",
        transport,
      })
    );

    const result = await api.postWakeStop({
      spaceId: "space-123",
      requestContext: REQUEST_CONTEXT,
      timeoutMs: 15_000,
      body: {
        target: {
          by: "client_message",
          clientMessageId: "client-message-1",
          targetProfileId: "agt_33333333-3333-4333-8333-333333333333",
        },
      },
    });

    expect(result.status).toBe("cancellation_requested");
    expect(transport).toHaveBeenCalledWith(
      expect.objectContaining({
        url: "https://gateway.openmeld.invalid/v1/spaces/space-123/wake-stop",
        operation: "space.wake_stop",
        timeoutMs: 15_000,
        init: expect.objectContaining({
          method: "POST",
          headers: {
            "content-type": "application/json",
          },
          body: JSON.stringify({
            target: {
              by: "client_message",
              clientMessageId: "client-message-1",
              targetProfileId: "agt_33333333-3333-4333-8333-333333333333",
            },
          }),
        }),
      })
    );
    const request = (transport.mock.calls as unknown[][])[0]?.[0] as
      | { init?: { body?: string } }
      | undefined;
    expect(request?.init?.body).not.toContain("dispatchId");
    expect(request?.init?.body).not.toContain("taskId");
  });

  it("responds to a pending local agent interaction through the shared space api", async () => {
    const transport = vi.fn(() =>
      Promise.resolve(
        new Response(
          JSON.stringify({
            ok: true,
            respondedAtMs: 1_805_000_000_000,
            status: "accepted",
          }),
          {
            status: 200,
            headers: { "content-type": "application/json" },
          }
        )
      )
    );
    const api = createSpaceApi(
      createOpenMeldApiClient({
        baseUrl: "https://gateway.openmeld.invalid",
        transport,
      })
    );

    const result = await api.respondToAgentInteraction({
      body: {
        interactionId: "interaction-1",
        response: {
          kind: "permission",
          optionId: "allow-once",
        },
        runtimeCoordinatorExecutionId: "rce_01HZX6ZAQ2JX1K7K3X3HYD6P8C",
      },
      requestContext: REQUEST_CONTEXT,
      spaceId: "space-123",
    });

    expect(result.status).toBe("accepted");
    expect(transport).toHaveBeenCalledWith(
      expect.objectContaining({
        init: expect.objectContaining({
          body: JSON.stringify({
            runtimeCoordinatorExecutionId: "rce_01HZX6ZAQ2JX1K7K3X3HYD6P8C",
            interactionId: "interaction-1",
            response: {
              kind: "permission",
              optionId: "allow-once",
            },
          }),
          method: "POST",
        }),
        operation: "space.agent_interaction.respond",
        url: "https://gateway.openmeld.invalid/v1/spaces/space-123/agent-interactions/respond",
      })
    );
  });

  it("reads Wake trace waterfall through the shared space api", async () => {
    const transport = vi.fn(() =>
      Promise.resolve(
        new Response(JSON.stringify(createWakeTraceWaterfallResponse()), {
          status: 200,
          headers: { "content-type": "application/json" },
        })
      )
    );
    const api = createSpaceApi(
      createOpenMeldApiClient({
        baseUrl: "https://gateway.openmeld.invalid",
        transport,
      })
    );

    const result = await api.getWakeTraceWaterfall({
      spaceId: "space-123",
      requestContext: REQUEST_CONTEXT,
      clientMessageId: "client-message-1",
    });

    expect(result.items[0]?.summary.status).toBe("replied");
    expect(transport).toHaveBeenCalledWith(
      expect.objectContaining({
        url: "https://gateway.openmeld.invalid/v1/spaces/space-123/wake-trace-waterfall?clientMessageId=client-message-1",
        operation: "space.wake_trace_waterfall",
        init: expect.objectContaining({
          method: "GET",
        }),
      })
    );
  });

  it("reads target-scoped Wake trace waterfall through the shared space api", async () => {
    const transport = vi.fn(() =>
      Promise.resolve(
        new Response(
          JSON.stringify(
            createWakeTraceWaterfallResponse({
              targetProfileId: "agt_target_1",
            })
          ),
          {
            status: 200,
            headers: { "content-type": "application/json" },
          }
        )
      )
    );
    const api = createSpaceApi(
      createOpenMeldApiClient({
        baseUrl: "https://gateway.openmeld.invalid",
        transport,
      })
    );

    const result = await api.getWakeTraceWaterfall({
      spaceId: "space-123",
      requestContext: REQUEST_CONTEXT,
      clientMessageId: "client-message-1",
      targetProfileId: "agt_target_1",
    });

    expect(result.query.targetProfileId).toBe("agt_target_1");
    expect(result.items).toHaveLength(1);
    expect(transport).toHaveBeenCalledWith(
      expect.objectContaining({
        url: "https://gateway.openmeld.invalid/v1/spaces/space-123/wake-trace-waterfall?clientMessageId=client-message-1&targetProfileId=agt_target_1",
        operation: "space.wake_trace_waterfall",
        init: expect.objectContaining({
          method: "GET",
        }),
      })
    );
  });

  it("reads source-signal Wake trace waterfall through the shared space api", async () => {
    const response =
      createWakeTraceWaterfallResponse() as GetSpaceWakeTraceWaterfallResponse;
    response.query.clientMessageId = null;
    response.query.sourceSignalId = "sig-source-1";
    const item = response.items[0];
    if (!item) {
      throw new Error("test fixture must include one waterfall item");
    }
    item.correlation.selector = {
      kind: "source_signal",
      spaceId: "space-123",
      sourceSignalId: "sig-source-1",
      targetProfileId: "agt_target_1",
    };
    item.correlation.clientMessageId = null;
    item.steps = item.steps.map((step) => ({
      ...step,
      ids: { ...step.ids, clientMessageId: null },
    }));
    const transport = vi.fn(() =>
      Promise.resolve(
        new Response(JSON.stringify(response), {
          status: 200,
          headers: { "content-type": "application/json" },
        })
      )
    );
    const api = createSpaceApi(
      createOpenMeldApiClient({
        baseUrl: "https://gateway.openmeld.invalid",
        transport,
      })
    );

    const result = await api.getWakeTraceWaterfall({
      spaceId: "space-123",
      requestContext: REQUEST_CONTEXT,
      sourceSignalId: "sig-source-1",
    });

    expect(result.query.sourceSignalId).toBe("sig-source-1");
    expect(transport).toHaveBeenCalledWith(
      expect.objectContaining({
        url: "https://gateway.openmeld.invalid/v1/spaces/space-123/wake-trace-waterfall?sourceSignalId=sig-source-1",
        operation: "space.wake_trace_waterfall",
        init: expect.objectContaining({
          method: "GET",
        }),
      })
    );
  });

  it("reads Message Details through the shared space api", async () => {
    const transport = vi.fn(() =>
      Promise.resolve(
        new Response(JSON.stringify(createMessageDetailsResponse()), {
          status: 200,
          headers: { "content-type": "application/json" },
        })
      )
    );
    const api = createSpaceApi(
      createOpenMeldApiClient({
        baseUrl: "https://gateway.openmeld.invalid",
        transport,
      })
    );

    const result = await api.getMessageDetails({
      spaceId: "space-123",
      requestContext: REQUEST_CONTEXT,
      signalId: "sig-reply-1",
    });

    expect(result.message.signalId).toBe("sig-reply-1");
    expect(result.agentContext.agentControllerConversationId.value).toBe(
      "conv-1"
    );
    expect(transport).toHaveBeenCalledWith(
      expect.objectContaining({
        url: "https://gateway.openmeld.invalid/v1/spaces/space-123/message-details?signalId=sig-reply-1",
        operation: "space.message_details",
        init: expect.objectContaining({
          method: "GET",
        }),
      })
    );
  });

  it("rejects invalid Message Details responses", async () => {
    const response =
      createMessageDetailsResponse() as GetSpaceMessageDetailsResponse;
    response.agentContext.agentControllerConversationId = {
      state: "recorded",
      value: null,
      source: "space_signal_profile",
    };
    const transport = vi.fn(() =>
      Promise.resolve(
        new Response(JSON.stringify(response), {
          status: 200,
          headers: { "content-type": "application/json" },
        })
      )
    );
    const api = createSpaceApi(
      createOpenMeldApiClient({
        baseUrl: "https://gateway.openmeld.invalid",
        transport,
      })
    );

    await expect(
      api.getMessageDetails({
        spaceId: "space-123",
        requestContext: REQUEST_CONTEXT,
        signalId: "sig-reply-1",
      })
    ).rejects.toThrow("invalid message details response");
  });

  it("rejects invalid Wake trace waterfall responses", async () => {
    const transport = vi.fn(() =>
      Promise.resolve(
        new Response(
          JSON.stringify({
            query: {
              spaceId: "space-123",
              clientMessageId: "client-message-1",
              sourceSignalId: null,
              targetProfileId: null,
            },
            items: [
              {
                targetProfileId: "agt_target_1",
                targetLabel: "@watcher",
                summary: {
                  status: "ready",
                  terminalStep: null,
                  reasonCode: null,
                },
                steps: [],
              },
            ],
          }),
          {
            status: 200,
            headers: { "content-type": "application/json" },
          }
        )
      )
    );
    const api = createSpaceApi(
      createOpenMeldApiClient({
        baseUrl: "https://gateway.openmeld.invalid",
        transport,
      })
    );

    await expect(
      api.getWakeTraceWaterfall({
        spaceId: "space-123",
        requestContext: REQUEST_CONTEXT,
        clientMessageId: "client-message-1",
      })
    ).rejects.toThrow("invalid wake trace waterfall response");
  });

  it("creates a diagnostic report without sending message text", async () => {
    const transport = vi.fn(() =>
      Promise.resolve(
        new Response(
          JSON.stringify({
            diagnosticReportId: "diag_123",
            spaceId: "space-123",
            reportedSignalId: "sig-reply-1",
            replyToSignalId: "sig-source-1",
            threadId: null,
            problemType: "reply_problem",
            reporterProfileId: "human_profile_1",
            createdAtMs: 1_805_000_000_000,
            wakePointers: [
              {
                spaceId: "space-123",
                clientMessageId: "client-message-1",
                sourceSignalId: "sig-source-1",
                targetProfileId: "agt_33333333-3333-4333-8333-333333333333",
              },
            ],
            wakePointerDerivation: {
              status: "exact",
              reasonCodes: ["diagnostic_report.reply_target_exact"],
            },
          }),
          {
            status: 201,
            headers: { "content-type": "application/json" },
          }
        )
      )
    );
    const api = createSpaceApi(
      createOpenMeldApiClient({
        baseUrl: "https://gateway.openmeld.invalid",
        transport,
      })
    );

    const result = await api.createDiagnosticReport({
      spaceId: "space-123",
      requestContext: REQUEST_CONTEXT,
      body: {
        reportedSignalId: "sig-reply-1",
        problemType: "reply_problem",
      },
    });

    expect(result.diagnosticReportId).toBe("diag_123");
    expect(transport).toHaveBeenCalledWith(
      expect.objectContaining({
        url: "https://gateway.openmeld.invalid/v1/spaces/space-123/diagnostic-reports",
        operation: "space.diagnostic_report.create",
        init: expect.objectContaining({
          method: "POST",
          headers: {
            "content-type": "application/json",
          },
          body: JSON.stringify({
            reportedSignalId: "sig-reply-1",
            problemType: "reply_problem",
          }),
        }),
      })
    );
    const request = (transport.mock.calls as unknown[][])[0]?.[0] as
      | { init?: { body?: string } }
      | undefined;
    expect(request?.init?.body).not.toContain("message text");
  });

  it("rejects invalid normal message bodies before transport", async () => {
    const transport = vi.fn(() => Promise.resolve(new Response("ok")));
    const api = createSpaceApi(
      createOpenMeldApiClient({
        baseUrl: "https://gateway.openmeld.invalid",
        transport,
      })
    );

    await expect(
      api.postNormalMessage({
        spaceId: "space-123",
        requestContext: REQUEST_CONTEXT,
        text: "",
      })
    ).rejects.toThrow();
    expect(transport).not.toHaveBeenCalled();
  });

  it("keeps status, members, signals, updates, and send aligned with shared schemas", () => {
    expect(getSpaceStatusResponseSchema).toBeDefined();
    expect(spaceMembersSnapshotSchema).toBeDefined();
    expect(catchupResponseSchema).toBeDefined();
    expect(getSpaceUpdatesResponseSchema).toBeDefined();
    expect(spaceBootstrapResponseSchema).toBeDefined();
    expect(getActiveSpaceWakeProgressResponseSchema).toBeDefined();
    expect(getSpaceWakeProgressResponseSchema).toBeDefined();
    expect(getSpaceWakeTraceWaterfallResponseSchema).toBeDefined();
    expect(createSpaceDiagnosticReportResponseSchema).toBeDefined();
    expect(postNormalMessageResponseSchema).toBeDefined();
    expect(spaceViewerMembershipResponseSchema).toBeDefined();
  });
});
