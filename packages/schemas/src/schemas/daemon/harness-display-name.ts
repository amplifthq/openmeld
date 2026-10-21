import type { HarnessKind } from "./harness-kind";

// English product names of each Harness. A detected MemberAgent's default
// Agent Profile is named after its Harness and that name is never edited.
export const HARNESS_DISPLAY_NAMES = {
  antigravity: "Antigravity",
  "claude-code": "Claude Code",
  codex: "Codex",
  cursor: "Cursor",
  "grok-bot": "Grok Bot",
  "grok-build": "Grok Build",
  hosted: "Remote Agent",
  openclaw: "OpenClaw",
  opencode: "OpenCode",
} as const satisfies Record<HarnessKind, string>;

export function formatHarnessDisplayName(harnessKind: HarnessKind): string {
  return HARNESS_DISPLAY_NAMES[harnessKind];
}
