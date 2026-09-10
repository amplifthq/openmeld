import { buildMessageChannelConversationId } from "@openmeld/schemas";
import type {
  ChannelContext,
  MessageChannelIngressEnvelope,
} from "@openmeld/schemas/types";
import { describe, expect, it, vi } from "vitest";
import type { CoreBindings } from "../src/lib/bindings";
import {
  createMessageChannelProviderRegistry,
  type MessageChannelProviderAdapter,
} from "../src/remote-agent/application/message-channel-adapters";
import {
  processRemoteAgentMessageChannelEvent,
  RemoteAgentMessageChannelEventRetryableError,
  type RemoteAgentMessageChannelEventServiceDependencies,
} from "../src/remote-agent/application/message-channel-event-service";
import { TEST_CENTER_AGENT_MODEL_ROUTE } from "./helpers/center-agent-model-route.test-support";

const VERSION_FIVE_UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-5[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u;

describe("Remote Agent Message Channel event service", () => {
  it("rejects durable events accepted by a prior connection generation before reading context or executing", async () => {
    const dependencies = createDependencies();
    const adapter = createProviderAdapter();
    const result = await processRemoteAgentMessageChannelEvent(
      {
        db: {} as D1Database,
        identityDb: {} as D1Database,
        env: {} as CoreBindings,
        envelope: { ...createEnvelope(), connectionGeneration: 2 },
        queueAttempts: 1,
        queueMessageId: "old-generation-event",
        registry: createMessageChannelProviderRegistry([adapter]),
      },
      dependencies
    );
    expect(result).toEqual({
      status: "rejected",
      reasonCode: "message_channel.connection_generation_changed",
    });
    expect(adapter.readChannelContext).not.toHaveBeenCalled();
    expect(dependencies.submitNativeDelivery).not.toHaveBeenCalled();
  });
  it("admits a known member through the shared native-delivery path and advances context only after admission", async () => {
    const envelope = createEnvelope();
    const channelContext = createChannelContext(envelope);
    const adapter = createProviderAdapter({
      readChannelContext: vi.fn(() => Promise.resolve(channelContext)),
    });
    const dependencies = createDependencies();
    const sequence: string[] = [];
    dependencies.submitNativeDelivery.mockImplementation(async (input) => {
      sequence.push("admitted");
      expect(adapter.readChannelContext).not.toHaveBeenCalled();
      Object.assign(input.request, await input.prepareInput?.());
      return Promise.resolve({
        deliveryId: "delivery_lark_1",
        dispatchId: "dispatch_lark_1",
        idempotencyKey: "idempotency_lark_1",
        providerPublicationIdempotencyKey:
          "21f74ea8-904c-56a2-b09f-575ed7ee3d9c",
        shouldAck: true,
        status: "submitted" as const,
      });
    });
    dependencies.upsertContextCursor.mockImplementation(() => {
      sequence.push("cursor_advanced");
      return Promise.resolve({} as never);
    });

    const result = await processRemoteAgentMessageChannelEvent(
      {
        db: {} as D1Database,
        env: {} as CoreBindings,
        envelope,
        identityDb: {} as D1Database,
        queueAttempts: 1,
        queueMessageId: "queue_message_1",
        registry: createMessageChannelProviderRegistry([adapter]),
      },
      dependencies
    );

    expect(result).toEqual({
      deliveryId: "delivery_lark_1",
      status: "submitted",
    });
    expect(adapter.readChannelContext).toHaveBeenCalledWith(
      expect.objectContaining({
        conversationId: buildMessageChannelConversationId(
          envelope.event.kind === "message"
            ? envelope.event.locator
            : ({} as never)
        ),
        event: envelope.event,
      })
    );
    expect(dependencies.submitNativeDelivery).toHaveBeenCalledWith(
      expect.objectContaining({
        request: expect.objectContaining({
          locator:
            envelope.event.kind === "message"
              ? envelope.event.locator
              : undefined,
          sourceText: "Prepare the launch brief.",
          target: expect.objectContaining({
            centerAgent: expect.objectContaining({
              agentProfileId: "agt_11111111-1111-4111-8111-111111111111",
              bindingId: "binding_lark_1",
              ownerUserId: "user_center_agent",
            }),
            participant: expect.objectContaining({
              kind: "member",
              member: expect.objectContaining({
                memberId: "member_1",
                userId: "user_1",
              }),
            }),
          }),
          turnEnvelope: expect.objectContaining({
            channelContext,
            trigger: expect.objectContaining({
              provider: "lark",
              source: "message_channel",
            }),
          }),
        }),
      })
    );
    expect(sequence).toEqual(["admitted", "cursor_advanced"]);
    expect(dependencies.completeIngress).toHaveBeenCalledWith(
      expect.objectContaining({
        nativeDeliveryId: "delivery_lark_1",
        outcomeStatus: "submitted",
      })
    );
  });

  it("admits an external Lark participant with an unverified sender boundary", async () => {
    const envelope = createEnvelope();
    if (envelope.event.kind !== "message") {
      throw new Error("Expected a message envelope");
    }
    envelope.event.senderDisplayName = "Guest Ari";
    envelope.event.senderTenantKey = "tenant_lark_test";
    const adapter = createProviderAdapter();
    const dependencies = createDependencies();
    dependencies.resolveTurnTarget.mockResolvedValue({
      status: "resolved",
      target: {
        centerAgent: {
          agentProfileId: "agt_11111111-1111-4111-8111-111111111111",
          bindingId: "binding_lark_1",
          modelRoute: TEST_CENTER_AGENT_MODEL_ROUTE,
          ownerUserId: "user_center_agent",
          profileHandle: "center-agent",
          profileName: "Center Agent",
        },
        connection: createLarkConnection(),
        participant: {
          kind: "anonymous_member",
          organization: {
            memberCount: 3,
            organizationId: "org_1",
            organizationName: "OpenMeld Labs",
            organizationPersonal: false,
            organizationSlug: "openmeld-labs",
          },
          providerUserDisplayName: "Guest Ari",
          providerUserId: "ou_member_1",
        },
      },
    });

    await processRemoteAgentMessageChannelEvent(
      {
        db: {} as D1Database,
        env: {} as CoreBindings,
        envelope,
        identityDb: {} as D1Database,
        queueAttempts: 1,
        queueMessageId: "queue_message_1",
        registry: createMessageChannelProviderRegistry([adapter]),
      },
      dependencies
    );

    expect(dependencies.resolveTurnTarget).toHaveBeenCalledWith(
      expect.objectContaining({
        providerUserDisplayName: "Guest Ari",
        providerUserId: "ou_member_1",
        providerUserTenantKey: "tenant_lark_test",
      })
    );
    expect(dependencies.submitNativeDelivery).toHaveBeenCalledWith(
      expect.objectContaining({
        request: expect.objectContaining({
          turnEnvelope: expect.objectContaining({
            sender: {
              displayName: "Guest Ari",
              id: "lark:connection_lark_1:ou_member_1",
              kind: "member",
              messageChannelIdentity: {
                connectionId: "connection_lark_1",
                provider: "lark",
                providerUserId: "ou_member_1",
              },
              verified: false,
            },
          }),
        }),
      })
    );
  });

  it("keeps the verified request when provider context is unavailable", async () => {
    const envelope = createEnvelope();
    const adapter = createProviderAdapter({
      readChannelContext: vi.fn(() =>
        Promise.reject(new Error("provider context API unavailable"))
      ),
    });
    const dependencies = createDependencies();

    await processRemoteAgentMessageChannelEvent(
      {
        db: {} as D1Database,
        env: {} as CoreBindings,
        envelope,
        identityDb: {} as D1Database,
        queueAttempts: 1,
        queueMessageId: "queue_message_1",
        registry: createMessageChannelProviderRegistry([adapter]),
      },
      dependencies
    );

    expect(dependencies.submitNativeDelivery).toHaveBeenCalledWith(
      expect.objectContaining({
        request: expect.objectContaining({
          sourceText: "Prepare the launch brief.",
          turnEnvelope: expect.objectContaining({
            channelContext: expect.objectContaining({
              currentMessageId: "om_message_1",
              messages: [],
              sync: { mode: "snapshot", status: "unavailable" },
            }),
          }),
        }),
      })
    );
  });

  it("publishes a visible failure when the Center Agent model is unavailable", async () => {
    const envelope = createEnvelope();
    const adapter = createProviderAdapter();
    adapter.publishFailure = vi.fn(() =>
      Promise.resolve({
        resultId: "om_model_unavailable_1",
        status: "published" as const,
      })
    );
    const dependencies = createDependencies();
    dependencies.resolveTurnTarget.mockResolvedValue({
      connection: createLarkConnection(),
      reasonCode: "message_channel.center_agent_model_unavailable",
      status: "rejected",
    });

    await expect(
      processRemoteAgentMessageChannelEvent(
        {
          db: {} as D1Database,
          env: {} as CoreBindings,
          envelope,
          identityDb: {} as D1Database,
          queueAttempts: 1,
          queueMessageId: "queue_message_model_unavailable",
          registry: createMessageChannelProviderRegistry([adapter]),
        },
        dependencies
      )
    ).resolves.toEqual({
      reasonCode: "message_channel.center_agent_model_unavailable",
      status: "rejected",
    });
    expect(adapter.publishFailure).toHaveBeenCalledWith({
      connection: expect.objectContaining({
        connectionId: "connection_lark_1",
      }),
      failureCode: "message_channel.center_agent_model_unavailable",
      locator:
        envelope.event.kind === "message" ? envelope.event.locator : undefined,
      providerPublicationIdempotencyKey: expect.stringMatching(
        VERSION_FIVE_UUID_PATTERN
      ),
      text: "Center Agent couldn't start because its selected model is unavailable. Ask an organization owner or admin to choose an available model in OpenMeld.",
    });
    expect(dependencies.submitNativeDelivery).not.toHaveBeenCalled();
    expect(dependencies.completeIngress).toHaveBeenCalledWith(
      expect.objectContaining({
        nativeDeliveryId: null,
        outcomeStatus: "message_channel.center_agent_model_unavailable",
      })
    );
  });

  it("passes only authorized prepared images into the native delivery", async () => {
    const envelope = createEnvelope();
    if (envelope.event.kind !== "message") {
      throw new Error("Expected message event");
    }
    envelope.event.resources = [
      {
        fileKey: "img_v3_launch",
        fileName: null,
        mimeType: null,
        sizeBytes: null,
        type: "image",
      },
    ];
    const adapter = createProviderAdapter();
    const dependencies = createDependencies();
    dependencies.prepareInputAttachments.mockResolvedValue({
      attachments: [
        {
          fileName: "launch.png",
          id: "message-channel-image-1",
          mimeType: "image/png",
          removeAfterAdmission: true,
          sizeBytes: 128,
        },
      ],
      status: "ready",
    });

    await processRemoteAgentMessageChannelEvent(
      {
        db: {} as D1Database,
        env: {
          OPENMELD_SPACE_ATTACHMENTS: {} as R2Bucket,
        } as CoreBindings,
        envelope,
        identityDb: {} as D1Database,
        queueAttempts: 1,
        queueMessageId: "queue_message_image_1",
        registry: createMessageChannelProviderRegistry([adapter]),
      },
      dependencies
    );

    expect(dependencies.prepareInputAttachments).toHaveBeenCalledWith(
      expect.objectContaining({
        adapter,
        bucket: expect.anything(),
        connection: expect.objectContaining({
          connectionId: "connection_lark_1",
          organizationId: "org_1",
        }),
        event: envelope.event,
      })
    );
    expect(dependencies.submitNativeDelivery).toHaveBeenCalledWith(
      expect.objectContaining({
        request: expect.objectContaining({
          attachments: [
            expect.objectContaining({
              id: "message-channel-image-1",
              removeAfterAdmission: true,
            }),
          ],
        }),
      })
    );
  });

  it("retries ingress when authorized provider image download is transiently unavailable", async () => {
    const envelope = createEnvelope();
    if (envelope.event.kind !== "message") {
      throw new Error("Expected message event");
    }
    envelope.event.resources = [
      {
        fileKey: "img_v3_launch",
        fileName: null,
        mimeType: null,
        sizeBytes: null,
        type: "image",
      },
    ];
    const adapter = createProviderAdapter();
    const dependencies = createDependencies();
    dependencies.prepareInputAttachments.mockResolvedValue({
      reasonCode: "lark.message_resource_http_503",
      status: "retryable",
    });

    await expect(
      processRemoteAgentMessageChannelEvent(
        {
          db: {} as D1Database,
          env: {} as CoreBindings,
          envelope,
          identityDb: {} as D1Database,
          queueAttempts: 1,
          queueMessageId: "queue_message_image_retry_1",
          registry: createMessageChannelProviderRegistry([adapter]),
        },
        dependencies
      )
    ).rejects.toMatchObject({
      reasonCode: "lark.message_resource_http_503",
    });
    expect(dependencies.submitNativeDelivery).toHaveBeenCalledOnce();
    expect(dependencies.releaseIngress).toHaveBeenCalledWith(
      expect.objectContaining({
        failureReasonCode: "lark.message_resource_http_503",
      })
    );
  });

  it("ignores an unmentioned group message before resolving an OpenMeld member", async () => {
    const envelope = createEnvelope({ mention: "group_message" });
    const adapter = createProviderAdapter();
    const dependencies = createDependencies();

    await expect(
      processRemoteAgentMessageChannelEvent(
        {
          db: {} as D1Database,
          env: {} as CoreBindings,
          envelope,
          identityDb: {} as D1Database,
          queueAttempts: 1,
          queueMessageId: "queue_message_1",
          registry: createMessageChannelProviderRegistry([adapter]),
        },
        dependencies
      )
    ).resolves.toEqual({
      reasonCode: "message_channel.group_message_not_addressed",
      status: "ignored",
    });
    expect(dependencies.resolveTurnTarget).not.toHaveBeenCalled();
    expect(dependencies.submitNativeDelivery).not.toHaveBeenCalled();
    expect(dependencies.completeIngress).toHaveBeenCalledWith(
      expect.objectContaining({
        nativeDeliveryId: null,
        outcomeStatus: "message_channel.group_message_not_addressed",
      })
    );
  });

  it("treats an exhausted ingress as an accepted terminal duplicate", async () => {
    const envelope = createEnvelope();
    const adapter = createProviderAdapter();
    const dependencies = createDependencies();
    dependencies.claimIngress.mockResolvedValue({
      record: {
        eventKey:
          "message-channel-event-v1:lark:connection_lark_1:event_lark_1",
        state: "failed",
      },
      status: "duplicate",
    });

    await expect(
      processRemoteAgentMessageChannelEvent(
        {
          db: {} as D1Database,
          env: {} as CoreBindings,
          envelope,
          identityDb: {} as D1Database,
          queueAttempts: 1,
          queueMessageId: "queue_message_provider_retry",
          registry: createMessageChannelProviderRegistry([adapter]),
        },
        dependencies
      )
    ).resolves.toEqual({ status: "duplicate" });
    expect(dependencies.resolveTurnTarget).not.toHaveBeenCalled();
    expect(dependencies.releaseIngress).not.toHaveBeenCalled();
    expect(dependencies.failIngress).not.toHaveBeenCalled();
  });

  it("admits an explicitly supported card action as a Center Agent turn", async () => {
    const envelope = createCardActionEnvelope();
    const adapter = createProviderAdapter();
    const dependencies = createDependencies();

    await expect(
      processRemoteAgentMessageChannelEvent(
        {
          db: {} as D1Database,
          env: {} as CoreBindings,
          envelope,
          identityDb: {} as D1Database,
          queueAttempts: 1,
          queueMessageId: "queue_card_action_1",
          registry: createMessageChannelProviderRegistry([adapter]),
        },
        dependencies
      )
    ).resolves.toEqual({
      deliveryId: "delivery_lark_1",
      status: "submitted",
    });
    expect(dependencies.resolveTurnTarget).toHaveBeenCalledWith(
      expect.objectContaining({ providerUserId: "ou_member_1" })
    );
    expect(dependencies.submitNativeDelivery).toHaveBeenCalledWith(
      expect.objectContaining({
        request: expect.objectContaining({
          locator: envelope.event.locator,
          sourceText: "Continue with the launch plan.",
          triggerMessageId: "card_action_1",
        }),
      })
    );
    expect(dependencies.upsertContextCursor).not.toHaveBeenCalled();
  });

  it("releases the ingress claim when failure publication can be retried", async () => {
    const envelope = createEnvelope();
    const adapter = createProviderAdapter();
    const dependencies = createDependencies();
    dependencies.submitNativeDelivery.mockResolvedValue({
      deliveryId: "delivery_lark_1",
      dispatchId: "dispatch_lark_1",
      failureCode: "remote_agent.worker_unavailable",
      idempotencyKey: "idempotency_lark_1",
      providerPublicationIdempotencyKey: "21f74ea8-904c-56a2-b09f-575ed7ee3d9c",
      shouldAck: true,
      status: "failed",
      text: "Center Agent could not start this request. Please try again.",
    });
    dependencies.settleAdmissionFailure.mockResolvedValue({
      reasonCode: "lark.rate_limited",
      status: "retryable",
    });

    await expect(
      processRemoteAgentMessageChannelEvent(
        {
          db: {} as D1Database,
          env: {} as CoreBindings,
          envelope,
          identityDb: {} as D1Database,
          queueAttempts: 1,
          queueMessageId: "queue_message_1",
          registry: createMessageChannelProviderRegistry([adapter]),
        },
        dependencies
      )
    ).rejects.toBeInstanceOf(RemoteAgentMessageChannelEventRetryableError);
    expect(dependencies.releaseIngress).toHaveBeenCalledWith(
      expect.objectContaining({
        failureReasonCode: "lark.rate_limited",
      })
    );
    expect(dependencies.completeIngress).not.toHaveBeenCalled();
  });
});

function createDependencies() {
  return {
    claimIngress: vi.fn<
      RemoteAgentMessageChannelEventServiceDependencies["claimIngress"]
    >(() =>
      Promise.resolve({
        record: {
          eventKey:
            "message-channel-event-v1:lark:connection_lark_1:event_lark_1",
          state: "processing" as const,
        },
        status: "claimed" as const,
      })
    ),
    completeIngress: vi.fn(() => Promise.resolve(true)),
    failIngress: vi.fn(() => Promise.resolve(true)),
    prepareInputAttachments: vi.fn<
      RemoteAgentMessageChannelEventServiceDependencies["prepareInputAttachments"]
    >(() => Promise.resolve({ attachments: [], status: "ready" as const })),
    releaseIngress: vi.fn(() => Promise.resolve(true)),
    resolveTurnTarget: vi.fn<
      RemoteAgentMessageChannelEventServiceDependencies["resolveTurnTarget"]
    >(() =>
      Promise.resolve({
        status: "resolved" as const,
        target: {
          centerAgent: {
            agentProfileId: "agt_11111111-1111-4111-8111-111111111111",
            bindingId: "binding_lark_1",
            modelRoute: TEST_CENTER_AGENT_MODEL_ROUTE,
            ownerUserId: "user_center_agent",
            profileHandle: "center-agent",
            profileName: "Center Agent",
          },
          connection: createLarkConnection(),
          participant: {
            kind: "member",
            member: {
              humanProfileId: "22222222-2222-4222-8222-222222222222",
              memberCount: 3,
              memberId: "member_1",
              organizationId: "org_1",
              organizationName: "OpenMeld Labs",
              organizationPersonal: false,
              organizationSlug: "openmeld-labs",
              role: "owner",
              userDisplayName: "Ari",
              userEmail: "ari@example.test",
              userId: "user_1",
            },
          },
        },
      })
    ),
    settleAdmissionFailure: vi.fn<
      RemoteAgentMessageChannelEventServiceDependencies["settleAdmissionFailure"]
    >(() =>
      Promise.resolve({
        resultId: "om_failure_1",
        status: "published",
      })
    ),
    submitNativeDelivery: vi.fn<
      RemoteAgentMessageChannelEventServiceDependencies["submitNativeDelivery"]
    >(async (input) => {
      Object.assign(input.request, await input.prepareInput?.());
      return {
        deliveryId: "delivery_lark_1",
        dispatchId: "dispatch_lark_1",
        idempotencyKey: "idempotency_lark_1",
        providerPublicationIdempotencyKey:
          "21f74ea8-904c-56a2-b09f-575ed7ee3d9c",
        shouldAck: true,
        status: "submitted",
      };
    }),
    upsertContextCursor: vi.fn(() => Promise.resolve({})),
  } satisfies RemoteAgentMessageChannelEventServiceDependencies;
}

function createProviderAdapter(input?: {
  readChannelContext?: MessageChannelProviderAdapter["readChannelContext"];
}): MessageChannelProviderAdapter {
  return {
    createWorkingCard: vi.fn(),
    publishFile: vi.fn(),
    downloadResource: vi.fn(),
    finalizeWorkingCard: vi.fn(),
    provider: "lark",
    publishIdentityLinkGuidance: vi.fn(),
    publishPrivateNavigationGuidance: vi.fn(),
    publishFailure: vi.fn(),
    publishReply: vi.fn(),
    publishWorkingCard: vi.fn(),
    readChannelContext:
      input?.readChannelContext ??
      vi.fn(
        ({ conversationId, event }): Promise<ChannelContext> =>
          Promise.resolve({
            provider: "lark",
            conversationId,
            currentMessageId:
              event.kind === "message" ? event.messageId : "event",
            messages: [],
            sync: { mode: "snapshot", status: "complete" },
          })
      ),
    updateWorkingCard: vi.fn(),
  };
}

function createLarkConnection() {
  return {
    appId: "cli_lark_1",
    botName: "Center Agent",
    botOpenId: "ou_bot_1",
    callbacksWebhookVerifiedAtMs: 2000,
    connectionGeneration: 3,
    connectionId: "connection_lark_1",
    createdAtMs: 1000,
    eventsWebhookVerifiedAtMs: 2000,
    failureReasonCode: null,
    grantedCapabilityGroups: ["channel.base"],
    installedByUserId: "user_owner",
    lastVerifiedAtMs: 2000,
    organizationId: "org_1",
    permissionBundleVersion: "channel-preset-v1",
    provider: "lark" as const,
    status: "connected" as const,
    tenantKey: "tenant_lark_1",
    transport: "webhook" as const,
    updatedAtMs: 2000,
  };
}

function createEnvelope(
  input: { mention?: "direct_message" | "group_mention" | "group_message" } = {}
): MessageChannelIngressEnvelope {
  return {
    connectionId: "connection_lark_1",
    event: {
      kind: "message",
      locator: {
        appId: "cli_lark_1",
        chatId: "oc_chat_1",
        connectionId: "connection_lark_1",
        provider: "lark",
        rootMessageId: "om_root_1",
        tenantKey: "tenant_lark_1",
        threadId: null,
      },
      mention: input.mention ?? "group_mention",
      messageId: "om_message_1",
      resources: [],
      senderId: "ou_member_1",
      sentAtMs: 3000,
      text: "Prepare the launch brief.",
    },
    gatewayRequestId: "gateway_request_1",
    kind: "remote_agent_message_channel_event",
    provider: "lark",
    providerEventId: "event_lark_1",
    receivedAtMs: 3100,
    v: 1,
  };
}

function createCardActionEnvelope(): MessageChannelIngressEnvelope & {
  event: Extract<
    MessageChannelIngressEnvelope["event"],
    { kind: "card_action" }
  >;
} {
  return {
    connectionId: "connection_lark_1",
    event: {
      actionId: "card_action_1",
      actionName: "openmeld.center_agent.submit",
      actionValue: "Continue with the launch plan.",
      kind: "card_action",
      locator: {
        appId: "cli_lark_1",
        chatId: "oc_chat_1",
        connectionId: "connection_lark_1",
        provider: "lark",
        rootMessageId: "om_card_1",
        tenantKey: "tenant_lark_1",
        threadId: null,
      },
      occurredAtMs: 3000,
      senderId: "ou_member_1",
    },
    gatewayRequestId: "gateway_card_action_1",
    kind: "remote_agent_message_channel_event",
    provider: "lark",
    providerEventId: "event_card_action_1",
    receivedAtMs: 3100,
    v: 1,
  };
}

function createChannelContext(
  envelope: MessageChannelIngressEnvelope
): ChannelContext {
  if (envelope.event.kind !== "message") {
    throw new Error("Expected a message event");
  }
  return {
    provider: "lark",
    conversationId: buildMessageChannelConversationId(envelope.event.locator),
    currentMessageId: envelope.event.messageId,
    messages: [],
    sync: { mode: "snapshot", status: "complete" },
  };
}
