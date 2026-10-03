import type {
  OpenMeldRequestContext,
  SpaceMeta,
} from "@openmeld/schemas/types";
import type { CoreBindings } from "../../core/src/lib/bindings";
import {
  markRemoteAgentNativeDeliveryAck,
  persistRemoteAgentWorkerSubmitRequest,
  upsertRemoteAgentNativeDeliveryRecord,
} from "../../core/src/remote-agent/infrastructure/postgresql/native-delivery-ledger-repo";
import {
  applyDrizzleMigrationsForTables,
  createSqliteD1Harness,
} from "../../core/tests-node/helpers/sqlite-d1-harness.test-support";
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
  const harness = createSqliteD1Harness();
  for (const sql of [
    "CREATE TABLE users (id TEXT PRIMARY KEY, name TEXT)",
    "CREATE TABLE organizations (id TEXT PRIMARY KEY, name TEXT, slug TEXT)",
    "CREATE TABLE members (id TEXT PRIMARY KEY, organization_id TEXT NOT NULL, user_id TEXT NOT NULL, role TEXT NOT NULL, created_at INTEGER)",
    `CREATE TABLE openmeld_profiles (
      profile_id TEXT PRIMARY KEY, profile_name TEXT NOT NULL,
      profile_kind TEXT NOT NULL, is_default INTEGER NOT NULL DEFAULT 0,
      status TEXT NOT NULL, organization_id TEXT, owner_user_id TEXT,
      managed_role TEXT
    )`,
  ]) {
    harness.run({ sql });
  }
  applyDrizzleMigrationsForTables(harness, [
    "center_agent_designations",
    "center_agent_audit_journal",
    "center_agent_context_manifests",
    "center_agent_context_load_receipts",
    "openMeldRemoteAgent_native_delivery_ledger",
  ]);
  harness.run({
    sql: "INSERT INTO users (id, name) VALUES (?, 'Member')",
    params: [speaker.ownerUserId],
  });
  harness.run({
    sql: "INSERT INTO organizations (id, name, slug) VALUES (?, 'Evidence Organization', 'evidence')",
    params: [request.organizationId],
  });
  harness.run({
    sql: "INSERT INTO members (id, organization_id, user_id, role, created_at) VALUES (?, ?, ?, 'member', ?)",
    params: [
      speaker.id,
      request.organizationId,
      speaker.ownerUserId,
      TEST_NOW_MS,
    ],
  });
  harness.run({
    sql: `INSERT INTO openmeld_profiles (
      profile_id, profile_name, profile_kind, is_default, status,
      organization_id, owner_user_id, managed_role
    ) VALUES (?, 'Member', 'human', 1, 'active', NULL, ?, NULL),
      (?, 'Center Agent', 'agent', 0, 'active', ?, NULL, 'center_agent')`,
    params: [
      speaker.profileId,
      speaker.ownerUserId,
      request.agentProfileId,
      request.organizationId,
    ],
  });
  harness.run({
    sql: `INSERT INTO center_agent_designations
      (organization_id, agent_profile_id, duty, designated_by, created_at)
      VALUES (?, ?, NULL, ?, ?)`,
    params: [
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
    OPENMELD_DB: harness.db,
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
