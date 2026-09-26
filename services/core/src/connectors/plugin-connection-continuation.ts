import { OPENMELD_SPACE_ADDRESSING_VERSION } from "@openmeld/gateway-contract";
import {
  pluginConnectionContinuationBindingSchema,
  pluginConnectionContinuationResponseSchema,
  pluginConnectionContinuationRpcInputSchema,
  readPluginConnectionReplyLink,
} from "@openmeld/schemas";
import type {
  SignalEnvelope,
  SpaceThreadContext,
} from "@openmeld/schemas/types";
import { digestCanonicalJson } from "@openmeld/utils";
import { readPrimaryAgentProfileBindingRecord } from "../agent-profile-binding/infrastructure/d1/agent-profile-binding-repo";
import { listConnectorOperationReceiptsForContinuation } from "../center-agent/connector-action-operation-repository";
import { type CoreBindings, identityDb, wakeEvidenceDb } from "../lib/bindings";
import {
  readOrganizationRouteSlug,
  resolveActiveOrganizationMembership,
} from "../organizations/organization-context";
import { readRemoteAgentNativeDeliveryByExecution } from "../remote-agent/infrastructure/d1/native-delivery-ledger-repo";
import { createCoreRpcHttpError } from "../rpc/errors";
import {
  rpcGetSpaceMemberDirectory,
  rpcListSignals,
  rpcPostSignalOnceByClientMessageId,
  rpcReadPluginConnectionLocalSource,
} from "../rpc/methods";
import {
  pluginContinuationMessageFingerprint,
  pluginContinuationTextDigest,
} from "../space/application/plugin-connection-continuation-guard";
import { selectActiveConnectorConnection } from "./connector-connection-repository";
import {
  requirePluginPermission,
  requireRemotePluginConnection,
} from "./plugin-access";
import { requirePluginProfile } from "./plugin-local-caller";

/** Provider callbacks never call this. The authenticated human explicitly
 * requests one new continuation Message; existing Wake and operation owners
 * retain scheduling, permission checks, receipts, and idempotency. */
export async function continuePluginConnection(
  env: CoreBindings,
  payload: unknown
) {
  const parsed = pluginConnectionContinuationRpcInputSchema.safeParse(payload);
  if (!parsed.success) {
    throw denied(
      "invalid_payload",
      "Choose a valid connection continuation.",
      400
    );
  }
  const input = parsed.data;
  const { context } = input;
  if (context.actorContext.profileKind !== "human") {
    throw denied(
      "plugin.continue.human_required",
      "Continue from the account that made the original request."
    );
  }
  const member = await resolveActiveOrganizationMembership({ env, context });
  if (!member.ok) {
    throw denied(member.code, member.message, member.status);
  }
  const db = identityDb(env);
  const evidence = wakeEvidenceDb(env);
  if (!(db && evidence)) {
    throw denied(
      "plugin.continue.state_unavailable",
      "The original task cannot be checked right now. Try again.",
      503
    );
  }
  const access = {
    context,
    spaceId: input.spaceId,
    ...(input.password === undefined ? {} : { password: input.password }),
  };
  const { reply, task, sender, consumer } = await readContinuationSource(
    env,
    evidence,
    input,
    member
  );
  await requireConnectionIntent(
    env,
    member.organizationId,
    reply.data.text,
    input
  );
  const directory = await rpcGetSpaceMemberDirectory(env, access);
  const agent = directory.members.find(
    (entry) => entry.profileId === task.profileId
  );
  if (
    !(
      agent?.allowedRelations.wake &&
      directory.members.some((entry) => entry.profileId === sender.profileId)
    )
  ) {
    throw denied(
      "plugin.continue.wake_forbidden",
      "The original Agent or requester can no longer participate in this conversation."
    );
  }
  const selected = await selectActiveConnectorConnection({
    db,
    organizationId: member.organizationId,
    service: input.service,
    requesterUserId: member.userId,
    preference: input.scope === "member" ? "requester" : "shared",
  });
  if (!selected || selected.connection.scope !== input.scope) {
    throw denied(
      "plugin.continue.connection_unavailable",
      "Finish connecting this account first, then continue.",
      409
    );
  }
  await authorizeContinuationConnection({
    db,
    organizationId: member.organizationId,
    requesterUserId: member.userId,
    connection: selected.connection,
    consumer,
  });
  const receipts = await listConnectorOperationReceiptsForContinuation({
    db,
    organizationId: member.organizationId,
    actorProfileId: task.profileId,
    representedUserId: member.userId,
    sourceSpaceId: input.spaceId,
    fromMs: task.createdAtMs,
    throughMs: task.completedAtMs,
  });
  requireSettledContinuationReceipts(receipts);
  // Deliberately independent of chosen scope and browser instance: changing a
  // setup selection, retrying a timed-out POST, or double-clicking cannot create
  // another continuation of the same published reply.
  const clientMessageId = `plugin-continue:${await digestCanonicalJson([member.organizationId, task.deliveryId, reply.id, member.userId])}`;
  const text = [
    `Continue the remaining work from my request (${task.triggerMessageId}).`,
    `I have reviewed ${input.service} access using ${input.scope === "member" ? "my account" : "the organization connection"}. Recheck the permissions required by the task.`,
    "Use the existing conversation and previous results. Do not restart the task or repeat completed operations. Reuse the original operation ID for an exact retry; stop if its outcome is unknown.",
    ...(receipts.length
      ? [
          "Operation receipts for this Agent and requester in this Space during the request:",
          ...receipts.map((receipt) => JSON.stringify(receipt)),
        ]
      : []),
  ].join("\n");
  const sourceGuard = await readOriginalRequestGuard(env, {
    ...access,
    signalId: task.triggerMessageId,
  });
  const pluginContinuation = pluginConnectionContinuationBindingSchema.parse({
    v: 1,
    organizationId: member.organizationId,
    spaceId: input.spaceId,
    sourceDispatchId: task.dispatchId,
    source: sourceGuard,
    reply: {
      signalId: reply.id,
      revision: reply.data.meta?.messageRevision ?? 0,
      fingerprint: pluginContinuationMessageFingerprint(reply),
    },
    requesterUserId: member.userId,
    requesterProfileId: sender.profileId,
    targetProfileId: task.profileId,
    service: input.service,
    scope: input.scope,
    connectionName: selected.connection.connectionName,
    connectionUpdatedAtMs: selected.connection.updatedAtMs,
    continuationTextDigest: pluginContinuationTextDigest(text),
    threadContext: task.threadContext ?? null,
  });
  const signal = await rpcPostSignalOnceByClientMessageId(env, {
    ...access,
    pluginContinuation,
    clientMessageId,
    authoringPolicy: "user_authored",
    spaceAddressingVersion: OPENMELD_SPACE_ADDRESSING_VERSION,
    profile: {
      kind: "human",
      // readContinuationSource has matched this authenticated profile to the
      // original, verified sender; never accept a new requester from the card.
      profileId: context.actorContext.openMeldProfileId,
      profileName: sender.displayName,
      owner: member.userId,
    },
    text,
    messageEnvelope: {
      text,
      activationTargets: [task.profileId],
      referenceTargets: [],
      replyToSignalId: task.triggerMessageId,
    },
    meta: { clientMessageId },
    ...(task.threadContext ? { threadContext: task.threadContext } : {}),
  });
  return pluginConnectionContinuationResponseSchema.parse({
    status: "requested",
    sourceSignalId: reply.id,
    signalId: signal.id,
    spaceId: input.spaceId,
    targetProfileId: task.profileId,
    threadId: task.threadContext?.threadId ?? null,
  });
}

function requireSettledContinuationReceipts(
  receipts: Awaited<
    ReturnType<typeof listConnectorOperationReceiptsForContinuation>
  >
) {
  if (
    receipts.length > 100 ||
    receipts.some(
      (receipt) =>
        receipt.status === "pending" || receipt.status === "outcome_unknown"
    )
  ) {
    throw denied(
      "plugin.continue.outcome_unknown",
      "A previous operation needs reconciliation before this task can continue. Do not repeat the original write.",
      409
    );
  }
}

async function readOriginalRequestGuard(
  env: CoreBindings,
  input: Parameters<typeof rpcListSignals>[1] & { signalId: string }
) {
  const signals = await rpcListSignals(env, {
    ...input,
    aroundSignalId: input.signalId,
    beforeCount: 0,
    afterCount: 0,
    limit: 1,
  });
  const original =
    signals.signals.find((signal) => signal.id === input.signalId) ?? null;
  return {
    signalId: input.signalId,
    revision:
      original?.type === "signal.text"
        ? (original.data.meta?.messageRevision ?? 0)
        : 0,
    fingerprint: pluginContinuationMessageFingerprint(original),
  };
}

async function requireConnectionIntent(
  env: CoreBindings,
  organizationId: string,
  text: string,
  input: ReturnType<typeof pluginConnectionContinuationRpcInputSchema.parse>
) {
  const organizationSlug = await readOrganizationRouteSlug({
    env,
    organizationId,
  });
  const webAppUrl = env.WEB_APP_URL;
  const guidance =
    organizationSlug && webAppUrl
      ? readPluginConnectionReplyLink({
          organizationSlug,
          text,
          webOrigin: new URL(webAppUrl).origin,
        })
      : null;
  const target = guidance?.action.target;
  if (
    !(
      target?.kind === "plugin_connection" &&
      target.service === input.service &&
      (target.scope === "choose" || target.scope === input.scope)
    )
  ) {
    throw denied(
      "plugin.continue.connection_mismatch",
      "Keep the connection requested by this task. Personal and organization identities are not interchangeable.",
      409
    );
  }
}

async function readContinuationSource(
  env: CoreBindings,
  evidence: D1Database,
  input: ReturnType<typeof pluginConnectionContinuationRpcInputSchema.parse>,
  member: { organizationId: string; userId: string }
) {
  const signals = await rpcListSignals(env, {
    context: input.context,
    spaceId: input.spaceId,
    password: input.password,
    aroundSignalId: input.sourceSignalId,
    beforeCount: 0,
    afterCount: 0,
    limit: 1,
  });
  const reply = signals.signals.find(
    (signal) => signal.id === input.sourceSignalId
  );
  if (
    !(
      reply?.type === "signal.text" &&
      reply.profile.kind === "agent" &&
      reply.data.meta?.dispatchId &&
      !reply.data.meta.recalledAt &&
      !reply.data.meta.editedAt
    )
  ) {
    throw denied(
      "plugin.continue.reply_unavailable",
      "This connection reply is no longer available.",
      409
    );
  }
  const delivery = await readRemoteAgentNativeDeliveryByExecution({
    db: evidence,
    dispatchId: reply.data.meta.dispatchId,
    profileId: reply.profile.profileId,
    spaceId: input.spaceId,
  });
  if (!delivery) {
    return await readLocalContinuationSource(env, input, member, reply);
  }
  const request = delivery.workerSubmitRequest;
  if (
    !(
      delivery &&
      request &&
      delivery.organizationId === member.organizationId &&
      delivery.status === "completed" &&
      delivery.failureCode === null &&
      delivery.publishedSignalId === reply.id &&
      delivery.conversationKind === "space" &&
      !delivery.routineRunId &&
      delivery.completedAtMs !== null &&
      request.organizationId === member.organizationId &&
      request.spaceId === input.spaceId &&
      request.agentProfileId === delivery.profileId &&
      request.bindingId === delivery.bindingId &&
      request.dispatchId === delivery.dispatchId
    )
  ) {
    throw denied(
      "plugin.continue.task_unavailable",
      "This reply cannot continue an active, stopped, failed, or unrelated task.",
      409
    );
  }
  const sender = request.turnEnvelope.sender;
  if (
    !(
      sender.kind === "member" &&
      sender.verified &&
      sender.ownerUserId === member.userId &&
      sender.profileId === input.context.actorContext.openMeldProfileId &&
      request.author.profileKind === "human" &&
      request.author.profileId === sender.profileId
    )
  ) {
    throw denied(
      "plugin.continue.original_requester_required",
      "The account that made this request must continue it. Connecting an organization account does not let you act as someone else."
    );
  }
  return {
    reply,
    task: {
      deliveryId: delivery.deliveryId,
      profileId: delivery.profileId,
      triggerMessageId: delivery.triggerMessageId,
      dispatchId: delivery.dispatchId,
      createdAtMs: delivery.createdAtMs,
      completedAtMs: delivery.completedAtMs,
      threadContext: delivery.threadContext,
    },
    sender: { profileId: sender.profileId, displayName: sender.displayName },
    consumer: {
      kind: "hosted" as const,
      ...(request.v === 4 &&
      request.conversationIdentity?.kind === "personal_agent"
        ? { remoteOwnerUserId: request.agentProfileOwnerUserId ?? null }
        : {}),
    },
  };
}

async function readLocalContinuationSource(
  env: CoreBindings,
  input: ReturnType<typeof pluginConnectionContinuationRpcInputSchema.parse>,
  member: { organizationId: string; userId: string },
  reply: Extract<SignalEnvelope, { type: "signal.text" }>
) {
  const source = await rpcReadPluginConnectionLocalSource(env, input);
  const agent = await requirePluginProfile(env, source.targetProfileId);
  if (
    agent.profileKind !== "agent" ||
    agent.organizationId !== member.organizationId ||
    !agent.ownerUserId
  ) {
    throw denied(
      "plugin.continue.task_unavailable",
      "The original Local Agent is no longer available.",
      409
    );
  }
  const db = identityDb(env);
  const binding =
    db &&
    (await readPrimaryAgentProfileBindingRecord({
      db,
      agentProfileId: source.targetProfileId,
      owner: { kind: "owner_account", id: agent.ownerUserId },
    }));
  if (
    binding?.bindingState !== "enabled_primary" ||
    binding.runtimeKind !== "openmeld_service" ||
    binding.bindingId !== source.bindingId
  ) {
    throw denied(
      "plugin.continue.binding_changed",
      "The original Agent's execution connection changed. Send a new request rather than resuming stale work.",
      409
    );
  }
  return {
    reply,
    task: {
      deliveryId: source.executionId,
      profileId: source.targetProfileId,
      triggerMessageId: source.sourceSignalId,
      dispatchId: source.dispatchId,
      createdAtMs: source.createdAtMs,
      completedAtMs: source.completedAtMs,
      threadContext: source.threadContext as SpaceThreadContext | null,
    },
    sender: {
      profileId: source.requesterProfileId,
      displayName: source.requesterDisplayName,
    },
    consumer: { kind: "local" as const, ownerUserId: agent.ownerUserId },
  };
}

type ContinuationConsumer =
  | { kind: "local"; ownerUserId: string }
  | { kind: "hosted"; remoteOwnerUserId?: string | null };
async function authorizeContinuationConnection(input: {
  db: D1Database;
  organizationId: string;
  requesterUserId: string;
  connection: import("./connector-connection-repository").ConnectorConnectionRecord;
  consumer: ContinuationConsumer;
}) {
  const { consumer, connection } = input;
  if (consumer.kind === "local") {
    if (
      connection.scope === "member" &&
      consumer.ownerUserId !== input.requesterUserId
    ) {
      throw denied(
        "plugin.personal_request_required",
        "A Local Agent cannot use another member's personal connection."
      );
    }
    await requirePluginPermission({
      ...input,
      connectionName: connection.connectionName,
      consumer: "local_agent",
      effect: "read",
    });
    return;
  }
  await requireRemotePluginConnection({
    ...input,
    ...consumer,
    service: connection.service,
    connectionName: connection.connectionName,
    effect: "read",
  });
}

function denied(code: string, reason: string, status = 403) {
  return createCoreRpcHttpError({ code, reason, status });
}
