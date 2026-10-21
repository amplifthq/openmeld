import { env } from "cloudflare:test";
import { randomUUID } from "node:crypto";
import { getPostgresDatabase } from "@openmeld/db/postgresql";
import { describe, expect, it } from "vitest";
import {
  PERMISSION_MODE_ADVISOR_COOLDOWN_MS,
  readPermissionModeAdvisorSignal,
  resolvePermissionModeAdvisoryForDispatch,
} from "../src/agent-profile/application/permission-mode-advisor";
import {
  listCurrentPermissionModeSuggestions,
  offerPermissionModeSuggestionForWake,
  resolvePermissionModeSuggestionForOwner,
} from "../src/agent-profile/application/permission-mode-suggestion-card";
import { listPendingPermissionModeSuggestionCards } from "../src/agent-profile/infrastructure/postgresql/permission-mode-advisor-repo";
import { recordAgentTaskNeedsAttentionObservation } from "../src/agent-task-coordination/infrastructure/postgresql/agent-task-coordination-repo";
import {
  buildRuntimeCoordinatorInteractionAttentionEventId,
  runtimeCoordinatorInteractionAttentionCode,
} from "../src/runtime-transport/application/runtime-coordinator-interaction-attention";

const DAY_MS = 24 * 60 * 60 * 1000;
const NOW_MS = Date.UTC(2026, 9, 18, 12);

type Fixture = Awaited<ReturnType<typeof seedOrganization>>;

function db() {
  const database = getPostgresDatabase(env);
  if (!database) {
    throw new Error("PostgreSQL is unavailable in tests.");
  }
  return database;
}

async function seedUserWithHumanProfile(name: string) {
  const userId = `user-${randomUUID()}`;
  const profileId = randomUUID();
  await db().query({
    text: `INSERT INTO "openmeld"."users" (id, name, email, email_verified, created_at, updated_at)
      VALUES ($1, $2, $3, 1, $4, $4)`,
    values: [userId, name, `${userId}@example.com`, NOW_MS],
  });
  await db().query({
    text: `INSERT INTO "openmeld"."openmeld_profiles" (
        profile_id, profile_name, profile_handle, profile_kind, is_default, status,
        organization_id, owner_user_id, created_by_user_id, creator_profile_id,
        source, managed_role, last_used_at, created_at, updated_at)
      VALUES ($1, $2, $3, 'human', 1, 'active', NULL, $4, $4, NULL, 'auth_bootstrap', NULL, NULL, $5, $5)`,
    values: [profileId, name, `h-${randomUUID().slice(0, 8)}`, userId, NOW_MS],
  });
  return { profileId, userId };
}

async function seedOrganization() {
  const organizationId = `org-advisor-${randomUUID()}`;
  await db().query({
    text: `INSERT INTO "openmeld"."organizations" (id, name, slug, created_at) VALUES ($1, 'Advisor', $2, $3)`,
    values: [organizationId, `advisor-${randomUUID().slice(0, 8)}`, NOW_MS],
  });
  const owner = await seedUserWithHumanProfile("Felix Lu");
  const tali = await seedUserWithHumanProfile("Tali Chen");
  const sam = await seedUserWithHumanProfile("Sam Ortiz");
  const agentProfileId = `agt_${randomUUID()}`;
  const ownerSecondAgentProfileId = `agt_${randomUUID()}`;
  for (const [profileId, name] of [
    [agentProfileId, "Claude Code"],
    [ownerSecondAgentProfileId, "PR Reviewer"],
  ] as const) {
    await db().query({
      text: `INSERT INTO "openmeld"."openmeld_profiles" (
          profile_id, profile_name, profile_handle, profile_kind, is_default, status,
          organization_id, owner_user_id, created_by_user_id, creator_profile_id,
          source, managed_role, last_used_at, created_at, updated_at)
        VALUES ($1, $2, $3, 'agent', 0, 'active', $4, $5, $5, NULL, 'auth_bootstrap', NULL, NULL, $6, $6)`,
      values: [
        profileId,
        name,
        `a-${randomUUID().slice(0, 8)}`,
        organizationId,
        owner.userId,
        NOW_MS,
      ],
    });
  }
  return {
    agentProfileId,
    organizationId,
    owner,
    ownerSecondAgentProfileId,
    sam,
    spaceId: `space-${randomUUID()}`,
    tali,
  };
}

/** One Wake of the advisor's Profile with the given interactions. */
async function seedWake(input: {
  fixture: Fixture;
  interactions: readonly {
    atMs: number;
    kind: "permission" | "plan_review" | "question";
  }[];
  requesterProfileId: string;
}) {
  const dispatchId = `dispatch-${randomUUID()}`;
  const clientMessageId = `msg-${randomUUID()}`;
  const executionId = `rce-${randomUUID()}`;
  const startedAtMs = input.interactions[0]?.atMs ?? NOW_MS - DAY_MS;
  await db().query({
    text: `INSERT INTO "openmeld"."openMeldDaemon_dispatch_ledger" (
        idempotency_key, dispatch_id, space_id, source_event_id, source_profile_id,
        source_client_message_id, target_profile_id, status, first_seen_at_ms,
        last_attempt_at_ms, attempt_count)
      VALUES ($1, $2, $3, $4, $5, $6, $7, 'completed', $8, $8, 1)`,
    values: [
      `idem-${dispatchId}`,
      dispatchId,
      input.fixture.spaceId,
      `signal-${dispatchId}`,
      input.requesterProfileId,
      clientMessageId,
      input.fixture.agentProfileId,
      startedAtMs,
    ],
  });
  await db().query({
    text: `INSERT INTO "openmeld"."openMeldDaemon_runtime_coordinator_executions" (
        runtime_coordinator_execution_id, model_version, space_id, dispatch_id,
        target_profile_id, source_client_message_id, openmeld_service_runtime_id_source,
        openmeld_service_runtime_id, binding_id, agent_controller_ref, status,
        created_at_ms, updated_at_ms)
      VALUES ($1, 'openmeld.runtime_coordinator.execution.v1', $2, $3, $4, $5, 'reported',
        'runtime-1', 'binding-1', 'builtin:claude-code', 'reply_published', $6, $7)`,
    values: [
      executionId,
      input.fixture.spaceId,
      dispatchId,
      input.fixture.agentProfileId,
      clientMessageId,
      startedAtMs,
      startedAtMs + 60_000,
    ],
  });
  for (const interaction of input.interactions) {
    const interactionId = `interaction-${randomUUID()}`;
    const observation = {
      attentionCode: runtimeCoordinatorInteractionAttentionCode(
        interaction.kind
      ),
      eventId: buildRuntimeCoordinatorInteractionAttentionEventId({
        interactionId,
        runtimeCoordinatorExecutionId: executionId,
      }),
      occurredAtMs: interaction.atMs,
      status: "needs_attention" as const,
    };
    const task = {
      kind: "space_wake" as const,
      sourceClientMessageId: clientMessageId,
      spaceId: input.fixture.spaceId,
      targetProfileId: input.fixture.agentProfileId,
      v: 1 as const,
    };
    // A replayed interaction request writes the same record again.
    for (const _attempt of [1, 2]) {
      await recordAgentTaskNeedsAttentionObservation({
        db: db(),
        nowMs: interaction.atMs,
        observation,
        task,
      });
    }
  }
  return { dispatchId };
}

function permissionsAt(...daysAgo: number[]) {
  return daysAgo.map((days) => ({
    atMs: NOW_MS - days * DAY_MS,
    kind: "permission" as const,
  }));
}

function advisoryInput(
  fixture: Fixture,
  overrides: Record<string, unknown> = {}
) {
  return {
    agentControllerRef: "builtin:claude-code",
    agentProfileId: fixture.agentProfileId,
    db: db(),
    dispatchId: `owner-dispatch-${randomUUID()}`,
    nowMs: NOW_MS,
    organizationId: fixture.organizationId,
    ownerUserId: fixture.owner.userId,
    requesterIsAgentOwner: true,
    savedPermissionMode: null,
    ...overrides,
  };
}

describe("permission-mode advisor", () => {
  it("does not suggest below three waiting approvals from other people", async () => {
    const fixture = await seedOrganization();
    await seedWake({
      fixture,
      interactions: permissionsAt(1, 2),
      requesterProfileId: fixture.tali.profileId,
    });
    // The owner's own approvals, other interaction kinds and approvals older
    // than the window never count.
    await seedWake({
      fixture,
      interactions: permissionsAt(1, 1, 1),
      requesterProfileId: fixture.owner.profileId,
    });
    await seedWake({
      fixture,
      interactions: [
        { atMs: NOW_MS - DAY_MS, kind: "plan_review" },
        { atMs: NOW_MS - DAY_MS, kind: "question" },
        ...permissionsAt(8),
      ],
      requesterProfileId: fixture.sam.profileId,
    });
    await expect(
      readPermissionModeAdvisorSignal({
        agentProfileId: fixture.agentProfileId,
        db: db(),
        nowMs: NOW_MS,
        ownerUserId: fixture.owner.userId,
      })
    ).resolves.toEqual({
      topRequesterNames: ["Tali Chen"],
      waitingApprovalCount: 2,
    });
    await expect(
      resolvePermissionModeAdvisoryForDispatch(advisoryInput(fixture))
    ).resolves.toBeNull();
  });

  it("suggests once after three colleague approvals and not again within a week", async () => {
    const fixture = await seedOrganization();
    await seedWake({
      fixture,
      interactions: permissionsAt(1, 2),
      requesterProfileId: fixture.tali.profileId,
    });
    await seedWake({
      fixture,
      interactions: permissionsAt(3),
      requesterProfileId: fixture.sam.profileId,
    });
    // The owner's other Agent counts as the owner, not as a colleague.
    await seedWake({
      fixture,
      interactions: permissionsAt(1),
      requesterProfileId: fixture.ownerSecondAgentProfileId,
    });
    const firstDispatchId = `owner-dispatch-${randomUUID()}`;
    const advisory = await resolvePermissionModeAdvisoryForDispatch(
      advisoryInput(fixture, { dispatchId: firstDispatchId })
    );
    expect(advisory).toEqual({
      currentPermissionMode: "claude-code:default",
      currentPermissionModeLabel: "Ask permissions",
      suggestedPermissionMode: "claude-code:acceptEdits",
      suggestedPermissionModeLabel: "Accept edits",
      topRequesterNames: ["Tali Chen", "Sam Ortiz"],
      waitingApprovalCount: 3,
      windowDays: 7,
    });
    // A redelivery of the same Wake gets the same block.
    await expect(
      resolvePermissionModeAdvisoryForDispatch(
        advisoryInput(fixture, { dispatchId: firstDispatchId })
      )
    ).resolves.toEqual(advisory);
    // The owner's next task inside the week gets nothing.
    await expect(
      resolvePermissionModeAdvisoryForDispatch(
        advisoryInput(fixture, { nowMs: NOW_MS + 6 * DAY_MS })
      )
    ).resolves.toBeNull();
    // After the week, fresh colleague approvals can suggest again.
    const nextWeekMs = NOW_MS + PERMISSION_MODE_ADVISOR_COOLDOWN_MS + DAY_MS;
    await seedWake({
      fixture,
      interactions: [1, 2, 3].map(() => ({
        atMs: nextWeekMs - DAY_MS,
        kind: "permission" as const,
      })),
      requesterProfileId: fixture.tali.profileId,
    });
    await expect(
      resolvePermissionModeAdvisoryForDispatch(
        advisoryInput(fixture, { nowMs: nextWeekMs })
      )
    ).resolves.toMatchObject({ waitingApprovalCount: 3 });
  });

  it("never gives the block to a task whose requester is not the owner", async () => {
    const fixture = await seedOrganization();
    await seedWake({
      fixture,
      interactions: permissionsAt(1, 1, 1, 1),
      requesterProfileId: fixture.tali.profileId,
    });
    for (const requesterIsAgentOwner of [false, undefined]) {
      await expect(
        resolvePermissionModeAdvisoryForDispatch(
          advisoryInput(fixture, { requesterIsAgentOwner })
        )
      ).resolves.toBeNull();
    }
    // No suggestion was used up, so the owner still gets it.
    await expect(
      resolvePermissionModeAdvisoryForDispatch(advisoryInput(fixture))
    ).resolves.toMatchObject({ waitingApprovalCount: 4 });
  });

  it("never suggests from a mode without a safe next step", async () => {
    const fixture = await seedOrganization();
    await seedWake({
      fixture,
      interactions: permissionsAt(1, 1, 1),
      requesterProfileId: fixture.tali.profileId,
    });
    for (const savedPermissionMode of [
      "claude-code:auto",
      "claude-code:bypassPermissions",
      "claude-code:plan",
    ]) {
      await expect(
        resolvePermissionModeAdvisoryForDispatch(
          advisoryInput(fixture, { savedPermissionMode })
        )
      ).resolves.toBeNull();
    }
  });

  it("offers the card only for the advised Wake and lets only the owner close it", async () => {
    const fixture = await seedOrganization();
    await seedWake({
      fixture,
      interactions: permissionsAt(1, 2, 3),
      requesterProfileId: fixture.tali.profileId,
    });
    const advisedDispatchId = `owner-dispatch-${randomUUID()}`;
    await resolvePermissionModeAdvisoryForDispatch(
      advisoryInput(fixture, { dispatchId: advisedDispatchId })
    );
    const offerInput = {
      agentProfileId: fixture.agentProfileId,
      db: db(),
      dispatchId: advisedDispatchId,
      nowMs: NOW_MS + 1000,
      ownerUserId: fixture.owner.userId,
      spaceId: fixture.spaceId,
    };
    // Another Wake, such as a colleague's task, cannot open the card.
    await expect(
      offerPermissionModeSuggestionForWake({
        ...offerInput,
        dispatchId: `colleague-dispatch-${randomUUID()}`,
      })
    ).rejects.toMatchObject({ status: 409 });
    await expect(
      offerPermissionModeSuggestionForWake({
        ...offerInput,
        ownerUserId: fixture.tali.userId,
      })
    ).rejects.toMatchObject({ status: 409 });
    const offered = await offerPermissionModeSuggestionForWake(offerInput);
    expect(offered).toMatchObject({
      status: "offered",
      suggestion: {
        suggestedPermissionMode: "claude-code:acceptEdits",
        waitingApprovalCount: 3,
      },
    });
    await expect(
      offerPermissionModeSuggestionForWake(offerInput)
    ).resolves.toMatchObject({ status: "already_offered" });
    await expect(
      listPendingPermissionModeSuggestionCards({
        db: db(),
        offeredSinceMs: NOW_MS - DAY_MS,
        organizationId: fixture.organizationId,
        ownerUserId: fixture.tali.userId,
        spaceId: fixture.spaceId,
      })
    ).resolves.toEqual([]);
    const listInput = {
      db: db(),
      nowMs: NOW_MS + 1500,
      organizationId: fixture.organizationId,
      ownerUserId: fixture.owner.userId,
      spaceId: fixture.spaceId,
    };
    await expect(
      listCurrentPermissionModeSuggestions({
        ...listInput,
        readCurrentPermissionMode: async () => "claude-code:default",
      })
    ).resolves.toMatchObject({
      suggestions: [{ suggestionId: offered.suggestion.suggestionId }],
    });
    // A mode changed elsewhere makes the card stale, so it is hidden.
    await expect(
      listCurrentPermissionModeSuggestions({
        ...listInput,
        readCurrentPermissionMode: async () => "claude-code:plan",
      })
    ).resolves.toEqual({ suggestions: [] });

    const resolveInput = {
      db: db(),
      nowMs: NOW_MS + 2000,
      organizationId: fixture.organizationId,
      resolution: "applied" as const,
      suggestionId: offered.suggestion.suggestionId,
    };
    await expect(
      resolvePermissionModeSuggestionForOwner({
        ...resolveInput,
        actingUserId: fixture.tali.userId,
      })
    ).rejects.toMatchObject({ status: 403 });
    await expect(
      resolvePermissionModeSuggestionForOwner({
        ...resolveInput,
        actingUserId: fixture.owner.userId,
      })
    ).resolves.toEqual({
      status: "applied",
      suggestionId: offered.suggestion.suggestionId,
    });
    await expect(
      offerPermissionModeSuggestionForWake(offerInput)
    ).resolves.toMatchObject({ status: "already_resolved" });
  });
});
