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
  db: D1Database;
  profileCreationAttempt: number;
  requestId: string;
}): Promise<{ workspace: boolean; defaultProject: boolean }> {
  const row = await input.db
    .prepare(
      `SELECT created_agent_profile_id, profile_creation_attempt,
              workspace_configured_at, default_project_configured_at
         FROM agent_profile_creation_requests WHERE id = ? LIMIT 1`
    )
    .bind(input.requestId)
    .first<ProgressRow>();
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
  db: D1Database;
  profileCreationAttempt: number;
  requestId: string;
  step: AgentProfileCreationPostBindingStep;
}): Promise<void> {
  const column =
    input.step === "workspace"
      ? "workspace_configured_at"
      : "default_project_configured_at";
  const updated = await input.db
    .prepare(
      `UPDATE agent_profile_creation_requests
          SET ${column} = COALESCE(${column}, ?)
        WHERE id = ? AND created_agent_profile_id = ?
          AND profile_creation_attempt = ? AND status = 'approved'`
    )
    .bind(
      Date.now(),
      input.requestId,
      input.agentProfileId,
      input.profileCreationAttempt
    )
    .run();
  if (Number(updated.meta.changes ?? 0) !== 1) {
    throw new Error(
      "Agent Profile creation follow-up checkpoint was superseded."
    );
  }
}
