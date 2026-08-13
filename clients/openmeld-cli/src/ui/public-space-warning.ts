import type { SpaceMeta } from "@openmeld/protocol";
import { buildUnifiedCardFrame } from "./card-frame";

const PUBLIC_SPACE_WARNING_TITLE = "⚠️ Check Before You Continue";

type PublicSpaceConfirmPromptConfig = {
  active: string;
  inactive: string;
  message: string;
  vertical: boolean;
};

export type PublicSpacePasswordPromptConfig = {
  message: string;
  setPasswordLabel: string;
  skipPasswordLabel: string;
};

export type SpaceAccessPresentationInput = Pick<
  SpaceMeta,
  "accessMode" | "passwordProtected"
> &
  Partial<Pick<SpaceMeta, "visibility">>;

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

export function resolveSpaceAccessLabel(
  input: SpaceAccessPresentationInput
): string {
  switch (input.accessMode) {
    case "members_only":
      return "members only";
    case "public":
      return "anyone with the link";
    case "public_view_join_password":
      return "anyone can view; password required to join";
    case "protected":
      return "password required to view and join";
    default:
      if (input.passwordProtected === true) {
        return "password required";
      }
      if (input.passwordProtected === false) {
        return "anyone with the link";
      }
      return "unknown";
  }
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

export function buildPublicSpacePasswordPromptConfig(input: {
  minimumLength: number;
}): PublicSpacePasswordPromptConfig {
  return {
    message: buildPublicSpacePromptCardMessage({
      lines: [
        "Without a password, anyone with this Space link can read what is shared here and join.",
        "With a password, only people who have it can open and join the Space.",
        `Passwords must be at least ${input.minimumLength} characters.`,
      ],
      question: "Require a password to open and join?",
    }),
    setPasswordLabel: "Yes, require a password to open and join",
    skipPasswordLabel: "No, anyone with the link can join",
  };
}

function buildPublicSpacePromptMessage(
  question: string,
  exposure: PublicSpaceExposure
): string {
  return buildPublicSpacePromptCardMessage({
    lines: buildPublicSpaceWarningLines(exposure),
    question,
  });
}

function buildPublicSpacePromptCardMessage(input: {
  lines: string[];
  question: string;
}): string {
  const frame = buildUnifiedCardFrame({
    title: PUBLIC_SPACE_WARNING_TITLE,
    rowTextList: input.lines,
    minContentWidth: 76,
  });
  return [
    frame.top,
    frame.empty,
    ...frame.rows,
    frame.empty,
    frame.bottom,
    input.question,
  ].join("\n");
}
