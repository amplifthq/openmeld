import { getPostgresDatabase } from "@openmeld/db/postgresql";
import type {
  ExecutionContextRequest,
  OpenMeldDaemonAcceptedDispatchSnapshot,
  OpenMeldDaemonDispatchQueueMessage,
  RequestChain,
} from "@openmeld/schemas/types";
import { readRecordedDelegationRequester } from "../../center-agent/application/recorded-delegation-requester";
import type { CoreBindings } from "../../lib/bindings";
import { isRequestChainEnforced } from "../../member-agent/member-agents-feature";
import { readActiveRepresentedHumanSender } from "../../remote-agent/application/turn-envelope";
import {
  createAdmittedRequestChainDeps,
  resolveAdmittedRequestChain,
} from "../../request-chain/dispatch-request-chain";
import { readRequestChainRootProfileId } from "../../request-chain/request-chain";

export async function buildAcceptedDispatchSnapshot(input: {
  /** The message's selection after Core policy, such as folder stripping. */
  contextSelection?: OpenMeldDaemonDispatchQueueMessage["contextSelection"];
  message: OpenMeldDaemonDispatchQueueMessage;
  openMeldServiceRuntimeId?: string | null;
  /** This Wake's chain from resolveAdmittedRequestChain; absent: legacy. */
  requestChain?: RequestChain;
  /** From resolveContextWorkspaceDefault: set when the root is not the owner. */
  workspaceDefault?: ExecutionContextRequest["workspaceDefault"];
  runtimeKind?:
    | "hosted_center_agent"
    | "hosted_remote_agent"
    | "openmeld_service"
    | null;
}): Promise<OpenMeldDaemonAcceptedDispatchSnapshot | null> {
  const controllerSnapshot = input.message.controllerSnapshot;
  if (
    !(
      controllerSnapshot.bindingId &&
      controllerSnapshot.configurationRevision &&
      input.openMeldServiceRuntimeId
    ) ||
    input.runtimeKind !== "openmeld_service" ||
    controllerSnapshot.targetBindingState !== "bound" ||
    controllerSnapshot.targetBindingEnabled !== true ||
    !controllerSnapshot.agentControllerRef
  ) {
    return null;
  }
  return {
    ...(input.message.sourceSignalSnapshot?.workHandoff?.schemaVersion === 2
      ? {
          workHandoffVersion:
            input.message.sourceSignalSnapshot.workHandoff.schemaVersion,
        }
      : {}),
    ...(input.message.organizationId &&
    input.message.sourceSignalSnapshot?.profileId
      ? {
          contextRequest: {
            // Explicit intent must never fall back to a Binding conversation.
            // Core chooses implicit thread isolation only for supported harnesses.
            required: Boolean(input.message.contextSelection),
            ...(input.requestChain ? { requestChain: input.requestChain } : {}),
            scope: {
              organizationId: input.message.organizationId,
              requesterProfileId: input.message.sourceSignalSnapshot.profileId,
              spaceId: input.message.spaceId,
              targetProfileId: input.message.targetProfileId,
              threadId: input.message.threadContext?.threadId ?? null,
            },
            selection: input.contextSelection ??
              input.message.contextSelection ?? {
                mode: "auto" as const,
              },
            ...(input.workspaceDefault
              ? { workspaceDefault: input.workspaceDefault }
              : {}),
          },
        }
      : {}),
    ...(input.message.deviceWait
      ? { deviceWait: input.message.deviceWait }
      : {}),
    controllerSnapshot: {
      bindingId: controllerSnapshot.bindingId,
      configurationRevision: controllerSnapshot.configurationRevision,
      targetBindingState: controllerSnapshot.targetBindingState,
      targetBindingEnabled: controllerSnapshot.targetBindingEnabled,
      agentControllerRef: controllerSnapshot.agentControllerRef,
    },
    openMeldServiceRuntimeId: input.openMeldServiceRuntimeId,
    payloadFingerprint: await fingerprintAcceptedDispatchPayload(input.message),
    runtimeKind: input.runtimeKind,
  };
}

/**
 * Tasks whose root requester is not the Profile owner default to an isolated
 * copy when the folder is a git repository (design-plans/member-agent-program.md
 * §4.9). Core only marks the request; the Service checks for git. An explicit
 * workspace choice or a resumed Session keeps its own workspace. Missing
 * ownership evidence counts as not the owner.
 */
export async function resolveContextWorkspaceDefault(input: {
  contextSelection?: OpenMeldDaemonDispatchQueueMessage["contextSelection"];
  env?: CoreBindings;
  isRequestedByOwner?: typeof isDispatchRequestedByAgentOwner;
  message: OpenMeldDaemonDispatchQueueMessage;
  requestChain?: RequestChain;
  runtimeKind?: Parameters<
    typeof buildAcceptedDispatchSnapshot
  >[0]["runtimeKind"];
  targetOwnerUserId: string;
}): Promise<ExecutionContextRequest["workspaceDefault"]> {
  const selection = input.contextSelection ?? input.message.contextSelection;
  if (
    input.runtimeKind !== "openmeld_service" ||
    selection?.mode === "resume" ||
    selection?.workspace
  ) {
    return undefined;
  }
  let requestedByOwner = false;
  try {
    requestedByOwner = await (
      input.isRequestedByOwner ?? isDispatchRequestedByAgentOwner
    )({
      env: input.env,
      message: input.message,
      requestChain: input.requestChain,
      targetOwnerUserId: input.targetOwnerUserId,
    });
  } catch (error) {
    console.warn("[core.dispatch.workspace_default_owner_unverified]", {
      dispatchId: input.message.dispatchId,
      error: error instanceof Error ? error.message : String(error),
    });
  }
  return requestedByOwner ? undefined : "isolated_if_git";
}

export async function isDispatchRequestedByAgentOwner(input: {
  env?: CoreBindings;
  targetOwnerUserId?: string;
  message: OpenMeldDaemonDispatchQueueMessage;
  /** This Wake's admitted chain, when the caller already resolved it. */
  requestChain?: RequestChain;
}): Promise<boolean> {
  const { env, message, targetOwnerUserId } = input;
  const source = message.sourceSignalSnapshot;
  if (
    !(env && targetOwnerUserId && message.organizationId && source?.profileId)
  ) {
    return false;
  }
  const db = getPostgresDatabase(env);
  if (!db) {
    return false;
  }
  if (isRequestChainEnforced()) {
    // The root requester, not the message author, decides.
    const chain = input.requestChain
      ? { ok: true as const, chain: input.requestChain }
      : await resolveAdmittedRequestChain({
          deps: createAdmittedRequestChainDeps(env),
          message,
        });
    return (
      chain.ok &&
      Boolean(
        await readActiveRepresentedHumanSender({
          db,
          organizationId: message.organizationId,
          profileId: readRequestChainRootProfileId(chain.chain),
          userId: targetOwnerUserId,
        })
      )
    );
  }
  if (source.profileKind === "human") {
    return Boolean(
      await readActiveRepresentedHumanSender({
        db,
        organizationId: message.organizationId,
        profileId: source.profileId,
        userId: targetOwnerUserId,
      })
    );
  }
  const evidenceDb = getPostgresDatabase(env);
  if (
    !(
      source.profileKind === "agent" &&
      evidenceDb &&
      message.sourceClientMessageId
    )
  ) {
    return false;
  }
  return Boolean(
    await readRecordedDelegationRequester({
      identityDb: db,
      evidenceDb,
      organizationId: message.organizationId,
      spaceId: message.spaceId,
      sourceClientMessageId: message.sourceClientMessageId,
      sourceProfileId: source.profileId,
      targetProfileId: message.targetProfileId,
      targetOwnerUserId,
    })
  );
}

export function applyAcceptedDispatchSnapshotToMessage(input: {
  message: OpenMeldDaemonDispatchQueueMessage;
  snapshot: OpenMeldDaemonAcceptedDispatchSnapshot;
  executionContext?: OpenMeldDaemonDispatchQueueMessage["executionContext"];
}): OpenMeldDaemonDispatchQueueMessage {
  if (
    !input.executionContext &&
    input.message.controllerSnapshot === input.snapshot.controllerSnapshot &&
    input.message.dispatchSnapshot.targetBindingState ===
      input.snapshot.controllerSnapshot.targetBindingState &&
    input.message.dispatchSnapshot.targetBindingEnabled ===
      input.snapshot.controllerSnapshot.targetBindingEnabled
  ) {
    return input.message;
  }
  return {
    ...input.message,
    ...(input.executionContext
      ? { executionContext: input.executionContext }
      : {}),
    controllerSnapshot: input.snapshot.controllerSnapshot,
    dispatchSnapshot: {
      ...input.message.dispatchSnapshot,
      targetBindingEnabled:
        input.snapshot.controllerSnapshot.targetBindingEnabled,
      targetBindingState: input.snapshot.controllerSnapshot.targetBindingState,
    },
  };
}
async function fingerprintAcceptedDispatchPayload(
  message: OpenMeldDaemonDispatchQueueMessage
): Promise<`sha256:${string}`> {
  const {
    controllerSnapshot: _controllerSnapshot,
    deliveryRecoveryReason: _deliveryRecoveryReason,
    enqueuedAtMs: _enqueuedAtMs,
    outboxCreatedAtMs: _outboxCreatedAtMs,
    sourceProfileNameSnapshot: _sourceProfileNameSnapshot,
    spaceNameSnapshot: _spaceNameSnapshot,
    targetProfileNameSnapshot: _targetProfileNameSnapshot,
    dispatchSnapshot,
    ...immutableMessage
  } = message;
  const {
    targetBindingEnabled: _targetBindingEnabled,
    targetBindingState: _targetBindingState,
    ...immutableDispatchSnapshot
  } = dispatchSnapshot;
  const encoded = new TextEncoder().encode(
    stableJson({
      ...immutableMessage,
      dispatchSnapshot: immutableDispatchSnapshot,
    })
  );
  const digest = await crypto.subtle.digest("SHA-256", encoded);
  return `sha256:${[...new Uint8Array(digest)]
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("")}`;
}
function stableJson(value: unknown): string {
  if (value === null || typeof value !== "object") {
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) {
    return `[${value.map(stableJson).join(",")}]`;
  }
  const record = value as Record<string, unknown>;
  return `{${Object.keys(record)
    .filter((key) => record[key] !== undefined)
    .sort()
    .map((key) => `${JSON.stringify(key)}:${stableJson(record[key])}`)
    .join(",")}}`;
}

/**
 * The requester whose ownership decides whether a folder choice is kept: the
 * request chain's root requester once the chain is enforced. Before that, and
 * for a Wake without a chain, the one-hop requester (the message author).
 */
export function resolveFolderSelectionRequesterProfileId(
  message: OpenMeldDaemonDispatchQueueMessage,
  requestChain?: RequestChain
): string | null {
  if (isRequestChainEnforced()) {
    return requestChain ? readRequestChainRootProfileId(requestChain) : null;
  }
  return message.sourceSignalSnapshot?.profileId ?? null;
}

/**
 * Only the Profile owner chooses a folder; everyone else uses the default.
 * A folder id from anyone else is removed, never rejected, so the work still
 * runs in the default folder. Missing ownership evidence removes it too.
 */
export async function applyFolderSelectionPolicy(input: {
  env?: CoreBindings;
  message: OpenMeldDaemonDispatchQueueMessage;
  readRequesterOwnerUserId?: typeof readActiveProfileOwnerUserId;
  requestChain?: RequestChain;
  targetOwnerUserId: string;
}): Promise<OpenMeldDaemonDispatchQueueMessage["contextSelection"]> {
  const selection = input.message.contextSelection;
  if (!selection || selection.mode === "resume" || !selection.folderId) {
    return selection;
  }
  const requesterProfileId = resolveFolderSelectionRequesterProfileId(
    input.message,
    input.requestChain
  );
  const organizationId = input.message.organizationId;
  let ownerUserId: string | null = null;
  if (requesterProfileId && organizationId) {
    try {
      ownerUserId = await (
        input.readRequesterOwnerUserId ?? readActiveProfileOwnerUserId
      )({
        env: input.env,
        organizationId,
        profileId: requesterProfileId,
      });
    } catch (error) {
      console.warn("[core.dispatch.folder_selection_owner_unverified]", {
        dispatchId: input.message.dispatchId,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }
  if (ownerUserId === input.targetOwnerUserId) {
    return selection;
  }
  const { folderId: _notOwner, ...withoutFolder } = selection;
  return withoutFolder;
}

async function readActiveProfileOwnerUserId(input: {
  env?: CoreBindings;
  organizationId: string;
  profileId: string;
}): Promise<string | null> {
  const db = input.env ? getPostgresDatabase(input.env) : null;
  if (!db) {
    return null;
  }
  // Human Profiles belong to an account, not an Organization (their
  // organization_id is NULL): their Organization is the owner's membership.
  // Agent Profiles carry their Organization directly.
  const result = await db.query<{ owner_user_id: string | null }>({
    text: `
      SELECT p.owner_user_id
      FROM "openmeld"."openmeld_profiles" p
      WHERE p.profile_id = $1
        AND p.status = 'active'
        AND (
          (p.profile_kind = 'human' AND EXISTS (
            SELECT 1 FROM "openmeld"."members" m
            WHERE m.user_id = p.owner_user_id AND m.organization_id = $2
          ))
          OR (p.profile_kind <> 'human' AND p.organization_id = $2)
        )
      LIMIT 1
    `,
    values: [input.profileId, input.organizationId],
  });
  return result.rows[0]?.owner_user_id ?? null;
}
