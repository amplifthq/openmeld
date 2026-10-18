import { randomUUID } from "node:crypto";
import { performance } from "node:perf_hooks";
import {
  RUNTIME_TRANSPORT_SCHEMA_VERSION,
  runtimeTransportDispatchLifecycleAcknowledgementSchema,
  runtimeTransportDispatchLifecycleRequestSchema,
} from "@openmeld/schemas";
import type { RuntimeTransportDeliverDispatchRequest } from "@openmeld/schemas/types";
import type { CurrentDaemonSocketRef } from "../core/types";
import { ExecutionHostError } from "./channel";

type AdmissionRequest = Pick<
  RuntimeTransportDeliverDispatchRequest,
  "dispatchId" | "attemptId" | "daemonSessionId" | "leaseEpoch"
> & {
  payload: Pick<
    RuntimeTransportDeliverDispatchRequest["payload"],
    "executionToken" | "runtimeCoordinatorExecutionId"
  >;
};

// Response waiters only: the Coordinator remains the execution authority.
// Missing observations never authorize starting a provider.
export function createExecutionAdmissionConfirmation(
  socketRef: CurrentDaemonSocketRef
) {
  let closed = false;
  const pending = new Map<
    string,
    {
      request: AdmissionRequest;
      sentAt: number;
      resolve(): void;
      reject(error: Error): void;
    }
  >();
  const resend = () => {
    if (!socketRef.socket || socketRef.connectionGeneration === null) {
      return;
    }
    for (const [previousId, waiter] of [...pending]) {
      const acknowledgementId = randomUUID();
      pending.delete(previousId);
      pending.set(acknowledgementId, waiter);
      waiter.sentAt = performance.now();
      const request = waiter.request;
      const token = request.payload.executionToken;
      const payload = runtimeTransportDispatchLifecycleRequestSchema.parse({
        v: RUNTIME_TRANSPORT_SCHEMA_VERSION,
        acknowledgementId,
        dispatchId: request.dispatchId,
        attemptId: request.attemptId,
        daemonSessionId: request.daemonSessionId,
        connectionGeneration: socketRef.connectionGeneration,
        leaseEpoch: request.leaseEpoch,
        runtimeCoordinatorExecutionId:
          request.payload.runtimeCoordinatorExecutionId,
        executionTokenEcho: token
          ? {
              executionToken: token.executionToken,
              runId: token.runId,
              tokenFingerprint: token.tokenFingerprint,
              runtimeCoordinatorExecutionId:
                token.executionScope.runtimeCoordinatorExecutionId,
            }
          : undefined,
        phase: "accepted_local",
        lifecycleAtMs: Date.now(),
      });
      try {
        socketRef.socket.send(
          JSON.stringify({
            v: RUNTIME_TRANSPORT_SCHEMA_VERSION,
            code: "daemon.dispatch.lifecycle",
            payload,
          })
        );
      } catch {
        // Delivery is unconfirmed. Reconnection retries this read/confirmation,
        // never the provider execution, and a send failure cannot grant access.
      }
    }
  };
  return {
    confirm(request: AdmissionRequest): Promise<void> {
      if (closed) {
        return Promise.reject(connectorLostError());
      }
      return new Promise((resolve, reject) => {
        const id = randomUUID();
        pending.set(id, {
          request,
          resolve,
          reject,
          sentAt: performance.now(),
        });
        try {
          resend();
        } catch (error) {
          for (const [pendingId, waiter] of pending) {
            if (waiter.resolve === resolve) {
              pending.delete(pendingId);
            }
          }
          reject(error);
        }
      });
    },
    resend,
    close() {
      closed = true;
      for (const waiter of pending.values()) {
        waiter.reject(connectorLostError());
      }
      pending.clear();
    },
    receive(payload: unknown) {
      const parsed =
        runtimeTransportDispatchLifecycleAcknowledgementSchema.safeParse(
          payload
        );
      if (!parsed.success) {
        return;
      }
      const reply = parsed.data;
      const waiter = pending.get(reply.acknowledgementId);
      if (
        !waiter ||
        reply.connectionGeneration !== socketRef.connectionGeneration ||
        waiter.request.dispatchId !== reply.dispatchId ||
        waiter.request.attemptId !== reply.attemptId
      ) {
        return;
      }
      if (
        reply.accepted &&
        performance.now() - waiter.sentAt >= reply.validForMs
      ) {
        // A delayed positive reply is not fresh permission. Keep the same
        // execution waiting; heartbeat/reconnect retries only the confirmation.
        return;
      }
      pending.delete(reply.acknowledgementId);
      if (reply.accepted) {
        waiter.resolve();
      } else {
        waiter.reject(
          new ExecutionHostError(
            reply.reasonCode ?? "host.execution_not_authorized",
            "RuntimeCoordinator did not authorize this execution; the provider was not started."
          )
        );
      }
    },
  };
}

function connectorLostError(): ExecutionHostError {
  return new ExecutionHostError(
    "host.connector_lost",
    "The Service connector exited before execution admission could be confirmed; the provider was not started."
  );
}
