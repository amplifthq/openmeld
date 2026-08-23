export class CliOutputHandledError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "CliOutputHandledError";
  }
}

export function isCliOutputHandledError(
  error: unknown
): error is CliOutputHandledError {
  return (
    error instanceof CliOutputHandledError ||
    (error instanceof Error && error.name === "CliOutputHandledError")
  );
}
