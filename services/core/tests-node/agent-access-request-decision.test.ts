import { readFileSync } from "node:fs";
import { URL } from "node:url";
import type { AgentAccessDecision } from "@openmeld/schemas";
import { describe, expect, it } from "vitest";
import {
  alwaysAllowAgentProfileMember,
  decideAgentAccessRequest,
  readAgentAccessRequestView,
  withdrawAgentAccessRequest,
} from "../src/agent-access/application/agent-access-service";
import {
  asQueryable,
  insertAgentAccessRequest,
  readActiveAgentAccessGrants,
  readAgentAccessRequest,
  revokeAgentProfileAccessGrant,
} from "../src/agent-access/infrastructure/postgresql/agent-access-repo";
import { createPostgresHarness } from "./helpers/postgresql-harness.test-support";

type Harness = Awaited<ReturnType<typeof createPostgresHarness>>;

const ORG = "org_access";
const OWNER = "user_tali";
const REQUESTER = "user_felix";
// Has an account but is not in the Organization.
const EXTERNAL = "user_sam";
const AGENT = "agt_7d3c1a40-5f2e-4b8a-9c61-0e4b2d9f8a17";
const HUMAN_PROFILES: Record<string, string> = {
  [OWNER]: "2a9e6f10-3b4c-4d5e-8f60-71a2b3c4d5e6",
  [REQUESTER]: "4c1b7e20-6d3a-4f9b-a812-93c4d5e6f708",
};

describe("Agent access request decisions (member-agent-program.md §7)", () => {
  it.each([
    ["allow_once", "once"],
    ["always_allow", "always"],
  ] as const)("stores %s as the owner's decision next to an active %s grant", async (decision, scope) => {
    await withHarness(async (harness) => {
      const requestId = await insertRequest(harness, "aar_1");
      await decide(harness, requestId, decision);
      const stored = await read(harness, requestId);
      expect(stored).toMatchObject({ status: "allowed", decision });
      const view = await readAgentAccessRequestView({
        db: harness.db,
        request: stored,
        viewerUserId: REQUESTER,
      });
      expect(view).toMatchObject({
        decision,
        grant: { status: "active", revokedAt: null },
        viewerRole: "requester",
      });
      expect(
        await harness.queryFirst({
          text: `SELECT scope FROM "openmeld"."agent_profile_access_grants" WHERE request_id = $1`,
          values: [requestId],
        })
      ).toEqual({ scope });
    });
  });

  it("keeps the decision when the owner revokes its grant and shows the grant revoked", async () => {
    await withHarness(async (harness) => {
      const requestId = await insertRequest(harness, "aar_1");
      await decide(harness, requestId, "always_allow");
      const grant = await harness.queryFirst<{ id: string }>({
        text: `SELECT id FROM "openmeld"."agent_profile_access_grants" WHERE request_id = $1`,
        values: [requestId],
      });
      const revoked = await revokeAgentProfileAccessGrant({
        db: asQueryable(harness.db),
        grantId: grant?.id ?? "",
        nowMs: 5000,
        profileId: AGENT,
        revokedByUserId: OWNER,
      });
      expect(revoked).not.toBeNull();
      const view = await readAgentAccessRequestView({
        db: harness.db,
        request: await read(harness, requestId),
        viewerUserId: REQUESTER,
      });
      expect(view).toMatchObject({
        status: "allowed",
        decision: "always_allow",
        grant: { status: "revoked", revokedAt: new Date(5000).toISOString() },
      });
    });
  });

  it("has no decision or grant while pending, after a decline, or after a withdraw", async () => {
    await withHarness(async (harness) => {
      const pending = await insertRequest(harness, "aar_pending");
      const declined = await insertRequest(harness, "aar_declined");
      const withdrawn = await insertRequest(harness, "aar_withdrawn");
      await decide(harness, declined, "decline");
      await withdrawAgentAccessRequest({
        db: harness.db,
        nowMs: 3000,
        organizationId: ORG,
        requestId: withdrawn,
        requesterUserId: REQUESTER,
      });
      const views = await Promise.all(
        [pending, declined, withdrawn].map(async (requestId) =>
          readAgentAccessRequestView({
            db: harness.db,
            request: await read(harness, requestId),
            viewerUserId: REQUESTER,
          })
        )
      );
      expect(
        views.map(({ status, decision, grant }) => ({
          status,
          decision,
          grant,
        }))
      ).toEqual([
        { status: "pending", decision: null, grant: null },
        { status: "declined", decision: "decline", grant: null },
        { status: "withdrawn", decision: null, grant: null },
      ]);
    });
  });

  it("returns the stored answer on a retry and rejects a different allow", async () => {
    await withHarness(async (harness) => {
      const requestId = await insertRequest(harness, "aar_1");
      await decide(harness, requestId, "allow_once");
      await expect(
        decide(harness, requestId, "allow_once")
      ).resolves.toMatchObject({ transitioned: false });
      // Both allows move a request to `allowed`; the answer tells them apart.
      await expect(
        decide(harness, requestId, "always_allow")
      ).rejects.toMatchObject({ code: "agent_access.request_closed" });
      expect(await read(harness, requestId)).toMatchObject({
        decision: "allow_once",
      });
    });
  });

  it("rejects a decision that disagrees with the status", async () => {
    await withHarness(async (harness) => {
      const requestId = await insertRequest(harness, "aar_1");
      await expect(
        harness.query({
          text: `UPDATE "openmeld"."agent_access_requests" SET status = 'declined', decided_at_ms = 2000, decision = 'always_allow' WHERE id = $1`,
          values: [requestId],
        })
      ).rejects.toMatchObject({
        constraint: "agent_access_requests_owner_decision_check",
      });
    });
  });

  it("backfills earlier answers from the status and the grant each request wrote", async () => {
    await withHarness(async (harness) => {
      const ids = {
        always: await insertRequest(harness, "aar_always"),
        once: await insertRequest(harness, "aar_once"),
        allowedWithoutGrant: await insertRequest(harness, "aar_bare"),
        declined: await insertRequest(harness, "aar_declined"),
        voidedOnce: await insertRequest(harness, "aar_voided_once"),
        voidedPending: await insertRequest(harness, "aar_voided_pending"),
        withdrawn: await insertRequest(harness, "aar_withdrawn"),
        pending: await insertRequest(harness, "aar_pending"),
      };
      await decide(harness, ids.always, "always_allow");
      await decide(harness, ids.once, "allow_once");
      await decide(harness, ids.allowedWithoutGrant, "allow_once");
      await decide(harness, ids.declined, "decline");
      await decide(harness, ids.voidedOnce, "allow_once");
      await harness.query({
        text: `DELETE FROM "openmeld"."agent_profile_access_grants" WHERE request_id = $1`,
        values: [ids.allowedWithoutGrant],
      });
      await harness.query({
        text: `UPDATE "openmeld"."agent_access_requests" SET status = 'voided', decided_at_ms = 2000 WHERE id = ANY($1::text[])`,
        values: [[ids.voidedOnce, ids.voidedPending]],
      });
      await harness.query({
        text: `UPDATE "openmeld"."agent_access_requests" SET status = 'withdrawn', decided_at_ms = 2000 WHERE id = $1`,
        values: [ids.withdrawn],
      });
      // Back to the shape before migration 0047, then run its backfill.
      const [, backfill, constraint] = readFileSync(
        new URL(
          "../../../packages/db/postgresql/migrations/0047_agent_access_request_decisions.sql",
          import.meta.url
        ),
        "utf8"
      ).split("--> statement-breakpoint");
      await harness.query({
        text: `ALTER TABLE "openmeld"."agent_access_requests" DROP CONSTRAINT "agent_access_requests_owner_decision_check"`,
      });
      await harness.query({
        text: `UPDATE "openmeld"."agent_access_requests" SET decision = NULL`,
      });
      await harness.query({ text: backfill ?? "" });
      await harness.query({ text: constraint ?? "" });
      const rows = await harness.queryAll<{ id: string; decision: string }>({
        text: `SELECT id, decision FROM "openmeld"."agent_access_requests"`,
      });
      const decisions = Object.fromEntries(
        rows.map((row) => [row.id, row.decision])
      );
      expect(decisions).toEqual({
        [ids.always]: "always_allow",
        [ids.once]: "allow_once",
        [ids.allowedWithoutGrant]: "allow_once",
        [ids.declined]: "decline",
        [ids.voidedOnce]: "allow_once",
        [ids.voidedPending]: null,
        [ids.withdrawn]: null,
        [ids.pending]: null,
      });
    });
  });
});

describe("Always allowing a member after the fact", () => {
  it("writes a standing grant that retires the one-chat grant and keeps the request's decision", async () => {
    await withHarness(async (harness) => {
      const requestId = await insertRequest(harness, "aar_1");
      await decide(harness, requestId, "allow_once");
      const first = await alwaysAllow(harness, REQUESTER);
      expect(first).toMatchObject({
        created: true,
        grant: {
          granteeUserId: REQUESTER,
          granteeKind: "member",
          scope: "always",
          requestId: null,
          revokedAtMs: null,
        },
      });
      const view = await readAgentAccessRequestView({
        db: harness.db,
        request: await read(harness, requestId),
        viewerUserId: REQUESTER,
      });
      // The answer stays; the standing grant replaces its one-chat grant.
      expect(view).toMatchObject({
        status: "allowed",
        decision: "allow_once",
        grant: { status: "revoked", revokedAt: new Date(4000).toISOString() },
      });
      const again = await alwaysAllow(harness, REQUESTER);
      expect(again).toMatchObject({
        created: false,
        grant: { id: first.grant.id },
      });
      expect(
        await harness.queryAll({
          text: `SELECT scope FROM "openmeld"."agent_profile_access_grants" WHERE grantee_user_id = $1 ORDER BY scope`,
          values: [REQUESTER],
        })
      ).toEqual([{ scope: "always" }, { scope: "once" }]);
    });
  });

  it("leaves no access in the original chat after the standing grant is revoked", async () => {
    await withHarness(async (harness) => {
      const requestId = await insertRequest(harness, "aar_1");
      await decide(harness, requestId, "allow_once");
      const standing = await alwaysAllow(harness, REQUESTER);
      const before = await readActiveAgentAccessGrants({
        db: asQueryable(harness.db),
        granteeUserId: REQUESTER,
        profileId: AGENT,
        spaceId: "dm_aar_1",
      });
      expect(before).toEqual({ always: true, session: false });
      await revokeAgentProfileAccessGrant({
        db: asQueryable(harness.db),
        grantId: standing.grant.id,
        nowMs: 5000,
        profileId: AGENT,
        revokedByUserId: OWNER,
      });
      expect(
        await readActiveAgentAccessGrants({
          db: asQueryable(harness.db),
          granteeUserId: REQUESTER,
          profileId: AGENT,
          spaceId: "dm_aar_1",
        })
      ).toEqual({ always: false, session: false });
      expect(
        await readAgentAccessRequestView({
          db: harness.db,
          request: await read(harness, requestId),
          viewerUserId: REQUESTER,
        })
      ).toMatchObject({
        decision: "allow_once",
        grant: { status: "revoked" },
      });
    });
  });

  it("writes a new grant after the standing one was revoked", async () => {
    await withHarness(async (harness) => {
      const first = await alwaysAllow(harness, REQUESTER);
      await revokeAgentProfileAccessGrant({
        db: asQueryable(harness.db),
        grantId: first.grant.id,
        nowMs: 5000,
        profileId: AGENT,
        revokedByUserId: OWNER,
      });
      const next = await alwaysAllow(harness, REQUESTER);
      expect(next.created).toBe(true);
      expect(next.grant.id).not.toBe(first.grant.id);
    });
  });

  it("refuses external users and the owner", async () => {
    await withHarness(async (harness) => {
      await expect(alwaysAllow(harness, EXTERNAL)).rejects.toMatchObject({
        code: "agent_access.decision_unavailable",
      });
      await expect(alwaysAllow(harness, OWNER)).rejects.toMatchObject({
        code: "agent_access.grantee_is_owner",
      });
      expect(
        await harness.queryAll({
          text: `SELECT id FROM "openmeld"."agent_profile_access_grants"`,
        })
      ).toEqual([]);
    });
  });
});

async function alwaysAllow(harness: Harness, granteeUserId: string) {
  return await alwaysAllowAgentProfileMember({
    db: harness.db,
    granteeUserId,
    nowMs: 4000,
    organizationId: ORG,
    ownerUserId: OWNER,
    profileId: AGENT,
  });
}

async function withHarness(run: (harness: Harness) => Promise<void>) {
  const harness = await createPostgresHarness();
  try {
    await seed(harness);
    await run(harness);
  } finally {
    await harness.close();
  }
}

async function seed(harness: Harness) {
  await harness.query({
    text: `INSERT INTO "openmeld"."organizations" (id, name, slug, created_at) VALUES ($1, 'Access', 'access', 1000)`,
    values: [ORG],
  });
  for (const [userId, name] of [
    [OWNER, "Tali"],
    [REQUESTER, "Felix"],
  ] as const) {
    await harness.query({
      text: `INSERT INTO "openmeld"."users" (id, name, email) VALUES ($1, $2, $3)`,
      values: [userId, name, `${userId}@example.test`],
    });
    await harness.query({
      text: `INSERT INTO "openmeld"."openmeld_profiles" (profile_id, profile_name, profile_handle, profile_kind, is_default, status, owner_user_id, created_by_user_id, source, created_at, updated_at) VALUES ($1, $2, $1, 'human', 1, 'active', $3, $3, 'auth_bootstrap', 1000, 1000)`,
      values: [HUMAN_PROFILES[userId], name, userId],
    });
    await harness.query({
      text: `INSERT INTO "openmeld"."members" (id, organization_id, user_id, role, created_at) VALUES ($1, $2, $3, 'member', 1000)`,
      values: [`member_${userId}`, ORG, userId],
    });
  }
  await harness.query({
    text: `INSERT INTO "openmeld"."users" (id, name, email) VALUES ($1, 'Sam', $2)`,
    values: [EXTERNAL, `${EXTERNAL}@example.test`],
  });
  await harness.query({
    text: `INSERT INTO "openmeld"."openmeld_profiles" (profile_id, profile_name, profile_handle, profile_kind, is_default, status, organization_id, owner_user_id, created_by_user_id, source, created_at, updated_at) VALUES ($1, 'Codex', $1, 'agent', 0, 'active', $2, $3, $3, 'cli_create', 1000, 1000)`,
    values: [AGENT, ORG, OWNER],
  });
}

async function insertRequest(harness: Harness, id: string): Promise<string> {
  await insertAgentAccessRequest({
    db: asQueryable(harness.db),
    request: {
      id,
      organizationId: ORG,
      kind: "direct_message",
      spaceId: `dm_${id}`,
      sourceSignalId: `sig_${id}`,
      agentProfileId: AGENT,
      memberAgentId: null,
      ownerUserId: OWNER,
      requesterUserId: REQUESTER,
      requesterProfileId: HUMAN_PROFILES[REQUESTER] ?? "",
      requesterKind: "member",
      createdAtMs: 1000,
    },
  });
  return id;
}

async function decide(
  harness: Harness,
  requestId: string,
  decision: AgentAccessDecision
) {
  return await decideAgentAccessRequest({
    db: harness.db,
    decision,
    deciderUserId: OWNER,
    nowMs: 2000,
    organizationId: ORG,
    requestId,
  });
}

async function read(harness: Harness, requestId: string) {
  const request = await readAgentAccessRequest({
    db: asQueryable(harness.db),
    requestId,
  });
  if (!request) {
    throw new Error(`Expected request ${requestId}.`);
  }
  return request;
}
