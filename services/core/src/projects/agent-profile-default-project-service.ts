import { updateAgentProfileDefaultProjectResponseSchema } from "@openmeld/schemas";
import type { UpdateAgentProfileDefaultProjectResponse } from "@openmeld/schemas/types";
import { readPrimaryAgentProfileBindingRecord } from "../agent-profile-binding/infrastructure/d1/agent-profile-binding-repo";
import {
  acquireRuntimeTransportAgentProfileFutureWorkSettingsMutation,
  releaseRuntimeTransportAgentProfileExecutionTargetMutation,
} from "../dispatch/infrastructure/runtime-transport/runtime-transport-client";
import { type CoreBindings, localStateDb } from "../lib/bindings";
import { createCoreRpcHttpError } from "../rpc/errors";
import { callRequiredAuthWorkerRpc } from "../rpc/required-auth-worker-rpc";
import type { ProjectAuthority } from "./project-authority";
import type { ProjectService } from "./project-service";

export async function updateAgentProfileDefaultProjectForAuthority(input: {
  agentProfileId: string;
  authority: ProjectAuthority;
  defaultProjectId: string | null;
  env: CoreBindings;
  service: ProjectService;
}): Promise<UpdateAgentProfileDefaultProjectResponse> {
  if (input.defaultProjectId) {
    const selectedProject = await input.service.read(
      input.authority,
      input.defaultProjectId
    );
    if (selectedProject.archivedAtMs !== null) {
      throw createCoreRpcHttpError({
        code: "project.not_found",
        reason: "The selected Project is unavailable in this Organization.",
        status: 404,
      });
    }
  }

  const db = localStateDb(input.env);
  if (!db) {
    throw createCoreRpcHttpError({
      code: "profile.default_project_unavailable",
      reason: "Agent Profile settings are unavailable.",
      status: 503,
    });
  }
  const operationId = `agent-profile-future-work-settings-mutation:${crypto.randomUUID()}`;
  const admission =
    await acquireRuntimeTransportAgentProfileFutureWorkSettingsMutation({
      env: input.env,
      operationId,
      ownerUserId: input.authority.userId,
      targetProfileId: input.agentProfileId,
    });
  if (admission.status !== "acquired") {
    throw createCoreRpcHttpError({
      code: "profile.default_project_unavailable",
      reason:
        "OpenMeld couldn’t safely save this Default Project yet. Try again.",
      status: admission.status === "blocked" ? 409 : 503,
    });
  }

  try {
    const binding = await readPrimaryAgentProfileBindingRecord({
      agentProfileId: input.agentProfileId,
      db,
      owner: { id: input.authority.userId, kind: "owner_account" },
    });
    if (binding?.runtimeKind === "hosted_center_agent") {
      throw createCoreRpcHttpError({
        code: "profile.default_project_not_supported",
        reason: "Default Project is only available for local Agent Profiles.",
        status: 409,
      });
    }
    const updated = await callRequiredAuthWorkerRpc({
      authWorker: input.env.OPENMELD_AUTH_WORKER,
      call: (authWorker) =>
        authWorker.updateAgentProfileDefaultProjectInOrganization({
          defaultProjectId: input.defaultProjectId,
          organizationId: input.authority.organizationId,
          ownerUserId: input.authority.userId,
          profileId: input.agentProfileId,
        }),
      unavailable: {
        code: "profile.default_project_unavailable",
        reason: "Agent Profile settings are unavailable.",
      },
    });
    if (!updated.ok) {
      throw createCoreRpcHttpError({
        code: updated.code,
        reason: updated.message,
        status: updated.code === "profile.not_found" ? 404 : 409,
      });
    }
    const response = updateAgentProfileDefaultProjectResponseSchema.safeParse({
      ok: true,
      profile: updated.profile,
    });
    if (!response.success) {
      throw new Error(
        `invalid Agent Profile Default Project response: ${response.error.message}`
      );
    }
    return response.data;
  } finally {
    await releaseRuntimeTransportAgentProfileExecutionTargetMutation({
      env: input.env,
      operationId,
      ownerUserId: input.authority.userId,
      targetProfileId: input.agentProfileId,
    }).catch((error) => {
      console.warn(
        "[core.agent_profile.default_project_mutation_release_failed]",
        {
          agentProfileId: input.agentProfileId,
          error: error instanceof Error ? error.message : String(error),
          operationId,
          ownerUserId: input.authority.userId,
        }
      );
    });
  }
}
