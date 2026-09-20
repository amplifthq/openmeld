import catalogue from "./reaction-emoji.json";

// Generated from emojibase-data 17.0.0 (MIT); native Unicode only.
const entries: Record<string, string[]> = catalogue;
export function resolveReactionEmoji(
  value: string
): { emoji: string; label: string } | null {
  const match = Object.hasOwn(entries, value) ? entries[value] : undefined;
  return match?.[0] && match[1] ? { emoji: match[0], label: match[1] } : null;
}
