import { projectOrganizationComputerLocalAgentDetails } from "@openmeld/schemas";
import type {
  DaemonExecutionCompatibility,
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
  organizationId: string;
}): Promise<OrganizationComputersResponse> {
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
        input.includeUsageLimits
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
  includeUsageLimits: boolean
): OrganizationComputerRecord["localAgents"] {
  const byRef = new Map<
    string,
    OrganizationComputerRecord["localAgents"][number]
  >();
  for (const target of targets) {
    if (!target.agentControllerRef) {
      continue;
    }
    const details = projectTeamSafeLocalAgentDetails(
      target,
      includeUsageLimits
    );
    const candidate: OrganizationComputerRecord["localAgents"][number] = {
      agentControllerRef: target.agentControllerRef,
      ...(details ? { details } : {}),
      enabled: target.capabilityEnabled,
      status: target.capabilityStatus,
    };
    const existing = byRef.get(target.agentControllerRef);
    if (!existing || compareLocalAgentEvidence(candidate, existing) > 0) {
      byRef.set(target.agentControllerRef, candidate);
    }
  }
  return [...byRef.values()].sort((left, right) =>
    left.agentControllerRef.localeCompare(right.agentControllerRef)
  );
}

function projectTeamSafeLocalAgentDetails(
  target: OwnedDeviceExecutionTargetRecord,
  includeUsageLimits: boolean
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
  const details = projectOrganizationComputerLocalAgentDetails(snapshot);
  if (includeUsageLimits) {
    return details;
  }
  const { usageLimits: _usageLimits, ...legacyDetails } = details;
  return legacyDetails;
}

function compareLocalAgentEvidence(
  left: OrganizationComputerRecord["localAgents"][number],
  right: OrganizationComputerRecord["localAgents"][number]
): number {
  const rank = { unknown: 0, stale: 1, not_ready: 2, ready: 3 } as const;
  return (
    Number(left.enabled) - Number(right.enabled) ||
    rank[left.status] - rank[right.status] ||
    Number(Boolean(left.details)) - Number(Boolean(right.details)) ||
    readAgentDetailsCheckedAtMs(left) - readAgentDetailsCheckedAtMs(right)
  );
}

function readAgentDetailsCheckedAtMs(
  agent: OrganizationComputerRecord["localAgents"][number]
): number {
  const checkedAtMs = agent.details
    ? Date.parse(agent.details.checkedAt)
    : Number.NaN;
  return Number.isFinite(checkedAtMs) ? checkedAtMs : 0;
}
