import {
  consumeSlackOAuthStateRecord,
  deleteExpiredSlackOAuthStateRecords,
  insertSlackOAuthState,
} from "../infrastructure/d1/slack-oauth-state-repo";

export const SLACK_OAUTH_STATE_TTL_MS = 10 * 60 * 1000;

const SLACK_OAUTH_STATE_BYTE_LENGTH = 32;
const SLACK_OAUTH_STATE_PREFIX = "slackoauth_";
const SLACK_IDENTITY_STATE_PREFIX = "slackidentity_";
const SLACK_OAUTH_STATE_PATTERN = /^slack(?:oauth|identity)_[0-9a-f]{64}$/u;

export type ConsumedSlackOAuthState =
  | {
      actorProfileId: string;
      moveFromOrganizationId: string | null;
      organizationId: string;
      purpose: "member_identity" | "organization_install";
      returnPath: string;
      status: "valid";
      userId: string;
    }
  | { returnPath: string; status: "expired" }
  | { status: "invalid" };

export function buildSlackOAuthChannelsReturnPath(
  organizationSlug: string
): string {
  const slug = requireNonEmptyText(organizationSlug, "organization slug");
  return `/o/${encodeURIComponent(slug)}/center-agent/channels`;
}

export function buildSlackOAuthPeopleReturnPath(
  organizationSlug: string
): string {
  const slug = requireNonEmptyText(organizationSlug, "organization slug");
  return `/o/${encodeURIComponent(slug)}/people`;
}

export async function createSlackOAuthState(input: {
  actorProfileId: string;
  db: D1Database;
  moveFromOrganizationId?: string | null;
  nowMs: number;
  organizationId: string;
  purpose?: "member_identity" | "organization_install";
  returnPath: string;
  userId: string;
}): Promise<{ expiresAtMs: number; state: string }> {
  const actorProfileId = requireNonEmptyText(
    input.actorProfileId,
    "actor profile id"
  );
  const organizationId = requireNonEmptyText(
    input.organizationId,
    "organization id"
  );
  const moveFromOrganizationId = normalizeOptionalText(
    input.moveFromOrganizationId
  );
  const returnPath = requireReturnPath(input.returnPath);
  const userId = requireNonEmptyText(input.userId, "user id");
  const purpose = input.purpose ?? "organization_install";
  const state = createOpaqueSlackOAuthState(purpose);
  const stateDigest = await digestSlackOAuthState(state);
  const expiresAtMs = input.nowMs + SLACK_OAUTH_STATE_TTL_MS;

  await deleteExpiredSlackOAuthStateRecords({
    db: input.db,
    nowMs: input.nowMs,
  });
  await insertSlackOAuthState({
    db: input.db,
    record: {
      actorProfileId,
      createdAtMs: input.nowMs,
      expiresAtMs,
      moveFromOrganizationId,
      organizationId,
      returnPath,
      stateDigest,
      userId,
    },
  });

  return { expiresAtMs, state };
}

export async function consumeSlackOAuthState(input: {
  db: D1Database;
  nowMs: number;
  state: string;
}): Promise<ConsumedSlackOAuthState> {
  if (!SLACK_OAUTH_STATE_PATTERN.test(input.state)) {
    return { status: "invalid" };
  }
  const record = await consumeSlackOAuthStateRecord({
    db: input.db,
    stateDigest: await digestSlackOAuthState(input.state),
  });
  if (!record) {
    return { status: "invalid" };
  }
  if (input.nowMs >= record.expiresAtMs) {
    return { returnPath: record.returnPath, status: "expired" };
  }
  return {
    actorProfileId: record.actorProfileId,
    moveFromOrganizationId: record.moveFromOrganizationId,
    organizationId: record.organizationId,
    purpose: resolveSlackOAuthPurpose(input.state),
    returnPath: record.returnPath,
    status: "valid",
    userId: record.userId,
  };
}

function createOpaqueSlackOAuthState(
  purpose: "member_identity" | "organization_install"
): string {
  const bytes = new Uint8Array(SLACK_OAUTH_STATE_BYTE_LENGTH);
  crypto.getRandomValues(bytes);
  const prefix =
    purpose === "member_identity"
      ? SLACK_IDENTITY_STATE_PREFIX
      : SLACK_OAUTH_STATE_PREFIX;
  return `${prefix}${toHex(bytes)}`;
}

function resolveSlackOAuthPurpose(
  state: string
): "member_identity" | "organization_install" {
  return state.startsWith(SLACK_IDENTITY_STATE_PREFIX)
    ? "member_identity"
    : "organization_install";
}

async function digestSlackOAuthState(state: string): Promise<string> {
  const digest = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(state)
  );
  return `sha256:${toHex(new Uint8Array(digest))}`;
}

function toHex(bytes: Uint8Array): string {
  return Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join(
    ""
  );
}

function requireNonEmptyText(value: string, fieldName: string): string {
  const normalized = value.trim();
  if (!normalized) {
    throw new Error(`Slack OAuth ${fieldName} is required`);
  }
  return normalized;
}

function normalizeOptionalText(
  value: string | null | undefined
): string | null {
  const normalized = value?.trim() ?? "";
  return normalized.length > 0 ? normalized : null;
}

function requireReturnPath(value: string): string {
  const normalized = value.trim();
  if (!normalized.startsWith("/")) {
    throw new Error("Slack OAuth return path must be relative");
  }
  return normalized;
}
