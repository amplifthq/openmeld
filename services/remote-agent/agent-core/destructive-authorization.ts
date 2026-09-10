import type {
  CenterAgentRoutineAuthorizedAction,
  OpenMeldRequestContext,
  RemoteAgentTurnEnvelope,
} from "@openmeld/schemas/types";
import type { RemoteAgentStorage } from "./callback-context";
import { digestCanonicalJson } from "./canonical-json";

const DESTRUCTIVE_CONFIRMATION_KEY_PREFIX =
  "remote-agent:destructive-confirmation:";
const DESTRUCTIVE_CONFIRMATION_TTL_MS = 24 * 60 * 60 * 1000;

export const ROUTINE_DESTRUCTIVE_ACTION_UNSUPPORTED_REASON_CODE =
  "routine_destructive_action_unsupported" as const;
export const ROUTINE_EXTERNAL_WRITE_UNSUPPORTED_REASON_CODE =
  "routine_external_write_unsupported" as const;

type DestructiveConfirmationRecord = {
  actionId: string;
  actionInputDigest: string;
  executionIdentity: string | null;
  expiresAtMs: number;
  issuedBySubmissionId: string;
  organizationId: string;
  representedUserId: string;
  v: 1;
};

type RemoteAgentAuthorizationToolContext = {
  context: OpenMeldRequestContext;
  executionMode?: "interactive" | "routine";
  turnEnvelope?: RemoteAgentTurnEnvelope;
};

export type RemoteAgentRoutineDestructiveActionUnsupportedResult = {
  reasonCode: typeof ROUTINE_DESTRUCTIVE_ACTION_UNSUPPORTED_REASON_CODE;
  sideEffects: 0;
  status: typeof ROUTINE_DESTRUCTIVE_ACTION_UNSUPPORTED_REASON_CODE;
  unsupported: { requiredMessage: string };
};

export type RemoteAgentRoutineExternalWriteUnsupportedResult = {
  reasonCode: typeof ROUTINE_EXTERNAL_WRITE_UNSUPPORTED_REASON_CODE;
  sideEffects: 0;
  status: typeof ROUTINE_EXTERNAL_WRITE_UNSUPPORTED_REASON_CODE;
  unsupported: { requiredMessage: string };
};

type DestructiveActionPreviewResult = {
  confirmation: Record<string, string> & { requiredMessage: string };
  sideEffects: 0;
  status: "destructive_action_preview";
};

export async function resolveRemoteAgentDestructiveAuthorization(input: {
  actionDescription: string;
  actionId: string;
  actionInput: Record<string, unknown>;
  executionIdentity?: {
    connectionName: string;
    ownerUserId: string;
  };
  storage: RemoteAgentStorage;
  submissionId: string;
  token: unknown;
  tokenFieldName: string;
  toolContext: RemoteAgentAuthorizationToolContext;
}): Promise<
  | { authorized: true }
  | {
      authorized: false;
      result:
        | DestructiveActionPreviewResult
        | RemoteAgentRoutineDestructiveActionUnsupportedResult;
    }
> {
  const routineBlock = resolveRemoteAgentRoutineDestructiveActionBlock(
    input.toolContext
  );
  if (routineBlock) {
    return {
      authorized: false,
      result: routineBlock,
    };
  }

  const confirmation = await buildDestructiveConfirmationRecord({
    actionId: input.actionId,
    actionInput: input.actionInput,
    executionIdentity: input.executionIdentity,
    submissionId: input.submissionId,
    toolContext: input.toolContext,
  });
  if (
    typeof input.token === "string" &&
    (await consumeDestructiveConfirmation({
      expected: confirmation,
      storage: input.storage,
      token: input.token,
    }))
  ) {
    return { authorized: true };
  }

  const token = crypto.randomUUID();
  await input.storage.putExpiring(
    `${DESTRUCTIVE_CONFIRMATION_KEY_PREFIX}${token}`,
    confirmation,
    confirmation.expiresAtMs
  );
  return {
    authorized: false,
    result: {
      confirmation: {
        requiredMessage: `This action will ${input.actionDescription}. If the verified user already authorized this exact action and target, use the token with unchanged input now. Otherwise ask for that authorization before using it. The token binds the action; it does not grant user permission.`,
        [input.tokenFieldName]: token,
      },
      sideEffects: 0,
      status: "destructive_action_preview",
    },
  };
}

export function resolveRemoteAgentRoutineDestructiveActionBlock(
  toolContext: RemoteAgentAuthorizationToolContext
): RemoteAgentRoutineDestructiveActionUnsupportedResult | null {
  if (
    toolContext.executionMode !== "routine" &&
    toolContext.turnEnvelope?.trigger.source !== "routine"
  ) {
    return null;
  }
  return {
    reasonCode: ROUTINE_DESTRUCTIVE_ACTION_UNSUPPORTED_REASON_CODE,
    sideEffects: 0,
    status: ROUTINE_DESTRUCTIVE_ACTION_UNSUPPORTED_REASON_CODE,
    unsupported: {
      requiredMessage:
        "This Routine skipped the action because Routines do not currently support destructive actions such as delete or merge.",
    },
  };
}

export function resolveRemoteAgentRoutineExternalWriteBlock(
  toolContext: RemoteAgentAuthorizationToolContext,
  authorizedAction?: CenterAgentRoutineAuthorizedAction
): RemoteAgentRoutineExternalWriteUnsupportedResult | null {
  if (
    toolContext.turnEnvelope?.trigger.source !== "routine" ||
    toolContext.turnEnvelope.trigger.externalActionPolicy !== "read_only"
  ) {
    return null;
  }
  if (
    authorizedAction &&
    toolContext.turnEnvelope.trigger.authorizedActions.includes(
      authorizedAction
    )
  ) {
    return null;
  }
  return {
    reasonCode: ROUTINE_EXTERNAL_WRITE_UNSUPPORTED_REASON_CODE,
    sideEffects: 0,
    status: ROUTINE_EXTERNAL_WRITE_UNSUPPORTED_REASON_CODE,
    unsupported: {
      requiredMessage:
        "This Routine skipped the external write because it is configured to use connected Plugins and Channels as read-only sources.",
    },
  };
}

export function isRemoteAgentDestructiveConfirmationResult(
  result: unknown
): boolean {
  return Boolean(
    result &&
      typeof result === "object" &&
      !Array.isArray(result) &&
      (result as Record<string, unknown>).status ===
        "destructive_confirmation_required"
  );
}

async function buildDestructiveConfirmationRecord(input: {
  actionId: string;
  actionInput: Record<string, unknown>;
  executionIdentity?: {
    connectionName: string;
    ownerUserId: string;
  };
  submissionId: string;
  toolContext: RemoteAgentAuthorizationToolContext;
}): Promise<DestructiveConfirmationRecord> {
  const representedUserId = resolveRepresentedUserId(
    input.toolContext.turnEnvelope
  );
  if (!representedUserId) {
    throw new Error(
      "Destructive tool authorization requires a verified represented user."
    );
  }
  const organizationId = input.toolContext.context.activeOrganizationId;
  if (!organizationId) {
    throw new Error(
      "Destructive tool authorization requires an active Organization."
    );
  }
  return {
    actionId: input.actionId,
    actionInputDigest: await digestCanonicalJson(input.actionInput),
    executionIdentity: input.executionIdentity
      ? `${input.executionIdentity.connectionName}:${input.executionIdentity.ownerUserId}`
      : null,
    expiresAtMs: Date.now() + DESTRUCTIVE_CONFIRMATION_TTL_MS,
    issuedBySubmissionId: input.submissionId,
    organizationId,
    representedUserId,
    v: 1,
  };
}

async function consumeDestructiveConfirmation(input: {
  expected: DestructiveConfirmationRecord;
  storage: RemoteAgentStorage;
  token: string;
}): Promise<boolean> {
  const key = `${DESTRUCTIVE_CONFIRMATION_KEY_PREFIX}${input.token}`;
  const preview = await input.storage.get<DestructiveConfirmationRecord>(key);
  if (!destructiveConfirmationRecordsMatch(preview, input.expected)) {
    return false;
  }
  const stored =
    await input.storage.takeUnexpired<DestructiveConfirmationRecord>(
      key,
      Date.now()
    );
  return destructiveConfirmationRecordsMatch(stored, input.expected);
}

function destructiveConfirmationRecordsMatch(
  actual: DestructiveConfirmationRecord | undefined,
  expected: DestructiveConfirmationRecord
): actual is DestructiveConfirmationRecord {
  return Boolean(
    actual &&
      actual.v === expected.v &&
      actual.expiresAtMs > Date.now() &&
      actual.actionId === expected.actionId &&
      actual.actionInputDigest === expected.actionInputDigest &&
      actual.executionIdentity === expected.executionIdentity &&
      actual.organizationId === expected.organizationId &&
      actual.representedUserId === expected.representedUserId
  );
}

function resolveRepresentedUserId(
  envelope: RemoteAgentTurnEnvelope | undefined
): string | null {
  if (envelope?.sender.kind === "routine") {
    return envelope.sender.delegatedBy.ownerUserId;
  }
  if (envelope?.sender.kind === "member" && envelope.sender.verified) {
    return envelope.sender.ownerUserId ?? null;
  }
  return null;
}
