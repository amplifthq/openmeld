// biome-ignore-all lint/performance/noBarrelFile: This package intentionally exposes a stable public entrypoint.

export { resolvePublicAgentFailureReason } from "./agent-failure-reason";
export {
  buildAgentFacingMentalModelLines,
  buildAgentFacingMentalModelParagraph,
  buildAgentFacingPublicationModeGuideLines,
  OPENMELD_AGENT_MENTAL_MODEL_LINES,
  OPENMELD_AGENT_PUBLICATION_MODE_GUIDANCE_LINES,
} from "./agent-mental-model";
export {
  buildCenterAgentRoleTemplateText,
  CENTER_AGENT_ROLE_TEMPLATE_LINES,
  CENTER_AGENT_ROLE_TEMPLATE_VERSION,
} from "./center-agent-role-template";
export {
  buildSpaceAgentIdentityLine,
  buildSpaceWakeParticipantLines,
  SPACE_COLLABORATION_CONTEXT_RULE,
  SPACE_PERSONAL_CONTRIBUTION_RULE,
} from "./collaboration-context";
export { deriveContinuity } from "./continuity";
export {
  buildCompactDispatchActionGuidanceLines,
  composeDispatchBrief,
} from "./dispatch-brief";
export {
  buildSpaceEntryBriefNeedMoreLine,
  composeEntryBrief,
  renderSpaceEntryBrief,
  SPACE_GUIDE_PROMPT_HEADING,
} from "./entry-brief";
export { resolveGuideEntry } from "./guide-entry";
export { OPENMELD_GUIDE_URL } from "./guide-urls";
export {
  isSelfWakeSpaceAction,
  normalizeOpenMeldSpaceAction,
  normalizeOpenMeldSpaceEgressAction,
} from "./openmeld-space-action";
export { resolveSpacePublicationRequirement } from "./publication-requirement";
export { resolveResultArchiveBehavior } from "./result-archive";
export {
  areAllowedActionsEquivalent,
  buildDefaultSpaceContract,
  canonicalizeAllowedActions,
  DEFAULT_SPACE_CONTRACT_FIELDS,
  SPACE_CONTRACT_ALLOWED_ACTION_ORDER,
} from "./space-contract";
export {
  buildSystemNoticeText,
  type SystemNoticeTextVariant,
} from "./system-notice";
