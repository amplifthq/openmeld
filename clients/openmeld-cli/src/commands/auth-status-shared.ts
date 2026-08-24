import {
  type AuthenticationGuidance,
  buildAuthenticationStatusLabel,
  buildHumanAuthenticationCard,
  resolveAuthenticationGuidance,
  resolveAuthenticationReasonFromState,
} from "../auth/auth-guidance";
import type {
  AuthSessionState,
  AuthSessionStateReasonCode,
  AuthSessionStateResult,
  StoredActiveOrganization,
} from "../config/auth-session";
import type { createPresenter } from "../runtime/presenter/index";
import { renderInfoCard } from "../ui/info-card";

type AuthStatusSnapshot = {
  signedIn: boolean;
  state: AuthSessionState;
  reasonCode?: AuthSessionStateReasonCode;
  errorMessage?: string;
  userId: string | null;
  userEmail: string | null;
  userName: string | null;
  clientId: string | null;
  authBaseUrl: string | null;
  tokenType: string | null;
  scope: string | null;
  createdAt: string | null;
  expiresAt: string | null;
  expiresIn: string | null;
  expired: boolean;
  activeOrganization: StoredActiveOrganization | null;
};

export type { AuthStatusSnapshot };

export function buildAuthStatusSnapshot(
  input: AuthSessionStateResult
): AuthStatusSnapshot {
  const session = input.session;
  if (!session) {
    return {
      signedIn: false,
      state: input.state,
      ...(input.reasonCode ? { reasonCode: input.reasonCode } : {}),
      ...(input.errorMessage ? { errorMessage: input.errorMessage } : {}),
      userId: null,
      userEmail: null,
      userName: null,
      clientId: null,
      authBaseUrl: null,
      tokenType: null,
      scope: null,
      createdAt: null,
      expiresAt: null,
      expiresIn: null,
      expired: false,
      activeOrganization: null,
    };
  }

  const expiresAt = normalizeOptionalString(session.expiresAt);
  const expiresAtMs = expiresAt ? Date.parse(expiresAt) : Number.NaN;
  const hasValidExpiresAt = Number.isFinite(expiresAtMs);
  const expiresInMs = hasValidExpiresAt ? expiresAtMs - Date.now() : Number.NaN;
  const expired = hasValidExpiresAt ? expiresInMs <= 0 : false;

  return {
    signedIn: input.state === "valid",
    state: input.state,
    ...(input.reasonCode ? { reasonCode: input.reasonCode } : {}),
    ...(input.errorMessage ? { errorMessage: input.errorMessage } : {}),
    userId: normalizeOptionalString(session.user?.id),
    userEmail: normalizeOptionalString(session.user?.email),
    userName: normalizeOptionalString(session.user?.name),
    clientId: normalizeOptionalString(session.clientId),
    authBaseUrl: normalizeOptionalString(session.authBaseUrl),
    tokenType: normalizeOptionalString(session.tokenType),
    scope: normalizeOptionalString(session.scope),
    createdAt: normalizeOptionalString(session.createdAt),
    expiresAt,
    expiresIn: hasValidExpiresAt ? formatRemainingDuration(expiresInMs) : null,
    expired,
    activeOrganization: session.activeOrganization ?? null,
  };
}

export function renderAuthStatusCard(input: {
  presenter: ReturnType<typeof createPresenter>;
  auth: AuthStatusSnapshot;
  codePrefix: string;
}): void {
  renderInfoCard({
    presenter: input.presenter,
    title: "Authentication Status",
    codePrefix: input.codePrefix,
    rows: buildAuthStatusRows(input.auth),
  });
}

export function renderAuthStatusGuidanceCard(input: {
  presenter: ReturnType<typeof createPresenter>;
  guidance: AuthenticationGuidance;
  codePrefix: string;
}): void {
  const card = buildHumanAuthenticationCard({
    guidance: input.guidance,
    mode: "error",
  });
  renderInfoCard({
    presenter: input.presenter,
    title: card.title,
    codePrefix: input.codePrefix,
    rows: card.rows,
  });
}

function buildSignedInRows(
  auth: AuthStatusSnapshot
): Array<{ label: string; value: string }> {
  const rows: Array<{ label: string; value: string }> = [
    { label: "Status", value: "signed in" },
  ];

  appendRowIfValue(rows, "Email", auth.userEmail);
  appendRowIfValue(rows, "User ID", auth.userId);
  appendRowIfValue(rows, "Name", auth.userName);
  rows.push({
    label: "Active Organization",
    value: auth.activeOrganization
      ? formatActiveOrganizationLabel(auth.activeOrganization)
      : "not selected",
  });
  appendRowIfValue(rows, "Client ID", auth.clientId);
  appendRowIfValue(rows, "Auth URL", auth.authBaseUrl);
  appendRowIfValue(rows, "Token Type", auth.tokenType);
  appendRowIfValue(rows, "Scope", auth.scope);
  appendRowIfValue(rows, "Created At", auth.createdAt);
  appendRowIfValue(rows, "Expires At", auth.expiresAt);
  appendRowIfValue(rows, "Expires In", auth.expiresIn);
  rows.push({ label: "Expired", value: auth.expired ? "yes" : "no" });

  return rows;
}

export function formatActiveOrganizationLabel(
  organization: StoredActiveOrganization
): string {
  const role = organization.role ? `, ${organization.role}` : "";
  return `${organization.name} (${organization.slug})${role}`;
}

export function buildAuthStatusRows(
  auth: AuthStatusSnapshot
): Array<{ label: string; value: string }> {
  if (auth.state === "valid") {
    return buildSignedInRows(auth);
  }

  const rows: Array<{ label: string; value: string }> = [
    { label: "Status", value: buildAuthStatusLabel(auth.state) },
  ];
  const reason = resolveAuthenticationReasonFromState(auth.state);
  if (reason) {
    rows.push({
      label: "Next",
      value: resolveAuthenticationGuidance({
        reason,
      }).errorNextStep,
    });
  }

  appendRowIfValue(rows, "Client ID", auth.clientId);
  appendRowIfValue(rows, "Auth URL", auth.authBaseUrl);
  appendRowIfValue(rows, "Created At", auth.createdAt);
  appendRowIfValue(rows, "Expires At", auth.expiresAt);
  appendRowIfValue(rows, "Expires In", auth.expiresIn);
  return rows;
}

function buildAuthStatusLabel(state: AuthSessionState): string {
  return buildAuthenticationStatusLabel(state);
}

function appendRowIfValue(
  rows: Array<{ label: string; value: string }>,
  label: string,
  value: string | null
): void {
  if (!value) {
    return;
  }
  rows.push({ label, value });
}

function normalizeOptionalString(
  value: string | null | undefined
): string | null {
  const normalized = String(value ?? "").trim();
  return normalized.length > 0 ? normalized : null;
}

function formatRemainingDuration(inputMs: number): string {
  if (inputMs <= 0) {
    return "expired";
  }

  const totalSeconds = Math.floor(inputMs / 1000);
  const days = Math.floor(totalSeconds / 86_400);
  const hours = Math.floor((totalSeconds % 86_400) / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;

  if (days > 0) {
    return `${days}d ${hours}h`;
  }
  if (hours > 0) {
    return `${hours}h ${minutes}m`;
  }
  if (minutes > 0) {
    return `${minutes}m ${seconds}s`;
  }
  return `${seconds}s`;
}
