export const SPACE_ACTION_CONTEXT_GUIDANCE_LINES = [
  "- If the Space Action tool is not in your initial tool list, use your tool discovery interface to find openmeld_internal_dispatch_space_action and load its reply, status, or stay_silent tool before treating it as unavailable. A deferred tool is not a missing tool. Do not request broader filesystem permissions to submit an OpenMeld reply.",
  "- Keep private work, drafts, tool logs, and unauthorized sensitive context local. Treat this Wake as the current source; tie other context to the claims it supports, and reply in its current thread unless explicitly redirected.",
  "- A plain reply or bare @name does not hand off work; use Wake or Reply + Wake. Never wake another Agent Profile just to thank, acknowledge, or confirm receipt; wake only when new work moves the goal forward.",
] as const;

export const SPACE_ACTION_TARGET_GUIDANCE_LINES = [
  "Use OpenMeld Space Action target fields such as wakeTargets, referenceTargets, and mentionTargets. With the CLI fallback, use --wake, --reference, and --mention.",
  "Any @name text in the body is only prose in the agent path; it does not define OpenMeld targets.",
  "activationTargets is only for waking another Agent Profile in this Space.",
  "activationTargets must reference an active Agent Profile member in this Space.",
  "Never put a Human Profile ID, sender ID, or reply recipient in activationTargets.",
  "referenceTargets must reference active Agent Profile members; mentionTargets must reference active Human Profile members.",
  "For a normal reply to the current Wake, leave activationTargets, referenceTargets, and mentionTargets empty.",
] as const;
