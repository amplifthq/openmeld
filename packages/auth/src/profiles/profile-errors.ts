import {
  ADDITIONAL_HUMAN_PROFILE_CREATION_DISABLED_CODE,
  ADDITIONAL_HUMAN_PROFILE_CREATION_DISABLED_MESSAGE,
} from "@openmeld/schemas";

export class ProfileNotFoundError extends Error {
  readonly code = "profile.not_found" as const;

  constructor(message = "profile not found") {
    super(message);
    this.name = "ProfileNotFoundError";
  }
}

export class ProfileValidationError extends Error {
  readonly code: string;

  constructor(message: string, code = "profile.invalid_input") {
    super(message);
    this.code = code;
    this.name = "ProfileValidationError";
  }
}

export class PrimaryHumanProfileDeleteForbiddenError extends Error {
  readonly code = "profile.primary_human_delete_forbidden" as const;

  constructor(message = "primary human profile cannot be deleted") {
    super(message);
    this.name = "PrimaryHumanProfileDeleteForbiddenError";
  }
}

export class AdditionalHumanProfileCreationDisabledError extends Error {
  readonly code = ADDITIONAL_HUMAN_PROFILE_CREATION_DISABLED_CODE;

  constructor(message = ADDITIONAL_HUMAN_PROFILE_CREATION_DISABLED_MESSAGE) {
    super(message);
    this.name = "AdditionalHumanProfileCreationDisabledError";
  }
}
