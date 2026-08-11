import type {
  OpenMeldDaemonMentionDispatchResultEnvelope,
  OpenMeldDaemonMentionDispatchResultPayload,
} from "../../types/daemon/mention-dispatch-result";
import { collectCanonicalMentionTextFragments } from "../protocol/message-envelope";
import {
  OPENMELD_DAEMON_MENTION_DISPATCH_RESULT_SCHEMA_VERSION,
  openMeldDaemonMentionDispatchResultEnvelopeSchema,
} from "./mention-dispatch-result";

export const MENTION_DISPATCH_ERROR_CODES = {
  bindingDisabled: "controller.binding.disabled",
  bindingMissing: "controller.binding.missing",
  dispatchPolicyUnsupported: "dispatch.policy.unsupported",
  dispatchRulesDenied: "dispatch.rules.denied",
  invalidTarget: "controller.ref.invalid",
  selfTrigger: "dispatch.blocked.self_trigger",
} as const;

const DEFAULT_RULE = {
  ruleId: "registry.default.all_members.v1",
  ruleReason: "default allow all members mention",
  ruleSource: "registry",
} as const;

export type MentionDispatchDecision =
  OpenMeldDaemonMentionDispatchResultPayload;

export type MentionDispatchRuleSource =
  | "system"
  | "space"
  | "profile"
  | "registry";

export type MentionDispatchPolicy = "mention_only" | (string & {});

export type MentionTargetBindingState = "bound" | "missing";

export type MentionTargetResolution = {
  bindingState: MentionTargetBindingState;
  enabled: boolean;
  targetProfileId: string;
};

export type MentionDispatchRule = {
  allow: boolean;
  ruleId: string;
  ruleReason: string;
};

export type MentionDispatchRuleSet = {
  profile?: MentionDispatchRule;
  registry?: MentionDispatchRule;
  space?: MentionDispatchRule;
};

type ResolvedMentionDispatchRule = {
  allow: boolean;
  ruleId: string;
  ruleReason: string;
  ruleSource: Exclude<MentionDispatchRuleSource, "system">;
};

export type MentionDispatchDecisionInput = {
  createDispatchId?: () => string;
  dispatchPolicy?: MentionDispatchPolicy;
  dispatchRules?: MentionDispatchRuleSet;
  resolveMentionTargetLabel: (
    mentionLabel: string
  ) => MentionTargetResolution | null;
  senderProfileId: string;
  sourceEventId: string;
  text: string;
};

export type TargetDispatchDecisionInput = {
  createDispatchId?: () => string;
  dispatchPolicy?: MentionDispatchPolicy;
  dispatchRules?: MentionDispatchRuleSet;
  resolveTargetProfile: (
    targetProfileId: string
  ) => MentionTargetResolution | null;
  senderProfileId: string;
  sourceEventId: string;
  targetProfileIds: string[];
};

const createDefaultDispatchId = (): string => {
  const entropy = Math.random().toString(36).slice(2, 10);
  return `dispatch-${Date.now()}-${entropy}`;
};

const normalizeProfileIdForComparison = (value: string): string =>
  String(value ?? "").trim();

const extractMentionLabels = (text: string): string[] => {
  return collectCanonicalMentionTextFragments(text).flatMap((fragment) => {
    if (fragment.parsedLiteral?.type !== "wake") {
      return [];
    }
    return [fragment.parsedLiteral.name];
  });
};

const resolveMentionTargetWithFallback = (input: {
  mentionLabel: string;
  resolveMentionTargetLabel: (
    mentionLabel: string
  ) => MentionTargetResolution | null;
}): {
  resolvedTarget: MentionTargetResolution;
  resolvedMentionLabel: string;
} | null => {
  const rawMentionLabel = String(input.mentionLabel ?? "").trim();
  if (rawMentionLabel.length === 0) {
    return null;
  }

  const resolvedTarget = input.resolveMentionTargetLabel(rawMentionLabel);
  if (resolvedTarget) {
    return {
      resolvedTarget,
      resolvedMentionLabel: rawMentionLabel,
    };
  }

  return null;
};

const createDecision = (input: {
  createDispatchId: () => string;
  errorCode?: string;
  ruleId: string;
  ruleReason: string;
  ruleSource: MentionDispatchRuleSource;
  sourceEventId: string;
  status: MentionDispatchDecision["status"];
  targetProfileId: string;
}): MentionDispatchDecision => {
  const base = {
    dispatchId: input.createDispatchId(),
    ruleId: input.ruleId,
    ruleReason: input.ruleReason,
    ruleSource: input.ruleSource,
    sourceEventId: input.sourceEventId,
    targetProfileId: input.targetProfileId,
  };

  if (input.status === "dispatch_ready") {
    return {
      ...base,
      status: "dispatch_ready",
    };
  }

  return {
    ...base,
    errorCode: input.errorCode ?? MENTION_DISPATCH_ERROR_CODES.invalidTarget,
    status: input.status,
  };
};

const markSeenOrSkip = (seenKeys: Set<string>, dedupeKey: string): boolean => {
  if (seenKeys.has(dedupeKey)) {
    return true;
  }
  seenKeys.add(dedupeKey);
  return false;
};

const buildSystemRuleMetadata = (input: {
  ruleId: string;
  ruleReason: string;
}): {
  ruleId: string;
  ruleReason: string;
  ruleSource: "system";
} => ({
  ruleId: input.ruleId,
  ruleReason: input.ruleReason,
  ruleSource: "system",
});

const resolveEffectiveDispatchRule = (
  ruleSet: MentionDispatchRuleSet | undefined
): ResolvedMentionDispatchRule => {
  if (ruleSet?.space) {
    return {
      allow: ruleSet.space.allow,
      ruleId: ruleSet.space.ruleId,
      ruleReason: ruleSet.space.ruleReason,
      ruleSource: "space",
    };
  }
  if (ruleSet?.profile) {
    return {
      allow: ruleSet.profile.allow,
      ruleId: ruleSet.profile.ruleId,
      ruleReason: ruleSet.profile.ruleReason,
      ruleSource: "profile",
    };
  }
  if (ruleSet?.registry) {
    return {
      allow: ruleSet.registry.allow,
      ruleId: ruleSet.registry.ruleId,
      ruleReason: ruleSet.registry.ruleReason,
      ruleSource: "registry",
    };
  }
  return {
    allow: true,
    ruleId: DEFAULT_RULE.ruleId,
    ruleReason: DEFAULT_RULE.ruleReason,
    ruleSource: DEFAULT_RULE.ruleSource,
  };
};

const resolveDecisionForMissingTarget = (input: {
  createDispatchId: () => string;
  missingTargetKind: "mention_label" | "profile_target";
  mentionLabel: string;
  seenKeys: Set<string>;
  sourceEventId: string;
}): MentionDispatchDecision | null => {
  const dedupeKey = `invalid:${input.missingTargetKind}:${input.mentionLabel}`;
  if (markSeenOrSkip(input.seenKeys, dedupeKey)) {
    return null;
  }
  const ruleReason =
    input.missingTargetKind === "profile_target"
      ? "profile target cannot be resolved"
      : "mention label cannot be resolved";
  return createDecision({
    createDispatchId: input.createDispatchId,
    sourceEventId: input.sourceEventId,
    status: "failed",
    targetProfileId: input.mentionLabel,
    errorCode: MENTION_DISPATCH_ERROR_CODES.invalidTarget,
    ...buildSystemRuleMetadata({
      ruleId: "system.target_resolution.invalid",
      ruleReason,
    }),
  });
};

const resolveDecisionForTarget = (input: {
  createDispatchId: () => string;
  dispatchPolicy: MentionDispatchPolicy;
  dispatchRules?: MentionDispatchRuleSet;
  mentionLabel: string;
  normalizedSenderProfileId: string;
  resolvedTarget: MentionTargetResolution;
  seenKeys: Set<string>;
  sourceEventId: string;
}): MentionDispatchDecision | null => {
  const targetProfileId = normalizeProfileIdForComparison(
    input.resolvedTarget.targetProfileId
  );
  const normalizedTarget =
    targetProfileId.length > 0 ? targetProfileId : input.mentionLabel;
  if (markSeenOrSkip(input.seenKeys, normalizedTarget)) {
    return null;
  }

  if (normalizedTarget === input.normalizedSenderProfileId) {
    return createDecision({
      createDispatchId: input.createDispatchId,
      sourceEventId: input.sourceEventId,
      status: "blocked",
      targetProfileId: normalizedTarget,
      errorCode: MENTION_DISPATCH_ERROR_CODES.selfTrigger,
      ...buildSystemRuleMetadata({
        ruleId: "system.self_trigger.guard",
        ruleReason: "sender and target are the same profile",
      }),
    });
  }

  const effectiveRule = resolveEffectiveDispatchRule(input.dispatchRules);
  if (!effectiveRule.allow) {
    return createDecision({
      createDispatchId: input.createDispatchId,
      sourceEventId: input.sourceEventId,
      status: "blocked",
      targetProfileId: normalizedTarget,
      errorCode: MENTION_DISPATCH_ERROR_CODES.dispatchRulesDenied,
      ruleSource: effectiveRule.ruleSource,
      ruleId: effectiveRule.ruleId,
      ruleReason: effectiveRule.ruleReason,
    });
  }

  if (input.dispatchPolicy !== "mention_only") {
    return createDecision({
      createDispatchId: input.createDispatchId,
      sourceEventId: input.sourceEventId,
      status: "blocked",
      targetProfileId: normalizedTarget,
      errorCode: MENTION_DISPATCH_ERROR_CODES.dispatchPolicyUnsupported,
      ...buildSystemRuleMetadata({
        ruleId: "system.dispatch_policy.unsupported",
        ruleReason: `unsupported dispatchPolicy: ${input.dispatchPolicy}`,
      }),
    });
  }

  if (!input.resolvedTarget.enabled) {
    return createDecision({
      createDispatchId: input.createDispatchId,
      sourceEventId: input.sourceEventId,
      status: "failed",
      targetProfileId: normalizedTarget,
      errorCode: MENTION_DISPATCH_ERROR_CODES.bindingDisabled,
      ...buildSystemRuleMetadata({
        ruleId: "system.binding.disabled",
        ruleReason: "target binding exists but is disabled",
      }),
    });
  }

  if (input.resolvedTarget.bindingState === "missing") {
    return createDecision({
      createDispatchId: input.createDispatchId,
      sourceEventId: input.sourceEventId,
      status: "failed",
      targetProfileId: normalizedTarget,
      errorCode: MENTION_DISPATCH_ERROR_CODES.bindingMissing,
      ...buildSystemRuleMetadata({
        ruleId: "system.binding.missing",
        ruleReason: "target profile has no controller binding",
      }),
    });
  }

  return createDecision({
    createDispatchId: input.createDispatchId,
    sourceEventId: input.sourceEventId,
    status: "dispatch_ready",
    targetProfileId: normalizedTarget,
    ruleSource: effectiveRule.ruleSource,
    ruleId: effectiveRule.ruleId,
    ruleReason: effectiveRule.ruleReason,
  });
};

export const planMentionDispatchDecisions = (
  input: MentionDispatchDecisionInput
): MentionDispatchDecision[] => {
  const mentions = extractMentionLabels(input.text);
  if (mentions.length === 0) {
    return [];
  }

  const dispatchPolicy = input.dispatchPolicy ?? "mention_only";
  const seenKeys = new Set<string>();
  const decisions: MentionDispatchDecision[] = [];
  const createDispatchId = input.createDispatchId ?? createDefaultDispatchId;
  const normalizedSenderProfileId = normalizeProfileIdForComparison(
    input.senderProfileId
  );

  for (const mentionLabel of mentions) {
    const resolvedMention = resolveMentionTargetWithFallback({
      mentionLabel,
      resolveMentionTargetLabel: input.resolveMentionTargetLabel,
    });
    if (!resolvedMention) {
      const normalizedMissingMentionLabel = String(mentionLabel ?? "").trim();
      const invalidDecision = resolveDecisionForMissingTarget({
        createDispatchId,
        missingTargetKind: "mention_label",
        mentionLabel:
          normalizedMissingMentionLabel.length > 0
            ? normalizedMissingMentionLabel
            : mentionLabel,
        seenKeys,
        sourceEventId: input.sourceEventId,
      });
      if (invalidDecision) {
        decisions.push(invalidDecision);
      }
      continue;
    }

    const decision = resolveDecisionForTarget({
      createDispatchId,
      dispatchPolicy,
      dispatchRules: input.dispatchRules,
      mentionLabel: resolvedMention.resolvedMentionLabel,
      normalizedSenderProfileId,
      resolvedTarget: resolvedMention.resolvedTarget,
      seenKeys,
      sourceEventId: input.sourceEventId,
    });
    if (decision) {
      decisions.push(decision);
    }
  }

  return decisions;
};

export const planTargetDispatchDecisions = (
  input: TargetDispatchDecisionInput
): MentionDispatchDecision[] => {
  if (input.targetProfileIds.length === 0) {
    return [];
  }

  const dispatchPolicy = input.dispatchPolicy ?? "mention_only";
  const seenKeys = new Set<string>();
  const decisions: MentionDispatchDecision[] = [];
  const createDispatchId = input.createDispatchId ?? createDefaultDispatchId;
  const normalizedSenderProfileId = normalizeProfileIdForComparison(
    input.senderProfileId
  );

  for (const targetProfileId of input.targetProfileIds) {
    const normalizedTargetProfileId =
      normalizeProfileIdForComparison(targetProfileId);
    if (normalizedTargetProfileId.length === 0) {
      continue;
    }

    const resolvedTarget = input.resolveTargetProfile(
      normalizedTargetProfileId
    );
    if (!resolvedTarget) {
      const invalidDecision = resolveDecisionForMissingTarget({
        createDispatchId,
        missingTargetKind: "profile_target",
        mentionLabel: normalizedTargetProfileId,
        seenKeys,
        sourceEventId: input.sourceEventId,
      });
      if (invalidDecision) {
        decisions.push(invalidDecision);
      }
      continue;
    }

    const decision = resolveDecisionForTarget({
      createDispatchId,
      dispatchPolicy,
      dispatchRules: input.dispatchRules,
      mentionLabel: normalizedTargetProfileId,
      normalizedSenderProfileId,
      resolvedTarget,
      seenKeys,
      sourceEventId: input.sourceEventId,
    });
    if (decision) {
      decisions.push(decision);
    }
  }

  return decisions;
};

export const buildMentionDispatchResultEnvelope = (
  payload: MentionDispatchDecision
): OpenMeldDaemonMentionDispatchResultEnvelope => {
  const parsed = openMeldDaemonMentionDispatchResultEnvelopeSchema.safeParse({
    v: OPENMELD_DAEMON_MENTION_DISPATCH_RESULT_SCHEMA_VERSION,
    code: "service.mention_dispatch_result",
    payload,
  });
  if (!parsed.success) {
    throw new Error("invalid mention dispatch result envelope");
  }
  return parsed.data;
};
