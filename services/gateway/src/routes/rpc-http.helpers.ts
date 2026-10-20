import type { GatewayErrorCode } from "@openmeld/gateway-contract";
import {
  contextAuditFields,
  jsonErrorResponse,
  OPENMELD_HEADER_SPACE_ADDRESSING_VERSION,
  OPENMELD_HEADER_SPACE_FILES_ORIGIN_VERSION,
  OPENMELD_HEADER_SPACE_IMAGE_GEOMETRY_VERSION,
  OPENMELD_SPACE_ADDRESSING_VERSION,
  OPENMELD_SPACE_FILES_ORIGIN_VERSION,
  OPENMELD_SPACE_IMAGE_GEOMETRY_VERSION,
  toErrorMessage,
  withRequestIdHeader,
} from "@openmeld/gateway-contract";
import {
  CENTER_AGENT_ROUTINE_ERROR_CODES,
  FEEDBACK_SUBMIT_ERROR_CODES,
  MESSAGE_CHANNEL_ERROR_CODES,
  ORGANIZATION_DOCUMENT_ERROR_CODES,
  ORGANIZATION_SKILL_ERROR_CODES,
  PLUGIN_ERROR_CODES,
  projectSpaceAccessViewForVersion,
  SPACE_ACCESS_VERSION_HEADER,
  SPACE_ADDRESSING_TARGET_INVALID_ERROR_CODE,
  SPACE_FILE_ERROR_CODES,
  SPACE_TASK_ERROR_CODES,
  sanitizeDispatchErrorSummary,
  toLegacySpaceAddressingWireValue,
  toLegacySpaceFilesOriginWireValue,
  toLegacySpaceImageGeometryWireValue,
} from "@openmeld/schemas";
import { getSpaceAccessRequestId } from "@openmeld/space";
import type { Context } from "hono";
import type { z } from "zod/v4";
import type { CoreRpcContextInput } from "../../../core/src/rpc/methods";
import { logAuditEvent } from "../audit";
import { resolveRequestCredentialKind } from "../lib/auth-rpc-client";
import type { HonoBindings } from "../lib/bindings";
import { readSpacePasswordHeader as readSpacePasswordHeaderValue } from "../lib/space-password-header";
import { withUpstreamRetry } from "../lib/upstream-retry";
import type { RpcHttpMethod } from "./rpc-http.types";

type ExecuteRpcRouteInput = {
  c: Context<HonoBindings>;
  route: string;
  method: RpcHttpMethod;
  spaceId?: string;
  execute: () => Promise<unknown>;
  includeLegacySpaceAddressingWireFields?: boolean;
  includeLegacySpaceFilesOriginWireFields?: boolean;
  onInvalidSuccessPayload?: () => void;
  onValidatedSuccess?: (input: {
    payload: unknown;
    result: unknown;
    status: number;
  }) => void;
  resolveSuccessHeaders?: (input: {
    payload: unknown;
    result: unknown;
    status: number;
  }) => HeadersInit | undefined;
  resolveSuccessPayload?: (result: unknown) => unknown;
  resolveErrorSurface?: (
    input: ResolveRpcRouteErrorSurfaceInput
  ) => GatewayErrorSurface | null | undefined;
  retryMode?: "transient" | "none";
  responseSchema?: z.ZodType<unknown>;
  successStatus?: number;
};

type ResolveRpcRouteErrorSurfaceInput = {
  code?: string;
  message: string;
  status: number;
};

type GatewayErrorSurface = {
  code: GatewayErrorCode;
  upstreamCode?: string;
};

export function readSpacePasswordHeader(headers: Headers): string | undefined {
  return readSpacePasswordHeaderValue(headers);
}

type ExecutePublicRpcRouteInput = {
  c: Context<HonoBindings>;
  route: string;
  method: RpcHttpMethod;
  execute: () => Promise<unknown>;
  includeLegacySpaceAddressingWireFields?: boolean;
  includeLegacySpaceFilesOriginWireFields?: boolean;
  retryMode?: "transient" | "none";
  responseSchema?: z.ZodType<unknown>;
  successStatus?: number;
  resolveSuccessHeaders?: ExecuteRpcRouteInput["resolveSuccessHeaders"];
};

type RespondBadRequestInput = {
  c: Context<HonoBindings>;
  route: string;
  method: RpcHttpMethod;
  message: string;
  code?: GatewayErrorCode;
  reason?: string;
  spaceId?: string;
};

type RespondPublicBadRequestInput = {
  c: Context<HonoBindings>;
  route: string;
  method: RpcHttpMethod;
  message: string;
  code?: GatewayErrorCode;
  reason?: string;
};

type RespondProfileNotFoundInput = {
  c: Context<HonoBindings>;
  route: string;
  method: RpcHttpMethod;
  reason?: string;
  spaceId?: string;
};

type CoreRpcErrorInput = {
  err: unknown;
  c: Context<HonoBindings>;
  route: string;
  method: RpcHttpMethod;
  spaceId?: string;
  resolveErrorSurface?: (
    input: ResolveRpcRouteErrorSurfaceInput
  ) => GatewayErrorSurface | null | undefined;
};

const DIRECT_GATEWAY_ERROR_CODES = [
  "bad_request",
  "invalid_json",
  "invalid_payload",
  "invalid_space_id",
  "invalid_device_id",
  "auth.unauthenticated",
  "connected_computer.enrollment_invalid",
  "device.forgotten",
  "profile.not_found",
  "profile.invalid_input",
  "organization.context_required",
  "organization.context_unavailable",
  "organization.membership_required",
  "organization.role_required",
  "usage.store_unavailable",
  ...MESSAGE_CHANNEL_ERROR_CODES,
  ...ORGANIZATION_DOCUMENT_ERROR_CODES,
  ...ORGANIZATION_SKILL_ERROR_CODES,
  ...PLUGIN_ERROR_CODES,
  "connector.organization_context_changed",
  "organization_binding_authorization.binding_required",
  "organization_binding_authorization.no_bindings",
  "organization_binding_authorization.preference_unavailable",
  "organization_binding_authorization.profile_org_mismatch",
  "organization_binding_authorization.profile_owner_mismatch",
  "agent_profile_binding.model_not_supported",
  "agent_profile_binding.reasoning_level_not_supported",
  "center_agent.designation_required",
  "center_agent.designation_store_unavailable",
  "center_agent.not_designated",
  "center_agent.permission_required",
  "center_agent.profile_binding_required",
  "center_agent.profile_org_mismatch",
  "center_agent.profile_invalid",
  "center_agent.profile_not_found",
  "center_agent.audit_store_unavailable",
  "center_agent.dm_open_failed",
  ...CENTER_AGENT_ROUTINE_ERROR_CODES,
  "slack.workspace_already_bound",
  "slack.organization_already_bound",
  "slack.workspace_not_connected",
  "slack.identity_link_token_invalid",
  "slack.identity_link_membership_required",
  "slack.identity_already_linked",
  "direct_message.open_failed",
  "direct_message.self_not_allowed",
  "direct_message.target_not_found",
  "direct_message.conversion_required",
  "direct_message_session.agent_not_found",
  "direct_message_session.forbidden",
  "direct_message_session.not_found",
  "member_agents.disabled",
  "invalid_password_payload",
  "space.forbidden",
  "space.not_found",
  "space.leave_space.creator_forbidden",
  "space.members.creator_forbidden",
  "space.members.current_profile_forbidden",
  SPACE_ADDRESSING_TARGET_INVALID_ERROR_CODE,
  "space.wake.client_message_id_required",
  "space.wake.handoff_seed_failed",
  "space.wake.target_invalid",
  "space.wake_progress.store_unavailable",
  "space_index.store_unavailable",
  "space.password_required",
  "space.membership_required",
  "space.password_invalid",
  "space.password_too_short",
  "space.access_mode.password_not_configured",
  "space.publication_mode.owner_required",
  "space.publication_mode.password_not_configured",
  ...SPACE_FILE_ERROR_CODES,
  ...SPACE_TASK_ERROR_CODES,
  "attachment_too_large",
  "attachment_type_unsupported",
  "attachment_content_mismatch",
  "attachment_not_found",
  "attachment_reference_invalid",
  "attachment_storage_failed",
  "diagnostic_report.reported_signal_not_found",
  "diagnostic_report.store_unavailable",
  ...FEEDBACK_SUBMIT_ERROR_CODES,
  "start.session.retired",
  "prepare.session.navigation_action_already_started",
  "prepare.session.not_found",
  "prepare.session.revision_conflict",
  "prepare.session.store_unavailable",
  "prepare.session.terminal_stale",
  "prepare.session.token_invalid",
  "upstream_unreachable",
] as const satisfies readonly GatewayErrorCode[];

const DIRECT_GATEWAY_ERROR_CODE_SET = new Set<string>(
  DIRECT_GATEWAY_ERROR_CODES
);

const CORE_RPC_ERROR_CODE_ALIASES = new Map<string, GatewayErrorCode>([
  ["invalid_create_payload", "invalid_payload"],
  ["profile_not_found", "profile.not_found"],
  ["profile_invalid_input", "profile.invalid_input"],
]);

export async function executeRpcRoute(
  input: ExecuteRpcRouteInput
): Promise<Response> {
  const { c, route, method, spaceId } = input;
  const context = c.var.openMeldRequestContext;
  const requestId = resolvePublicRouteRequestId(c);
  const startedAt = c.var.startedAt;

  try {
    const result = await executeRpcWithRetryPolicy(input);
    const successPayload = input.resolveSuccessPayload
      ? input.resolveSuccessPayload(result)
      : result;
    const validatedResult = validateSuccessResponse({
      c,
      route,
      method,
      spaceId,
      result: successPayload,
      responseSchema: input.responseSchema,
    });
    if (!validatedResult.ok) {
      input.onInvalidSuccessPayload?.();
      return validatedResult.response;
    }
    input.onValidatedSuccess?.({
      payload: validatedResult.payload,
      result,
      status: input.successStatus ?? 200,
    });

    logAuditEvent({
      event: "http.forward",
      route,
      method,
      status: input.successStatus ?? 200,
      latencyMs: Date.now() - startedAt,
      ...(spaceId ? { spaceId } : {}),
      ...(context ? contextAuditFields(context) : { requestId }),
    });

    const status = input.successStatus ?? 200;
    const successHeaders = input.resolveSuccessHeaders?.({
      payload: validatedResult.payload,
      result,
      status,
    });
    const addressingProjected =
      input.includeLegacySpaceAddressingWireFields &&
      !supportsCurrentSpaceAddressing(c.req.raw.headers)
        ? toLegacySpaceAddressingWireValue(validatedResult.payload)
        : validatedResult.payload;
    const originProjected =
      input.includeLegacySpaceFilesOriginWireFields &&
      !supportsSpaceFilesOriginCapability(c.req.raw.headers)
        ? toLegacySpaceFilesOriginWireValue(addressingProjected)
        : addressingProjected;
    const responsePayload = supportsSpaceImageGeometryCapability(
      c.req.raw.headers
    )
      ? originProjected
      : toLegacySpaceImageGeometryWireValue(originProjected);
    return withRequestIdHeader(
      Response.json(
        projectSpaceAccessResponse(responsePayload, route, c.req.raw.headers),
        {
          ...(successHeaders ? { headers: successHeaders } : {}),
          status,
        }
      ),
      requestId
    );
  } catch (err) {
    return mapCoreRpcError({
      err,
      c,
      route,
      method,
      spaceId,
      ...(input.resolveErrorSurface
        ? { resolveErrorSurface: input.resolveErrorSurface }
        : {}),
    });
  }
}

export async function executePublicRpcRoute(
  input: ExecutePublicRpcRouteInput
): Promise<Response> {
  const { c, route, method } = input;
  const requestId = resolvePublicRouteRequestId(c);
  const startedAt = c.var.startedAt;

  try {
    const result = await executeRpcWithRetryPolicy(input);
    const validatedResult = validateSuccessResponseForRequestId({
      c,
      route,
      method,
      result,
      responseSchema: input.responseSchema,
      requestId,
    });
    if (!validatedResult.ok) {
      return validatedResult.response;
    }

    logAuditEvent({
      event: "http.forward",
      route,
      method,
      status: input.successStatus ?? 200,
      latencyMs: Date.now() - startedAt,
      requestId,
    });

    const addressingProjected =
      input.includeLegacySpaceAddressingWireFields &&
      !supportsCurrentSpaceAddressing(c.req.raw.headers)
        ? toLegacySpaceAddressingWireValue(validatedResult.payload)
        : validatedResult.payload;
    const originProjected =
      input.includeLegacySpaceFilesOriginWireFields &&
      !supportsSpaceFilesOriginCapability(c.req.raw.headers)
        ? toLegacySpaceFilesOriginWireValue(addressingProjected)
        : addressingProjected;
    const responsePayload = supportsSpaceImageGeometryCapability(
      c.req.raw.headers
    )
      ? originProjected
      : toLegacySpaceImageGeometryWireValue(originProjected);
    return withRequestIdHeader(
      Response.json(
        projectSpaceAccessResponse(responsePayload, route, c.req.raw.headers),
        {
          status: input.successStatus ?? 200,
          headers: input.resolveSuccessHeaders?.({
            payload: validatedResult.payload,
            result,
            status: input.successStatus ?? 200,
          }),
        }
      ),
      requestId
    );
  } catch (err) {
    return mapPublicCoreRpcError({
      err,
      c,
      route,
      method,
    });
  }
}

function projectSpaceAccessResponse(
  value: unknown,
  route: string,
  headers: Headers
): unknown {
  switch (route) {
    case "/v1/spaces":
    case "/v1/spaces/:spaceId/meta":
    case "/v1/spaces/:spaceId/status":
    case "/v1/spaces/:spaceId/bootstrap":
      return projectSpaceAccessViewForVersion(
        value,
        headers.get(SPACE_ACCESS_VERSION_HEADER)
      );
    default:
      return value;
  }
}

export function supportsCurrentSpaceAddressing(headers: Headers): boolean {
  return (
    headers.get(OPENMELD_HEADER_SPACE_ADDRESSING_VERSION) ===
    OPENMELD_SPACE_ADDRESSING_VERSION
  );
}

/**
 * Whether the caller declared it understands `origin` on Space Files
 * responses. An already-published Web build or CLI never sends this header,
 * so `executeRpcRoute`/`executePublicRpcRoute` downgrade the response to the
 * pre-origin shape for it (see `includeLegacySpaceFilesOriginWireFields`).
 * The two raw Space Files routes that bypass those helpers
 * (`uploadSpaceFile`, `updateSpaceFileContent` in `rpc-http.space-files.ts`)
 * call this directly.
 */
export function supportsSpaceFilesOriginCapability(headers: Headers): boolean {
  return (
    headers.get(OPENMELD_HEADER_SPACE_FILES_ORIGIN_VERSION) ===
    OPENMELD_SPACE_FILES_ORIGIN_VERSION
  );
}

export function supportsSpaceImageGeometryCapability(
  headers: Headers
): boolean {
  return (
    headers.get(OPENMELD_HEADER_SPACE_IMAGE_GEOMETRY_VERSION) ===
    OPENMELD_SPACE_IMAGE_GEOMETRY_VERSION
  );
}

async function executeRpcWithRetryPolicy(
  input: ExecuteRpcRouteInput
): Promise<unknown> {
  const retryMode = input.retryMode ?? defaultRetryModeForMethod(input.method);
  if (retryMode === "none") {
    return await input.execute();
  }
  return await withUpstreamRetry(input.execute);
}

function defaultRetryModeForMethod(
  method: RpcHttpMethod
): "transient" | "none" {
  // Retrying non-idempotent writes can duplicate side effects under
  // partial-failure conditions (mutation applied but response lost).
  return method === "GET" ? "transient" : "none";
}

export function respondBadRequest(input: RespondBadRequestInput): Response {
  const { c, route, method, spaceId, reason } = input;
  const context = c.var.openMeldRequestContext;

  logAuditEvent({
    event: "http.forward",
    route,
    method,
    status: 400,
    latencyMs: Date.now() - c.var.startedAt,
    ...(spaceId ? { spaceId } : {}),
    ...(reason ? { reason: formatAuditValue(reason, 320) } : {}),
    ...contextAuditFields(context),
  });

  return jsonErrorResponse({
    status: 400,
    code: input.code ?? "bad_request",
    message: input.message,
    requestId: context.actorContext.requestId,
  });
}

export function respondPayloadTooLarge(
  input: Omit<RespondBadRequestInput, "code">
): Response {
  const { c, route, method, spaceId, reason } = input;
  const context = c.var.openMeldRequestContext;
  logAuditEvent({
    event: "http.forward",
    route,
    method,
    status: 413,
    latencyMs: Date.now() - c.var.startedAt,
    ...(spaceId ? { spaceId } : {}),
    ...(reason ? { reason: formatAuditValue(reason, 320) } : {}),
    ...contextAuditFields(context),
  });
  return jsonErrorResponse({
    status: 413,
    code: "bad_request",
    message: input.message,
    requestId: context.actorContext.requestId,
  });
}

export function respondPublicBadRequest(
  input: RespondPublicBadRequestInput
): Response {
  const { c, route, method, reason } = input;
  const requestId = resolvePublicRouteRequestId(c);

  logAuditEvent({
    event: "http.forward",
    route,
    method,
    status: 400,
    latencyMs: Date.now() - c.var.startedAt,
    requestId,
    ...(reason ? { reason: formatAuditValue(reason, 320) } : {}),
  });

  return jsonErrorResponse({
    status: 400,
    code: input.code ?? "bad_request",
    message: input.message,
    requestId,
  });
}

export function respondProfileNotFound(
  input: RespondProfileNotFoundInput
): Response {
  const { c, route, method, spaceId, reason } = input;
  const context = c.var.openMeldRequestContext;

  logAuditEvent({
    event: "http.forward",
    route,
    method,
    status: 404,
    latencyMs: Date.now() - c.var.startedAt,
    ...(spaceId ? { spaceId } : {}),
    ...(reason ? { reason: formatAuditValue(reason, 320) } : {}),
    ...contextAuditFields(context),
  });

  return jsonErrorResponse({
    status: 404,
    code: "profile.not_found",
    message: "profile not found",
    requestId: context.actorContext.requestId,
  });
}

export function formatAuditValue(value: unknown, maxLength = 160): string {
  const raw =
    typeof value === "string"
      ? value
      : (() => {
          try {
            const serialized = JSON.stringify(value);
            return serialized ?? String(value);
          } catch {
            return String(value);
          }
        })();

  if (raw.length <= maxLength) {
    return raw;
  }

  return `${raw.slice(0, maxLength)}...`;
}

export function buildCoreRpcContext(
  c: Context<HonoBindings>
): CoreRpcContextInput {
  return c.var.openMeldRequestContext;
}

/**
 * For sensitive operations only (design-plans/member-agent-program.md §4.7).
 * The claims' credential kind can come from Auth's cookie cache, which may
 * predate the CLI marker, so an interactive session is re-checked against
 * the database here; anything else stays the CLI credential.
 */
export async function buildCoreRpcCredential(
  c: Context<HonoBindings>
): Promise<HonoBindings["Variables"]["requestCredential"]> {
  const credential = c.var.requestCredential;
  if (credential.kind !== "interactive_session") {
    return credential;
  }
  const kind = await resolveRequestCredentialKind({
    authRpc: c.var.authRpc,
    headers: c.req.raw.headers,
  }).catch(() => "cli_credential" as const);
  return { ...credential, kind };
}

function mapCoreRpcError(input: CoreRpcErrorInput): Response {
  const { c, route, method, spaceId, err } = input;
  const context = c.var.openMeldRequestContext;
  if (!context) {
    return mapPublicCoreRpcError(input);
  }
  const startedAt = c.var.startedAt;
  const parsed = parseRpcHttpError(err);

  if (parsed) {
    logAuditEvent({
      event: "http.forward",
      route,
      method,
      status: parsed.status,
      latencyMs: Date.now() - startedAt,
      ...(spaceId ? { spaceId } : {}),
      errorCode: parsed.code ?? `upstream_http_${parsed.status}`,
      reason: formatAuditValue(
        sanitizeDispatchErrorSummary(parsed.message) ??
          "Unknown upstream error",
        320
      ),
      ...contextAuditFields(context),
    });

    return jsonErrorResponse({
      status: parsed.status,
      ...(input.resolveErrorSurface?.(parsed) ??
        resolveGatewayUpstreamErrorSurface(parsed.code)),
      message: parsed.message,
      requestId: context.actorContext.requestId,
    });
  }

  logAuditEvent({
    event: "http.forward.error",
    route,
    method,
    status: 502,
    latencyMs: Date.now() - startedAt,
    ...(spaceId ? { spaceId } : {}),
    errorCode: "upstream_unreachable",
    reason: formatAuditValue(
      sanitizeDispatchErrorSummary(toErrorMessage(err)) ??
        "Unknown upstream error",
      320
    ),
    ...contextAuditFields(context),
  });

  return jsonErrorResponse({
    status: 502,
    code: "upstream_unreachable",
    message: toErrorMessage(err),
    requestId: context.actorContext.requestId,
  });
}

function mapPublicCoreRpcError(input: CoreRpcErrorInput): Response {
  const { c, route, method, err } = input;
  const requestId = resolvePublicRouteRequestId(c);
  const startedAt = c.var.startedAt;
  const parsed = parseRpcHttpError(err);

  if (parsed) {
    logAuditEvent({
      event: "http.forward",
      route,
      method,
      status: parsed.status,
      latencyMs: Date.now() - startedAt,
      requestId,
    });

    return jsonErrorResponse({
      status: parsed.status,
      ...resolveGatewayUpstreamErrorSurface(parsed.code),
      message: parsed.message,
      requestId,
    });
  }

  logAuditEvent({
    event: "http.forward.error",
    route,
    method,
    status: 502,
    latencyMs: Date.now() - startedAt,
    errorCode: "upstream_unreachable",
    requestId,
  });

  return jsonErrorResponse({
    status: 502,
    code: "upstream_unreachable",
    message: toErrorMessage(err),
    requestId,
  });
}

export function resolvePublicRouteRequestId(c: Context<HonoBindings>): string {
  if (c.var.spaceAccessContext) {
    return getSpaceAccessRequestId(c.var.spaceAccessContext);
  }
  if (c.var.openMeldRequestContext) {
    return c.var.openMeldRequestContext.actorContext.requestId;
  }
  return c.var.ingressOpenMeldContext.requestId;
}

function parseRpcHttpError(
  err: unknown
): { status: number; message: string; code?: string } | null {
  // Parse RPC errors from structured fields (status/message), including
  // values carried through Error.cause.
  // For legacy compatibility, also parse "HTTP <status>: <message>" strings.
  // If no recognizable shape is found, caller maps it to upstream_unreachable.
  return parseStructuredRpcHttpError(err) ?? parseLegacyHttpStyleError(err);
}

function parseStructuredRpcHttpError(
  err: unknown
): { status: number; message: string; code?: string } | null {
  if (err instanceof Error) {
    const withCause = err as Error & { cause?: unknown };
    const caused = extractStructuredRpcHttpError(withCause.cause);
    if (caused) {
      return caused;
    }
  }

  return extractStructuredRpcHttpError(err);
}

function extractStructuredRpcHttpError(
  value: unknown
): { status: number; message: string; code?: string } | null {
  if (!value || typeof value !== "object") {
    return null;
  }

  const obj = value as {
    code?: unknown;
    status?: unknown;
    message?: unknown;
    error?: unknown;
  };

  const nested = extractStructuredRpcHttpError(obj.error);
  if (nested) {
    return nested;
  }

  const status =
    typeof obj.status === "number" ? Math.trunc(obj.status) : Number.NaN;
  if (!Number.isFinite(status) || status < 400 || status > 599) {
    return null;
  }

  return {
    status,
    message: extractRpcMessage(obj.message) || `upstream_http_${status}`,
    ...(typeof obj.code === "string" && obj.code.trim().length > 0
      ? { code: obj.code.trim() }
      : {}),
  };
}

function extractRpcMessage(value: unknown): string {
  if (typeof value === "string") {
    return value.trim();
  }

  if (!value || typeof value !== "object") {
    return "";
  }

  const obj = value as {
    message?: unknown;
    error?: unknown;
  };
  const nestedError = extractRpcMessage(obj.error);
  if (nestedError) {
    return nestedError;
  }

  return extractRpcMessage(obj.message);
}

function extractRpcCode(value: unknown): string {
  if (!value || typeof value !== "object") {
    return "";
  }

  const obj = value as {
    code?: unknown;
    error?: unknown;
    message?: unknown;
  };
  const nestedCode = extractRpcCode(obj.error);
  if (nestedCode) {
    return nestedCode;
  }

  return typeof obj.code === "string" ? obj.code.trim() : "";
}

const LEGACY_HTTP_ERROR_REGEX = /^HTTP\s+(\d{3})(?::\s*(.*))?$/i;

function parseLegacyHttpStyleError(
  err: unknown
): { status: number; message: string; code?: string } | null {
  const text = extractLegacyHttpErrorText(err);
  if (!text) {
    return null;
  }

  const match = LEGACY_HTTP_ERROR_REGEX.exec(text);
  if (!match) {
    return null;
  }

  const [, statusRaw = "", reasonRaw = ""] = match;
  const status = Number.parseInt(statusRaw, 10);
  if (!Number.isFinite(status) || status < 400 || status > 599) {
    return null;
  }

  const reason = reasonRaw.trim();
  if (reason.length === 0) {
    return { status, message: `upstream_http_${status}` };
  }

  const parsedReason = extractLegacyReasonPayload(reason);
  if (parsedReason) {
    return {
      status,
      message: parsedReason.message || reason,
      ...(parsedReason.code ? { code: parsedReason.code } : {}),
    };
  }

  const legacyCode = resolveLegacyGatewayUpstreamErrorCode(status, reason);
  return {
    status,
    message: reason,
    ...(legacyCode ? { code: legacyCode } : {}),
  };
}

function resolveGatewayUpstreamErrorSurface(code?: string): {
  code: GatewayErrorCode;
  upstreamCode?: string;
} {
  const normalized = code?.trim();
  if (!normalized) {
    return { code: "upstream_error" };
  }
  if (DIRECT_GATEWAY_ERROR_CODE_SET.has(normalized)) {
    return { code: normalized as GatewayErrorCode };
  }
  const mapped = CORE_RPC_ERROR_CODE_ALIASES.get(normalized);
  if (mapped) {
    return mapped === normalized
      ? { code: mapped }
      : { code: mapped, upstreamCode: normalized };
  }
  return {
    code: "upstream_error",
    upstreamCode: normalized,
  };
}

export function resolveGatewayStructuredRpcErrorResponse(input: {
  err: unknown;
  requestId: string;
}): {
  status: number;
  code: GatewayErrorCode;
  message: string;
  requestId: string;
  upstreamCode?: string;
} | null {
  const parsed = parseRpcHttpError(input.err);
  if (!parsed) {
    return null;
  }
  return {
    status: parsed.status,
    ...resolveGatewayUpstreamErrorSurface(parsed.code),
    message: parsed.message,
    requestId: input.requestId,
  };
}

function extractLegacyHttpErrorText(err: unknown): string {
  if (typeof err === "string") {
    return err.trim();
  }

  if (err instanceof Error) {
    return err.message.trim();
  }

  return "";
}

const LEGACY_GATEWAY_UPSTREAM_EXACT_ERROR_CODE_MAP = new Map<
  `${number}:${string}`,
  GatewayErrorCode
>([
  ["404:space not found", "space.not_found"],
  ["401:space password required", "space.password_required"],
  ["403:space password invalid", "space.password_invalid"],
]);

const LEGACY_GATEWAY_UPSTREAM_PREFIX_ERROR_MATCHERS: ReadonlyArray<{
  status: number;
  prefix: string;
  code: GatewayErrorCode;
}> = [
  {
    status: 404,
    prefix: "invalid space id",
    code: "invalid_space_id",
  },
];

function resolveLegacyGatewayUpstreamErrorCode(
  status: number,
  reason: string
): GatewayErrorCode | undefined {
  const normalizedReason = reason.trim().toLowerCase();
  const exactCode = LEGACY_GATEWAY_UPSTREAM_EXACT_ERROR_CODE_MAP.get(
    `${status}:${normalizedReason}`
  );
  if (exactCode) {
    return exactCode;
  }

  return LEGACY_GATEWAY_UPSTREAM_PREFIX_ERROR_MATCHERS.find(
    (matcher) =>
      matcher.status === status && normalizedReason.startsWith(matcher.prefix)
  )?.code;
}

function extractLegacyReasonPayload(reason: string): {
  message: string;
  code?: string;
} | null {
  const parsed = safeJsonParse(reason);
  if (parsed === null) {
    return null;
  }

  const message = extractRpcMessage(parsed);
  const code = extractRpcCode(parsed);
  if (!(message || code)) {
    return null;
  }

  return {
    message,
    ...(code ? { code } : {}),
  };
}

function safeJsonParse(input: string): unknown | null {
  try {
    return JSON.parse(input);
  } catch {
    return null;
  }
}

function validateSuccessResponse(input: {
  c: Context<HonoBindings>;
  route: string;
  method: RpcHttpMethod;
  spaceId?: string;
  result: unknown;
  responseSchema?: z.ZodType<unknown>;
}): { ok: true; payload: unknown } | { ok: false; response: Response } {
  return validateSuccessResponseForRequestId({
    ...input,
    requestId: resolvePublicRouteRequestId(input.c),
  });
}

function validateSuccessResponseForRequestId(input: {
  c: Context<HonoBindings>;
  route: string;
  method: RpcHttpMethod;
  spaceId?: string;
  result: unknown;
  responseSchema?: z.ZodType<unknown>;
  requestId: string;
}): { ok: true; payload: unknown } | { ok: false; response: Response } {
  if (!input.responseSchema) {
    return {
      ok: true,
      payload: input.result,
    };
  }

  const parsed = input.responseSchema.safeParse(input.result);
  if (parsed.success) {
    return {
      ok: true,
      payload: parsed.data,
    };
  }

  const firstIssue = parsed.error.issues[0];
  const issuePath = firstIssue?.path.join(".") || "root";
  const issueMessage =
    firstIssue?.message ?? "Gateway received an invalid success payload";

  logAuditEvent({
    event: "http.forward.error",
    route: input.route,
    method: input.method,
    status: 502,
    latencyMs: Date.now() - input.c.var.startedAt,
    ...(input.spaceId ? { spaceId: input.spaceId } : {}),
    errorCode: "upstream_error",
    reason: formatAuditValue(
      `invalid_success_payload ${issuePath} ${issueMessage}`,
      320
    ),
    ...(input.c.var.openMeldRequestContext
      ? contextAuditFields(input.c.var.openMeldRequestContext)
      : { requestId: input.requestId }),
  });

  return {
    ok: false,
    response: jsonErrorResponse({
      status: 502,
      code: "upstream_error",
      message: "upstream returned invalid response payload",
      requestId: input.requestId,
    }),
  };
}

type JsonBodyParseResult<T> =
  | {
      data: T;
      ok: true;
    }
  | {
      ok: false;
      response: Response;
    };

export async function parseJsonBody<T>(
  c: Context<HonoBindings>,
  schema: z.ZodType<T>
): Promise<JsonBodyParseResult<T>> {
  let body: unknown = {};
  const rawBody = (await c.req.text()).trim();
  if (rawBody.length > 0) {
    try {
      body = JSON.parse(rawBody);
    } catch {
      return {
        ok: false,
        response: respondBadRequest({
          c,
          route: c.req.path,
          method: c.req.method as "POST" | "PUT" | "PATCH",
          code: "invalid_json",
          message: "Invalid JSON",
        }),
      };
    }
  }
  const parsed = schema.safeParse(body);
  if (!parsed.success) {
    return {
      ok: false,
      response: respondBadRequest({
        c,
        route: c.req.path,
        method: c.req.method as "POST" | "PUT" | "PATCH",
        code: "invalid_payload",
        message: parsed.error.issues[0]?.message ?? "Invalid payload.",
      }),
    };
  }
  return {
    data: parsed.data,
    ok: true,
  };
}
