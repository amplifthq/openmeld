import {
  type AgentsEnableResult,
  runAgentsDisable,
  runAgentsEnable,
} from "../commands/agents";
import { collectLocalAgentControllerInventory } from "../local-service/inventory/agent-controller-inventory";
import type { StartReadinessSnapshot } from "./readiness-types";

export type StartLocalBuiltinAgentCandidate =
  StartReadinessSnapshot["agents"]["candidates"][number];

export async function listStartLocalBuiltinAgentCandidates(): Promise<
  StartLocalBuiltinAgentCandidate[]
> {
  const inventory = await collectLocalAgentControllerInventory();
  return inventory.capabilities.map((capability) => ({
    agentId: capability.agentId,
    displayName: capability.displayName,
    detected: capability.detected,
    enabled: capability.enabled,
    launchStatus: capability.launchStatus,
    lifecycleStatus: capability.lifecycleStatus,
    selectable: capability.selectable,
    selectableReason: capability.selectableReason,
  }));
}

export function collectStartLocalAgentsReadiness(): Promise<
  StartReadinessSnapshot["agents"]
> {
  return listStartLocalBuiltinAgentCandidates()
    .then((builtinCandidates) => ({
      status: "ok" as const,
      totalBuiltins: builtinCandidates.length,
      detectedSupported: builtinCandidates.filter(
        (candidate) => candidate.detected && candidate.launchStatus === "ready"
      ).length,
      needsChoice: builtinCandidates.filter(
        (candidate) =>
          candidate.detected && candidate.launchStatus === "needs_choice"
      ).length,
      needsRepair: builtinCandidates.filter(
        (candidate) =>
          candidate.detected && candidate.launchStatus === "needs_repair"
      ).length,
      detectedNotSupportedYet: builtinCandidates.filter(
        (candidate) =>
          candidate.detected &&
          candidate.launchStatus === "not_available" &&
          !candidate.selectable &&
          candidate.selectableReason === "not_supported_yet"
      ).length,
      notDetected: builtinCandidates.filter((candidate) => !candidate.detected)
        .length,
      candidates: builtinCandidates,
    }))
    .catch((error) => ({
      status: "unknown" as const,
      totalBuiltins: 0,
      detectedSupported: 0,
      needsChoice: 0,
      needsRepair: 0,
      detectedNotSupportedYet: 0,
      notDetected: 0,
      candidates: [],
      error:
        error instanceof Error && error.message.trim().length > 0
          ? error.message.trim()
          : "agents readiness unavailable",
    }));
}

export async function listStartLocalRunnableControllerIds(): Promise<string[]> {
  const candidates = await listStartLocalBuiltinAgentCandidates();
  return candidates
    .filter((candidate) => candidate.launchStatus === "ready")
    .map((candidate) => candidate.agentId)
    .sort((left, right) => left.localeCompare(right));
}

export async function runStartLocalAgentsEnable(input: {
  agent: string[];
  interactive?: boolean;
  install?: string;
  presentation?: "handoff" | "standalone";
  profile?: string;
  view?: string;
}): Promise<AgentsEnableResult> {
  return await runAgentsEnable(input);
}

export async function runStartLocalAgentsDisable(input: {
  agent: string[];
  profile?: string;
  view?: string;
}): Promise<void> {
  await runAgentsDisable(input);
}
