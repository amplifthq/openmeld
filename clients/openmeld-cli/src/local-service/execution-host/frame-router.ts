import type {
  InflightTaskControlRegistry,
  LocalDaemonAdapterContainer,
  LocalExecutionSlots,
  PendingAgentInteractionRegistry,
} from "@openmeld/local-service";
import {
  agentInteractionResolutionSchema,
  localAgentReasoningPreferencesSchema,
  RUNTIME_TRANSPORT_SCHEMA_VERSION,
  runtimeTransportDispatchInteractionDeliveredRequestSchema,
  runtimeTransportDispatchInteractionResponseFramePayloadSchema,
  runtimeTransportLocalAgentControlCancelFramePayloadSchema,
  runtimeTransportLocalAgentControlInterruptFramePayloadSchema,
} from "@openmeld/schemas";
import type { AgentInteractionResponse } from "@openmeld/schemas/types";
import type { Presenter } from "../../runtime/presenter/types";
import { sendDaemonFrame } from "../carrier/daemon-frame-transport";
import {
  handleLocalControlPlaneCancel,
  handleLocalControlPlaneInterrupt,
} from "../carrier/local-control-handlers";
import { emitRunLine, toErrorMessage } from "../core/logger";
import type {
  CurrentDaemonSocketRef,
  DaemonFrameSink,
  DaemonProfileRouteConfig,
  InflightDispatchMeta,
  LedgerPaths,
  ParsedDaemonFrame,
} from "../core/types";
import {
  acknowledgeDispatchResultOutboxRecord,
  flushDispatchResultOutbox,
} from "../dispatch/dispatch-result-outbox";
import { enqueueDispatchDeliverFrame } from "../dispatch/execute-dispatch-task";
import { syncActiveTaskPermissionModes } from "../routing/active-permission-mode-sync";

type InteractionResponseInput = {
  routeByProfileId: Map<string, DaemonProfileRouteConfig>;
  readRouteByProfileId?: () => Map<string, DaemonProfileRouteConfig>;
  inflightTaskControlRegistry: InflightTaskControlRegistry;
  localAdapterContainer: LocalDaemonAdapterContainer;
  currentSocketRef: CurrentDaemonSocketRef;
  daemonSessionId: string;
  leasesByProfileId: Map<string, number>;
  payload: Record<string, unknown>;
  pendingAgentInteractionRegistry: PendingAgentInteractionRegistry;
  presenter: Presenter;
  socket: DaemonFrameSink;
};

async function applySavedPermissionModeBeforeResponse(
  input: InteractionResponseInput,
  pendingInteraction: NonNullable<
    ReturnType<PendingAgentInteractionRegistry["get"]>
  >,
  requestedUpdate: NonNullable<
    Extract<
      AgentInteractionResponse,
      { kind: "permission" }
    >["permissionModeUpdate"]
  >
): Promise<void> {
  const deadline = Date.now() + 10_000;
  while (Date.now() < deadline) {
    if (
      input.pendingAgentInteractionRegistry.get(
        pendingInteraction.request.interactionId
      ) !== pendingInteraction ||
      pendingInteraction.response !== null
    ) {
      return;
    }
    const route = (
      input.readRouteByProfileId?.() ?? input.routeByProfileId
    ).get(pendingInteraction.authority.targetProfileId);
    if (
      route?.bindingId === requestedUpdate.bindingId &&
      route.agentControllerPermissionMode === requestedUpdate.mode
    ) {
      const outcomes = await syncActiveTaskPermissionModes({
        catalogState: {
          get routeByProfileId() {
            return input.readRouteByProfileId?.() ?? input.routeByProfileId;
          },
        },
        inflightTaskControlRegistry: input.inflightTaskControlRegistry,
        localAdapterContainer: input.localAdapterContainer,
        taskId: pendingInteraction.taskId,
      });
      for (const outcome of outcomes) {
        emitRunLine({
          presenter: input.presenter,
          code: "daemon.run.active_permission_mode_sync",
          text: `active permission update ${outcome.status} for ${outcome.taskId}`,
          payload: outcome,
        });
      }
      return;
    }
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  emitRunLine({
    presenter: input.presenter,
    code: "daemon.run.permission_mode_sync_pending",
    text: "The saved permission mode has not reached this execution. Only the selected approval will be applied.",
    payload: { taskId: pendingInteraction.taskId },
  });
}

async function handleDispatchInteractionResponse(
  input: InteractionResponseInput
): Promise<void> {
  const parsedResponse =
    runtimeTransportDispatchInteractionResponseFramePayloadSchema.safeParse(
      input.payload
    );
  if (!parsedResponse.success) {
    emitRunLine({
      presenter: input.presenter,
      code: "daemon.run.interaction_response_invalid",
      text: "local agent interaction response was rejected because the payload is invalid",
    });
    return;
  }
  const pendingInteraction = input.pendingAgentInteractionRegistry.get(
    parsedResponse.data.interactionId
  );
  if (!pendingInteraction) {
    emitRunLine({
      presenter: input.presenter,
      code: "daemon.run.interaction_response_not_found",
      text: `local agent interaction ${parsedResponse.data.interactionId} is no longer pending`,
      payload: {
        interactionId: parsedResponse.data.interactionId,
        runtimeCoordinatorExecutionId:
          parsedResponse.data.runtimeCoordinatorExecutionId,
      },
    });
    return;
  }
  const authority = pendingInteraction.authority;
  if (
    authority.attemptId !== parsedResponse.data.attemptId ||
    authority.dispatchId !== parsedResponse.data.dispatchId ||
    authority.runtimeCoordinatorExecutionId !==
      parsedResponse.data.runtimeCoordinatorExecutionId
  ) {
    emitRunLine({
      presenter: input.presenter,
      code: "daemon.run.interaction_response_authority_mismatch",
      text: `local agent interaction ${parsedResponse.data.interactionId} did not match the active execution`,
      payload: {
        interactionId: parsedResponse.data.interactionId,
        runtimeCoordinatorExecutionId:
          parsedResponse.data.runtimeCoordinatorExecutionId,
      },
    });
    return;
  }
  const requestedUpdate =
    parsedResponse.data.response.kind === "permission"
      ? parsedResponse.data.response.permissionModeUpdate
      : undefined;
  if (requestedUpdate && pendingInteraction.response === null) {
    // The response references a saved Binding. Only the canonical route catalog
    // can authorize the update; a response cannot supply a new native policy.
    if (
      !agentInteractionResolutionSchema.safeParse({
        request: pendingInteraction.request,
        response: parsedResponse.data.response,
      }).success
    ) {
      emitRunLine({
        presenter: input.presenter,
        code: "daemon.run.interaction_response_invalid",
        text: "The permission response does not match the pending request.",
        payload: { interactionId: parsedResponse.data.interactionId },
      });
      return;
    }
    await applySavedPermissionModeBeforeResponse(
      input,
      pendingInteraction,
      requestedUpdate
    );
  }
  const resolution = input.pendingAgentInteractionRegistry.resolve({
    interactionId: parsedResponse.data.interactionId,
    response: parsedResponse.data.response,
  });
  if (!resolution || resolution.status === "response_invalid") {
    emitRunLine({
      presenter: input.presenter,
      code: "daemon.run.interaction_response_invalid",
      text: `local agent interaction ${parsedResponse.data.interactionId} received an invalid answer`,
      payload: {
        interactionId: parsedResponse.data.interactionId,
        runtimeCoordinatorExecutionId:
          parsedResponse.data.runtimeCoordinatorExecutionId,
      },
    });
    return;
  }
  // The interaction registry owns local resolution. A transport retry only
  // confirms delivery; it does not resume the agent again.
  if (resolution.status === "resolved") {
    emitRunLine({
      presenter: input.presenter,
      code: "daemon.run.interaction_resolved",
      text: `local agent resumed after user input for interaction ${parsedResponse.data.interactionId}`,
      payload: {
        interactionId: parsedResponse.data.interactionId,
        resolutionStatus: resolution.status,
        runtimeCoordinatorExecutionId:
          parsedResponse.data.runtimeCoordinatorExecutionId,
      },
    });
  }
  const connectionGeneration = input.currentSocketRef.connectionGeneration;
  const leaseEpoch = input.leasesByProfileId.get(authority.targetProfileId);
  if (!(connectionGeneration && leaseEpoch)) {
    emitRunLine({
      presenter: input.presenter,
      code: "daemon.run.interaction_delivery_deferred",
      text: `delivery acknowledgement for local agent interaction ${parsedResponse.data.interactionId} is waiting for the active lease`,
      payload: {
        interactionId: parsedResponse.data.interactionId,
        runtimeCoordinatorExecutionId:
          parsedResponse.data.runtimeCoordinatorExecutionId,
      },
    });
    return;
  }
  const deliveredRequest =
    runtimeTransportDispatchInteractionDeliveredRequestSchema.parse({
      v: RUNTIME_TRANSPORT_SCHEMA_VERSION,
      runtimeCoordinatorExecutionId:
        parsedResponse.data.runtimeCoordinatorExecutionId,
      executionTokenEcho: authority.executionTokenEcho,
      dispatchId: parsedResponse.data.dispatchId,
      attemptId: parsedResponse.data.attemptId,
      executionIdentityEcho: authority.executionIdentityEcho,
      daemonSessionId: input.daemonSessionId,
      connectionGeneration,
      leaseEpoch,
      interactionId: parsedResponse.data.interactionId,
      deliveredAtMs: Date.now(),
    });
  sendDaemonFrame(input.socket, {
    code: "daemon.dispatch.interaction_delivered",
    payload: deliveredRequest,
  });
}

function applyReasoningPreference(
  ref: CurrentDaemonSocketRef,
  payload: unknown
): void {
  const preference = localAgentReasoningPreferencesSchema.safeParse(payload);
  if (
    !preference.success ||
    ref.reasoningStreamEnabled === preference.data.enabled
  ) {
    return;
  }
  ref.reasoningStreamEnabled = preference.data.enabled;
  for (const listener of ref.reasoningPreferenceListeners ?? []) {
    listener();
  }
}

export function handleExecutionHostFrame(input: {
  readRouteByProfileId?: () => Map<string, DaemonProfileRouteConfig>;
  computerFileAccessStorePath: string;
  contextStore: Map<string, string>;
  currentSocketRef: CurrentDaemonSocketRef;
  daemonSessionId: string;
  localExecutionSlots: LocalExecutionSlots;
  inflightDispatchMetaByTaskId: Map<string, InflightDispatchMeta>;
  inflightTaskControlRegistry: InflightTaskControlRegistry;
  pendingAgentInteractionRegistry: PendingAgentInteractionRegistry;
  ledgerPaths: LedgerPaths;
  leasesByProfileId: Map<string, number>;
  localAdapterContainer: LocalDaemonAdapterContainer;
  parsedFrame: ParsedDaemonFrame;
  profileOwnerName: string | null;
  profileOwnerUserId: string;
  requestCurrentWorkingFolderFactRefresh?: () => void;
  presenter: Presenter;
  routeByProfileId: Map<string, DaemonProfileRouteConfig>;
  socket: DaemonFrameSink;
}): void {
  switch (input.parsedFrame.code) {
    case "daemon.reasoning.preferences": {
      applyReasoningPreference(
        input.currentSocketRef,
        input.parsedFrame.payload
      );
      return;
    }
    case "daemon.dispatch.deliver":
      emitRunLine({
        presenter: input.presenter,
        code: "daemon.run.dispatch_deliver_received",
        text: `deliver frame received for dispatch ${String(input.parsedFrame.payload.dispatchId ?? "unknown")}`,
        payload: {
          attemptId: input.parsedFrame.payload.attemptId ?? null,
          connectionGeneration: input.parsedFrame.payload.connectionGeneration,
          deliveryRecoveryReason:
            input.parsedFrame.payload.deliveryRecoveryReason ?? null,
          dispatchId: input.parsedFrame.payload.dispatchId ?? null,
          leaseEpoch: input.parsedFrame.payload.leaseEpoch ?? null,
          profileId: input.parsedFrame.payload.profileId ?? null,
          taskId: input.parsedFrame.payload.taskId ?? null,
        },
      });
      enqueueDispatchDeliverFrame({
        computerFileAccessStorePath: input.computerFileAccessStorePath,
        contextStore: input.contextStore,
        currentSocketRef: input.currentSocketRef,
        daemonSessionId: input.daemonSessionId,
        localExecutionSlots: input.localExecutionSlots,
        inflightDispatchMetaByTaskId: input.inflightDispatchMetaByTaskId,
        inflightTaskControlRegistry: input.inflightTaskControlRegistry,
        pendingAgentInteractionRegistry: input.pendingAgentInteractionRegistry,
        ledgerPaths: input.ledgerPaths,
        leasesByProfileId: input.leasesByProfileId,
        localAdapterContainer: input.localAdapterContainer,
        payload: input.parsedFrame.payload,
        profileOwnerName: input.profileOwnerName,
        profileOwnerUserId: input.profileOwnerUserId,
        requestCurrentWorkingFolderFactRefresh:
          input.requestCurrentWorkingFolderFactRefresh,
        presenter: input.presenter,
        routeByProfileId: input.routeByProfileId,
        socket: input.socket,
      });
      return;
    case "daemon.dispatch.accepted":
      acknowledgeDispatchResultOutboxRecord({
        attemptId: normalizeOptionalFrameValue(
          input.parsedFrame.payload.attemptId
        ),
        dispatchId:
          normalizeOptionalFrameValue(input.parsedFrame.payload.dispatchId) ??
          "unknown",
        ledgerPaths: input.ledgerPaths,
        ok: input.parsedFrame.payload.ok === true,
        presenter: input.presenter,
        reasonCode: normalizeOptionalFrameValue(
          input.parsedFrame.payload.reasonCode
        ),
        status: normalizeResultAckStatus(input.parsedFrame.payload.status),
      });
      flushDispatchResultOutbox({
        currentSocketRef: input.currentSocketRef,
        ledgerPaths: input.ledgerPaths,
        presenter: input.presenter,
      });
      emitRunLine({
        presenter: input.presenter,
        code: "daemon.run.result_acknowledged",
        text: `daemon result acknowledged for dispatch ${String(input.parsedFrame.payload.dispatchId ?? "unknown")}`,
        payload: {
          attemptId: input.parsedFrame.payload.attemptId ?? null,
          dispatchId: input.parsedFrame.payload.dispatchId ?? null,
          ok: input.parsedFrame.payload.ok ?? null,
          reasonCode: input.parsedFrame.payload.reasonCode ?? null,
          status: input.parsedFrame.payload.status ?? null,
        },
      });
      return;
    case "daemon.dispatch.interaction_response":
      handleDispatchInteractionResponse({
        readRouteByProfileId: input.readRouteByProfileId,
        routeByProfileId: input.routeByProfileId,
        inflightTaskControlRegistry: input.inflightTaskControlRegistry,
        localAdapterContainer: input.localAdapterContainer,
        currentSocketRef: input.currentSocketRef,
        daemonSessionId: input.daemonSessionId,
        leasesByProfileId: input.leasesByProfileId,
        payload: input.parsedFrame.payload,
        pendingAgentInteractionRegistry: input.pendingAgentInteractionRegistry,
        presenter: input.presenter,
        socket: input.socket,
      }).catch((error) =>
        emitRunLine({
          presenter: input.presenter,
          code: "daemon.run.interaction_response_failed",
          text: "The permission response is still pending after a local update failed.",
          payload: { error: toErrorMessage(error) },
        })
      );
      return;
    case "daemon.local_agent_control.cancel": {
      const parsedCancelFrame =
        runtimeTransportLocalAgentControlCancelFramePayloadSchema.safeParse(
          input.parsedFrame.payload
        );
      if (!parsedCancelFrame.success) {
        emitRunLine({
          presenter: input.presenter,
          code: "daemon.run.control_cancel_frame_invalid",
          text: "local cancel frame rejected because the payload is invalid",
        });
        return;
      }
      handleLocalControlPlaneCancel({
        localAdapterContainer: input.localAdapterContainer,
        payload: parsedCancelFrame.data.payload,
        presenter: input.presenter,
        registry: input.inflightTaskControlRegistry,
      })
        .then((payload) => {
          sendDaemonFrame(input.socket, {
            code: "daemon.local_agent_control.result",
            payload: {
              requestId: parsedCancelFrame.data.requestId,
              payload,
            },
          });
        })
        .catch((error) => {
          emitRunLine({
            presenter: input.presenter,
            code: "daemon.run.control_cancel_failed",
            text: `local cancel handling failed: ${toErrorMessage(error)}`,
            payload: {
              requestId: parsedCancelFrame.data.requestId,
              target: parsedCancelFrame.data.payload.target,
            },
          });
          sendDaemonFrame(input.socket, {
            code: "daemon.local_agent_control.result",
            payload: {
              requestId: parsedCancelFrame.data.requestId,
              payload: {
                accepted: false,
                note: toErrorMessage(error),
                reasonCode: "local_control.unhandled_error",
                target: parsedCancelFrame.data.payload.target,
              },
            },
          });
        });
      return;
    }
    case "daemon.local_agent_control.interrupt": {
      const parsedInterruptFrame =
        runtimeTransportLocalAgentControlInterruptFramePayloadSchema.safeParse(
          input.parsedFrame.payload
        );
      if (!parsedInterruptFrame.success) {
        emitRunLine({
          presenter: input.presenter,
          code: "daemon.run.control_interrupt_frame_invalid",
          text: "local interrupt frame rejected because the payload is invalid",
        });
        return;
      }
      handleLocalControlPlaneInterrupt({
        localAdapterContainer: input.localAdapterContainer,
        payload: parsedInterruptFrame.data.payload,
        presenter: input.presenter,
        registry: input.inflightTaskControlRegistry,
      })
        .then((payload) => {
          sendDaemonFrame(input.socket, {
            code: "daemon.local_agent_control.result",
            payload: {
              requestId: parsedInterruptFrame.data.requestId,
              payload,
            },
          });
        })
        .catch((error) => {
          emitRunLine({
            presenter: input.presenter,
            code: "daemon.run.control_interrupt_failed",
            text: `local interrupt handling failed: ${toErrorMessage(error)}`,
            payload: {
              requestId: parsedInterruptFrame.data.requestId,
              target: parsedInterruptFrame.data.payload.target,
            },
          });
          sendDaemonFrame(input.socket, {
            code: "daemon.local_agent_control.result",
            payload: {
              requestId: parsedInterruptFrame.data.requestId,
              payload: {
                accepted: false,
                note: toErrorMessage(error),
                reasonCode: "local_control.unhandled_error",
                target: parsedInterruptFrame.data.payload.target,
              },
            },
          });
        });
      return;
    }
    default:
      return;
  }
}

function normalizeOptionalFrameValue(value: unknown): string | null {
  const normalized = String(value ?? "").trim();
  return normalized.length > 0 ? normalized : null;
}

function normalizeResultAckStatus(
  value: unknown
): "accepted" | "rejected_terminal" | "review_required" | "retry_later" | null {
  return value === "accepted" ||
    value === "rejected_terminal" ||
    value === "review_required" ||
    value === "retry_later"
    ? value
    : null;
}
