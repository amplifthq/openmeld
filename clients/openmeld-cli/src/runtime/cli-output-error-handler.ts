const CLI_OUTPUT_ERROR_HANDLER_MARKER = Symbol.for(
  "openmeld.cli-output-error-handler"
);

type CliOutputStream = NodeJS.WriteStream & {
  [CLI_OUTPUT_ERROR_HANDLER_MARKER]?: true;
};

export function installCliOutputErrorHandlers(): void {
  installCliOutputErrorHandler(process.stdout);
  installCliOutputErrorHandler(process.stderr);
}

function installCliOutputErrorHandler(stream: CliOutputStream): void {
  if (stream[CLI_OUTPUT_ERROR_HANDLER_MARKER]) {
    return;
  }

  stream.on("error", handleCliOutputError);
  Object.defineProperty(stream, CLI_OUTPUT_ERROR_HANDLER_MARKER, {
    value: true,
  });
}

function handleCliOutputError(error: unknown): void {
  if (isBrokenPipeError(error)) {
    return;
  }
  throw error;
}

function isBrokenPipeError(error: unknown): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    error.code === "EPIPE"
  );
}
