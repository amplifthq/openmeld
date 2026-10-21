import {
  type ListMemberAgentsResponse,
  listMemberAgentsResponseSchema,
  type MemberAgent,
} from "@openmeld/schemas";
import type { RuntimeHarnessPresenceFact } from "../../member-agent/application/harness-presence-policy";
import type { RuntimeHarnessCatalogEntry } from "../../member-agent/infrastructure/postgresql/runtime-harness-presence-repo";

export const NOW_MS = 1_800_000_000_000;

export function catalogEntry(
  overrides: Partial<RuntimeHarnessCatalogEntry> & {
    agentControllerRef: string;
    openMeldServiceRuntimeId: string;
  }
): RuntimeHarnessCatalogEntry {
  return {
    deviceId: `device-${overrides.openMeldServiceRuntimeId}`,
    fact: null,
    lane: "prod",
    reasonCodes: [],
    reportAcceptedAtMs: NOW_MS - 1000,
    reportExpiresAtMs: NOW_MS + 600_000,
    reportObservedAtMs: NOW_MS - 1000,
    reportStatus: "ready",
    ...overrides,
  };
}

export function presentFact(
  overrides: Partial<RuntimeHarnessPresenceFact> = {}
): RuntimeHarnessPresenceFact {
  return {
    firstUndetectedAtMs: null,
    lastDetectedAtMs: NOW_MS - 60_000,
    undetectedReportCount: 0,
    ...overrides,
  };
}

export function memberAgent(
  overrides: Partial<MemberAgent> & Pick<MemberAgent, "harnessKind" | "id">
): MemberAgent {
  return {
    archivedAt: null,
    defaultProfileId: null,
    organizationId: "org-1",
    ownerUserId: "user-1",
    source: "detected",
    ...overrides,
  };
}

// Built through the shared schema the Auth listing RPC returns.
export function listing(
  memberAgents: (MemberAgent & {
    profiles?: ListMemberAgentsResponse["memberAgents"][number]["profiles"];
  })[]
): ListMemberAgentsResponse {
  return listMemberAgentsResponseSchema.parse({
    ok: true,
    organizationId: "org-1",
    memberAgents: memberAgents.map((agent) => ({
      ...agent,
      profiles:
        agent.profiles ??
        (agent.defaultProfileId
          ? [
              {
                openMeldProfileId: agent.defaultProfileId,
                profileName: "Claude Code",
                isDefault: true,
              },
            ]
          : []),
    })),
    unassignedProfiles: [],
  });
}
