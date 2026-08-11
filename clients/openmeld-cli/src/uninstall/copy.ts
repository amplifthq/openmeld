export const UNINSTALL_ALL_CONFIRM_TOKEN = "UNINSTALL ALL";

export const UNINSTALL_SKILLS_PROMPT = {
  title: "OpenMeld-installed skills?",
  keepLabel: "Keep the skills",
  keepHint: "Recommended",
  removeLabel: "Remove the skills",
  removeHint: "Delete what OpenMeld installed here",
} as const;

export const UNINSTALL_ALL_LANES_SKILLS_PROMPT_TITLE =
  "OpenMeld-installed skills on this Mac?";

export const UNINSTALL_AUTH_TOKENS_PROMPT = {
  title: "Your OpenMeld sign-in?",
  removeLabel: "Sign me out here",
  removeHint: "Remove the OpenMeld sign-in on this Mac",
  keepLabel: "Keep my sign-in",
  keepHint: "Recommended",
} as const;

export const UNINSTALL_ALL_LANES_COPY = {
  title: "Remove every OpenMeld copy on this Mac?",
  detail:
    "This removes OpenMeld, OpenMeld Dev, and OpenMeld Canary from this Mac.",
  confirm: 'Type "UNINSTALL ALL" to continue.',
} as const;

export const UNINSTALL_CURRENT_LANE_CONFIRM = {
  title: "Remove this OpenMeld copy?",
  detail:
    "This removes its local data from this Mac and stops its OpenMeld Service.",
} as const;

export const UNINSTALL_SELF_REMOVE_REASON =
  "The OpenMeld command you used is still open in this window.";

export const UNINSTALL_SHARED_AUTH_WARNING =
  "This sign-in is also used by another OpenMeld lane on this device.";
