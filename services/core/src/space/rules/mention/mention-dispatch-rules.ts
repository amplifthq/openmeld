import type { Profile, SignalEnvelope } from "@openmeld/protocol";
import {
  MENTION_DISPATCH_ERROR_CODES,
  planTargetDispatchDecisions,
} from "@openmeld/schemas";
import type {
  OpenMeldDaemonMentionDispatchResultPayload,
  RuntimeDispatchPolicy,
} from "@openmeld/schemas/types";
import { resolveSpaceMentionDispatchRuleSet } from "../../infrastructure/sql/space-dispatch-rule-repo";
import { listSpaceMemberRecords } from "../../infrastructure/sql/space-member-repo";
import { parseStoredSignal } from "../parsers/stored-signal";
import {
  buildAgentMentionTargetAliasIndex,
  buildEffectiveAgentMentionLabelByProfileId,
} from "./space-agent-mention-targets";

const MENTION_ALIAS_SIGNAL_SCAN_LIMIT = 512;

type MentionDispatchFailureDecision = Extract<
  OpenMeldDaemonMentionDispatchResultPayload,
  { status: "blocked" | "failed" }
>;

export type DispatchReadyDecision = Extract<
  OpenMeldDaemonMentionDispatchResultPayload,
  { status: "dispatch_ready" }
>;

export const isDispatchReadyDecision = (
  decision: OpenMeldDaemonMentionDispatchResultPayload
): decision is DispatchReadyDecision => {
  return decision.status === "dispatch_ready";
};

const PUBLIC_MENTION_FAILURE_CODES = new Set<string>([
  MENTION_DISPATCH_ERROR_CODES.invalidTarget,
  MENTION_DISPATCH_ERROR_CODES.dispatchRulesDenied,
  MENTION_DISPATCH_ERROR_CODES.dispatchPolicyUnsupported,
]);

const SPACE_HISTORY_ELIGIBLE_MENTION_FAILURE_CODES =
  PUBLIC_MENTION_FAILURE_CODES;

export const shouldEmitPublicMentionFailureHintDecision = (
  decision: OpenMeldDaemonMentionDispatchResultPayload
): decision is MentionDispatchFailureDecision => {
  if (!(decision.status === "blocked" || decision.status === "failed")) {
    return false;
  }
  return PUBLIC_MENTION_FAILURE_CODES.has(
    String(decision.errorCode ?? "").trim()
  );
};

export const isSpaceHistoryEligibleMentionFailureDecision = (
  decision: OpenMeldDaemonMentionDispatchResultPayload
): decision is MentionDispatchFailureDecision => {
  return (
    shouldEmitPublicMentionFailureHintDecision(decision) &&
    SPACE_HISTORY_ELIGIBLE_MENTION_FAILURE_CODES.has(
      String(decision.errorCode ?? "").trim()
    )
  );
};

export function resolveDispatchPlannerDecisionsForSignal(input: {
  dispatchPolicy: RuntimeDispatchPolicy;
  sessions: Iterable<{
    profile?: Profile;
    enforcedProfile?: Profile;
  }> | null;
  signal: SignalEnvelope;
  sql: SqlStorage;
}): OpenMeldDaemonMentionDispatchResultPayload[] {
  if (input.signal.type !== "signal.text") {
    return [];
  }

  const senderProfileId = String(input.signal.profile?.profileId ?? "").trim();
  if (!senderProfileId) {
    return [];
  }

  const sourceEventId = String(input.signal.id ?? "").trim();
  if (!sourceEventId) {
    return [];
  }

  const activationTargets = readSignalActivationTargets(input.signal);
  if (!activationTargets || activationTargets.length === 0) {
    return [];
  }

  const activeAgentProfileIds = new Set(
    listSpaceMemberRecords(input.sql, { status: "active" })
      .filter((record) => record.profileKindSnapshot === "agent")
      .map((record) => record.profileId)
  );
  const dispatchRules = resolveSpaceMentionDispatchRuleSet(
    input.sql,
    Date.now()
  );
  return planTargetDispatchDecisions({
    dispatchPolicy: input.dispatchPolicy,
    dispatchRules,
    resolveTargetProfile: (targetProfileId) =>
      activeAgentProfileIds.has(targetProfileId)
        ? {
            bindingState: "bound",
            enabled: true,
            targetProfileId,
          }
        : null,
    senderProfileId,
    sourceEventId,
    targetProfileIds: activationTargets,
  });
}

export function buildMentionFailureHintText(input: {
  decisions: OpenMeldDaemonMentionDispatchResultPayload[];
  mentionTargetAliases: Map<string, Set<string>>;
  suppressInvalidTargetMentionTokens?: Set<string>;
}): string | null {
  const failureLines: string[] = [];
  const seenFailureKeys = new Set<string>();

  for (const decision of input.decisions) {
    if (decision.status === "dispatch_ready") {
      continue;
    }
    if (!shouldEmitPublicMentionFailureHintDecision(decision)) {
      continue;
    }
    if (
      shouldSuppressMentionFailureHint({
        decision,
        suppressInvalidTargetMentionTokens:
          input.suppressInvalidTargetMentionTokens,
      })
    ) {
      continue;
    }

    const dedupeKey = `${decision.status}|${decision.errorCode}|${decision.targetProfileId}`;
    if (seenFailureKeys.has(dedupeKey)) {
      continue;
    }
    seenFailureKeys.add(dedupeKey);
    failureLines.push(
      buildMentionFailureHintLine({
        decision,
        mentionTargetAliases: input.mentionTargetAliases,
      })
    );
  }

  if (failureLines.length === 0) {
    return null;
  }

  if (failureLines.length === 1) {
    return failureLines[0] ?? null;
  }

  return failureLines.map((line, index) => `${index + 1}. ${line}`).join("\n");
}

export function buildHumanMentionAliasIndexForHint(input: {
  sessions: Iterable<{
    profile?: Profile;
    enforcedProfile?: Profile;
  }> | null;
  sql: SqlStorage;
}): Set<string> {
  const aliases = new Set<string>();
  const addAlias = (token: string): void => {
    const normalized = token.trim().toLowerCase();
    if (normalized.length === 0) {
      return;
    }
    aliases.add(normalized);
  };

  if (input.sessions) {
    for (const session of input.sessions) {
      const profile = session.profile ?? session.enforcedProfile;
      if (profile?.kind !== "human") {
        continue;
      }
      addAlias(String(profile.profileId ?? ""));
      addAlias(String(profile.profileName ?? ""));
    }
  }

  type PersistedMentionAliasRow = {
    profile_id: string | null;
    payload_json: string;
  };

  const rows = input.sql
    .exec<PersistedMentionAliasRow>(
      `
        SELECT profile_id, payload_json
        FROM space_signals
        WHERE profile_id IS NOT NULL
        ORDER BY ts DESC, id DESC
        LIMIT ?
      `,
      MENTION_ALIAS_SIGNAL_SCAN_LIMIT
    )
    .toArray();

  for (const row of rows) {
    const signal = parseStoredSignal(row.payload_json);
    if (signal?.profile?.kind !== "human") {
      continue;
    }
    addAlias(String(row.profile_id ?? ""));
    addAlias(String(signal.profile?.profileName ?? ""));
  }

  return aliases;
}

export function buildMentionTargetAliasIndexForDispatch(
  sessions: Iterable<{
    profile?: Profile;
    enforcedProfile?: Profile;
  }> | null,
  sql: SqlStorage
): Map<string, Set<string>> {
  return buildAgentMentionTargetAliasIndex({
    sessions,
    sql,
  });
}

export function buildEffectiveMentionLabelByProfileIdForDispatch(
  sessions: Iterable<{
    profile?: Profile;
    enforcedProfile?: Profile;
  }> | null,
  sql: SqlStorage
): Map<string, string> {
  return buildEffectiveAgentMentionLabelByProfileId({
    sessions,
    sql,
  });
}

function readSignalActivationTargets(signal: SignalEnvelope): string[] | null {
  if (signal.type !== "signal.text") {
    return null;
  }

  const messageEnvelope = (
    signal.data as {
      messageEnvelope?: {
        activationTargets?: unknown;
      } | null;
    }
  ).messageEnvelope;
  if (!(messageEnvelope && typeof messageEnvelope === "object")) {
    return null;
  }

  const normalizeTargets = (value: unknown): string[] =>
    Array.isArray(value)
      ? value
          .map((targetProfileId) => String(targetProfileId ?? "").trim())
          .filter((targetProfileId) => targetProfileId.length > 0)
      : [];

  return normalizeTargets(messageEnvelope.activationTargets);
}

function buildMentionFailureHintLine(input: {
  decision: MentionDispatchFailureDecision;
  mentionTargetAliases: Map<string, Set<string>>;
}): string {
  return `Wake could not be sent to Profile ID "${input.decision.targetProfileId}" (${input.decision.errorCode}). Select a current Agent in the Space, or use --wake with its full Profile ID from openmeld space members.`;
}

function shouldSuppressMentionFailureHint(input: {
  decision: MentionDispatchFailureDecision;
  suppressInvalidTargetMentionTokens?: Set<string>;
}): boolean {
  if (input.decision.errorCode !== MENTION_DISPATCH_ERROR_CODES.invalidTarget) {
    return false;
  }
  const mentionLabel = input.decision.targetProfileId.trim();
  if (mentionLabel.length === 0) {
    return false;
  }
  return input.suppressInvalidTargetMentionTokens?.has(mentionLabel) ?? false;
}
