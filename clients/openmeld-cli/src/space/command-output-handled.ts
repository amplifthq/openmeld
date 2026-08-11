export class SpaceCommandOutputHandledError extends Error {
  readonly code = "openmeld.space.output_handled";
  readonly shouldPrintMessage: boolean;

  constructor(
    message: string,
    input: {
      shouldPrintMessage?: boolean;
    } = {}
  ) {
    super(message);
    this.name = "SpaceCommandOutputHandledError";
    this.shouldPrintMessage = input.shouldPrintMessage === true;
  }
}

export function isSpaceCommandOutputHandledError(
  error: unknown
): error is SpaceCommandOutputHandledError {
  return (
    error instanceof SpaceCommandOutputHandledError ||
    (typeof error === "object" &&
      error !== null &&
      "code" in error &&
      "message" in error &&
      "shouldPrintMessage" in error &&
      (error as { code?: unknown }).code === "openmeld.space.output_handled" &&
      typeof (error as { message?: unknown }).message === "string" &&
      typeof (error as { shouldPrintMessage?: unknown }).shouldPrintMessage ===
        "boolean")
  );
}
