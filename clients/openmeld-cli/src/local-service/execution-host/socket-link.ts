import {
  localExecutionInputFrameSchema,
  localExecutionInputResponseSchema,
  RUNTIME_TRANSPORT_SCHEMA_VERSION,
  type ServiceExecutionHostOutput,
  serviceExecutionHostMethods,
} from "@openmeld/schemas";
import type {
  RuntimeTransportAdmissionEvidence,
  RuntimeTransportLease,
} from "@openmeld/schemas/types";
import { warnDaemonEvent } from "../core/logger";
import type { DaemonFrameSink, ParsedDaemonFrame } from "../core/types";
import type { RuntimeReportingAuthenticationFailure } from "../reporting/runtime-reporting-auth-recovery";
import { ExecutionHostError } from "./channel";
import type { ExecutionHostPort } from "./port";

const ADMISSION_DETAIL_CODE_PATTERN = /^[a-z][a-z0-9_.-]{0,79}$/u;

const admissionDetailCode = (error: unknown, fallback: string): string => {
  const code = error instanceof ExecutionHostError ? error.code : fallback;
  return ADMISSION_DETAIL_CODE_PATTERN.test(code) ? code : fallback;
};

// Connection-local forwarding and observation only. Accepted work, approval
// state and result receipts remain in the one process-lifetime Host.
export function createExecutionHostSocketLink(input: {
  host: ExecutionHostPort;
  socket: DaemonFrameSink;
  onAdmissionChanged(): void;
  onInvalidation(scope: "routes" | "activity" | "execution"): void;
  onAuthenticationFailure(failure: RuntimeReportingAuthenticationFailure): void;
  onError(error: unknown): void;
}) {
  let generation: number | null = null;
  let bound = false;
  let closed = false;
  let observed: ServiceExecutionHostOutput<"health"> | null = null;
  let observation: Promise<void> | null = null;
  let observationDirty = false;
  let configuration: Promise<void> = Promise.resolve();
  let queuedFrames = 0;
  let publishedAdmission = false;
  let admissionRevision = 0;
  let admissionEvidence: RuntimeTransportAdmissionEvidence | null = null;
  let configureFailureCode: string | null = null;
  let healthFailureCode: string | null = null;
  let connectionInitializingReason:
    | "connection_initializing"
    | "connection_replaced" = "connection_initializing";
  const canAccept = () =>
    !closed &&
    bound &&
    input.host.available() &&
    observed?.admission === "open" &&
    !observed.startupReplayPending;
  const currentAdmissionReason = (): {
    reasonCode: RuntimeTransportAdmissionEvidence["reasonCode"];
    detailCode?: string;
  } => {
    if (!bound) {
      return configureFailureCode
        ? {
            reasonCode: "host_configure_failed",
            detailCode: configureFailureCode,
          }
        : { reasonCode: connectionInitializingReason };
    }
    if (!input.host.available()) {
      return { reasonCode: "host_unavailable" };
    }
    if (!observed) {
      return healthFailureCode
        ? {
            reasonCode: "host_health_unconfirmed",
            detailCode: healthFailureCode,
          }
        : { reasonCode: "host_health_unconfirmed" };
    }
    if (observed.admission !== "open") {
      return { reasonCode: "host_draining" };
    }
    if (observed.startupReplayPending) {
      return { reasonCode: "startup_replay_pending" };
    }
    return { reasonCode: "host_ready" };
  };
  const notifyAdmission = (
    reasonCode?: RuntimeTransportAdmissionEvidence["reasonCode"]
  ) => {
    const next = canAccept();
    const reason: ReturnType<typeof currentAdmissionReason> = reasonCode
      ? { reasonCode }
      : currentAdmissionReason();
    if (
      next !== publishedAdmission ||
      (generation !== null &&
        (admissionEvidence?.reasonCode !== reason.reasonCode ||
          admissionEvidence?.detailCode !== reason.detailCode))
    ) {
      publishedAdmission = next;
      if (generation !== null) {
        admissionEvidence = {
          acceptingDispatches: next,
          connectionGeneration: generation,
          revision: ++admissionRevision,
          changedAtMs: Date.now(),
          ...reason,
        };
      }
      input.onAdmissionChanged();
    }
  };

  const refreshObservation = (): Promise<void> => {
    if (observation) {
      observationDirty = true;
      return observation;
    }
    if (!(observation || closed)) {
      observationDirty = false;
      observation = input.host
        .call("health", {})
        .then((next) => {
          observed = next;
          healthFailureCode = null;
        })
        .catch((error: unknown) => {
          observed = null;
          healthFailureCode = admissionDetailCode(error, "host.health_failed");
          input.onError(error);
        })
        .finally(() => {
          observation = null;
          if (!closed) {
            notifyAdmission();
            if (observationDirty) {
              refreshObservation();
            }
          }
        });
    }
    return observation ?? Promise.resolve();
  };

  const stopEvents = input.host.onEvent((event) => {
    if (closed) {
      return;
    }
    if (event.type === "frame") {
      if (event.connectionGeneration === generation) {
        input.socket.send(JSON.stringify(event.frame));
      }
    } else if (event.type === "authentication_failure") {
      if (
        event.connectionGeneration === null ||
        event.connectionGeneration === generation
      ) {
        input.onAuthenticationFailure(event.failure);
      } else {
        warnDaemonEvent("[openmeld.runtime_reporting.auth_recovery_ignored]", {
          event: "cli.runtime_reporting.auth_recovery_ignored",
          reason: "stale_socket",
          reasonCode: event.failure.reasonCode,
        });
      }
    } else if (event.type === "invalidate") {
      input.onInvalidation(event.scope);
      if (event.scope === "execution") {
        refreshObservation();
      }
    }
  });
  const stopAvailability = input.host.onAvailabilityChanged(() => {
    if (!input.host.available()) {
      observed = null;
    }
    notifyAdmission();
  });

  return {
    canAccept,
    admissionEvidence: () => admissionEvidence,
    snapshot: () => observed,
    async configure(request: {
      executionAdmissionConfirmation?: boolean;
      connectionGeneration: number;
      catalogRevision: number;
      leases: RuntimeTransportLease[];
    }): Promise<void> {
      const previous = configuration;
      // Catalog refreshes on the same socket do not replace execution
      // authority. Frames already wait for `configuration` below, so keep
      // admission open until the Host has applied the new catalog.
      const previousGeneration = generation;
      if (generation !== request.connectionGeneration) {
        bound = false;
        configureFailureCode = null;
        connectionInitializingReason =
          previousGeneration === null
            ? "connection_initializing"
            : "connection_replaced";
        admissionRevision = 0;
        admissionEvidence = {
          acceptingDispatches: false,
          connectionGeneration: request.connectionGeneration,
          revision: 0,
          changedAtMs: Date.now(),
          reasonCode: connectionInitializingReason,
        };
      }
      generation = request.connectionGeneration;
      notifyAdmission();
      const next = previous
        .catch(() => undefined)
        .then(async () => {
          if (closed || generation !== request.connectionGeneration) {
            throw new ExecutionHostError(
              "host.connection_replaced",
              "This socket was replaced before Host configuration."
            );
          }
          const nextObservation = await input.host.call(
            "configureConnection",
            request
          );
          if (!closed && generation === request.connectionGeneration) {
            observed = nextObservation;
            healthFailureCode = null;
            configureFailureCode = null;
            bound = true;
            notifyAdmission();
          }
        });
      configuration = next.catch((error: unknown) => {
        if (!closed && generation === request.connectionGeneration) {
          bound = false;
          observed = null;
          configureFailureCode = admissionDetailCode(
            error,
            "host.configure_failed"
          );
          notifyAdmission();
        }
        throw error;
      });
      await configuration;
    },
    forward(frame: ParsedDaemonFrame): boolean {
      if (frame.code === "daemon.execution_input.request") {
        const parsed = localExecutionInputFrameSchema.safeParse(frame.payload);
        if (!parsed.success) {
          return false;
        }
        const payload = parsed.data;
        if (
          closed ||
          generation !== payload.connectionGeneration ||
          queuedFrames >= 60
        ) {
          return true;
        }
        queuedFrames += 1;
        configuration
          .then(async () => {
            if (closed || generation !== payload.connectionGeneration) {
              return;
            }
            const { requestId, ...request } = payload;
            const result = localExecutionInputResponseSchema.parse(
              await input.host.call("executionInput", request)
            );
            if (!closed && generation === payload.connectionGeneration) {
              input.socket.send(
                JSON.stringify({
                  v: RUNTIME_TRANSPORT_SCHEMA_VERSION,
                  code: "daemon.execution_input.result",
                  payload: { requestId, result },
                })
              );
            }
          })
          .catch(input.onError)
          .finally(() => {
            queuedFrames -= 1;
          });
        return true;
      }
      const request = serviceExecutionHostMethods.handleFrame.input.safeParse({
        connectionGeneration: generation ?? 1,
        frame: { v: RUNTIME_TRANSPORT_SCHEMA_VERSION, ...frame },
      });
      if (!request.success) {
        return false;
      }
      if (closed || generation === null || queuedFrames >= 60) {
        input.onError(
          new ExecutionHostError(
            "host.busy",
            "Host forwarding is not available; the source retains delivery ownership."
          )
        );
        return true;
      }
      queuedFrames += 1;
      const expectedGeneration = generation;
      configuration
        .then(async () => {
          if (closed || generation !== expectedGeneration) {
            return;
          }
          await input.host.call("handleFrame", {
            ...request.data,
            connectionGeneration: expectedGeneration,
          });
        })
        .catch(input.onError)
        .finally(() => {
          queuedFrames -= 1;
        });
      return true;
    },
    observe: refreshObservation,
    heartbeat(staleProfileIds: string[]) {
      const expectedGeneration = generation;
      if (closed || !bound || expectedGeneration === null) {
        return;
      }
      // Never await Host responsiveness on the cloud heartbeat path. An IPC
      // failure closes execution admission, not the healthy transport socket.
      input.host
        .call(
          "heartbeat",
          { connectionGeneration: expectedGeneration, staleProfileIds },
          { timeoutMs: 2000 }
        )
        .then((next) => {
          if (!closed && generation === expectedGeneration) {
            observed = next;
            healthFailureCode = null;
            notifyAdmission();
          }
        })
        .catch((error: unknown) => {
          observed = null;
          healthFailureCode = admissionDetailCode(
            error,
            "host.heartbeat_failed"
          );
          input.onError(error);
          if (!closed) {
            notifyAdmission();
          }
        });
    },
    async detach() {
      if (closed) {
        return;
      }
      closed = true;
      bound = false;
      stopEvents();
      stopAvailability();
      if (generation !== null) {
        // Queue detach behind any admitted configure. Otherwise its delayed
        // completion could reinstall a sink belonging to an already closed WS.
        await configuration.catch(() => undefined);
        await input.host.call(
          "detachConnection",
          { connectionGeneration: generation },
          { timeoutMs: 2000 }
        );
      }
    },
  };
}
