import type { PostgresDatabase } from "@openmeld/db/postgresql";
import type { SignalEnvelope } from "@openmeld/protocol";
import { spaceMessageDelegationsSchema } from "@openmeld/schemas";
import type {
  GetSpaceWakeProgressResponse,
  WakeProgressItem,
} from "@openmeld/schemas/types";
import { describe, expect, it } from "vitest";
import {
  activateAgentDelegationChildren,
  createAgentDelegation,
  listAgentDelegationsByParentTasks,
} from "../src/agent-task-coordination/infrastructure/postgresql/agent-delegation-repo";
import { recordAgentTaskTerminalOutcome } from "../src/agent-task-coordination/infrastructure/postgresql/agent-task-coordination-repo";
import type { CoreBindings } from "../src/lib/bindings";
import { upsertRemoteAgentNativeDeliveryRecord } from "../src/remote-agent/infrastructure/postgresql/native-delivery-ledger-repo";
import { createCoreRpcHttpError } from "../src/rpc/errors";
import {
  type GetSpaceMessageDetailsInput,
  type GetSpaceWakeProgressInput,
  rpcGetSpaceMessageDetails,
} from "../src/rpc/methods";
import { readSpaceMessageDelegations } from "../src/space/application/space-message-delegations";
import { projectSpaceMessageDetails } from "../src/space/application/space-message-details";
import {
  createPostgresHarness,
  postgresTestBinding,
} from "./helpers/postgresql-harness.test-support";

const PROFILE = "agt_00000000-0000-4000-8000-000000000001";
const CENTER = "agt_00000000-0000-4000-8000-000000000002";
const parent = { v: 1, kind: "native_delivery", deliveryId: "parent" } as const;
const task = {
  v: 1,
  kind: "space_wake",
  sourceClientMessageId: "delegated-request",
  spaceId: "child-space",
  targetProfileId: PROFILE,
} as const;

describe("Space message delegation read projection", () => {
  it("negotiates the public RPC projection and reauthorizes a child without the parent Space password", async () => {
    const harness = await createPostgresHarness();
    const rootSpace = "a".repeat(64);
    const childSpace = "b".repeat(64);
    const context = {
      activeOrganizationId: "org-1",
      actorContext: {
        callerPrincipalId: "owner",
        ownerUserId: "owner",
        openMeldProfileId: "11111111-1111-4111-8111-111111111111",
        profileKind: "human" as const,
        profileName: "Member",
        requestId: "read-delegation",
      },
    };
    try {
      await insertParent(harness.db, "parent", "source", rootSpace);
      await createAgentDelegation({
        db: harness.db,
        delegationId: "declared",
        idempotencyKey: "declared",
        organizationId: "org-1",
        parentTask: parent,
        spaceId: childSpace,
        nowMs: 100,
        completionPolicy: { mode: "resume_parent", when: "all_terminal" },
        children: [
          {
            agentProfileId: PROFILE,
            role: "primary",
            task: { ...task, spaceId: childSpace },
          },
        ],
      });
      await activateAgentDelegationChildren({
        db: harness.db,
        delegationId: "declared",
        nowMs: 101,
      });
      let childReadable = true;
      const rootDetails = messageDetails(
        rootSpace,
        "source",
        "original-request",
        CENTER
      );
      const env = {
        OPENMELD_POSTGRESQL: postgresTestBinding(harness.db),
        OPENMELD_SPACES: {
          idFromString: (id: string) => id,
          get: (id: string) =>
            id === rootSpace
              ? {
                  rpcGetMessageDetails: () => Promise.resolve(rootDetails),
                }
              : {
                  rpcGetWakeProgress: (request: GetSpaceWakeProgressInput) => {
                    expect(request.context).toEqual(context);
                    expect(request.password).toBeUndefined();
                    if (!childReadable) {
                      throw createCoreRpcHttpError({ status: 403 });
                    }
                    return Promise.resolve(
                      progressResponse(childSpace, task.sourceClientMessageId)
                    );
                  },
                  rpcGetMessageDetails: (
                    request: GetSpaceMessageDetailsInput
                  ) => {
                    expect(request.context).toEqual(context);
                    expect(request.password).toBeUndefined();
                    return Promise.resolve(
                      messageDetails(
                        childSpace,
                        request.signalId,
                        task.sourceClientMessageId
                      )
                    );
                  },
                },
        },
      } as unknown as CoreBindings;
      const input = {
        spaceId: rootSpace,
        signalId: "source",
        password: "source-only",
        context,
      };
      expect(await rpcGetSpaceMessageDetails(env, input)).not.toHaveProperty(
        "delegations"
      );
      const visible = await rpcGetSpaceMessageDetails(env, {
        ...input,
        delegationVersion: 1,
      });
      expect(visible.delegations?.groups[0]?.children[0]).toMatchObject({
        availability: "readable",
        spaceId: childSpace,
        sourceSignalId: task.sourceClientMessageId,
      });
      childReadable = false;
      const revoked = await rpcGetSpaceMessageDetails(env, {
        ...input,
        delegationVersion: 1,
      });
      expect(revoked.delegations?.groups[0]?.children[0]).toMatchObject({
        availability: "unavailable",
        spaceId: null,
        targetProfileId: null,
        progress: null,
      });
    } finally {
      await harness.close();
    }
  });

  it.each([
    false,
    true,
  ])("keeps planned coordination separate from current execution evidence (%s)", async (hasExecution) => {
    const harness = await createPostgresHarness();
    try {
      await insertParent(harness.db, "parent");
      await createAgentDelegation({
        db: harness.db,
        delegationId: "fallback",
        idempotencyKey: "fallback",
        organizationId: "org-1",
        parentTask: parent,
        spaceId: task.spaceId,
        nowMs: 100,
        completionPolicy: { mode: "child_reports_directly" },
        children: [{ agentProfileId: PROFILE, role: "fallback", task }],
      });
      const result = await readSpaceMessageDelegations({
        db: harness.db,
        details: messageDetails(
          "parent-space",
          "source",
          "original-request",
          CENTER
        ),
        readTarget: () => Promise.resolve("Backup reviewer"),
        readMessage: (spaceId, signalId) =>
          Promise.resolve(messageDetails(spaceId, signalId, signalId)),
        readProgress: () =>
          Promise.resolve(
            hasExecution
              ? progressResponse(task.spaceId, task.sourceClientMessageId)
              : {
                  query: {
                    spaceId: task.spaceId,
                    clientMessageId: task.sourceClientMessageId,
                    targetProfileId: PROFILE,
                  },
                  items: [],
                }
          ),
      });
      expect(result.groups[0]?.children[0]).toMatchObject({
        availability: "readable",
        role: "fallback",
        coordinationState: "planned",
        targetLabel: hasExecution ? "Reviewer" : "Backup reviewer",
        progress: hasExecution
          ? expect.objectContaining({ phase: "running" })
          : null,
        sourceSignalId: hasExecution ? task.sourceClientMessageId : null,
        resultSignalId: null,
        outcome: null,
      });
    } finally {
      await harness.close();
    }
  });
  it("finds continued parent turns from the original message and preserves a failed child after another succeeds", async () => {
    const harness = await createPostgresHarness();
    try {
      await insertParent(harness.db, "parent");
      await insertParent(harness.db, "continuation");
      await insertParent(harness.db, "unrelated", "other-source");
      for (const id of ["parent", "continuation", "unrelated"]) {
        await createDelegation(harness.db, id);
      }
      await recordAgentTaskTerminalOutcome({
        db: harness.db,
        nowMs: 200,
        task: { ...task, sourceClientMessageId: "child-parent" },
        outcome: {
          status: "failed",
          eventId: "failed",
          errorCode: "runtime.failed",
          occurredAtMs: 200,
          publishedSignalId: "failed-result",
        },
      });
      await recordAgentTaskTerminalOutcome({
        db: harness.db,
        nowMs: 201,
        task: { ...task, sourceClientMessageId: "child-continuation" },
        outcome: {
          status: "succeeded",
          eventId: "done",
          errorCode: null,
          occurredAtMs: 201,
          publishedSignalId: "done-result",
        },
      });
      const read = () =>
        readSpaceMessageDelegations({
          readTarget: () => Promise.resolve("Reviewer"),
          db: harness.db,
          details: messageDetails(
            "parent-space",
            "source",
            "original-request",
            CENTER
          ),
          readMessage: async (spaceId, signalId) =>
            messageDetails(spaceId, signalId, signalId),
          readProgress: async (spaceId, clientMessageId) =>
            progressResponse(spaceId, clientMessageId),
        });
      const first = await read();
      expect(first.groups.map((group) => group.delegationId)).toEqual([
        "delegation-continuation",
        "delegation-parent",
      ]);
      expect(
        first.groups
          .flatMap((group) => group.children)
          .map((child) => child.outcome?.status)
      ).toEqual(["succeeded", "failed"]);
      expect(
        first.groups
          .flatMap((group) => group.children)
          .map((child) => child.resultSignalId)
      ).toEqual(["done-result", "failed-result"]);
      expect(spaceMessageDelegationsSchema.safeParse(first).success).toBe(true);
      // Re-reading durable owners after a refresh must reconstruct the same relationships.
      expect(await read()).toEqual(first);
    } finally {
      await harness.close();
    }
  });

  it.each([
    "forbidden",
    "deleted",
    "result_private",
    "identity_mismatch",
    "waiting",
  ] as const)("preserves each child Space's current read and interaction projection: %s", async (scenario) => {
    const harness = await createPostgresHarness();
    try {
      await insertParent(harness.db, "parent");
      await createDelegation(harness.db, "parent");
      if (scenario === "result_private") {
        await recordAgentTaskTerminalOutcome({
          db: harness.db,
          nowMs: 200,
          task: { ...task, sourceClientMessageId: "child-parent" },
          outcome: {
            status: "succeeded",
            eventId: "done",
            errorCode: null,
            occurredAtMs: 200,
            publishedSignalId: "private-result",
          },
        });
      }
      const result = await readSpaceMessageDelegations({
        readTarget: () => Promise.resolve("Reviewer"),
        db: harness.db,
        details: messageDetails(
          "parent-space",
          "source",
          "original-request",
          CENTER
        ),
        readMessage: (spaceId, signalId) => {
          if (spaceId === "child-space" && scenario === "forbidden") {
            // Cloudflare RPC strips custom fields; preserve its HTTP-style error contract.
            throw new Error(
              createCoreRpcHttpError({ status: 403, reason: "Private Space" })
                .message
            );
          }
          if (
            signalId === "private-result" ||
            (spaceId === "child-space" && scenario === "deleted")
          ) {
            throw createCoreRpcHttpError({ status: 404 });
          }
          return Promise.resolve(
            messageDetails(
              spaceId,
              signalId,
              scenario === "identity_mismatch" ? "other-request" : signalId
            )
          );
        },
        readProgress: async (spaceId, clientMessageId) =>
          progressResponse(
            spaceId,
            clientMessageId,
            scenario === "waiting"
              ? {
                  pendingInteraction: {
                    interactionId: "pending",
                    kind: "permission",
                    canRespond: false,
                    requestedAtMs: 100,
                    expiresAtMs: 500,
                    request: null,
                  },
                }
              : {}
          ),
      });
      const child = result.groups[0]?.children[0];
      if (scenario === "waiting") {
        expect(child?.progress?.pendingInteraction).toMatchObject({
          canRespond: false,
          request: null,
        });
        expect(child?.outcome).toBeNull();
        expect(child?.availability).toBe("readable");
      } else if (scenario === "result_private") {
        expect(child?.outcome?.status).toBe("succeeded");
        expect(child?.resultSignalId).toBeNull();
        expect(child?.outcome?.publishedSignalId).toBeNull();
      } else {
        expect(child).toMatchObject({
          availability: "unavailable",
          spaceId: null,
          sourceSignalId: null,
          targetProfileId: null,
          progress: null,
          taskPreview: null,
          outcome: null,
        });
      }
    } finally {
      await harness.close();
    }
  });

  it("paginates every declared child across parent turns without crossing organizations", async () => {
    const harness = await createPostgresHarness();
    try {
      for (let index = 0; index < 12; index += 1) {
        await createDelegation(
          harness.db,
          String(index).padStart(2, "0"),
          parent.deliveryId
        );
      }
      await createAgentDelegation({
        db: harness.db,
        delegationId: "foreign",
        idempotencyKey: "foreign",
        organizationId: "other-org",
        parentTask: parent,
        spaceId: "child-space",
        nowMs: 100,
        completionPolicy: { mode: "child_reports_directly" },
        children: [{ agentProfileId: PROFILE, task, role: "primary" }],
      });
      const input = {
        db: harness.db,
        parents: [{ organizationId: "org-1", task: parent }],
      };
      const first = await listAgentDelegationsByParentTasks(input);
      expect(first.records).toHaveLength(10);
      const second = await listAgentDelegationsByParentTasks({
        ...input,
        after: first.nextCursor ?? undefined,
      });
      expect(second.records).toHaveLength(2);
      expect(second.nextCursor).toBeNull();
      expect(
        new Set(
          [...first.records, ...second.records].map(
            (record) => record.delegationId
          )
        ).size
      ).toBe(12);
    } finally {
      await harness.close();
    }
  });
});

async function insertParent(
  db: PostgresDatabase,
  id: string,
  source = "source",
  spaceId = "parent-space"
) {
  await db.query({
    text: 'INSERT INTO "openmeld"."organizations" (id, name, slug, created_at) VALUES ($1, $1, $1, 100) ON CONFLICT DO NOTHING',
    values: ["org-1"],
  });
  await upsertRemoteAgentNativeDeliveryRecord({
    db,
    deliveryId: id,
    nowMs: 100,
    organizationId: "org-1",
    conversationKind: "space",
    spaceId,
    profileId: CENTER,
    bindingId: "binding",
    triggerMessageId: source,
    dispatchId: id,
    attemptId: null,
    idempotencyKey: id,
    status: "accepted",
  });
}

async function createDelegation(
  db: PostgresDatabase,
  id: string,
  parentId = id
) {
  const record = await createAgentDelegation({
    db,
    delegationId: `delegation-${id}`,
    idempotencyKey: `delegation-${id}`,
    organizationId: "org-1",
    parentTask: { ...parent, deliveryId: parentId },
    spaceId: "child-space",
    nowMs: 100,
    completionPolicy: { mode: "resume_parent", when: "all_terminal" },
    children: [
      {
        role: "primary",
        agentProfileId: PROFILE,
        task: { ...task, sourceClientMessageId: `child-${id}` },
      },
    ],
  });
  await activateAgentDelegationChildren({
    db,
    delegationId: record.delegationId,
    nowMs: 101,
  });
}

function messageDetails(
  spaceId: string,
  signalId: string,
  clientMessageId: string,
  targetProfileId = PROFILE
) {
  const signal: Extract<SignalEnvelope, { type: "signal.text" }> = {
    v: 1,
    id: signalId,
    spaceId,
    ts: 100,
    type: "signal.text",
    profile: { kind: "human", profileId: "member", profileName: "Member" },
    data: {
      text: "Review the exact revision.",
      meta: { clientMessageId },
      messageEnvelope: {
        text: "Review the exact revision.",
        activationTargets: [targetProfileId],
        referenceTargets: [],
      },
    },
  };
  return projectSpaceMessageDetails({
    spaceId,
    signal,
    visibleSignal: signal,
    wakeSourceSignal: signal,
    replySignal: null,
    visibleReplySignal: null,
  });
}

function progressResponse(
  spaceId: string,
  clientMessageId: string,
  overrides: Partial<WakeProgressItem> = {}
): GetSpaceWakeProgressResponse {
  return {
    query: { spaceId, clientMessageId, targetProfileId: PROFILE },
    items: [
      {
        clientMessageId,
        sourceSignalId: clientMessageId,
        targetProfileId: PROFILE,
        targetLabel: "Reviewer",
        dispatchId: "dispatch",
        phase: "running",
        terminal: false,
        updatedAtMs: 100,
        message: "Reviewer is working.",
        sourceContext: {
          messagePreview: "Review the exact revision.",
          profileId: CENTER,
          profileKind: "agent",
          profileName: "Center Agent",
          threadId: null,
        },
        ...overrides,
      },
    ],
  };
}
