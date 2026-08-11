import {
  getOrganizationJoinLinkResponseSchema,
  organizationJoinLinkErrorResponseSchema,
  revokeOrganizationJoinLinkResponseSchema,
} from "@openmeld/schemas";
import type {
  GetOrganizationJoinLinkResponse,
  OrganizationJoinLinkErrorCode,
  RevokeOrganizationJoinLinkResponse,
} from "@openmeld/schemas/types";
import {
  normalizeStoredActiveOrganization,
  type StoredActiveOrganization,
  type StoredAuthSession,
} from "../config/auth-session";

const TRAILING_SLASHES_RE = /\/+$/u;

type AuthOrganizationApiErrorCode =
  | "organization.auth_revoked"
  | "organization.get_active_failed"
  | "organization.get_selection_failed"
  | "organization.list_failed"
  | "organization.switch_failed"
  | "organization.invite_link_failed"
  | "organization.response_invalid"
  | OrganizationJoinLinkErrorCode;

type AuthOrganizationOperation =
  | "get-active"
  | "get-selection"
  | "list"
  | "switch"
  | "invite-link.get"
  | "invite-link.create"
  | "invite-link.revoke";

export class AuthOrganizationApiError extends Error {
  readonly code: AuthOrganizationApiErrorCode;
  readonly status: number | null;
  readonly requestId: string | null;
  readonly detailMessage: string | null;

  constructor(input: {
    code: AuthOrganizationApiErrorCode;
    message: string;
    status?: number | null;
    requestId?: string | null;
    detailMessage?: string | null;
  }) {
    super(input.message);
    this.name = "AuthOrganizationApiError";
    this.code = input.code;
    this.status = input.status ?? null;
    this.requestId = input.requestId ?? null;
    this.detailMessage = input.detailMessage ?? null;
  }
}

export async function listAuthOrganizations(
  session: StoredAuthSession
): Promise<StoredActiveOrganization[]> {
  const payload = await fetchAuthOrganizationJson({
    endpoint: toAuthEndpoint(
      session.authBaseUrl,
      "/api/auth/organization/list"
    ),
    operation: "list",
    session,
  });
  return normalizeOrganizationListPayload(payload);
}

export async function getActiveAuthOrganization(
  session: StoredAuthSession
): Promise<StoredActiveOrganization | null> {
  const payload = await fetchAuthOrganizationJson({
    endpoint: toAuthEndpoint(
      session.authBaseUrl,
      "/api/auth/organization/get-full-organization"
    ),
    operation: "get-active",
    session,
  });
  return normalizeActiveOrganizationPayload(payload);
}

export type AuthOrganizationSelection = {
  activeOrganizationId: string | null;
  lastSelectedOrganizationId: string | null;
};

export async function getAuthOrganizationSelection(
  session: StoredAuthSession
): Promise<AuthOrganizationSelection> {
  const payload = await fetchAuthOrganizationJson({
    endpoint: toAuthEndpoint(session.authBaseUrl, "/api/auth/get-session"),
    operation: "get-selection",
    session,
  });
  return normalizeOrganizationSelectionPayload(payload);
}

export async function setActiveAuthOrganization(input: {
  session: StoredAuthSession;
  organizationSlug: string;
}): Promise<void> {
  await fetchAuthOrganizationJson({
    endpoint: toAuthEndpoint(
      input.session.authBaseUrl,
      "/api/auth/organization/set-active"
    ),
    operation: "switch",
    session: input.session,
    init: {
      method: "POST",
      headers: {
        "content-type": "application/json",
      },
      body: JSON.stringify({
        organizationSlug: input.organizationSlug,
      }),
    },
  });
}

export async function getAuthOrganizationJoinLink(input: {
  session: StoredAuthSession;
  organizationId: string;
}): Promise<GetOrganizationJoinLinkResponse> {
  return parseOrganizationJoinLinkResponse(
    await fetchAuthOrganizationJson({
      endpoint: toOrganizationJoinLinkEndpoint(
        input.session.authBaseUrl,
        input.organizationId
      ),
      operation: "invite-link.get",
      session: input.session,
    })
  );
}

export async function createAuthOrganizationJoinLink(input: {
  session: StoredAuthSession;
  organizationId: string;
}): Promise<GetOrganizationJoinLinkResponse> {
  return parseOrganizationJoinLinkResponse(
    await fetchAuthOrganizationJson({
      endpoint: toOrganizationJoinLinkEndpoint(
        input.session.authBaseUrl,
        input.organizationId
      ),
      operation: "invite-link.create",
      session: input.session,
      init: { method: "POST" },
    })
  );
}

export async function revokeAuthOrganizationJoinLink(input: {
  session: StoredAuthSession;
  organizationId: string;
}): Promise<RevokeOrganizationJoinLinkResponse> {
  return parseOrganizationJoinLinkRevokeResponse(
    await fetchAuthOrganizationJson({
      endpoint: toOrganizationJoinLinkEndpoint(
        input.session.authBaseUrl,
        input.organizationId
      ),
      operation: "invite-link.revoke",
      session: input.session,
      init: { method: "DELETE" },
    })
  );
}

function parseOrganizationJoinLinkResponse(
  payload: unknown
): GetOrganizationJoinLinkResponse {
  const parsed = getOrganizationJoinLinkResponseSchema.safeParse(payload);
  if (!parsed.success) {
    throw new AuthOrganizationApiError({
      code: "organization.response_invalid",
      message: "OpenMeld auth returned an invalid Organization invite link.",
      detailMessage: parsed.error.issues[0]?.message ?? null,
    });
  }
  return parsed.data;
}

function parseOrganizationJoinLinkRevokeResponse(
  payload: unknown
): RevokeOrganizationJoinLinkResponse {
  const parsed = revokeOrganizationJoinLinkResponseSchema.safeParse(payload);
  if (!parsed.success) {
    throw new AuthOrganizationApiError({
      code: "organization.response_invalid",
      message:
        "OpenMeld auth returned an invalid Organization invite-link revoke response.",
      detailMessage: parsed.error.issues[0]?.message ?? null,
    });
  }
  return parsed.data;
}

async function fetchAuthOrganizationJson(input: {
  endpoint: string;
  operation: AuthOrganizationOperation;
  session: StoredAuthSession;
  init?: RequestInit;
}): Promise<unknown> {
  let response: Response;
  try {
    response = await fetch(input.endpoint, {
      method: "GET",
      ...input.init,
      headers: {
        ...toHeaderRecord(input.init?.headers),
        Authorization: `${normalizeTokenType(input.session.tokenType)} ${input.session.accessToken}`,
      },
    });
  } catch (error) {
    throw new AuthOrganizationApiError({
      code: resolveOperationFailureCode(input.operation),
      message: "OpenMeld auth service is temporarily unavailable.",
      detailMessage: error instanceof Error ? error.message : String(error),
    });
  }

  const raw = await response.text();
  const payload = parseJsonOrNull(raw);
  const joinLinkError =
    organizationJoinLinkErrorResponseSchema.safeParse(payload);
  if (!response.ok && joinLinkError.success) {
    throw new AuthOrganizationApiError({
      code: joinLinkError.data.code,
      message: joinLinkError.data.message,
      status: response.status,
      requestId: readRequestId(payload),
    });
  }
  if (response.status === 401 || response.status === 403) {
    throw new AuthOrganizationApiError({
      code: "organization.auth_revoked",
      message: "Your OpenMeld sign-in is no longer valid.",
      status: response.status,
      requestId: readRequestId(payload),
      detailMessage: readErrorMessage(payload),
    });
  }
  if (!response.ok) {
    throw new AuthOrganizationApiError({
      code: resolveOperationFailureCode(input.operation),
      message: resolveOperationFailureMessage(input.operation),
      status: response.status,
      requestId: readRequestId(payload),
      detailMessage: readErrorMessage(payload) ?? raw,
    });
  }
  return payload;
}

function normalizeActiveOrganizationPayload(
  payload: unknown
): StoredActiveOrganization | null {
  if (payload === null) {
    return null;
  }
  const organization = normalizeOrganizationFromPayload(payload);
  if (!organization) {
    throw new AuthOrganizationApiError({
      code: "organization.response_invalid",
      message: "OpenMeld auth returned an invalid active organization.",
    });
  }
  return organization;
}

function normalizeOrganizationSelectionPayload(
  payload: unknown
): AuthOrganizationSelection {
  if (
    !(isRecord(payload) && isRecord(payload.session) && isRecord(payload.user))
  ) {
    throw new AuthOrganizationApiError({
      code: "organization.response_invalid",
      message: "OpenMeld auth returned an invalid Organization selection.",
    });
  }
  return {
    activeOrganizationId: normalizeOptionalString(
      payload.session.activeOrganizationId
    ),
    lastSelectedOrganizationId: normalizeOptionalString(
      payload.user.lastSelectedOrganizationId
    ),
  };
}

function normalizeOrganizationListPayload(
  payload: unknown
): StoredActiveOrganization[] {
  const candidates = resolveOrganizationListCandidates(payload);
  const organizations = candidates
    .map((candidate) => normalizeOrganizationFromPayload(candidate))
    .filter(
      (organization): organization is StoredActiveOrganization =>
        organization !== null
    );
  if (candidates.length > 0 && organizations.length !== candidates.length) {
    throw new AuthOrganizationApiError({
      code: "organization.response_invalid",
      message: "OpenMeld auth returned an invalid organization list.",
    });
  }
  return organizations;
}

function resolveOrganizationListCandidates(payload: unknown): unknown[] {
  if (Array.isArray(payload)) {
    return payload;
  }
  if (!isRecord(payload)) {
    throw new AuthOrganizationApiError({
      code: "organization.response_invalid",
      message: "OpenMeld auth returned an invalid organization list.",
    });
  }
  if (Array.isArray(payload.organizations)) {
    return payload.organizations;
  }
  if (Array.isArray(payload.data)) {
    return payload.data;
  }
  if (Array.isArray(payload.items)) {
    return payload.items;
  }
  throw new AuthOrganizationApiError({
    code: "organization.response_invalid",
    message: "OpenMeld auth returned an invalid organization list.",
  });
}

function normalizeOrganizationFromPayload(
  payload: unknown
): StoredActiveOrganization | null {
  const direct = normalizeStoredActiveOrganization(payload);
  if (direct) {
    return direct;
  }
  if (!isRecord(payload)) {
    return null;
  }
  const organization = normalizeStoredActiveOrganization(payload.organization);
  if (!organization) {
    return null;
  }
  const role =
    normalizeOptionalString(payload.role) ??
    (isRecord(payload.member)
      ? normalizeOptionalString(payload.member.role)
      : null);
  return {
    ...organization,
    ...(role ? { role } : {}),
  };
}

function normalizeTokenType(value: string | undefined): string {
  const normalized = String(value ?? "").trim();
  return normalized.length > 0 ? normalized : "Bearer";
}

function resolveOperationFailureCode(
  operation: AuthOrganizationOperation
): AuthOrganizationApiErrorCode {
  switch (operation) {
    case "get-active":
      return "organization.get_active_failed";
    case "get-selection":
      return "organization.get_selection_failed";
    case "list":
      return "organization.list_failed";
    case "switch":
      return "organization.switch_failed";
    case "invite-link.get":
    case "invite-link.create":
    case "invite-link.revoke":
      return "organization.invite_link_failed";
    default: {
      const exhaustive: never = operation;
      return exhaustive;
    }
  }
}

function resolveOperationFailureMessage(
  operation: AuthOrganizationOperation
): string {
  switch (operation) {
    case "get-active":
      return "Could not load your active OpenMeld organization.";
    case "get-selection":
      return "Could not load your selected OpenMeld organization.";
    case "list":
      return "Could not load your OpenMeld organizations.";
    case "switch":
      return "Could not switch the active OpenMeld organization.";
    case "invite-link.get":
      return "Could not load the Organization invite link.";
    case "invite-link.create":
      return "Could not create the Organization invite link.";
    case "invite-link.revoke":
      return "Could not revoke the Organization invite link.";
    default: {
      const exhaustive: never = operation;
      return exhaustive;
    }
  }
}

function toHeaderRecord(
  headers: RequestInit["headers"] | undefined
): Record<string, string> {
  if (!headers) {
    return {};
  }
  if (headers instanceof Headers) {
    const record: Record<string, string> = {};
    headers.forEach((value, key) => {
      record[key] = value;
    });
    return record;
  }
  if (Array.isArray(headers)) {
    return Object.fromEntries(headers);
  }
  const record: Record<string, string> = {};
  for (const [key, value] of Object.entries(headers)) {
    if (typeof value === "string") {
      record[key] = value;
    }
  }
  return record;
}

function toAuthEndpoint(baseUrl: string, pathname: string): string {
  const url = new URL(baseUrl);
  const normalizedBasePath = url.pathname.replace(TRAILING_SLASHES_RE, "");
  const normalizedPathname = pathname.startsWith("/")
    ? pathname
    : `/${pathname}`;
  url.pathname = `${normalizedBasePath}${normalizedPathname}` || "/";
  url.search = "";
  url.hash = "";
  return url.toString();
}

function toOrganizationJoinLinkEndpoint(
  baseUrl: string,
  organizationId: string
): string {
  const endpoint = new URL(
    toAuthEndpoint(baseUrl, "/api/auth/organization/join-link")
  );
  endpoint.searchParams.set("organizationId", organizationId);
  return endpoint.toString();
}

function parseJsonOrNull(raw: string): unknown {
  if (raw.trim().length === 0) {
    return null;
  }
  try {
    return JSON.parse(raw) as unknown;
  } catch {
    return null;
  }
}

function readRequestId(payload: unknown): string | null {
  if (!isRecord(payload)) {
    return null;
  }
  return (
    normalizeOptionalString(payload.requestId) ??
    (isRecord(payload.error)
      ? normalizeOptionalString(payload.error.requestId)
      : null)
  );
}

function readErrorMessage(payload: unknown): string | null {
  if (!isRecord(payload)) {
    return null;
  }
  return (
    normalizeOptionalString(payload.message) ??
    (isRecord(payload.error)
      ? normalizeOptionalString(payload.error.message)
      : null)
  );
}

function normalizeOptionalString(value: unknown): string | null {
  const normalized = String(value ?? "").trim();
  return normalized.length > 0 ? normalized : null;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
