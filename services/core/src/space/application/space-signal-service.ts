import type { Profile, SignalEnvelope } from "@openmeld/protocol";
import { parseSignalText } from "@openmeld/protocol";
import {
  type SPACE_ADDRESSING_TARGET_INVALID_ERROR_CODE,
  type SPACE_AGENT_REPLY_CONTEXT_CHANGED_ERROR_CODE,
  systemEmittedSignalTextSchema,
  validateSpaceSignalClientMessageIdPolicy,
} from "@openmeld/schemas";
import type {
  OpenMeldDaemonDispatchQueueMessage,
  SignalTextData,
  SpaceSignalAuthoringPolicy,
} from "@openmeld/schemas/types";
import type { SignalPublishContext } from "./types";

export const SPACE_WAKE_TARGET_INVALID_ERROR_CODE =
  "space.wake.target_invalid" as const;
export const SPACE_WAKE_HANDOFF_SEED_FAILED_ERROR_CODE =
  "space.wake.handoff_seed_failed" as const;
export const SPACE_NAVIGATION_ACTION_OWNER_REQUIRED_ERROR_CODE =
  "space.signal.navigation_action_owner_required" as const;
export const SPACE_NAVIGATION_ACTION_OWNER_REQUIRED_MESSAGE =
  "Navigation Actions can only be published by OpenMeld's Remote Agent delivery path." as const;
export const SPACE_FINAL_OUTCOME_STOPPED_ERROR_CODE =
  "space.final_outcome_stopped" as const;
export class SpaceSignalAuthoringError extends Error {
  readonly code:
    | typeof SPACE_ADDRESSING_TARGET_INVALID_ERROR_CODE
    | typeof SPACE_WAKE_TARGET_INVALID_ERROR_CODE
    | typeof SPACE_WAKE_HANDOFF_SEED_FAILED_ERROR_CODE
    | typeof SPACE_NAVIGATION_ACTION_OWNER_REQUIRED_ERROR_CODE
    | typeof SPACE_FINAL_OUTCOME_STOPPED_ERROR_CODE
    | typeof SPACE_AGENT_REPLY_CONTEXT_CHANGED_ERROR_CODE;
  readonly status: number;
  readonly targetProfileId: string | null;

  constructor(input: {
    code:
      | typeof SPACE_ADDRESSING_TARGET_INVALID_ERROR_CODE
      | typeof SPACE_WAKE_TARGET_INVALID_ERROR_CODE
      | typeof SPACE_WAKE_HANDOFF_SEED_FAILED_ERROR_CODE
      | typeof SPACE_NAVIGATION_ACTION_OWNER_REQUIRED_ERROR_CODE
      | typeof SPACE_FINAL_OUTCOME_STOPPED_ERROR_CODE
      | typeof SPACE_AGENT_REPLY_CONTEXT_CHANGED_ERROR_CODE;
    message: string;
    status?: number;
    targetProfileId?: string | null;
  }) {
    super(input.message);
    this.name = "SpaceSignalAuthoringError";
    this.code = input.code;
    this.status = input.status ?? 422;
    this.targetProfileId =
      typeof input.targetProfileId === "string" &&
      input.targetProfileId.trim().length > 0
        ? input.targetProfileId.trim()
        : null;
  }
}

export type SignalTextBuildOptions = {
  attachments?: SignalTextData["attachments"];
  files?: SignalTextData["files"];
  messageEnvelope?: SignalTextData["messageEnvelope"];
  meta?: SignalTextData["meta"];
  replyTo?: SignalTextData["replyTo"];
};

type SpaceSignalNavigationActionPolicyResult =
  | { ok: true }
  | {
      code: typeof SPACE_NAVIGATION_ACTION_OWNER_REQUIRED_ERROR_CODE;
      message: typeof SPACE_NAVIGATION_ACTION_OWNER_REQUIRED_MESSAGE;
      ok: false;
    };

export function validateSpaceSignalNavigationActionPolicy(input: {
  authoringPolicy?: SpaceSignalAuthoringPolicy;
  finalOutcomeAuthority?: SignalPublishContext["finalOutcomeAuthority"];
  messageEnvelope?: SignalTextData["messageEnvelope"];
}): SpaceSignalNavigationActionPolicyResult {
  if (!input.messageEnvelope?.navigationAction) {
    return { ok: true };
  }
  if (
    input.authoringPolicy === "system_emitted" &&
    input.finalOutcomeAuthority === "remote_agent_native_delivery"
  ) {
    return { ok: true };
  }
  return {
    code: SPACE_NAVIGATION_ACTION_OWNER_REQUIRED_ERROR_CODE,
    message: SPACE_NAVIGATION_ACTION_OWNER_REQUIRED_MESSAGE,
    ok: false,
  };
}

export function assertSpaceSignalNavigationActionPolicy(input: {
  authoringPolicy?: SpaceSignalAuthoringPolicy;
  finalOutcomeAuthority?: SignalPublishContext["finalOutcomeAuthority"];
  messageEnvelope?: SignalTextData["messageEnvelope"];
}): void {
  const result = validateSpaceSignalNavigationActionPolicy(input);
  if (result.ok) {
    return;
  }
  throw new SpaceSignalAuthoringError({
    code: result.code,
    message: result.message,
    status: 400,
  });
}

export const buildSignalTextOptions = (
  data: SignalTextData
): SignalTextBuildOptions | undefined => {
  const meta = omitReplyStalenessFromAuthoredMeta(data.meta);
  if (
    !(
      data.attachments ||
      data.files ||
      data.messageEnvelope ||
      meta ||
      data.replyTo
    )
  ) {
    return undefined;
  }

  return {
    ...(data.attachments ? { attachments: data.attachments } : {}),
    ...(data.files ? { files: data.files } : {}),
    ...(data.messageEnvelope ? { messageEnvelope: data.messageEnvelope } : {}),
    ...(meta ? { meta } : {}),
    ...(data.replyTo ? { replyTo: data.replyTo } : {}),
  };
};

function omitReplyStalenessFromAuthoredMeta(
  meta: SignalTextData["meta"]
): SignalTextData["meta"] {
  if (!meta) {
    return meta;
  }
  const { staleness, ...authoredMeta } = meta;
  if (!staleness) {
    return meta;
  }
  return Object.keys(authoredMeta).length > 0 ? authoredMeta : undefined;
}

function parseSignalTextForAuthoringPolicy(input: {
  authoringPolicy: SpaceSignalAuthoringPolicy;
  body: Record<string, unknown>;
}) {
  if (input.authoringPolicy !== "system_emitted") {
    return parseSignalText(input.body);
  }
  const parsed = systemEmittedSignalTextSchema.safeParse(input.body);
  return parsed.success
    ? { ok: true as const, value: parsed.data }
    : { ok: false as const };
}

export async function handlePostSignalUseCase(input: {
  body: unknown;
  profile: Profile;
  signalContext?: SignalPublishContext;
  authoringPolicy: SpaceSignalAuthoringPolicy;
  buildTextSignal: (
    profile: Profile,
    text: string,
    options?: SignalTextBuildOptions
  ) => SignalEnvelope;
  publishTextSignal: (
    signal: SignalEnvelope,
    signalContext?: SignalPublishContext
  ) => Promise<void>;
  isDispatchSnapshotOversizeError: (error: unknown) => boolean;
  dispatchSnapshotOversizeErrorCode: string;
  resolveMessageFiles?: (
    files: NonNullable<SignalTextData["files"]>
  ) => NonNullable<SignalTextData["files"]>;
}): Promise<Response> {
  if (!(input.body && typeof input.body === "object")) {
    return new Response("Invalid JSON", { status: 400 });
  }

  const textSignal = parseSignalTextForAuthoringPolicy({
    authoringPolicy: input.authoringPolicy,
    body: input.body as Record<string, unknown>,
  });
  if (!textSignal.ok) {
    return new Response("Expected signal.text", { status: 400 });
  }

  const policyResult = validateSpaceSignalClientMessageIdPolicy({
    authoringPolicy: input.authoringPolicy,
    messageEnvelope: textSignal.value.data.messageEnvelope,
    meta: textSignal.value.data.meta,
  });
  if (!policyResult.ok) {
    return Response.json(
      {
        ok: false,
        code: policyResult.code,
        message: policyResult.message,
      },
      { status: 400 }
    );
  }

  const navigationActionPolicyResult =
    validateSpaceSignalNavigationActionPolicy({
      authoringPolicy: input.authoringPolicy,
      finalOutcomeAuthority: input.signalContext?.finalOutcomeAuthority,
      messageEnvelope: textSignal.value.data.messageEnvelope,
    });
  if (!navigationActionPolicyResult.ok) {
    return Response.json(
      {
        ok: false,
        code: navigationActionPolicyResult.code,
        message: navigationActionPolicyResult.message,
      },
      { status: 400 }
    );
  }

  const canonicalFiles = textSignal.value.data.files
    ? input.resolveMessageFiles?.(textSignal.value.data.files)
    : undefined;
  if (textSignal.value.data.files && !canonicalFiles) {
    throw new Error("Space message file resolution is unavailable.");
  }
  const payload = input.buildTextSignal(
    input.profile,
    textSignal.value.data.text,
    buildSignalTextOptions({
      ...textSignal.value.data,
      ...(canonicalFiles ? { files: canonicalFiles } : {}),
    })
  );
  try {
    await input.publishTextSignal(payload, {
      ...(input.signalContext ?? {}),
      authoringPolicy: input.authoringPolicy,
    });
  } catch (error) {
    if (error instanceof SpaceSignalAuthoringError) {
      return Response.json(
        {
          ok: false,
          code: error.code,
          message: error.message,
          ...(error.targetProfileId
            ? { targetProfileId: error.targetProfileId }
            : {}),
        },
        { status: error.status }
      );
    }
    if (input.isDispatchSnapshotOversizeError(error)) {
      return Response.json(
        {
          ok: false,
          code: input.dispatchSnapshotOversizeErrorCode,
          message: "dispatch snapshot exceeds size budget",
        },
        { status: 422 }
      );
    }
    throw error;
  }

  return Response.json(payload);
}

export async function publishTextSignalUseCase(input: {
  signal: SignalEnvelope;
  signalContext?: SignalPublishContext;
  persistSignalWithOptionalOutbox: (
    signal: SignalEnvelope,
    createOutboxRecord: boolean,
    signalContext?: SignalPublishContext
  ) => Promise<{
    dispatchMessages: OpenMeldDaemonDispatchQueueMessage[];
    duplicateFinalReplyBlocked: boolean;
    persistedSignal: boolean;
  }>;
  flushPendingDispatchOutbox: () => Promise<void>;
  recordHumanActivity?: (signal: SignalEnvelope) => Promise<void>;
  waitUntil: (promise: Promise<unknown>) => void;
  broadcast: (signal: SignalEnvelope) => void;
}): Promise<void> {
  const persistResult = await input.persistSignalWithOptionalOutbox(
    input.signal,
    true,
    input.signalContext
  );
  if (!persistResult.persistedSignal) {
    return;
  }
  console.info("[core.openmeld.space.signal_persisted]", {
    event: "core.openmeld.space.signal_persisted",
    spaceId: input.signal.spaceId,
    signalId: input.signal.id,
    signalType: input.signal.type,
    profileId: input.signal.profile?.profileId ?? null,
    profileKind: input.signal.profile?.kind ?? null,
    clientMessageId:
      input.signal.type === "signal.text"
        ? (input.signal.data.meta?.clientMessageId ?? null)
        : null,
    activationTargetCount:
      input.signal.type === "signal.text"
        ? (input.signal.data.messageEnvelope?.activationTargets?.length ?? 0)
        : 0,
    dispatchMessageCount: persistResult.dispatchMessages.length,
  });
  if (
    input.signal.type === "signal.text" &&
    input.signal.profile?.kind === "human" &&
    input.recordHumanActivity
  ) {
    input.waitUntil(input.recordHumanActivity(input.signal));
  }
  input.waitUntil(input.flushPendingDispatchOutbox());
  input.broadcast(input.signal);
}

export function publishPresenceSignalUseCase(input: {
  signal: SignalEnvelope;
  persistSignal: (
    signal: SignalEnvelope
  ) => { persistedSignal: boolean } | undefined;
  broadcast: (signal: SignalEnvelope) => void;
}): void {
  const persistResult = input.persistSignal(input.signal);
  if (persistResult && !persistResult.persistedSignal) {
    return;
  }
  input.broadcast(input.signal);
}
