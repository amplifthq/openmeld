import { buildSpaceAccessPromptCardMessage } from "./space-access-prompt-card";

export type SpaceCreateInitialAccessMode = "public" | "members_only";

export type SpaceCreatePasswordPromptConfig = {
  message: string;
  setPasswordLabel: string;
  skipPasswordLabel: string;
};

export function buildSpaceCreatePasswordPromptConfig(input: {
  accessMode: SpaceCreateInitialAccessMode;
  minimumLength: number;
}): SpaceCreatePasswordPromptConfig {
  return {
    message: buildSpaceAccessPromptCardMessage({
      lines: [
        resolveSpaceCreatePasswordlessAccessText(input.accessMode),
        "With a password, only people who have it can open and join the Space.",
        `Passwords must be at least ${input.minimumLength} characters.`,
      ],
      question: "Require a password to open and join?",
    }),
    setPasswordLabel: "Yes, require a password to open and join",
    skipPasswordLabel:
      input.accessMode === "public"
        ? "No, anyone with the link can join"
        : "No, keep access members-only",
  };
}

export function resolveSpaceCreatePasswordlessAccessText(
  accessMode: SpaceCreateInitialAccessMode
): string {
  return accessMode === "public"
    ? "Without a password, anyone with this Space link can read what is shared here and join."
    : "Without a password, only current members can open this Space. New participants must be added explicitly.";
}
