export const SPACE_ACTION_CONTEXT_GUIDANCE_LINES = [
  "- Use the supplied reply or stay_silent tool for the final outcome. Answers, known limitations, errors and requests for help are replies. No shell, repository access, or Skill lookup is needed. When an older controller defers tools, its native discovery can find openmeld_internal_dispatch_space_action; do not request broader permissions or change transports after a denial.",
  "- Keep private work, drafts, tool logs, and unauthorized sensitive context local. Treat this Wake as the current source; tie other context to the claims it supports, and reply in its current thread unless explicitly redirected.",
  "- A plain reply or bare @name does not hand off work; use Wake or Reply + Wake. Never wake another Agent Profile just to thank, acknowledge, or confirm receipt; wake only when new work moves the goal forward.",
] as const;

export const SPACE_ACTION_TARGET_GUIDANCE_LINES = [
  "Use the supplied tool's wakeTargets, referenceTargets, and mentionTargets fields only when addressing recipients. Omit all recipient fields for a plain reply.",
  "Any @name text in the body is only prose in the agent path; it does not define OpenMeld targets.",
  "activationTargets is only for waking another Agent Profile in this Space.",
  "activationTargets must reference an active Agent Profile member in this Space.",
  "Never put a Human Profile ID, sender ID, or reply recipient in activationTargets.",
  "referenceTargets must reference active Agent Profile members; mentionTargets must reference active Human Profile members.",
  "For a normal reply to the current Wake, leave activationTargets, referenceTargets, and mentionTargets empty.",
] as const;
