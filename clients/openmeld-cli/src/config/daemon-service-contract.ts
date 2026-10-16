import { rm } from "node:fs/promises";
import { join } from "node:path";
import { daemonServiceContractSchema } from "@openmeld/schemas";
import type {
  DaemonServiceContract,
  DaemonServiceController,
  DaemonServiceDesiredState,
} from "@openmeld/schemas/types";
import {
  readDaemonLocalStateFile,
  writeDaemonLocalStateFile,
} from "./daemon-local-state-file";
import {
  daemonRuntimeStateRootPath,
  withDaemonServiceLifecycleLock,
} from "./daemon-state";
import {
  type OpenMeldEnvPreset,
  type OpenMeldPathResolutionInput,
  resolveOpenMeldEnvPreset,
} from "./paths";
import {
  assertNoPublishedProductionMutationDuringTests,
  isPublishedProductionOpenMeldRoot,
  isTestProcess,
} from "./published-production-safety";

const DAEMON_SERVICE_CONTRACT_FILENAME = "service-contract.json";

export type DaemonServiceContractStateInput = {
  daemonVersion: string;
  bundleId: string;
  desiredState: DaemonServiceDesiredState;
  serviceController: DaemonServiceController;
  autoStart: boolean;
  gatewayUrl: string;
  ownerUserId?: string;
  profileId?: string;
  deviceId: string;
  connectedComputerId?: string;
  heartbeatMs: number;
  lane?: OpenMeldEnvPreset;
};

export function daemonServiceContractPath(
  pathInput: OpenMeldPathResolutionInput = {}
): string {
  return join(
    daemonRuntimeStateRootPath(pathInput),
    DAEMON_SERVICE_CONTRACT_FILENAME
  );
}

export async function readDaemonServiceContract(
  pathInput: OpenMeldPathResolutionInput = {}
): Promise<DaemonServiceContract | null> {
  return await readDaemonLocalStateFile({
    path: daemonServiceContractPath(pathInput),
    schema: daemonServiceContractSchema,
  });
}

export async function upsertDaemonServiceContract(
  input: DaemonServiceContractStateInput,
  pathInput: OpenMeldPathResolutionInput = {},
  options: { expectedCurrentContract?: DaemonServiceContract } = {}
): Promise<DaemonServiceContract> {
  assertDaemonServiceContractMutationAllowed(pathInput);
  return await withDaemonServiceLifecycleLock(
    { intent: "upgrade_reconcile", command: "OpenMeld Service contract write" },
    async () =>
      await writeDaemonServiceContractState(
        input,
        pathInput,
        options.expectedCurrentContract
      ),
    pathInput
  );
}

// Only a positive pre-commit Stop refusal permits restoring the previous intent.
// This is not a new Start: preserve the still-running carrier's generation.
export async function restoreRefusedDaemonStopIntent(input: {
  previous: DaemonServiceContract;
  stopped: DaemonServiceContract;
}): Promise<void> {
  assertDaemonServiceContractMutationAllowed({});
  await withDaemonServiceLifecycleLock(
    { intent: "upgrade_reconcile", command: "Restore refused Service stop" },
    async () => {
      const current = await readDaemonServiceContract();
      if (
        !current ||
        JSON.stringify(current) !== JSON.stringify(input.stopped) ||
        input.previous.generation !== input.stopped.generation ||
        !isStopIntentForCurrentRuntime(input.previous, input.stopped)
      ) {
        throw new Error(
          "The Service changed after Stop was refused. Check its status before trying again."
        );
      }
      await writeDaemonLocalStateFile({
        path: daemonServiceContractPath(),
        schema: daemonServiceContractSchema,
        value: { ...input.previous, updatedAt: new Date().toISOString() },
        mode: 0o600,
      });
    }
  );
}

async function writeDaemonServiceContractState(
  input: DaemonServiceContractStateInput,
  pathInput: OpenMeldPathResolutionInput,
  expectedCurrentContract?: DaemonServiceContract
): Promise<DaemonServiceContract> {
  const current = await readDaemonServiceContract(pathInput);
  if (
    expectedCurrentContract &&
    (!current ||
      current.generation !== expectedCurrentContract.generation ||
      !isSameContractState(current, expectedCurrentContract))
  ) {
    throw new Error(
      "OpenMeld Service changed during Computer connection. Run setup again."
    );
  }
  const candidate = buildContractCandidate(input, pathInput, current);
  assertDaemonServiceContractIdentityAllowed(candidate, pathInput);
  if (current && isSameContractState(current, candidate)) {
    return current;
  }

  const next: DaemonServiceContract = {
    ...candidate,
    generation: current
      ? current.generation +
        (isFirstEnrollmentOfCurrentRuntime(current, candidate) ||
        isStopIntentForCurrentRuntime(current, candidate)
          ? 0
          : 1)
      : 1,
    updatedAt: new Date().toISOString(),
  };
  await writeDaemonLocalStateFile({
    path: daemonServiceContractPath(pathInput),
    schema: daemonServiceContractSchema,
    value: next,
    mode: 0o600,
  });
  return next;
}

function isStopIntentForCurrentRuntime(
  current: DaemonServiceContract,
  candidate: Omit<DaemonServiceContract, "generation" | "updatedAt">
): boolean {
  // Stop changes desired state, not the identity of work already being drained.
  // A subsequent Start still advances the generation and fences old startup receipts.
  return (
    candidate.desiredState === "stopped" &&
    !candidate.autoStart &&
    isSameContractState(current, {
      ...candidate,
      desiredState: current.desiredState,
      autoStart: current.autoStart,
    })
  );
}

function isFirstEnrollmentOfCurrentRuntime(
  current: DaemonServiceContract,
  candidate: Omit<DaemonServiceContract, "generation" | "updatedAt">
): boolean {
  // Core is attaching its Computer record to the already established owner,
  // device and lane. It is not replacing the running carrier. Every other
  // contract change, including replacing an existing enrollment, still fences
  // the previous generation.
  return Boolean(
    current.ownerUserId &&
      !current.connectedComputerId &&
      candidate.connectedComputerId &&
      isSameContractState(current, {
        ...candidate,
        connectedComputerId: undefined,
      })
  );
}

export async function clearDaemonServiceContract(
  pathInput: OpenMeldPathResolutionInput = {}
): Promise<void> {
  assertDaemonServiceContractMutationAllowed(pathInput);
  await withDaemonServiceLifecycleLock(
    { intent: "status_cleanup", command: "OpenMeld Service contract clear" },
    async () => await rm(daemonServiceContractPath(pathInput), { force: true }),
    pathInput
  );
}

function assertDaemonServiceContractMutationAllowed(
  pathInput: OpenMeldPathResolutionInput
): void {
  assertNoPublishedProductionMutationDuringTests(
    pathInput,
    "OpenMeld Service contract"
  );
}

function assertDaemonServiceContractIdentityAllowed(
  candidate: Omit<DaemonServiceContract, "generation" | "updatedAt">,
  pathInput: OpenMeldPathResolutionInput
): void {
  if (!isUnsafeProductionDaemonServiceContractIdentity(candidate)) {
    return;
  }
  if (
    isTestProcess(pathInput) &&
    !isPublishedProductionOpenMeldRoot(pathInput)
  ) {
    return;
  }
  throw new Error(
    [
      "Refusing to write OpenMeld Service contract with a test fixture identity in the published production lane.",
      "Run `openmeld service repair --profile <profile-id>` from the signed-in production lane, or clear the polluted local service state before retrying.",
    ].join(" ")
  );
}

export function isDaemonServiceContractIdentityReusable(
  contract: Pick<
    DaemonServiceContract,
    "deviceId" | "lane" | "profileId"
  > | null,
  pathInput: OpenMeldPathResolutionInput = {}
): boolean {
  if (!contract) {
    return false;
  }
  if (contract.lane !== resolveOpenMeldEnvPreset(pathInput)) {
    return false;
  }
  return !isUnsafeProductionDaemonServiceContractIdentity(contract);
}

export function isUnsafeProductionDaemonServiceContractIdentity(
  contract: Pick<DaemonServiceContract, "deviceId" | "lane" | "profileId">
): boolean {
  if (contract.lane !== "prod") {
    return false;
  }
  return (
    isUnsafeProductionDeviceId(contract.deviceId) ||
    (contract.profileId
      ? isUnsafeProductionProfileId(contract.profileId)
      : false)
  );
}

export function isUnsafeProductionDeviceId(deviceId: string): boolean {
  return normalizeFixtureText(deviceId) === "device_123";
}

function isUnsafeProductionProfileId(profileId: string): boolean {
  return UNSAFE_PRODUCTION_PROFILE_IDS.has(normalizeFixtureText(profileId));
}

const UNSAFE_PRODUCTION_PROFILE_IDS = new Set([
  "agt_existing",
  "11111111-1111-1111-1111-111111111111",
  "agt_11111111-1111-1111-1111-111111111111",
  "11111111-1111-4111-8111-111111111111",
  "agt_11111111-1111-4111-8111-111111111111",
]);

function normalizeFixtureText(value: string): string {
  return value.trim().toLowerCase();
}

function buildContractCandidate(
  input: DaemonServiceContractStateInput,
  pathInput: OpenMeldPathResolutionInput,
  current: DaemonServiceContract | null
): Omit<DaemonServiceContract, "generation" | "updatedAt"> {
  const lane = input.lane ?? resolveOpenMeldEnvPreset(pathInput);
  const connectedComputerId =
    input.connectedComputerId ??
    (current && canReuseConnectedComputerEvidence(current, input, lane)
      ? current.connectedComputerId
      : undefined);

  return {
    schema: "openmeld-daemon-service-contract-v1",
    v: 1,
    lane,
    daemonVersion: input.daemonVersion,
    bundleId: input.bundleId,
    desiredState: input.desiredState,
    serviceController: input.serviceController,
    autoStart: input.autoStart,
    gatewayUrl: input.gatewayUrl,
    ...(input.ownerUserId ? { ownerUserId: input.ownerUserId } : {}),
    ...(input.profileId ? { profileId: input.profileId } : {}),
    deviceId: input.deviceId,
    ...(connectedComputerId ? { connectedComputerId } : {}),
    heartbeatMs: input.heartbeatMs,
  };
}

function canReuseConnectedComputerEvidence(
  current: DaemonServiceContract,
  input: DaemonServiceContractStateInput,
  lane: OpenMeldEnvPreset
): boolean {
  if (
    current.lane !== lane ||
    current.gatewayUrl !== input.gatewayUrl ||
    current.deviceId !== input.deviceId
  ) {
    return false;
  }
  if (current.ownerUserId && input.ownerUserId) {
    return current.ownerUserId === input.ownerUserId;
  }
  if (current.profileId && input.profileId) {
    return current.profileId === input.profileId;
  }
  return !(current.ownerUserId || input.ownerUserId);
}

function isSameContractState(
  current: DaemonServiceContract,
  candidate: Omit<DaemonServiceContract, "generation" | "updatedAt">
): boolean {
  return (
    current.schema === candidate.schema &&
    current.v === candidate.v &&
    current.lane === candidate.lane &&
    current.daemonVersion === candidate.daemonVersion &&
    current.bundleId === candidate.bundleId &&
    current.desiredState === candidate.desiredState &&
    current.serviceController === candidate.serviceController &&
    current.autoStart === candidate.autoStart &&
    current.gatewayUrl === candidate.gatewayUrl &&
    current.ownerUserId === candidate.ownerUserId &&
    current.profileId === candidate.profileId &&
    current.deviceId === candidate.deviceId &&
    current.connectedComputerId === candidate.connectedComputerId &&
    current.heartbeatMs === candidate.heartbeatMs
  );
}
