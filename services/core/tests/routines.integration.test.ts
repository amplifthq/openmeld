import type { QueryResult } from "@openmeld/db/postgresql";
import { getPostgresDatabase, type QueryConfig } from "@openmeld/db/postgresql";
import { HOSTED_CENTER_AGENT_CONTROLLER_REF } from "@openmeld/schemas";
import type { CenterAgentRoutineRun } from "@openmeld/schemas/types";
import { buildDirectMessagePairKey } from "@openmeld/space";
import { afterEach, describe, expect, it, vi } from "vitest";
import { rpcCenterAgentReadAgentActivity } from "../src/agent-activity/activity-center-agent-rpc";
import type { CoreBindings } from "../src/lib/bindings";
import {
  markRemoteAgentNativeDeliveryAck,
  upsertRemoteAgentNativeDeliveryRecord,
} from "../src/remote-agent/infrastructure/postgresql/native-delivery-ledger-repo";
import {
  rpcCenterAgentCreateRoutine,
  rpcCenterAgentDeleteRoutine,
  rpcCenterAgentListRoutines,
  rpcCenterAgentPauseRoutine,
  rpcCenterAgentResumeRoutine,
  rpcCenterAgentUpdateRoutine,
} from "../src/routines/routine-center-agent-rpc";
import {
  recoverLocalRoutineRuns,
  submitLocalRoutineDelivery,
} from "../src/routines/routine-local-delivery";
import { listDueRoutineRecords } from "../src/routines/routine-repository";
import { runRoutineSchedulerTick } from "../src/routines/routine-scheduler";
import {
  rpcAddSpaceMembers,
  rpcCreateRoutine,
  rpcCreateSpace,
  rpcDeleteRoutine,
  rpcListCenterAgentAuditJournal,
  rpcListRoutineRuns,
  rpcListRoutines,
  rpcListRoutineTargetSpaces,
  rpcPauseRoutine,
  rpcResumeRoutine,
  rpcUpdateRoutine,
} from "../src/rpc/methods";
import { env } from "../test-support/worker-env";

const FIXED_NOW_MS = Date.parse("2026-03-07T14:00:00.000Z");
const ownedRoutineOrganizationIds = new Set<string>();
afterEach(async () => {
  try {
    await cleanupOwnedRoutineRows();
  } finally {
    vi.restoreAllMocks();
  }
});
describe("Core Center Agent Routines", () => {
  it("admits a Local Agent run through the Space Wake owner and recovers the same occurrence after definition deletion", async () => {
    const fixture = await seedRoutineFixture();
    const db = getPostgresDatabase(env);
    const nowMs = FIXED_NOW_MS;
    vi.spyOn(Date, "now").mockReturnValue(nowMs);
    const agentProfileId = `agt_${crypto.randomUUID()}`;
    const bindingId = `binding_${crypto.randomUUID()}`;
    const runtimeId = `runtime_${crypto.randomUUID()}`;
    const owner = fixture.users.owner;
    await db.query({
      text: `INSERT INTO openmeld.openmeld_profiles
        (profile_id, profile_name, profile_handle, profile_kind, is_default, status,
         organization_id, owner_user_id, created_by_user_id, source, created_at, updated_at)
        VALUES ($1,'Routine Local Agent',$1,'agent',0,'active',$2,$3,$3,'auth_bootstrap',$4,$4)`,
      values: [agentProfileId, fixture.organizationId, owner.userId, nowMs],
    });
    await db.query({
      text: `INSERT INTO openmeld."openMeldDaemon_agent_profile_bindings"
        (binding_id,owner_kind,owner_id,agent_profile_id,openmeld_service_runtime_id,
         runtime_kind,agent_controller_ref,binding_state,created_at_ms,updated_at_ms)
        VALUES ($1,'owner_account',$2,$3,$4,'openmeld_service','builtin:codex','enabled_primary',$5,$5)`,
      values: [bindingId, owner.userId, agentProfileId, runtimeId, nowMs],
    });
    const context = fixture.contextFor("owner");
    const space = await rpcCreateSpace(env as CoreBindings, {
      context,
      name: "Scheduled local work",
      visibility: "public",
    });
    await rpcAddSpaceMembers(env as CoreBindings, {
      context,
      spaceId: space.spaceId,
      members: [
        {
          profileId: agentProfileId,
          profileKind: "agent",
          profileName: "Routine Local Agent",
          ownerUserId: owner.userId,
          ownerName: "owner user",
          agentControllerRef: "builtin:codex",
        },
      ],
    });
    const routine = await createRoutineFor(fixture, "owner", {
      scope: "personal",
      agentProfileId,
      targetSpaceId: space.spaceId,
      cronExpression: "0 14 * * *",
    });
    await db.query({
      text: "UPDATE openmeld.routines SET next_due_at=$1 WHERE id=$2",
      values: [nowMs, routine.id],
    });
    const tick = await runRoutineSchedulerTick({
      db,
      nowMs,
      resolveExecutionEngine: () => "local",
      submitRoutineDelivery: (input) =>
        submitLocalRoutineDelivery({ ...input, env: env as CoreBindings }),
    });
    expect(tick).toMatchObject({ claimed: 1, submitted: 1, errors: 0 });
    const before = (
      await db.query<{
        id: string;
        source_signal_id: string;
        local_submission_json: string;
        status: string;
      }>({
        text: "SELECT id,source_signal_id,local_submission_json,status FROM openmeld.routine_runs WHERE routine_id=$1",
        values: [routine.id],
      })
    ).rows[0];
    if (!before) {
      throw new Error("Expected one claimed local run.");
    }
    expect(before.source_signal_id).toEqual(expect.any(String));
    expect(JSON.parse(before.local_submission_json)).toMatchObject({
      targetProfileId: agentProfileId,
      spaceId: space.spaceId,
      deviceWait: {
        bindingId,
        openMeldServiceRuntimeId: runtimeId,
        targetProfileId: agentProfileId,
      },
    });
    // Model a lost response after Space acceptance. The durable occurrence key
    // must recover that receipt; deletion cannot cause a duplicate Wake.
    await db.query({
      text: "UPDATE openmeld.routine_runs SET status='claimed',source_signal_id=NULL WHERE id=$1",
      values: [before.id],
    });
    await rpcDeleteRoutine(env as CoreBindings, {
      context,
      routineId: routine.id,
      contract: "practical-v2",
    });
    await recoverLocalRoutineRuns({
      db,
      env: env as CoreBindings,
      nowMs: nowMs + 60_000,
    });
    const after = (
      await db.query({
        text: "SELECT source_signal_id,status FROM openmeld.routine_runs WHERE id=$1",
        values: [before.id],
      })
    ).rows[0];
    expect(after).toEqual({
      source_signal_id: before.source_signal_id,
      status: "submitted",
    });
  });
  it("keeps personal definitions and retained runs private even from Organization admins", async () => {
    vi.spyOn(Date, "now").mockReturnValue(FIXED_NOW_MS);
    const fixture = await seedRoutineFixture();
    const routine = await createRoutineFor(fixture, "member", {
      scope: "personal",
      cronExpression: "0 14 * * *",
    });
    const db = getPostgresDatabase(env);
    await db.query({
      text: "UPDATE openmeld.routines SET next_due_at=$1 WHERE id=$2",
      values: [FIXED_NOW_MS, routine.id],
    });
    await runRoutineSchedulerTick({
      db,
      nowMs: FIXED_NOW_MS,
      submitRoutineDelivery: async () => ({ status: "pending" }),
    });
    for (const role of ["owner", "admin"] as const) {
      await expect(
        rpcListRoutines(env as CoreBindings, {
          context: fixture.contextFor(role),
          contract: "routines-v3",
        })
      ).resolves.toMatchObject({ routines: [] });
      await expect(
        rpcPauseRoutine(env as CoreBindings, {
          context: fixture.contextFor(role),
          routineId: routine.id,
          contract: "practical-v2",
        })
      ).rejects.toThrow("routine.not_found");
      await expect(
        rpcListRoutineRuns(env as CoreBindings, {
          context: fixture.contextFor(role),
          routineId: routine.id,
        })
      ).rejects.toThrow("routine.not_found");
    }
    await expect(
      rpcListRoutines(env as CoreBindings, {
        context: fixture.contextFor("member"),
        contract: "routines-v3",
      })
    ).resolves.toMatchObject({
      routines: [
        { id: routine.id, scope: "personal", executorKind: "center_agent" },
      ],
    });
    await rpcDeleteRoutine(env as CoreBindings, {
      context: fixture.contextFor("member"),
      routineId: routine.id,
      contract: "practical-v2",
    });
    await expect(
      rpcListRoutineRuns(env as CoreBindings, {
        context: fixture.contextFor("member"),
        routineId: routine.id,
      })
    ).resolves.toMatchObject({ runs: [{ routineId: routine.id }] });
    await expect(
      rpcListRoutineRuns(env as CoreBindings, {
        context: fixture.contextFor("admin"),
        routineId: routine.id,
      })
    ).rejects.toThrow("routine.not_found");
  });
  it("does not reveal old private destinations after a team routine moves to a public Space", async () => {
    vi.spyOn(Date, "now").mockReturnValue(FIXED_NOW_MS);
    const fixture = await seedRoutineFixture();
    const privateSpaceId = `space_private_${crypto.randomUUID()}`;
    await seedRoutineTargetSpaces(fixture, [
      {
        spaceId: privateSpaceId,
        name: "Private planning",
        visibility: "private",
        memberships: [
          {
            profileId: fixture.users.owner.humanProfileId,
            profileKind: "human",
            ownerUserId: fixture.users.owner.userId,
          },
          { profileId: fixture.centerAgentProfileId, profileKind: "agent" },
        ],
      },
    ]);
    const routine = await createRoutineFor(fixture, "owner", {
      scope: "team",
      targetSpaceId: privateSpaceId,
    });
    const db = getPostgresDatabase(env);
    await db.query({
      text: "UPDATE openmeld.routines SET next_due_at=$1 WHERE id=$2",
      values: [FIXED_NOW_MS, routine.id],
    });
    await runRoutineSchedulerTick({
      db,
      nowMs: FIXED_NOW_MS,
      submitRoutineDelivery: async () => ({ status: "pending" }),
    });
    await rpcUpdateRoutine(env as CoreBindings, {
      context: fixture.contextFor("owner"),
      routineId: routine.id,
      targetSpaceId: fixture.targetSpaceId,
      contract: "practical-v2",
    });
    await expect(
      rpcListRoutineRuns(env as CoreBindings, {
        context: fixture.contextFor("member"),
        routineId: routine.id,
      })
    ).resolves.toMatchObject({ runs: [] });
    await expect(
      rpcListRoutines(env as CoreBindings, {
        context: fixture.contextFor("member"),
        contract: "routines-v3",
      })
    ).resolves.toMatchObject({ routines: [{ id: routine.id, lastRun: null }] });
  });
  it("edits a completed one-time routine without creating another occurrence", async () => {
    vi.spyOn(Date, "now").mockReturnValue(FIXED_NOW_MS);
    const fixture = await seedRoutineFixture();
    const created = await rpcCreateRoutine(env as CoreBindings, {
      context: fixture.contextFor("owner"),
      ...cronSpaceRoutineInput(fixture.targetSpaceId, "0 9 * * *", "UTC"),
      name: "Once",
      contract: "practical-v2",
      instructions: "Read the current queue.",
      scheduleKind: "once",
      runAtMs: FIXED_NOW_MS + 60_000,
      cronExpression: null,
      timezone: null,
    });
    await runRoutineSchedulerTick({
      db: getPostgresDatabase(env),
      nowMs: FIXED_NOW_MS + 60_000,
      submitRoutineDelivery: async () => ({ status: "pending" }),
    });
    vi.spyOn(Date, "now").mockReturnValue(FIXED_NOW_MS + 120_000);
    await expect(
      rpcUpdateRoutine(env as CoreBindings, {
        context: fixture.contextFor("owner"),
        routineId: created.routine.id,
        name: "Reviewed once",
        contract: "practical-v2",
      })
    ).resolves.toMatchObject({
      routine: {
        name: "Reviewed once",
        status: "completed",
        nextDueAt: null,
        runAtMs: FIXED_NOW_MS + 60_000,
      },
    });
  });
  it("claims a one-time Routine exactly once and marks its schedule completed", async () => {
    vi.spyOn(Date, "now").mockReturnValue(FIXED_NOW_MS);
    const fixture = await seedRoutineFixture();
    const runAtMs = FIXED_NOW_MS + 60_000;
    const created = await rpcCreateRoutine(env as CoreBindings, {
      context: fixture.contextFor("owner"),
      contract: "practical-v2",
      cronExpression: null,
      destinationKind: "space",
      instructions: "Confirm the release is healthy.",
      name: "Release follow-up",
      runAtMs,
      scheduleKind: "once",
      slackChannelId: null,
      slackConversationId: null,
      slackTeamId: null,
      slackThreadLabel: null,
      slackThreadTs: null,
      targetSpaceId: fixture.targetSpaceId,
      timezone: null,
    });
    expect(created.routine).toMatchObject({
      nextDueAt: runAtMs,
      runAtMs,
      scheduleKind: "once",
      status: "enabled",
    });
    // Existing strict CLI readers must not receive new null channel fields.
    expect(created.routine).not.toHaveProperty("messageChannelLocator");
    await expect(
      rpcListRoutines(env as CoreBindings, {
        context: fixture.contextFor("owner"),
      })
    ).resolves.toMatchObject({ routines: [] });
    await expect(
      rpcPauseRoutine(env as CoreBindings, {
        context: fixture.contextFor("owner"),
        routineId: created.routine.id,
      })
    ).rejects.toThrow("routine.client_update_required");
    const submitRoutineDelivery = vi.fn(async () => ({
      status: "submitted" as const,
    }));
    await expect(
      runRoutineSchedulerTick({
        db: getPostgresDatabase(env),
        nowMs: runAtMs,
        submitRoutineDelivery,
      })
    ).resolves.toMatchObject({ claimed: 1, scanned: 1, submitted: 1 });
    await expect(
      runRoutineSchedulerTick({
        db: getPostgresDatabase(env),
        nowMs: runAtMs + 60_000,
        submitRoutineDelivery,
      })
    ).resolves.toMatchObject({ claimed: 0, scanned: 0 });
    expect(submitRoutineDelivery).toHaveBeenCalledOnce();
    await expect(
      rpcListRoutines(env as CoreBindings, {
        context: fixture.contextFor("owner"),
        contract: "practical-v2",
      })
    ).resolves.toMatchObject({
      routines: [
        {
          id: created.routine.id,
          nextDueAt: null,
          status: "completed",
        },
      ],
    });
  });
  it("lets an Organization owner manage a Routine through its full lifecycle", async () => {
    vi.spyOn(Date, "now").mockReturnValue(FIXED_NOW_MS);
    const fixture = await seedRoutineFixture();
    const context = fixture.contextFor("owner");
    const created = await rpcCreateRoutine(env as CoreBindings, {
      authorizedActions: [
        "organization_documents.save_approved_knowledge" as const,
      ],
      context,
      externalActionPolicy: "read_only",
      ...cronSpaceRoutineInput(
        fixture.targetSpaceId,
        "0 9 * * *",
        "America/New_York"
      ),
      instructions: "Review new Feedback Inbox issues.",
      name: "Daily feedback review",
    });
    expect(created.routine).toMatchObject({
      canManage: true,
      createdByUserId: fixture.users.owner.userId,
      lastRun: null,
      nextDueAt: Date.parse("2026-03-08T13:00:00.000Z"),
      status: "enabled",
    });
    expect(created.routine).not.toHaveProperty("authorizedActions");
    await expect(
      getPostgresDatabase(env)
        .query<{
          authorized_actions_json: string;
          external_action_policy: string;
        }>({
          ...{
            text: 'SELECT authorized_actions_json, external_action_policy FROM "openmeld"."routines" WHERE id = $1',
            values: [],
          },
          values: [created.routine.id],
        })
        .then((result) => result.rows[0] ?? null)
    ).resolves.toEqual({
      authorized_actions_json: JSON.stringify([
        "organization_documents.save_approved_knowledge",
      ]),
      external_action_policy: "read_only",
    });
    expect("destinationKind" in created.routine).toBe(false);
    await expect(
      rpcListRoutines(env as CoreBindings, {
        context,
        contract: "practical-v2",
      })
    ).resolves.toMatchObject({
      routines: [
        {
          destinationKind: "space",
          id: created.routine.id,
          scheduleKind: "cron",
        },
      ],
    });
    await expect(
      rpcListRoutines(env as CoreBindings, {
        context,
        contract: "management-v1",
      })
    ).resolves.toMatchObject({
      routines: [
        {
          capabilityState: {
            approvedKnowledge: true,
            canRepair: true,
            externalActionPolicy: "read_only",
            slackChannelReport: false,
          },
          id: created.routine.id,
        },
      ],
    });
    await expect(
      rpcListRoutines(env as CoreBindings, { context })
    ).resolves.toMatchObject({
      organizationId: fixture.organizationId,
      routines: [{ id: created.routine.id, canManage: true }],
    });
    const updated = await rpcUpdateRoutine(env as CoreBindings, {
      authorizedActions: [],
      context,
      cronExpression: "30 9 * * *",
      name: "Morning feedback review",
      routineId: created.routine.id,
    });
    expect(updated.routine).toMatchObject({
      name: "Morning feedback review",
      nextDueAt: Date.parse("2026-03-07T14:30:00.000Z"),
      updatedByUserId: fixture.users.owner.userId,
    });
    await expect(
      getPostgresDatabase(env)
        .query<{
          authorized_actions_json: string;
          external_action_policy: string;
        }>({
          ...{
            text: 'SELECT authorized_actions_json, external_action_policy FROM "openmeld"."routines" WHERE id = $1',
            values: [],
          },
          values: [created.routine.id],
        })
        .then((result) => result.rows[0] ?? null)
    ).resolves.toEqual({
      authorized_actions_json: "[]",
      external_action_policy: "read_only",
    });
    const paused = await rpcPauseRoutine(env as CoreBindings, {
      context,
      routineId: created.routine.id,
    });
    expect(paused.routine).toMatchObject({
      nextDueAt: null,
      status: "paused",
    });
    const resumed = await rpcResumeRoutine(env as CoreBindings, {
      context,
      routineId: created.routine.id,
    });
    expect(resumed.routine).toMatchObject({
      nextDueAt: Date.parse("2026-03-07T14:30:00.000Z"),
      status: "enabled",
    });
    await expect(
      rpcDeleteRoutine(env as CoreBindings, {
        context,
        routineId: created.routine.id,
      })
    ).resolves.toEqual({
      deleted: true,
      organizationId: fixture.organizationId,
      routineId: created.routine.id,
    });
    await expect(
      rpcListRoutines(env as CoreBindings, { context })
    ).resolves.toMatchObject({ routines: [] });
    const audit = await getPostgresDatabase(env).query<{
      action: string;
    }>({
      ...{
        text: `
        SELECT action
        FROM "openmeld"."center_agent_audit_journal"
        WHERE organization_id = $1 AND resource_id = $2
        ORDER BY created_at, id
      `,
        values: [],
      },
      values: [fixture.organizationId, created.routine.id],
    });
    expect((audit.rows ?? []).map((row) => row.action).sort()).toEqual([
      "create_routine",
      "delete_routine",
      "pause_routine",
      "resume_routine",
      "update_routine",
    ]);
    await expect(
      rpcListCenterAgentAuditJournal(env as CoreBindings, {
        context,
        limit: 25,
      })
    ).resolves.toEqual({ entries: [], organizationId: fixture.organizationId });
    await expect(
      rpcListCenterAgentAuditJournal(env as CoreBindings, {
        actionSet: "v16",
        context,
        limit: 25,
      })
    ).resolves.toEqual({ entries: [], organizationId: fixture.organizationId });
    const currentAudit = await rpcListCenterAgentAuditJournal(
      env as CoreBindings,
      {
        actionSet: "v17",
        context,
        limit: 25,
      }
    );
    expect(currentAudit.entries.map((entry) => entry.action).sort()).toEqual([
      "create_routine",
      "delete_routine",
      "pause_routine",
      "resume_routine",
      "update_routine",
    ]);
    expect(
      currentAudit.entries.every(
        (entry) => entry.interactionSource === undefined
      )
    ).toBe(true);
  });
  it("lets the designated Center Agent manage Routines on behalf of the verified member", async () => {
    vi.spyOn(Date, "now").mockReturnValue(FIXED_NOW_MS);
    const fixture = await seedRoutineFixture();
    const context = fixture.centerAgentContext();
    const speakerMember = fixture.speakerFor("member");
    const localAgentDelivery = await seedAcceptedLocalAgentDelivery({
      client: "codex",
      context,
      fixture,
      role: "member",
    });
    const created = await rpcCenterAgentCreateRoutine(env as CoreBindings, {
      context,
      ...cronSpaceRoutineInput(
        fixture.targetSpaceId,
        "0 9 * * *",
        "America/New_York"
      ),
      instructions: "Review new Feedback Inbox issues.",
      name: "Daily feedback review",
      speakerMember,
    });
    expect(created.routine).toMatchObject({
      canManage: true,
      createdByUserId: fixture.users.member.userId,
      updatedByUserId: fixture.users.member.userId,
    });
    await expect(
      rpcCenterAgentListRoutines(env as CoreBindings, {
        context,
        speakerMember,
      })
    ).resolves.toMatchObject({
      currentUserId: fixture.users.member.userId,
      routines: [{ id: created.routine.id, canManage: true }],
    });
    await rpcCenterAgentUpdateRoutine(env as CoreBindings, {
      context,
      name: "Morning feedback review",
      routineId: created.routine.id,
      speakerMember,
    });
    await rpcCenterAgentPauseRoutine(env as CoreBindings, {
      context,
      routineId: created.routine.id,
      speakerMember,
    });
    await rpcCenterAgentResumeRoutine(env as CoreBindings, {
      context,
      routineId: created.routine.id,
      speakerMember,
    });
    await rpcCenterAgentDeleteRoutine(env as CoreBindings, {
      context,
      routineId: created.routine.id,
      speakerMember,
    });
    const audit = await getPostgresDatabase(env).query<{
      action: string;
      actor_profile_id: string;
      on_behalf_of_display_name: string;
      on_behalf_of_profile_id: string;
      on_behalf_of_user_id: string;
      source_native_delivery_id: string;
    }>({
      ...{
        text: `
        SELECT
          action,
          actor_profile_id,
          on_behalf_of_profile_id,
          on_behalf_of_user_id,
          on_behalf_of_display_name,
          source_native_delivery_id
        FROM "openmeld"."center_agent_audit_journal"
        WHERE organization_id = $1 AND resource_id = $2
        ORDER BY action
      `,
        values: [],
      },
      values: [fixture.organizationId, created.routine.id],
    });
    expect(audit.rows).toHaveLength(5);
    expect((audit.rows ?? []).map((row) => row.action)).toEqual([
      "create_routine",
      "delete_routine",
      "pause_routine",
      "resume_routine",
      "update_routine",
    ]);
    for (const row of audit.rows ?? []) {
      expect(row).toMatchObject({
        actor_profile_id: fixture.centerAgentProfileId,
        on_behalf_of_display_name: "member user",
        on_behalf_of_profile_id: fixture.users.member.humanProfileId,
        on_behalf_of_user_id: fixture.users.member.userId,
        source_native_delivery_id: localAgentDelivery.deliveryId,
      });
    }
    const publicAudit = await rpcListCenterAgentAuditJournal(
      env as CoreBindings,
      { actionSet: "v17", context: fixture.contextFor("owner"), limit: 25 }
    );
    const routineEntries = publicAudit.entries.filter(
      (entry) => entry.resource?.type === "routine"
    );
    expect(routineEntries).toHaveLength(5);
    for (const entry of routineEntries) {
      expect(entry.interactionSource).toEqual({
        client: "codex",
        kind: "local_agent",
      });
    }
  });
  it("does not borrow Local Agent provenance from another represented member", async () => {
    vi.spyOn(Date, "now").mockReturnValue(FIXED_NOW_MS);
    const fixture = await seedRoutineFixture();
    const context = fixture.centerAgentContext();
    await seedAcceptedLocalAgentDelivery({
      client: "codex",
      context,
      fixture,
      role: "owner",
    });
    const created = await rpcCenterAgentCreateRoutine(env as CoreBindings, {
      context,
      ...cronSpaceRoutineInput(fixture.targetSpaceId, "0 9 * * *", "UTC"),
      instructions: "Review only the member's own queue.",
      name: "Member queue review",
      speakerMember: fixture.speakerFor("member"),
    });
    await expect(
      getPostgresDatabase(env)
        .query<{
          source_native_delivery_id: string | null;
        }>({
          ...{
            text: `
          SELECT source_native_delivery_id
          FROM "openmeld"."center_agent_audit_journal"
          WHERE organization_id = $1
            AND action = 'create_routine'
            AND resource_id = $2
          LIMIT 1
        `,
            values: [],
          },
          values: [fixture.organizationId, created.routine.id],
        })
        .then((result) => result.rows[0] ?? null)
    ).resolves.toEqual({ source_native_delivery_id: null });
    const audit = await rpcListCenterAgentAuditJournal(env as CoreBindings, {
      actionSet: "v17",
      context: fixture.contextFor("owner"),
      limit: 25,
    });
    const entry = audit.entries.find(
      (candidate) => candidate.resource?.id === created.routine.id
    );
    expect(entry?.interactionSource).toBeUndefined();
    await expect(
      rpcListRoutines(env as CoreBindings, {
        context: fixture.contextFor("member"),
        contract: "management-v2",
      })
    ).resolves.toMatchObject({
      routines: [
        {
          creationAttribution: {
            displayName: "member user",
          },
          id: created.routine.id,
        },
      ],
    });
    const management = await rpcListRoutines(env as CoreBindings, {
      context: fixture.contextFor("member"),
      contract: "management-v2",
    });
    expect(management.routines[0]).not.toHaveProperty(
      "creationAttribution.interactionSource"
    );
  });
  it("freezes direct creator identity instead of following later profile changes", async () => {
    vi.spyOn(Date, "now").mockReturnValue(FIXED_NOW_MS);
    const fixture = await seedRoutineFixture();
    const created = await rpcCreateRoutine(env as CoreBindings, {
      context: fixture.contextFor("member"),
      ...cronSpaceRoutineInput(fixture.targetSpaceId, "0 9 * * *", "UTC"),
      instructions: "Review the member's current work queue.",
      name: "Member queue review",
    });
    await getPostgresDatabase(env).query({
      ...{
        text: 'UPDATE "openmeld"."openmeld_profiles" SET profile_name = \'Renamed member\' WHERE profile_id = $1',
        values: [],
      },
      values: [fixture.users.member.humanProfileId],
    });
    await expect(
      rpcListRoutines(env as CoreBindings, {
        context: fixture.contextFor("owner"),
        contract: "management-v2",
      })
    ).resolves.toMatchObject({
      routines: [
        {
          createdByUserId: fixture.users.member.userId,
          creationAttribution: { displayName: "member user" },
          id: created.routine.id,
        },
      ],
    });
  });
  it("keeps Routine creation source after the Center Agent and audit evidence are removed", async () => {
    vi.spyOn(Date, "now").mockReturnValue(FIXED_NOW_MS);
    const fixture = await seedRoutineFixture();
    const context = fixture.centerAgentContext();
    await seedAcceptedLocalAgentDelivery({
      client: "codex",
      context,
      fixture,
      role: "member",
    });
    const created = await rpcCenterAgentCreateRoutine(env as CoreBindings, {
      context,
      ...cronSpaceRoutineInput(fixture.targetSpaceId, "0 9 * * *", "UTC"),
      instructions: "Review the member's current work queue.",
      name: "Member queue review",
      speakerMember: fixture.speakerFor("member"),
    });
    await getPostgresDatabase(env).query({
      ...{
        text: 'DELETE FROM "openmeld"."openmeld_profiles" WHERE profile_id = $1',
        values: [],
      },
      values: [fixture.centerAgentProfileId],
    });
    await expect(
      getPostgresDatabase(env)
        .query<{
          count: number;
        }>({
          ...{
            text: `
          SELECT COUNT(*) AS count
          FROM "openmeld"."center_agent_audit_journal"
          WHERE organization_id = $1
            AND resource_type = 'routine'
            AND resource_id = $2
        `,
            values: [],
          },
          values: [fixture.organizationId, created.routine.id],
        })
        .then((result) => result.rows[0] ?? null)
    ).resolves.toEqual({ count: 0 });
    await expect(
      rpcListRoutines(env as CoreBindings, {
        context: fixture.contextFor("member"),
        contract: "management-v2",
      })
    ).resolves.toMatchObject({
      routines: [
        {
          creationAttribution: {
            displayName: "member user",
            interactionSource: {
              client: "codex",
              kind: "local_agent",
            },
          },
          id: created.routine.id,
        },
      ],
    });
  });
  it("lets the designated Center Agent read only the verified speaker's Organization activity snapshot", async () => {
    const fixture = await seedRoutineFixture();
    const projectId = `project_${crypto.randomUUID()}`;
    const sessionId = `activity_session_${crypto.randomUUID()}`;
    await getPostgresDatabase(env).transaction(async (client) =>
      (async () => {
        const results: QueryResult[] = [];
        for (const query of [
          {
            ...{
              text: `
          INSERT INTO "openmeld"."projects" (
            id, organization_id, name, slug, repository_fingerprint,
            created_by_user_id, created_at_ms, updated_at_ms, archived_at_ms
          ) VALUES ($1, $2, 'OpenMeld', 'openmeld', NULL, $3, $4, $5, NULL)
        `,
              values: [],
            },
            values: [
              projectId,
              fixture.organizationId,
              fixture.users.member.userId,
              FIXED_NOW_MS,
              FIXED_NOW_MS,
            ],
          },
          {
            ...{
              text: `
          INSERT INTO "openmeld"."agent_activity_sessions" (
            id, organization_id, project_id, member_user_id, device_id,
            openmeld_service_runtime_id, provider, client_kind,
            provider_session_id, title, model, status, git_branch, git_commit,
            repository_fingerprint, started_at_ms, last_observed_at_ms,
            expires_at_ms, provider_metadata_json, last_event_id,
            last_accepted_sequence, created_at_ms, updated_at_ms
          ) VALUES ($1, $2, $3, $4, 'private-device', 'private-runtime', 'codex',
            'codex-app', 'private-provider-session', 'Implement Agent Activity',
            'gpt-5.6-sol', 'active', 'main', NULL, NULL, $5, $6, $7, '{}',
            'event-visible', 1, $8, $9)
        `,
              values: [],
            },
            values: [
              sessionId,
              fixture.organizationId,
              projectId,
              fixture.users.member.userId,
              FIXED_NOW_MS - 1000,
              FIXED_NOW_MS,
              FIXED_NOW_MS + 60_000,
              FIXED_NOW_MS,
              FIXED_NOW_MS,
            ],
          },
        ]) {
          results.push(await client.query(query));
        }
        return results;
      })()
    );
    const snapshot = await rpcCenterAgentReadAgentActivity(
      env as CoreBindings,
      {
        context: fixture.centerAgentContext(),
        speakerMember: fixture.speakerFor("member"),
      }
    );
    expect(snapshot).toMatchObject({
      organizationId: fixture.organizationId,
      sessions: [
        expect.objectContaining({
          memberUserId: fixture.users.member.userId,
          projectId,
          title: "Implement Agent Activity",
        }),
      ],
    });
    expect(JSON.stringify(snapshot)).not.toContain("private-device");
    expect(JSON.stringify(snapshot)).not.toContain("private-provider-session");
  });
  it("projects capability repair authority from the same grant policy", async () => {
    vi.spyOn(Date, "now").mockReturnValue(FIXED_NOW_MS);
    const fixture = await seedRoutineFixture();
    const created = await rpcCreateRoutine(env as CoreBindings, {
      context: fixture.contextFor("member"),
      ...cronSpaceRoutineInput(
        fixture.targetSpaceId,
        "0 9 * * *",
        "America/New_York"
      ),
      instructions: "Review current Organization knowledge.",
      name: "Knowledge review",
    });
    await expect(
      rpcListRoutines(env as CoreBindings, {
        context: fixture.contextFor("member"),
        contract: "management-v1",
      })
    ).resolves.toMatchObject({
      routines: [
        {
          capabilityState: {
            approvedKnowledge: false,
            canRepair: false,
          },
          canManage: true,
          id: created.routine.id,
        },
      ],
    });
    await expect(
      rpcListRoutines(env as CoreBindings, {
        context: fixture.contextFor("owner"),
        contract: "management-v1",
      })
    ).resolves.toMatchObject({
      routines: [
        {
          capabilityState: {
            approvedKnowledge: false,
            canRepair: true,
          },
          id: created.routine.id,
        },
      ],
    });
  });
  it("uses the represented member's authority for every Center Agent Routine mutation", async () => {
    vi.spyOn(Date, "now").mockReturnValue(FIXED_NOW_MS);
    const fixture = await seedRoutineFixture();
    const context = fixture.centerAgentContext();
    const memberSpeaker = fixture.speakerFor("member");
    const ownerRoutineIds = await Promise.all([
      createRoutineFor(fixture, "owner", { name: "Owner update" }),
      createRoutineFor(fixture, "owner", { name: "Owner delete" }),
      createRoutineFor(fixture, "owner", { name: "Owner pause" }),
      createRoutineFor(fixture, "owner", { name: "Owner resume" }),
    ]);
    await rpcPauseRoutine(env as CoreBindings, {
      context: fixture.contextFor("owner"),
      routineId: ownerRoutineIds[3]?.id ?? "missing",
    });
    const forbiddenOperations = [
      () =>
        rpcCenterAgentUpdateRoutine(env as CoreBindings, {
          context,
          name: "Forbidden update",
          routineId: ownerRoutineIds[0]?.id ?? "missing",
          speakerMember: memberSpeaker,
        }),
      () =>
        rpcCenterAgentDeleteRoutine(env as CoreBindings, {
          context,
          routineId: ownerRoutineIds[1]?.id ?? "missing",
          speakerMember: memberSpeaker,
        }),
      () =>
        rpcCenterAgentPauseRoutine(env as CoreBindings, {
          context,
          routineId: ownerRoutineIds[2]?.id ?? "missing",
          speakerMember: memberSpeaker,
        }),
      () =>
        rpcCenterAgentResumeRoutine(env as CoreBindings, {
          context,
          routineId: ownerRoutineIds[3]?.id ?? "missing",
          speakerMember: memberSpeaker,
        }),
    ];
    const auditBefore = await countOrganizationAuditEntries(
      fixture.organizationId
    );
    for (const operation of forbiddenOperations) {
      await expect(operation()).rejects.toThrow("routine.forbidden");
    }
    await expect(
      countOrganizationAuditEntries(fixture.organizationId)
    ).resolves.toBe(auditBefore);
    for (const role of ["owner", "admin"] as const) {
      const speakerMember = fixture.speakerFor(role);
      const updateRoutine = await createRoutineFor(fixture, "member", {
        name: `${role} update target`,
      });
      const deleteRoutine = await createRoutineFor(fixture, "member", {
        name: `${role} delete target`,
      });
      const pauseRoutine = await createRoutineFor(fixture, "member", {
        name: `${role} pause target`,
      });
      const resumeRoutine = await createRoutineFor(fixture, "member", {
        name: `${role} resume target`,
      });
      await rpcPauseRoutine(env as CoreBindings, {
        context: fixture.contextFor("member"),
        routineId: resumeRoutine.id,
      });
      await expect(
        rpcCenterAgentUpdateRoutine(env as CoreBindings, {
          context,
          name: `${role} updated it`,
          routineId: updateRoutine.id,
          speakerMember,
        })
      ).resolves.toMatchObject({ routine: { name: `${role} updated it` } });
      await expect(
        rpcCenterAgentDeleteRoutine(env as CoreBindings, {
          context,
          routineId: deleteRoutine.id,
          speakerMember,
        })
      ).resolves.toMatchObject({ deleted: true });
      await expect(
        rpcCenterAgentPauseRoutine(env as CoreBindings, {
          context,
          routineId: pauseRoutine.id,
          speakerMember,
        })
      ).resolves.toMatchObject({ routine: { status: "paused" } });
      await expect(
        rpcCenterAgentResumeRoutine(env as CoreBindings, {
          context,
          routineId: resumeRoutine.id,
          speakerMember,
        })
      ).resolves.toMatchObject({ routine: { status: "enabled" } });
    }
  });
  it("computes Center Agent Routine canManage from the represented member", async () => {
    const fixture = await seedRoutineFixture();
    const ownerRoutine = await createRoutineFor(fixture, "owner", {
      name: "Owner Routine",
    });
    const memberRoutine = await createRoutineFor(fixture, "member", {
      name: "Member Routine",
    });
    const memberList = await rpcCenterAgentListRoutines(env as CoreBindings, {
      context: fixture.centerAgentContext(),
      speakerMember: fixture.speakerFor("member"),
    });
    const memberCanManage = new Map(
      memberList.routines.map((routine) => [routine.id, routine.canManage])
    );
    expect(memberList.currentUserId).toBe(fixture.users.member.userId);
    expect(memberCanManage.get(ownerRoutine.id)).toBe(false);
    expect(memberCanManage.get(memberRoutine.id)).toBe(true);
    const adminList = await rpcCenterAgentListRoutines(env as CoreBindings, {
      context: fixture.centerAgentContext(),
      speakerMember: fixture.speakerFor("admin"),
    });
    expect(adminList.routines.every((routine) => routine.canManage)).toBe(true);
  });
  it("lets only an owner or admin add an approved-knowledge grant to a Routine", async () => {
    const fixture = await seedRoutineFixture();
    const authorizedActions = [
      "organization_documents.save_approved_knowledge" as const,
    ];
    await expect(
      rpcCreateRoutine(env as CoreBindings, {
        authorizedActions,
        context: fixture.contextFor("member"),
        ...cronSpaceRoutineInput(fixture.targetSpaceId, "0 9 * * *", "UTC"),
        instructions: "Save approved knowledge without review.",
        name: "Unauthorized member grant",
      })
    ).rejects.toMatchObject({
      cause: {
        code: "organization_document.routine_grant_forbidden",
        status: 403,
      },
    });
    await expect(
      rpcCenterAgentCreateRoutine(env as CoreBindings, {
        authorizedActions,
        context: fixture.centerAgentContext(),
        ...cronSpaceRoutineInput(fixture.targetSpaceId, "0 9 * * *", "UTC"),
        instructions: "Save approved knowledge without review.",
        name: "Unauthorized delegated grant",
        speakerMember: fixture.speakerFor("member"),
      })
    ).rejects.toMatchObject({
      cause: {
        code: "organization_document.routine_grant_forbidden",
        status: 403,
      },
    });
    const routine = await createRoutineFor(fixture, "member", {
      name: "Member-owned Routine",
    });
    await expect(
      rpcUpdateRoutine(env as CoreBindings, {
        authorizedActions,
        context: fixture.contextFor("member"),
        routineId: routine.id,
      })
    ).rejects.toMatchObject({
      cause: {
        code: "organization_document.routine_grant_forbidden",
        status: 403,
      },
    });
    await expect(
      rpcUpdateRoutine(env as CoreBindings, {
        authorizedActions,
        context: fixture.contextFor("admin"),
        routineId: routine.id,
      })
    ).resolves.toMatchObject({ routine: { id: routine.id } });
    await expect(
      getPostgresDatabase(env)
        .query<{
          authorized_actions_json: string;
        }>({
          ...{
            text: 'SELECT authorized_actions_json FROM "openmeld"."routines" WHERE id = $1',
            values: [],
          },
          values: [routine.id],
        })
        .then((result) => result.rows[0] ?? null)
    ).resolves.toEqual({
      authorized_actions_json: JSON.stringify(authorizedActions),
    });
    await expect(
      rpcUpdateRoutine(env as CoreBindings, {
        authorizedActions: [],
        context: fixture.contextFor("member"),
        routineId: routine.id,
      })
    ).resolves.toMatchObject({ routine: { id: routine.id } });
    await expect(
      getPostgresDatabase(env)
        .query<{
          authorized_actions_json: string;
        }>({
          ...{
            text: 'SELECT authorized_actions_json FROM "openmeld"."routines" WHERE id = $1',
            values: [],
          },
          values: [routine.id],
        })
        .then((result) => result.rows[0] ?? null)
    ).resolves.toEqual({ authorized_actions_json: "[]" });
  });
  it("fails closed for invalid represented members and invalid Center Agent actors", async () => {
    const nonmemberFixture = await seedRoutineFixture();
    await expect(
      rpcCenterAgentListRoutines(env as CoreBindings, {
        context: nonmemberFixture.centerAgentContext(),
        speakerMember: {
          memberId: `member_${crypto.randomUUID()}`,
          userId: `user_${crypto.randomUUID()}`,
        },
      })
    ).rejects.toThrow("routine.member_actor_required");
    await expect(
      readRoutineSideEffects(nonmemberFixture.organizationId)
    ).resolves.toEqual({ audit: 0, routines: 0 });
    const mismatchFixture = await seedRoutineFixture();
    await expect(
      rpcCenterAgentListRoutines(env as CoreBindings, {
        context: mismatchFixture.centerAgentContext(),
        speakerMember: {
          memberId: mismatchFixture.users.member.memberId,
          userId: mismatchFixture.users.admin.userId,
        },
      })
    ).rejects.toThrow("routine.member_actor_required");
    await expect(
      readRoutineSideEffects(mismatchFixture.organizationId)
    ).resolves.toEqual({ audit: 0, routines: 0 });
    const crossOrganizationFixture = await seedRoutineFixture();
    const foreignFixture = await seedRoutineFixture();
    await expect(
      rpcCenterAgentListRoutines(env as CoreBindings, {
        context: crossOrganizationFixture.centerAgentContext(),
        speakerMember: foreignFixture.speakerFor("member"),
      })
    ).rejects.toThrow("routine.member_actor_required");
    await expect(
      readRoutineSideEffects(crossOrganizationFixture.organizationId)
    ).resolves.toEqual({ audit: 0, routines: 0 });
    const inactiveFixture = await seedRoutineFixture();
    await getPostgresDatabase(env).query({
      ...{
        text: 'UPDATE "openmeld"."openmeld_profiles" SET status = \'disabled\' WHERE profile_id = $1',
        values: [],
      },
      values: [inactiveFixture.users.member.humanProfileId],
    });
    await expect(
      rpcCenterAgentListRoutines(env as CoreBindings, {
        context: inactiveFixture.centerAgentContext(),
        speakerMember: inactiveFixture.speakerFor("member"),
      })
    ).rejects.toThrow("routine.member_actor_required");
    await expect(
      readRoutineSideEffects(inactiveFixture.organizationId)
    ).resolves.toEqual({ audit: 0, routines: 0 });
    const nonhumanFixture = await seedRoutineFixture();
    await getPostgresDatabase(env).query({
      ...{
        text: 'DELETE FROM "openmeld"."openmeld_profiles" WHERE profile_id = $1',
        values: [],
      },
      values: [nonhumanFixture.users.member.humanProfileId],
    });
    await getPostgresDatabase(env).query({
      ...{
        text: `
        INSERT INTO "openmeld"."openmeld_profiles" (
          profile_id,
          profile_name,
          profile_handle,
          profile_kind,
          is_default,
          status,
          organization_id,
          owner_user_id,
          created_by_user_id,
          source,
          created_at,
          updated_at
        ) VALUES ($1, 'Member Agent Profile', $2, 'agent', 0, 'active', $3, $4, $5, 'auth_bootstrap', $6, $7)
      `,
        values: [],
      },
      values: [
        `agt_${crypto.randomUUID()}`,
        `member-agent-${crypto.randomUUID()}`,
        nonhumanFixture.organizationId,
        nonhumanFixture.users.member.userId,
        nonhumanFixture.users.member.userId,
        FIXED_NOW_MS,
        FIXED_NOW_MS,
      ],
    });
    await expect(
      rpcCenterAgentListRoutines(env as CoreBindings, {
        context: nonhumanFixture.centerAgentContext(),
        speakerMember: nonhumanFixture.speakerFor("member"),
      })
    ).rejects.toThrow("routine.member_actor_required");
    await expect(
      readRoutineSideEffects(nonhumanFixture.organizationId)
    ).resolves.toEqual({ audit: 0, routines: 0 });
    const wrongActorFixture = await seedRoutineFixture();
    await expect(
      rpcCenterAgentListRoutines(env as CoreBindings, {
        context: {
          ...wrongActorFixture.centerAgentContext(),
          actorContext: {
            ...wrongActorFixture.centerAgentContext().actorContext,
            openMeldProfileId: `agt_${crypto.randomUUID()}`,
          },
        },
        speakerMember: wrongActorFixture.speakerFor("member"),
      })
    ).rejects.toThrow("center_agent.not_designated");
    await expect(
      readRoutineSideEffects(wrongActorFixture.organizationId)
    ).resolves.toEqual({ audit: 0, routines: 0 });
    const revokedFixture = await seedRoutineFixture();
    await getPostgresDatabase(env).query({
      ...{
        text: 'DELETE FROM "openmeld"."center_agent_designations" WHERE organization_id = $1',
        values: [],
      },
      values: [revokedFixture.organizationId],
    });
    await expect(
      rpcCenterAgentListRoutines(env as CoreBindings, {
        context: revokedFixture.centerAgentContext(),
        speakerMember: revokedFixture.speakerFor("member"),
      })
    ).rejects.toThrow("center_agent.designation_required");
    await expect(
      readRoutineSideEffects(revokedFixture.organizationId)
    ).resolves.toEqual({ audit: 0, routines: 0 });
  });
  it("reuses canonical represented-human target eligibility for Center Agent create, update, and resume", async () => {
    vi.spyOn(Date, "now").mockReturnValue(FIXED_NOW_MS);
    const fixture = await seedRoutineFixture();
    const context = fixture.centerAgentContext();
    const speakerMember = fixture.speakerFor("member");
    const invisiblePrivateSpaceId = `space_invisible_${crypto.randomUUID()}`;
    const degradedDirectMessageSpaceId = `space_degraded_dm_${crypto.randomUUID()}`;
    await seedRoutineTargetSpaces(fixture, [
      {
        memberships: [centerAgentMembership(fixture)],
        name: "Invisible private target",
        spaceId: invisiblePrivateSpaceId,
        visibility: "private",
      },
      {
        activeAgentCount: 1,
        activeHumanCount: 1,
        activeMemberCount: 2,
        directMessagePairKey: buildDirectMessagePairKey(
          fixture.users.member.humanProfileId,
          fixture.centerAgentProfileId
        ),
        memberships: [
          centerAgentMembership(fixture),
          humanMembership(fixture.users.member),
          {
            ownerUserId: `user_third_${crypto.randomUUID()}`,
            profileId: crypto.randomUUID(),
            profileKind: "human",
          },
        ],
        name: "Degraded Center Agent DM",
        purpose: "openmeld_dm_space",
        spaceCreatedAtMs: FIXED_NOW_MS,
        spaceId: degradedDirectMessageSpaceId,
        visibility: "public",
      },
    ]);
    await expect(
      createRoutineForCenterAgent(fixture, "member", {
        targetSpaceId: invisiblePrivateSpaceId,
      })
    ).rejects.toThrow("routine.target_space_not_found");
    const routine = await createRoutineForCenterAgent(fixture, "member");
    await expect(
      rpcCenterAgentUpdateRoutine(env as CoreBindings, {
        context,
        routineId: routine.id,
        speakerMember,
        targetSpaceId: degradedDirectMessageSpaceId,
      })
    ).rejects.toThrow("routine.target_space_not_found");
    await rpcCenterAgentPauseRoutine(env as CoreBindings, {
      context,
      routineId: routine.id,
      speakerMember,
    });
    await getPostgresDatabase(env).query({
      ...{
        text: 'DELETE FROM "openmeld"."space_index_memberships" WHERE space_id = $1 AND profile_id = $2',
        values: [],
      },
      values: [fixture.targetSpaceId, fixture.centerAgentProfileId],
    });
    await expect(
      rpcCenterAgentResumeRoutine(env as CoreBindings, {
        context,
        routineId: routine.id,
        speakerMember,
      })
    ).rejects.toThrow("routine.target_space_publication_unavailable");
    await expect(
      rpcCenterAgentListRoutines(env as CoreBindings, {
        context,
        speakerMember,
      })
    ).resolves.toMatchObject({
      routines: [
        {
          id: routine.id,
          status: "paused",
          targetSpaceId: fixture.targetSpaceId,
        },
      ],
    });
    await expect(
      countRoutineAuditActions(fixture.organizationId, routine.id)
    ).resolves.toEqual({ create_routine: 1, pause_routine: 1 });
  });
  it("rejects unknown Center Agent Routine RPC fields before mutation or audit", async () => {
    const fixture = await seedRoutineFixture();
    const context = fixture.centerAgentContext();
    const speakerMember = fixture.speakerFor("member");
    const routine = await createRoutineForCenterAgent(fixture, "member");
    const invalidOperations = [
      () =>
        rpcCenterAgentListRoutines(
          env as CoreBindings,
          { context, speakerMember, unknown: true } as Parameters<
            typeof rpcCenterAgentListRoutines
          >[1]
        ),
      () =>
        rpcCenterAgentCreateRoutine(
          env as CoreBindings,
          {
            context,
            ...cronSpaceRoutineInput(fixture.targetSpaceId, "0 9 * * *", "UTC"),
            instructions: "This must not persist.",
            name: "Unknown create field",
            speakerMember,
            unknown: true,
          } as Parameters<typeof rpcCenterAgentCreateRoutine>[1]
        ),
      () =>
        rpcCenterAgentUpdateRoutine(
          env as CoreBindings,
          {
            context,
            name: "Unknown update field",
            routineId: routine.id,
            speakerMember,
            unknown: true,
          } as Parameters<typeof rpcCenterAgentUpdateRoutine>[1]
        ),
      () =>
        rpcCenterAgentDeleteRoutine(
          env as CoreBindings,
          {
            context,
            routineId: routine.id,
            speakerMember,
            unknown: true,
          } as Parameters<typeof rpcCenterAgentDeleteRoutine>[1]
        ),
      () =>
        rpcCenterAgentPauseRoutine(
          env as CoreBindings,
          {
            context,
            routineId: routine.id,
            speakerMember,
            unknown: true,
          } as Parameters<typeof rpcCenterAgentPauseRoutine>[1]
        ),
      () =>
        rpcCenterAgentResumeRoutine(
          env as CoreBindings,
          {
            context,
            routineId: routine.id,
            speakerMember,
            unknown: true,
          } as Parameters<typeof rpcCenterAgentResumeRoutine>[1]
        ),
    ];
    for (const operation of invalidOperations) {
      await expect(operation()).rejects.toThrow("invalid_payload");
    }
    await expect(
      countRoutineAuditEntries(fixture.organizationId, routine.id)
    ).resolves.toBe(1);
    await expect(
      countOrganizationRoutines(fixture.organizationId)
    ).resolves.toBe(1);
  });
  it("returns the canonical schedule and quota errors through Center Agent Routine RPC", async () => {
    const scheduleFixture = await seedRoutineFixture();
    await expect(
      createRoutineForCenterAgent(scheduleFixture, "member", {
        cronExpression: "not a cron",
      })
    ).rejects.toThrow("routine.schedule.invalid_cron");
    await expect(
      readRoutineSideEffects(scheduleFixture.organizationId)
    ).resolves.toEqual({ audit: 0, routines: 0 });
    const quotaFixture = await seedRoutineFixture();
    await seedRoutineRows(quotaFixture, 50, "enabled");
    await expect(
      createRoutineForCenterAgent(quotaFixture, "member", {
        name: "Over Routine limit",
      })
    ).rejects.toThrow("routine.total_limit_reached");
    await expect(
      readRoutineSideEffects(quotaFixture.organizationId)
    ).resolves.toEqual({ audit: 0, routines: 50 });
  });
  it("lists each Routine with its latest Run summary", async () => {
    vi.spyOn(Date, "now").mockReturnValue(FIXED_NOW_MS);
    const fixture = await seedRoutineFixture();
    const context = fixture.contextFor("owner");
    const noRunRoutine = await createRoutineFor(fixture, "owner", {
      name: "No Run Routine",
    });
    const failedRoutine = await createRoutineFor(fixture, "owner", {
      name: "Failed Routine",
    });
    const skippedRoutine = await createRoutineFor(fixture, "owner", {
      name: "Skipped Routine",
    });
    const failedLatestRunId = `run_failed_${crypto.randomUUID()}`;
    const skippedLatestRunId = `run_skipped_${crypto.randomUUID()}`;
    const failedScheduledFor = FIXED_NOW_MS - 300_000;
    const skippedScheduledFor = FIXED_NOW_MS - 120_000;
    await getPostgresDatabase(env).transaction(async (client) =>
      (async () => {
        const results: QueryResult[] = [];
        for (const query of [
          buildRoutineRunStatement({
            id: `run_older_${crypto.randomUUID()}`,
            organizationId: fixture.organizationId,
            publishedSignalId: "signal-older",
            routineId: failedRoutine.id,
            scheduledFor: FIXED_NOW_MS - 600_000,
            status: "completed",
          }),
          buildRoutineRunStatement({
            failureCode: "routine.execution_failed",
            failureDetail: "The hosted turn failed before publication.",
            finishedAtMs: failedScheduledFor + 60_000,
            id: failedLatestRunId,
            nativeDeliveryId: "native-delivery-internal",
            organizationId: fixture.organizationId,
            publishedSignalId: "signal-failure",
            routineId: failedRoutine.id,
            scheduledFor: failedScheduledFor,
            startedAtMs: failedScheduledFor + 1000,
            status: "failed",
          }),
          buildRoutineRunStatement({
            failureCode: "routine.execution_failed",
            failureDetail: "This older failure must not be projected.",
            id: `run_older_${crypto.randomUUID()}`,
            organizationId: fixture.organizationId,
            routineId: skippedRoutine.id,
            scheduledFor: FIXED_NOW_MS - 420_000,
            status: "failed",
          }),
          buildRoutineRunStatement({
            failureCode: "routine.missed_occurrences",
            failureDetail:
              "Skipped 12 occurrences from 2026-03-07T12:00:00Z to 2026-03-07T13:00:00Z.",
            finishedAtMs: skippedScheduledFor + 1000,
            id: skippedLatestRunId,
            organizationId: fixture.organizationId,
            routineId: skippedRoutine.id,
            scheduledFor: skippedScheduledFor,
            status: "skipped",
          }),
        ]) {
          results.push(await client.query(query));
        }
        return results;
      })()
    );
    const listed = await rpcListRoutines(env as CoreBindings, { context });
    const routinesById = new Map(
      listed.routines.map((routine) => [routine.id, routine])
    );
    expect(routinesById.get(noRunRoutine.id)?.lastRun).toBeNull();
    expect(routinesById.get(failedRoutine.id)?.lastRun).toEqual({
      failureCode: "routine.execution_failed",
      failureDetail: "The hosted turn failed before publication.",
      finishedAtMs: failedScheduledFor + 60_000,
      id: failedLatestRunId,
      publishedSignalId: "signal-failure",
      scheduledFor: failedScheduledFor,
      startedAtMs: failedScheduledFor + 1000,
      status: "failed",
    });
    expect(routinesById.get(skippedRoutine.id)?.lastRun).toEqual({
      failureCode: "routine.missed_occurrences",
      failureDetail:
        "Skipped 12 occurrences from 2026-03-07T12:00:00Z to 2026-03-07T13:00:00Z.",
      finishedAtMs: skippedScheduledFor + 1000,
      id: skippedLatestRunId,
      publishedSignalId: null,
      scheduledFor: skippedScheduledFor,
      startedAtMs: null,
      status: "skipped",
    });
  });
  it("keeps due Routine records aligned with the strict latest Run projection", async () => {
    vi.spyOn(Date, "now").mockReturnValue(FIXED_NOW_MS);
    const fixture = await seedRoutineFixture();
    const noRunRoutine = await createRoutineFor(fixture, "owner", {
      name: "Due without Runs",
    });
    const completedRoutine = await createRoutineFor(fixture, "owner", {
      name: "Due with a completed Run",
    });
    const completedRunId = `run_completed_${crypto.randomUUID()}`;
    const scheduledFor = FIXED_NOW_MS - 300_000;
    await getPostgresDatabase(env).transaction(async (client) =>
      (async () => {
        const results: QueryResult[] = [];
        for (const query of [
          {
            ...{
              text: 'UPDATE "openmeld"."routines" SET next_due_at = $1 WHERE id IN ($2, $3)',
              values: [],
            },
            values: [FIXED_NOW_MS, noRunRoutine.id, completedRoutine.id],
          },
          buildRoutineRunStatement({
            finishedAtMs: scheduledFor + 60_000,
            id: completedRunId,
            organizationId: fixture.organizationId,
            publishedSignalId: "signal-completed",
            routineId: completedRoutine.id,
            scheduledFor,
            startedAtMs: scheduledFor + 1000,
            status: "completed",
          }),
        ]) {
          results.push(await client.query(query));
        }
        return results;
      })()
    );
    const dueRoutines = await listDueRoutineRecords({
      db: getPostgresDatabase(env),
      limit: 10,
      nowMs: FIXED_NOW_MS,
    });
    const routinesById = new Map(
      dueRoutines.map((routine) => [routine.id, routine])
    );
    expect(routinesById.get(noRunRoutine.id)?.lastRun).toBeNull();
    expect(routinesById.get(completedRoutine.id)?.lastRun).toEqual({
      failureCode: null,
      failureDetail: null,
      finishedAtMs: scheduledFor + 60_000,
      id: completedRunId,
      publishedSignalId: "signal-completed",
      scheduledFor,
      startedAtMs: scheduledFor + 1000,
      status: "completed",
    });
  });
  it("lists only Spaces available to the represented human and current Center Agent", async () => {
    const fixture = await seedRoutineFixture();
    const member = fixture.users.member;
    const sameOwnerHumanProfileId = `human_${crypto.randomUUID()}`;
    const otherHumanProfileId = `human_${crypto.randomUUID()}`;
    const publicAlphaId = `space_alpha_${crypto.randomUUID()}`;
    const publicAlphaSecondId = `space_alpha_${crypto.randomUUID()}`;
    const privateSharedId = `space_private_${crypto.randomUUID()}`;
    const privateOwnerLinkedId = `space_owner_linked_${crypto.randomUUID()}`;
    const ordinaryTwoPersonId = `space_two_person_${crypto.randomUUID()}`;
    const centerAgentDmId = `space_ca_dm_${crypto.randomUUID()}`;
    const olderCenterAgentDmId = `space_ca_dm_old_${crypto.randomUUID()}`;
    const currentCenterAgentPairKey = buildDirectMessagePairKey(
      member.humanProfileId,
      fixture.centerAgentProfileId
    );
    const reversedCenterAgentPairKey = currentCenterAgentPairKey
      .split(":")
      .reverse()
      .join(":");
    await seedRoutineTargetSpaces(fixture, [
      {
        memberships: [centerAgentMembership(fixture)],
        name: "Alpha room",
        spaceId: publicAlphaSecondId,
        visibility: "public",
      },
      {
        memberships: [centerAgentMembership(fixture)],
        name: "Alpha room",
        spaceId: publicAlphaId,
        visibility: "public",
      },
      {
        memberships: [
          centerAgentMembership(fixture),
          humanMembership(member),
          humanMembership(member, sameOwnerHumanProfileId),
        ],
        name: "Private planning",
        spaceId: privateSharedId,
        visibility: "private",
      },
      {
        memberships: [
          centerAgentMembership(fixture),
          humanMembership(member, sameOwnerHumanProfileId),
        ],
        name: "Owner-linked private",
        spaceId: privateOwnerLinkedId,
        visibility: "private",
      },
      {
        activeAgentCount: 1,
        activeHumanCount: 1,
        activeMemberCount: 2,
        memberships: [centerAgentMembership(fixture), humanMembership(member)],
        name: "Two-person project room",
        spaceId: ordinaryTwoPersonId,
        visibility: "private",
      },
      {
        activeAgentCount: 1,
        activeHumanCount: 1,
        activeMemberCount: 2,
        directMessagePairKey: currentCenterAgentPairKey,
        memberships: [centerAgentMembership(fixture), humanMembership(member)],
        name: "Older member and Center Agent",
        purpose: "openmeld_dm_space",
        spaceCreatedAtMs: FIXED_NOW_MS - 1000,
        spaceId: olderCenterAgentDmId,
        visibility: "private",
      },
      {
        activeAgentCount: 1,
        activeHumanCount: 1,
        activeMemberCount: 3,
        directMessagePairKey: currentCenterAgentPairKey,
        memberships: [centerAgentMembership(fixture), humanMembership(member)],
        name: "Member and Center Agent",
        purpose: "openmeld_dm_space",
        spaceCreatedAtMs: FIXED_NOW_MS,
        spaceId: centerAgentDmId,
        visibility: "private",
      },
      {
        memberships: [
          {
            ownerUserId: fixture.users.owner.userId,
            profileId: fixture.centerAgentProfileId,
            profileKind: "human",
          },
        ],
        name: "Malformed Center Agent membership",
        spaceId: `space_malformed_ca_${crypto.randomUUID()}`,
        visibility: "public",
      },
      {
        directMessagePairKey: reversedCenterAgentPairKey,
        memberships: [centerAgentMembership(fixture), humanMembership(member)],
        name: "Non-canonical Center Agent DM",
        purpose: "openmeld_dm_space",
        spaceCreatedAtMs: FIXED_NOW_MS + 1000,
        spaceId: `space_noncanonical_dm_${crypto.randomUUID()}`,
        visibility: "public",
      },
      {
        memberships: [],
        name: "Public without Center Agent",
        spaceId: `space_no_ca_${crypto.randomUUID()}`,
        visibility: "public",
      },
      {
        memberships: [humanMembership(member)],
        name: "Private without Center Agent",
        spaceId: `space_human_only_${crypto.randomUUID()}`,
        visibility: "private",
      },
      {
        memberships: [centerAgentMembership(fixture)],
        name: "Private without represented human",
        spaceId: `space_ca_only_${crypto.randomUUID()}`,
        visibility: "private",
      },
      {
        directMessagePairKey: buildDirectMessagePairKey(
          otherHumanProfileId,
          fixture.centerAgentProfileId
        ),
        memberships: [
          centerAgentMembership(fixture),
          {
            ownerUserId: `user_${crypto.randomUUID()}`,
            profileId: otherHumanProfileId,
            profileKind: "human",
          },
        ],
        name: "Another member and Center Agent",
        purpose: "openmeld_dm_space",
        spaceId: `space_other_dm_${crypto.randomUUID()}`,
        visibility: "public",
      },
      {
        memberships: [centerAgentMembership(fixture), humanMembership(member)],
        name: "Legacy welcoming",
        purpose: "openmeld_welcoming_space",
        spaceId: `space_welcoming_${crypto.randomUUID()}`,
        visibility: "public",
      },
      {
        memberships: [centerAgentMembership(fixture), humanMembership(member)],
        name: "Inactive room",
        spaceId: `space_inactive_${crypto.randomUUID()}`,
        status: "deleted",
        visibility: "public",
      },
      {
        memberships: [centerAgentMembership(fixture), humanMembership(member)],
        name: "Cross-organization room",
        organizationId: `org_foreign_${crypto.randomUUID()}`,
        spaceId: `space_cross_org_${crypto.randomUUID()}`,
        visibility: "public",
      },
    ]);
    await expect(
      rpcListRoutineTargetSpaces(env as CoreBindings, {
        context: fixture.contextFor("member"),
      })
    ).resolves.toEqual({
      organizationId: fixture.organizationId,
      spaces: [
        {
          kind: "center_agent_dm",
          name: "Member and Center Agent",
          spaceId: centerAgentDmId,
        },
        {
          kind: "space",
          name: "Alpha room",
          spaceId: [publicAlphaId, publicAlphaSecondId].sort()[0],
        },
        {
          kind: "space",
          name: "Alpha room",
          spaceId: [publicAlphaId, publicAlphaSecondId].sort()[1],
        },
        {
          kind: "space",
          name: "Owner-linked private",
          spaceId: privateOwnerLinkedId,
        },
        {
          kind: "space",
          name: "Private planning",
          spaceId: privateSharedId,
        },
        {
          kind: "space",
          name: "Two-person project room",
          spaceId: ordinaryTwoPersonId,
        },
        {
          kind: "space",
          name: "Untitled space",
          spaceId: fixture.targetSpaceId,
        },
      ],
    });
    await getPostgresDatabase(env).query({
      ...{
        text: 'UPDATE "openmeld"."openmeld_profiles" SET status = \'disabled\' WHERE profile_id = $1',
        values: [],
      },
      values: [fixture.centerAgentProfileId],
    });
    await expect(
      rpcListRoutineTargetSpaces(env as CoreBindings, {
        context: fixture.contextFor("member"),
      })
    ).resolves.toEqual({
      organizationId: fixture.organizationId,
      spaces: [],
    });
  });
  it.each([
    {
      buildLatestMemberships: (fixture: RoutineFixture) => [
        centerAgentMembership(fixture),
        humanMembership(fixture.users.member),
        {
          ownerUserId: `user_${crypto.randomUUID()}`,
          profileId: `human_${crypto.randomUUID()}`,
          profileKind: "human" as const,
        },
      ],
      degradation: "a third active human",
    },
    {
      buildLatestMemberships: (fixture: RoutineFixture) => [
        centerAgentMembership(fixture),
        humanMembership(fixture.users.member),
        {
          ownerUserId: fixture.users.owner.userId,
          profileId: `agent_${crypto.randomUUID()}`,
          profileKind: "agent" as const,
        },
      ],
      degradation: "a third active agent",
    },
    {
      buildLatestMemberships: (fixture: RoutineFixture) => [
        centerAgentMembership(fixture),
      ],
      degradation: "the represented human membership missing",
    },
    {
      buildLatestMemberships: (fixture: RoutineFixture) => [
        humanMembership(fixture.users.member),
      ],
      degradation: "the designated Center Agent membership missing",
    },
    {
      buildLatestMemberships: (fixture: RoutineFixture) => [
        centerAgentMembership(fixture),
        {
          ownerUserId: fixture.users.member.userId,
          profileId: fixture.users.member.humanProfileId,
          profileKind: "agent" as const,
        },
      ],
      degradation: "the represented human projected with the wrong kind",
    },
    {
      buildLatestMemberships: (fixture: RoutineFixture) => [
        {
          ownerUserId: fixture.users.owner.userId,
          profileId: fixture.centerAgentProfileId,
          profileKind: "human" as const,
        },
        humanMembership(fixture.users.member),
      ],
      degradation: "the designated Center Agent projected with the wrong kind",
    },
  ])("fails closed instead of falling back when the latest canonical Center Agent DM has $degradation", async ({
    buildLatestMemberships,
  }) => {
    const fixture = await seedRoutineFixture();
    const pairKey = buildDirectMessagePairKey(
      fixture.users.member.humanProfileId,
      fixture.centerAgentProfileId
    );
    await seedRoutineTargetSpaces(fixture, [
      {
        activeAgentCount: 1,
        activeHumanCount: 1,
        activeMemberCount: 2,
        directMessagePairKey: pairKey,
        memberships: [
          centerAgentMembership(fixture),
          humanMembership(fixture.users.member),
        ],
        name: "Older healthy Center Agent DM",
        purpose: "openmeld_dm_space",
        spaceCreatedAtMs: FIXED_NOW_MS - 1000,
        spaceId: `space_healthy_dm_${crypto.randomUUID()}`,
        visibility: "private",
      },
      {
        activeAgentCount: 1,
        activeHumanCount: 1,
        activeMemberCount: 2,
        directMessagePairKey: pairKey,
        memberships: buildLatestMemberships(fixture),
        name: "Latest degraded Center Agent DM",
        purpose: "openmeld_dm_space",
        spaceCreatedAtMs: FIXED_NOW_MS,
        spaceId: `space_degraded_dm_${crypto.randomUUID()}`,
        visibility: "public",
      },
    ]);
    await expect(
      rpcListRoutineTargetSpaces(env as CoreBindings, {
        context: fixture.contextFor("member"),
      })
    ).resolves.toEqual({
      organizationId: fixture.organizationId,
      spaces: [
        {
          kind: "space",
          name: "Untitled space",
          spaceId: fixture.targetSpaceId,
        },
      ],
    });
  });
  it("keeps Routine target Space reads strict and member-only", async () => {
    const fixture = await seedRoutineFixture();
    const context = fixture.contextFor("member");
    await expect(
      rpcListRoutineTargetSpaces(
        env as CoreBindings,
        { context, unknown: true } as Parameters<
          typeof rpcListRoutineTargetSpaces
        >[1]
      )
    ).rejects.toThrow("invalid_payload");
    await expect(
      rpcListRoutineTargetSpaces(env as CoreBindings, {
        context: {
          ...context,
          actorContext: { ...context.actorContext, profileKind: "agent" },
        },
      })
    ).rejects.toThrow("routine.member_actor_required");
    await getPostgresDatabase(env).query({
      ...{
        text: 'DELETE FROM "openmeld"."members" WHERE organization_id = $1 AND user_id = $2',
        values: [],
      },
      values: [fixture.organizationId, fixture.users.member.userId],
    });
    await expect(
      rpcListRoutineTargetSpaces(env as CoreBindings, { context })
    ).rejects.toThrow("organization.membership_required");
  });
  it("lets admins manage every Routine and members manage only their own", async () => {
    vi.spyOn(Date, "now").mockReturnValue(FIXED_NOW_MS);
    const fixture = await seedRoutineFixture();
    const memberRoutine = await createRoutineFor(fixture, "member");
    await expect(
      rpcUpdateRoutine(env as CoreBindings, {
        context: fixture.contextFor("member"),
        name: "Member-owned morning review",
        routineId: memberRoutine.id,
      })
    ).resolves.toMatchObject({
      routine: { name: "Member-owned morning review" },
    });
    await expect(
      rpcPauseRoutine(env as CoreBindings, {
        context: fixture.contextFor("member"),
        routineId: memberRoutine.id,
      })
    ).resolves.toMatchObject({ routine: { status: "paused" } });
    await expect(
      rpcResumeRoutine(env as CoreBindings, {
        context: fixture.contextFor("member"),
        routineId: memberRoutine.id,
      })
    ).resolves.toMatchObject({ routine: { status: "enabled" } });
    await expect(
      rpcDeleteRoutine(env as CoreBindings, {
        context: fixture.contextFor("member"),
        routineId: memberRoutine.id,
      })
    ).resolves.toMatchObject({ deleted: true });
    await expect(
      countRoutineAuditActions(fixture.organizationId, memberRoutine.id)
    ).resolves.toEqual({
      create_routine: 1,
      delete_routine: 1,
      pause_routine: 1,
      resume_routine: 1,
      update_routine: 1,
    });
    const ownerRoutine = await createRoutineFor(fixture, "owner", {
      name: "Owner routine",
    });
    const memberContext = fixture.contextFor("member");
    const rejectedOperations = [
      () =>
        rpcUpdateRoutine(env as CoreBindings, {
          context: memberContext,
          name: "Unauthorized update",
          routineId: ownerRoutine.id,
        }),
      () =>
        rpcPauseRoutine(env as CoreBindings, {
          context: memberContext,
          routineId: ownerRoutine.id,
        }),
      () =>
        rpcResumeRoutine(env as CoreBindings, {
          context: memberContext,
          routineId: ownerRoutine.id,
        }),
      () =>
        rpcDeleteRoutine(env as CoreBindings, {
          context: memberContext,
          routineId: ownerRoutine.id,
        }),
    ];
    for (const operation of rejectedOperations) {
      await expect(operation()).rejects.toThrow("routine.forbidden");
    }
    const ownerAuditAfterRejections = await countRoutineAuditEntries(
      fixture.organizationId,
      ownerRoutine.id
    );
    expect(ownerAuditAfterRejections).toBe(1);
    const adminManagedRoutine = await createRoutineFor(fixture, "member", {
      name: "Admin-managed member Routine",
    });
    const adminContext = fixture.contextFor("admin");
    await expect(
      rpcUpdateRoutine(env as CoreBindings, {
        context: adminContext,
        instructions: "Admin-updated instructions.",
        routineId: adminManagedRoutine.id,
      })
    ).resolves.toMatchObject({
      routine: { updatedByUserId: fixture.users.admin.userId },
    });
    await expect(
      rpcPauseRoutine(env as CoreBindings, {
        context: adminContext,
        routineId: adminManagedRoutine.id,
      })
    ).resolves.toMatchObject({ routine: { status: "paused" } });
    await expect(
      rpcResumeRoutine(env as CoreBindings, {
        context: adminContext,
        routineId: adminManagedRoutine.id,
      })
    ).resolves.toMatchObject({ routine: { status: "enabled" } });
    await expect(
      rpcDeleteRoutine(env as CoreBindings, {
        context: adminContext,
        routineId: adminManagedRoutine.id,
      })
    ).resolves.toMatchObject({ deleted: true });
    await expect(
      rpcListRoutines(env as CoreBindings, { context: memberContext })
    ).resolves.toMatchObject({
      routines: [{ id: ownerRoutine.id, canManage: false }],
    });
  });
  it("fails closed when the caller is not an Organization member", async () => {
    const fixture = await seedRoutineFixture();
    await getPostgresDatabase(env).query({
      ...{
        text: 'DELETE FROM "openmeld"."members" WHERE organization_id = $1 AND user_id = $2',
        values: [],
      },
      values: [fixture.organizationId, fixture.users.member.userId],
    });
    const context = fixture.contextFor("member");
    await expect(
      rpcListRoutines(env as CoreBindings, { context })
    ).rejects.toThrow("organization.membership_required");
    await expect(
      rpcCreateRoutine(env as CoreBindings, {
        context,
        ...cronSpaceRoutineInput(fixture.targetSpaceId, "0 9 * * *", "UTC"),
        instructions: "This must not persist.",
        name: "Rejected routine",
      })
    ).rejects.toThrow("organization.membership_required");
    await expect(
      rpcListRoutineRuns(env as CoreBindings, {
        context,
        routineId: "routine-not-visible",
      })
    ).rejects.toThrow("organization.membership_required");
    await expect(
      countOrganizationRoutines(fixture.organizationId)
    ).resolves.toBe(0);
    await expect(
      countOrganizationAuditEntries(fixture.organizationId)
    ).resolves.toBe(0);
  });
  it("rejects unknown fields at every direct Routine mutation RPC boundary", async () => {
    const fixture = await seedRoutineFixture();
    const context = fixture.contextFor("owner");
    const routine = await createRoutineFor(fixture, "owner");
    const invalidOperations = [
      () =>
        rpcCreateRoutine(
          env as CoreBindings,
          {
            context,
            ...cronSpaceRoutineInput(
              fixture.targetSpaceId,
              "0 10 * * *",
              "UTC"
            ),
            instructions: "This request must be rejected.",
            name: "Unknown create field",
            unknown: true,
          } as Parameters<typeof rpcCreateRoutine>[1]
        ),
      () =>
        rpcUpdateRoutine(
          env as CoreBindings,
          {
            context,
            name: "Unknown update field",
            routineId: routine.id,
            unknown: true,
          } as Parameters<typeof rpcUpdateRoutine>[1]
        ),
      () =>
        rpcPauseRoutine(
          env as CoreBindings,
          {
            context,
            routineId: routine.id,
            unknown: true,
          } as Parameters<typeof rpcPauseRoutine>[1]
        ),
      () =>
        rpcResumeRoutine(
          env as CoreBindings,
          {
            context,
            routineId: routine.id,
            unknown: true,
          } as Parameters<typeof rpcResumeRoutine>[1]
        ),
      () =>
        rpcDeleteRoutine(
          env as CoreBindings,
          {
            context,
            routineId: routine.id,
            unknown: true,
          } as Parameters<typeof rpcDeleteRoutine>[1]
        ),
    ];
    for (const operation of invalidOperations) {
      await expect(operation()).rejects.toThrow("invalid_payload");
    }
    await expect(
      countRoutineAuditEntries(fixture.organizationId, routine.id)
    ).resolves.toBe(1);
    await expect(
      countOrganizationRoutines(fixture.organizationId)
    ).resolves.toBe(1);
  });
  it("allows all 50 Routines to be enabled and enforces one definition limit", async () => {
    vi.spyOn(Date, "now").mockReturnValue(FIXED_NOW_MS);
    const activeFixture = await seedRoutineFixture();
    const activeRoutineIds = await seedRoutineRows(
      activeFixture,
      49,
      "enabled"
    );
    const fiftieth = await createRoutineFor(activeFixture, "owner", {
      name: "Fiftieth enabled Routine",
    });
    expect(fiftieth.status).toBe("enabled");
    await rpcPauseRoutine(env as CoreBindings, {
      context: activeFixture.contextFor("owner"),
      routineId: activeRoutineIds[0] ?? "missing",
    });
    await expect(
      rpcResumeRoutine(env as CoreBindings, {
        context: activeFixture.contextFor("owner"),
        routineId: activeRoutineIds[0] ?? "missing",
      })
    ).resolves.toMatchObject({ routine: { status: "enabled" } });
    await expect(
      countRoutineAuditEntries(
        activeFixture.organizationId,
        activeRoutineIds[0] ?? "missing"
      )
    ).resolves.toBe(2);
    const totalFixture = await seedRoutineFixture();
    await seedRoutineRows(totalFixture, 50, "paused");
    await expect(
      createRoutineFor(totalFixture, "owner", { name: "Over total limit" })
    ).rejects.toThrow("routine.total_limit_reached");
    await expect(
      countOrganizationRoutines(totalFixture.organizationId)
    ).resolves.toBe(50);
    await expect(
      countOrganizationAuditEntries(totalFixture.organizationId)
    ).resolves.toBe(0);
  });
  it("records only the winning Routine status mutation when requests race", async () => {
    vi.spyOn(Date, "now").mockReturnValue(FIXED_NOW_MS);
    const fixture = await seedRoutineFixture();
    const context = fixture.contextFor("owner");
    const routine = await createRoutineFor(fixture, "owner");
    const pauseResults = await Promise.allSettled([
      rpcPauseRoutine(env as CoreBindings, { context, routineId: routine.id }),
      rpcPauseRoutine(env as CoreBindings, { context, routineId: routine.id }),
    ]);
    expect(summarizeMutationRace(pauseResults)).toEqual({
      fulfilled: 1,
      rejected: [expect.stringContaining("Routine is already paused.")],
    });
    await expect(
      countRoutineAuditActions(fixture.organizationId, routine.id)
    ).resolves.toMatchObject({ create_routine: 1, pause_routine: 1 });
    const resumeResults = await Promise.allSettled([
      rpcResumeRoutine(env as CoreBindings, { context, routineId: routine.id }),
      rpcResumeRoutine(env as CoreBindings, { context, routineId: routine.id }),
    ]);
    expect(summarizeMutationRace(resumeResults)).toEqual({
      fulfilled: 1,
      rejected: [expect.stringContaining("Routine is already enabled.")],
    });
    await expect(
      countRoutineAuditActions(fixture.organizationId, routine.id)
    ).resolves.toMatchObject({
      create_routine: 1,
      pause_routine: 1,
      resume_routine: 1,
    });
  });
  it("allows paused definitions to resume concurrently up to all 50 enabled", async () => {
    vi.spyOn(Date, "now").mockReturnValue(FIXED_NOW_MS);
    const fixture = await seedRoutineFixture();
    await seedRoutineRows(fixture, 48, "enabled");
    const pausedRoutineIds = await seedRoutineRows(fixture, 2, "paused");
    const context = fixture.contextFor("owner");
    const results = await Promise.allSettled(
      pausedRoutineIds.map((routineId) =>
        rpcResumeRoutine(env as CoreBindings, { context, routineId })
      )
    );
    expect(summarizeMutationRace(results)).toEqual({
      fulfilled: 2,
      rejected: [],
    });
    const auditActions = await Promise.all(
      pausedRoutineIds.map((routineId) =>
        countRoutineAuditActions(fixture.organizationId, routineId)
      )
    );
    expect(
      auditActions.reduce(
        (total, actions) => total + (actions.resume_routine ?? 0),
        0
      )
    ).toBe(2);
  });
  it("accepts the same public, visible private, and healthy Center Agent DM targets that it lists", async () => {
    vi.spyOn(Date, "now").mockReturnValue(FIXED_NOW_MS);
    const fixture = await seedRoutineFixture();
    const representedHuman = fixture.users.member;
    const publicTargetSpaceId = `space_public_${crypto.randomUUID()}`;
    const visiblePrivateTargetSpaceId = `space_private_${crypto.randomUUID()}`;
    const centerAgentDirectMessageSpaceId = `space_ca_dm_${crypto.randomUUID()}`;
    await seedRoutineTargetSpaces(fixture, [
      {
        memberships: [centerAgentMembership(fixture)],
        name: "Public Routine target",
        spaceId: publicTargetSpaceId,
        visibility: "public",
      },
      {
        memberships: [
          centerAgentMembership(fixture),
          humanMembership(
            representedHuman,
            `human_same_owner_${crypto.randomUUID()}`
          ),
        ],
        name: "Visible private Routine target",
        spaceId: visiblePrivateTargetSpaceId,
        visibility: "private",
      },
      {
        activeAgentCount: 0,
        activeHumanCount: 0,
        activeMemberCount: 99,
        directMessagePairKey: buildDirectMessagePairKey(
          representedHuman.humanProfileId,
          fixture.centerAgentProfileId
        ),
        memberships: [
          centerAgentMembership(fixture),
          humanMembership(representedHuman),
        ],
        name: "Member and Center Agent",
        purpose: "openmeld_dm_space",
        spaceCreatedAtMs: FIXED_NOW_MS,
        spaceId: centerAgentDirectMessageSpaceId,
        visibility: "private",
      },
    ]);
    const availableTargets = await rpcListRoutineTargetSpaces(
      env as CoreBindings,
      { context: fixture.contextFor("member") }
    );
    expect(availableTargets.spaces).toEqual(
      expect.arrayContaining([
        {
          kind: "space",
          name: "Public Routine target",
          spaceId: publicTargetSpaceId,
        },
        {
          kind: "space",
          name: "Visible private Routine target",
          spaceId: visiblePrivateTargetSpaceId,
        },
        {
          kind: "center_agent_dm",
          name: "Member and Center Agent",
          spaceId: centerAgentDirectMessageSpaceId,
        },
      ])
    );
    const routine = await createRoutineFor(fixture, "member", {
      targetSpaceId: publicTargetSpaceId,
    });
    await expect(
      rpcUpdateRoutine(env as CoreBindings, {
        context: fixture.contextFor("member"),
        routineId: routine.id,
        targetSpaceId: visiblePrivateTargetSpaceId,
      })
    ).resolves.toMatchObject({
      routine: { targetSpaceId: visiblePrivateTargetSpaceId },
    });
    await expect(
      rpcUpdateRoutine(env as CoreBindings, {
        context: fixture.contextFor("member"),
        routineId: routine.id,
        targetSpaceId: centerAgentDirectMessageSpaceId,
      })
    ).resolves.toMatchObject({
      routine: { targetSpaceId: centerAgentDirectMessageSpaceId },
    });
    await expect(
      countRoutineAuditActions(fixture.organizationId, routine.id)
    ).resolves.toEqual({ create_routine: 1, update_routine: 2 });
  });
  it("validates a target-scoped Space beyond the bounded Routine target list", async () => {
    vi.spyOn(Date, "now").mockReturnValue(FIXED_NOW_MS);
    const fixture = await seedRoutineFixture();
    const bulkSpacePrefix = `bulk${crypto.randomUUID().replaceAll("-", "")}`;
    const targetSpaceId = `${bulkSpacePrefix}501`;
    await getPostgresDatabase(env).transaction(async (client) =>
      (async () => {
        const results: QueryResult[] = [];
        for (const query of [
          {
            ...{
              text: `
          WITH RECURSIVE sequence(value) AS (
            SELECT 1
            UNION ALL
            SELECT value + 1 FROM sequence WHERE value < 501
          )
          INSERT INTO "openmeld"."space_index_spaces" (
            space_id,
            organization_id,
            organization_visibility,
            status,
            space_name,
            source_updated_at_ms,
            projected_at_ms,
            projection_event_id
          )
          SELECT
            $1 || lpad(value::text, 3, '0'),
            $2,
            'public',
            'active',
            'Bulk Routine target ' || lpad(value::text, 3, '0'),
            $3,
            $4,
            $5 || lpad(value::text, 3, '0')
          FROM sequence
        `,
              values: [],
            },
            values: [
              bulkSpacePrefix,
              fixture.organizationId,
              FIXED_NOW_MS,
              FIXED_NOW_MS,
              `projection_${crypto.randomUUID()}_`,
            ],
          },
          {
            ...{
              text: `
          INSERT INTO "openmeld"."space_index_memberships" (
            space_id,
            profile_id,
            profile_kind_snapshot,
            profile_name_snapshot,
            owner_user_id_snapshot,
            status,
            member_source,
            added_at_ms,
            source_updated_at_ms,
            projected_at_ms,
            projection_event_id
          )
          SELECT
            space_id,
            $1,
            'agent',
            'Center Agent',
            $2,
            'active',
            'member_add',
            $3,
            $4,
            $5,
            'membership_' || space_id
          FROM "openmeld"."space_index_spaces"
          WHERE space_id LIKE $6
        `,
              values: [],
            },
            values: [
              fixture.centerAgentProfileId,
              fixture.users.owner.userId,
              FIXED_NOW_MS,
              FIXED_NOW_MS,
              FIXED_NOW_MS,
              `${bulkSpacePrefix}%`,
            ],
          },
        ]) {
          results.push(await client.query(query));
        }
        return results;
      })()
    );
    const listed = await rpcListRoutineTargetSpaces(env as CoreBindings, {
      context: fixture.contextFor("member"),
    });
    expect(listed.spaces).toHaveLength(500);
    expect(listed.spaces.some((space) => space.spaceId === targetSpaceId)).toBe(
      false
    );
    await expect(
      createRoutineFor(fixture, "member", { targetSpaceId })
    ).resolves.toMatchObject({ targetSpaceId });
  });
  it("does not reveal an invisible private target when the Center Agent designation is missing", async () => {
    const fixture = await seedRoutineFixture();
    const invisiblePrivateSpaceId = `space_invisible_${crypto.randomUUID()}`;
    await seedRoutineTargetSpaces(fixture, [
      {
        memberships: [centerAgentMembership(fixture)],
        name: "Invisible private target",
        spaceId: invisiblePrivateSpaceId,
        visibility: "private",
      },
    ]);
    await getPostgresDatabase(env).query({
      ...{
        text: 'DELETE FROM "openmeld"."center_agent_designations" WHERE organization_id = $1',
        values: [],
      },
      values: [fixture.organizationId],
    });
    await expect(
      createRoutineFor(fixture, "member", {
        targetSpaceId: invisiblePrivateSpaceId,
      })
    ).rejects.toThrow("routine.target_space_not_found");
    await expect(createRoutineFor(fixture, "member")).rejects.toThrow(
      "routine.center_agent_required"
    );
    await expect(
      readRoutineSideEffects(fixture.organizationId)
    ).resolves.toEqual({ audit: 0, routines: 0 });
  });
  it.each([
    "member",
    "owner",
    "admin",
  ] as const)("does not let an Organization %s bypass represented-human target eligibility with a known Space ID", async (role) => {
    vi.spyOn(Date, "now").mockReturnValue(FIXED_NOW_MS);
    const fixture = await seedRoutineFixture();
    const representedHuman = fixture.users[role];
    const invisiblePrivateSpaceId = `space_invisible_${crypto.randomUUID()}`;
    const legacySpaceId = `space_legacy_${crypto.randomUUID()}`;
    const otherDirectMessageSpaceId = `space_other_dm_${crypto.randomUUID()}`;
    const degradedDirectMessageSpaceId = `space_degraded_dm_${crypto.randomUUID()}`;
    const otherHumanProfileId = `human_other_${crypto.randomUUID()}`;
    await seedRoutineTargetSpaces(fixture, [
      {
        memberships: [centerAgentMembership(fixture)],
        name: "Invisible private target",
        spaceId: invisiblePrivateSpaceId,
        visibility: "private",
      },
      {
        memberships: [
          centerAgentMembership(fixture),
          humanMembership(representedHuman),
        ],
        name: "Legacy welcoming target",
        purpose: "openmeld_welcoming_space",
        spaceId: legacySpaceId,
        visibility: "public",
      },
      {
        directMessagePairKey: buildDirectMessagePairKey(
          otherHumanProfileId,
          fixture.centerAgentProfileId
        ),
        memberships: [
          centerAgentMembership(fixture),
          {
            ownerUserId: `user_other_${crypto.randomUUID()}`,
            profileId: otherHumanProfileId,
            profileKind: "human",
          },
        ],
        name: "Another member and Center Agent",
        purpose: "openmeld_dm_space",
        spaceCreatedAtMs: FIXED_NOW_MS,
        spaceId: otherDirectMessageSpaceId,
        visibility: "public",
      },
      {
        activeAgentCount: 1,
        activeHumanCount: 1,
        activeMemberCount: 2,
        directMessagePairKey: buildDirectMessagePairKey(
          representedHuman.humanProfileId,
          fixture.centerAgentProfileId
        ),
        memberships: [
          centerAgentMembership(fixture),
          humanMembership(representedHuman),
          {
            ownerUserId: `user_third_${crypto.randomUUID()}`,
            profileId: `human_third_${crypto.randomUUID()}`,
            profileKind: "human",
          },
        ],
        name: "Degraded Center Agent DM",
        purpose: "openmeld_dm_space",
        spaceCreatedAtMs: FIXED_NOW_MS,
        spaceId: degradedDirectMessageSpaceId,
        visibility: "public",
      },
    ]);
    const routine = await createRoutineFor(fixture, role);
    for (const targetSpaceId of [
      invisiblePrivateSpaceId,
      legacySpaceId,
      otherDirectMessageSpaceId,
      degradedDirectMessageSpaceId,
    ]) {
      await expect(
        createRoutineFor(fixture, role, {
          name: `Rejected target ${targetSpaceId}`,
          targetSpaceId,
        })
      ).rejects.toThrow("routine.target_space_not_found");
      await expect(
        rpcUpdateRoutine(env as CoreBindings, {
          context: fixture.contextFor(role),
          routineId: routine.id,
          targetSpaceId,
        })
      ).rejects.toThrow("routine.target_space_not_found");
    }
    await expect(
      rpcListRoutines(env as CoreBindings, {
        context: fixture.contextFor(role),
      })
    ).resolves.toMatchObject({
      routines: [{ id: routine.id, targetSpaceId: fixture.targetSpaceId }],
    });
    await expect(
      countOrganizationRoutines(fixture.organizationId)
    ).resolves.toBe(1);
    await expect(
      countOrganizationAuditEntries(fixture.organizationId)
    ).resolves.toBe(1);
    await expect(
      countRoutineAuditActions(fixture.organizationId, routine.id)
    ).resolves.toEqual({ create_routine: 1 });
  });
  it("rejects missing, cross-Organization, and unpublishable target Spaces without persistence", async () => {
    const missingFixture = await seedRoutineFixture();
    const missingTargetInput = {
      context: missingFixture.contextFor("owner"),
      ...cronSpaceRoutineInput(
        missingFixture.targetSpaceId,
        "0 9 * * *",
        "UTC"
      ),
      instructions: "This must not persist.",
      name: "Missing target",
      targetSpaceId: null,
    } as Parameters<typeof rpcCreateRoutine>[1];
    await expect(
      rpcCreateRoutine(env as CoreBindings, missingTargetInput)
    ).rejects.toThrow("invalid_payload");
    await expect(
      createRoutineFor(missingFixture, "owner", {
        targetSpaceId: `space_missing_${crypto.randomUUID()}`,
      })
    ).rejects.toThrow("routine.target_space_not_found");
    await expect(
      readRoutineSideEffects(missingFixture.organizationId)
    ).resolves.toEqual({ audit: 0, routines: 0 });
    const crossOrganizationFixture = await seedRoutineFixture();
    const foreignOrganizationId = `org_foreign_${crypto.randomUUID()}`;
    const foreignSpaceId = `space_foreign_${crypto.randomUUID()}`;
    await getPostgresDatabase(env).transaction(async (client) =>
      (async () => {
        const results: QueryResult[] = [];
        for (const query of [
          {
            ...{
              text: 'INSERT INTO "openmeld"."organizations" (id, name, slug, created_at) VALUES ($1, \'Foreign Organization\', $2, $3)',
              values: [],
            },
            values: [
              foreignOrganizationId,
              `foreign-${crypto.randomUUID()}`,
              FIXED_NOW_MS,
            ],
          },
          buildSpaceProjectionStatement(foreignSpaceId, foreignOrganizationId),
        ]) {
          results.push(await client.query(query));
        }
        return results;
      })()
    );
    await expect(
      createRoutineFor(crossOrganizationFixture, "owner", {
        targetSpaceId: foreignSpaceId,
      })
    ).rejects.toThrow("routine.target_space_org_mismatch");
    await expect(
      readRoutineSideEffects(crossOrganizationFixture.organizationId)
    ).resolves.toEqual({ audit: 0, routines: 0 });
    const unpublishableFixture = await seedRoutineFixture();
    await getPostgresDatabase(env).query({
      ...{
        text: 'DELETE FROM "openmeld"."space_index_memberships" WHERE space_id = $1 AND profile_id = $2',
        values: [],
      },
      values: [
        unpublishableFixture.targetSpaceId,
        unpublishableFixture.centerAgentProfileId,
      ],
    });
    await expect(
      createRoutineFor(unpublishableFixture, "owner")
    ).rejects.toThrow("routine.target_space_publication_unavailable");
    await expect(
      readRoutineSideEffects(unpublishableFixture.organizationId)
    ).resolves.toEqual({ audit: 0, routines: 0 });
  });
  it("rejects invalid cron, schedules under five minutes, and invalid timezones without persistence", async () => {
    const fixture = await seedRoutineFixture();
    const invalidSchedules = [
      {
        cronExpression: "not a cron",
        expectedCode: "routine.schedule.invalid_cron",
        timezone: "UTC",
      },
      {
        cronExpression: "*/4 * * * *",
        expectedCode: "routine.schedule.too_frequent",
        timezone: "UTC",
      },
      {
        cronExpression: "0 9 * * *",
        expectedCode: "routine.schedule.invalid_timezone",
        timezone: "PST",
      },
    ];
    for (const invalid of invalidSchedules) {
      await expect(createRoutineFor(fixture, "owner", invalid)).rejects.toThrow(
        invalid.expectedCode
      );
    }
    await expect(
      readRoutineSideEffects(fixture.organizationId)
    ).resolves.toEqual({ audit: 0, routines: 0 });
  });
  it("keeps Routine run history readable by Organization members after deletion", async () => {
    const fixture = await seedRoutineFixture();
    const routine = await createRoutineFor(fixture, "owner");
    const runId = `routine_run_${crypto.randomUUID()}`;
    await getPostgresDatabase(env).query({
      ...{
        text: `
        INSERT INTO "openmeld"."routine_runs" (
          id, routine_id, organization_id, scheduled_for, status, scope_snapshot, created_by_user_id_snapshot, target_space_id_snapshot
        ) VALUES ($1, $2, $3, $4, 'completed', 'team', $5, $6)
      `,
        values: [],
      },
      values: [
        runId,
        routine.id,
        fixture.organizationId,
        FIXED_NOW_MS,
        fixture.users.owner.userId,
        fixture.targetSpaceId,
      ],
    });
    await rpcDeleteRoutine(env as CoreBindings, {
      context: fixture.contextFor("owner"),
      routineId: routine.id,
    });
    await expect(
      rpcListRoutineRuns(env as CoreBindings, {
        context: fixture.contextFor("member"),
        routineId: routine.id,
      })
    ).resolves.toMatchObject({
      organizationId: fixture.organizationId,
      routineId: routine.id,
      runs: [{ id: runId, status: "completed" }],
    });
  });
});
type FixtureRole = "owner" | "admin" | "member";
type FixtureUser = {
  humanProfileId: string;
  memberId: string;
  role: FixtureRole;
  userId: string;
};
async function seedRoutineFixture() {
  const suffix = crypto.randomUUID();
  const organizationId = `org_routine_${suffix}`;
  const targetSpaceId = `space_routine_${suffix}`;
  const centerAgentProfileId = `agt_${crypto.randomUUID()}`;
  const nowMs = FIXED_NOW_MS;
  const users = {
    owner: buildFixtureUser("owner"),
    admin: buildFixtureUser("admin"),
    member: buildFixtureUser("member"),
  };
  ownedRoutineOrganizationIds.add(organizationId);
  for (const user of Object.values(users)) {
    await getPostgresDatabase(env).transaction(async (client) =>
      (async () => {
        const results: QueryResult[] = [];
        for (const query of [
          {
            ...{
              text: `
          INSERT INTO "openmeld"."users" (
            id, name, email, email_verified, created_at, updated_at
          ) VALUES ($1, $2, $3, 1, $4, $5)
        `,
              values: [],
            },
            values: [
              user.userId,
              `${user.role} user`,
              `${user.userId}@example.com`,
              nowMs,
              nowMs,
            ],
          },
          {
            ...{
              text: `
          INSERT INTO "openmeld"."openmeld_profiles" (
            profile_id,
            profile_name,
            profile_handle,
            profile_kind,
            is_default,
            status,
            organization_id,
            owner_user_id,
            created_by_user_id,
            source,
            created_at,
            updated_at
          ) VALUES ($1, $2, $3, 'human', 1, 'active', NULL, $4, $5, 'auth_bootstrap', $6, $7)
        `,
              values: [],
            },
            values: [
              user.humanProfileId,
              `${user.role} user`,
              `${user.role}-${suffix}`,
              user.userId,
              user.userId,
              nowMs,
              nowMs,
            ],
          },
        ]) {
          results.push(await client.query(query));
        }
        return results;
      })()
    );
  }
  await getPostgresDatabase(env).query({
    ...{
      text: `
      INSERT INTO "openmeld"."organizations" (id, name, slug, created_at)
      VALUES ($1, 'Routine Test Organization', $2, $3)
    `,
      values: [],
    },
    values: [organizationId, `routine-${suffix}`, nowMs],
  });
  for (const user of Object.values(users)) {
    await getPostgresDatabase(env).query({
      ...{
        text: `
        INSERT INTO "openmeld"."members" (id, organization_id, user_id, role, created_at)
        VALUES ($1, $2, $3, $4, $5)
      `,
        values: [],
      },
      values: [user.memberId, organizationId, user.userId, user.role, nowMs],
    });
  }
  await getPostgresDatabase(env).transaction(async (client) =>
    (async () => {
      const results: QueryResult[] = [];
      for (const query of [
        {
          ...{
            text: `
        INSERT INTO "openmeld"."openmeld_profiles" (
          profile_id,
          profile_name,
          profile_handle,
          profile_kind,
          is_default,
          status,
          organization_id,
          owner_user_id,
          created_by_user_id,
          source,
          managed_role,
          created_at,
          updated_at
        ) VALUES ($1, 'Routine Test Center Agent', $2, 'agent', 0, 'active', $3, NULL, $4, 'auth_bootstrap', 'center_agent', $5, $6)
      `,
            values: [],
          },
          values: [
            centerAgentProfileId,
            `routine-center-agent-${suffix}`,
            organizationId,
            users.owner.userId,
            nowMs,
            nowMs,
          ],
        },
        {
          ...{
            text: `
        INSERT INTO "openmeld"."center_agent_designations" (
          organization_id, agent_profile_id, duty, designated_by, created_at
        ) VALUES ($1, $2, NULL, $3, $4)
      `,
            values: [],
          },
          values: [
            organizationId,
            centerAgentProfileId,
            users.owner.userId,
            nowMs,
          ],
        },
        {
          ...{
            text: `
        INSERT INTO "openmeld"."space_index_spaces" (
          space_id,
          organization_id,
          organization_visibility,
          status,
          source_updated_at_ms,
          projected_at_ms,
          projection_event_id
        ) VALUES ($1, $2, 'public', 'active', $3, $4, $5)
      `,
            values: [],
          },
          values: [
            targetSpaceId,
            organizationId,
            nowMs,
            nowMs,
            `projection_${crypto.randomUUID()}`,
          ],
        },
        {
          ...{
            text: `
        INSERT INTO "openmeld"."space_index_memberships" (
          space_id,
          profile_id,
          profile_kind_snapshot,
          profile_name_snapshot,
          status,
          member_source,
          added_at_ms,
          source_updated_at_ms,
          projected_at_ms,
          projection_event_id
        ) VALUES ($1, $2, 'agent', 'Routine Test Center Agent', 'active', 'member_add', $3, $4, $5, $6)
      `,
            values: [],
          },
          values: [
            targetSpaceId,
            centerAgentProfileId,
            nowMs,
            nowMs,
            nowMs,
            `projection_${crypto.randomUUID()}`,
          ],
        },
      ]) {
        results.push(await client.query(query));
      }
      return results;
    })()
  );
  return {
    centerAgentProfileId,
    centerAgentContext: () => ({
      activeOrganizationId: organizationId,
      actorContext: {
        agentControllerRef: HOSTED_CENTER_AGENT_CONTROLLER_REF,
        callerPrincipalId: centerAgentProfileId,
        profileKind: "agent" as const,
        requestId: `request_${crypto.randomUUID()}`,
        openMeldProfileId: centerAgentProfileId,
      },
      agentControllerConversationId: `submission_${crypto.randomUUID()}`,
    }),
    contextFor: (role: FixtureRole) =>
      buildContext(organizationId, users[role]),
    organizationId,
    speakerFor: (role: FixtureRole) => ({
      memberId: users[role].memberId,
      userId: users[role].userId,
    }),
    targetSpaceId,
    users,
  };
}
type RoutineFixture = Awaited<ReturnType<typeof seedRoutineFixture>>;
type RoutineTargetSpaceMembershipFixture = {
  ownerUserId?: string | null;
  profileId: string;
  profileKind: "agent" | "human";
  status?: "active" | "removed";
};
type RoutineTargetSpaceFixture = {
  activeAgentCount?: number | null;
  activeHumanCount?: number | null;
  activeMemberCount?: number | null;
  directMessagePairKey?: string | null;
  memberships: RoutineTargetSpaceMembershipFixture[];
  name: string;
  organizationId?: string;
  purpose?: string | null;
  spaceCreatedAtMs?: number | null;
  spaceId: string;
  status?: "active" | "deleted";
  visibility: "private" | "public";
};
async function seedRoutineTargetSpaces(
  fixture: RoutineFixture,
  spaces: RoutineTargetSpaceFixture[]
): Promise<void> {
  const statements: QueryConfig[] = [];
  for (const space of spaces) {
    const projectionEventId = `projection_${crypto.randomUUID()}`;
    statements.push({
      ...{
        text: `
          INSERT INTO "openmeld"."space_index_spaces" (
            space_id,
            organization_id,
            organization_visibility,
            status,
            space_name,
            space_purpose,
            direct_message_pair_key,
            active_member_count,
            active_human_count,
            active_agent_count,
            space_created_at_ms,
            source_updated_at_ms,
            projected_at_ms,
            projection_event_id
          ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14)
        `,
        values: [],
      },
      values: [
        space.spaceId,
        space.organizationId ?? fixture.organizationId,
        space.visibility,
        space.status ?? "active",
        space.name,
        space.purpose ?? null,
        space.directMessagePairKey ?? null,
        space.activeMemberCount ?? null,
        space.activeHumanCount ?? null,
        space.activeAgentCount ?? null,
        space.spaceCreatedAtMs ?? null,
        FIXED_NOW_MS,
        FIXED_NOW_MS,
        projectionEventId,
      ],
    });
    for (const membership of space.memberships) {
      statements.push({
        ...{
          text: `
            INSERT INTO "openmeld"."space_index_memberships" (
              space_id,
              profile_id,
              profile_kind_snapshot,
              profile_name_snapshot,
              owner_user_id_snapshot,
              status,
              member_source,
              added_at_ms,
              source_updated_at_ms,
              projected_at_ms,
              projection_event_id
            ) VALUES ($1, $2, $3, $4, $5, $6, 'member_add', $7, $8, $9, $10)
          `,
          values: [],
        },
        values: [
          space.spaceId,
          membership.profileId,
          membership.profileKind,
          membership.profileKind === "agent" ? "Center Agent" : "Human",
          membership.ownerUserId ?? null,
          membership.status ?? "active",
          FIXED_NOW_MS,
          FIXED_NOW_MS,
          FIXED_NOW_MS,
          projectionEventId,
        ],
      });
    }
  }
  await getPostgresDatabase(env).transaction(async (client) =>
    (async () => {
      const results: QueryResult[] = [];
      for (const query of statements) {
        results.push(await client.query(query));
      }
      return results;
    })()
  );
}
function centerAgentMembership(
  fixture: RoutineFixture
): RoutineTargetSpaceMembershipFixture {
  return {
    ownerUserId: fixture.users.owner.userId,
    profileId: fixture.centerAgentProfileId,
    profileKind: "agent",
  };
}
function humanMembership(
  user: FixtureUser,
  profileId = user.humanProfileId
): RoutineTargetSpaceMembershipFixture {
  return {
    ownerUserId: user.userId,
    profileId,
    profileKind: "human",
  };
}
async function createRoutineFor(
  fixture: RoutineFixture,
  role: FixtureRole,
  overrides: Partial<{
    scope: "personal" | "team";
    agentProfileId: string;
    cronExpression: string;
    instructions: string;
    name: string;
    targetSpaceId: string;
    timezone: string;
  }> = {}
) {
  const response = await rpcCreateRoutine(env as CoreBindings, {
    context: fixture.contextFor(role),
    scope: overrides.scope,
    agentProfileId: overrides.agentProfileId,
    ...cronSpaceRoutineInput(
      overrides.targetSpaceId ?? fixture.targetSpaceId,
      overrides.cronExpression ?? "0 9 * * *",
      overrides.timezone ?? "UTC"
    ),
    instructions: overrides.instructions ?? "Review the current work queue.",
    name: overrides.name ?? "Morning review",
  });
  return response.routine;
}
async function createRoutineForCenterAgent(
  fixture: RoutineFixture,
  role: FixtureRole,
  overrides: Partial<{
    cronExpression: string;
    instructions: string;
    name: string;
    targetSpaceId: string;
    timezone: string;
  }> = {}
) {
  const response = await rpcCenterAgentCreateRoutine(env as CoreBindings, {
    context: fixture.centerAgentContext(),
    ...cronSpaceRoutineInput(
      overrides.targetSpaceId ?? fixture.targetSpaceId,
      overrides.cronExpression ?? "0 9 * * *",
      overrides.timezone ?? "UTC"
    ),
    instructions: overrides.instructions ?? "Review the current work queue.",
    name: overrides.name ?? "Morning review",
    speakerMember: fixture.speakerFor(role),
  });
  return response.routine;
}
async function seedAcceptedLocalAgentDelivery(input: {
  client: string;
  context: ReturnType<RoutineFixture["centerAgentContext"]>;
  fixture: RoutineFixture;
  role: FixtureRole;
}) {
  const suffix = crypto.randomUUID();
  const idempotencyKey = `local_agent_routine_${suffix}`;
  const representedUser = input.fixture.users[input.role];
  const delivery = await upsertRemoteAgentNativeDeliveryRecord({
    attemptId: null,
    bindingId: `binding_${suffix}`,
    db: getPostgresDatabase(env),
    dispatchId: idempotencyKey,
    idempotencyKey,
    nowMs: FIXED_NOW_MS - 2,
    onBehalfOfDisplayName: `${input.role} user`,
    onBehalfOfProfileId: representedUser.humanProfileId,
    onBehalfOfUserId: representedUser.userId,
    organizationId: input.fixture.organizationId,
    profileId: input.fixture.centerAgentProfileId,
    spaceId: `ca_dm_${suffix}`,
    status: "submitted",
    triggerMessageId: idempotencyKey,
  });
  await markRemoteAgentNativeDeliveryAck({
    accepted: true,
    db: getPostgresDatabase(env),
    idempotencyKey,
    nowMs: FIXED_NOW_MS - 1,
    submissionId: input.context.agentControllerConversationId,
  });
  await getPostgresDatabase(env).query({
    ...{
      text: `
      INSERT INTO "openmeld"."center_agent_audit_journal" (
        id,
        organization_id,
        actor_profile_id,
        action,
        on_behalf_of_profile_id,
        on_behalf_of_user_id,
        on_behalf_of_display_name,
        resource_type,
        resource_id,
        source_native_delivery_id,
        created_at
      ) VALUES ($1, $2, $3, 'receive_local_agent_request', $4, $5, $6, 'local_agent_client', $7, $8, $9)
    `,
      values: [],
    },
    values: [
      `audit_local_agent_${suffix}`,
      input.fixture.organizationId,
      input.fixture.centerAgentProfileId,
      representedUser.humanProfileId,
      representedUser.userId,
      `${input.role} user`,
      input.client,
      delivery.deliveryId,
      FIXED_NOW_MS - 1,
    ],
  });
  return delivery;
}
function cronSpaceRoutineInput(
  targetSpaceId: string,
  cronExpression: string,
  timezone: string
) {
  return {
    cronExpression,
    destinationKind: "space" as const,
    runAtMs: null,
    scheduleKind: "cron" as const,
    slackChannelId: null,
    slackConversationId: null,
    slackTeamId: null,
    slackThreadLabel: null,
    slackThreadTs: null,
    targetSpaceId,
    timezone,
  };
}
async function seedRoutineRows(
  fixture: RoutineFixture,
  count: number,
  status: "enabled" | "paused"
): Promise<string[]> {
  const routineIds = Array.from(
    { length: count },
    () => `routine_${crypto.randomUUID()}`
  );
  const statements = routineIds.map((routineId, index) => ({
    ...{
      text: `
        INSERT INTO "openmeld"."routines" (
          id,
          organization_id,
          name,
          instructions,
          schedule_kind,
          cron_expression,
          timezone,
          target_space_id,
          status,
          next_due_at,
          created_by_user_id,
          updated_by_user_id,
          created_at_ms,
          updated_at_ms
        ) VALUES ($1, $2, $3, 'Review the work queue.', 'cron', '0 9 * * *', 'UTC', $4, $5, $6, $7, $8, $9, $10)
      `,
      values: [],
    },
    values: [
      routineId,
      fixture.organizationId,
      `Seeded Routine ${index + 1}`,
      fixture.targetSpaceId,
      status,
      status === "enabled" ? FIXED_NOW_MS + 60_000 : null,
      fixture.users.owner.userId,
      fixture.users.owner.userId,
      FIXED_NOW_MS,
      FIXED_NOW_MS,
    ],
  }));
  await getPostgresDatabase(env).transaction(async (client) =>
    (async () => {
      const results: QueryResult[] = [];
      for (const query of statements) {
        results.push(await client.query(query));
      }
      return results;
    })()
  );
  return routineIds;
}
function buildSpaceProjectionStatement(
  spaceId: string,
  organizationId: string
): QueryConfig {
  return {
    ...{
      text: `
      INSERT INTO "openmeld"."space_index_spaces" (
        space_id,
        organization_id,
        organization_visibility,
        status,
        source_updated_at_ms,
        projected_at_ms,
        projection_event_id
      ) VALUES ($1, $2, 'private', 'active', $3, $4, $5)
    `,
      values: [],
    },
    values: [
      spaceId,
      organizationId,
      FIXED_NOW_MS,
      FIXED_NOW_MS,
      `projection_${crypto.randomUUID()}`,
    ],
  };
}
function buildRoutineRunStatement(input: {
  failureCode?: string | null;
  failureDetail?: string | null;
  finishedAtMs?: number | null;
  id: string;
  nativeDeliveryId?: string | null;
  organizationId: string;
  publishedSignalId?: string | null;
  routineId: string;
  scheduledFor: number;
  startedAtMs?: number | null;
  status: CenterAgentRoutineRun["status"];
}): QueryConfig {
  return {
    ...{
      text: `
      INSERT INTO "openmeld"."routine_runs" (
        id,
        routine_id,
        organization_id,
        scheduled_for,
        status,
        failure_code,
        failure_detail,
        native_delivery_id,
        published_signal_id,
        started_at_ms,
        finished_at_ms, scope_snapshot, created_by_user_id_snapshot,
        target_space_id_snapshot
      ) SELECT $1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11,
        scope, created_by_user_id, target_space_id
        FROM openmeld.routines WHERE id=$2
    `,
      values: [],
    },
    values: [
      input.id,
      input.routineId,
      input.organizationId,
      input.scheduledFor,
      input.status,
      input.failureCode ?? null,
      input.failureDetail ?? null,
      input.nativeDeliveryId ?? null,
      input.publishedSignalId ?? null,
      input.startedAtMs ?? null,
      input.finishedAtMs ?? null,
    ],
  };
}
async function countRoutineAuditEntries(
  organizationId: string,
  routineId: string
): Promise<number> {
  const row = await getPostgresDatabase(env)
    .query<{
      count: number;
    }>({
      ...{
        text: `
      SELECT COUNT(*) AS count
      FROM "openmeld"."center_agent_audit_journal"
      WHERE organization_id = $1 AND resource_id = $2
    `,
        values: [],
      },
      values: [organizationId, routineId],
    })
    .then((result) => result.rows[0] ?? null);
  return Number(row?.count ?? 0);
}
async function countRoutineAuditActions(
  organizationId: string,
  routineId: string
): Promise<Record<string, number>> {
  const result = await getPostgresDatabase(env).query<{
    action: string;
    count: number;
  }>({
    ...{
      text: `
      SELECT action, COUNT(*) AS count
      FROM "openmeld"."center_agent_audit_journal"
      WHERE organization_id = $1 AND resource_id = $2
      GROUP BY action
    `,
      values: [],
    },
    values: [organizationId, routineId],
  });
  return Object.fromEntries(
    (result.rows ?? []).map((row) => [row.action, Number(row.count)])
  );
}
async function countOrganizationAuditEntries(
  organizationId: string
): Promise<number> {
  const row = await getPostgresDatabase(env)
    .query<{
      count: number;
    }>({
      ...{
        text: `
      SELECT COUNT(*) AS count
      FROM "openmeld"."center_agent_audit_journal"
      WHERE organization_id = $1
    `,
        values: [],
      },
      values: [organizationId],
    })
    .then((result) => result.rows[0] ?? null);
  return Number(row?.count ?? 0);
}
async function countOrganizationRoutines(
  organizationId: string
): Promise<number> {
  const row = await getPostgresDatabase(env)
    .query<{
      count: number;
    }>({
      ...{
        text: 'SELECT COUNT(*) AS count FROM "openmeld"."routines" WHERE organization_id = $1',
        values: [],
      },
      values: [organizationId],
    })
    .then((result) => result.rows[0] ?? null);
  return Number(row?.count ?? 0);
}
async function readRoutineSideEffects(organizationId: string): Promise<{
  audit: number;
  routines: number;
}> {
  const [audit, routines] = await Promise.all([
    countOrganizationAuditEntries(organizationId),
    countOrganizationRoutines(organizationId),
  ]);
  return { audit, routines };
}
async function cleanupOwnedRoutineRows(): Promise<void> {
  const cleanupErrors: Error[] = [];
  for (const organizationId of ownedRoutineOrganizationIds) {
    const cleanupSteps = [
      [
        "Agent Activity session rows",
        {
          ...{
            text: 'DELETE FROM "openmeld"."agent_activity_sessions" WHERE organization_id = $1',
            values: [],
          },
          values: [organizationId],
        },
      ],
      [
        "Agent Activity Project rows",
        {
          ...{
            text: 'DELETE FROM "openmeld"."projects" WHERE organization_id = $1',
            values: [],
          },
          values: [organizationId],
        },
      ],
      [
        "native delivery rows",
        {
          ...{
            text: 'DELETE FROM "openmeld"."openMeldRemoteAgent_native_delivery_ledger" WHERE organization_id = $1',
            values: [],
          },
          values: [organizationId],
        },
      ],
      [
        "Routine Run rows",
        {
          ...{
            text: 'DELETE FROM "openmeld"."routine_runs" WHERE organization_id = $1',
            values: [],
          },
          values: [organizationId],
        },
      ],
      [
        "Routine rows",
        {
          ...{
            text: 'DELETE FROM "openmeld"."routines" WHERE organization_id = $1',
            values: [],
          },
          values: [organizationId],
        },
      ],
    ] as const;
    for (const [description, statement] of cleanupSteps) {
      try {
        await getPostgresDatabase(env).query({
          text: statement.text,
          values: [...statement.values],
        });
      } catch (cause) {
        cleanupErrors.push(
          new Error(
            `Failed to clean owned ${description} for Organization ${organizationId}.`,
            { cause }
          )
        );
      }
    }
  }
  if (cleanupErrors.length > 0) {
    throw new AggregateError(
      cleanupErrors,
      "Failed to clean owned Routine integration test rows."
    );
  }
  ownedRoutineOrganizationIds.clear();
}
function buildFixtureUser(role: FixtureRole): FixtureUser {
  return {
    humanProfileId: crypto.randomUUID(),
    memberId: `member_${crypto.randomUUID()}`,
    role,
    userId: `user_${crypto.randomUUID()}`,
  };
}
function buildContext(organizationId: string, user: FixtureUser) {
  return {
    activeOrganizationId: organizationId,
    actorContext: {
      callerPrincipalId: user.userId,
      ownerUserId: user.userId,
      profileKind: "human" as const,
      profileName: `${user.role} user`,
      requestId: `request_${crypto.randomUUID()}`,
      openMeldProfileId: user.humanProfileId,
    },
  };
}
function summarizeMutationRace<T>(results: PromiseSettledResult<T>[]): {
  fulfilled: number;
  rejected: string[];
} {
  return {
    fulfilled: results.filter((result) => result.status === "fulfilled").length,
    rejected: results
      .filter(
        (result): result is PromiseRejectedResult =>
          result.status === "rejected"
      )
      .map((result) =>
        result.reason instanceof Error
          ? result.reason.message
          : String(result.reason)
      ),
  };
}
