import type { PostgresDatabase } from "@openmeld/db/postgresql";
import type {
  CenterAgentAttribution,
  CenterAgentWakePublicationCommand,
} from "@openmeld/schemas/types";
import { describe, expect, it, vi } from "vitest";
import { readAgentDelegation } from "../src/agent-task-coordination/infrastructure/postgresql/agent-delegation-repo";
import { readAgentTaskCompletionSubscription } from "../src/agent-task-coordination/infrastructure/postgresql/agent-task-coordination-repo";
import { planCenterAgentWakeDelegation } from "../src/center-agent/application/center-agent-delegation-service";
import {
  executeCenterAgentWakePublication,
  prepareCenterAgentWakePublication,
  retryPendingCenterAgentWakePublications,
} from "../src/center-agent/application/center-agent-wake-publication-service";
import {
  claimCenterAgentWakePublication,
  markCenterAgentWakePublicationAccepted,
  readCenterAgentWakePublication,
} from "../src/center-agent/infrastructure/postgresql/center-agent-wake-publication-repo";
import { createPostgresHarness } from "./helpers/postgresql-harness.test-support";

const CENTER_AGENT_PROFILE_ID = "agt_00000000-0000-4000-8000-000000000001";
const CHILD_PROFILE_ID = "agt_00000000-0000-4000-8000-000000000002";
const HUMAN_PROFILE_ID = "00000000-0000-4000-8000-000000000003";
const CLIENT_MESSAGE_ID = "ca-wake:durable-publication";
describe("Center Agent Wake publication recovery", () => {
  it("redrives an outcome-unknown Space publication and completes coordination once", async () => {
    const harness = await createHarness();
    const publishSignal = vi
      .fn()
      .mockRejectedValueOnce(
        Object.assign(new Error("Durable Object transport failed"), {
          retryable: true,
        })
      )
      .mockResolvedValue(buildSignal());
    try {
      await insertAuditIdentity(harness.db);
      await insertParentDelivery(harness.db);
      const prepared = planCenterAgentWakeDelegation({
        childSpaceId: "space-child",
        clientMessageId: CLIENT_MESSAGE_ID,
        targetProfileIds: [CHILD_PROFILE_ID],
      });
      await prepareCenterAgentWakePublication({
        command: buildCommand({
          delegationId: prepared.delegationId,
          referenceTargets: [HUMAN_PROFILE_ID],
          subscriptionIds: prepared.subscriptionIds,
        }),
        db: harness.db,
        nowMs: 1000,
      });
      await expect(
        readAgentDelegation({
          db: harness.db,
          delegationId: prepared.delegationId,
        })
      ).resolves.toBeNull();
      await expect(
        executeCenterAgentWakePublication({
          db: harness.db,
          nowMs: 1010,
          publicationId: CLIENT_MESSAGE_ID,
          publishSignal,
          resolveSignal: async () => null,
        })
      ).resolves.toEqual({
        attribution: expect.any(Object),
        retryAfterSeconds: 15,
        status: "pending",
      });
      await expect(
        readCenterAgentWakePublication({
          db: harness.db,
          publicationId: CLIENT_MESSAGE_ID,
        })
      ).resolves.toMatchObject({
        attemptCount: 1,
        command: {
          referenceTargets: [HUMAN_PROFILE_ID],
        },
        state: "pending",
      });
      await expect(
        readAgentDelegation({
          db: harness.db,
          delegationId: prepared.delegationId,
        })
      ).resolves.toMatchObject({
        children: [{ state: "planned" }],
        state: "active",
      });
      await expect(
        retryPendingCenterAgentWakePublications({
          db: harness.db,
          nowMs: 61_010,
          publishSignal,
          resolveSignal: async () => null,
        })
      ).resolves.toEqual({
        completed: 1,
        deferred: 0,
        failed: 0,
        rescheduled: 0,
      });
      expect(publishSignal).toHaveBeenCalledTimes(2);
      await expect(
        readCenterAgentWakePublication({
          db: harness.db,
          publicationId: CLIENT_MESSAGE_ID,
        })
      ).resolves.toMatchObject({
        signal: { id: "signal-child" },
        state: "completed",
      });
      await expect(
        executeCenterAgentWakePublication({
          db: harness.db,
          nowMs: 61_020,
          publicationId: CLIENT_MESSAGE_ID,
          publishSignal,
          resolveSignal: async () => null,
        })
      ).resolves.toMatchObject({
        signal: { id: "signal-child" },
        status: "accepted",
      });
      expect(publishSignal).toHaveBeenCalledTimes(2);
      await expect(
        readAgentDelegation({
          db: harness.db,
          delegationId: prepared.delegationId,
        })
      ).resolves.toMatchObject({
        children: [{ state: "active" }],
        state: "active",
      });
      const auditRows = await harness.db.query<{
        action: string;
        id: string;
      }>({
        text: 'SELECT id, action FROM "openmeld"."center_agent_audit_journal" ORDER BY id ASC',
        values: [],
      });
      expect(auditRows.rows).toEqual([
        {
          action: "wake_agent_profiles_in_space",
          id: `center-agent-wake:${CLIENT_MESSAGE_ID}`,
        },
      ]);
    } finally {
      await harness.close();
    }
  });
  it("cancels coordination only when Space definitely rejects the publication", async () => {
    const harness = await createHarness();
    const resolveSignal = vi.fn().mockResolvedValue(null);
    try {
      await insertAuditIdentity(harness.db);
      await insertParentDelivery(harness.db);
      const prepared = planCenterAgentWakeDelegation({
        childSpaceId: "space-child",
        clientMessageId: "ca-wake:rejected",
        targetProfileIds: [CHILD_PROFILE_ID],
      });
      await prepareCenterAgentWakePublication({
        command: buildCommand({
          clientMessageId: "ca-wake:rejected",
          delegationId: prepared.delegationId,
          subscriptionIds: prepared.subscriptionIds,
        }),
        db: harness.db,
        nowMs: 1000,
      });
      await expect(
        executeCenterAgentWakePublication({
          db: harness.db,
          nowMs: 1010,
          publicationId: "ca-wake:rejected",
          publishSignal: vi
            .fn()
            .mockRejectedValue(
              new Error(
                'HTTP 400: {"ok":false,"error":{"code":"space.activation_target.member_required","message":"Activation target is not a Space member"}}'
              )
            ),
          resolveSignal,
        })
      ).rejects.toThrow("HTTP 400");
      expect(resolveSignal).toHaveBeenCalledOnce();
      await expect(
        readCenterAgentWakePublication({
          db: harness.db,
          publicationId: "ca-wake:rejected",
        })
      ).resolves.toMatchObject({ state: "failed" });
      await expect(
        readAgentDelegation({
          db: harness.db,
          delegationId: prepared.delegationId,
        })
      ).resolves.toMatchObject({
        children: [{ state: "cancelled" }],
        state: "cancelled",
      });
      await expect(
        readAgentTaskCompletionSubscription({
          db: harness.db,
          subscriptionId: prepared.subscriptionIds[0] ?? "",
        })
      ).resolves.toMatchObject({ state: "cancelled" });
    } finally {
      await harness.close();
    }
  });
  it("reconciles an earlier outcome-unknown publication before handling a later rejection", async () => {
    const harness = await createHarness();
    const clientMessageId = "ca-wake:reconciled";
    const reconciledSignal = buildSignal({
      clientMessageId,
      signalId: "signal-reconciled",
    });
    const publishSignal = vi
      .fn()
      .mockRejectedValueOnce(
        Object.assign(new Error("Durable Object transport failed"), {
          retryable: true,
        })
      )
      .mockRejectedValueOnce(
        new Error(
          'HTTP 403: {"ok":false,"error":{"message":"Space membership changed"}}'
        )
      );
    const resolveSignal = vi.fn().mockResolvedValue(reconciledSignal);
    try {
      await insertAuditIdentity(harness.db);
      await insertParentDelivery(harness.db);
      const prepared = planCenterAgentWakeDelegation({
        childSpaceId: "space-child",
        clientMessageId,
        targetProfileIds: [CHILD_PROFILE_ID],
      });
      await prepareCenterAgentWakePublication({
        command: buildCommand({
          clientMessageId,
          delegationId: prepared.delegationId,
          subscriptionIds: prepared.subscriptionIds,
        }),
        db: harness.db,
        nowMs: 1000,
      });
      await expect(
        executeCenterAgentWakePublication({
          db: harness.db,
          nowMs: 1010,
          publicationId: clientMessageId,
          publishSignal,
          resolveSignal,
        })
      ).resolves.toMatchObject({ status: "pending" });
      expect(resolveSignal).not.toHaveBeenCalled();
      await expect(
        executeCenterAgentWakePublication({
          db: harness.db,
          nowMs: 16_010,
          publicationId: clientMessageId,
          publishSignal,
          resolveSignal,
        })
      ).resolves.toMatchObject({
        signal: { id: "signal-reconciled" },
        status: "accepted",
      });
      expect(resolveSignal).toHaveBeenCalledOnce();
      await expect(
        readCenterAgentWakePublication({
          db: harness.db,
          publicationId: clientMessageId,
        })
      ).resolves.toMatchObject({ state: "completed" });
      await expect(
        readAgentDelegation({
          db: harness.db,
          delegationId: prepared.delegationId,
        })
      ).resolves.toMatchObject({
        children: [{ state: "active" }],
        state: "active",
      });
    } finally {
      await harness.close();
    }
  });
  it("leases one publication attempt and recovers it after the owner disappears", async () => {
    const harness = await createHarness();
    const delayedSignal = createDeferred<ReturnType<typeof buildSignal>>();
    const publishSignal = vi
      .fn()
      .mockImplementationOnce(async () => await delayedSignal.promise)
      .mockResolvedValue(
        buildSignal({
          clientMessageId: "ca-wake:leased",
          signalId: "signal-leased",
        })
      );
    try {
      await insertAuditIdentity(harness.db);
      await insertParentDelivery(harness.db);
      const prepared = planCenterAgentWakeDelegation({
        childSpaceId: "space-child",
        clientMessageId: "ca-wake:leased",
        targetProfileIds: [CHILD_PROFILE_ID],
      });
      await prepareCenterAgentWakePublication({
        command: buildCommand({
          clientMessageId: "ca-wake:leased",
          delegationId: prepared.delegationId,
          subscriptionIds: prepared.subscriptionIds,
        }),
        db: harness.db,
        nowMs: 1000,
      });
      const firstAttempt = executeCenterAgentWakePublication({
        db: harness.db,
        nowMs: 1010,
        publicationId: "ca-wake:leased",
        publishSignal,
        resolveSignal: async () => null,
      });
      await vi.waitFor(() => {
        expect(publishSignal).toHaveBeenCalledTimes(1);
      });
      await expect(
        executeCenterAgentWakePublication({
          db: harness.db,
          nowMs: 1011,
          publicationId: "ca-wake:leased",
          publishSignal,
          resolveSignal: async () => null,
        })
      ).resolves.toMatchObject({
        status: "pending",
      });
      await expect(
        executeCenterAgentWakePublication({
          db: harness.db,
          nowMs: 301_011,
          publicationId: "ca-wake:leased",
          publishSignal,
          resolveSignal: async () => null,
        })
      ).resolves.toMatchObject({
        signal: { id: "signal-leased" },
      });
      delayedSignal.resolve(
        buildSignal({
          clientMessageId: "ca-wake:leased",
          signalId: "signal-late",
        })
      );
      await expect(firstAttempt).resolves.toMatchObject({
        signal: { id: "signal-leased" },
        status: "accepted",
      });
      expect(publishSignal).toHaveBeenCalledTimes(2);
      await expect(
        readCenterAgentWakePublication({
          db: harness.db,
          publicationId: "ca-wake:leased",
        })
      ).resolves.toMatchObject({
        claimId: null,
        state: "completed",
      });
    } finally {
      await harness.close();
    }
  });
  it("bounds a stuck publication attempt without starving the next due Wake", async () => {
    const harness = await createHarness();
    try {
      await insertAuditIdentity(harness.db);
      await insertParentDelivery(harness.db);
      for (const clientMessageId of [
        "ca-wake:stuck",
        "ca-wake:batch-success",
      ]) {
        const prepared = planCenterAgentWakeDelegation({
          childSpaceId: "space-child",
          clientMessageId,
          targetProfileIds: [CHILD_PROFILE_ID],
        });
        await prepareCenterAgentWakePublication({
          command: buildCommand({
            clientMessageId,
            delegationId: prepared.delegationId,
            subscriptionIds: prepared.subscriptionIds,
          }),
          db: harness.db,
          nowMs: 1000,
        });
      }
      const publishSignal = vi.fn(
        async (command: CenterAgentWakePublicationCommand) => {
          if (command.clientMessageId === "ca-wake:stuck") {
            return await new Promise<never>(() => undefined);
          }
          return buildSignal({
            clientMessageId: command.clientMessageId,
            signalId: "signal-batch-success",
          });
        }
      );
      await expect(
        retryPendingCenterAgentWakePublications({
          db: harness.db,
          nowMs: 1010,
          publishSignal,
          publishTimeoutMs: 5,
          resolveSignal: async () => null,
        })
      ).resolves.toEqual({
        completed: 1,
        deferred: 0,
        failed: 0,
        rescheduled: 1,
      });
      await expect(
        readCenterAgentWakePublication({
          db: harness.db,
          publicationId: "ca-wake:stuck",
        })
      ).resolves.toMatchObject({
        attemptCount: 1,
        state: "pending",
      });
      await expect(
        readCenterAgentWakePublication({
          db: harness.db,
          publicationId: "ca-wake:batch-success",
        })
      ).resolves.toMatchObject({
        signal: { id: "signal-batch-success" },
        state: "completed",
      });
    } finally {
      await harness.close();
    }
  });
  it("reports a persisted Space acceptance while another owner finalizes coordination", async () => {
    const harness = await createHarness();
    const clientMessageId = "ca-wake:accepted";
    const publishSignal = vi.fn();
    const resolveSignal = vi.fn();
    try {
      await insertAuditIdentity(harness.db);
      await insertParentDelivery(harness.db);
      const prepared = planCenterAgentWakeDelegation({
        childSpaceId: "space-child",
        clientMessageId,
        targetProfileIds: [CHILD_PROFILE_ID],
      });
      await prepareCenterAgentWakePublication({
        command: buildCommand({
          clientMessageId,
          delegationId: prepared.delegationId,
          subscriptionIds: prepared.subscriptionIds,
        }),
        db: harness.db,
        nowMs: 1000,
      });
      const claimed = await claimCenterAgentWakePublication({
        claimExpiresAtMs: 301_010,
        claimId: "claim-owner",
        db: harness.db,
        nowMs: 1010,
        publicationId: clientMessageId,
      });
      expect(claimed).not.toBeNull();
      await markCenterAgentWakePublicationAccepted({
        claimId: "claim-owner",
        db: harness.db,
        nowMs: 1010,
        publicationId: clientMessageId,
        signal: buildSignal({
          clientMessageId,
          signalId: "signal-accepted",
        }),
      });
      await expect(
        executeCenterAgentWakePublication({
          db: harness.db,
          nowMs: 1011,
          publicationId: clientMessageId,
          publishSignal,
          resolveSignal,
        })
      ).resolves.toMatchObject({
        signal: { id: "signal-accepted" },
        status: "accepted",
      });
      expect(publishSignal).not.toHaveBeenCalled();
      expect(resolveSignal).not.toHaveBeenCalled();
    } finally {
      await harness.close();
    }
  });
  it("stops a redrive batch before multiple hung publications consume the minute", async () => {
    const harness = await createHarness();
    try {
      await insertAuditIdentity(harness.db);
      await insertParentDelivery(harness.db);
      for (const clientMessageId of [
        "ca-wake:budget-1",
        "ca-wake:budget-2",
        "ca-wake:budget-3",
      ]) {
        const prepared = planCenterAgentWakeDelegation({
          childSpaceId: "space-child",
          clientMessageId,
          targetProfileIds: [CHILD_PROFILE_ID],
        });
        await prepareCenterAgentWakePublication({
          command: buildCommand({
            clientMessageId,
            delegationId: prepared.delegationId,
            subscriptionIds: prepared.subscriptionIds,
          }),
          db: harness.db,
          nowMs: 1000,
        });
      }
      const publishSignal = vi.fn(
        async () => await new Promise<never>(() => undefined)
      );
      await expect(
        retryPendingCenterAgentWakePublications({
          batchBudgetMs: 1000,
          clock: () => (publishSignal.mock.calls.length ? 1000 : 0),
          db: harness.db,
          nowMs: 1010,
          publishSignal,
          publishTimeoutMs: 1,
          resolveSignal: async () => null,
        })
      ).resolves.toEqual({
        completed: 0,
        deferred: 3,
        failed: 0,
        rescheduled: 0,
      });
      expect(publishSignal).toHaveBeenCalledOnce();
    } finally {
      await harness.close();
    }
  });
  it("enforces the batch deadline across publish and reconciliation", async () => {
    const harness = await createHarness();
    const clientMessageId = "ca-wake:whole-batch-deadline";
    try {
      await insertAuditIdentity(harness.db);
      await insertParentDelivery(harness.db);
      const prepared = planCenterAgentWakeDelegation({
        childSpaceId: "space-child",
        clientMessageId,
        targetProfileIds: [CHILD_PROFILE_ID],
      });
      await prepareCenterAgentWakePublication({
        command: buildCommand({
          clientMessageId,
          delegationId: prepared.delegationId,
          subscriptionIds: prepared.subscriptionIds,
        }),
        db: harness.db,
        nowMs: 1000,
      });
      let markPublicationStarted!: () => void;
      const publicationStarted = new Promise<void>((resolve) => {
        markPublicationStarted = resolve;
      });
      const publishSignal = vi.fn(async () => {
        markPublicationStarted();
        await new Promise<void>((resolve) => setTimeout(resolve, 60));
        throw new Error('HTTP 400: {"error":{"message":"rejected"}}');
      });
      const resolveSignal = vi.fn(
        async () => await new Promise<never>(() => undefined)
      );
      vi.useFakeTimers({ toFake: ["Date", "setTimeout", "clearTimeout"] });
      const redrive = retryPendingCenterAgentWakePublications({
        batchBudgetMs: 100,
        db: harness.db,
        nowMs: 1010,
        publishSignal,
        publishTimeoutMs: 100,
        resolveSignal,
      });
      let settled = false;
      const settlement = redrive.then((result) => {
        settled = true;
        return result;
      });
      await publicationStarted;
      // Native database I/O must reach publication before advancing its deadline.
      await vi.advanceTimersByTimeAsync(99);
      expect(settled).toBe(false);
      await vi.advanceTimersByTimeAsync(1);
      await expect(settlement).resolves.toEqual({
        completed: 0,
        deferred: 1,
        failed: 0,
        rescheduled: 0,
      });
      expect(publishSignal).toHaveBeenCalledOnce();
      expect(resolveSignal).toHaveBeenCalledOnce();
    } finally {
      vi.clearAllTimers();
      vi.useRealTimers();
      await harness.close();
    }
  });
});
function buildCommand(input: {
  clientMessageId?: string;
  delegationId: string;
  referenceTargets?: string[];
  subscriptionIds: string[];
}) {
  const clientMessageId = input.clientMessageId ?? CLIENT_MESSAGE_ID;
  const attribution: CenterAgentAttribution = {
    actorProfileId: CENTER_AGENT_PROFILE_ID,
    onBehalfOf: {
      displayName: "Felix",
      profileId: HUMAN_PROFILE_ID,
      userId: "user-parent",
    },
  };
  return {
    activationTargets: [CHILD_PROFILE_ID],
    attribution,
    clientMessageId,
    completionMode: "resume_parent_when_all_terminal" as const,
    context: {
      actorContext: {
        profileKind: "agent" as const,
        profileName: "Center Agent",
        requestId: "request-parent",
        openMeldProfileId: CENTER_AGENT_PROFILE_ID,
      },
      activeOrganizationId: "org-1",
      agentControllerConversationId: "submission-parent",
    },
    delegationId: input.delegationId,
    fallbackAgentProfileId: null,
    organizationId: "org-1",
    parentSubmissionId: "submission-parent",
    profile: {
      kind: "agent" as const,
      profileId: CENTER_AGENT_PROFILE_ID,
      profileName: "Center Agent",
    },
    mentionTargets: [],
    referenceTargets: input.referenceTargets ?? [],
    spaceId: "space-child",
    subscriptionIds: input.subscriptionIds,
    text: "Complete the delegated work.",
    v: 1 as const,
  };
}
function buildSignal(
  input: { clientMessageId?: string; signalId?: string } = {}
) {
  return {
    data: {
      messageEnvelope: {
        activationTargets: [CHILD_PROFILE_ID],
        referenceTargets: [],
        text: "Complete the delegated work.",
      },
      meta: { clientMessageId: input.clientMessageId ?? CLIENT_MESSAGE_ID },
      text: "Complete the delegated work.",
    },
    id: input.signalId ?? "signal-child",
    profile: {
      kind: "agent" as const,
      profileId: CENTER_AGENT_PROFILE_ID,
      profileName: "Center Agent",
    },
    spaceId: "space-child",
    ts: 1000,
    type: "signal.text" as const,
    v: 1 as const,
  };
}
function createDeferred<T>(): {
  promise: Promise<T>;
  resolve: (value: T) => void;
} {
  let resolvePromise!: (value: T) => void;
  const promise = new Promise<T>((resolve) => {
    resolvePromise = resolve;
  });
  return { promise, resolve: resolvePromise };
}
async function createHarness() {
  const harness = await createPostgresHarness();
  return harness;
}
async function insertAuditIdentity(db: PostgresDatabase): Promise<void> {
  await db.transaction(async (client) => {
    await client.query({
      text: `INSERT INTO "openmeld"."users" (id, name, email) VALUES ('user-parent', 'Requester', 'requester@example.test')`,
    });
    await client.query({
      text: `INSERT INTO "openmeld"."organizations" (id, name, slug, created_at) VALUES ('org-1', 'Organization', 'org-1', 1700000000000)`,
    });
    await client.query({
      text: `INSERT INTO "openmeld"."openmeld_profiles" (profile_id, profile_name, profile_handle, profile_kind, organization_id, owner_user_id, created_by_user_id, managed_role, source, status) VALUES
        ($1, 'Center Agent', 'center-agent', 'agent', 'org-1', NULL, 'user-parent', 'center_agent', 'auth_bootstrap', 'active'),
        ($2, 'Requester', 'requester', 'human', NULL, 'user-parent', NULL, NULL, 'auth_bootstrap', 'active')`,
      values: [CENTER_AGENT_PROFILE_ID, HUMAN_PROFILE_ID],
    });
  });
}

async function insertParentDelivery(db: PostgresDatabase): Promise<void> {
  await db.query({
    ...{
      text: `
        INSERT INTO "openmeld"."openMeldRemoteAgent_native_delivery_ledger" (
          delivery_id,
          organization_id,
          conversation_kind,
          space_id,
          profile_id,
          binding_id,
          trigger_message_id,
          routine_run_id,
          dispatch_id,
          idempotency_key,
          submission_id,
          status,
          on_behalf_of_profile_id,
          on_behalf_of_user_id,
          on_behalf_of_display_name,
          thread_context_json,
          created_at_ms,
          updated_at_ms
        )
        VALUES ($1, $2, 'space', $3, $4, $5, $6, NULL, $7, $8, $9, 'accepted', $10, $11, $12, NULL, $13, $14)
      `,
      values: [],
    },
    values: [
      "delivery-parent",
      "org-1",
      "space-parent",
      CENTER_AGENT_PROFILE_ID,
      "binding-parent",
      "signal-parent",
      "dispatch-parent",
      "idempotency-parent",
      "submission-parent",
      HUMAN_PROFILE_ID,
      "user-parent",
      "Felix",
      900,
      900,
    ],
  });
}
