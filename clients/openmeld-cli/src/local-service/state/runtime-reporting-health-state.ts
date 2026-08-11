import { join } from "node:path";
import {
  RUNTIME_REPORTING_FAILURE_MESSAGE_MAX_LENGTH,
  RUNTIME_REPORTING_FAILURE_REASON_CODE_MAX_LENGTH,
  RUNTIME_REPORTING_HEALTH_SCHEMA_NAME,
  RUNTIME_REPORTING_HEALTH_SCHEMA_VERSION,
  runtimeReportingHealthStateSchema,
} from "@openmeld/schemas";
import type {
  RuntimeReportingChannel,
  RuntimeReportingHealthState,
  RuntimeReportingServiceIdentity,
} from "@openmeld/schemas/types";
import {
  readDaemonLocalStateFile,
  writeDaemonLocalStateFile,
} from "../../config/daemon-local-state-file";
import { daemonRuntimeStateRootPath } from "../../config/daemon-state";
import type { OpenMeldPathResolutionInput } from "../../config/paths";

const RUNTIME_REPORTING_HEALTH_FILENAME = "reporting-health.json";
const DIAGNOSTIC_WHITESPACE_RE = /\s+/gu;
const stateUpdateQueueByPath = new Map<string, Promise<void>>();

export function runtimeReportingHealthStatePath(
  pathInput: OpenMeldPathResolutionInput = {}
): string {
  return join(
    daemonRuntimeStateRootPath(pathInput),
    RUNTIME_REPORTING_HEALTH_FILENAME
  );
}

export async function readRuntimeReportingHealthState(
  pathInput: OpenMeldPathResolutionInput = {},
  expectedServiceIdentity?: RuntimeReportingServiceIdentity
): Promise<RuntimeReportingHealthState | null> {
  const state = await readDaemonLocalStateFile({
    path: runtimeReportingHealthStatePath(pathInput),
    schema: runtimeReportingHealthStateSchema,
  });
  if (!(state && expectedServiceIdentity)) {
    return state;
  }
  return isSameServiceIdentity(state.serviceIdentity, expectedServiceIdentity)
    ? state
    : createInitialRuntimeReportingHealthState(expectedServiceIdentity);
}

export async function recordRuntimeReportingFailure(input: {
  channel: RuntimeReportingChannel;
  at?: string;
  reasonCode: string;
  message: string;
  pathInput?: OpenMeldPathResolutionInput;
  serviceIdentity: RuntimeReportingServiceIdentity;
}): Promise<RuntimeReportingHealthState> {
  return await updateRuntimeReportingHealthState(
    input.pathInput,
    input.serviceIdentity,
    (current) => {
      const channelState = current[input.channel];
      const observedAt = input.at ?? new Date().toISOString();
      return {
        ...current,
        [input.channel]: {
          ...channelState,
          applicability: {
            observedAt,
            status: "applicable",
          },
          consecutiveFailures: channelState.consecutiveFailures + 1,
          lastFailure: {
            at: observedAt,
            reasonCode: normalizeDiagnosticText({
              fallback: "runtime.reporting.failed",
              maxLength: RUNTIME_REPORTING_FAILURE_REASON_CODE_MAX_LENGTH,
              value: input.reasonCode,
            }),
            message: normalizeDiagnosticText({
              fallback: "Runtime reporting failed.",
              maxLength: RUNTIME_REPORTING_FAILURE_MESSAGE_MAX_LENGTH,
              value: input.message,
            }),
          },
          lastSuccessAt:
            channelState.applicability?.status === "not_applicable"
              ? null
              : channelState.lastSuccessAt,
        },
      };
    }
  );
}

function normalizeDiagnosticText(input: {
  fallback: string;
  maxLength: number;
  value: string;
}): string {
  const normalized = input.value.replace(DIAGNOSTIC_WHITESPACE_RE, " ").trim();
  return (normalized || input.fallback).slice(0, input.maxLength);
}

export async function recordRuntimeReportingSuccess(input: {
  channel: RuntimeReportingChannel;
  at?: string;
  pathInput?: OpenMeldPathResolutionInput;
  serviceIdentity: RuntimeReportingServiceIdentity;
}): Promise<RuntimeReportingHealthState> {
  return await updateRuntimeReportingHealthState(
    input.pathInput,
    input.serviceIdentity,
    (current) => {
      const observedAt = input.at ?? new Date().toISOString();
      return {
        ...current,
        [input.channel]: {
          applicability: {
            observedAt,
            status: "applicable",
          },
          lastSuccessAt: observedAt,
          consecutiveFailures: 0,
          lastFailure: null,
        },
      };
    }
  );
}

export async function recordRuntimeReportingNotApplicable(input: {
  channel: RuntimeReportingChannel;
  at?: string;
  pathInput?: OpenMeldPathResolutionInput;
  serviceIdentity: RuntimeReportingServiceIdentity;
}): Promise<RuntimeReportingHealthState> {
  return await updateRuntimeReportingHealthState(
    input.pathInput,
    input.serviceIdentity,
    (current) => ({
      ...current,
      [input.channel]: {
        ...current[input.channel],
        applicability: {
          observedAt: input.at ?? new Date().toISOString(),
          status: "not_applicable",
        },
        consecutiveFailures: 0,
        lastFailure: null,
      },
    })
  );
}

function createInitialRuntimeReportingHealthState(
  serviceIdentity: RuntimeReportingServiceIdentity
): RuntimeReportingHealthState {
  return {
    schema: RUNTIME_REPORTING_HEALTH_SCHEMA_NAME,
    v: RUNTIME_REPORTING_HEALTH_SCHEMA_VERSION,
    serviceIdentity,
    serviceIdentityObservedAt: new Date().toISOString(),
    runtimeAgentController: createInitialRuntimeReportingChannelHealth(),
    providerConversationProof: createInitialRuntimeReportingChannelHealth(),
  };
}

function createInitialRuntimeReportingChannelHealth(): RuntimeReportingHealthState[RuntimeReportingChannel] {
  return {
    lastSuccessAt: null,
    consecutiveFailures: 0,
    lastFailure: null,
  };
}

async function writeRuntimeReportingHealthState(
  state: RuntimeReportingHealthState,
  pathInput: OpenMeldPathResolutionInput = {}
): Promise<void> {
  await writeDaemonLocalStateFile({
    path: runtimeReportingHealthStatePath(pathInput),
    schema: runtimeReportingHealthStateSchema,
    value: state,
    mode: 0o600,
  });
}

function updateRuntimeReportingHealthState(
  pathInput: OpenMeldPathResolutionInput | undefined,
  serviceIdentity: RuntimeReportingServiceIdentity,
  update: (current: RuntimeReportingHealthState) => RuntimeReportingHealthState
): Promise<RuntimeReportingHealthState> {
  const path = runtimeReportingHealthStatePath(pathInput);
  const previousUpdate = stateUpdateQueueByPath.get(path) ?? Promise.resolve();
  const updatePromise = previousUpdate.then(async () => {
    const current =
      (await readRuntimeReportingHealthState(pathInput, serviceIdentity)) ??
      createInitialRuntimeReportingHealthState(serviceIdentity);
    const next = update(current);
    await writeRuntimeReportingHealthState(next, pathInput);
    return next;
  });
  const queueTail = updatePromise.then(
    () => undefined,
    () => undefined
  );
  stateUpdateQueueByPath.set(path, queueTail);

  return updatePromise.finally(() => {
    if (stateUpdateQueueByPath.get(path) === queueTail) {
      stateUpdateQueueByPath.delete(path);
    }
  });
}

function isSameServiceIdentity(
  left: RuntimeReportingServiceIdentity | undefined,
  right: RuntimeReportingServiceIdentity
): boolean {
  return (
    left?.deviceId === right.deviceId &&
    left.contractGeneration === right.contractGeneration
  );
}
