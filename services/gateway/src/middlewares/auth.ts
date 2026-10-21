import {
  jsonErrorResponse,
  OPENMELD_HEADER_PROFILE_ID,
  readCredentialConfirmationHeader,
  readOpenMeldRequestedOrganizationSelector,
  readTaskCredentialHeader,
  readUserTimeZoneObservationHeaders,
} from "@openmeld/gateway-contract";
import {
  openMeldRequestedOrganizationSelectorSchema,
  SPACE_PASSWORD_RATE_LIMITED_ERROR_CODE,
} from "@openmeld/schemas";
import {
  createAnonymousViewerSpaceAccessContext,
  createAuthenticatedSpaceAccessContext,
} from "@openmeld/space";
import type { Context } from "hono";
import { createMiddleware } from "hono/factory";
import { logAuditEvent } from "../audit";
import { parseAnonymousFeedbackSubmitRoute } from "../lib/anonymous-feedback-submit-route";
import { parseAnonymousSpaceReadRoute } from "../lib/anonymous-space-read-routes";
import {
  resolveProfile,
  resolveRequestAuth,
  resolveRequestAuthWithProfile,
} from "../lib/auth-rpc-client";
import {
  AUTH_UNAUTHENTICATED_CODE,
  mapAuthRpcHttpError,
  ORGANIZATION_CONTEXT_UNVERIFIED_CODE,
} from "../lib/auth-rpc-error";
import type { HonoBindings } from "../lib/bindings";
import { redactFeedbackRouteForLogging } from "../lib/feedback-route-log-redaction";
import { buildOpenMeldRequestContext } from "../lib/openmeld-context";
import { readSpacePassword } from "../lib/space-access-context";
import { createCloudflareSpacePasswordRateLimiter } from "../lib/space-password-rate-limiter";

const PREPARE_TERMINAL_STEP_ROUTE_PATTERN =
  /^\/v1\/prepare\/sessions\/[^/]+\/terminal-step$/u;
const PREPARE_STREAM_ROUTE_PATTERN =
  /^\/v1\/prepare\/sessions\/[^/]+\/stream$/u;
const MODEL_CATALOG_ROUTE = "/v1/config/model-catalog";
const PUBLIC_CHANGELOG_ROUTE = "/v1/changelog";
const PUBLIC_ORGANIZATION_LOGO_ROUTE_PATTERN =
  /^\/v1\/organization-logos\/[a-zA-Z0-9_-]+\/[0-9a-fA-F-]+\.webp$/u;
const PUBLIC_ACCOUNT_AVATAR_ROUTE_PATTERN =
  /^\/v1\/profile-avatars\/[a-zA-Z0-9_-]+\/[0-9a-fA-F-]+\.webp$/u;

export const gatewayAuthMiddleware = createMiddleware<HonoBindings>(
  async (c, next) => {
    if (isPublicChangelogRequest(c.req.raw)) {
      await next();
      return;
    }
    if (isPublicIdentityImageRequest(c.req.raw)) {
      await next();
      return;
    }
    if (isPublicStartTokenRequest(c.req.raw)) {
      await next();
      return;
    }

    const requestId = c.var.ingressOpenMeldContext.requestId;
    const anonymousFeedbackSubmitRoute = parseAnonymousFeedbackSubmitRoute(
      c.req.raw
    );
    if (anonymousFeedbackSubmitRoute) {
      const optionalAuthFailure = await resolveOptionalFeedbackSubmitter(c, {
        requestId,
      });
      if (optionalAuthFailure) {
        return optionalAuthFailure;
      }
      await next();
      return;
    }

    const anonymousReadRoute = parseAnonymousSpaceReadRoute(c.req.raw);
    const passwordRateLimitResponse = await enforceSpacePasswordRateLimit(c, {
      anonymousReadRoute,
      requestId,
    });
    if (passwordRateLimitResponse) {
      return passwordRateLimitResponse;
    }
    const explicitProfileId = normalizeOptionalString(
      c.req.header(OPENMELD_HEADER_PROFILE_ID)
    );
    let requestedOrganization: ReturnType<
      typeof readOpenMeldRequestedOrganizationSelector
    >;
    try {
      requestedOrganization = readRequestedOrganization(c);
    } catch {
      return jsonErrorResponse({
        status: 400,
        code: "bad_request",
        message: "Choose one Organization selector.",
        requestId,
      });
    }

    const authResolution = await resolveGatewayAuth(c, {
      explicitProfileId,
      requestedOrganization,
      requestId,
    });
    if (authResolution instanceof Response) {
      return authResolution;
    }

    const { claims } = authResolution;
    if (!claims.authenticated) {
      if (anonymousReadRoute) {
        setAnonymousReadSpaceAccess(c, {
          requestId: claims.requestId,
          spaceId: anonymousReadRoute.spaceId,
        });
        await next();
        return;
      }

      logAuthRejection(c.req.raw, {
        requestId: claims.requestId,
        status: 401,
        code: AUTH_UNAUTHENTICATED_CODE,
      });
      return jsonErrorResponse({
        status: 401,
        code: AUTH_UNAUTHENTICATED_CODE,
        message: "authentication required",
        requestId: claims.requestId,
      });
    }

    const profileResolution = await resolveGatewayIdentity(c, {
      anonymousReadRoute,
      claims,
      combinedProfileResult: authResolution.combinedProfileResult,
      explicitProfileId,
    });
    if (profileResolution instanceof Response) {
      return profileResolution;
    }
    if (profileResolution.anonymousRead) {
      await next();
      return;
    }

    const { requestCredential, resolvedProfile } = profileResolution;
    c.set("authClaims", claims);
    c.set("resolvedProfile", resolvedProfile);
    c.set("requestCredential", requestCredential);
    const openMeldRequestContext = buildOpenMeldRequestContext({
      userTimeZoneObservation:
        readUserTimeZoneObservationHeaders(c.req.raw.headers) ?? undefined,
      ...(claims.activeOrganizationId
        ? { activeOrganizationId: claims.activeOrganizationId }
        : {}),
      ...(claims.callerPrincipalId
        ? { callerPrincipalId: claims.callerPrincipalId }
        : {}),
      ingressContext: c.var.ingressOpenMeldContext,
      requestId: claims.requestId,
      resolvedProfile,
    });
    c.set("openMeldRequestContext", openMeldRequestContext);
    if (anonymousReadRoute) {
      const password = readSpacePassword(c.req.raw.headers);
      c.set(
        "spaceAccessContext",
        createAuthenticatedSpaceAccessContext({
          spaceId: anonymousReadRoute.spaceId,
          requestContext: openMeldRequestContext,
          ...(password === undefined ? {} : { password }),
        })
      );
    }

    await next();
  }
);

/** The caller's Profile and, once it is resolved, its credential facts. */
async function resolveGatewayIdentity(
  c: Context<HonoBindings>,
  input: Parameters<typeof resolveGatewayProfile>[1]
): Promise<
  | Response
  | { anonymousRead: true }
  | {
      anonymousRead: false;
      requestCredential: HonoBindings["Variables"]["requestCredential"];
      resolvedProfile: Extract<
        GatewayProfileResolution,
        { anonymousRead: false }
      >["resolvedProfile"];
    }
> {
  const profileResolution = await resolveGatewayProfile(c, input);
  if (
    profileResolution instanceof Response ||
    profileResolution.anonymousRead
  ) {
    return profileResolution;
  }
  const requestCredential = readRequestCredential(c, input.claims);
  return requestCredential instanceof Response
    ? requestCredential
    : { ...profileResolution, requestCredential };
}

/**
 * Credential facts for sensitive operations (member-agent-program.md §4.7).
 * Without Auth's positive answer the caller is not an interactive session.
 */
function readRequestCredential(
  c: Context<HonoBindings>,
  claims: GatewayAuthClaims
): HonoBindings["Variables"]["requestCredential"] | Response {
  const taskCredential = readTaskCredentialHeader(c.req.raw.headers);
  if (taskCredential.status === "invalid") {
    return jsonErrorResponse({
      status: 400,
      code: "bad_request",
      message: "The task credential is malformed.",
      requestId: claims.requestId,
    });
  }
  const confirmationId = readCredentialConfirmationHeader(c.req.raw.headers);
  return {
    kind: claims.credentialKind ?? "cli_credential",
    ...(taskCredential.status === "present"
      ? { taskCredential: taskCredential.taskCredential }
      : {}),
    ...(confirmationId ? { confirmationId } : {}),
  };
}

function readRequestedOrganization(c: Context<HonoBindings>) {
  const headerSelector = readOpenMeldRequestedOrganizationSelector(
    c.req.raw.headers
  );
  if (c.req.path !== "/v1/account/invalidation-stream") {
    return headerSelector;
  }
  const organizationId = c.req.query("organizationId");
  const querySelector = openMeldRequestedOrganizationSelectorSchema.parse({
    organizationId,
  });
  if (
    headerSelector &&
    ("organizationId" in headerSelector
      ? headerSelector.organizationId !== organizationId
      : true)
  ) {
    throw new Error("Conflicting Organization selectors");
  }
  return querySelector;
}

function isPublicChangelogRequest(request: Request): boolean {
  return (
    request.method === "GET" &&
    new URL(request.url).pathname === PUBLIC_CHANGELOG_ROUTE
  );
}

async function enforceSpacePasswordRateLimit(
  c: Context<HonoBindings>,
  input: {
    anonymousReadRoute: ReturnType<typeof parseAnonymousSpaceReadRoute>;
    requestId: string;
  }
): Promise<Response | null> {
  if (!(input.anonymousReadRoute && readSpacePassword(c.req.raw.headers))) {
    return null;
  }

  const allowed = await createCloudflareSpacePasswordRateLimiter(
    c.env.OPENMELD_SPACE_PASSWORD_RATE_LIMITER
  ).check({
    ipAddress: readClientIpAddress(c.req.raw.headers),
    spaceId: input.anonymousReadRoute.spaceId,
  });
  if (allowed) {
    return null;
  }

  console.warn("[gateway.space.password_rate_limited]", {
    event: "gateway.space.password_rate_limited",
    rateLimitDimension: "ip_space",
    reasonCode: SPACE_PASSWORD_RATE_LIMITED_ERROR_CODE,
    requestId: input.requestId,
    spaceId: input.anonymousReadRoute.spaceId,
  });
  return jsonErrorResponse({
    status: 429,
    code: SPACE_PASSWORD_RATE_LIMITED_ERROR_CODE,
    message: "Too many password attempts. Try again in a minute.",
    requestId: input.requestId,
  });
}

function readClientIpAddress(headers: Headers): string {
  return headers.get("CF-Connecting-IP")?.trim() || "unknown";
}

function isPublicIdentityImageRequest(request: Request): boolean {
  return (
    (request.method === "GET" || request.method === "HEAD") &&
    (PUBLIC_ORGANIZATION_LOGO_ROUTE_PATTERN.test(
      new URL(request.url).pathname
    ) ||
      PUBLIC_ACCOUNT_AVATAR_ROUTE_PATTERN.test(new URL(request.url).pathname))
  );
}

type GatewayAuthSuccess = Extract<
  Awaited<ReturnType<typeof resolveRequestAuth>>,
  { ok: true }
>;
type GatewayAuthWithProfileSuccess = Extract<
  Awaited<ReturnType<typeof resolveRequestAuthWithProfile>>,
  { ok: true }
>;
type GatewayAuthClaims = GatewayAuthSuccess["claims"];
type GatewayCombinedProfileResult = GatewayAuthWithProfileSuccess["profile"];

type GatewayAuthResolution = {
  claims: GatewayAuthClaims;
  combinedProfileResult?: GatewayCombinedProfileResult;
};

type AnonymousReadRoute = ReturnType<typeof parseAnonymousSpaceReadRoute>;

async function resolveOptionalFeedbackSubmitter(
  c: Context<HonoBindings>,
  input: { requestId: string }
): Promise<Response | null> {
  if (
    !(c.req.raw.headers.has("authorization") || c.req.raw.headers.has("cookie"))
  ) {
    return null;
  }

  let authResult: Awaited<ReturnType<typeof resolveRequestAuth>>;
  try {
    authResult = await resolveRequestAuth({
      authRpc: c.var.authRpc,
      headers: c.req.raw.headers,
      requestId: input.requestId,
    });
  } catch (error) {
    return respondOptionalFeedbackAuthFailure({
      error,
      requestId: input.requestId,
    });
  }

  if (!authResult.ok) {
    if (authResult.code === AUTH_UNAUTHENTICATED_CODE) {
      logOptionalFeedbackAuthIgnored({
        requestId: input.requestId,
        reasonCode: AUTH_UNAUTHENTICATED_CODE,
      });
      return null;
    }
    return respondOptionalFeedbackAuthFailure({
      requestId: input.requestId,
      code: authResult.code,
      message: authResult.message,
    });
  }

  if (!authResult.claims.authenticated) {
    logOptionalFeedbackAuthIgnored({
      requestId: input.requestId,
      reasonCode: AUTH_UNAUTHENTICATED_CODE,
    });
    return null;
  }

  const submitterUserId = normalizeOptionalString(
    authResult.claims.callerPrincipalId
  );
  if (!submitterUserId) {
    return respondOptionalFeedbackAuthFailure({
      requestId: input.requestId,
      message: "authenticated feedback submitter principal is unavailable",
    });
  }

  c.set("feedbackSubmitterUserId", submitterUserId);
  return null;
}

function logOptionalFeedbackAuthIgnored(input: {
  requestId: string;
  reasonCode: string;
}): void {
  console.warn("[gateway.feedback.optional_auth_ignored]", {
    event: "gateway.feedback.optional_auth_ignored",
    requestId: input.requestId,
    reasonCode: formatReasonCode(input.reasonCode),
    authorizationPresent: true,
  });
}

function respondOptionalFeedbackAuthFailure(input: {
  requestId: string;
  code?: string;
  message?: string;
  error?: unknown;
}): Response {
  const mapped = mapAuthRpcHttpError(input);
  console.warn("[gateway.feedback.optional_auth_failed]", {
    event: "gateway.feedback.optional_auth_failed",
    requestId: input.requestId,
    reasonCode: mapped.code,
    status: mapped.status,
    authorizationPresent: true,
  });
  return jsonErrorResponse({
    status: mapped.status,
    code: mapped.code,
    message: mapped.message,
    requestId: input.requestId,
  });
}

type GatewayProfileResolution =
  | {
      anonymousRead: true;
    }
  | {
      anonymousRead: false;
      resolvedProfile: Extract<
        Awaited<ReturnType<typeof resolveProfile>>,
        { ok: true }
      >["resolvedProfile"];
    };

async function resolveGatewayAuth(
  c: Context<HonoBindings>,
  input: {
    explicitProfileId: string | null;
    requestedOrganization: ReturnType<
      typeof readOpenMeldRequestedOrganizationSelector
    >;
    requestId: string;
  }
): Promise<GatewayAuthResolution | Response> {
  let authResult: Awaited<ReturnType<typeof resolveRequestAuth>>;
  let combinedProfileResult: GatewayCombinedProfileResult | undefined;

  try {
    const combined = await resolveRequestAuthWithProfile({
      authRpc: c.var.authRpc,
      headers: c.req.raw.headers,
      requestId: input.requestId,
      ...(input.requestedOrganization
        ? {
            requestedOrganization: input.requestedOrganization,
          }
        : {}),
      ...(input.explicitProfileId
        ? { openMeldProfileId: input.explicitProfileId }
        : {}),
    });
    authResult = combined;
    combinedProfileResult = combined.ok ? combined.profile : undefined;
  } catch (combinedError) {
    console.warn("[gateway.auth.combined_rpc_fallback]", {
      requestId: input.requestId,
      error:
        combinedError instanceof Error
          ? combinedError.message
          : String(combinedError),
    });
    try {
      authResult = await resolveRequestAuth({
        authRpc: c.var.authRpc,
        headers: c.req.raw.headers,
        requestId: input.requestId,
        ...(input.requestedOrganization
          ? {
              requestedOrganization: input.requestedOrganization,
            }
          : {}),
      });
    } catch (error) {
      return mapAuthErrorToResponse({
        request: c.req.raw,
        requestId: input.requestId,
        error,
      });
    }
  }

  if (!authResult.ok) {
    return mapAuthErrorToResponse({
      request: c.req.raw,
      requestId: input.requestId,
      code: authResult.code,
      message: authResult.message,
    });
  }
  if (
    input.requestedOrganization &&
    authResult.claims.authenticated &&
    authResult.claims.organizationContextSource !== "request"
  ) {
    return mapAuthErrorToResponse({
      request: c.req.raw,
      requestId: input.requestId,
      code: ORGANIZATION_CONTEXT_UNVERIFIED_CODE,
      message: "OpenMeld could not verify this organization.",
    });
  }

  return {
    claims: authResult.claims,
    ...(combinedProfileResult ? { combinedProfileResult } : {}),
  };
}

async function resolveGatewayProfile(
  c: Context<HonoBindings>,
  input: {
    anonymousReadRoute: AnonymousReadRoute;
    claims: GatewayAuthClaims;
    combinedProfileResult?: GatewayCombinedProfileResult;
    explicitProfileId: string | null;
  }
): Promise<GatewayProfileResolution | Response> {
  let profileResult: Awaited<ReturnType<typeof resolveProfile>>;
  try {
    profileResult =
      input.combinedProfileResult ??
      (await resolveProfile({
        authRpc: c.var.authRpc,
        headers: c.req.raw.headers,
        requestId: input.claims.requestId,
        ...(input.explicitProfileId
          ? { openMeldProfileId: input.explicitProfileId }
          : {}),
      }));
  } catch (error) {
    if (input.anonymousReadRoute) {
      return enableAnonymousReadAfterProfileFailure(c, {
        reason: "profile_resolution_exception",
        requestId: input.claims.requestId,
        spaceId: input.anonymousReadRoute.spaceId,
      });
    }
    return mapProfileErrorToResponse({
      requestId: input.claims.requestId,
      error,
    });
  }

  if (profileResult.ok) {
    return {
      anonymousRead: false,
      resolvedProfile: profileResult.resolvedProfile,
    };
  }

  if (input.anonymousReadRoute) {
    return enableAnonymousReadAfterProfileFailure(c, {
      reason: profileResult.code,
      requestId: input.claims.requestId,
      spaceId: input.anonymousReadRoute.spaceId,
    });
  }

  return mapProfileErrorToResponse({
    requestId: input.claims.requestId,
    code: profileResult.code,
    message: profileResult.message,
  });
}

function enableAnonymousReadAfterProfileFailure(
  c: Context<HonoBindings>,
  input: {
    reason: string;
    requestId: string;
    spaceId: string;
  }
): GatewayProfileResolution {
  setAnonymousReadSpaceAccess(c, {
    requestId: input.requestId,
    spaceId: input.spaceId,
  });
  logAnonymousReadProfileResolutionBypass(c, input);
  return { anonymousRead: true };
}

function setAnonymousReadSpaceAccess(
  c: Context<HonoBindings>,
  input: {
    requestId: string;
    spaceId: string;
  }
): void {
  const password = readSpacePassword(c.req.raw.headers);
  c.set(
    "spaceAccessContext",
    createAnonymousViewerSpaceAccessContext({
      spaceId: input.spaceId,
      requestId: input.requestId,
      ...(password === undefined ? {} : { password }),
    })
  );
}

function logAnonymousReadProfileResolutionBypass(
  c: Context<HonoBindings>,
  input: {
    reason: string;
    requestId: string;
    spaceId: string;
  }
): void {
  logAuditEvent({
    event: "http.forward",
    method: c.req.raw.method.toUpperCase(),
    requestId: input.requestId,
    route: readRequestPathname(c.req.raw.url),
    spaceId: input.spaceId,
    reason: `anonymous_read_profile_resolution_bypassed code=${formatReasonCode(input.reason)}`,
  });
}

function readRequestPathname(url: string): string {
  try {
    return new URL(url).pathname;
  } catch {
    return "unknown";
  }
}

function formatReasonCode(value: string): string {
  return value.replaceAll(/[^A-Za-z0-9._-]/gu, "_");
}

function isPublicStartTokenRequest(request: Request): boolean {
  const method = request.method.toUpperCase();
  try {
    const pathname = new URL(request.url).pathname;
    return (
      (method === "POST" &&
        pathname === "/v1/prepare/sessions/resolve-token") ||
      (method === "PUT" &&
        PREPARE_TERMINAL_STEP_ROUTE_PATTERN.test(pathname)) ||
      (method === "GET" &&
        PREPARE_STREAM_ROUTE_PATTERN.test(pathname) &&
        new URL(request.url).searchParams.get("role") === "terminal") ||
      (method === "PUT" &&
        pathname === "/v1/local-runtimes/current/observed-metadata") ||
      (method === "GET" && pathname === MODEL_CATALOG_ROUTE)
    );
  } catch {
    return false;
  }
}

// Per-isolate 401 counter. Diagnostic annotation only, never a sampling gate:
// every rejection is still logged (401s are rare in steady state), but a
// runaway daemon reconnect loop hitting one isolate becomes obvious and
// quantified in the log stream instead of reading like many unrelated
// one-off rejections.
let isolateAuthRejectionCount = 0;

// Emit exactly one structured line per auth-middleware rejection. This is the
// tripwire the 2026-07-02 production incident lacked: a credential-less daemon
// hammered the gateway for hours while it emitted zero application logs.
// `authorizationPresent` is the decisive bit — true means an invalid/expired
// token (server-side or token problem), false means the client dropped
// credentials entirely (the exact incident signature). Log presence booleans
// only; never log the header values.
function logAuthRejection(
  request: Request,
  input: {
    requestId: string;
    status: number;
    code: string;
  }
): void {
  isolateAuthRejectionCount += 1;
  console.warn("[gateway.auth.rejected]", {
    requestId: input.requestId,
    route:
      redactFeedbackRouteForLogging(request) ??
      readRequestPathname(request.url),
    method: request.method.toUpperCase(),
    status: input.status,
    code: input.code,
    authorizationPresent: request.headers.has("authorization"),
    cookiePresent: request.headers.has("cookie"),
    isolateRejectionCount: isolateAuthRejectionCount,
  });
}

function mapAuthErrorToResponse(input: {
  request: Request;
  requestId: string;
  code?: string;
  message?: string;
  error?: unknown;
}): Response {
  const mapped = mapAuthRpcHttpError(input);
  logAuthRejection(input.request, {
    requestId: input.requestId,
    status: mapped.status,
    code: mapped.code,
  });
  return jsonErrorResponse({
    status: mapped.status,
    code: mapped.code,
    message: mapped.message,
    requestId: input.requestId,
  });
}

function mapProfileErrorToResponse(input: {
  requestId: string;
  code?: string;
  message?: string;
  error?: unknown;
}): Response {
  const mapped = mapAuthRpcHttpError(input);
  return jsonErrorResponse({
    status: mapped.status,
    code: mapped.code,
    message: mapped.message,
    requestId: input.requestId,
  });
}

function normalizeOptionalString(value: unknown): string | null {
  const normalized = String(value ?? "").trim();
  return normalized.length > 0 ? normalized : null;
}
