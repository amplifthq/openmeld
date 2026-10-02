import { env, runInDurableObject } from "cloudflare:test";
import { randomUUID } from "node:crypto";
import { HOSTED_CENTER_AGENT_CONTROLLER_REF } from "@openmeld/schemas";
import type { OpenMeldRequestContext } from "@openmeld/schemas/types";
import { describe, expect, it } from "vitest";
import { createSubmitTurnRequest } from "../../remote-agent/tests/fixtures";
import { createCenterAgentEvidenceSourceAccess } from "../src/center-agent/application/evidence-source-access";
import { prepareCenterAgentRepresentedMemberRequest } from "../src/center-agent/application/represented-member-request";
import type { CoreBindings } from "../src/lib/bindings";
import {
  markRemoteAgentNativeDeliveryAck,
  persistRemoteAgentWorkerSubmitRequest,
  upsertRemoteAgentNativeDeliveryRecord,
} from "../src/remote-agent/infrastructure/d1/native-delivery-ledger-repo";
import { rpcCreateSpace, rpcPostSignal } from "../src/rpc/methods";

const coreEnv = env as unknown as CoreBindings;
const NOW_MS = Date.UTC(2026, 8, 21, 10);

describe("Center Agent evidence source authorization in Workerd", () => {
  it("reads an authorized private source through its actual Space owner and hides another member's source", async () => {
    const organizationId = `evidence-org-${randomUUID()}`;
    await env.OPENMELD_DB.prepare(
      "INSERT INTO organizations (id, name, slug, created_at) VALUES (?, 'Evidence', ?, ?)"
    )
      .bind(organizationId, organizationId, NOW_MS)
      .run();
    const requester = await createMember(organizationId);
    const other = await createMember(organizationId);
    const agentProfileId = `agt_${randomUUID()}`;
    await env.OPENMELD_DB.prepare(`INSERT INTO openmeld_profiles
      (profile_id, profile_handle, profile_name, profile_kind, managed_role, organization_id, owner_user_id, is_default, status, source, created_at, updated_at)
      VALUES (?, ?, 'Center Agent', 'agent', 'center_agent', ?, NULL, 0, 'active', 'auth_bootstrap', ?, ?)`)
      .bind(
        agentProfileId,
        `evidence-agent-${randomUUID()}`,
        organizationId,
        NOW_MS,
        NOW_MS
      )
      .run();
    await env.OPENMELD_DB.prepare(`INSERT INTO center_agent_designations
      (organization_id, agent_profile_id, duty, designated_by, created_at)
      VALUES (?, ?, NULL, ?, ?)`)
      .bind(organizationId, agentProfileId, requester.userId, NOW_MS)
      .run();

    const namespace = coreEnv.OPENMELD_SPACES;
    const spaceId = namespace.newUniqueId().toString();
    const stub = namespace.get(namespace.idFromString(spaceId));
    await stub.rpcInitializeDirectMessageMeta({
      creator: {
        kind: "human",
        ownerUserId: requester.userId,
        profileId: requester.profileId,
        profileName: "Requester",
      },
      guide: "",
      name: "Requester and Center Agent",
      organizationId,
      pairKey: `${requester.profileId}:${agentProfileId}`,
      purpose: "openmeld_dm_space",
      spaceId,
      visibility: "private",
    });
    await stub.rpcPostMembers({
      context: requester.context,
      members: [
        {
          agentControllerRef: null,
          ownerName: "Requester",
          ownerUserId: requester.userId,
          profileId: requester.profileId,
          profileKind: "human",
          profileName: "Requester",
        },
        {
          agentControllerRef: HOSTED_CENTER_AGENT_CONTROLLER_REF,
          ownerUserId: null,
          ownerName: null,
          profileId: agentProfileId,
          profileKind: "agent",
          profileName: "Center Agent",
        },
      ],
      spaceId,
    });
    const hidden = await rpcCreateSpace(coreEnv, {
      context: other.context,
      name: "Private source belonging to another member",
      visibility: "private",
      accessMode: "members_only",
    });
    const base = createSubmitTurnRequest();
    const submissionId = `evidence-submission-${randomUUID()}`;
    const request = createSubmitTurnRequest({
      agentProfileId,
      agentProfileOwnerUserId: requester.userId,
      author: {
        displayName: "Requester",
        profileId: requester.profileId,
        profileKind: "human",
      },
      bindingId: `binding-${randomUUID()}`,
      dispatchId: `dispatch-${randomUUID()}`,
      idempotencyKey: `evidence-${randomUUID()}`,
      organizationId,
      spaceId,
      turnEnvelope: {
        ...base.turnEnvelope,
        organization: {
          id: organizationId,
          name: "Evidence",
          personal: false,
          memberCount: 2,
        },
        sender: {
          kind: "member",
          id: requester.memberId,
          displayName: "Requester",
          ownerUserId: requester.userId,
          profileId: requester.profileId,
          role: "member",
          verified: true,
        },
        space: {
          id: spaceId,
          name: "Requester and Center Agent",
          kind: "dm",
          isCenterAgentDm: true,
        },
      },
    });
    await upsertRemoteAgentNativeDeliveryRecord({
      db: env.OPENMELD_DB,
      nowMs: NOW_MS,
      organizationId,
      spaceId,
      profileId: agentProfileId,
      bindingId: request.bindingId,
      triggerMessageId: request.triggerMessageId,
      dispatchId: request.dispatchId,
      attemptId: null,
      idempotencyKey: request.idempotencyKey,
      status: "submitted",
      onBehalfOfProfileId: requester.profileId,
      onBehalfOfUserId: requester.userId,
      onBehalfOfDisplayName: "Requester",
    });
    await persistRemoteAgentWorkerSubmitRequest({
      db: env.OPENMELD_DB,
      idempotencyKey: request.idempotencyKey,
      nowMs: NOW_MS,
      workerSubmitRequest: request,
    });
    await markRemoteAgentNativeDeliveryAck({
      accepted: true,
      db: env.OPENMELD_DB,
      idempotencyKey: request.idempotencyKey,
      nowMs: NOW_MS,
      submissionId,
    });
    const prepared = await prepareCenterAgentRepresentedMemberRequest(
      coreEnv,
      {
        activeOrganizationId: organizationId,
        actorContext: {
          agentControllerRef: HOSTED_CENTER_AGENT_CONTROLLER_REF,
          callerPrincipalId: agentProfileId,
          openMeldProfileId: agentProfileId,
          profileKind: "agent",
          requestId: `read-${randomUUID()}`,
        },
        agentControllerConversationId: submissionId,
      },
      { memberId: requester.memberId, userId: requester.userId }
    );
    const access = await createCenterAgentEvidenceSourceAccess({
      env: coreEnv,
      prepared,
    });
    expect(access.audience).toBe("requester_private");
    await expect(access.readPermittedSpace(spaceId)).resolves.toMatchObject({
      spaceId,
      organizationId,
    });
    await expect(access.readPermittedSpace(hidden.spaceId)).resolves.toBeNull();
    const source = await rpcCreateSpace(coreEnv, {
      context: requester.context,
      name: "Prior private discussion",
      visibility: "private",
      accessMode: "members_only",
    });
    const signal = await rpcPostSignal(coreEnv, {
      authoringPolicy: "user_authored",
      context: requester.context,
      profile: {
        kind: "human",
        profileId: requester.profileId,
        profileName: "Requester",
      },
      spaceId: source.spaceId,
      text: "The review was scheduled for Friday.",
    });
    await expect(access.canReadSignal(source.spaceId, signal.id)).resolves.toBe(
      true
    );
    await expect(
      access.canReadSignal(source.spaceId, randomUUID())
    ).resolves.toBe(false);
    await expect(access.canReadSignal(hidden.spaceId, signal.id)).resolves.toBe(
      false
    );
    // The real Center Agent DM owner forbids conversion altogether. The
    // converted-audience reader regression is covered by the tool fixtures.
    const conversionError = await runInDurableObject(stub, async (instance) => {
      try {
        await instance.rpcConvertDirectMessageToSpace({
          context: requester.context,
          members: [
            {
              agentControllerRef: null,
              ownerName: "Other member",
              ownerUserId: other.userId,
              profileId: other.profileId,
              profileKind: "human",
              profileName: "Other member",
            },
          ],
          name: "Shared evidence discussion",
          spaceId,
        });
        return null;
      } catch (error) {
        return (error as Error).message;
      }
    });
    expect(conversionError).toContain(
      "Center Agent Direct Messages cannot become Spaces."
    );
  });
});

async function createMember(organizationId: string) {
  const userId = `evidence-user-${randomUUID()}`;
  const profileId = randomUUID();
  const memberId = randomUUID();
  await env.OPENMELD_DB.prepare(
    "INSERT INTO users (id, name, email, email_verified, created_at, updated_at) VALUES (?, 'Member', ?, 1, ?, ?)"
  )
    .bind(userId, `${userId}@openmeld.test`, NOW_MS, NOW_MS)
    .run();
  await env.OPENMELD_DB.prepare(
    "INSERT INTO members (id, organization_id, user_id, role, created_at) VALUES (?, ?, ?, 'member', ?)"
  )
    .bind(memberId, organizationId, userId, NOW_MS)
    .run();
  await env.OPENMELD_DB.prepare(`INSERT INTO openmeld_profiles
    (profile_id, profile_handle, profile_name, profile_kind, owner_user_id, is_default, status, source, created_at, updated_at)
    VALUES (?, ?, 'Member', 'human', ?, 1, 'active', 'auth_bootstrap', ?, ?)`)
    .bind(profileId, `evidence-member-${randomUUID()}`, userId, NOW_MS, NOW_MS)
    .run();
  const context: OpenMeldRequestContext = {
    activeOrganizationId: organizationId,
    actorContext: {
      callerPrincipalId: userId,
      ownerUserId: userId,
      openMeldProfileId: profileId,
      profileKind: "human",
      profileName: "Member",
      requestId: `request-${randomUUID()}`,
    },
  };
  return { context, memberId, profileId, userId };
}
