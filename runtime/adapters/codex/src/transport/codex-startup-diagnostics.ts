// Observation only: these hints never grant admission or decide retry safety.
// Keep a fixed vocabulary instead of forwarding provider stderr, server names,
// paths, URLs, credentials, or request/notification payloads into Wake errors.
const STARTUP_PHASES = [
  "thread_persistence",
  "state_db",
  "auth_mcp",
  "plugin_skill_warmup",
  "thread_name_lookup",
  "network_proxy",
  "mcp_manager_init",
] as const;
const MCP_STATUSES = new Set(["starting", "ready", "failed", "cancelled"]);
const MAX_PARTIAL_LINE = 8192;

export class CodexStartupDiagnostics {
  #partialLine = "";
  #lastPhase: string | null = null;
  #mcpStatus: string | null = null;
  #reauthenticationObserved = false;

  observeStderr(chunk: string): void {
    const text = (this.#partialLine + chunk).slice(-MAX_PARTIAL_LINE);
    let latest = -1;
    for (const phase of STARTUP_PHASES) {
      const index = text.lastIndexOf(`session_init.${phase}`);
      if (index > latest) {
        latest = index;
        this.#lastPhase = phase;
      }
    }
    this.#partialLine = text.slice(text.lastIndexOf("\n") + 1);
  }

  observeNotification(method: string, params: unknown): void {
    if (
      method !== "mcpServer/startupStatus/updated" ||
      !params ||
      typeof params !== "object"
    ) {
      return;
    }
    const status = "status" in params ? params.status : null;
    if (typeof status === "string" && MCP_STATUSES.has(status)) {
      this.#mcpStatus = status;
    }
    if (
      "failureReason" in params &&
      params.failureReason === "reauthenticationRequired"
    ) {
      this.#reauthenticationObserved = true;
    }
  }

  summary(): string {
    const hints = [
      this.#lastPhase ? `lastStartupPhase=${this.#lastPhase}` : null,
      this.#mcpStatus ? `mcpStartupStatus=${this.#mcpStatus}` : null,
      this.#reauthenticationObserved
        ? "mcpReauthenticationObserved=true"
        : null,
    ].filter(Boolean);
    return hints.length ? ` Observed: ${hints.join("; ")}.` : "";
  }
}
