import { executionContextLegacyAssociationSchema } from "@openmeld/schemas";
import type { ExecutionContextLegacyAssociation } from "@openmeld/schemas/types";
import type { AgentProfileBindingRecord } from "../../agent-profile-binding/infrastructure/d1/agent-profile-binding-repo";

export type LegacyContextAssociation = ExecutionContextLegacyAssociation;

export type AgentProfileContextMigration = {
  status: "draining" | "contexts";
  boundaryAtMs: number;
  legacyWakeIds: string[];
  legacyAssociation: LegacyContextAssociation | null;
};

export function isAgentProfileContextMigration(
  value: unknown
): value is AgentProfileContextMigration | undefined {
  if (value === undefined) {
    return true;
  }
  if (!value || typeof value !== "object") {
    return false;
  }
  const record = value as Partial<AgentProfileContextMigration>;
  if (
    (record.status !== "draining" && record.status !== "contexts") ||
    !Number.isSafeInteger(record.boundaryAtMs) ||
    (record.boundaryAtMs as number) < 0 ||
    !Array.isArray(record.legacyWakeIds) ||
    record.legacyWakeIds.length > 128 ||
    !record.legacyWakeIds.every((id) => typeof id === "string" && id.length > 0)
  ) {
    return false;
  }
  if (record.status === "draining") {
    return record.legacyAssociation === null;
  }
  return executionContextLegacyAssociationSchema.safeParse(
    record.legacyAssociation
  ).success;
}

export function legacyContextAssociationFromBinding(
  binding: AgentProfileBindingRecord
): LegacyContextAssociation {
  return {
    id: `legacy-context:${binding.bindingId}`,
    bindingId: binding.bindingId,
    configurationRevision: binding.configurationRevision,
    agentControllerRef: binding.agentControllerRef,
    openMeldServiceRuntimeId: binding.openMeldServiceRuntimeId,
    nativeConversationId: binding.agentControllerConversationId ?? null,
    scope: "legacy_unclassified",
  };
}
