import type {
  InflightTaskControlRegistry,
  LocalDaemonAdapterContainer,
  LocalExecutionSlots,
  PendingAgentInteractionRegistry,
} from "@openmeld/local-service";
import {
  daemonStreamFrameSchema,
  RUNTIME_TRANSPORT_SCHEMA_VERSION,
  runtimeTransportDispatchInteractionDeliveredRequestSchema,
  runtimeTransportDispatchInteractionResponseFramePayloadSchema,
  runtimeTransportHeartbeatResponseSchema,
  runtimeTransportLocalAgentControlCancelFramePayloadSchema,
  runtimeTransportLocalAgentControlInterruptFramePayloadSchema,
  runtimeTransportRegisterSessionResponseSchema,
} from "@openmeld/schemas";
import type {
  RuntimeTransportHeartbeatRequest,
  RuntimeTransportRegisterSessionRequest,
} from "@openmeld/schemas/types";
import { formatOpenMeldCliTextBlock } from "../../runtime/cli-entry-command";
import type { Presenter } from "../../runtime/presenter/types";
import type { WsClient } from "../../transport/ws";
import {
  asRecord,
  emitRunLine,
  normalizeText,
  toErrorMessage,
} from "../core/logger";
import type {
  CurrentDaemonSocketRef,
  DaemonProfileRouteConfig,
  InflightDispatchMeta,
  LedgerPaths,
  ParsedDaemonFrame,
  PendingFrameWaiters,
} from "../core/types";
import {
  acknowledgeDispatchResultOutboxRecord,
  flushDispatchResultOutbox,
} from "../dispatch/dispatch-result-outbox";
import { enqueueDispatchDeliverFrame } from "../dispatch/execute-dispatch-task";
import {
  handleLocalControlPlaneCancel,
  handleLocalControlPlaneInterrupt,
} from "./local-control-handlers";

export function parseDaemonFrame(raw: string): ParsedDaemonFrame | null {
  let parsedJson: unknown;
  try {
    parsedJson = JSON.parse(raw);
  } catch {
    return null;
  }
  const parsedFrame = daemonStreamFrameSchema.safeParse(parsedJson);
  if (!parsedFrame.success) {
    return null;
  }
  return parsedFrame.data;
}

export function resolveRegisterResponseFrame(input: {
  payload: Record<string, unknown>;
  presenter: Presenter;
  waiters: PendingFrameWaiters;
}): void {
  if (!input.waiters.registerResolver) {
    return;
  }
  const registerPayload =
    runtimeTransportRegisterSessionResponseSchema.safeParse(input.payload);
  if (!registerPayload.success) {
    return;
  }
  const resolver = input.waiters.registerResolver;
  input.waiters.registerResolver = null;
  input.waiters.registerRejecter = null;
  emitRunLine({
    presenter: input.presenter,
    code: "daemon.run.register_response_received",
    text: `register accepted; connection generation=${String(registerPayload.data.connectionGeneration)}`,
    payload: {
      acceptedLeaseCount: registerPayload.data.acceptedLeases.length,
      connectionGeneration: registerPayload.data.connectionGeneration,
      ok: registerPayload.data.ok,
      rejectedProfileCount: registerPayload.data.rejectedProfiles.length,
    },
  });
  resolver(registerPayload.data);
}

export function resolveHeartbeatResponseFrame(input: {
  payload: Record<string, unknown>;
  presenter: Presenter;
  waiters: PendingFrameWaiters;
}): void {
  if (!input.waiters.heartbeatResolver) {
    return;
  }
  const heartbeatPayload = runtimeTransportHeartbeatResponseSchema.safeParse(
    input.payload
  );
  if (!heartbeatPayload.success) {
    return;
  }
  const resolver = input.waiters.heartbeatResolver;
  input.waiters.heartbeatResolver = null;
  input.waiters.heartbeatRejecter = null;
  emitRunLine({
    presenter: input.presenter,
    code: "daemon.run.heartbeat_response_received",
    text: `heartbeat response received; stale leases=${String(heartbeatPayload.data.staleLeases.length)}`,
    payload: {
      ok: heartbeatPayload.data.ok,
      staleLeaseCount: heartbeatPayload.data.staleLeases.length,
    },
  });
  resolver(heartbeatPayload.data);
}

export function emitDaemonErrorFrame(input: {
  payload: Record<string, unknown>;
  presenter: Presenter;
  waiters?: PendingFrameWaiters;
}): void {
  const errorPayload = asRecord(input.payload) ?? {};
  const errorCode = normalizeText(errorPayload.code);
  const errorMessage = normalizeText(errorPayload.message);
  const isRegisterContractMismatch =
    errorCode === "schema.invalid" &&
    errorMessage.toLowerCase().includes("invalid register payload");
  const isHeartbeatContractMismatch =
    errorCode === "schema.invalid" &&
    errorMessage.toLowerCase().includes("invalid heartbeat payload");

  if (isRegisterContractMismatch) {
    emitRunLine({
      presenter: input.presenter,
      code: "daemon.run.register_contract_mismatch",
      text: formatOpenMeldCliTextBlock(
        "OpenMeld service is out of sync with this CLI version.\n" +
          "Please restart the service:\n" +
          "1) `openmeld service stop --force`\n" +
          "2) `openmeld service start`"
      ),
      payload: {
        code: errorCode,
        message: errorMessage,
      },
    });
    rejectRegisterFrameWaiter({
      errorCode,
      errorMessage,
      waiters: input.waiters ?? null,
    });
    return;
  }

  if (isHeartbeatContractMismatch) {
    emitRunLine({
      presenter: input.presenter,
      code: "daemon.run.heartbeat_contract_mismatch",
      text: `heartbeat rejected: ${errorCode || "daemon.error"} ${errorMessage}`.trim(),
      payload: {
        code: errorCode,
        message: errorMessage,
      },
    });
    rejectHeartbeatFrameWaiter({
      errorCode,
      errorMessage,
      waiters: input.waiters ?? null,
    });
    return;
  }

  emitRunLine({
    presenter: input.presenter,
    code: "daemon.run.daemon_error",
    text: `daemon error frame: ${errorCode || "unknown"} ${errorMessage || ""}`.trim(),
  });
}

function rejectHeartbeatFrameWaiter(input: {
  errorCode: string;
  errorMessage: string;
  waiters: PendingFrameWaiters | null;
}): void {
  if (!input.waiters?.heartbeatRejecter) {
    return;
  }
  const rejecter = input.waiters.heartbeatRejecter;
  input.waiters.heartbeatRejecter = null;
  input.waiters.heartbeatResolver = null;
  rejecter(buildDaemonFrameError(input));
}

function rejectRegisterFrameWaiter(input: {
  errorCode: string;
  errorMessage: string;
  waiters: PendingFrameWaiters | null;
}): void {
  if (!input.waiters) {
    return;
  }
  if (input.waiters.registerRejecter) {
    const rejecter = input.waiters.registerRejecter;
    input.waiters.registerRejecter = null;
    input.waiters.registerResolver = null;
    rejecter(buildDaemonFrameError(input));
  }
}

function buildDaemonFrameError(input: {
  errorCode: string;
  errorMessage: string;
}): Error {
  const message = [input.errorCode || "daemon.error", input.errorMessage]
    .filter((value) => value.length > 0)
    .join(": ");
  return new Error(message || "daemon.error");
}

function handleDispatchInteractionResponse(input: {
  currentSocketRef: CurrentDaemonSocketRef;
  daemonSessionId: string;
  leasesByProfileId: Map<string, number>;
  payload: Record<string, unknown>;
  pendingAgentInteractionRegistry: PendingAgentInteractionRegistry;
  presenter: Presenter;
  socket: WsClient;
}): void {
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
  const connectionGeneration = input.currentSocketRef.connectionGeneration;
  const leaseEpoch = input.leasesByProfileId.get(authority.targetProfileId);
  if (!(connectionGeneration && leaseEpoch)) {
    emitRunLine({
      presenter: input.presenter,
      code: "daemon.run.interaction_delivery_deferred",
      text: `local agent interaction ${parsedResponse.data.interactionId} resumed locally; delivery acknowledgement is waiting for the active lease`,
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

export function handleDaemonSocketFrame(input: {
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
  presenter: Presenter;
  routeByProfileId: Map<string, DaemonProfileRouteConfig>;
  socket: WsClient;
  waiters: PendingFrameWaiters;
}): void {
  switch (input.parsedFrame.code) {
    case "daemon.session.register":
      resolveRegisterResponseFrame({
        payload: input.parsedFrame.payload,
        presenter: input.presenter,
        waiters: input.waiters,
      });
      return;
    case "daemon.session.heartbeat":
      resolveHeartbeatResponseFrame({
        payload: input.parsedFrame.payload,
        presenter: input.presenter,
        waiters: input.waiters,
      });
      return;
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
        currentSocketRef: input.currentSocketRef,
        daemonSessionId: input.daemonSessionId,
        leasesByProfileId: input.leasesByProfileId,
        payload: input.parsedFrame.payload,
        pendingAgentInteractionRegistry: input.pendingAgentInteractionRegistry,
        presenter: input.presenter,
        socket: input.socket,
      });
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
    case "daemon.error":
      emitDaemonErrorFrame({
        payload: input.parsedFrame.payload,
        presenter: input.presenter,
        waiters: input.waiters,
      });
      return;
    case "daemon.dispatch.result":
      return;
    default:
      return;
  }
}

export function sendDaemonFrame(
  inputSocket: WsClient,
  input: {
    code:
      | "daemon.dispatch.result"
      | "daemon.dispatch.interaction_delivered"
      | "daemon.dispatch.interaction_request"
      | "daemon.local_agent_control.result"
      | "daemon.execution_recovery.resume_controller_conversation_result"
      | "daemon.session.heartbeat"
      | "daemon.session.register";
    payload:
      | RuntimeTransportHeartbeatRequest
      | RuntimeTransportRegisterSessionRequest
      | Record<string, unknown>;
  }
): void {
  inputSocket.send(
    JSON.stringify({
      v: RUNTIME_TRANSPORT_SCHEMA_VERSION,
      code: input.code,
      payload: input.payload,
    })
  );
}

function normalizeOptionalFrameValue(value: unknown): string | null {
  const normalized = String(value ?? "").trim();
  return normalized.length > 0 ? normalized : null;
}

function normalizeResultAckStatus(
  value: unknown
): "accepted" | "rejected_terminal" | "retry_later" | null {
  return value === "accepted" ||
    value === "rejected_terminal" ||
    value === "retry_later"
    ? value
    : null;
}

export function emitDispatchQueueError(input: {
  error: unknown;
  presenter: Presenter;
}): void {
  emitRunLine({
    presenter: input.presenter,
    code: "daemon.run.dispatch_unhandled_error",
    text: `dispatch handling failed: ${toErrorMessage(input.error)}`,
  });
}
