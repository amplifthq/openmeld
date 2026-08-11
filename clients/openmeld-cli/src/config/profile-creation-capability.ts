import {
  ADDITIONAL_HUMAN_PROFILE_CREATION_DISABLED_CODE,
  ADDITIONAL_HUMAN_PROFILE_CREATION_DISABLED_MESSAGE,
} from "@openmeld/schemas";

export function assertAdditionalHumanProfileCreationEnabled(input: {
  additionalHumanProfileCreationEnabled: boolean;
  cause?: unknown;
}): void {
  if (input.additionalHumanProfileCreationEnabled) {
    return;
  }
  throw Object.assign(
    new Error(ADDITIONAL_HUMAN_PROFILE_CREATION_DISABLED_MESSAGE, {
      cause: input.cause,
    }),
    {
      code: ADDITIONAL_HUMAN_PROFILE_CREATION_DISABLED_CODE,
    }
  );
}
