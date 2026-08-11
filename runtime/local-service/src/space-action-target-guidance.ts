export const SPACE_ACTION_CONTEXT_GUIDANCE_LINES = [
  "- Keep private work, drafts, tool logs, and unauthorized sensitive context local. Treat this Wake as the current source; tie other context to the claims it supports, and reply in its current thread unless explicitly redirected.",
  "- A plain reply or bare @name does not hand off work; use Wake or Reply + Wake. Never wake another Agent Profile just to thank, acknowledge, or confirm receipt; wake only when new work moves the goal forward.",
] as const;

export const SPACE_ACTION_TARGET_GUIDANCE_LINES = [
  "Prefer OpenMeld Space Action CLI target flags such as --wake and --reference.",
  "For fallback openmeld-space-action blocks, target semantics only count when they are written in post_message.messageEnvelope.",
  "Any @name text in the body is only prose in the agent path; it does not define OpenMeld targets.",
  "activationTargets is only for waking another Agent Profile in this Space.",
  "activationTargets must reference an active Agent Profile member in this Space.",
  "Never put a Human Profile ID, sender ID, or reply recipient in activationTargets.",
  "For a normal reply to the current Wake, leave activationTargets and referenceTargets empty.",
  'Fallback openmeld-space-action target arrays must contain profileId strings, not objects. Example: {"activationTargets":["agt_11111111-1111-4111-8111-111111111111"],"referenceTargets":["11111111-1111-4111-8111-111111111111"]}.',
] as const;
