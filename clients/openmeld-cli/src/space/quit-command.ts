export const SPACE_QUIT_PRIMARY_TRIGGER = "/quit";

export const SPACE_QUIT_COMMAND_TOKENS = [
  SPACE_QUIT_PRIMARY_TRIGGER,
  "/exit",
  "exit",
  ":q",
] as const;

const SPACE_QUIT_COMMAND_SET = new Set(
  SPACE_QUIT_COMMAND_TOKENS.map((token) => token.toLowerCase())
);

export function isSpaceQuitCommand(value: string): boolean {
  const normalized = value.trim().toLowerCase();
  return normalized.length > 0 && SPACE_QUIT_COMMAND_SET.has(normalized);
}
