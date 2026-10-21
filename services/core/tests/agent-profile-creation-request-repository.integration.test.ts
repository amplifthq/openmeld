import type { QueryResult } from "@openmeld/db/postgresql";
import { getPostgresDatabase } from "@openmeld/db/postgresql";
import { DEFAULT_AGENT_PROFILE_CREATION_CONFIGURATION } from "@openmeld/schemas";
import { describe, expect, it, vi } from "vitest";
import { runAgentProfileCreationPostBindingFollowUps } from "../src/agent-profile-creation-request/agent-profile-creation-post-binding-follow-ups";
import {
  checkpointAgentProfileCreationPostBindingStep,
  readAgentProfileCreationPostBindingProgress,
} from "../src/agent-profile-creation-request/agent-profile-creation-post-binding-progress";
import { createPostgresAgentProfileCreationRequestRepository } from "../src/agent-profile-creation-request/agent-profile-creation-request-repository";
import {
  AGENT_PROFILE_CREATION_STALE_AFTER_MS,
  type AgentProfileCreationRequestRecord,
  failStaleAgentProfileCreationRequests,
} from "../src/agent-profile-creation-request/agent-profile-creation-request-service";
import { env } from "../test-support/worker-env";

describe("Agent Profile creation request repository", () => {
  it("retains completed setup steps across a failed request and retry", async () => {
    const suffix = crypto.randomUUID();
    const organizationId = `org-apcr-${suffix}`;
    const requesterUserId = `user-requester-${suffix}`;
    const targetOwnerUserId = `user-target-${suffix}`;
    await seedIdentity({ organizationId, requesterUserId, targetOwnerUserId });
    const repository = createPostgresAgentProfileCreationRequestRepository(
      getPostgresDatabase(env)
    );
    const agentProfileId = `agt_${crypto.randomUUID()}`;
    const request = {
      ...buildRequestRecord({
        organizationId,
        requesterUserId,
        suffix,
        targetOwnerUserId,
      }),
      createdAgentProfileId: agentProfileId,
      profileCreationAttempt: 1,
      status: "approved" as const,
      statusReason: "profile_created" as const,
    };
    await repository.insert(request);
    try {
      const setWorkspace = vi.fn(() => Promise.resolve());
      const updateDefaultProject = vi
        .fn<() => Promise<void>>()
        .mockRejectedValueOnce(
          new Error("Default Project temporarily unavailable")
        )
        .mockResolvedValueOnce();
      const run = async (profileCreationAttempt: number) =>
        await runAgentProfileCreationPostBindingFollowUps({
          checkpoint: async (step) =>
            await checkpointAgentProfileCreationPostBindingStep({
              agentProfileId,
              db: getPostgresDatabase(env),
              profileCreationAttempt,
              requestId: request.id,
              step,
            }),
          completed: await readAgentProfileCreationPostBindingProgress({
            agentProfileId,
            db: getPostgresDatabase(env),
            profileCreationAttempt,
            requestId: request.id,
          }),
          setWorkspace,
          updateDefaultProject,
        });
      await expect(run(1)).rejects.toThrow("temporarily unavailable");
      const failed = await repository.transition({
        expectedProfileCreationAttempt: 1,
        expectedStatuses: ["approved"],
        expectedUpdatedAtMs: request.updatedAtMs,
        requestId: request.id,
        update: {
          failureMessage: "Default Project temporarily unavailable",
          status: "failed",
          updatedAtMs: request.updatedAtMs + 1,
        },
      });
      const approved = await repository.transition({
        expectedStatuses: ["failed"],
        expectedUpdatedAtMs: failed?.updatedAtMs ?? 0,
        requestId: request.id,
        update: {
          failureMessage: null,
          status: "approved",
          updatedAtMs: request.updatedAtMs + 2,
        },
      });
      const retried = await repository.claimProfileCreation({
        expectedProfileCreationStartedAtMs: null,
        expectedUpdatedAtMs: approved?.updatedAtMs ?? 0,
        requestId: request.id,
        startedAtMs: request.updatedAtMs + 3,
      });
      expect(retried?.profileCreationAttempt).toBe(2);
      await run(2);
      expect(setWorkspace).toHaveBeenCalledOnce();
      expect(updateDefaultProject).toHaveBeenCalledTimes(2);
      await expect(
        readAgentProfileCreationPostBindingProgress({
          agentProfileId,
          db: getPostgresDatabase(env),
          profileCreationAttempt: 2,
          requestId: request.id,
        })
      ).resolves.toEqual({ workspace: true, defaultProject: true });
    } finally {
      await getPostgresDatabase(env).query({
        ...{
          text: 'DELETE FROM "openmeld"."agent_profile_creation_requests" WHERE id = $1',
          values: [],
        },
        values: [request.id],
      });
    }
  });
  it("persists participant visibility, idempotency, transitions, and preferences", async () => {
    const suffix = crypto.randomUUID();
    const organizationId = `org-apcr-${suffix}`;
    const requesterUserId = `user-requester-${suffix}`;
    const targetOwnerUserId = `user-target-${suffix}`;
    await seedIdentity({ organizationId, requesterUserId, targetOwnerUserId });
    const repository = createPostgresAgentProfileCreationRequestRepository(
      getPostgresDatabase(env)
    );
    const record = buildRequestRecord({
      organizationId,
      requesterUserId,
      suffix,
      targetOwnerUserId,
    });
    await expect(
      repository.insert(record, { inboxProjection: "project" })
    ).resolves.toEqual(record);
    await expect(
      repository.findByIdempotencyKey({
        idempotencyKey: record.idempotencyKey,
        organizationId,
        requesterUserId,
      })
    ).resolves.toEqual(record);
    await expect(
      repository.listForParticipant({
        organizationId,
        userId: requesterUserId,
      })
    ).resolves.toEqual([record]);
    await expect(
      repository.listForParticipant({
        organizationId,
        userId: targetOwnerUserId,
      })
    ).resolves.toEqual([record]);
    await expect(
      repository.getInboxProjectionByRequestId(record.id)
    ).resolves.toMatchObject({
      attemptCount: 0,
      generation: 1,
      operation: "project",
      status: "pending",
    });
    await expect(
      repository.markInboxProjectionFailed({
        failedAtMs: record.updatedAtMs + 100,
        generation: 1,
        lastError: "temporary Inbox failure",
        nextRetryAtMs: record.updatedAtMs + 200,
        requestId: record.id,
      })
    ).resolves.toBe(true);
    await expect(
      repository.listDueInboxProjections({
        limit: 10,
        nowMs: record.updatedAtMs + 199,
      })
    ).resolves.toEqual([]);
    await expect(
      repository.listDueInboxProjections({
        limit: 10,
        nowMs: record.updatedAtMs + 200,
      })
    ).resolves.toHaveLength(1);
    const approved = await repository.transition({
      expectedStatuses: ["pending"],
      expectedUpdatedAtMs: record.updatedAtMs,
      inboxProjection: "resolve",
      requestId: record.id,
      update: {
        decidedAtMs: 1_787_220_001_000,
        status: "approved",
        statusReason: "target_approved",
        updatedAtMs: 1_787_220_001_000,
      },
    });
    const claimed = await repository.claimProfileCreation({
      expectedProfileCreationStartedAtMs: null,
      expectedUpdatedAtMs: approved?.updatedAtMs ?? 0,
      requestId: record.id,
      startedAtMs: 1_787_220_002_000,
    });
    await expect(
      repository.listStaleProfileCreations({
        limit: 10,
        staleBeforeMs: 1_787_220_001_999,
      })
    ).resolves.toEqual([]);
    await expect(
      repository.listStaleProfileCreations({
        limit: 10,
        staleBeforeMs: 1_787_220_002_000,
      })
    ).resolves.toEqual([claimed]);
    const completed = await repository.transition({
      expectedProfileCreationAttempt: claimed?.profileCreationAttempt,
      expectedStatuses: ["approved"],
      expectedUpdatedAtMs: claimed?.updatedAtMs ?? 0,
      requestId: record.id,
      update: {
        completedAtMs: 1_787_220_003_000,
        createdAgentProfileId: "agt_11111111-1111-4111-8111-111111111111",
        status: "completed",
        statusReason: "profile_created",
        updatedAtMs: 1_787_220_003_000,
      },
    });
    expect(completed).toMatchObject({
      status: "completed",
      statusReason: "profile_created",
    });
    await expect(
      repository.getInboxProjectionByRequestId(record.id)
    ).resolves.toMatchObject({
      attemptCount: 0,
      generation: 2,
      operation: "resolve",
      status: "pending",
    });
    await expect(
      repository.markInboxProjectionCompleted({
        completedAtMs: record.updatedAtMs + 250,
        generation: 2,
        requestId: record.id,
      })
    ).resolves.toBe(true);
    await expect(
      repository.markInboxProjectionCompleted({
        completedAtMs: record.updatedAtMs + 300,
        generation: 1,
        requestId: record.id,
      })
    ).resolves.toBe(false);
    await expect(
      repository.getInboxProjectionByRequestId(record.id)
    ).resolves.toMatchObject({ generation: 2, status: "pending" });
    await expect(
      repository.transition({
        expectedStatuses: ["pending"],
        expectedUpdatedAtMs: completed?.updatedAtMs ?? 0,
        requestId: record.id,
        update: { status: "cancelled" },
      })
    ).resolves.toBeNull();
    await expect(
      repository.upsertPreference({
        existingSessionPolicy: "never_allow",
        newSessionPolicy: "automatically_allow",
        nowMs: 1_787_220_002_000,
        organizationId,
        userId: targetOwnerUserId,
      })
    ).resolves.toMatchObject({
      existingSessionPolicy: "never_allow",
      newSessionPolicy: "automatically_allow",
    });
    await expect(
      repository.getPreference({ organizationId, userId: targetOwnerUserId })
    ).resolves.toMatchObject({
      existingSessionPolicy: "never_allow",
      newSessionPolicy: "automatically_allow",
    });
  });
  it("repairs projection intent for requests written without the new outbox columns", async () => {
    const suffix = crypto.randomUUID();
    const organizationId = `org-apcr-legacy-${suffix}`;
    const requesterUserId = `user-requester-${suffix}`;
    const targetOwnerUserId = `user-target-${suffix}`;
    await seedIdentity({ organizationId, requesterUserId, targetOwnerUserId });
    const repository = createPostgresAgentProfileCreationRequestRepository(
      getPostgresDatabase(env)
    );
    const record = buildRequestRecord({
      organizationId,
      requesterUserId,
      suffix,
      targetOwnerUserId,
    });
    await repository.insert(record);
    await expect(
      repository.synchronizeInboxProjectionIntents({ requestId: record.id })
    ).resolves.toBe(1);
    await expect(
      repository.getInboxProjectionByRequestId(record.id)
    ).resolves.toMatchObject({
      generation: 1,
      operation: "project",
      status: "pending",
    });
    const declined = await repository.transition({
      expectedStatuses: ["pending"],
      expectedUpdatedAtMs: record.updatedAtMs,
      requestId: record.id,
      update: {
        decidedAtMs: record.updatedAtMs + 1,
        status: "declined",
        statusReason: "target_declined",
        updatedAtMs: record.updatedAtMs + 1,
      },
    });
    expect(declined?.status).toBe("declined");
    await expect(
      repository.synchronizeInboxProjectionIntents({ requestId: record.id })
    ).resolves.toBe(1);
    await expect(
      repository.getInboxProjectionByRequestId(record.id)
    ).resolves.toMatchObject({
      generation: 2,
      operation: "resolve",
      status: "pending",
    });
  });
  it("recovers an approved durable request abandoned before its creation claim", async () => {
    const suffix = crypto.randomUUID();
    const organizationId = `org-apcr-unclaimed-${suffix}`;
    const requesterUserId = `user-requester-${suffix}`;
    const targetOwnerUserId = `user-target-${suffix}`;
    await seedIdentity({ organizationId, requesterUserId, targetOwnerUserId });
    const repository = createPostgresAgentProfileCreationRequestRepository(
      getPostgresDatabase(env)
    );
    const pending = buildRequestRecord({
      organizationId,
      requesterUserId,
      suffix,
      targetOwnerUserId,
    });
    await repository.insert(pending, { inboxProjection: "project" });
    const approvedAtMs = pending.updatedAtMs + 1000;
    const approved = await repository.transition({
      expectedStatuses: ["pending"],
      expectedUpdatedAtMs: pending.updatedAtMs,
      inboxProjection: "resolve",
      requestId: pending.id,
      update: {
        decidedAtMs: approvedAtMs,
        status: "approved",
        statusReason: "target_approved",
        updatedAtMs: approvedAtMs,
      },
    });
    expect(approved).toMatchObject({
      profileCreationAttempt: 0,
      profileCreationStartedAtMs: null,
      status: "approved",
    });
    await expect(
      failStaleAgentProfileCreationRequests({
        nowMs: approvedAtMs + AGENT_PROFILE_CREATION_STALE_AFTER_MS - 1,
        repository,
      })
    ).resolves.toEqual({ markedFailed: 0, scanned: 0, superseded: 0 });
    await expect(
      failStaleAgentProfileCreationRequests({
        nowMs: approvedAtMs + AGENT_PROFILE_CREATION_STALE_AFTER_MS,
        repository,
      })
    ).resolves.toEqual({ markedFailed: 1, scanned: 1, superseded: 0 });
    await expect(
      repository.getById({ organizationId, requestId: pending.id })
    ).resolves.toMatchObject({
      failureMessage:
        "OpenMeld lost contact while creating this Agent. Retry to continue safely.",
      profileCreationAttempt: 0,
      profileCreationStartedAtMs: null,
      status: "failed",
      statusReason: "profile_creation_failed",
    });
    await expect(
      failStaleAgentProfileCreationRequests({
        nowMs: approvedAtMs + AGENT_PROFILE_CREATION_STALE_AFTER_MS + 1,
        repository,
      })
    ).resolves.toEqual({ markedFailed: 0, scanned: 0, superseded: 0 });
  });
});
function buildRequestRecord(input: {
  organizationId: string;
  requesterUserId: string;
  suffix: string;
  targetOwnerUserId: string;
}): AgentProfileCreationRequestRecord {
  return {
    actorProfileId: `human-${input.suffix}`,
    completedAtMs: null,
    configuration: DEFAULT_AGENT_PROFILE_CREATION_CONFIGURATION,
    createdAgentProfileId: null,
    createdAtMs: 1_787_220_000_000,
    decidedAtMs: null,
    failureMessage: null,
    id: `apcr_${input.suffix}`,
    idempotencyKey: `key-${input.suffix}`,
    nativeSessionId: null,
    organizationId: input.organizationId,
    profileCreationAttempt: 0,
    profileCreationStartedAtMs: null,
    profileName: "Release Reviewer",
    requestedSpaceId: null,
    requesterUserId: input.requesterUserId,
    sessionStrategy: "new",
    source: "web",
    status: "pending",
    statusReason: "approval_required",
    targetOwnerUserId: input.targetOwnerUserId,
    updatedAtMs: 1_787_220_000_000,
  };
}
async function seedIdentity(input: {
  organizationId: string;
  requesterUserId: string;
  targetOwnerUserId: string;
}): Promise<void> {
  const createdAt = 1_787_220_000_000;
  await getPostgresDatabase(env).transaction(async (client) =>
    (async () => {
      const results: QueryResult[] = [];
      for (const query of [
        {
          ...{
            text: 'INSERT INTO "openmeld"."organizations" (id, name, slug, created_at) VALUES ($1, $2, $3, $4)',
            values: [],
          },
          values: [
            input.organizationId,
            "Agent Profile Creation Request Test",
            input.organizationId,
            createdAt,
          ],
        },
        ...[input.requesterUserId, input.targetOwnerUserId].map((userId) => ({
          ...{
            text: 'INSERT INTO "openmeld"."users" (id, name, email, email_verified, created_at, updated_at) VALUES ($1, $2, $3, 1, $4, $5)',
            values: [],
          },
          values: [
            userId,
            userId,
            `${userId}@openmeld.invalid`,
            createdAt,
            createdAt,
          ],
        })),
      ]) {
        results.push(await client.query(query));
      }
      return results;
    })()
  );
}
