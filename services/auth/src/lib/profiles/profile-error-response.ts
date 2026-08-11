import {
  AdditionalHumanProfileCreationDisabledError,
  PrimaryHumanProfileDeleteForbiddenError,
  ProfileNotFoundError,
  ProfileValidationError,
} from "@openmeld/auth/server";
import {
  ADDITIONAL_HUMAN_PROFILE_CREATION_DISABLED_CODE,
  ADDITIONAL_HUMAN_PROFILE_CREATION_DISABLED_MESSAGE,
  additionalHumanProfileCreationDisabledRpcErrorResponseSchema,
} from "@openmeld/schemas";
import type {
  ProfileErrorResponse,
  ProfileErrorStatus,
  ProfileRpcErrorResponse,
} from "@openmeld/schemas/types";

const ADDITIONAL_HUMAN_PROFILE_CREATION_DISABLED_RESPONSE =
  additionalHumanProfileCreationDisabledRpcErrorResponseSchema.parse({
    code: ADDITIONAL_HUMAN_PROFILE_CREATION_DISABLED_CODE,
    message: ADDITIONAL_HUMAN_PROFILE_CREATION_DISABLED_MESSAGE,
    ok: false,
    status: 409,
  });

export function toProfileRpcErrorResponse(
  error: unknown
): ProfileRpcErrorResponse {
  if (error instanceof AdditionalHumanProfileCreationDisabledError) {
    return ADDITIONAL_HUMAN_PROFILE_CREATION_DISABLED_RESPONSE;
  }

  if (error instanceof PrimaryHumanProfileDeleteForbiddenError) {
    return toProfileErrorResponse(error.code, error.message, 400);
  }

  if (error instanceof ProfileNotFoundError) {
    return toProfileErrorResponse(error.code, error.message, 404);
  }

  if (error instanceof ProfileValidationError) {
    return toProfileErrorResponse(error.code, error.message, 400);
  }

  return toProfileErrorResponse(
    "profile.internal_error",
    "internal error",
    500
  );
}

export function toProfileHttpErrorResponse(error: unknown): {
  body: ProfileErrorResponse;
  status: ProfileErrorStatus;
} {
  const { status, ...body } = toProfileRpcErrorResponse(error);
  return { body, status };
}

function toProfileErrorResponse(
  code: string,
  message: string,
  status: ProfileErrorStatus
): ProfileRpcErrorResponse {
  return { code, message, ok: false, status };
}
