import type { PostgresDatabase } from "@openmeld/db/postgresql";
import type {
  ListRoutineManagementResponse,
  RoutineExecutorKind,
} from "@openmeld/schemas/types";
import { readPrimaryAgentProfileBindingRecord } from "../agent-profile-binding/infrastructure/postgresql/agent-profile-binding-repo";
import { readCenterAgentDesignationRecord } from "../center-agent/center-agent-repository";
import { isPersonalRemoteAgentBinding } from "../remote-agent/application/personal-remote-agent-binding";
import { createCoreRpcHttpError } from "../rpc/errors";

export async function requireRoutineExecutor(input: {
  db: PostgresDatabase;
  organizationId: string;
  userId: string;
  agentProfileId?: string | null;
}): Promise<{
  agentProfileId: string;
  kind: RoutineExecutorKind;
  name: string;
}> {
  const designation = input.agentProfileId
    ? null
    : await readCenterAgentDesignationRecord(input);
  const profileId = input.agentProfileId ?? designation?.agentProfileId;
  const profile = profileId
    ? (
        await input.db.query<{
          profile_name: string;
          owner_user_id: string | null;
          managed_role: string | null;
        }>({
          text: `SELECT profile_name, owner_user_id, managed_role FROM openmeld.openmeld_profiles
      WHERE profile_id = $1 AND organization_id = $2 AND profile_kind = 'agent' AND status = 'active'`,
          values: [profileId, input.organizationId],
        })
      ).rows[0]
    : null;
  if (!(profile && profileId)) {
    throw unavailable();
  }
  if (!input.agentProfileId && profile.managed_role === "center_agent") {
    return {
      agentProfileId: profileId,
      kind: "center_agent",
      name: profile.profile_name,
    };
  }
  if (profile.managed_role !== null || profile.owner_user_id !== input.userId) {
    throw unavailable();
  }
  const binding = await readPrimaryAgentProfileBindingRecord({
    db: input.db,
    agentProfileId: profileId,
    owner: { kind: "owner_account", id: input.userId },
  });
  if (!binding || binding.bindingState !== "enabled_primary") {
    throw unavailable();
  }
  let kind: RoutineExecutorKind | null = null;
  if (isPersonalRemoteAgentBinding(binding)) {
    kind = "remote_agent";
  } else if (binding.runtimeKind === "openmeld_service") {
    kind = "local_agent";
  }
  if (!kind) {
    throw unavailable();
  }
  return { agentProfileId: profileId, kind, name: profile.profile_name };
}

export async function listRoutineExecutors(input: {
  db: PostgresDatabase;
  organizationId: string;
  userId: string;
}): Promise<ListRoutineManagementResponse["executors"]> {
  const profiles = await input.db.query<{ profile_id: string }>({
    text: `SELECT profile_id FROM openmeld.openmeld_profiles WHERE organization_id = $1
      AND owner_user_id = $2 AND profile_kind = 'agent' AND managed_role IS NULL AND status = 'active'
      ORDER BY profile_name, profile_id`,
    values: [input.organizationId, input.userId],
  });
  const result: ListRoutineManagementResponse["executors"] = [];
  const ids: (string | null)[] = [
    null,
    ...profiles.rows.map((row) => row.profile_id),
  ];
  for (const agentProfileId of ids) {
    try {
      const executor = await requireRoutineExecutor({
        ...input,
        agentProfileId,
      });
      result.push({ ...executor, agentProfileId });
    } catch (error) {
      if (
        !(
          error instanceof Error &&
          "code" in error &&
          error.code === "routine.executor_unavailable"
        )
      ) {
        throw error;
      }
    }
  }
  return result;
}

function unavailable() {
  return createCoreRpcHttpError({
    status: 403,
    code: "routine.executor_unavailable",
    reason: "Choose an available Agent you own or the Center Agent.",
  });
}
