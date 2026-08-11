export const AUTH_UNAUTHENTICATED_CODE = "auth.unauthenticated";
export const ORGANIZATION_CONTEXT_INVALID_CODE = "bad_request";
export const ORGANIZATION_CONTEXT_UNVERIFIED_CODE =
  "organization.context_unavailable";
export const ORGANIZATION_MEMBERSHIP_REQUIRED_CODE =
  "organization.membership_required";
export const PROFILE_NOT_FOUND_CODE = "profile.not_found";
export const PROFILE_INVALID_INPUT_CODE = "profile.invalid_input";
export const UPSTREAM_UNREACHABLE_CODE = "upstream_unreachable";

export type AuthRpcHttpError = {
  status: 400 | 401 | 403 | 404 | 502;
  code:
    | typeof AUTH_UNAUTHENTICATED_CODE
    | typeof ORGANIZATION_CONTEXT_INVALID_CODE
    | typeof ORGANIZATION_CONTEXT_UNVERIFIED_CODE
    | typeof ORGANIZATION_MEMBERSHIP_REQUIRED_CODE
    | typeof PROFILE_NOT_FOUND_CODE
    | typeof PROFILE_INVALID_INPUT_CODE
    | typeof UPSTREAM_UNREACHABLE_CODE;
  message: string;
};

export function mapAuthRpcHttpError(input: {
  code?: string;
  message?: string;
  error?: unknown;
}): AuthRpcHttpError {
  if (input.code === AUTH_UNAUTHENTICATED_CODE) {
    return {
      status: 401,
      code: AUTH_UNAUTHENTICATED_CODE,
      message: input.message ?? "authentication required",
    };
  }

  if (input.code === ORGANIZATION_CONTEXT_INVALID_CODE) {
    return {
      status: 400,
      code: ORGANIZATION_CONTEXT_INVALID_CODE,
      message: input.message ?? "Organization context is invalid.",
    };
  }

  if (input.code === ORGANIZATION_MEMBERSHIP_REQUIRED_CODE) {
    return {
      status: 403,
      code: ORGANIZATION_MEMBERSHIP_REQUIRED_CODE,
      message: input.message ?? "You do not have access to this organization.",
    };
  }

  if (input.code === ORGANIZATION_CONTEXT_UNVERIFIED_CODE) {
    return {
      status: 502,
      code: ORGANIZATION_CONTEXT_UNVERIFIED_CODE,
      message: input.message ?? "OpenMeld could not verify this organization.",
    };
  }

  if (input.code === PROFILE_NOT_FOUND_CODE) {
    return {
      status: 404,
      code: PROFILE_NOT_FOUND_CODE,
      message: input.message ?? "profile not found",
    };
  }

  if (input.code === PROFILE_INVALID_INPUT_CODE) {
    return {
      status: 400,
      code: PROFILE_INVALID_INPUT_CODE,
      message: input.message ?? "invalid profile input",
    };
  }

  return {
    status: 502,
    code: UPSTREAM_UNREACHABLE_CODE,
    message:
      readOptionalErrorMessage(input.message) ??
      readOptionalErrorMessage(input.error) ??
      "auth upstream unavailable",
  };
}

function readOptionalErrorMessage(value: unknown): string | null {
  if (typeof value === "string") {
    const normalized = value.trim();
    return normalized.length > 0 ? normalized : null;
  }

  if (value instanceof Error) {
    const normalized = value.message.trim();
    return normalized.length > 0 ? normalized : null;
  }

  return null;
}
