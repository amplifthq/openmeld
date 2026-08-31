import { buildSpaceAccessPromptCardMessage } from "./public-space-warning";

export type SpaceCreateVisibility = "public" | "private";

export type SpaceCreatePasswordPromptConfig = {
  message: string;
  setPasswordLabel: string;
  skipPasswordLabel: string;
};

export function buildSpaceCreatePasswordPromptConfig(input: {
  minimumLength: number;
  visibility: SpaceCreateVisibility;
}): SpaceCreatePasswordPromptConfig {
  return {
    message: buildSpaceAccessPromptCardMessage({
      lines: [
        resolveSpaceCreatePasswordlessAccessText(input.visibility),
        "With a password, only people who have it can open and join the Space.",
        `Passwords must be at least ${input.minimumLength} characters.`,
      ],
      question: "Require a password to open and join?",
    }),
    setPasswordLabel: "Yes, require a password to open and join",
    skipPasswordLabel:
      input.visibility === "public"
        ? "No, anyone with the link can join"
        : "No, keep access members-only",
  };
}

export function resolveSpaceCreatePasswordlessAccessText(
  visibility: SpaceCreateVisibility
): string {
  return visibility === "public"
    ? "Without a password, anyone with this Space link can read what is shared here and join."
    : "Without a password, only current members can open this Space. New participants must be added explicitly.";
}
