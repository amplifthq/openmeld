import type { CoreBindings } from "../../../lib/bindings";

export type DispatchTargetProfileIdentity = {
  defaultProjectId: string | null;
  profileHandle: string | null;
  profileName: string | null;
};

export class DispatchTargetProfileIdentityUnavailableError extends Error {
  readonly reasonCode: string;
  readonly upstreamCode: string | null;

  constructor(input: {
    cause?: unknown;
    message: string;
    reasonCode: string;
    upstreamCode?: string | null;
  }) {
    super(input.message, {
      cause: input.cause,
    });
    this.name = "DispatchTargetProfileIdentityUnavailableError";
    this.reasonCode = input.reasonCode;
    this.upstreamCode = normalizeOptionalText(input.upstreamCode);
  }
}

export const resolveDispatchTargetProfileIdentity = async (input: {
  authRpc?: CoreBindings["OPENMELD_AUTH_WORKER"];
  targetProfileId: string;
}): Promise<DispatchTargetProfileIdentity> => {
  if (
    !input.authRpc ||
    typeof input.authRpc.resolveProfileById !== "function"
  ) {
    throw new DispatchTargetProfileIdentityUnavailableError({
      message:
        "OpenMeld auth RPC is unavailable while resolving dispatch target profile identity.",
      reasonCode: "dispatch.target_profile_identity.auth_rpc_unavailable",
    });
  }

  try {
    const result = await input.authRpc.resolveProfileById({
      openMeldProfileId: input.targetProfileId,
    });
    if (!result.ok) {
      const code = normalizeOptionalText(result.code) ?? "unknown";
      const message = normalizeOptionalText(result.message) ?? "unknown";
      throw new DispatchTargetProfileIdentityUnavailableError({
        message: `resolveProfileById failed (${code}): ${message}`,
        reasonCode: "dispatch.target_profile_identity.lookup_failed",
        upstreamCode: code,
      });
    }

    return {
      defaultProjectId: normalizeOptionalText(result.profile.defaultProjectId),
      profileHandle: normalizeOptionalText(result.profile.profileHandle),
      profileName: normalizeOptionalText(result.profile.profileName),
    };
  } catch (error) {
    if (error instanceof DispatchTargetProfileIdentityUnavailableError) {
      throw error;
    }

    throw new DispatchTargetProfileIdentityUnavailableError({
      cause: error,
      message:
        "OpenMeld auth RPC threw while resolving dispatch target profile identity.",
      reasonCode: "dispatch.target_profile_identity.auth_rpc_failed",
    });
  }
};

const normalizeOptionalText = (value: unknown): string | null => {
  const normalized = String(value ?? "").trim();
  return normalized.length > 0 ? normalized : null;
};
