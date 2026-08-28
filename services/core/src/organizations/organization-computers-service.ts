import { projectOrganizationComputerLocalAgentDetails } from "@openmeld/schemas";
import type {
  DaemonExecutionCompatibility,
  ModelCatalog,
  OrganizationComputerRecord,
  OrganizationComputersResponse,
} from "@openmeld/schemas/types";
import type { OwnedDeviceExecutionTargetRecord } from "../runtime-registry/infrastructure/d1/runtime-registry-repo";
import type { OwnedDeviceRegistryRecord } from "../start/application/owned-device-registry-service";
import { resolveOrganizationMemberOpenMeldServiceState } from "./organization-member-openmeld-service-status";

const MEMBER_COMPUTER_LOOKUP_CONCURRENCY = 8;

export type OrganizationComputerLiveSession = {
  deviceId: string;
  executionCompatibility: DaemonExecutionCompatibility;
  openMeldTools?: OrganizationComputerRecord["openMeldTools"];
  serviceUpdateWakeBlocked: boolean;
};

export async function listOrganizationComputers(input: {
  generatedAt: string;
  includeUsageLimits?: boolean;
  lookupMemberComputerInventory: (input: { userId: string }) => Promise<{
    devices: readonly OwnedDeviceRegistryRecord[];
    executionTargets: readonly OwnedDeviceExecutionTargetRecord[];
    liveSessions: readonly OrganizationComputerLiveSession[] | null;
  }>;
  memberUserIds: readonly string[];
  modelCatalog: ModelCatalog;
  organizationId: string;
}): Promise<OrganizationComputersResponse> {
  const publicModelIdsByAgentControllerRef =
    buildPublicModelIdsByAgentControllerRef(input.modelCatalog);
  const computersByMember: OrganizationComputerRecord[][] = new Array(
    input.memberUserIds.length
  );
  let nextIndex = 0;

  const worker = async (): Promise<void> => {
    while (nextIndex < input.memberUserIds.length) {
      const index = nextIndex;
      nextIndex += 1;
      const userId = input.memberUserIds[index];
      if (!userId) {
        computersByMember[index] = [];
        continue;
      }
      const inventory = await input.lookupMemberComputerInventory({ userId });
      computersByMember[index] = projectMemberComputers({
        ...inventory,
        includeUsageLimits: input.includeUsageLimits === true,
        ownerUserId: userId,
        publicModelIdsByAgentControllerRef,
      });
    }
  };

  await Promise.all(
    Array.from(
      {
        length: Math.min(
          MEMBER_COMPUTER_LOOKUP_CONCURRENCY,
          input.memberUserIds.length
        ),
      },
      worker
    )
  );

  return {
    computers: computersByMember.flat(),
    generatedAt: input.generatedAt,
    organizationId: input.organizationId,
  };
}

function projectMemberComputers(input: {
  devices: readonly OwnedDeviceRegistryRecord[];
  executionTargets: readonly OwnedDeviceExecutionTargetRecord[];
  liveSessions: readonly OrganizationComputerLiveSession[] | null;
  includeUsageLimits: boolean;
  ownerUserId: string;
  publicModelIdsByAgentControllerRef: ReadonlyMap<string, ReadonlySet<string>>;
}): OrganizationComputerRecord[] {
  const targetsByDeviceId = new Map<
    string,
    OwnedDeviceExecutionTargetRecord[]
  >();
  for (const target of input.executionTargets) {
    const targets = targetsByDeviceId.get(target.deviceId) ?? [];
    targets.push(target);
    targetsByDeviceId.set(target.deviceId, targets);
  }

  return input.devices.map((device) => {
    const openMeldTools = resolveComputerOpenMeldTools({
      deviceId: device.deviceId,
      liveSessions: input.liveSessions,
    });
    return {
      computerId: device.deviceId,
      deviceDisplayName:
        device.userDisplayName ?? device.observedDisplayName ?? "Computer",
      deviceType: device.deviceType ?? "unknown",
      lastSeenAtMs: device.lastObservedAtMs,
      localAgents: projectTeamSafeLocalAgents(
        targetsByDeviceId.get(device.deviceId) ?? [],
        input.includeUsageLimits,
        input.publicModelIdsByAgentControllerRef
      ),
      ...(openMeldTools ? { openMeldTools } : {}),
      osVersion: device.osVersion,
      ownerUserId: input.ownerUserId,
      platformFamily: device.platformFamily ?? "Unknown",
      serviceState: resolveComputerServiceState({
        deviceId: device.deviceId,
        liveSessions: input.liveSessions,
      }),
    };
  });
}

function resolveComputerServiceState(input: {
  deviceId: string;
  liveSessions: readonly OrganizationComputerLiveSession[] | null;
}): OrganizationComputerRecord["serviceState"] {
  if (input.liveSessions === null) {
    return "unknown";
  }
  const matchingSessions = input.liveSessions.filter(
    (session) => session.deviceId === input.deviceId
  );
  return resolveOrganizationMemberOpenMeldServiceState({
    sessions: matchingSessions,
  });
}

function resolveComputerOpenMeldTools(input: {
  deviceId: string;
  liveSessions: readonly OrganizationComputerLiveSession[] | null;
}): OrganizationComputerRecord["openMeldTools"] {
  return input.liveSessions?.find(
    (session) =>
      session.deviceId === input.deviceId && session.openMeldTools != null
  )?.openMeldTools;
}

function projectTeamSafeLocalAgents(
  targets: readonly OwnedDeviceExecutionTargetRecord[],
  includeUsageLimits: boolean,
  publicModelIdsByAgentControllerRef: ReadonlyMap<string, ReadonlySet<string>>
): OrganizationComputerRecord["localAgents"] {
  const currentTargetByRef = new Map<
    string,
    OwnedDeviceExecutionTargetRecord
  >();
  for (const target of targets) {
    if (!target.agentControllerRef) {
      continue;
    }
    const existing = currentTargetByRef.get(target.agentControllerRef);
    if (!existing || compareExecutionTargetEvidence(target, existing) > 0) {
      currentTargetByRef.set(target.agentControllerRef, target);
    }
  }
  return [...currentTargetByRef.values()]
    .map((target) => {
      const details = projectTeamSafeLocalAgentDetails(
        target,
        includeUsageLimits,
        publicModelIdsByAgentControllerRef
      );
      return {
        agentControllerRef: target.agentControllerRef as string,
        ...(details ? { details } : {}),
        enabled: target.capabilityEnabled,
        status: target.capabilityStatus,
      };
    })
    .sort((left, right) =>
      left.agentControllerRef.localeCompare(right.agentControllerRef)
    );
}

function projectTeamSafeLocalAgentDetails(
  target: OwnedDeviceExecutionTargetRecord,
  includeUsageLimits: boolean,
  publicModelIdsByAgentControllerRef: ReadonlyMap<string, ReadonlySet<string>>
): NonNullable<
  OrganizationComputerRecord["localAgents"][number]["details"]
> | null {
  const snapshot = target.agentControllerInterface;
  if (
    !(snapshot && target.agentControllerRef) ||
    snapshot.agentControllerRef !== target.agentControllerRef
  ) {
    return null;
  }
  const publicModelIds =
    publicModelIdsByAgentControllerRef.get(target.agentControllerRef) ??
    new Set<string>();
  const details = {
    ...projectOrganizationComputerLocalAgentDetails(snapshot),
    models: snapshot.models.map((model) => ({
      displayName: model.displayName,
      ...(publicModelIds.has(model.id) ? { id: model.id } : {}),
    })),
  };
  if (includeUsageLimits) {
    return details;
  }
  const { usageLimits: _usageLimits, ...legacyDetails } = details;
  return legacyDetails;
}

function buildPublicModelIdsByAgentControllerRef(
  modelCatalog: ModelCatalog
): ReadonlyMap<string, ReadonlySet<string>> {
  return new Map(
    Object.entries(modelCatalog.agentControllers).map(
      ([agentControllerId, controller]) => [
        `builtin:${agentControllerId}`,
        new Set(controller.models.map((model) => model.id)),
      ]
    )
  );
}

function compareExecutionTargetEvidence(
  left: OwnedDeviceExecutionTargetRecord,
  right: OwnedDeviceExecutionTargetRecord
): number {
  const sameObservedTimeFailClosedRank = {
    ready: 0,
    unknown: 1,
    stale: 2,
    not_ready: 3,
  } as const;
  return (
    readExecutionTargetObservedAtMs(left) -
      readExecutionTargetObservedAtMs(right) ||
    sameObservedTimeFailClosedRank[left.capabilityStatus] -
      sameObservedTimeFailClosedRank[right.capabilityStatus] ||
    Number(Boolean(left.agentControllerInterface)) -
      Number(Boolean(right.agentControllerInterface)) ||
    buildExecutionTargetIdentity(left).localeCompare(
      buildExecutionTargetIdentity(right)
    )
  );
}

function readExecutionTargetObservedAtMs(
  target: OwnedDeviceExecutionTargetRecord
): number {
  return target.lastObservedAtMs ?? 0;
}

function buildExecutionTargetIdentity(
  target: OwnedDeviceExecutionTargetRecord
): string {
  return [
    target.deviceId,
    target.runtimeLane,
    target.openMeldServiceRuntimeId,
    target.agentControllerRef ?? "",
  ].join("\u0000");
}
