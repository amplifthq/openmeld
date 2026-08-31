import type { SpaceAccessPresentationInput } from "../space/access-presentation";
import { buildSpaceAccessPromptCardMessage } from "./space-access-prompt-card";

type PublicSpaceConfirmPromptConfig = {
  active: string;
  inactive: string;
  message: string;
  vertical: boolean;
};

export type PublicSpaceExposure = "anyone_can_join" | "anyone_can_view";

export function resolvePublicSpaceExposure(
  input: SpaceAccessPresentationInput
): PublicSpaceExposure | null {
  switch (input.accessMode) {
    case "public":
      return "anyone_can_join";
    case "public_view_join_password":
      return "anyone_can_view";
    case "members_only":
    case "protected":
      return null;
    default:
      // Older Space metadata did not include accessMode. Organization
      // visibility is independent of link access, so the legacy password fact
      // is the only safe compatibility signal here.
      return input.passwordProtected === false ? "anyone_can_join" : null;
  }
}

export function buildPublicSpaceWarningLines(
  exposure: PublicSpaceExposure
): [string, string] {
  const firstLine =
    exposure === "anyone_can_join"
      ? "Anyone with this Space link can read what is shared here and join."
      : "Anyone with this Space link can read what is shared here. A password is required to join.";
  return [
    firstLine,
    "Only bring an agent if you're comfortable sharing anything it posts with people who have the link.",
  ];
}

export function buildPublicSpaceJoinConfirmPromptConfig(input: {
  exposure: PublicSpaceExposure;
}): PublicSpaceConfirmPromptConfig {
  return {
    active: "Yes, join this Space",
    inactive: "No, go back",
    message: buildPublicSpacePromptMessage(
      "Do you want to join this Space?",
      input.exposure
    ),
    vertical: true,
  };
}

export function buildPublicSpaceBringAgentsConfirmPromptConfig(input: {
  agentCount: number;
  exposure: PublicSpaceExposure;
}): PublicSpaceConfirmPromptConfig {
  const singular = input.agentCount === 1;
  return {
    active: singular ? "Yes, bring this agent" : "Yes, bring these agents",
    inactive: singular
      ? "No, join without this agent"
      : "No, join without these agents",
    message: buildPublicSpacePromptMessage(
      singular
        ? "Bring this agent into a Space that anyone with the link can read?"
        : "Bring these agents into a Space that anyone with the link can read?",
      input.exposure
    ),
    vertical: true,
  };
}

function buildPublicSpacePromptMessage(
  question: string,
  exposure: PublicSpaceExposure
): string {
  return buildSpaceAccessPromptCardMessage({
    lines: buildPublicSpaceWarningLines(exposure),
    question,
  });
}
