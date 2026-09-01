import {
  hasOnlyAgentControllerSignInReasonCodes,
  projectLocalAgentCatalogFromCapabilities,
} from "@openmeld/agent-runtime";
import {
  currentDeviceTargetDeviceIdSchema,
  forgetComputerRouteParamsSchema,
  localRuntimeEnrollmentBodySchema,
  setLocalRuntimeDisplayNameBodySchema,
} from "@openmeld/schemas";
import type {
  AgentControllerInterfaceSnapshot,
  CurrentDeviceTargetResponse,
  CurrentLocalRuntimeReplyReadinessResponse,
  DaemonServiceLane,
  ForgetComputerResponse,
  ForgetCurrentComputerResponse,
  LocalComponentsStatus,
  LocalRuntimeComputer,
  LocalRuntimeEnrollmentResponse,
  LocalRuntimeExecutionTarget,
  LocalRuntimesQuery,
  LocalRuntimesResponse,
  RuntimeTransportLookupOwnerServiceResponse,
} from "@openmeld/schemas/types";
import { resolveLocalComponentUpdateProjection } from "../../local-components/update-projection";
import { selectCurrentOwnerServiceSessionsByDeviceLane } from "../../runtime-transport/application/current-owner-service-sessions";
import type { ForgetCurrentComputerRecordResult } from "../infrastructure/d1/current-device-forget-repo";
import { resolveCurrentLocalRuntimeTarget } from "./current-local-runtime-target";
import {
  ensureOwnedDevicePlaceholderUseCase,
  type OwnedDeviceRegistryStore,
} from "./owned-device-registry-service";

const CURRENT_DEVICE_FORGET_LOG_EVENTS = {
  alreadyMissing: "current_device.forget.already_missing",
  completed: "current_device.forget.completed",
  reactivatedByLocalSetup: "current_device.reactivated_by_local_setup",
  requested: "current_device.forget.requested",
} as const;
export class ConnectedComputerEnrollmentInvalidError extends Error {
  constructor(connectedComputerId: string) {
    super(
      "This computer is not connected to OpenMeld. Reconnect this computer from OpenMeld Web."
    );
    this.name = "ConnectedComputerEnrollmentInvalidError";
    this.connectedComputerId = connectedComputerId;
  }

  readonly connectedComputerId: string;
}

// TODO(2026-05-15): Rename this storage-facing record to LocalRuntimeComputer
// after the owned-device D1 table is replaced or explicitly kept as internal
// storage only.
type OwnedDeviceRecord = {
  deviceId: string;
  connectedComputerId?: string | null;
  userDisplayName?: string | null;
  observedDisplayName?: string | null;
  platformFamily?: LocalRuntimeComputer["platformFamily"] | null;
  osVersion?: string | null;
  deviceType?: LocalRuntimeComputer["deviceType"] | null;
  firstSeenAtMs: number;
  lastObservedAtMs: number | null;
};

// TODO(2026-05-15): Rename this projection to LocalRuntimeExecutionTargetRecord
// after runtime inventory no longer exposes owned-device terminology anywhere
// above the D1 storage boundary.
type OwnedDeviceExecutionTargetRecord = {
  agentControllerRef: string | null;
  agentControllerInterface?: AgentControllerInterfaceSnapshot | null;
  capabilityEnabled: boolean;
  capabilityReasonCodes: readonly string[];
  capabilityStatus: "ready" | "not_ready" | "stale" | "unknown";
  deviceId: string;
  lastObservedAtMs: number | null;
  openMeldServiceRuntimeId: string;
  runtimeLane: DaemonServiceLane;
};

type LocalRuntimeInventoryRows = {
  currentConnectedComputerId: string | null;
  currentDeviceId: string | null;
  currentRuntimeLane: DaemonServiceLane | null;
  devices: readonly OwnedDeviceRecord[];
  executionTargets: readonly OwnedDeviceExecutionTargetRecord[];
};

type LegacyCurrentComputerAdoptionCandidate = {
  deviceId: string;
  runtimeLane: DaemonServiceLane;
};

type LocalAgentControlByDeviceLane = ReadonlyMap<
  string,
  LocalRuntimeExecutionTarget["localAgentControl"]
>;
type LocalProjectControlByDeviceLane = ReadonlyMap<
  string,
  NonNullable<LocalRuntimeExecutionTarget["localProjectControl"]>
>;
type ComputerFileAccessByDeviceLane = ReadonlyMap<
  string,
  NonNullable<LocalRuntimeComputer["computerFileAccess"]>
>;
type LocalFolderPickerByDeviceLane = ReadonlyMap<
  string,
  NonNullable<LocalRuntimeComputer["localFolderPicker"]>
>;
type ConnectCurrentDeviceIdentityResult =
  | {
      status: "connected";
      connectedComputerId: string;
    }
  | {
      status: "requested_not_found";
      requestedConnectedComputerId: string;
    };

type CurrentDeviceTargetStore = OwnedDeviceRegistryStore & {
  readCurrentDeviceTarget(input: {
    userId: string;
  }): Promise<CurrentDeviceTargetResponse>;
  // TODO(2026-05-15): Compatibility storage name only. Rename this store method
  // with the owned-device repository cleanup; public Local Runtime APIs must
  // never expose this shape or treat it as reply-readiness truth.
  readOwnedDevices(input: {
    userId: string;
  }): Promise<readonly OwnedDeviceRecord[]>;
  connectCurrentDeviceIdentity?(input: {
    userId: string;
    deviceId: string;
    requestedConnectedComputerId?: string;
    runtimeLane: DaemonServiceLane;
    connectedAtMs: number;
  }): Promise<ConnectCurrentDeviceIdentityResult>;
  readConnectedComputerIdentity(input: {
    userId: string;
    connectedComputerId: string;
  }): Promise<{ connectedComputerId: string } | null>;
  readOwnedDeviceExecutionTargets?(input: {
    nowMs: number;
    userId: string;
  }): Promise<readonly OwnedDeviceExecutionTargetRecord[]>;
  deleteForgottenDevice(input: {
    userId: string;
    deviceId: string;
  }): Promise<void>;
  forgetCurrentComputer(input: {
    userId: string;
    forgottenAtMs: number;
  }): Promise<ForgetCurrentComputerRecordResult>;
  forgetComputer(input: {
    userId: string;
    deviceId: string;
    forgottenAtMs: number;
  }): Promise<ForgetCurrentComputerRecordResult>;
  readForgottenDevice(input: {
    userId: string;
    deviceId: string;
  }): Promise<{ deviceId: string } | null>;
};

export type ConnectedLocalRuntimeDisplayNameStore = {
  readCurrentDeviceTarget(input: {
    userId: string;
  }): Promise<CurrentDeviceTargetResponse>;
  readOwnedDevices(input: {
    userId: string;
  }): Promise<readonly OwnedDeviceRecord[]>;
  readOwnedDeviceExecutionTargets?(input: {
    nowMs: number;
    userId: string;
  }): Promise<readonly OwnedDeviceExecutionTargetRecord[]>;
};

export async function getCurrentDeviceTargetUseCase(input: {
  store: CurrentDeviceTargetStore;
  userId: string;
}): Promise<CurrentDeviceTargetResponse> {
  return await input.store.readCurrentDeviceTarget({
    userId: input.userId,
  });
}

export async function enrollLocalSetupDeviceUseCase(input: {
  store: CurrentDeviceTargetStore;
  userId: string;
  deviceId: string;
  connectedComputerId?: string;
  runtimeLane: DaemonServiceLane;
  now?: Date;
}): Promise<LocalRuntimeEnrollmentResponse> {
  const parsedDeviceId = currentDeviceTargetDeviceIdSchema.safeParse(
    input.deviceId
  );
  if (!parsedDeviceId.success) {
    throw new Error(
      `failed to enroll local runtime: ${parsedDeviceId.error.issues[0]?.message ?? "invalid deviceId"}`
    );
  }
  const parsed = localRuntimeEnrollmentBodySchema.safeParse({
    ...(input.connectedComputerId === undefined
      ? {}
      : { connectedComputerId: input.connectedComputerId }),
    runtimeLane: input.runtimeLane,
  });
  if (!parsed.success) {
    throw new Error(
      `failed to enroll local runtime: ${parsed.error.issues[0]?.message ?? "invalid enrollment body"}`
    );
  }

  const deviceId = parsedDeviceId.data;
  const enrolledAtMs = (input.now ?? new Date()).getTime();
  if (parsed.data.connectedComputerId !== undefined) {
    const connectedComputerIdentity =
      await input.store.readConnectedComputerIdentity({
        userId: input.userId,
        connectedComputerId: parsed.data.connectedComputerId,
      });
    if (connectedComputerIdentity === null) {
      throw new ConnectedComputerEnrollmentInvalidError(
        parsed.data.connectedComputerId
      );
    }
  }

  const forgotten = await input.store.readForgottenDevice({
    userId: input.userId,
    deviceId,
  });
  if (forgotten) {
    await input.store.deleteForgottenDevice({
      userId: input.userId,
      deviceId,
    });
    console.info("[core.current_device.reactivated_by_local_setup]", {
      event: CURRENT_DEVICE_FORGET_LOG_EVENTS.reactivatedByLocalSetup,
      userId: input.userId,
      deviceId,
    });
  }

  await ensureOwnedDevicePlaceholderUseCase({
    store: input.store,
    userId: input.userId,
    deviceId,
    now: input.now,
  });
  const connectedComputer = await input.store.connectCurrentDeviceIdentity?.({
    userId: input.userId,
    deviceId,
    ...(parsed.data.connectedComputerId
      ? { requestedConnectedComputerId: parsed.data.connectedComputerId }
      : {}),
    runtimeLane: parsed.data.runtimeLane,
    connectedAtMs: enrolledAtMs,
  });
  if (connectedComputer?.status === "requested_not_found") {
    throw new ConnectedComputerEnrollmentInvalidError(
      connectedComputer.requestedConnectedComputerId
    );
  }

  return {
    deviceId,
    runtimeLane: parsed.data.runtimeLane,
    ...(connectedComputer
      ? { connectedComputerId: connectedComputer.connectedComputerId }
      : {}),
  };
}

export async function forgetCurrentComputerUseCase(input: {
  store: CurrentDeviceTargetStore;
  userId: string;
  now?: Date;
}): Promise<ForgetCurrentComputerResponse> {
  const nowMs = (input.now ?? new Date()).getTime();
  console.info("[core.current_device.forget.requested]", {
    event: CURRENT_DEVICE_FORGET_LOG_EVENTS.requested,
    userId: input.userId,
  });

  const result = await input.store.forgetCurrentComputer({
    userId: input.userId,
    forgottenAtMs: nowMs,
  });
  if (result.status === "already_missing") {
    console.info("[core.current_device.forget.already_missing]", {
      event: CURRENT_DEVICE_FORGET_LOG_EVENTS.alreadyMissing,
      userId: input.userId,
    });
  } else {
    console.info("[core.current_device.forget.completed]", {
      event: CURRENT_DEVICE_FORGET_LOG_EVENTS.completed,
      userId: input.userId,
      deviceId: result.forgottenDeviceId,
    });
  }

  return {
    status: result.status,
    forgottenDeviceId: result.forgottenDeviceId,
    currentDeviceTarget: {
      availability: "missing",
    },
  };
}

export async function forgetComputerUseCase(input: {
  store: CurrentDeviceTargetStore;
  userId: string;
  deviceId: string;
  now?: Date;
}): Promise<ForgetComputerResponse> {
  const parsed = forgetComputerRouteParamsSchema.safeParse({
    deviceId: input.deviceId,
  });
  if (!parsed.success) {
    throw new Error(
      `failed to forget computer: ${parsed.error.issues[0]?.message ?? "invalid deviceId"}`
    );
  }

  const nowMs = (input.now ?? new Date()).getTime();
  console.info("[core.local_runtime.forget.requested]", {
    event: "local_runtime.forget.requested",
    userId: input.userId,
    deviceId: parsed.data.deviceId,
  });

  const result = await input.store.forgetComputer({
    userId: input.userId,
    deviceId: parsed.data.deviceId,
    forgottenAtMs: nowMs,
  });
  if (result.status === "already_missing") {
    console.info("[core.local_runtime.forget.already_missing]", {
      event: "local_runtime.forget.already_missing",
      userId: input.userId,
      deviceId: parsed.data.deviceId,
    });
  } else {
    console.info("[core.local_runtime.forget.completed]", {
      event: "local_runtime.forget.completed",
      userId: input.userId,
      deviceId: result.forgottenDeviceId,
    });
  }

  const currentDeviceTarget = await input.store.readCurrentDeviceTarget({
    userId: input.userId,
  });

  return {
    status: result.status,
    forgottenDeviceId: result.forgottenDeviceId,
    currentDeviceTarget,
  };
}

export async function listLocalRuntimesUseCase(input: {
  connectionIdentityAdoption?: LocalRuntimesQuery["connectionIdentityAdoption"];
  lookupOwnerService?: (input: {
    ownerUserId: string;
  }) => Promise<RuntimeTransportLookupOwnerServiceResponse>;
  store: CurrentDeviceTargetStore;
  userId: string;
}): Promise<LocalRuntimesResponse> {
  const inventory = await readLocalRuntimeInventoryRows(input);
  const ownerService = await overlayLiveHeartbeatObservations({
    executionTargets: inventory.executionTargets,
    lookupOwnerService: input.lookupOwnerService ?? null,
    userId: input.userId,
  });
  const localAgentControlByDeviceLane =
    buildLocalAgentControlByDeviceLane(ownerService);
  const localProjectControlByDeviceLane =
    buildLocalProjectControlByDeviceLane(ownerService);
  const computerFileAccessByDeviceLane =
    buildComputerFileAccessByDeviceLane(ownerService);
  const localFolderPickerByDeviceLane =
    buildLocalFolderPickerByDeviceLane(ownerService);
  const connectedGroups = groupConnectedComputerDevices(inventory.devices);
  const legacyDeviceEvidence = inventory.devices
    .filter((device) => device.connectedComputerId === null)
    .map((device) =>
      buildLegacyDeviceEvidence({
        currentDeviceId: inventory.currentDeviceId,
        currentRuntimeLane: inventory.currentRuntimeLane,
        device,
        executionTargets: inventory.executionTargets.filter(
          (target) => target.deviceId === device.deviceId
        ),
        localAgentControlByDeviceLane,
        computerFileAccessByDeviceLane,
        localFolderPickerByDeviceLane,
        localProjectControlByDeviceLane,
      })
    );
  const connectedLocalRuntimes = connectedGroups.map((devices) =>
    buildConnectedLocalRuntimeComputer({
      currentDeviceId: inventory.currentDeviceId,
      currentRuntimeLane: inventory.currentRuntimeLane,
      devices,
      executionTargets: inventory.executionTargets.filter((target) =>
        devices.some((device) => device.deviceId === target.deviceId)
      ),
      localAgentControlByDeviceLane,
      computerFileAccessByDeviceLane,
      localFolderPickerByDeviceLane,
      localProjectControlByDeviceLane,
    })
  );
  const unconnectedLocalRuntimes = inventory.devices
    .filter((device) => !device.connectedComputerId)
    .map((device) =>
      buildLocalRuntimeComputer({
        device,
        currentDeviceId: inventory.currentDeviceId,
        currentRuntimeLane: inventory.currentRuntimeLane,
        executionTargets: inventory.executionTargets.filter(
          (target) => target.deviceId === device.deviceId
        ),
        localAgentControlByDeviceLane,
        computerFileAccessByDeviceLane,
        localFolderPickerByDeviceLane,
        localProjectControlByDeviceLane,
      })
    );
  const localRuntimes =
    input.connectionIdentityAdoption === "safe_legacy_current"
      ? connectedLocalRuntimes
      : [...connectedLocalRuntimes, ...unconnectedLocalRuntimes];

  return {
    currentConnectedComputerId: inventory.currentConnectedComputerId,
    currentDeviceId: inventory.currentDeviceId,
    currentRuntimeLane: inventory.currentRuntimeLane,
    legacyDeviceEvidence,
    localRuntimes,
  };
}

async function readLocalRuntimeInventoryRows(input: {
  connectionIdentityAdoption?: LocalRuntimesQuery["connectionIdentityAdoption"];
  store: CurrentDeviceTargetStore;
  userId: string;
}): Promise<LocalRuntimeInventoryRows> {
  const currentDeviceTarget = await input.store.readCurrentDeviceTarget({
    userId: input.userId,
  });
  const nowMs = Date.now();

  const currentDeviceId =
    currentDeviceTarget.availability === "resolved"
      ? currentDeviceTarget.deviceId
      : null;
  const currentRuntimeLane =
    currentDeviceTarget.availability === "resolved"
      ? currentDeviceTarget.runtimeLane
      : null;

  if (currentDeviceId !== null) {
    await ensureOwnedDevicePlaceholderUseCase({
      store: input.store,
      userId: input.userId,
      deviceId: currentDeviceId,
    });
  }

  const devices = await input.store.readOwnedDevices({
    userId: input.userId,
  });
  const executionTargets =
    (await input.store.readOwnedDeviceExecutionTargets?.({
      nowMs,
      userId: input.userId,
    })) ?? [];
  const adopted =
    input.connectionIdentityAdoption === "safe_legacy_current"
      ? await adoptLegacyCurrentComputerIdentityIfSafe({
          store: input.store,
          userId: input.userId,
          currentDeviceId,
          currentRuntimeLane,
          devices,
          executionTargets,
          nowMs,
        })
      : {
          currentDeviceId,
          currentRuntimeLane,
          devices,
        };
  const currentConnectedComputerId =
    adopted.currentDeviceId === null
      ? null
      : (adopted.devices.find(
          (device) => device.deviceId === adopted.currentDeviceId
        )?.connectedComputerId ?? null);

  return {
    currentConnectedComputerId,
    currentDeviceId: adopted.currentDeviceId,
    currentRuntimeLane: adopted.currentRuntimeLane,
    devices: adopted.devices,
    executionTargets,
  };
}

async function adoptLegacyCurrentComputerIdentityIfSafe(input: {
  store: CurrentDeviceTargetStore;
  userId: string;
  currentDeviceId: string | null;
  currentRuntimeLane: DaemonServiceLane | null;
  devices: readonly OwnedDeviceRecord[];
  executionTargets: readonly OwnedDeviceExecutionTargetRecord[];
  nowMs: number;
}): Promise<{
  currentDeviceId: string | null;
  currentRuntimeLane: DaemonServiceLane | null;
  devices: readonly OwnedDeviceRecord[];
}> {
  const passthrough = {
    currentDeviceId: input.currentDeviceId,
    currentRuntimeLane: input.currentRuntimeLane,
    devices: input.devices,
  };
  if (
    input.currentRuntimeLane === null ||
    input.store.connectCurrentDeviceIdentity === undefined
  ) {
    return passthrough;
  }

  const currentDevice = input.devices.find(
    (device) => device.deviceId === input.currentDeviceId
  );
  if (!currentDevice || currentDevice.connectedComputerId) {
    return passthrough;
  }

  // The current computer is Binding-derived; legacy identity adoption may
  // link a connected-computer identity for that derived device, but it never
  // moves which device is current.
  const candidates = resolveLegacyCurrentComputerAdoptionCandidates({
    devices: input.devices,
    executionTargets: input.executionTargets,
    runtimeLane: input.currentRuntimeLane,
  });
  const currentCandidate =
    candidates.find(
      (candidate) =>
        candidate.deviceId === input.currentDeviceId &&
        candidate.runtimeLane === input.currentRuntimeLane
    ) ?? null;
  if (!currentCandidate) {
    return passthrough;
  }

  const connected = await input.store.connectCurrentDeviceIdentity({
    userId: input.userId,
    deviceId: currentCandidate.deviceId,
    runtimeLane: currentCandidate.runtimeLane,
    connectedAtMs: input.nowMs,
  });
  if (connected.status !== "connected") {
    throw new ConnectedComputerEnrollmentInvalidError(
      connected.requestedConnectedComputerId
    );
  }
  console.info("[core.connected_computer.legacy_current_adopted]", {
    event: "connected_computer.legacy_current_adopted",
    userId: input.userId,
    deviceId: currentCandidate.deviceId,
    runtimeLane: currentCandidate.runtimeLane,
    connectedComputerId: connected.connectedComputerId,
  });

  return {
    currentDeviceId: input.currentDeviceId,
    currentRuntimeLane: input.currentRuntimeLane,
    devices: input.devices.map((device) =>
      device.deviceId === currentCandidate.deviceId
        ? {
            ...device,
            connectedComputerId: connected.connectedComputerId,
          }
        : device
    ),
  };
}

function resolveLegacyCurrentComputerAdoptionCandidates(input: {
  devices: readonly OwnedDeviceRecord[];
  executionTargets: readonly OwnedDeviceExecutionTargetRecord[];
  runtimeLane: DaemonServiceLane;
}): LegacyCurrentComputerAdoptionCandidate[] {
  const legacyDeviceIds = new Set(
    input.devices
      .filter((device) => device.connectedComputerId === null)
      .map((device) => device.deviceId)
  );
  const candidateKeys = new Map<
    string,
    LegacyCurrentComputerAdoptionCandidate
  >();
  for (const target of input.executionTargets) {
    if (
      !legacyDeviceIds.has(target.deviceId) ||
      target.runtimeLane !== input.runtimeLane ||
      !isFreshLegacyRuntimeEvidence(target)
    ) {
      continue;
    }
    const key = `${target.deviceId}\u0000${target.runtimeLane}`;
    candidateKeys.set(key, {
      deviceId: target.deviceId,
      runtimeLane: target.runtimeLane,
    });
  }

  return [...candidateKeys.values()];
}

function isFreshLegacyRuntimeEvidence(
  target: OwnedDeviceExecutionTargetRecord
): boolean {
  return (
    target.lastObservedAtMs !== null && target.capabilityStatus !== "stale"
  );
}

export async function resolveConnectedLocalRuntimeDisplayNameUseCase(input: {
  store: ConnectedLocalRuntimeDisplayNameStore;
  userId: string;
  deviceId: string;
  runtimeLane: DaemonServiceLane;
  now?: Date;
}): Promise<string | null> {
  // Read-only projection lookup for display. Do not adopt legacy devices, create
  // placeholders, or repair connected computer identity from readiness reads.
  const currentDeviceTarget = await input.store.readCurrentDeviceTarget({
    userId: input.userId,
  });
  const currentDeviceId =
    currentDeviceTarget.availability === "resolved"
      ? currentDeviceTarget.deviceId
      : null;
  const currentRuntimeLane =
    currentDeviceTarget.availability === "resolved"
      ? currentDeviceTarget.runtimeLane
      : null;
  const nowMs = (input.now ?? new Date()).getTime();
  const [devices, executionTargets] = await Promise.all([
    input.store.readOwnedDevices({ userId: input.userId }),
    input.store.readOwnedDeviceExecutionTargets?.({
      nowMs,
      userId: input.userId,
    }) ?? Promise.resolve([]),
  ]);

  const matchingComputer = groupConnectedComputerDevices(devices)
    .map((connectedDevices) =>
      buildConnectedLocalRuntimeComputer({
        currentDeviceId,
        currentRuntimeLane,
        devices: connectedDevices,
        executionTargets: executionTargets.filter((target) =>
          connectedDevices.some((device) => device.deviceId === target.deviceId)
        ),
        computerFileAccessByDeviceLane: new Map(),
        localFolderPickerByDeviceLane: new Map(),
        localAgentControlByDeviceLane: new Map(),
        localProjectControlByDeviceLane: new Map(),
      })
    )
    .map((computer) => ({
      computer,
      matchPriority: resolveConnectedLocalRuntimeRouteMatchPriority({
        computer,
        deviceId: input.deviceId,
        runtimeLane: input.runtimeLane,
      }),
    }))
    .filter(
      (
        item
      ): item is {
        computer: LocalRuntimeComputer;
        matchPriority: number;
      } => item.matchPriority !== null
    )
    .sort(
      (left, right) =>
        left.matchPriority - right.matchPriority ||
        left.computer.deviceId.localeCompare(right.computer.deviceId)
    )[0]?.computer;

  if (
    !(
      matchingComputer &&
      hasUserVisibleConnectedComputerDisplay(matchingComputer)
    )
  ) {
    return null;
  }
  return matchingComputer.deviceDisplayName;
}

export async function getCurrentLocalRuntimeReplyReadinessUseCase(input: {
  lookupOwnerService: (input: {
    ownerUserId: string;
  }) => Promise<RuntimeTransportLookupOwnerServiceResponse>;
  store: CurrentDeviceTargetStore;
  userId: string;
  now?: Date;
}): Promise<CurrentLocalRuntimeReplyReadinessResponse> {
  const generatedAt = (input.now ?? new Date()).toISOString();
  const localRuntimeInventory = await listLocalRuntimesUseCase({
    store: input.store,
    userId: input.userId,
  });
  const bindingTarget =
    localRuntimeInventory.currentDeviceId &&
    localRuntimeInventory.currentRuntimeLane
      ? {
          availability: "resolved" as const,
          deviceId: localRuntimeInventory.currentDeviceId,
          runtimeLane: localRuntimeInventory.currentRuntimeLane,
        }
      : { availability: "missing" as const };

  const ownerService = await input.lookupOwnerService({
    ownerUserId: input.userId,
  });

  // "Can this computer reply" is a connectivity question, and connectivity is a
  // ServiceRuntime heartbeat-freshness fact (agent-transport-contract.md, "Service
  // Online Evidence") — NOT a Binding fact. The Binding-derived current-device
  // pointer answers "which device is the account's active/current one" for
  // routing; it must not gate whether a freshly connected computer (OpenMeld Service +
  // local agents up, but no Agent Profile bound yet) is reported as connected.
  // Prefer the Binding target when present; otherwise fall back to the live
  // ServiceRuntime session so the connected computer reports its real readiness.
  const currentTarget = resolveCurrentLocalRuntimeTarget({
    bindingTarget,
    inventory: localRuntimeInventory,
    ownerService,
  });

  if (currentTarget.availability === "missing") {
    return buildCurrentLocalRuntimeReplyReadiness({
      currentTarget,
      generatedAt,
      message: "Set up this computer before local agents can reply in Spaces.",
      nextAction: "connect_service",
      primaryBlocker: "current_runtime_missing",
      runtime: null,
      service: null,
      status: "blocked",
    });
  }

  const currentComputer =
    localRuntimeInventory.localRuntimes.find(
      (device) => device.deviceId === currentTarget.deviceId
    ) ?? null;
  const currentExecutionTarget =
    currentComputer?.executionTargets.find(
      (target) =>
        target.deviceId === currentTarget.deviceId &&
        target.runtimeLane === currentTarget.runtimeLane
    ) ?? null;

  const matchingSession =
    ownerService.online === true
      ? (ownerService.sessions.find(
          (session) =>
            session.deviceId === currentTarget.deviceId &&
            session.lane === currentTarget.runtimeLane
        ) ?? null)
      : null;

  if (ownerService.online !== true || matchingSession === null) {
    return resolveOwnerServiceDisconnectReadiness({
      currentTarget,
      currentComputer,
      currentExecutionTarget,
      generatedAt,
      ownerService,
    });
  }

  const localComponentsStatus =
    matchingSession.capabilities.localComponents ?? null;
  const executionCompatibility = matchingSession.executionCompatibility;
  if (executionCompatibility.status === "update_required") {
    return buildCurrentLocalRuntimeReplyReadiness({
      currentTarget,
      generatedAt,
      message:
        "Update OpenMeld Service before local agents can reply from this computer.",
      nextAction: "update_service",
      primaryBlocker: "service_update_required",
      runtime: buildCurrentRuntimeEvidence({
        computer: currentComputer,
        target: currentExecutionTarget,
      }),
      serviceVersion: matchingSession.serviceVersion ?? null,
      localComponentsStatus,
      service: {
        connected: true,
        executionCompatibility,
        matchingCurrentRuntime: true,
        reasonCodes: [executionCompatibility.reasonCode],
        sessionDeviceId: matchingSession.deviceId,
        sessionLane: matchingSession.lane,
      },
      status: "blocked",
    });
  }

  const localComponents = resolveLocalComponentUpdateProjection({
    generatedAt,
    localComponentsStatus,
    serviceConnected: true,
    serviceVersion: matchingSession.serviceVersion ?? null,
  });
  if (localComponents.service.wakeBlocked) {
    return buildCurrentLocalRuntimeReplyReadiness({
      currentTarget,
      generatedAt,
      localComponents,
      message:
        "Update OpenMeld Service before local agents can reply from this computer.",
      nextAction: "update_service",
      primaryBlocker: "service_update_required",
      runtime: buildCurrentRuntimeEvidence({
        computer: currentComputer,
        target: currentExecutionTarget,
      }),
      serviceVersion: matchingSession.serviceVersion ?? null,
      service: {
        connected: true,
        executionCompatibility,
        matchingCurrentRuntime: true,
        reasonCodes: localComponents.service.reasonCodes,
        sessionDeviceId: matchingSession.deviceId,
        sessionLane: matchingSession.lane,
      },
      status: "blocked",
    });
  }

  const runtimeBlocker = resolveExecutionTargetReplyBlocker(
    currentExecutionTarget
  );
  if (
    runtimeBlocker !== null &&
    !isRegistryFreshnessBlocker(runtimeBlocker.primaryBlocker)
  ) {
    return buildCurrentLocalRuntimeReplyReadiness({
      currentTarget,
      generatedAt,
      message: runtimeBlocker.message,
      nextAction: runtimeBlocker.nextAction,
      primaryBlocker: runtimeBlocker.primaryBlocker,
      runtime: buildCurrentRuntimeEvidence({
        computer: currentComputer,
        target: currentExecutionTarget,
      }),
      service: {
        connected: true,
        executionCompatibility,
        matchingCurrentRuntime: true,
        reasonCodes: [],
        sessionDeviceId: matchingSession.deviceId,
        sessionLane: matchingSession.lane,
      },
      serviceVersion: matchingSession.serviceVersion ?? null,
      localComponentsStatus,
      status: runtimeBlocker.status,
    });
  }

  return buildCurrentLocalRuntimeReplyReadiness({
    currentTarget,
    generatedAt,
    message: "Local agents can reply from this computer in Spaces.",
    nextAction: "none",
    primaryBlocker: "none",
    runtime: buildCurrentRuntimeEvidence({
      computer: currentComputer,
      target: currentExecutionTarget,
    }),
    service: {
      connected: true,
      executionCompatibility,
      matchingCurrentRuntime: true,
      reasonCodes: [],
      sessionDeviceId: matchingSession.deviceId,
      sessionLane: matchingSession.lane,
    },
    serviceVersion: matchingSession.serviceVersion ?? null,
    localComponentsStatus,
    status: "ready",
  });
}

function resolveOwnerServiceDisconnectReadiness(input: {
  currentTarget: {
    availability: "resolved";
    deviceId: string;
    runtimeLane: DaemonServiceLane;
    connectedComputerId?: string | null;
  };
  currentComputer: LocalRuntimeComputer | null;
  currentExecutionTarget: LocalRuntimeExecutionTarget | null;
  generatedAt: string;
  ownerService: RuntimeTransportLookupOwnerServiceResponse;
}): CurrentLocalRuntimeReplyReadinessResponse {
  const isOwnershipConflict =
    input.ownerService.online === false &&
    input.ownerService.reasonCode === "daemon.session.reject_conflict";
  return buildCurrentLocalRuntimeReplyReadiness({
    currentTarget: input.currentTarget,
    generatedAt: input.generatedAt,
    message: isOwnershipConflict
      ? "This computer is currently attached to another OpenMeld account. Reconnect this account to take control."
      : "OpenMeld Service is not connected for this account on this computer.",
    nextAction: "reconnect_service",
    primaryBlocker: "service_not_connected",
    runtime: buildCurrentRuntimeEvidence({
      computer: input.currentComputer,
      target: input.currentExecutionTarget,
    }),
    service: {
      connected: false,
      executionCompatibility: null,
      matchingCurrentRuntime: false,
      reasonCodes:
        input.ownerService.online === true
          ? ["service.current_runtime_session_missing"]
          : [input.ownerService.reasonCode],
      sessionDeviceId: null,
      sessionLane: null,
    },
    status: "blocked",
  });
}

export async function setLocalRuntimeDisplayNameUseCase(input: {
  store: CurrentDeviceTargetStore;
  userId: string;
  deviceId: string;
  displayName: string | null;
  now?: Date;
}): Promise<LocalRuntimesResponse> {
  const deviceIdResult = currentDeviceTargetDeviceIdSchema.safeParse(
    input.deviceId
  );
  if (!deviceIdResult.success) {
    throw new Error(
      `failed to set local runtime display name: ${deviceIdResult.error.issues[0]?.message ?? "invalid deviceId"}`
    );
  }

  const displayNameResult = setLocalRuntimeDisplayNameBodySchema.safeParse({
    displayName: input.displayName,
  });
  if (!displayNameResult.success) {
    throw new Error(
      `failed to set local runtime display name: ${displayNameResult.error.issues[0]?.message ?? "invalid displayName"}`
    );
  }

  const existing = await ensureOwnedDevicePlaceholderUseCase({
    store: input.store,
    userId: input.userId,
    deviceId: deviceIdResult.data,
    now: input.now,
  });
  const nowMs = (input.now ?? new Date()).getTime();

  await input.store.upsertOwnedDeviceRegistryRecord({
    record: {
      ...existing,
      userDisplayName: displayNameResult.data.displayName,
      updatedAtMs: nowMs,
    },
  });

  return await listLocalRuntimesUseCase({
    store: input.store,
    userId: input.userId,
  });
}

function resolveExecutionTargetReplyBlocker(
  target: LocalRuntimeExecutionTarget | null
): {
  message: string;
  nextAction: CurrentLocalRuntimeReplyReadinessResponse["nextAction"];
  primaryBlocker: CurrentLocalRuntimeReplyReadinessResponse["primaryBlocker"];
  status: CurrentLocalRuntimeReplyReadinessResponse["status"];
} | null {
  if (target === null) {
    return {
      message: "Set up this computer before local agents can reply in Spaces.",
      nextAction: "run_setup",
      primaryBlocker: "current_runtime_missing",
      status: "blocked",
    };
  }
  if (
    target.capabilities.length > 0 &&
    resolveEnabledExecutionTargetCapabilities(target.capabilities).length === 0
  ) {
    return {
      message: "All local agents on this computer are turned off.",
      nextAction: "none",
      primaryBlocker: "agent_controller_report_not_ready",
      status: "blocked",
    };
  }
  if (target.status === "ready") {
    return null;
  }
  if (target.status === "stale") {
    return {
      message:
        "OpenMeld needs a fresh check from this computer before local agents can reply.",
      nextAction: "check_status",
      primaryBlocker: "agent_controller_report_stale",
      status: "checking",
    };
  }
  if (target.status === "unknown") {
    return {
      message:
        "OpenMeld cannot confirm local agent readiness from this computer yet.",
      nextAction: "check_status",
      primaryBlocker: "agent_controller_report_unknown",
      status: "unknown",
    };
  }
  if (hasOnlyRetryableControllerCheckFailureEvidence(target)) {
    return {
      message:
        "OpenMeld could not finish checking one or more local agents on this computer. Check again before they reply in Spaces.",
      nextAction: "check_status",
      primaryBlocker: "agent_controller_report_not_ready",
      status: "blocked",
    };
  }
  return {
    message:
      "Set up local agents on this computer before they can reply in Spaces.",
    nextAction: "run_setup",
    primaryBlocker: "agent_controller_report_not_ready",
    status: "blocked",
  };
}

function hasOnlyRetryableControllerCheckFailureEvidence(
  target: LocalRuntimeExecutionTarget
): boolean {
  if (target.status !== "partial" && target.status !== "not_ready") {
    return false;
  }

  let hasCheckFailure = false;
  for (const capability of resolveEnabledExecutionTargetCapabilities(
    target.capabilities
  )) {
    if (capability.status === "ready") {
      continue;
    }

    if (
      capability.status !== "not_ready" ||
      capability.reasonCodes.length === 0 ||
      capability.reasonCodes.some(
        (reasonCode) => reasonCode !== "controller.interface.check_failed"
      )
    ) {
      return false;
    }
    hasCheckFailure = true;
  }

  return hasCheckFailure;
}

function isRegistryFreshnessBlocker(
  primaryBlocker: CurrentLocalRuntimeReplyReadinessResponse["primaryBlocker"]
): boolean {
  return (
    primaryBlocker === "agent_controller_report_stale" ||
    primaryBlocker === "agent_controller_report_unknown"
  );
}

function buildCurrentRuntimeEvidence(input: {
  computer: LocalRuntimeComputer | null;
  target: LocalRuntimeExecutionTarget | null;
}): CurrentLocalRuntimeReplyReadinessResponse["runtime"] {
  return {
    deviceDisplayName: input.computer?.deviceDisplayName ?? null,
    deviceId: input.target?.deviceId ?? input.computer?.deviceId ?? null,
    executionTargetStatus: input.target?.status ?? null,
    lastObservedAtMs: input.target?.lastObservedAtMs ?? null,
    reasonCodes: input.target?.reasonCodes ?? [],
    signInOnlyBlockers: hasOnlyControllerSignInBlockers(input.target),
    openMeldServiceRuntimeId: input.target?.openMeldServiceRuntimeId ?? null,
    runtimeLane: input.target?.runtimeLane ?? null,
  };
}

function buildCurrentLocalRuntimeReplyReadiness(input: {
  currentTarget: CurrentLocalRuntimeReplyReadinessResponse["currentTarget"];
  generatedAt: string;
  localComponents?: CurrentLocalRuntimeReplyReadinessResponse["localComponents"];
  localComponentsStatus?: LocalComponentsStatus | null;
  message: string;
  nextAction: CurrentLocalRuntimeReplyReadinessResponse["nextAction"];
  primaryBlocker: CurrentLocalRuntimeReplyReadinessResponse["primaryBlocker"];
  runtime: CurrentLocalRuntimeReplyReadinessResponse["runtime"] | null;
  service: CurrentLocalRuntimeReplyReadinessResponse["service"] | null;
  serviceVersion?: string | null;
  status: CurrentLocalRuntimeReplyReadinessResponse["status"];
}): CurrentLocalRuntimeReplyReadinessResponse {
  const localComponents =
    input.localComponents ??
    resolveLocalComponentUpdateProjection({
      generatedAt: input.generatedAt,
      localComponentsStatus: input.localComponentsStatus ?? null,
      serviceConnected:
        input.service?.connected === true &&
        input.service.matchingCurrentRuntime === true,
      serviceVersion: input.serviceVersion ?? null,
    });
  return {
    canReplyFromThisComputer:
      input.status === "ready" && !localComponents.service.wakeBlocked,
    currentTarget: input.currentTarget,
    generatedAt: input.generatedAt,
    localComponents,
    message: input.message,
    nextAction: input.nextAction,
    primaryBlocker: input.primaryBlocker,
    runtime: input.runtime ?? {
      deviceDisplayName: null,
      deviceId: null,
      executionTargetStatus: null,
      lastObservedAtMs: null,
      reasonCodes: [],
      signInOnlyBlockers: false,
      openMeldServiceRuntimeId: null,
      runtimeLane: null,
    },
    service: input.service ?? {
      connected: false,
      executionCompatibility: null,
      matchingCurrentRuntime: false,
      reasonCodes: [],
      sessionDeviceId: null,
      sessionLane: null,
    },
    status: input.status,
  };
}

function hasOnlyControllerSignInBlockers(
  target: LocalRuntimeExecutionTarget | null
): boolean {
  if (!target) {
    return false;
  }
  const blockers = resolveEnabledExecutionTargetCapabilities(
    target.capabilities
  ).filter((capability) => capability.status !== "ready");
  return (
    blockers.length > 0 &&
    blockers.every(
      (capability) =>
        capability.status === "not_ready" &&
        capability.reasonCodes.length > 0 &&
        hasOnlyAgentControllerSignInReasonCodes(capability.reasonCodes)
    )
  );
}

function buildLocalRuntimeComputer(input: {
  device: OwnedDeviceRecord;
  currentDeviceId: string | null;
  currentRuntimeLane: DaemonServiceLane | null;
  executionTargets: readonly OwnedDeviceExecutionTargetRecord[];
  computerFileAccessByDeviceLane: ComputerFileAccessByDeviceLane;
  localFolderPickerByDeviceLane: LocalFolderPickerByDeviceLane;
  localAgentControlByDeviceLane: LocalAgentControlByDeviceLane;
  localProjectControlByDeviceLane: LocalProjectControlByDeviceLane;
}): LocalRuntimeComputer {
  const isCurrent = input.currentDeviceId === input.device.deviceId;
  const executionTargets = buildLocalRuntimeExecutionTargets({
    currentDeviceId: input.currentDeviceId,
    currentRuntimeLane: input.currentRuntimeLane,
    localAgentControlByDeviceLane: input.localAgentControlByDeviceLane,
    localProjectControlByDeviceLane: input.localProjectControlByDeviceLane,
    targets: input.executionTargets,
  });
  const displayName = resolveDeviceDisplayName({
    device: input.device,
    isCurrent,
  });
  const computerFileAccess =
    isCurrent && input.currentRuntimeLane
      ? input.computerFileAccessByDeviceLane.get(
          buildDeviceLaneKey({
            deviceId: input.device.deviceId,
            runtimeLane: input.currentRuntimeLane,
          })
        )
      : undefined;
  const localFolderPicker =
    isCurrent && input.currentRuntimeLane
      ? input.localFolderPickerByDeviceLane.get(
          buildDeviceLaneKey({
            deviceId: input.device.deviceId,
            runtimeLane: input.currentRuntimeLane,
          })
        )
      : undefined;

  return {
    ...(computerFileAccess ? { computerFileAccess } : {}),
    ...(localFolderPicker ? { localFolderPicker } : {}),
    deviceId: input.device.deviceId,
    deviceDisplayName: displayName.value,
    deviceDisplayNameSource: displayName.source,
    platformFamily: input.device.platformFamily ?? "Unknown",
    osVersion: input.device.osVersion ?? null,
    deviceType: input.device.deviceType ?? "unknown",
    firstSeenAtMs: input.device.firstSeenAtMs,
    lastObservedAtMs: input.device.lastObservedAtMs,
    isCurrent,
    executionTargets,
  };
}

// "Last seen" must reflect the live heartbeat fact, not the slower D1
// evidence projection: the registry row only advances when the local service
// submits capability reports, while RuntimeTransport sees a heartbeat every minute.
// The registry value stays as the fallback for devices with no live session.
async function overlayLiveHeartbeatObservations(input: {
  executionTargets: readonly {
    deviceId: string;
    runtimeLane: string;
    lastObservedAtMs: number | null;
  }[];
  lookupOwnerService:
    | ((input: {
        ownerUserId: string;
      }) => Promise<RuntimeTransportLookupOwnerServiceResponse>)
    | null;
  userId: string;
}): Promise<RuntimeTransportLookupOwnerServiceResponse | null> {
  if (!input.lookupOwnerService) {
    return null;
  }
  const ownerService = await input
    .lookupOwnerService({ ownerUserId: input.userId })
    .catch(() => null);
  if (ownerService?.online !== true) {
    return ownerService;
  }
  const heartbeatByDeviceLane = new Map<string, number>();
  for (const session of ownerService.sessions) {
    const key = `${session.deviceId}::${session.lane}`;
    const previous = heartbeatByDeviceLane.get(key) ?? 0;
    if (session.lastHeartbeatMs > previous) {
      heartbeatByDeviceLane.set(key, session.lastHeartbeatMs);
    }
  }
  for (const target of input.executionTargets) {
    const liveHeartbeatMs = heartbeatByDeviceLane.get(
      `${target.deviceId}::${target.runtimeLane}`
    );
    if (
      liveHeartbeatMs !== undefined &&
      liveHeartbeatMs > (target.lastObservedAtMs ?? 0)
    ) {
      (target as { lastObservedAtMs: number | null }).lastObservedAtMs =
        liveHeartbeatMs;
    }
  }
  return ownerService;
}

function buildLocalAgentControlByDeviceLane(
  ownerService: RuntimeTransportLookupOwnerServiceResponse | null
): LocalAgentControlByDeviceLane {
  const controls = new Map<
    string,
    LocalRuntimeExecutionTarget["localAgentControl"]
  >();
  if (ownerService?.online !== true) {
    return controls;
  }
  for (const session of selectCurrentOwnerServiceSessionsByDeviceLane(
    ownerService
  )) {
    const key = buildDeviceLaneKey({
      deviceId: session.deviceId,
      runtimeLane: session.lane,
    });
    const setEnabled =
      session.executionCompatibility.status === "compatible" &&
      session.capabilities.localAgentControl?.setEnabled === true;
    const manageInstallations =
      session.executionCompatibility.status === "compatible" &&
      session.capabilities.localAgentControl?.manageInstallations === true;
    const refreshCatalog =
      session.executionCompatibility.status === "compatible" &&
      session.capabilities.localAgentControl?.refreshCatalog === true;
    const setProfileWorkspace =
      session.executionCompatibility.status === "compatible" &&
      session.capabilities.localAgentControl?.setProfileWorkspace === true;
    controls.set(key, {
      ...(manageInstallations ? { manageInstallations: true } : {}),
      refreshCatalog,
      setEnabled,
      setProfileWorkspace,
    });
  }
  return controls;
}

function buildLocalProjectControlByDeviceLane(
  ownerService: RuntimeTransportLookupOwnerServiceResponse | null
): LocalProjectControlByDeviceLane {
  const controls = new Map<
    string,
    NonNullable<LocalRuntimeExecutionTarget["localProjectControl"]>
  >();
  if (ownerService?.online !== true) {
    return controls;
  }
  for (const session of selectCurrentOwnerServiceSessionsByDeviceLane(
    ownerService
  )) {
    const key = buildDeviceLaneKey({
      deviceId: session.deviceId,
      runtimeLane: session.lane,
    });
    const compatible = session.executionCompatibility.status === "compatible";
    const capabilities = session.capabilities.localProjectControl;
    controls.set(key, {
      connectCandidate: compatible && capabilities?.connectCandidate === true,
      connectDeclaredPath:
        compatible && capabilities?.connectDeclaredPath === true,
      discoverProjects: compatible && capabilities?.discoverProjects === true,
      moveConnection: compatible && capabilities?.moveConnection === true,
      removeConnection: compatible && capabilities?.removeConnection === true,
      removeMissingConnections:
        compatible && capabilities?.removeMissingConnections === true,
      setDefaultConnection:
        compatible && capabilities?.setDefaultConnection === true,
    });
  }
  return controls;
}

function buildComputerFileAccessByDeviceLane(
  ownerService: RuntimeTransportLookupOwnerServiceResponse | null
): ComputerFileAccessByDeviceLane {
  const controls = new Map<
    string,
    NonNullable<LocalRuntimeComputer["computerFileAccess"]>
  >();
  if (ownerService?.online !== true) {
    return controls;
  }
  for (const session of selectCurrentOwnerServiceSessionsByDeviceLane(
    ownerService
  )) {
    if (
      session.executionCompatibility.status !== "compatible" ||
      session.capabilities.computerFileAccess?.readPolicy !== true ||
      session.capabilities.computerFileAccess.updatePolicy !== true
    ) {
      continue;
    }
    controls.set(
      buildDeviceLaneKey({
        deviceId: session.deviceId,
        runtimeLane: session.lane,
      }),
      { readPolicy: true, updatePolicy: true }
    );
  }
  return controls;
}

function buildLocalFolderPickerByDeviceLane(
  ownerService: RuntimeTransportLookupOwnerServiceResponse | null
): LocalFolderPickerByDeviceLane {
  const controls = new Map<
    string,
    NonNullable<LocalRuntimeComputer["localFolderPicker"]>
  >();
  if (ownerService?.online !== true) {
    return controls;
  }
  for (const session of selectCurrentOwnerServiceSessionsByDeviceLane(
    ownerService
  )) {
    if (
      session.executionCompatibility.status !== "compatible" ||
      session.capabilities.localFolderPicker?.selectFolders !== true
    ) {
      continue;
    }
    controls.set(
      buildDeviceLaneKey({
        deviceId: session.deviceId,
        runtimeLane: session.lane,
      }),
      { selectFolders: true }
    );
  }
  return controls;
}

function buildDeviceLaneKey(input: {
  deviceId: string;
  runtimeLane: string;
}): string {
  return `${input.deviceId}::${input.runtimeLane}`;
}

function groupConnectedComputerDevices(
  devices: readonly OwnedDeviceRecord[]
): OwnedDeviceRecord[][] {
  const groupsByConnectedComputerId = new Map<string, OwnedDeviceRecord[]>();
  for (const device of devices) {
    if (!device.connectedComputerId) {
      continue;
    }
    const group = groupsByConnectedComputerId.get(device.connectedComputerId);
    if (group) {
      group.push(device);
    } else {
      groupsByConnectedComputerId.set(device.connectedComputerId, [device]);
    }
  }

  return [...groupsByConnectedComputerId.values()];
}

function buildConnectedLocalRuntimeComputer(input: {
  devices: readonly OwnedDeviceRecord[];
  currentDeviceId: string | null;
  currentRuntimeLane: DaemonServiceLane | null;
  executionTargets: readonly OwnedDeviceExecutionTargetRecord[];
  computerFileAccessByDeviceLane: ComputerFileAccessByDeviceLane;
  localFolderPickerByDeviceLane: LocalFolderPickerByDeviceLane;
  localAgentControlByDeviceLane: LocalAgentControlByDeviceLane;
  localProjectControlByDeviceLane: LocalProjectControlByDeviceLane;
}): LocalRuntimeComputer {
  const primaryDevice = resolvePrimaryConnectedComputerDevice({
    currentDeviceId: input.currentDeviceId,
    devices: input.devices,
  });
  const computer = buildLocalRuntimeComputer({
    currentDeviceId: input.currentDeviceId,
    currentRuntimeLane: input.currentRuntimeLane,
    device: primaryDevice,
    executionTargets: input.executionTargets,
    computerFileAccessByDeviceLane: input.computerFileAccessByDeviceLane,
    localFolderPickerByDeviceLane: input.localFolderPickerByDeviceLane,
    localAgentControlByDeviceLane: input.localAgentControlByDeviceLane,
    localProjectControlByDeviceLane: input.localProjectControlByDeviceLane,
  });

  return {
    ...computer,
    connectedComputerId: primaryDevice.connectedComputerId ?? undefined,
    connectionStatus: "connected",
    legacyDeviceIds: input.devices.map((device) => device.deviceId).sort(),
  };
}

function buildLegacyDeviceEvidence(input: {
  device: OwnedDeviceRecord;
  currentDeviceId: string | null;
  currentRuntimeLane: DaemonServiceLane | null;
  executionTargets: readonly OwnedDeviceExecutionTargetRecord[];
  computerFileAccessByDeviceLane: ComputerFileAccessByDeviceLane;
  localFolderPickerByDeviceLane: LocalFolderPickerByDeviceLane;
  localAgentControlByDeviceLane: LocalAgentControlByDeviceLane;
  localProjectControlByDeviceLane: LocalProjectControlByDeviceLane;
}): NonNullable<LocalRuntimesResponse["legacyDeviceEvidence"]>[number] {
  const computer = buildLocalRuntimeComputer({
    currentDeviceId: input.currentDeviceId,
    currentRuntimeLane: input.currentRuntimeLane,
    device: input.device,
    executionTargets: input.executionTargets,
    computerFileAccessByDeviceLane: input.computerFileAccessByDeviceLane,
    localFolderPickerByDeviceLane: input.localFolderPickerByDeviceLane,
    localAgentControlByDeviceLane: input.localAgentControlByDeviceLane,
    localProjectControlByDeviceLane: input.localProjectControlByDeviceLane,
  });

  return {
    connectionStatus: "legacy_disconnected",
    deviceId: computer.deviceId,
    deviceDisplayName: computer.deviceDisplayName,
    deviceDisplayNameSource: computer.deviceDisplayNameSource,
    platformFamily: computer.platformFamily,
    osVersion: computer.osVersion,
    deviceType: computer.deviceType,
    firstSeenAtMs: computer.firstSeenAtMs,
    lastObservedAtMs: computer.lastObservedAtMs,
    executionTargets: computer.executionTargets,
  };
}

function resolveConnectedLocalRuntimeRouteMatchPriority(input: {
  computer: LocalRuntimeComputer;
  deviceId: string;
  runtimeLane: DaemonServiceLane;
}): number | null {
  if (
    input.computer.executionTargets.some(
      (target) =>
        target.deviceId === input.deviceId &&
        target.runtimeLane === input.runtimeLane
    )
  ) {
    return 0;
  }
  if (input.computer.deviceId === input.deviceId) {
    return 1;
  }
  if (input.computer.legacyDeviceIds?.includes(input.deviceId)) {
    return 2;
  }
  return null;
}

function hasUserVisibleConnectedComputerDisplay(
  computer: LocalRuntimeComputer
): boolean {
  return (
    Boolean(computer.connectedComputerId) &&
    computer.connectionStatus === "connected" &&
    (computer.deviceDisplayNameSource === "user" ||
      computer.deviceDisplayNameSource === "observed")
  );
}

function resolvePrimaryConnectedComputerDevice(input: {
  devices: readonly OwnedDeviceRecord[];
  currentDeviceId: string | null;
}): OwnedDeviceRecord {
  const currentDevice = input.devices.find(
    (device) => device.deviceId === input.currentDeviceId
  );
  if (currentDevice) {
    return currentDevice;
  }

  const [firstDevice] = [...input.devices].sort((left, right) => {
    const leftObservedAt = left.lastObservedAtMs ?? left.firstSeenAtMs;
    const rightObservedAt = right.lastObservedAtMs ?? right.firstSeenAtMs;
    return (
      rightObservedAt - leftObservedAt ||
      left.deviceId.localeCompare(right.deviceId)
    );
  });
  if (!firstDevice) {
    throw new Error("connected computer projection has no device evidence");
  }
  return firstDevice;
}

function resolveDeviceDisplayName(input: {
  device: OwnedDeviceRecord;
  isCurrent: boolean;
}): {
  source: LocalRuntimeComputer["deviceDisplayNameSource"];
  value: string;
} {
  const userDisplayName = input.device.userDisplayName?.trim();
  if (userDisplayName) {
    return {
      source: "user",
      value: userDisplayName,
    };
  }

  const observedDisplayName = input.device.observedDisplayName?.trim();
  if (observedDisplayName) {
    return {
      source: "observed",
      value: observedDisplayName,
    };
  }

  return {
    source: "placeholder",
    value: input.isCurrent ? "This computer" : "Unnamed computer",
  };
}

function buildLocalRuntimeExecutionTargets(input: {
  currentDeviceId: string | null;
  currentRuntimeLane: DaemonServiceLane | null;
  localAgentControlByDeviceLane: LocalAgentControlByDeviceLane;
  localProjectControlByDeviceLane: LocalProjectControlByDeviceLane;
  targets: readonly OwnedDeviceExecutionTargetRecord[];
}): LocalRuntimeExecutionTarget[] {
  const grouped = new Map<
    string,
    {
      capabilities: LocalRuntimeExecutionTarget["capabilities"];
      deviceId: string;
      lastObservedAtMs: number | null;
      openMeldServiceRuntimeId: string;
      runtimeLane: DaemonServiceLane;
    }
  >();

  for (const target of input.targets) {
    const key = `${target.deviceId}\u0000${target.runtimeLane}\u0000${target.openMeldServiceRuntimeId}`;
    const existing = grouped.get(key) ?? {
      capabilities: [],
      deviceId: target.deviceId,
      lastObservedAtMs: target.lastObservedAtMs,
      openMeldServiceRuntimeId: target.openMeldServiceRuntimeId,
      runtimeLane: target.runtimeLane,
    };
    if (target.agentControllerRef) {
      existing.capabilities.push({
        agentControllerRef: target.agentControllerRef,
        agentControllerInterface: target.agentControllerInterface ?? null,
        enabled: target.capabilityEnabled,
        reasonCodes: [...target.capabilityReasonCodes],
        status: target.capabilityStatus,
      });
    }
    existing.lastObservedAtMs = maxNullableTimestamp(
      existing.lastObservedAtMs,
      target.lastObservedAtMs
    );
    grouped.set(key, existing);
  }

  return [...grouped.values()]
    .map((target) => {
      const reasonCodes = resolveExecutionTargetReasonCodes(
        target.capabilities
      );
      const status = resolveExecutionTargetStatus(target.capabilities);
      const deviceLaneKey = buildDeviceLaneKey({
        deviceId: target.deviceId,
        runtimeLane: target.runtimeLane,
      });
      const localProjectControl =
        input.localProjectControlByDeviceLane.get(deviceLaneKey);
      return {
        capabilities: target.capabilities,
        deviceId: target.deviceId,
        isCurrent:
          target.deviceId === input.currentDeviceId &&
          target.runtimeLane === input.currentRuntimeLane,
        lastObservedAtMs: target.lastObservedAtMs,
        localAgentControl: input.localAgentControlByDeviceLane.get(
          deviceLaneKey
        ) ?? {
          refreshCatalog: false,
          setEnabled: false,
          setProfileWorkspace: false,
        },
        ...(localProjectControl ? { localProjectControl } : {}),
        localAgentCatalog: projectLocalAgentCatalogFromCapabilities({
          capabilities: target.capabilities,
        }),
        reasonCodes,
        openMeldServiceRuntimeId: {
          source: "runtime_registry_authority" as const,
          value: target.openMeldServiceRuntimeId,
        },
        runtimeLane: target.runtimeLane,
        status,
        userFacingCommand: resolveUserFacingCommand(target.runtimeLane),
      };
    })
    .sort((left, right) =>
      left.runtimeLane === right.runtimeLane
        ? left.openMeldServiceRuntimeId.value.localeCompare(
            right.openMeldServiceRuntimeId.value
          )
        : left.runtimeLane.localeCompare(right.runtimeLane)
    );
}

function resolveExecutionTargetStatus(
  capabilities: readonly LocalRuntimeExecutionTarget["capabilities"][number][]
): LocalRuntimeExecutionTarget["status"] {
  if (capabilities.length === 0) {
    return "unknown";
  }
  const enabledCapabilities =
    resolveEnabledExecutionTargetCapabilities(capabilities);
  if (enabledCapabilities.length === 0) {
    return "not_ready";
  }
  const readyCount = enabledCapabilities.filter(
    (capability) => capability.status === "ready"
  ).length;
  if (readyCount === enabledCapabilities.length) {
    return "ready";
  }
  if (readyCount > 0) {
    return "partial";
  }
  if (enabledCapabilities.some((capability) => capability.status === "stale")) {
    return "stale";
  }
  if (
    enabledCapabilities.some((capability) => capability.status === "not_ready")
  ) {
    return "not_ready";
  }
  return "unknown";
}

function resolveExecutionTargetReasonCodes(
  capabilities: readonly LocalRuntimeExecutionTarget["capabilities"][number][]
): string[] {
  if (capabilities.length === 0) {
    return ["runtime.agent_controller_report_missing"];
  }

  const enabledCapabilities =
    resolveEnabledExecutionTargetCapabilities(capabilities);
  if (enabledCapabilities.length === 0) {
    return ["local_agent_preparation.not_enabled"];
  }
  const reasonCodes = enabledCapabilities.flatMap(
    (capability) => capability.reasonCodes
  );
  return [...new Set(reasonCodes)];
}

function resolveEnabledExecutionTargetCapabilities(
  capabilities: readonly LocalRuntimeExecutionTarget["capabilities"][number][]
): readonly LocalRuntimeExecutionTarget["capabilities"][number][] {
  return capabilities.filter((capability) => capability.enabled);
}

function resolveUserFacingCommand(
  runtimeLane: DaemonServiceLane
): LocalRuntimeExecutionTarget["userFacingCommand"] {
  if (runtimeLane === "dev-local") {
    return "openmeld-dev";
  }
  if (runtimeLane === "canary") {
    return "openmeld-canary";
  }
  return "openmeld";
}

function maxNullableTimestamp(
  left: number | null,
  right: number | null
): number | null {
  if (left === null) {
    return right;
  }
  if (right === null) {
    return left;
  }
  return Math.max(left, right);
}
