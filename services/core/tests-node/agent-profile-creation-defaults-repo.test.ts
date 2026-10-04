import { describe, expect, it, onTestFinished } from "vitest";
import {
  listAgentProfileCreationDefaultsRecords,
  readAgentProfileCreationDefaultsRecord,
  upsertAgentProfileCreationDefaultsRecord,
} from "../src/agent-profile-binding/infrastructure/postgresql/agent-profile-creation-defaults-repo";
import { createPostgresHarness } from "./helpers/postgresql-harness.test-support";

type CreationDefaultsRow = {
  agent_controller_collaboration_mode: string | null;
  agent_controller_permission_mode: string | null;
  agent_controller_ref: string;
  created_at_ms: number;
  default_project_id: string | null;
  id: string;
  model_id: string | null;
  open_code_permission_json: string | null;
  organization_id: string;
  reasoning_level: string | null;
  updated_at_ms: number;
  user_id: string;
};

async function createDb(initialRow: CreationDefaultsRow | null = null) {
  const harness = await createPostgresHarness();
  onTestFinished(async () => {
    await harness.close();
  });
  await harness.query(
    `INSERT INTO "openmeld"."organizations" (id, name, slug, created_at) VALUES ('org-1', 'Organization', 'organization', 1)`
  );
  await harness.query(
    `INSERT INTO "openmeld"."users" (id, name, email, created_at, updated_at) VALUES ('user-1', 'User', 'user@example.test', 1, 1)`
  );
  await harness.query(`INSERT INTO "openmeld"."projects" (id, organization_id, slug, name, created_by_user_id, created_at_ms, updated_at_ms)
    VALUES ('project-1', 'org-1', 'project', 'Project', 'user-1', 1, 1)`);
  if (initialRow) {
    await harness.query({
      text: `INSERT INTO "openmeld"."agent_profile_creation_defaults"
      (agent_controller_collaboration_mode, agent_controller_permission_mode, agent_controller_ref, created_at_ms,
       default_project_id, id, model_id, open_code_permission_json, organization_id, reasoning_level, updated_at_ms, user_id)
      VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)`,
      values: [
        initialRow.agent_controller_collaboration_mode,
        initialRow.agent_controller_permission_mode,
        initialRow.agent_controller_ref,
        initialRow.created_at_ms,
        initialRow.default_project_id,
        initialRow.id,
        initialRow.model_id,
        initialRow.open_code_permission_json,
        initialRow.organization_id,
        initialRow.reasoning_level,
        initialRow.updated_at_ms,
        initialRow.user_id,
      ],
    });
  }
  return harness.db;
}

describe("Agent Profile creation defaults repository", () => {
  it("upserts one user and Local Agent preference without changing its identity", async () => {
    const db = await createDb();

    const first = await upsertAgentProfileCreationDefaultsRecord({
      agentControllerCollaborationMode: "codex:plan",
      agentControllerPermissionMode: "codex:approveForMe",
      agentControllerRef: "builtin:codex",
      db,
      defaultProjectId: "project-1",
      modelId: "gpt-5.4-mini",
      nowMs: 1_776_000_000_000,
      openCodePermission: null,
      organizationId: "org-1",
      reasoningLevel: "high",
      userId: "user-1",
    });
    const second = await upsertAgentProfileCreationDefaultsRecord({
      agentControllerCollaborationMode: "codex:default",
      agentControllerPermissionMode: "codex:askForApproval",
      agentControllerRef: "builtin:codex",
      db,
      defaultProjectId: null,
      modelId: "gpt-5.4",
      nowMs: 1_776_000_001_000,
      openCodePermission: null,
      organizationId: "org-1",
      reasoningLevel: "medium",
      userId: "user-1",
    });

    expect(second).toMatchObject({
      agentControllerCollaborationMode: "codex:default",
      agentControllerPermissionMode: "codex:askForApproval",
      agentControllerRef: "builtin:codex",
      createdAtMs: first.createdAtMs,
      defaultProjectId: null,
      id: first.id,
      modelId: "gpt-5.4",
      reasoningLevel: "medium",
      updatedAtMs: 1_776_000_001_000,
    });
  });

  it("lists all Local Agent preferences for the same user", async () => {
    const db = await createDb({
      agent_controller_collaboration_mode: "codex:plan",
      agent_controller_permission_mode: "codex:approveForMe",
      agent_controller_ref: "builtin:codex",
      created_at_ms: 1,
      default_project_id: "project-1",
      id: "defaults-1",
      model_id: "gpt-5.6-sol",
      open_code_permission_json: null,
      organization_id: "org-1",
      reasoning_level: "high",
      updated_at_ms: 2,
      user_id: "user-1",
    });

    await expect(
      listAgentProfileCreationDefaultsRecords({
        db,
        organizationId: "org-1",
        userId: "user-1",
      })
    ).resolves.toEqual([
      expect.objectContaining({
        agentControllerCollaborationMode: "codex:plan",
        agentControllerRef: "builtin:codex",
      }),
    ]);
  });

  it("fails fast when stored permission data is outside the shared contract", async () => {
    const db = await createDb({
      agent_controller_collaboration_mode: null,
      agent_controller_permission_mode: "invented_mode",
      agent_controller_ref: "builtin:codex",
      created_at_ms: 1,
      default_project_id: null,
      id: "defaults-1",
      model_id: null,
      open_code_permission_json: null,
      organization_id: "org-1",
      reasoning_level: null,
      updated_at_ms: 1,
      user_id: "user-1",
    });

    await expect(
      readAgentProfileCreationDefaultsRecord({
        agentControllerRef: "builtin:codex",
        db,
        organizationId: "org-1",
        userId: "user-1",
      })
    ).rejects.toThrow();
  });
});
