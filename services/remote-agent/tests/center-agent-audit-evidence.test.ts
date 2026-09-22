import { centerAgentReadAuditJournalResponseSchema } from "@openmeld/schemas";
import { afterEach, describe, expect, it } from "vitest";
import {
  rpcCenterAgentReadAuditJournal,
  rpcListCenterAgentAuditJournal,
} from "../../core/src/rpc/methods";
import { putRemoteAgentCallbackContext } from "../agent-core/callback-context";
import { buildRemoteAgentCoreContext } from "../agent-core/tool-context";
import {
  createEvidenceFixture,
  EVIDENCE_OTHER_SPACE_ID,
  EVIDENCE_SPACE_ID,
} from "./center-agent-evidence.test-support";
import { executeEvidenceCodeMode } from "./evidence-code-mode.test-support";
import {
  createRoutineTurnEnvelope,
  createSubmitTurnRequest,
  TEST_NOW_MS,
} from "./fixtures";

const fixtures: Awaited<ReturnType<typeof createEvidenceFixture>>[] = [];
const IDENTITY_REQUIRED_PATTERN = /verified|identity/i;
const RPC_UNAVAILABLE_PATTERN = /unavailable|not available|not implemented/i;
afterEach(() => {
  for (const fixture of fixtures.splice(0)) {
    fixture.harness.close();
  }
});

async function fixture(
  input: Parameters<typeof createEvidenceFixture>[0] = {}
) {
  const result = await createEvidenceFixture(input);
  fixtures.push(result);
  for (const [id, spaceId] of [
    ["allowed-action", EVIDENCE_SPACE_ID],
    ["private-action", EVIDENCE_OTHER_SPACE_ID],
  ] as const) {
    result.harness.run({
      sql: `INSERT INTO center_agent_audit_journal
        (id, organization_id, actor_profile_id, action, resource_type, resource_id, source_space_id, created_at)
        VALUES (?, ?, ?, 'create_space', 'space', ?, ?, ?)`,
      params: [
        id,
        result.request.organizationId,
        result.request.agentProfileId,
        spaceId,
        spaceId,
        TEST_NOW_MS,
      ],
    });
  }
  return result;
}

function context(f: Awaited<ReturnType<typeof fixture>>) {
  return buildRemoteAgentCoreContext(f.callbackContext, "audit-evidence-test");
}

function request(f: Awaited<ReturnType<typeof fixture>>) {
  return {
    actionSet: "v21" as const,
    context: context(f),
    speakerMember: { memberId: f.speaker.id, userId: f.speaker.ownerUserId },
  };
}

describe("member-attributed Center Agent audit evidence", () => {
  it("reads real journal records from the normal tool without borrowing an owner identity", async () => {
    const f = await fixture();
    await expect(
      rpcListCenterAgentAuditJournal(f.env, {
        actionSet: "v21",
        context: context(f),
      })
    ).rejects.toMatchObject({ code: "organization.membership_required" });
    const output = await executeEvidenceCodeMode({
      fixture: f,
      binding: {
        centerAgentReadAuditJournal: (input) =>
          rpcCenterAgentReadAuditJournal(f.env, input),
      },
      toolName: "openmeld_read_center_agent_activity",
      payload: { limit: 25 },
    });
    const result = centerAgentReadAuditJournalResponseSchema.parse(
      (output as { result: unknown }).result
    );
    expect(result.entries).toHaveLength(2);
    expect(
      result.entries.find((entry) => entry.id === "allowed-action")
    ).toMatchObject({
      action: "create_space",
      actorProfileId: f.request.agentProfileId,
      resource: { id: EVIDENCE_SPACE_ID, type: "space" },
      sourceSpaceId: EVIDENCE_SPACE_ID,
    });
    expect(
      result.entries.find((entry) => entry.id === "private-action")
    ).toMatchObject({
      resource: null,
      sourceSpaceId: null,
    });
    expect(JSON.stringify(result)).not.toContain(EVIDENCE_OTHER_SPACE_ID);
    expect(f.sourceReads[0]?.memberContext.actorContext).toMatchObject({
      callerPrincipalId: f.speaker.ownerUserId,
      openMeldProfileId: f.speaker.profileId,
      profileKind: "human",
    });
    expect(context(f).actorContext).not.toHaveProperty("ownerUserId");
    expect(result.coverage.historicalCompleteness).toBe("not_claimed");
  });

  it.each([
    "revoked_member",
    "wrong_member",
    "wrong_organization",
    "stale_designation",
    "personal_agent",
  ] as const)("rejects %s at real Core authorization", async (failure) => {
    const f = await fixture();
    const input = request(f);
    if (failure === "revoked_member") {
      f.harness.run({
        sql: "DELETE FROM members WHERE id = ?",
        params: [f.speaker.id],
      });
    } else if (failure === "wrong_member") {
      input.speakerMember.userId = "unrelated-user";
    } else if (failure === "wrong_organization") {
      input.context.activeOrganizationId = "unrelated-organization";
    } else if (failure === "stale_designation") {
      const replacement = "agt_33333333-3333-4333-8333-333333333333";
      f.harness.run({
        sql: `INSERT INTO openmeld_profiles
            SELECT ?, profile_name, profile_kind, is_default, status, organization_id, owner_user_id, managed_role
            FROM openmeld_profiles WHERE profile_id = ?`,
        params: [replacement, f.request.agentProfileId],
      });
      f.harness.run({
        sql: "UPDATE center_agent_designations SET agent_profile_id = ?",
        params: [replacement],
      });
    } else {
      input.context.actorContext.ownerUserId = f.speaker.ownerUserId;
    }
    await expect(
      rpcCenterAgentReadAuditJournal(f.env, input)
    ).rejects.toMatchObject({ status: 403 });
    expect(f.sourceReads).toHaveLength(0);
  });

  it("does not disclose another readable private source into a shared conversation", async () => {
    const base = createSubmitTurnRequest();
    const f = await fixture({
      request: createSubmitTurnRequest({
        spaceId: EVIDENCE_SPACE_ID,
        turnEnvelope: {
          ...base.turnEnvelope,
          interactionEnvironment: "organization_shared",
          space: {
            ...base.turnEnvelope.space,
            id: EVIDENCE_SPACE_ID,
            kind: "space",
            isCenterAgentDm: false,
          },
          trigger: { source: "space_wake" },
        },
      }),
    });
    f.spaces.set(EVIDENCE_OTHER_SPACE_ID, {
      spaceId: EVIDENCE_OTHER_SPACE_ID,
      organizationId: f.request.organizationId,
      accessMode: "members_only",
      visibility: "private",
      name: "Private decision",
    });
    const result = await rpcCenterAgentReadAuditJournal(f.env, request(f));
    expect(
      result.entries.find((entry) => entry.id === "allowed-action")?.resource
        ?.id
    ).toBe(EVIDENCE_SPACE_ID);
    expect(JSON.stringify(result)).not.toContain(EVIDENCE_OTHER_SPACE_ID);
    expect(JSON.stringify(result)).not.toContain("Private decision");
  });

  it("uses the current delegated member for a Routine read and rechecks revocation", async () => {
    const envelope = createRoutineTurnEnvelope({
      destination: { kind: "space", spaceId: EVIDENCE_SPACE_ID },
    });
    const f = await fixture({
      request: createSubmitTurnRequest({
        spaceId: EVIDENCE_SPACE_ID,
        turnEnvelope: {
          ...envelope,
          space: { ...envelope.space, id: EVIDENCE_SPACE_ID },
        },
      }),
    });
    const binding = {
      centerAgentReadAuditJournal: (
        input: Parameters<typeof rpcCenterAgentReadAuditJournal>[1]
      ) => rpcCenterAgentReadAuditJournal(f.env, input),
    };
    const result = centerAgentReadAuditJournalResponseSchema.parse(
      await f.execute(binding, "openmeld_read_center_agent_activity")
    );
    expect(result.entries).toHaveLength(2);
    f.harness.run({
      sql: "DELETE FROM members WHERE id = ?",
      params: [f.speaker.id],
    });
    await expect(
      f.execute(binding, "openmeld_read_center_agent_activity")
    ).rejects.toMatchObject({ status: 403 });
  });

  it("does not use a stale private turn envelope after its reply audience has changed", async () => {
    const f = await fixture();
    f.spaces.set(EVIDENCE_OTHER_SPACE_ID, {
      spaceId: EVIDENCE_OTHER_SPACE_ID,
      organizationId: f.request.organizationId,
      visibility: "private",
      accessMode: "members_only",
      name: "Other readable private source",
    });
    f.spaces.set(EVIDENCE_SPACE_ID, {
      spaceId: EVIDENCE_SPACE_ID,
      organizationId: f.request.organizationId,
      visibility: "private",
      accessMode: "members_only",
      directMessage: {
        pairKey: "converted",
        convertedAt: new Date(TEST_NOW_MS).toISOString(),
      },
    });
    const result = await rpcCenterAgentReadAuditJournal(f.env, request(f));
    expect(result.entries).toHaveLength(2);
    expect(
      result.entries.every(
        (entry) => entry.resource === null && entry.sourceSpaceId === null
      )
    ).toBe(true);
    expect(JSON.stringify(result)).not.toContain(EVIDENCE_OTHER_SPACE_ID);
  });

  it("rejects a missing verified speaker before calling Core", async () => {
    const f = await fixture();
    const envelope = f.request.turnEnvelope;
    if (envelope.sender.kind !== "member") {
      throw new Error("Expected the interactive fixture.");
    }
    await putRemoteAgentCallbackContext(f.storage, {
      ...f.callbackContext,
      turnEnvelope: {
        ...envelope,
        sender: { ...envelope.sender, verified: false },
      },
    });
    let called = false;
    await expect(
      f.execute(
        {
          centerAgentReadAuditJournal: (input) => {
            called = true;
            return rpcCenterAgentReadAuditJournal(f.env, input);
          },
        },
        "openmeld_read_center_agent_activity"
      )
    ).rejects.toThrow(IDENTITY_REQUIRED_PATTERN);
    expect(called).toBe(false);
  });

  it("fails explicitly with an older Core instead of falling back to the human endpoint", async () => {
    const f = await fixture();
    let oldEndpointCalled = false;
    await expect(
      f.execute(
        {
          listCenterAgentAuditJournal: () => {
            oldEndpointCalled = true;
            return Promise.resolve({});
          },
        },
        "openmeld_read_center_agent_activity"
      )
    ).rejects.toThrow(RPC_UNAVAILABLE_PATTERN);
    expect(oldEndpointCalled).toBe(false);
  });
});
