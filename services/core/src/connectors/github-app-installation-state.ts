import {
  beginGitHubAppInstallationVerificationRecord,
  completeGitHubAppInstallationRecord,
  consumeExpiredGitHubAppInstallationState,
  deleteExpiredGitHubAppInstallationStates,
  readPendingGitHubAppInstallationRecord,
  replaceGitHubAppInstallationState,
} from "./github-app-installation-state-repository";

export const GITHUB_APP_INSTALLATION_STATE_TTL_MS = 10 * 60 * 1000;

const STATE_BYTE_LENGTH = 32;
const STATE_PREFIX = "githubapp_";
const STATE_PATTERN = /^githubapp_[0-9a-f]{64}$/u;
const INSTALLATION_ID_PATTERN = /^[1-9][0-9]*$/u;
const CONNECTION_NAME_PATTERN = /^[A-Za-z0-9][A-Za-z0-9_-]{0,63}$/u;

export type GitHubAppInstallationVerificationResult =
  | {
      actorProfileId: string;
      installationId: string;
      organizationId: string;
      status: "valid";
      targetConnectionName: string;
      userId: string;
      verificationConnectionName: string;
    }
  | { status: "expired" | "invalid" };

export type PendingGitHubAppInstallation = {
  installationId: string;
  organizationId: string;
  status: "verifying";
  targetConnectionName: string;
  userId: string;
  verificationConnectionName: string;
};

export async function createGitHubAppInstallationState(input: {
  actorProfileId: string;
  db: D1Database;
  nowMs: number;
  organizationId: string;
  targetConnectionName: string;
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
  const targetConnectionName = requireConnectionName(
    input.targetConnectionName,
    "target connection name"
  );
  const userId = requireNonEmptyText(input.userId, "user id");
  const state = createOpaqueState();
  const stateDigest = await digestState(state);
  const expiresAtMs = input.nowMs + GITHUB_APP_INSTALLATION_STATE_TTL_MS;

  await deleteExpiredGitHubAppInstallationStates({
    db: input.db,
    nowMs: input.nowMs,
  });
  await replaceGitHubAppInstallationState({
    db: input.db,
    record: {
      actorProfileId,
      createdAtMs: input.nowMs,
      expiresAtMs,
      installationId: null,
      organizationId,
      stateDigest,
      status: "installing",
      targetConnectionName,
      updatedAtMs: input.nowMs,
      userId,
      verificationConnectionName: null,
    },
  });
  return { expiresAtMs, state };
}

export async function beginGitHubAppInstallationVerification(input: {
  db: D1Database;
  installationId: string;
  nowMs: number;
  state: string;
}): Promise<GitHubAppInstallationVerificationResult> {
  if (!STATE_PATTERN.test(input.state)) {
    return { status: "invalid" };
  }
  const installationId = input.installationId.trim();
  if (!INSTALLATION_ID_PATTERN.test(installationId)) {
    return { status: "invalid" };
  }
  const stateDigest = await digestState(input.state);
  const record = await beginGitHubAppInstallationVerificationRecord({
    db: input.db,
    installationId,
    nowMs: input.nowMs,
    stateDigest,
    verificationConnectionName: createVerificationConnectionName(stateDigest),
  });
  if (!record) {
    const expired = await consumeExpiredGitHubAppInstallationState({
      db: input.db,
      nowMs: input.nowMs,
      stateDigest,
    });
    return { status: expired ? "expired" : "invalid" };
  }
  if (!(record.installationId && record.verificationConnectionName)) {
    throw new Error(
      "GitHub App installation verification state is incomplete after transition"
    );
  }
  return {
    actorProfileId: record.actorProfileId,
    installationId: record.installationId,
    organizationId: record.organizationId,
    status: "valid",
    targetConnectionName: record.targetConnectionName,
    userId: record.userId,
    verificationConnectionName: record.verificationConnectionName,
  };
}

export async function readPendingGitHubAppInstallation(input: {
  db: D1Database;
  nowMs: number;
  organizationId: string;
  userId: string;
}): Promise<PendingGitHubAppInstallation | null> {
  const record = await readPendingGitHubAppInstallationRecord({
    db: input.db,
    nowMs: input.nowMs,
    organizationId: requireNonEmptyText(
      input.organizationId,
      "organization id"
    ),
    userId: requireNonEmptyText(input.userId, "user id"),
  });
  if (!record) {
    return null;
  }
  if (!(record.installationId && record.verificationConnectionName)) {
    throw new Error("Pending GitHub App installation state is incomplete");
  }
  return {
    installationId: record.installationId,
    organizationId: record.organizationId,
    status: "verifying",
    targetConnectionName: record.targetConnectionName,
    userId: record.userId,
    verificationConnectionName: record.verificationConnectionName,
  };
}

export async function completeGitHubAppInstallation(input: {
  db: D1Database;
  installationId: string;
  nowMs: number;
  organizationId: string;
  targetConnectionName: string;
  userId: string;
  verificationConnectionName: string;
}): Promise<boolean> {
  return await completeGitHubAppInstallationRecord({
    db: input.db,
    installationId: requireInstallationId(input.installationId),
    nowMs: input.nowMs,
    organizationId: requireNonEmptyText(
      input.organizationId,
      "organization id"
    ),
    targetConnectionName: requireConnectionName(
      input.targetConnectionName,
      "target connection name"
    ),
    userId: requireNonEmptyText(input.userId, "user id"),
    verificationConnectionName: requireConnectionName(
      input.verificationConnectionName,
      "verification connection name"
    ),
  });
}

function createOpaqueState(): string {
  const bytes = new Uint8Array(STATE_BYTE_LENGTH);
  crypto.getRandomValues(bytes);
  return `${STATE_PREFIX}${toHex(bytes)}`;
}

async function digestState(state: string): Promise<string> {
  const digest = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(state)
  );
  return `sha256:${toHex(new Uint8Array(digest))}`;
}

function createVerificationConnectionName(stateDigest: string): string {
  return `github_verify_${stateDigest.slice("sha256:".length, "sha256:".length + 24)}`;
}

function toHex(bytes: Uint8Array): string {
  return Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join(
    ""
  );
}

function requireNonEmptyText(value: string, fieldName: string): string {
  const normalized = value.trim();
  if (!normalized) {
    throw new Error(`GitHub App installation ${fieldName} is required`);
  }
  return normalized;
}

function requireConnectionName(value: string, fieldName: string): string {
  const normalized = value.trim();
  if (!CONNECTION_NAME_PATTERN.test(normalized)) {
    throw new Error(`GitHub App installation ${fieldName} is invalid`);
  }
  return normalized;
}

function requireInstallationId(value: string): string {
  const normalized = value.trim();
  if (!INSTALLATION_ID_PATTERN.test(normalized)) {
    throw new Error("GitHub App installation id is invalid");
  }
  return normalized;
}
