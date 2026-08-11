import { buildUnifiedCardFrame } from "./card-frame";

const PUBLIC_SPACE_WARNING_TITLE = "⚠️ Public Space Warning";
const PUBLIC_SPACE_WARNING_LINES = [
  "⚠️ Public space: anyone with this Space ID can join. Treat it as untrusted.",
  "⚠️ Be careful, and only bring your own agents here in a trusted environment.",
] as const;
const PUBLIC_SPACE_JOIN_CONFIRM_LABELS = {
  active: "Yes and join (I know this is public and may be unsafe.)",
  inactive: "No and cancel (I don't want to join.)",
} as const;

type PublicSpaceConfirmPromptConfig = {
  active: string;
  inactive: string;
  message: string;
  vertical: boolean;
};

export function isPublicSpace(passwordProtected?: boolean): boolean {
  return passwordProtected === false;
}

export function buildPublicSpaceWarningLines(): string[] {
  return [...PUBLIC_SPACE_WARNING_LINES];
}

export function resolveSpaceSecurityLabel(passwordProtected?: boolean): string {
  if (passwordProtected === true) {
    return "protected by password";
  }
  if (passwordProtected === false) {
    return "public";
  }
  return "unknown";
}

export function buildPublicSpaceJoinConfirmPromptConfig(): PublicSpaceConfirmPromptConfig {
  return {
    active: PUBLIC_SPACE_JOIN_CONFIRM_LABELS.active,
    inactive: PUBLIC_SPACE_JOIN_CONFIRM_LABELS.inactive,
    message: buildPublicSpacePromptMessage(
      "Do you still want to join this public space?"
    ),
    vertical: true,
  };
}

export function buildPublicSpaceBringAgentsConfirmPromptConfig(input: {
  agentCount: number;
}): PublicSpaceConfirmPromptConfig {
  const singular = input.agentCount === 1;
  return {
    active: singular
      ? "Yes and bring it (I know this is public and may be unsafe.)"
      : "Yes and bring them (I know this is public and may be unsafe.)",
    inactive: singular
      ? "No and join without it (I don't want to bring it.)"
      : "No and join without them (I don't want to bring them.)",
    message: buildPublicSpacePromptMessage(
      singular
        ? "Do you want to bring this agent profile into this public space?"
        : "Do you want to bring these agent profiles into this public space?"
    ),
    vertical: true,
  };
}

function buildPublicSpacePromptMessage(question: string): string {
  const frame = buildUnifiedCardFrame({
    title: PUBLIC_SPACE_WARNING_TITLE,
    rowTextList: [...PUBLIC_SPACE_WARNING_LINES],
    minContentWidth: 76,
  });
  return [
    frame.top,
    frame.empty,
    ...frame.rows,
    frame.empty,
    frame.bottom,
    question,
  ].join("\n");
}
