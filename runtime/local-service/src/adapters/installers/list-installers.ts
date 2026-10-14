import { installAntigravityAdapter } from "./install-antigravity.js";
import { installClaudeCodeAdapter } from "./install-claude-code.js";
import { installCodexAdapter } from "./install-codex.js";
import { installCursorAdapter } from "./install-cursor.js";
import { installGrokBotAdapter } from "./install-grok-bot.js";
import { installGrokBuildAdapter } from "./install-grok-build.js";
import { installOpenClawAdapter } from "./install-openclaw.js";
import { installOpenCodeAdapter } from "./install-opencode.js";
import type { LocalAdapterInstaller } from "./types.js";

export function listLocalAdapterInstallers(): LocalAdapterInstaller[] {
  return [
    installAntigravityAdapter,
    installClaudeCodeAdapter,
    installCodexAdapter,
    installCursorAdapter,
    installGrokBuildAdapter,
    installGrokBotAdapter,
    installOpenClawAdapter,
    installOpenCodeAdapter,
  ];
}
