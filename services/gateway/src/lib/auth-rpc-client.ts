import { OPENMELD_HEADER_SPACE_PASSWORD } from "@openmeld/gateway-contract";
import {
  authRpcCredentialKindSchema,
  authRpcResolveProfileResultSchema,
  authRpcResolveRequestAuthResultSchema,
  authRpcResolveRequestAuthWithProfileResultSchema,
} from "@openmeld/schemas";
import type {
  AuthRpcClaims,
  AuthRpcResolveProfileResult,
  AuthRpcResolveRequestAuthResult,
  AuthRpcResolveRequestAuthWithProfileResult,
  OpenMeldRequestedOrganizationSelector,
  ProfileKind,
  ResolvedOpenMeldProfile,
} from "@openmeld/schemas/types";
import { withUpstreamRetry } from "./upstream-retry";

type AuthRpc = Service<
  typeof import("../../../auth/src/index").GatewayAuthRpcEntrypoint
>;
export type GatewayAuthRpcWorker = AuthRpc;
export type GatewayAuthClaims = AuthRpcClaims;
export type GatewayResolveRequestAuthResult = AuthRpcResolveRequestAuthResult;

export type GatewayResolvedProfile = ResolvedOpenMeldProfile;

export type GatewayResolveProfileResult = AuthRpcResolveProfileResult;

export async function resolveRequestAuth(input: {
  authRpc: AuthRpc;
  headers: Headers;
  requestId: string;
  requestedOrganization?: OpenMeldRequestedOrganizationSelector;
}): Promise<GatewayResolveRequestAuthResult> {
  const result = await withUpstreamRetry(async () => {
    return await input.authRpc.resolveRequestAuth({
      headers: sanitizeHeadersForAuthRpc(input.headers),
      requestId: input.requestId,
      ...(input.requestedOrganization
        ? { requestedOrganization: input.requestedOrganization }
        : {}),
    });
  });
  return authRpcResolveRequestAuthResultSchema.parse(result);
}

/** Database-backed credential kind for a sensitive operation (§4.7). */
export async function resolveRequestCredentialKind(input: {
  authRpc: AuthRpc;
  headers: Headers;
}): Promise<"cli_credential" | "interactive_session"> {
  const result = await withUpstreamRetry(
    async () =>
      await input.authRpc.resolveRequestCredentialKind({
        headers: sanitizeHeadersForAuthRpc(input.headers),
      })
  );
  return authRpcCredentialKindSchema.parse(result.credentialKind);
}

export type GatewayResolveRequestAuthWithProfileResult =
  AuthRpcResolveRequestAuthWithProfileResult;

// Single-round-trip variant used by the gateway auth middleware hot path.
export async function resolveRequestAuthWithProfile(input: {
  authRpc: AuthRpc;
  headers: Headers;
  requestId: string;
  requestedOrganization?: OpenMeldRequestedOrganizationSelector;
  openMeldProfileId?: string;
}): Promise<GatewayResolveRequestAuthWithProfileResult> {
  const result = await withUpstreamRetry(async () => {
    return await input.authRpc.resolveRequestAuthWithProfile({
      headers: sanitizeHeadersForAuthRpc(input.headers),
      requestId: input.requestId,
      ...(input.requestedOrganization
        ? { requestedOrganization: input.requestedOrganization }
        : {}),
      ...(input.openMeldProfileId
        ? { openMeldProfileId: input.openMeldProfileId }
        : {}),
    });
  });
  return authRpcResolveRequestAuthWithProfileResultSchema.parse(result);
}

export async function resolveProfile(input: {
  authRpc: AuthRpc;
  headers: Headers;
  requestId: string;
  openMeldProfileId?: string;
  profileKind?: ProfileKind;
}): Promise<GatewayResolveProfileResult> {
  const result = await withUpstreamRetry(async () => {
    return await input.authRpc.resolveProfile({
      headers: sanitizeHeadersForAuthRpc(input.headers),
      requestId: input.requestId,
      ...(input.openMeldProfileId
        ? { openMeldProfileId: input.openMeldProfileId }
        : {}),
      ...(input.profileKind ? { profileKind: input.profileKind } : {}),
    });
  });
  const parsed = authRpcResolveProfileResultSchema.safeParse(result);
  if (!parsed.success) {
    throw new Error("Auth returned an invalid Profile response.", {
      cause: parsed.error,
    });
  }
  return parsed.data;
}

export function sanitizeHeadersForAuthRpc(
  headers: Headers
): Record<string, string> {
  const result: Record<string, string> = {};
  headers.forEach((value, key) => {
    if (key.toLowerCase() === OPENMELD_HEADER_SPACE_PASSWORD) {
      return;
    }
    result[key] = value;
  });
  return result;
}
