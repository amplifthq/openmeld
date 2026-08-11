import {
  CONVERSATION_CONTINUITY_WARNING_PURPOSE,
  SPACE_MENTION_REJECT_NOTICE_PURPOSE,
} from "@openmeld/schemas";

const LEGACY_SYSTEM_PREFIX_PATTERN = /^\* 📣 system:\s*/u;

const IMPORTANT_SYSTEM_NOTICE_PURPOSES = new Set<string>([
  CONVERSATION_CONTINUITY_WARNING_PURPOSE,
  SPACE_MENTION_REJECT_NOTICE_PURPOSE,
]);

const IMPORTANT_SYSTEM_NOTICE_TEXT_PATTERNS = [
  "not confirmed",
  "connection closed",
  "connection dropped",
  "policy violation",
  "permission",
  "unauthorized",
  "forbidden",
  "rejected",
  "denied",
  "internal error",
  "service is busy",
  "tls handshake",
  "password required",
  "password invalid",
  "password too short",
  "space not found",
  "space is not available",
  "space is unavailable",
  "couldn't connect",
  "could not connect",
  "cannot connect",
  "failed to connect",
] as const;

export function stripLegacySystemPrefix(line: string): string {
  return line.replace(LEGACY_SYSTEM_PREFIX_PATTERN, "").trim();
}

export function isConnectedAsLegacySystemLine(line: string): boolean {
  return stripLegacySystemPrefix(line)
    .toLowerCase()
    .startsWith("connected as ");
}

export function isImportantHumanSystemNotice(input: {
  line: string;
  purpose?: string | null;
}): boolean {
  const purpose = String(input.purpose ?? "").trim();
  if (
    purpose === "signal.system_notice" ||
    purpose.startsWith("signal.system_notice:")
  ) {
    return true;
  }
  if (purpose && IMPORTANT_SYSTEM_NOTICE_PURPOSES.has(purpose)) {
    return true;
  }
  return isImportantHumanSystemNoticeLine(input.line);
}

function isImportantHumanSystemNoticeLine(line: string): boolean {
  const normalized = stripLegacySystemPrefix(line).toLowerCase();
  if (!normalized) {
    return false;
  }
  if (isConnectedAsLegacySystemLine(line)) {
    return false;
  }
  return IMPORTANT_SYSTEM_NOTICE_TEXT_PATTERNS.some((pattern) =>
    normalized.includes(pattern)
  );
}
