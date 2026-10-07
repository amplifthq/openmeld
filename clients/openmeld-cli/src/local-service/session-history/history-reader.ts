import type { SessionHistoryOperation } from "@openmeld/schemas/types";
import { readClaudeHistory } from "./claude-history-reader";
import { readCodexHistory } from "./codex-history-reader";
import { readGrokHistory } from "./grok-history-reader";
import { readOpenCodeHistory } from "./opencode-history-reader";

export async function readSessionHistory(input: {
  provider: Extract<
    SessionHistoryOperation,
    { operation: "read_session" }
  >["provider"];
  sessionId: string;
  authorizePath: (cwd: string) => Promise<void>;
}) {
  const readers = {
    codex: readCodexHistory,
    "claude-code": readClaudeHistory,
    opencode: readOpenCodeHistory,
    "grok-build": readGrokHistory,
  };
  return await readers[input.provider ?? "codex"](input);
}
