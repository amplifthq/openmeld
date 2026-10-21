import { formatOpenMeldCliTextBlock } from "./cli-entry-command";
import type { ResolvedCliView } from "./types";

type MessageResolver = (params?: Record<string, unknown>) => string;

type Catalog = Record<string, MessageResolver>;

const SENTENCE_END_PATTERN = /[.!?]$/u;

// Keep literal keys for strict MessageKey derivation used by override validation.
const HUMAN_MESSAGES = {
  "whoami.loaded": (params) =>
    `Profile loaded (profile: ${String(params?.profile ?? "unknown")}).`,
  "space.menu.interactive_required": () =>
    "This menu only works in an interactive terminal. Run `openmeld space --help`.",
  "space.target.missing": (params) =>
    `Add a Space ID after \`openmeld space ${String(params?.command ?? "join")}\`, then try again.`,
  "space.target.invalid": (_params) =>
    "That Space ID isn't valid. Copy the full Space ID, then try again.",
  "signal.id.invalid": (params) =>
    `That ${String(params?.flag ?? "signal")} ID is incomplete. Copy the full signal ID from \`openmeld space history --view agent\`, then try again.`,
  "space.create.created": (params) =>
    `Space created: ${String(params?.spaceId ?? "unknown")}`,
  "space.join.stdin_fallback_watch": (params) =>
    formatJoinNoStdioMessage("human", params),
  "space.join.bootstrap_context": (params) =>
    formatJoinBootstrapContextMessage("human", params),
  "space.guide.current": (params) =>
    `Space guide for ${String(params?.spaceId ?? "unknown")}:`,
  "space.guide.empty": () => "(empty)",
  "space.guide.updated": (params) =>
    `Space guide updated for ${String(params?.spaceId ?? "unknown")}.`,
  "space.password.updated": (params) =>
    `Space password updated for ${String(params?.spaceId ?? "unknown")}.`,
  "space.password.cleared": (params) =>
    `Space password cleared for ${String(params?.spaceId ?? "unknown")}.`,
  "space.password.warning": () =>
    "Important: Save this password securely. If lost, it cannot be recovered. Reset is the only option.",
  "profile.menu.interactive_required": () =>
    "This menu only works in an interactive terminal. Run `openmeld profiles --help`.",
  "profile.no_profiles": () =>
    "No OpenMeld profiles found. Sign in with `openmeld login` or create one with `openmeld profiles create`.",
  "profile.target.missing": (params) =>
    `Add a profile ID after \`openmeld profiles ${String(params?.action ?? "set")}\`, then try again.`,
  "profile.delete.force_required": () =>
    "Add `--force` to delete a profile from a non-interactive terminal.",
  "profile.current_set": (params) =>
    `Current profile: ${String(params?.profile ?? "unknown")}. New OpenMeld commands will use this profile by default unless you pass \`--profile\`.`,
  "profile.selection.non_persistent": () =>
    "Warning: this temporary OpenMeld CLI context only uses the selected profile for this command.",
  "profile.deleted": (params) =>
    `Deleted profile: ${String(params?.profile ?? "unknown")}.`,
  "profile.current_switched": (params) =>
    `Current profile switched to: ${String(params?.profile ?? "unknown")}.`,
  "profile.no_active": () => "No OpenMeld profile is currently selected.",
  "profile.update.missing_changes": () =>
    "Choose at least one profile setting to update. Run `openmeld profile update --help` to see the options.",
  "profile.update.candidates_required": () =>
    "Choose a profile first. Available profiles are listed above.",
  "routines.error": (params) =>
    String(params?.message ?? "Routine action couldn't finish."),
  "member_agents.error": (params) =>
    String(params?.message ?? "Agent command couldn't finish."),
  "doctor.summary.failed": () => "OpenMeld diagnostics found issues.",
  "send.sent": () => "Sent.",
  "tail.empty": () => "(no signals yet)",
  "space.updates.empty": () => "(no updates found after this signal)",
  "init.profile_initialized": (params) =>
    `Profile initialized: ${String(params?.profile ?? "unknown")}.`,
  "connect.connecting": (params) =>
    `Connecting to ${String(params?.wsUrl ?? "")}`,
  "connect.warn.persist_last_seen": (_params) =>
    "OpenMeld couldn't save where you left off. Live updates will continue.",
  "connect.warn.persist_recent_mentions": (_params) =>
    "OpenMeld couldn't save your recent @ mentions. Live updates will continue.",
  "connect.warn.cursor_fetch_failed": (_params) =>
    "OpenMeld couldn't load where you left off. Live updates will continue.",
  "connect.warn.cursor_patch_failed": (_params) =>
    "OpenMeld couldn't save your new place. Live updates will continue.",
  "connect.warn.catchup_failed": (_params) =>
    "OpenMeld couldn't load every recent message. Live updates will continue.",
  "connect.warn.catchup_live_buffer_overflow": (_params) =>
    "OpenMeld couldn't load every recent message. Live updates will continue, but your place won't be saved in this session.",
  "connect.warn.cursor_sync_paused": () =>
    "Live updates will continue, but OpenMeld won't save your place in this session.",
  "connect.warn.meta_fetch_failed": (_params) =>
    "OpenMeld couldn't load this Space's details.",
  "connect.warn.members_fetch_failed": (_params) =>
    "OpenMeld couldn't load this Space's members.",
  "connect.warn.profile_space_history_sync_failed": (_params) =>
    "OpenMeld couldn't save this Space to your recent history.",
  "connect.closed": () => "Connection closed.",
  "connect.closed_with_code_reason": (params) =>
    `The connection closed.${formatHumanHintSentence(params?.hint)}`,
  "connect.error": (params) => formatHumanConnectError(params),
  "connect.error.space_not_found": (_params) =>
    `OpenMeld couldn't find that Space. Check the Space ID, then try again.`,
  "connect.closing": (params) =>
    `Closing the connection (${String(params?.why ?? "")})...`,
  "connect.watch_ready": () => "Watching the stream. Press Ctrl+C to quit.",
  "connect.reconnecting": (params) =>
    `The connection dropped. Reconnecting (attempt ${String(params?.attempt ?? "")}/5)…`,
  "connect.reconnected": () => "Reconnected. Missed messages are now loaded.",
  "connect.connected_no_stdio": (params) =>
    formatConnectedNoStdioMessage("human", params),
  "connect.chat_mention_hint": () =>
    "Press @ to insert an Agent Wake, Agent Reference, or Human Mention.",
  "connect.chat_ready": () => "Type your message and press Enter to send.",
  "connect.chat_exit_hint": () => "Exit with '/quit', ':q', Ctrl+D, or Ctrl+C.",
  "connect.chat_prompt_question": () =>
    "What would you like to say in this space?",
  "connect.connected_stdio": () =>
    'Connected in `--stdio` mode. Type a line and press Enter. Use Ctrl+D, Ctrl+C, "/quit", or ":q" to exit.',
  "connect.reject": (params) =>
    `Rejected: ${String(params?.reason ?? "unknown")}`,
  "connect.space_guide": (params) =>
    `Space guide (${String(params?.spaceId ?? "unknown")}):`,
} as const satisfies Catalog;

const AGENT_MESSAGES = {
  "whoami.loaded": (params) =>
    `whoami loaded for profile ${String(params?.profile ?? "unknown")}`,
  "space.menu.interactive_required": () =>
    "interactive menu is disabled in agent view; use explicit command arguments",
  "space.target.missing": (params) =>
    `missing required 'space' argument for \`openmeld space ${String(params?.command ?? "join")}\``,
  "space.target.invalid": (params) =>
    `invalid space target: ${String(params?.space ?? "unknown")} (must be a 64-character hex ID)`,
  "signal.id.invalid": (params) =>
    `invalid ${String(params?.flag ?? "signal")} value: ${String(params?.value ?? "unknown")} (must be a full 36-character UUID signal ID, not a short prefix; read signalId from \`openmeld space history --view agent\`)`,
  "space.create.created": (params) =>
    `Space created: ${String(params?.spaceId ?? "unknown")}`,
  "space.join.stdin_fallback_watch": (params) =>
    formatJoinNoStdioMessage("agent", params),
  "space.join.bootstrap_context": (params) =>
    formatJoinBootstrapContextMessage("agent", params),
  "space.guide.current": (params) =>
    `space guide for ${String(params?.spaceId ?? "unknown")}:`,
  "space.guide.empty": () => "space guide is empty",
  "space.guide.updated": (params) =>
    `space guide updated for ${String(params?.spaceId ?? "unknown")}`,
  "space.password.updated": (params) =>
    `space password set for ${String(params?.spaceId ?? "unknown")}`,
  "space.password.cleared": (params) =>
    `space password cleared for ${String(params?.spaceId ?? "unknown")}`,
  "space.password.warning": () =>
    "Important: Save this password securely. If lost, it cannot be recovered. Reset is the only option.",
  "profile.menu.interactive_required": () =>
    "interactive profile menu is disabled in agent view; use `openmeld profiles list`, `set`, `update`, or `delete` with explicit arguments",
  "profile.no_profiles": () =>
    "no OpenMeld profiles found for this account; run `openmeld login` or `openmeld profiles create`",
  "profile.target.missing": (params) =>
    `missing required 'profile' argument for \`openmeld profiles ${String(params?.action ?? "set")}\``,
  "profile.delete.force_required": () =>
    "profile delete requires `--force` in non-interactive mode",
  "profile.current_set": (params) =>
    `profile selected: ${String(params?.profile ?? "unknown")} (subsequent OpenMeld commands use it by default unless --profile is provided)`,
  "profile.selection.non_persistent": () =>
    "non-persistent OpenMeld CLI context; the selected OpenMeld profile applies only to this process",
  "profile.deleted": (params) =>
    `profile deleted: ${String(params?.profile ?? "unknown")}`,
  "profile.current_switched": (params) =>
    `selected profile switched to ${String(params?.profile ?? "unknown")}`,
  "profile.no_active": () => "no active OpenMeld profile selected",
  "profile.update.missing_changes": () =>
    "`openmeld profile update` requires at least one update option",
  "profile.update.candidates_required": () =>
    "profile update requires explicit profile argument; candidates listed above",
  "routines.error": (params) =>
    String(params?.message ?? "Routine command failed."),
  "member_agents.error": (params) =>
    String(params?.message ?? "member agent command failed"),
  "doctor.summary.failed": () => "diagnostics found issues",
  "send.sent": () => "signal sent",
  "tail.empty": () => "no signals found",
  "space.updates.empty": () => "no updates found after this signal",
  "init.profile_initialized": (params) =>
    `profile initialized: ${String(params?.profile ?? "unknown")}`,
  "connect.connecting": (params) =>
    `connecting to ${String(params?.wsUrl ?? "")}`,
  "connect.warn.persist_last_seen": (params) =>
    `warning: couldn't save where you left off in this space: ${String(params?.error ?? "unknown")}`,
  "connect.warn.persist_recent_mentions": (params) =>
    `warning: couldn't save recent @ targets for this space: ${String(params?.error ?? "unknown")}`,
  "connect.warn.cursor_fetch_failed": (params) =>
    `warning: couldn't load current place in this space: ${String(params?.error ?? "unknown")}`,
  "connect.warn.cursor_patch_failed": (params) =>
    `warning: couldn't update current place in this space: ${String(params?.error ?? "unknown")}`,
  "connect.warn.catchup_failed": (params) =>
    `warning: couldn't catch up to recent messages: ${String(params?.error ?? "unknown")}`,
  "connect.warn.catchup_live_buffer_overflow": (_params) =>
    "warning: catch-up could not finish; continuing live updates without saving your place for this session",
  "connect.warn.cursor_sync_paused": () =>
    "warning: continuing live updates without saving your place for this session",
  "connect.warn.meta_fetch_failed": (params) =>
    `warning: couldn't load space details: ${String(params?.error ?? "unknown")}`,
  "connect.warn.members_fetch_failed": (params) =>
    `warning: couldn't load space members: ${String(params?.error ?? "unknown")}`,
  "connect.warn.profile_space_history_sync_failed": (params) =>
    `warning: couldn't update recent space history: ${String(params?.error ?? "unknown")}`,
  "connect.closed": () => "connection closed",
  "connect.closed_with_code_reason": (params) =>
    `connection closed code=${String(params?.code ?? "")}${formatCodeLabelSuffix(params?.codeLabel)} reason=${String(params?.reason ?? "")}${formatHintSuffix(params?.hint)}`,
  "connect.error": (params) =>
    `connection error: ${String(params?.error ?? "unknown")}${formatHintSuffix(params?.hint)}`,
  "connect.error.space_not_found": (params) =>
    `space not found: ${String(params?.space ?? "unknown")} (join supports existing spaces only; create first via \`openmeld space create --name <name> --visibility private\`)`,
  "connect.closing": (params) =>
    `closing connection (${String(params?.why ?? "")})`,
  "connect.watch_ready": () => "watch mode active; Ctrl+C to quit",
  "connect.reconnecting": (params) =>
    `space watch reconnecting attempt=${String(params?.attempt ?? "")}/5; no messages or tasks are resent`,
  "connect.reconnected": () =>
    "space watch reconnected; message-anchor catch-up complete",
  "connect.connected_no_stdio": (params) =>
    formatConnectedNoStdioMessage("agent", params),
  "connect.chat_mention_hint": () =>
    "choose a member with @ in the interactive picker, or use space send --wake, --reference, or --mention with a full Profile ID; typed text is literal",
  "connect.chat_ready": () => "chat mode active; type a line to send",
  "connect.chat_exit_hint": () =>
    "enter sends; line ending with \\ continues draft; exit with /quit, :q, Ctrl+D, or Ctrl+C",
  "connect.chat_prompt_question": () => "what would you like to say?",
  "connect.connected_stdio": () => "connected in stdio mode",
  "connect.reject": (params) =>
    `input rejected: ${String(params?.reason ?? "unknown")}`,
  "connect.space_guide": (params) =>
    `space guide (${String(params?.spaceId ?? "unknown")}):`,
} as const satisfies Record<MessageKey, MessageResolver>;

export type MessageKey = keyof typeof HUMAN_MESSAGES;

export function formatMessage(
  view: ResolvedCliView,
  key: MessageKey,
  params?: Record<string, unknown>,
  overrides?: Record<string, string>
): string {
  const override = overrides?.[key];
  if (typeof override === "string" && override.length > 0) {
    return formatOpenMeldCliTextBlock(applyTemplate(override, params));
  }

  const catalog = view === "agent" ? AGENT_MESSAGES : HUMAN_MESSAGES;
  const resolver = catalog[key];
  if (!resolver) {
    return key;
  }
  return formatOpenMeldCliTextBlock(resolver(params));
}

function applyTemplate(
  template: string,
  params?: Record<string, unknown>
): string {
  if (!params) {
    return template;
  }

  return template.replace(/\{\{\s*([\w.-]+)\s*\}\}/g, (_all, name) => {
    const value = params[name];
    return value === undefined || value === null ? "" : String(value);
  });
}

function formatCodeLabelSuffix(codeLabel: unknown): string {
  if (typeof codeLabel !== "string") {
    return "";
  }
  const normalized = codeLabel.trim();
  if (normalized.length === 0) {
    return "";
  }
  return ` (${normalized})`;
}

function formatJoinNoStdioMessage(
  view: ResolvedCliView,
  params?: Record<string, unknown>
): string {
  const sendCommandHint = formatSendCommandHint(params);
  if (view === "agent") {
    return `stdin unavailable; continuing as a stream-only join (no inline stdin input)${sendCommandHint}`;
  }
  return `stdin is not interactive; continuing as a stream-only join (no inline stdin input)${sendCommandHint}`;
}

function formatConnectedNoStdioMessage(
  view: ResolvedCliView,
  params?: Record<string, unknown>
): string {
  if (resolveConnectionMode(params) !== "join") {
    return view === "agent"
      ? "watch mode active; Ctrl+C to quit"
      : "watching stream. Press Ctrl+C to quit.";
  }

  const sendCommand = resolveSendCommand(params);
  if (view === "agent") {
    return `joined in stream-only mode; use ${sendCommand} to send messages`;
  }
  return `joined in stream-only mode (no inline stdin input). Use ${sendCommand} to send messages. Press Ctrl+C to quit.`;
}

function formatSendCommandHint(params?: Record<string, unknown>): string {
  if (resolveConnectionMode(params) !== "join") {
    return "";
  }
  return `; send messages with ${resolveSendCommand(params)}`;
}

function resolveConnectionMode(
  params?: Record<string, unknown>
): "join" | "watch" {
  const normalized = String(params?.connectionMode ?? "")
    .trim()
    .toLowerCase();
  return normalized === "join" ? "join" : "watch";
}

function resolveSendCommand(params?: Record<string, unknown>): string {
  const explicitCommand = String(params?.sendCommand ?? "").trim();
  if (explicitCommand.length > 0) {
    return `\`${explicitCommand}\``;
  }
  return "`openmeld space send --profile <profile-id> <space-id> <text...>`";
}

function formatJoinBootstrapContextMessage(
  view: ResolvedCliView,
  params?: Record<string, unknown>
): string {
  const parts: string[] = [];
  const role = normalizeMessageValue(params?.role);
  const mentionAlias = normalizeMessageValue(params?.mentionAlias);
  const roleSource = resolveJoinBootstrapSourceLabel(
    params?.roleSource,
    view === "human"
  );
  const mentionAliasSource = resolveJoinBootstrapSourceLabel(
    params?.mentionAliasSource,
    view === "human"
  );

  if (role) {
    parts.push(`role "${role}" (${roleSource})`);
  }
  if (mentionAlias) {
    parts.push(`mention alias @${mentionAlias} (${mentionAliasSource})`);
  }

  if (parts.length === 0) {
    return view === "agent"
      ? "join bootstrap context resolved"
      : "Join bootstrap context resolved.";
  }

  const prefix =
    view === "agent" ? "join bootstrap context:" : "Join context loaded:";
  return `${prefix} ${parts.join("; ")}`;
}

function resolveJoinBootstrapSourceLabel(
  value: unknown,
  humanFriendly: boolean
): string {
  const normalized = String(value ?? "")
    .trim()
    .toLowerCase();
  if (normalized === "explicit") {
    return "explicit";
  }
  if (normalized === "cloud" || normalized === "local") {
    return humanFriendly ? "saved" : normalized;
  }
  return humanFriendly ? "unset" : "none";
}

function normalizeMessageValue(value: unknown): string | null {
  if (typeof value !== "string") {
    return null;
  }
  const normalized = value.trim();
  return normalized.length > 0 ? normalized : null;
}

function formatHintSuffix(hint: unknown): string {
  if (typeof hint !== "string") {
    return "";
  }
  const normalized = hint.trim();
  if (normalized.length === 0) {
    return "";
  }
  return ` (hint: ${normalized})`;
}

function formatHumanConnectError(
  params: Record<string, unknown> | undefined
): string {
  const error = String(params?.error ?? "").toLowerCase();
  let summary = "OpenMeld lost the connection.";
  if (error.includes("last message may not have been confirmed")) {
    summary = "OpenMeld lost the connection before confirming your message.";
  } else if (error.includes("couldn't send the message")) {
    summary = "OpenMeld couldn't send your message.";
  }
  return `${summary}${formatHumanHintSentence(params?.hint)}`;
}

function formatHumanHintSentence(hint: unknown): string {
  if (typeof hint !== "string") {
    return "";
  }
  const normalized = hint.trim();
  if (!normalized) {
    return "";
  }
  const sentence = `${normalized.slice(0, 1).toUpperCase()}${normalized.slice(1)}`;
  return ` ${SENTENCE_END_PATTERN.test(sentence) ? sentence : `${sentence}.`}`;
}
