import { env, runInDurableObject } from "cloudflare:test";
import { getPostgresDatabase } from "@openmeld/db/postgresql";
import type { Profile, SignalEnvelope } from "@openmeld/protocol";
import {
  AGENT_ACCESS_PENDING_CODE,
  type AgentAccessDecision,
  buildRuntimeCoordinatorExecutionId,
} from "@openmeld/schemas";
import type { OpenMeldRequestContext } from "@openmeld/schemas/types";
import { createAuthenticatedSpaceAccessContext } from "@openmeld/space";
import { afterEach, describe, expect, it, vi } from "vitest";
import { requireRequestedAgentMember } from "../src/agent-access/agent-access-rpc";
import {
  upsertJoinedSpaceMember,
  upsertSpaceCreatorMember,
} from "../src/space/application/space-members-service";
import type { SignalPublishContext } from "../src/space/application/types";
import { listDispatchOutboxRecordsBySourceSignalId } from "../src/space/infrastructure/outbox/dispatch-outbox-repo";
import {
  readHeldDirectMessageAgentAccessHold,
  readSpaceAgentAccessHold,
} from "../src/space/infrastructure/sql/space-agent-access-hold-repo";
import { readSpaceMemberRecord } from "../src/space/infrastructure/sql/space-member-repo";
import { upsertSpaceMetaRecord } from "../src/space/infrastructure/sql/space-meta-repo";
import type { Space } from "../src/space/transport/do/space";

const feature = vi.hoisted(() => ({ enabled: true }));
vi.mock("../src/member-agent/member-agents-feature", () => ({
  isMemberAgentsEnabled: () => feature.enabled,
  isRequestChainEnforced: () => feature.enabled,
}));

const {
  decideAgentAccessRequest,
  finishAgentAccessDecision,
  isAgentAccessRequestStillGranted,
  withdrawAgentAccessRequest,
} = await import("../src/agent-access/application/agent-access-service");
const { readAgentAccessRequest, revokeAgentProfileAccessGrant, asQueryable } =
  await import(
    "../src/agent-access/infrastructure/postgresql/agent-access-repo"
  );

afterEach(() => {
  feature.enabled = true;
  vi.restoreAllMocks();
});

type Person = {
  profileId: string;
  userId: string;
  name: string;
};

type Fixture = {
  organizationId: string;
  felix: Person;
  tali: Person;
  sam: Person;
  agentProfileId: string;
  memberAgentId: string;
};

const SECRET_TEXT = "Rotate the production signing key tonight";

async function seed(): Promise<Fixture> {
  const suffix = crypto.randomUUID();
  const organizationId = `org_agent_access_${suffix}`;
  const db = getPostgresDatabase(env);
  const person = (name: string): Person => ({
    name,
    profileId: crypto.randomUUID(),
    userId: `user_${name.toLowerCase()}_${suffix}`,
  });
  const felix = person("Felix");
  const tali = person("Tali");
  // Sam has an account but is not in the Organization: an external user.
  const sam = person("Sam");
  const agentProfileId = `agt_${crypto.randomUUID()}`;
  const memberAgentId = `ma_${suffix}`;
  const now = Date.now();
  await db.transaction(async (client) => {
    await client.query({
      text: `INSERT INTO "openmeld"."organizations" (id, name, slug, created_at) VALUES ($1, 'Agent access', $2, $3)`,
      values: [organizationId, `agent-access-${suffix}`, now],
    });
    for (const member of [felix, tali, sam]) {
      await client.query({
        text: `INSERT INTO "openmeld"."users" (id, name, email, email_verified, created_at, updated_at) VALUES ($1, $2, $3, 1, $4, $4)`,
        values: [
          member.userId,
          member.name,
          `${member.userId}@example.com`,
          now,
        ],
      });
      await client.query({
        text: `INSERT INTO "openmeld"."openmeld_profiles" (profile_id, profile_name, profile_handle, profile_kind, is_default, status, owner_user_id, created_by_user_id, source, created_at, updated_at) VALUES ($1, $2, $3, 'human', 1, 'active', $4, $4, 'auth_bootstrap', $5, $5)`,
        values: [
          member.profileId,
          member.name,
          `${member.name.toLowerCase()}-${suffix}`,
          member.userId,
          now,
        ],
      });
    }
    for (const member of [felix, tali]) {
      await client.query({
        text: `INSERT INTO "openmeld"."members" (id, organization_id, user_id, role, created_at) VALUES ($1, $2, $3, 'member', $4)`,
        values: [`member_${member.userId}`, organizationId, member.userId, now],
      });
    }
    await client.query({
      text: `INSERT INTO "openmeld"."member_agents" (id, organization_id, owner_user_id, harness_kind, source, created_at, updated_at) VALUES ($1, $2, $3, 'claude-code', 'detected', $4, $4)`,
      values: [memberAgentId, organizationId, felix.userId, now],
    });
    await client.query({
      text: `INSERT INTO "openmeld"."openmeld_profiles" (profile_id, profile_name, profile_handle, profile_kind, is_default, status, organization_id, owner_user_id, created_by_user_id, source, member_agent_id, created_at, updated_at) VALUES ($1, 'PR Reviewer', $1, 'agent', 0, 'active', $2, $3, $3, 'cli_create', $4, $5, $5)`,
      values: [
        agentProfileId,
        organizationId,
        felix.userId,
        memberAgentId,
        now,
      ],
    });
  });
  return { organizationId, felix, tali, sam, agentProfileId, memberAgentId };
}

type ConsentSpace = {
  spaceId: string;
  publishTextSignal(
    signal: SignalEnvelope,
    context?: SignalPublishContext
  ): Promise<void>;
  recordOrganizationMemberHumanActivity(): Promise<void>;
  flushPendingSpaceInboxProjectionOutbox(): Promise<void>;
  flushPendingDispatchOutbox(): Promise<void>;
  syncSpaceBackgroundAlarm(): Promise<void>;
  projectCurrentSpaceIndexSnapshot(): Promise<void>;
  broadcastSpaceMembersChanged(): Promise<void>;
  broadcastSpaceMetaChanged(): Promise<void>;
  authorizeSpaceAccess(
    access: ReturnType<typeof createAuthenticatedSpaceAccessContext>
  ): Promise<{ ok: boolean }>;
  rpcApplyAgentAccessDecision: Space["rpcApplyAgentAccessDecision"];
  rpcRequestAgentForSpace: Space["rpcRequestAgentForSpace"];
  rpcMutateSpaceMessage: Space["rpcMutateSpaceMessage"];
  rpcGetWakeProgress: Space["rpcGetWakeProgress"];
  rpcRespondToAgentInteraction: Space["rpcRespondToAgentInteraction"];
  isAgentOwnerObserver(actor: OpenMeldRequestContext["actorContext"]): boolean;
  ensureAgentOwnerMembershipPolicy(meta: unknown): Promise<void>;
  readSpaceMetaRecord(): unknown;
};

type SpaceHarness = {
  instance: ConsentSpace;
  state: DurableObjectState;
  spaceId: string;
  post(author: Person, text: string, kind?: "human"): Promise<SignalEnvelope>;
  outbox(
    signal: SignalEnvelope
  ): ReturnType<typeof listDispatchOutboxRecordsBySourceSignalId>;
  context(person: Person): OpenMeldRequestContext;
};

/** A real Space owner with one Human author and the Agent as members. */
async function withSpace(
  f: Fixture,
  options: {
    agentControllerRef?: string | null;
    directMessage: boolean;
    humans: Person[];
    agentMember: boolean;
  },
  run: (space: SpaceHarness) => Promise<void>
) {
  const namespace = env.OPENMELD_SPACES as DurableObjectNamespace<Space>;
  const id = namespace.newUniqueId();
  const spaceId = id.toString();
  await runInDurableObject(namespace.get(id), async (object, state) => {
    const background = vi.spyOn(state, "waitUntil");
    const instance = object as unknown as ConsentSpace;
    instance.spaceId = spaceId;
    const creatorPerson = options.humans[0];
    if (!creatorPerson) {
      throw new Error("A Space needs a creator.");
    }
    const creator = {
      kind: "human" as const,
      profileId: creatorPerson.profileId,
      profileName: creatorPerson.name,
      ownerUserId: creatorPerson.userId,
    };
    upsertSpaceMetaRecord(state.storage.sql, {
      v: 1,
      spaceId,
      name: options.directMessage ? "New chat" : "Launch room",
      organizationId: f.organizationId,
      creator,
      visibility: "private",
      accessMode: "members_only",
      ...(options.directMessage
        ? {
            purpose: "openmeld_dm_space",
            directMessage: {
              pairKey: [creatorPerson.profileId, f.agentProfileId]
                .sort()
                .join(":"),
            },
          }
        : {}),
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    });
    upsertSpaceCreatorMember({ sql: state.storage.sql, spaceId, creator });
    for (const human of options.humans.slice(1)) {
      upsertJoinedSpaceMember({
        sql: state.storage.sql,
        spaceId,
        ownerUserId: human.userId,
        profile: {
          kind: "human",
          profileId: human.profileId,
          profileName: human.name,
        },
      });
    }
    if (options.agentMember) {
      upsertJoinedSpaceMember({
        sql: state.storage.sql,
        spaceId,
        ownerUserId: f.felix.userId,
        profile: {
          kind: "agent",
          profileId: f.agentProfileId,
          profileName: "PR Reviewer",
          // null: a member whose harness was not recorded.
          ...(options.agentControllerRef === null
            ? {}
            : {
                agentControllerRef:
                  options.agentControllerRef ?? "builtin:claude-code",
              }),
        },
      });
    }
    for (const method of [
      "recordOrganizationMemberHumanActivity",
      "flushPendingSpaceInboxProjectionOutbox",
      "flushPendingDispatchOutbox",
      "syncSpaceBackgroundAlarm",
      "projectCurrentSpaceIndexSnapshot",
      "broadcastSpaceMembersChanged",
      "broadcastSpaceMetaChanged",
    ] as const) {
      vi.spyOn(instance, method).mockResolvedValue();
    }
    const context = (person: Person): OpenMeldRequestContext => ({
      activeOrganizationId: f.organizationId,
      actorContext: {
        requestId: crypto.randomUUID(),
        openMeldProfileId: person.profileId,
        profileKind: "human",
        profileName: person.name,
        ownerUserId: person.userId,
        callerPrincipalId: person.userId,
      },
    });
    const post = async (author: Person, text: string) => {
      const profile: Profile = {
        kind: "human",
        profileId: author.profileId,
        profileName: author.name,
      };
      const signal: SignalEnvelope = {
        v: 1,
        id: crypto.randomUUID(),
        ts: Date.now(),
        spaceId,
        profile,
        type: "signal.text",
        data: {
          text,
          meta: { clientMessageId: crypto.randomUUID() },
          messageEnvelope: options.agentMember
            ? {
                text,
                activationTargets: [f.agentProfileId],
                referenceTargets: [],
                mentionTargets: [],
              }
            : {
                text,
                activationTargets: [],
                referenceTargets: [],
                mentionTargets: [],
              },
        },
      };
      await instance.publishTextSignal(signal, {
        authoringPolicy: "user_authored",
      } as SignalPublishContext);
      return signal;
    };
    try {
      await run({
        instance,
        state,
        spaceId,
        post,
        outbox: (signal) =>
          listDispatchOutboxRecordsBySourceSignalId(
            state.storage.sql,
            signal.id
          ),
        context,
      });
    } finally {
      while (background.mock.calls.length > 0) {
        await Promise.all(
          background.mock.calls.splice(0).map(([work]) => work)
        );
      }
      await state.storage.deleteAlarm();
      vi.restoreAllMocks();
    }
  });
}

async function decide(
  f: Fixture,
  space: SpaceHarness,
  requestId: string,
  decision: AgentAccessDecision
) {
  const db = getPostgresDatabase(env);
  const decided = await decideAgentAccessRequest({
    db,
    decision,
    deciderUserId: f.felix.userId,
    nowMs: Date.now(),
    organizationId: f.organizationId,
    requestId,
  });
  // The same steps as rpcDecideAgentAccessRequest: record, apply, finish.
  const applied = await space.instance.rpcApplyAgentAccessDecision({
    decidedByProfileId: f.felix.profileId,
    decidedByUserId: f.felix.userId,
    organizationId: f.organizationId,
    requestId,
    spaceId: space.spaceId,
    status: decided.request.status,
  });
  await finishAgentAccessDecision({
    db,
    nowMs: Date.now(),
    outcome: applied.outcome,
    request: decided.request,
  });
  return applied;
}

async function readInboxItem(requestId: string) {
  const result = await getPostgresDatabase(env).query<{
    kind: string;
    importance: string;
    recipient_user_id: string;
    resolution_status: string;
    title: string;
    preview: string;
  }>({
    text: `SELECT kind, importance, recipient_user_id, resolution_status, title, preview
      FROM "openmeld"."inbox_items" WHERE source_kind = 'agent_access_request' AND source_key = $1`,
    values: [`agent-access:${requestId}`],
  });
  return result.rows[0] ?? null;
}

describe("Colleague use of an Agent (Phase 4)", () => {
  it("holds a colleague's first Direct Message until the owner allows it once", async () => {
    const f = await seed();
    await withSpace(
      f,
      { directMessage: true, humans: [f.tali], agentMember: true },
      async (space) => {
        const first = await space.post(f.tali, SECRET_TEXT);
        // Stored, not dispatched; no membership change.
        expect(space.outbox(first)).toHaveLength(0);
        const hold = readHeldDirectMessageAgentAccessHold(
          space.state.storage.sql,
          { requesterUserId: f.tali.userId, targetProfileId: f.agentProfileId }
        );
        expect(hold).toMatchObject({ kind: "direct_message", state: "held" });
        if (!hold) {
          throw new Error("Expected a held Wake.");
        }
        const request = await readAgentAccessRequest({
          db: asQueryable(getPostgresDatabase(env)),
          requestId: hold.requestId,
        });
        expect(request).toMatchObject({
          kind: "direct_message",
          ownerUserId: f.felix.userId,
          requesterUserId: f.tali.userId,
          requesterKind: "member",
          status: "pending",
        });
        const item = await readInboxItem(hold.requestId);
        expect(item).toMatchObject({
          kind: "agent_access_request",
          importance: "urgent",
          recipient_user_id: f.felix.userId,
          resolution_status: "open",
        });
        // The urgent email carries the item's copy: never the message text.
        expect(`${item?.title} ${item?.preview}`).not.toContain("signing key");

        // A held Wake is not in progress: no "Working…" for the requester.
        const progress = await space.instance.rpcGetWakeProgress({
          clientMessageId: String(
            (first.data as { meta?: { clientMessageId?: string } }).meta
              ?.clientMessageId
          ),
          context: space.context(f.tali),
          spaceId: space.spaceId,
        } as Parameters<ConsentSpace["rpcGetWakeProgress"]>[0]);
        expect(progress.items).toEqual([]);

        // One request per Session: the requester waits or withdraws.
        await expect(
          space.post(f.tali, "Are you there?")
        ).rejects.toMatchObject({ code: AGENT_ACCESS_PENDING_CODE });

        await expect(
          decide(f, space, hold.requestId, "allow_once")
        ).resolves.toEqual({ outcome: "applied" });
        const [released] = space.outbox(first);
        expect(released?.targetProfileId).toBe(f.agentProfileId);
        // Approval always starts a new Session for the requester.
        expect(released?.contextSelection).toEqual({ mode: "new" });
        expect(released?.requestChain?.[0]).toEqual({
          kind: "human",
          profileId: f.tali.profileId,
        });
        expect((await readInboxItem(hold.requestId))?.resolution_status).toBe(
          "resolved"
        );
        // The owner still is not a member of the Direct Message.
        expect(
          readSpaceMemberRecord(space.state.storage.sql, f.felix.profileId)
        ).toBeNull();

        // Allowed once covers this Session.
        const next = await space.post(f.tali, "One more thing");
        expect(space.outbox(next)).toHaveLength(1);
      }
    );
  });

  it("releases to a harness without Sessions exactly like a later message", async () => {
    const f = await seed();
    await withSpace(
      f,
      {
        agentControllerRef: "builtin:opencode",
        directMessage: true,
        humans: [f.tali],
        agentMember: true,
      },
      async (space) => {
        const first = await space.post(f.tali, "Please check the build");
        const hold = readHeldDirectMessageAgentAccessHold(
          space.state.storage.sql,
          { requesterUserId: f.tali.userId, targetProfileId: f.agentProfileId }
        );
        if (!hold) {
          throw new Error("Expected a held Wake.");
        }
        await expect(
          decide(f, space, hold.requestId, "allow_once")
        ).resolves.toEqual({ outcome: "applied" });
        // An explicit new Session is refused by this harness (R2B-04).
        const [released] = space.outbox(first);
        expect(released?.targetProfileId).toBe(f.agentProfileId);
        expect(released?.contextSelection).toBeUndefined();
        const next = await space.post(f.tali, "One more thing");
        const [later] = space.outbox(next);
        expect(later?.contextSelection).toBeUndefined();
      }
    );
  });

  it("releases by the Binding's harness when the member does not record it", async () => {
    const f = await seed();
    await withSpace(
      f,
      {
        agentControllerRef: null,
        directMessage: true,
        humans: [f.tali],
        agentMember: true,
      },
      async (space) => {
        const first = await space.post(f.tali, "Please check the build");
        const hold = readHeldDirectMessageAgentAccessHold(
          space.state.storage.sql,
          { requesterUserId: f.tali.userId, targetProfileId: f.agentProfileId }
        );
        if (!hold) {
          throw new Error("Expected a held Wake.");
        }
        const db = getPostgresDatabase(env);
        const decided = await decideAgentAccessRequest({
          db,
          decision: "allow_once",
          deciderUserId: f.felix.userId,
          nowMs: Date.now(),
          organizationId: f.organizationId,
          requestId: hold.requestId,
        });
        // rpcDecideAgentAccessRequest passes the Binding's harness (R5-02).
        await space.instance.rpcApplyAgentAccessDecision({
          decidedByProfileId: f.felix.profileId,
          decidedByUserId: f.felix.userId,
          organizationId: f.organizationId,
          requestId: hold.requestId,
          spaceId: space.spaceId,
          status: decided.request.status,
          targetControllerRef: "builtin:opencode",
        });
        expect(space.outbox(first)[0]?.contextSelection).toBeUndefined();
      }
    );
  });

  it("lets an always-allowed colleague start new Sessions until the owner revokes", async () => {
    const f = await seed();
    let grantedRequestId = "";
    await withSpace(
      f,
      { directMessage: true, humans: [f.tali], agentMember: true },
      async (space) => {
        const first = await space.post(f.tali, "Review my branch");
        const hold = readHeldDirectMessageAgentAccessHold(
          space.state.storage.sql,
          { requesterUserId: f.tali.userId, targetProfileId: f.agentProfileId }
        );
        if (!hold) {
          throw new Error("Expected a held Wake.");
        }
        grantedRequestId = hold.requestId;
        await decide(f, space, hold.requestId, "always_allow");
        expect(space.outbox(first)).toHaveLength(1);
      }
    );
    const grant = await getPostgresDatabase(env).query<{
      id: string;
      scope: string;
      grantee_kind: string;
    }>({
      text: `SELECT id, scope, grantee_kind FROM "openmeld"."agent_profile_access_grants" WHERE request_id = $1`,
      values: [grantedRequestId],
    });
    expect(grant.rows[0]).toMatchObject({
      scope: "always",
      grantee_kind: "member",
    });
    const running: SignalEnvelope[] = [];
    await withSpace(
      f,
      { directMessage: true, humans: [f.tali], agentMember: true },
      async (space) => {
        const message = await space.post(f.tali, "A new Session");
        running.push(message);
        expect(space.outbox(message)).toHaveLength(1);
        const grantId = grant.rows[0]?.id;
        if (!grantId) {
          throw new Error("Expected a grant.");
        }
        await revokeAgentProfileAccessGrant({
          db: asQueryable(getPostgresDatabase(env)),
          grantId,
          nowMs: Date.now(),
          profileId: f.agentProfileId,
          revokedByUserId: f.felix.userId,
        });
        // Running work is untouched; new work asks again.
        expect(space.outbox(message)).toHaveLength(1);
        const after = await space.post(f.tali, "And this?");
        expect(space.outbox(after)).toHaveLength(0);
        expect(
          readHeldDirectMessageAgentAccessHold(space.state.storage.sql, {
            requesterUserId: f.tali.userId,
            targetProfileId: f.agentProfileId,
          })
        ).not.toBeNull();
      }
    );
  });

  it("closes, never releases, an allow replayed after its grant was revoked", async () => {
    const f = await seed();
    await withSpace(
      f,
      { directMessage: true, humans: [f.tali], agentMember: true },
      async (space) => {
        const first = await space.post(f.tali, SECRET_TEXT);
        const hold = readHeldDirectMessageAgentAccessHold(
          space.state.storage.sql,
          { requesterUserId: f.tali.userId, targetProfileId: f.agentProfileId }
        );
        if (!hold) {
          throw new Error("Expected a held Wake.");
        }
        const db = getPostgresDatabase(env);
        // The owner allows once; the Space call is lost, so nothing applies.
        const decided = await decideAgentAccessRequest({
          db,
          decision: "allow_once",
          deciderUserId: f.felix.userId,
          nowMs: Date.now(),
          organizationId: f.organizationId,
          requestId: hold.requestId,
        });
        const grant = await db.query<{ id: string }>({
          text: `SELECT id FROM "openmeld"."agent_profile_access_grants" WHERE request_id = $1`,
          values: [hold.requestId],
        });
        const grantId = grant.rows[0]?.id;
        if (!grantId) {
          throw new Error("Expected a grant.");
        }
        // The owner revokes before any read repairs the lost call.
        await revokeAgentProfileAccessGrant({
          db: asQueryable(db),
          grantId,
          nowMs: Date.now(),
          profileId: f.agentProfileId,
          revokedByUserId: f.felix.userId,
        });
        // The repair replays the recorded allow, as applyDecisionInSpace does.
        await expect(
          isAgentAccessRequestStillGranted({ db, request: decided.request })
        ).resolves.toBe(false);
        const applied = await space.instance.rpcApplyAgentAccessDecision({
          accessRevoked: true,
          decidedByProfileId: f.felix.profileId,
          decidedByUserId: f.felix.userId,
          organizationId: f.organizationId,
          requestId: hold.requestId,
          spaceId: space.spaceId,
          status: decided.request.status,
        });
        expect(applied).toEqual({ outcome: "closed" });
        expect(space.outbox(first)).toHaveLength(0);
        expect(
          readSpaceAgentAccessHold(space.state.storage.sql, hold.requestId)
        ).toMatchObject({ closeReason: "revoked", state: "closed" });
        await finishAgentAccessDecision({
          db,
          nowMs: Date.now(),
          outcome: applied.outcome,
          request: decided.request,
        });
        // The decision stays on record; only the release never happened.
        expect(
          await readAgentAccessRequest({
            db: asQueryable(db),
            requestId: hold.requestId,
          })
        ).toMatchObject({ decision: "allow_once", status: "allowed" });
      }
    );
  });

  it("asks every time for an external user and never offers always allow", async () => {
    const f = await seed();
    await withSpace(
      f,
      { directMessage: false, humans: [f.felix, f.sam], agentMember: true },
      async (space) => {
        const first = await space.post(f.sam, "Can your Agent check this?");
        expect(space.outbox(first)).toHaveLength(0);
        const db = getPostgresDatabase(env);
        const held = await db.query<{ id: string; kind: string }>({
          text: `SELECT id, kind FROM "openmeld"."agent_access_requests" WHERE space_id = $1`,
          values: [space.spaceId],
        });
        expect(held.rows).toEqual([
          { id: expect.any(String), kind: "external_message" },
        ]);
        const requestId = held.rows[0]?.id ?? "";
        await expect(
          decideAgentAccessRequest({
            db,
            decision: "always_allow",
            deciderUserId: f.felix.userId,
            nowMs: Date.now(),
            organizationId: f.organizationId,
            requestId,
          })
        ).rejects.toMatchObject({ code: "agent_access.decision_unavailable" });
        await decide(f, space, requestId, "allow_once");
        expect(space.outbox(first)).toHaveLength(1);
        // Asked again for the next message.
        const second = await space.post(f.sam, "And this one?");
        expect(space.outbox(second)).toHaveLength(0);
        // The owner's own message never asks.
        const own = await space.post(f.felix, "I'll take it from here");
        expect(space.outbox(own)).toHaveLength(1);
      }
    );
  });

  it("only the owner decides and only the requester withdraws", async () => {
    const f = await seed();
    await withSpace(
      f,
      { directMessage: true, humans: [f.tali], agentMember: true },
      async (space) => {
        await space.post(f.tali, "Please look");
        const hold = readHeldDirectMessageAgentAccessHold(
          space.state.storage.sql,
          { requesterUserId: f.tali.userId, targetProfileId: f.agentProfileId }
        );
        const requestId = hold?.requestId ?? "";
        const db = getPostgresDatabase(env);
        await expect(
          decideAgentAccessRequest({
            db,
            decision: "always_allow",
            deciderUserId: f.tali.userId,
            nowMs: Date.now(),
            organizationId: f.organizationId,
            requestId,
          })
        ).rejects.toMatchObject({ code: "agent_access.owner_required" });
        await expect(
          withdrawAgentAccessRequest({
            db,
            nowMs: Date.now(),
            organizationId: f.organizationId,
            requestId,
            requesterUserId: f.felix.userId,
          })
        ).rejects.toMatchObject({ code: "agent_access.requester_required" });
        await withdrawAgentAccessRequest({
          db,
          nowMs: Date.now(),
          organizationId: f.organizationId,
          requestId,
          requesterUserId: f.tali.userId,
        });
        await space.instance.rpcApplyAgentAccessDecision({
          decidedByProfileId: f.tali.profileId,
          decidedByUserId: f.tali.userId,
          organizationId: f.organizationId,
          requestId,
          spaceId: space.spaceId,
          status: "withdrawn",
        });
        expect(
          readSpaceAgentAccessHold(space.state.storage.sql, requestId)
        ).toMatchObject({ state: "closed", closeReason: "withdrawn" });
        await expect(
          decideAgentAccessRequest({
            db,
            decision: "allow_once",
            deciderUserId: f.felix.userId,
            nowMs: Date.now(),
            organizationId: f.organizationId,
            requestId,
          })
        ).rejects.toMatchObject({ code: "agent_access.request_closed" });
        expect((await readInboxItem(requestId))?.resolution_status).toBe(
          "resolved"
        );
      }
    );
  });

  it("asks the owner before their Agent joins a Space, and lets the owner observe", async () => {
    const f = await seed();
    await withSpace(
      f,
      { directMessage: false, humans: [f.tali], agentMember: false },
      async (space) => {
        const message = await space.post(
          f.tali,
          "@Felix's PR Reviewer can you review the launch plan?"
        );
        const ownerAccess = createAuthenticatedSpaceAccessContext({
          requestContext: space.context(f.felix),
          spaceId: space.spaceId,
        });
        // Before any request the owner cannot read this private Space.
        expect(
          (await space.instance.authorizeSpaceAccess(ownerAccess)).ok
        ).toBe(false);
        const { requestId } = await space.instance.rpcRequestAgentForSpace({
          context: space.context(f.tali),
          organizationId: f.organizationId,
          requester: { profileId: f.tali.profileId, userId: f.tali.userId },
          signalId: message.id,
          spaceId: space.spaceId,
          target: {
            memberAgentId: f.memberAgentId,
            ownerUserId: f.felix.userId,
            profileId: f.agentProfileId,
          },
        });
        // No Wake and no membership before consent.
        expect(space.outbox(message)).toHaveLength(0);
        expect(
          readSpaceMemberRecord(space.state.storage.sql, f.agentProfileId)
        ).toBeNull();
        expect((await readInboxItem(requestId))?.kind).toBe(
          "agent_space_request"
        );
        // The owner observes: reads, but cannot post.
        expect(
          (await space.instance.authorizeSpaceAccess(ownerAccess)).ok
        ).toBe(true);
        const writable = await (
          space.instance as unknown as {
            authorizeWritableSpaceAccess(
              access: typeof ownerAccess
            ): Promise<{ ok: boolean; response?: Response }>;
          }
        ).authorizeWritableSpaceAccess(ownerAccess);
        expect(writable.ok).toBe(false);
        expect(await writable.response?.json()).toMatchObject({
          code: "space.access.read_only",
        });

        const db = getPostgresDatabase(env);
        const decided = await decideAgentAccessRequest({
          db,
          decision: "join",
          deciderUserId: f.felix.userId,
          nowMs: Date.now(),
          organizationId: f.organizationId,
          requestId,
        });
        await space.instance.rpcApplyAgentAccessDecision({
          agentMember: {
            agentControllerRef: "builtin:claude-code",
            ownerName: f.felix.name,
            ownerUserId: f.felix.userId,
            profileId: f.agentProfileId,
            profileKind: "agent",
            profileName: "PR Reviewer",
          },
          decidedByProfileId: f.felix.profileId,
          decidedByUserId: f.felix.userId,
          organizationId: f.organizationId,
          requestId,
          spaceId: space.spaceId,
          status: decided.request.status,
        });
        expect(
          readSpaceMemberRecord(space.state.storage.sql, f.agentProfileId)
            ?.status
        ).toBe("active");
        // The owner stays an observer; the bound message is dispatched with
        // the chain [requester, Agent].
        expect(
          readSpaceMemberRecord(space.state.storage.sql, f.felix.profileId)
        ).toBeNull();
        const [dispatched] = space.outbox(message);
        expect(dispatched?.requestChain).toEqual([
          { kind: "human", profileId: f.tali.profileId },
          { kind: "agent", profileId: f.agentProfileId },
        ]);
        // The observing owner reaches the answer path for their Agent's
        // questions; the runtime accepts only the Binding owner's answer.
        await expect(
          space.instance.rpcRespondToAgentInteraction({
            body: {
              interactionId: "interaction-1",
              response: { kind: "permission", optionId: "allow_once" },
              runtimeCoordinatorExecutionId: buildRuntimeCoordinatorExecutionId(
                {
                  dispatchId: "dispatch-missing",
                  spaceId: space.spaceId,
                  targetProfileId: f.agentProfileId,
                }
              ),
            },
            context: space.context(f.felix),
            spaceId: space.spaceId,
          } as Parameters<ConsentSpace["rpcRespondToAgentInteraction"]>[0])
        ).resolves.toMatchObject({ ok: false, status: "not_found" });
        expect(
          readSpaceMemberRecord(space.state.storage.sql, f.felix.profileId)
        ).toBeNull();
        // The one-time owner-participation repair never adds the observer.
        await space.instance.ensureAgentOwnerMembershipPolicy(
          space.instance.readSpaceMetaRecord()
        );
        expect(
          readSpaceMemberRecord(space.state.storage.sql, f.felix.profileId)
        ).toBeNull();
        // The same observer check refuses posts over the live stream and
        // keeps the stream from joining them as a member.
        expect(
          space.instance.isAgentOwnerObserver(
            space.context(f.felix).actorContext
          )
        ).toBe(true);
        expect(
          space.instance.isAgentOwnerObserver(
            space.context(f.tali).actorContext
          )
        ).toBe(false);
        expect(
          readSpaceMemberRecord(space.state.storage.sql, f.felix.profileId)
        ).toBeNull();
      }
    );
  });

  it("lets an Agent without Sessions join and runs the bound message like a later one", async () => {
    const f = await seed();
    const db = getPostgresDatabase(env);
    await db.query({
      text: `INSERT INTO "openmeld"."openMeldDaemon_agent_profile_bindings"
        (binding_id, owner_kind, owner_id, agent_profile_id, openmeld_service_runtime_id,
         runtime_kind, agent_controller_ref, configuration_revision, binding_state,
         created_at_ms, updated_at_ms)
        VALUES ('binding-opencode', 'owner_account', $1, $2, 'runtime-felix',
         'openmeld_service', 'builtin:opencode', 1, 'enabled_primary', 1, 1)`,
      values: [f.felix.userId, f.agentProfileId],
    });
    await withSpace(
      f,
      { directMessage: false, humans: [f.tali], agentMember: false },
      async (space) => {
        const message = await space.post(
          f.tali,
          "@PR Reviewer can you check this?"
        );
        const { requestId } = await space.instance.rpcRequestAgentForSpace({
          context: space.context(f.tali),
          organizationId: f.organizationId,
          requester: { profileId: f.tali.profileId, userId: f.tali.userId },
          signalId: message.id,
          spaceId: space.spaceId,
          target: {
            memberAgentId: f.memberAgentId,
            ownerUserId: f.felix.userId,
            profileId: f.agentProfileId,
          },
        });
        const decided = await decideAgentAccessRequest({
          db,
          decision: "join",
          deciderUserId: f.felix.userId,
          nowMs: Date.now(),
          organizationId: f.organizationId,
          requestId,
        });
        // As rpcDecideAgentAccessRequest resolves it (smoke R5-02).
        const agentMember = await requireRequestedAgentMember(
          { db, organizationId: f.organizationId } as never,
          decided.request
        );
        expect(agentMember.agentControllerRef).toBe("builtin:opencode");
        await expect(
          space.instance.rpcApplyAgentAccessDecision({
            agentMember,
            decidedByProfileId: f.felix.profileId,
            decidedByUserId: f.felix.userId,
            organizationId: f.organizationId,
            requestId,
            spaceId: space.spaceId,
            status: decided.request.status,
          })
        ).resolves.toEqual({ outcome: "applied" });
        const [released] = space.outbox(message);
        expect(released?.targetProfileId).toBe(f.agentProfileId);
        // No explicit new Session, which this harness would refuse.
        expect(released?.contextSelection).toBeUndefined();
        expect(released?.requestChain).toEqual([
          { kind: "human", profileId: f.tali.profileId },
          { kind: "agent", profileId: f.agentProfileId },
        ]);
      }
    );
  });

  it("asks before a personal Agent that has no MemberAgent yet", async () => {
    const f = await seed();
    await getPostgresDatabase(env).query({
      text: `UPDATE "openmeld"."openmeld_profiles" SET member_agent_id = NULL WHERE profile_id = $1`,
      values: [f.agentProfileId],
    });
    await withSpace(
      f,
      { directMessage: true, humans: [f.tali], agentMember: true },
      async (space) => {
        const message = await space.post(f.tali, "Can you help?");
        expect(space.outbox(message)).toHaveLength(0);
        const hold = readHeldDirectMessageAgentAccessHold(
          space.state.storage.sql,
          { requesterUserId: f.tali.userId, targetProfileId: f.agentProfileId }
        );
        expect(hold).toMatchObject({ memberAgentId: null, state: "held" });
        expect(
          await readAgentAccessRequest({
            db: asQueryable(getPostgresDatabase(env)),
            requestId: hold?.requestId ?? "",
          })
        ).toMatchObject({ memberAgentId: null, status: "pending" });
      }
    );
  });

  it("does not let a voided allow-once cover the next message, and retries are idempotent", async () => {
    const f = await seed();
    await withSpace(
      f,
      { directMessage: true, humans: [f.tali], agentMember: true },
      async (space) => {
        const first = await space.post(f.tali, "First ask");
        const hold = readHeldDirectMessageAgentAccessHold(
          space.state.storage.sql,
          { requesterUserId: f.tali.userId, targetProfileId: f.agentProfileId }
        );
        const requestId = hold?.requestId ?? "";
        const db = getPostgresDatabase(env);
        const decision = {
          db,
          decision: "allow_once" as const,
          deciderUserId: f.felix.userId,
          nowMs: Date.now(),
          organizationId: f.organizationId,
          requestId,
        };
        // Core records the answer, but the message changes before the
        // Space applies it.
        await decideAgentAccessRequest(decision);
        await expect(decideAgentAccessRequest(decision)).resolves.toMatchObject(
          { transitioned: false }
        );
        await space.instance.rpcMutateSpaceMessage({
          body: { action: "edit", expectedRevision: 0, text: "Changed ask" },
          signalId: first.id,
          spaceAccess: createAuthenticatedSpaceAccessContext({
            requestContext: space.context(f.tali),
            spaceId: space.spaceId,
          }),
          spaceId: space.spaceId,
        } as Parameters<ConsentSpace["rpcMutateSpaceMessage"]>[0]);
        while (vi.mocked(space.state.waitUntil).mock.calls.length > 0) {
          await Promise.all(
            vi
              .mocked(space.state.waitUntil)
              .mock.calls.splice(0)
              .map(([work]) => work)
          );
        }
        await expect(
          space.instance.rpcApplyAgentAccessDecision({
            decidedByProfileId: f.felix.profileId,
            decidedByUserId: f.felix.userId,
            organizationId: f.organizationId,
            requestId,
            spaceId: space.spaceId,
            status: "allowed",
          })
        ).resolves.toEqual({ outcome: "voided" });
        expect(space.outbox(first)).toHaveLength(0);
        const next = await space.post(f.tali, "A different ask");
        expect(space.outbox(next)).toHaveLength(0);
      }
    );
  });

  it("voids a Space request when its message is edited", async () => {
    const f = await seed();
    await withSpace(
      f,
      { directMessage: false, humans: [f.tali], agentMember: false },
      async (space) => {
        const message = await space.post(f.tali, "Ask the reviewer");
        const { requestId } = await space.instance.rpcRequestAgentForSpace({
          context: space.context(f.tali),
          organizationId: f.organizationId,
          requester: { profileId: f.tali.profileId, userId: f.tali.userId },
          signalId: message.id,
          spaceId: space.spaceId,
          target: {
            memberAgentId: f.memberAgentId,
            ownerUserId: f.felix.userId,
            profileId: f.agentProfileId,
          },
        });
        await space.instance.rpcMutateSpaceMessage({
          body: { action: "edit", expectedRevision: 0, text: "Never mind" },
          signalId: message.id,
          spaceAccess: createAuthenticatedSpaceAccessContext({
            requestContext: space.context(f.tali),
            spaceId: space.spaceId,
          }),
          spaceId: space.spaceId,
        } as Parameters<ConsentSpace["rpcMutateSpaceMessage"]>[0]);
        while (vi.mocked(space.state.waitUntil).mock.calls.length > 0) {
          await Promise.all(
            vi
              .mocked(space.state.waitUntil)
              .mock.calls.splice(0)
              .map(([work]) => work)
          );
        }
        expect(
          readSpaceAgentAccessHold(space.state.storage.sql, requestId)
        ).toMatchObject({ state: "closed", closeReason: "voided" });
        const db = getPostgresDatabase(env);
        expect(
          (await readAgentAccessRequest({ db: asQueryable(db), requestId }))
            ?.status
        ).toBe("voided");
        await expect(
          decideAgentAccessRequest({
            db,
            decision: "join",
            deciderUserId: f.felix.userId,
            nowMs: Date.now(),
            organizationId: f.organizationId,
            requestId,
          })
        ).rejects.toMatchObject({ code: "agent_access.request_closed" });
        // A request that arrives after the edit cannot bind to it either.
        await expect(
          space.instance.rpcRequestAgentForSpace({
            context: space.context(f.tali),
            organizationId: f.organizationId,
            requester: { profileId: f.tali.profileId, userId: f.tali.userId },
            signalId: message.id,
            spaceId: space.spaceId,
            target: {
              memberAgentId: f.memberAgentId,
              ownerUserId: f.felix.userId,
              profileId: f.agentProfileId,
            },
          })
        ).rejects.toMatchObject({ code: "agent_access.message_unavailable" });
        expect(
          readSpaceMemberRecord(space.state.storage.sql, f.agentProfileId)
        ).toBeNull();
      }
    );
  });

  it("keeps the current behavior with MemberAgents off", async () => {
    const f = await seed();
    feature.enabled = false;
    await withSpace(
      f,
      { directMessage: true, humans: [f.tali], agentMember: true },
      async (space) => {
        const message = await space.post(f.tali, "Hello");
        expect(space.outbox(message)).toHaveLength(1);
      }
    );
  });
});
