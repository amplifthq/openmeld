import { parseAgentControllerRef } from "@openmeld/agent-runtime";
import type { PostgresDatabase } from "@openmeld/db/postgresql";
import type {
  AgentProfileCreationPreferenceSelection,
  LocalComponentsReleaseManifest,
  ModelCatalog,
} from "@openmeld/schemas/types";
import { assertAgentControllerPermissionModeReleased } from "../../local-components/runtime-contract-rollout";
import { readProjectLifecycleRecord } from "../../projects/project-repository";
import { createCoreRpcHttpError } from "../../rpc/errors";
import {
  type AgentProfileCreationDefaultsRecord,
  upsertAgentProfileCreationDefaultsRecord,
} from "../infrastructure/postgresql/agent-profile-creation-defaults-repo";
export function resolveFirstUseAgentProfileCreationDefaults(input: {
  agentControllerRef: string;
  modelCatalog: ModelCatalog;
}): Pick<
  AgentProfileCreationPreferenceSelection,
  "modelId" | "reasoningLevel"
> {
  const parsedRef = parseAgentControllerRef(input.agentControllerRef);
  if (parsedRef?.kind !== "builtin") {
    return { modelId: null, reasoningLevel: null };
  }
  const controller = input.modelCatalog.agentControllers[parsedRef.id];
  const defaultModel = controller?.models.find(
    (model) =>
      model.id ===
        (controller.creationDefaults?.modelId ?? controller.defaultModelId) &&
      !model.unavailable
  );
  if (!defaultModel) {
    return { modelId: null, reasoningLevel: null };
  }
  const preferredReasoningLevel =
    controller?.creationDefaults?.reasoningLevel ?? null;
  const reasoningLevel =
    preferredReasoningLevel &&
    defaultModel.supportedReasoningLevels.includes(preferredReasoningLevel)
      ? preferredReasoningLevel
      : null;
  return { modelId: defaultModel.id, reasoningLevel };
}
export async function rememberAgentProfileCreationDefaults(input: {
  localComponentsManifest: LocalComponentsReleaseManifest | null;
  agentControllerRef: string;
  db: PostgresDatabase;
  nowMs: number;
  organizationId: string;
  selection: AgentProfileCreationPreferenceSelection;
  userId: string;
}): Promise<AgentProfileCreationDefaultsRecord> {
  assertAgentControllerPermissionModeReleased(
    input.selection.agentControllerPermissionMode,
    input.localComponentsManifest
  );
  if (input.selection.defaultProjectId) {
    const project = await readProjectLifecycleRecord({
      db: input.db,
      organizationId: input.organizationId,
      projectId: input.selection.defaultProjectId,
    });
    if (!project || project.archivedAtMs !== null) {
      throw createCoreRpcHttpError({
        code: "invalid_project",
        reason: "The selected Project is not active in this Organization.",
        status: 400,
      });
    }
  }
  return await upsertAgentProfileCreationDefaultsRecord({
    ...input.selection,
    agentControllerRef: input.agentControllerRef,
    db: input.db,
    nowMs: input.nowMs,
    organizationId: input.organizationId,
    userId: input.userId,
  });
}
