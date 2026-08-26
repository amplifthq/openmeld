import { describe, expect, it, vi } from "vitest";
import {
  listAgentProfileCreationDefaultsRecords,
  readAgentProfileCreationDefaultsRecord,
  upsertAgentProfileCreationDefaultsRecord,
} from "../src/agent-profile-binding/infrastructure/d1/agent-profile-creation-defaults-repo";

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

function createDb(initialRow: CreationDefaultsRow | null = null) {
  let row = initialRow;
  const db = {
    prepare: vi.fn((sql: string) => ({
      bind: vi.fn((...args: unknown[]) => ({
        first: vi.fn(() => Promise.resolve(row)),
        all: vi.fn(() => Promise.resolve({ results: row ? [row] : [] })),
        run: vi.fn(() => {
          if (
            sql
              .toLowerCase()
              .includes("insert into agent_profile_creation_defaults")
          ) {
            row = {
              agent_controller_collaboration_mode:
                args[4] === null ? null : String(args[4]),
              agent_controller_permission_mode:
                args[8] === null ? null : String(args[8]),
              agent_controller_ref: String(args[3]),
              created_at_ms: Number(row?.created_at_ms ?? args[10]),
              default_project_id: args[5] === null ? null : String(args[5]),
              id: row?.id ?? String(args[0]),
              model_id: args[6] === null ? null : String(args[6]),
              open_code_permission_json:
                args[9] === null ? null : String(args[9]),
              organization_id: String(args[1]),
              reasoning_level: args[7] === null ? null : String(args[7]),
              updated_at_ms: Number(args[11]),
              user_id: String(args[2]),
            };
          }
          return Promise.resolve({ success: true });
        }),
      })),
    })),
  } as unknown as D1Database;
  return db;
}

describe("Agent Profile creation defaults repository", () => {
  it("upserts one user and Local Agent preference without changing its identity", async () => {
    const db = createDb();

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
    const db = createDb({
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
    const db = createDb({
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
