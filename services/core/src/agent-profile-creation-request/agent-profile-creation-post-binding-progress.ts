import type { PostgresDatabase } from "@openmeld/db/postgresql";
export type AgentProfileCreationPostBindingStep =
  | "workspace"
  | "defaultProject";
type ProgressRow = {
  created_agent_profile_id: string | null;
  default_project_configured_at: number | null;
  profile_creation_attempt: number;
  workspace_configured_at: number | null;
};
export async function readAgentProfileCreationPostBindingProgress(input: {
  agentProfileId: string;
  db: PostgresDatabase;
  profileCreationAttempt: number;
  requestId: string;
}): Promise<{
  workspace: boolean;
  defaultProject: boolean;
}> {
  const row = await input.db
    .query<ProgressRow>({
      text: `SELECT created_agent_profile_id, profile_creation_attempt,
              workspace_configured_at, default_project_configured_at
         FROM "openmeld"."agent_profile_creation_requests" WHERE id = $1 LIMIT 1`,
      values: [input.requestId],
    })
    .then((result) => result.rows[0] ?? null);
  if (
    !row ||
    row.created_agent_profile_id !== input.agentProfileId ||
    row.profile_creation_attempt !== input.profileCreationAttempt
  ) {
    throw new Error("Agent Profile creation follow-up ownership changed.");
  }
  const workspace = row.workspace_configured_at !== null;
  const defaultProject = row.default_project_configured_at !== null;
  if (defaultProject && !workspace) {
    throw new Error(
      "Agent Profile creation follow-up progress is inconsistent."
    );
  }
  return { workspace, defaultProject };
}
export async function checkpointAgentProfileCreationPostBindingStep(input: {
  agentProfileId: string;
  db: PostgresDatabase;
  profileCreationAttempt: number;
  requestId: string;
  step: AgentProfileCreationPostBindingStep;
}): Promise<void> {
  const column =
    input.step === "workspace"
      ? "workspace_configured_at"
      : "default_project_configured_at";
  const updated = await input.db.query({
    text: `UPDATE "openmeld"."agent_profile_creation_requests"
          SET ${column} = COALESCE(${column}, $1)
        WHERE id = $2 AND created_agent_profile_id = $3
          AND profile_creation_attempt = $4 AND status = 'approved'`,
    values: [
      Date.now(),
      input.requestId,
      input.agentProfileId,
      input.profileCreationAttempt,
    ],
  });
  if (Number(updated.rowCount ?? 0) !== 1) {
    throw new Error(
      "Agent Profile creation follow-up checkpoint was superseded."
    );
  }
}
