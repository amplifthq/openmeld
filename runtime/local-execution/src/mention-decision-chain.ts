// biome-ignore-all lint/performance/noBarrelFile: This module intentionally re-exports the single-source mention decision chain.
export {
  buildMentionDispatchResultEnvelope,
  MENTION_DISPATCH_ERROR_CODES,
  type MentionDispatchDecision,
  type MentionDispatchPolicy,
  type MentionDispatchRule,
  type MentionDispatchRuleSet,
  type MentionDispatchRuleSource,
  type MentionTargetBindingState,
  type MentionTargetResolution,
} from "@openmeld/schemas";
