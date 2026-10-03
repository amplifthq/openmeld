import type {
  OpenMeldRequestContext,
  SpaceMeta,
} from "@openmeld/schemas/types";
import { beforeAll, onTestFinished } from "vitest";
import type { CoreBindings } from "../../core/src/lib/bindings";
import {
  markRemoteAgentNativeDeliveryAck,
  persistRemoteAgentWorkerSubmitRequest,
  upsertRemoteAgentNativeDeliveryRecord,
} from "../../core/src/remote-agent/infrastructure/postgresql/native-delivery-ledger-repo";
import {
  createPostgresHarness,
  preparePostgresTestTemplate,
} from "../../core/tests-node/helpers/postgresql-harness.test-support";
import {
  createRemoteAgentCallbackContext,
  putRemoteAgentCallbackContext,
  type RemoteAgentCoreWorkerBinding,
} from "../agent-core/callback-context";
import {
  getRemoteAgentOpenMeldToolDefinitions,
  type RemoteAgentOpenMeldToolName,
} from "../agent-core/tools";
import { createSubmitTurnRequest, TEST_NOW_MS } from "./fixtures";
import { InMemoryDurableObjectStorage } from "./storage";

export const EVIDENCE_SPACE_ID = "a".repeat(64);
export const EVIDENCE_OTHER_SPACE_ID = "b".repeat(64);
export const EVIDENCE_SUBMISSION_ID = "evidence-submission";

beforeAll(preparePostgresTestTemplate);

/** Real Core repositories/authorization, with a controlled Space service boundary. */
export async function createEvidenceFixture(
  input: { request?: ReturnType<typeof createSubmitTurnRequest> } = {}
) {
  const base = createSubmitTurnRequest();
  const request =
    input.request ??
    createSubmitTurnRequest({
      spaceId: EVIDENCE_SPACE_ID,
      turnEnvelope: {
        ...base.turnEnvelope,
        space: { ...base.turnEnvelope.space, id: EVIDENCE_SPACE_ID },
      },
    });
  const sender = request.turnEnvelope.sender;
  if (sender.kind !== "routine" && sender.kind !== "member") {
    throw new Error("The fixture needs a member-attributed source.");
  }
  const candidate = sender.kind === "routine" ? sender.delegatedBy : sender;
  if (!(candidate.verified && candidate.ownerUserId && candidate.profileId)) {
    throw new Error("The fixture needs a verified source member.");
  }
  const speaker = {
    ...candidate,
    ownerUserId: candidate.ownerUserId,
    profileId: candidate.profileId,
  };
  const harness = await createPostgresHarness();
  onTestFinished(() => harness.close());
  await harness.query({
    text: "INSERT INTO openmeld.users (id, name, email) VALUES ($1, 'Member', 'member-evidence@example.invalid')",
    values: [speaker.ownerUserId],
  });
  await harness.query({
    text: "INSERT INTO openmeld.organizations (id, name, slug, created_at) VALUES ($1, 'Evidence Organization', 'evidence', $2)",
    values: [request.organizationId, TEST_NOW_MS],
  });
  await harness.query({
    text: "INSERT INTO openmeld.members (id, organization_id, user_id, role, created_at) VALUES ($1, $2, $3, 'member', $4)",
    values: [
      speaker.id,
      request.organizationId,
      speaker.ownerUserId,
      TEST_NOW_MS,
    ],
  });
  await harness.query({
    text: `INSERT INTO openmeld.openmeld_profiles (
      profile_id, profile_name, profile_handle, profile_kind, is_default, status,
      organization_id, owner_user_id, managed_role, source
    ) VALUES ($1, 'Member', 'evidence-member', 'human', 1, 'active', NULL, $2, NULL, 'auth_bootstrap'),
      ($3, 'Center Agent', 'evidence-center-agent', 'agent', 0, 'active', $4, NULL, 'center_agent', 'center_agent_create')`,
    values: [
      speaker.profileId,
      speaker.ownerUserId,
      request.agentProfileId,
      request.organizationId,
    ],
  });
  await harness.query({
    text: `INSERT INTO openmeld.center_agent_designations
      (organization_id, agent_profile_id, duty, designated_by, created_at)
      VALUES ($1, $2, NULL, $3, $4)`,
    values: [
      request.organizationId,
      request.agentProfileId,
      speaker.ownerUserId,
      TEST_NOW_MS,
    ],
  });
  await upsertRemoteAgentNativeDeliveryRecord({
    db: harness.db,
    deliveryId: "evidence-delivery",
    nowMs: TEST_NOW_MS,
    organizationId: request.organizationId,
    spaceId: request.spaceId,
    profileId: request.agentProfileId,
    bindingId: request.bindingId,
    triggerMessageId: request.triggerMessageId,
    dispatchId: request.dispatchId,
    attemptId: null,
    idempotencyKey: request.idempotencyKey,
    status: "submitted",
    onBehalfOfProfileId: speaker.profileId,
    onBehalfOfUserId: speaker.ownerUserId,
    onBehalfOfDisplayName: speaker.displayName,
  });
  await persistRemoteAgentWorkerSubmitRequest({
    db: harness.db,
    idempotencyKey: request.idempotencyKey,
    nowMs: TEST_NOW_MS,
    workerSubmitRequest: request,
  });
  await markRemoteAgentNativeDeliveryAck({
    accepted: true,
    db: harness.db,
    idempotencyKey: request.idempotencyKey,
    nowMs: TEST_NOW_MS,
    submissionId: EVIDENCE_SUBMISSION_ID,
  });
  const sourceReads: Array<{
    spaceId: string;
    memberContext: OpenMeldRequestContext;
  }> = [];
  const spaces = new Map<string, SpaceMeta>([
    [
      request.spaceId,
      {
        spaceId: request.spaceId,
        organizationId: request.organizationId,
        visibility: "private",
        accessMode: "members_only",
        name: "Allowed source",
        ...(request.turnEnvelope.space.kind === "dm"
          ? {
              directMessage: {
                pairKey: `${speaker.profileId}:${request.agentProfileId}`,
              },
            }
          : {}),
      },
    ],
  ]);
  const signals = new Map<string, Set<string>>();
  const signalReads: {
    spaceId: string;
    signalId: string;
    memberContext: OpenMeldRequestContext;
  }[] = [];
  const env = {
    OPENMELD_POSTGRESQL: harness.binding,
    OPENMELD_SPACES: {
      idFromString: (spaceId: string) => spaceId,
      get: (spaceId: string) => ({
        rpcListSignals: ({
          aroundSignalId,
          spaceAccess,
        }: {
          aroundSignalId: string;
          spaceAccess: { actor: { requestContext: OpenMeldRequestContext } };
        }) => {
          const memberContext = spaceAccess.actor.requestContext;
          signalReads.push({
            spaceId,
            signalId: aroundSignalId,
            memberContext,
          });
          if (
            !spaces.has(spaceId) ||
            memberContext.actorContext.openMeldProfileId !== speaker.profileId
          ) {
            return Promise.reject(new Error("Source is not readable."));
          }
          return Promise.resolve({
            signals: signals.get(spaceId)?.has(aroundSignalId)
              ? [
                  {
                    id: aroundSignalId,
                    type: "signal.text",
                    data: { text: "Retained source turn" },
                  },
                ]
              : [],
          });
        },
        rpcGetEvidenceReadContext: ({
          spaceAccess,
        }: {
          spaceAccess: { actor: { requestContext: OpenMeldRequestContext } };
        }) => {
          const memberContext = spaceAccess.actor.requestContext;
          sourceReads.push({ spaceId, memberContext });
          const record = spaces.get(spaceId);
          if (
            !record ||
            memberContext.actorContext.openMeldProfileId !== speaker.profileId
          ) {
            return Promise.reject(new Error("Source is not readable."));
          }
          const { directMessage, ...meta } = record;
          return Promise.resolve({
            meta,
            isDirectMessage: Boolean(
              directMessage && !directMessage.convertedAt
            ),
          });
        },
        rpcGetMeta: ({
          spaceAccess,
        }: {
          spaceAccess: { actor: { requestContext: OpenMeldRequestContext } };
        }) => {
          const memberContext = spaceAccess.actor.requestContext;
          sourceReads.push({ spaceId, memberContext });
          const meta = spaces.get(spaceId);
          if (
            !meta ||
            memberContext.actorContext.openMeldProfileId !== speaker.profileId
          ) {
            return Promise.reject(new Error("Source is not readable."));
          }
          const { directMessage: _privateMetadata, ...publicMeta } = meta;
          return Promise.resolve(publicMeta);
        },
      }),
    },
  } as unknown as CoreBindings;
  const storage = new InMemoryDurableObjectStorage();
  const callbackContext = createRemoteAgentCallbackContext({
    ack: {
      accepted: true,
      createdAt: TEST_NOW_MS,
      idempotencyKey: request.idempotencyKey,
      requestId: EVIDENCE_SUBMISSION_ID,
      status: "pending",
      submissionId: EVIDENCE_SUBMISSION_ID,
    },
    nowMs: TEST_NOW_MS,
    request,
  });
  await putRemoteAgentCallbackContext(storage, callbackContext);

  function tools(coreWorker: RemoteAgentCoreWorkerBinding) {
    return getRemoteAgentOpenMeldToolDefinitions({
      agentActivityReadEnabled: true,
      coreWorker,
      storage,
      submissionId: EVIDENCE_SUBMISSION_ID,
      turnEnvelope: request.turnEnvelope,
    });
  }
  async function execute(
    coreWorker: RemoteAgentCoreWorkerBinding,
    name: RemoteAgentOpenMeldToolName,
    payload = {}
  ) {
    const tool = tools(coreWorker).find((candidate) => candidate.name === name);
    if (!tool) {
      throw new Error(`Missing tool ${name}`);
    }
    return await tool.execute(payload);
  }
  return {
    callbackContext,
    env,
    execute,
    harness,
    request,
    signals,
    signalReads,
    sourceReads,
    spaces,
    speaker,
    storage,
    tools,
  };
}
