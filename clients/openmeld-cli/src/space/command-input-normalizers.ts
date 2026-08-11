import { sanitizeTerminalDisplayText } from "../ui/terminal-safe-text";

export const SPACE_ID_HEX_REGEX = /^[0-9a-f]{64}$/i;
export const sanitizeSingleLinePromptText = (
  value: string | number | null | undefined
): string => sanitizeTerminalDisplayText(value, "single-line").trim();
export const MENTION_ALIAS_TOKEN_REGEX = /^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/;
export const MENTION_ALIAS_MAX_LENGTH = 128;
export const TRAILING_SLASHES_RE = /\/+$/u;

export function resolveGatewayHost(baseUrl: string | undefined): string | null {
  if (typeof baseUrl !== "string" || baseUrl.trim().length === 0) {
    return null;
  }
  try {
    return new URL(baseUrl).host.toLowerCase();
  } catch {
    return null;
  }
}

export function normalizeDisplayValue(
  value: unknown,
  fallback = "unknown"
): string {
  const normalized = sanitizeSingleLinePromptText(String(value ?? ""));
  return normalized.length > 0 ? normalized : fallback;
}

export function shortenSpaceId(spaceId: string): string {
  const normalized = sanitizeSingleLinePromptText(spaceId);
  if (normalized.length <= 14) {
    return normalized;
  }
  return `${normalized.slice(0, 8)}...${normalized.slice(-6)}`;
}

export function isValidSpaceId(space: string): boolean {
  // Contract lock: space command targets are canonical spaceId only (64-char hex),
  // never space name.
  const normalized = space.trim();
  return SPACE_ID_HEX_REGEX.test(normalized);
}

export function isInputClosed(stream: NodeJS.ReadStream): boolean {
  return stream.destroyed || stream.readableEnded;
}

export function normalizeGuideInput(
  value: string | undefined
): string | undefined {
  if (value === undefined) {
    return undefined;
  }
  const normalized = value.trim();
  return normalized.length > 0 ? normalized : undefined;
}

export function normalizeMentionAliasInput(value: unknown): string | undefined {
  if (typeof value !== "string") {
    return undefined;
  }
  const normalized = value.trim();
  if (
    normalized.length === 0 ||
    normalized.length > MENTION_ALIAS_MAX_LENGTH ||
    !MENTION_ALIAS_TOKEN_REGEX.test(normalized)
  ) {
    return undefined;
  }
  return normalized;
}

export function normalizeRoleInput(
  value: string | undefined
): string | undefined {
  const normalized = String(value ?? "").trim();
  if (!normalized) {
    return undefined;
  }
  return normalized;
}
