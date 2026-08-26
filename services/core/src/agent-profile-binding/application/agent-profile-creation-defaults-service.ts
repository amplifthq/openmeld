import type { AgentProfileCreationPreferenceSelection } from "@openmeld/schemas/types";
import { readProjectRecord } from "../../projects/project-repository";
import { createCoreRpcHttpError } from "../../rpc/errors";
import {
  type AgentProfileCreationDefaultsRecord,
  upsertAgentProfileCreationDefaultsRecord,
} from "../infrastructure/d1/agent-profile-creation-defaults-repo";

export async function rememberAgentProfileCreationDefaults(input: {
  agentControllerRef: string;
  db: D1Database;
  nowMs: number;
  organizationId: string;
  selection: AgentProfileCreationPreferenceSelection;
  userId: string;
}): Promise<AgentProfileCreationDefaultsRecord> {
  if (input.selection.defaultProjectId) {
    const project = await readProjectRecord({
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
