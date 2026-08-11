export const RUNTIME_PERMISSION_DENIED_REASON_CODE =
  "permission.denied.runtime";

export type RuntimePermissionDenialSource =
  | "claude-code"
  | "codex"
  | "opencode"
  | "openclaw"
  | "unknown";

export type RuntimePermissionDenialDetails = {
  normalizedMessage: string;
  permissionKind: string | null;
  source: RuntimePermissionDenialSource;
};

export type RuntimePermissionDenialClassification = {
  code: typeof RUNTIME_PERMISSION_DENIED_REASON_CODE;
  details: RuntimePermissionDenialDetails;
  errorType: "adapter";
  message: string;
};

const ANSI_ESCAPE_RE = new RegExp(
  `${String.fromCharCode(27)}\\[[0-?]*[ -/]*[@-~]`,
  "g"
);
const OPENCODE_PERMISSION_KIND_RE = /permission requested:\s*([a-z0-9_.:-]+)/i;
const OPENCLAW_PERMISSION_REQUIRED_RE = /\b[a-z0-9_]+_permission_required\b/;
const OPENCLAW_PERMISSION_KIND_RE = /\b([a-z0-9_]+)_permission_required\b/;
const UNSAFE_PERMISSION_KIND_CHARACTER_RE = /[^a-z0-9_.:-]+/g;
const EDGE_UNDERSCORE_RE = /^_+|_+$/g;

export function classifyRuntimePermissionDenialMessage(input: {
  message: string;
  source?: RuntimePermissionDenialSource;
}): RuntimePermissionDenialClassification | null {
  const details = readRuntimePermissionDenialDetails(input.message);
  if (!details) {
    return null;
  }

  const source = input.source ?? details.source;
  const normalizedMessage = details.normalizedMessage;
  return {
    code: RUNTIME_PERMISSION_DENIED_REASON_CODE,
    details: {
      normalizedMessage,
      permissionKind: details.permissionKind,
      source,
    },
    errorType: "adapter",
    message: `${RUNTIME_PERMISSION_DENIED_REASON_CODE}: ${normalizedMessage}`,
  };
}

export function looksLikeRuntimePermissionDenialMessage(
  value: string | null | undefined
): boolean {
  return readRuntimePermissionDenialDetails(value) !== null;
}

export function readRuntimePermissionDenialDetails(
  value: string | null | undefined
): RuntimePermissionDenialDetails | null {
  const normalizedMessage = normalizeRuntimePermissionMessage(value);
  if (!normalizedMessage) {
    return null;
  }
  const lowered = normalizedMessage.toLowerCase();

  if (isOpenCodePermissionDenial(lowered)) {
    return {
      normalizedMessage,
      permissionKind: readOpenCodePermissionKind(normalizedMessage),
      source: "opencode",
    };
  }

  if (isClaudeCodePermissionDenial(lowered)) {
    return {
      normalizedMessage,
      permissionKind: readClaudeCodePermissionKind(lowered),
      source: "claude-code",
    };
  }

  if (isCodexPermissionDenial(lowered)) {
    return {
      normalizedMessage,
      permissionKind: readCodexPermissionKind(lowered),
      source: "codex",
    };
  }

  if (isOpenClawPermissionDenial(lowered)) {
    return {
      normalizedMessage,
      permissionKind: readOpenClawPermissionKind(lowered),
      source: "openclaw",
    };
  }

  return null;
}

function normalizeRuntimePermissionMessage(
  value: string | null | undefined
): string | null {
  const normalized = String(value ?? "")
    .replace(ANSI_ESCAPE_RE, "")
    .trim();
  return normalized.length > 0 ? normalized : null;
}

function isOpenCodePermissionDenial(value: string): boolean {
  return (
    value.includes("permission requested") &&
    (value.includes("auto-reject") ||
      value.includes("auto rejecting") ||
      value.includes("auto rejected") ||
      value.includes("rejecting"))
  );
}

function isClaudeCodePermissionDenial(value: string): boolean {
  return (
    value.includes("permission for this tool use was denied") ||
    value.includes("permission for this action was denied") ||
    value.includes("permission for this action has been denied") ||
    value.includes("denied by auto mode classifier") ||
    value.includes("user rejected tool use") ||
    (value.includes("permission request") &&
      value.includes("not answered in time"))
  );
}

function isCodexPermissionDenial(value: string): boolean {
  return (
    value.includes("command denied by sandbox:") ||
    value.includes("sandbox denied exec error") ||
    value.includes("this action was rejected due to unacceptable risk") ||
    (value.includes("execution denied:") &&
      (value.includes("policy") ||
        value.includes("forbidden") ||
        value.includes("approval") ||
        value.includes("sandbox"))) ||
    (value.includes("rejected:") && value.includes("blocked by policy")) ||
    (value.includes("requires approval") && value.includes("policy")) ||
    value.includes("policy forbids commands starting")
  );
}

function isOpenClawPermissionDenial(value: string): boolean {
  return (
    value.includes("system_run_denied:") ||
    value.includes("system_run_disabled: security=deny") ||
    value.includes("exec denied:") ||
    value.includes("exec.denied") ||
    value.includes("permission:screenrecording") ||
    OPENCLAW_PERMISSION_REQUIRED_RE.test(value)
  );
}

function readOpenCodePermissionKind(value: string): string | null {
  const match = OPENCODE_PERMISSION_KIND_RE.exec(value);
  return normalizePermissionKind(match?.[1]);
}

function readClaudeCodePermissionKind(value: string): string | null {
  if (value.includes("tool use")) {
    return "tool_use";
  }
  if (value.includes("url")) {
    return "url_access";
  }
  if (value.includes("auto mode classifier")) {
    return "auto_mode";
  }
  return null;
}

function readCodexPermissionKind(value: string): string | null {
  if (value.includes("sandbox")) {
    return "sandbox";
  }
  if (value.includes("approval")) {
    return "approval";
  }
  if (value.includes("policy")) {
    return "policy";
  }
  return null;
}

function readOpenClawPermissionKind(value: string): string | null {
  if (value.includes("system_run")) {
    return "system_run";
  }
  if (value.includes("exec denied") || value.includes("exec.denied")) {
    return "exec";
  }
  if (value.includes("permission:screenrecording")) {
    return "screen_recording";
  }
  const match = OPENCLAW_PERMISSION_KIND_RE.exec(value);
  return normalizePermissionKind(match?.[1]);
}

function normalizePermissionKind(
  value: string | null | undefined
): string | null {
  const normalized = String(value ?? "")
    .trim()
    .toLowerCase()
    .replace(UNSAFE_PERMISSION_KIND_CHARACTER_RE, "_")
    .replace(EDGE_UNDERSCORE_RE, "");
  return normalized.length > 0 ? normalized : null;
}
