import { installClaudeCodeAdapter } from "./install-claude-code.js";
import { installCodexAdapter } from "./install-codex.js";
import { installCursorAdapter } from "./install-cursor.js";
import { installOpenClawAdapter } from "./install-openclaw.js";
import { installOpenCodeAdapter } from "./install-opencode.js";
import type { LocalAdapterInstaller } from "./types.js";

export function listLocalAdapterInstallers(): LocalAdapterInstaller[] {
  return [
    installClaudeCodeAdapter,
    installCodexAdapter,
    installCursorAdapter,
    installOpenClawAdapter,
    installOpenCodeAdapter,
  ];
}
