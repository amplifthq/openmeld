export type DiagnosticError = {
  cause?: DiagnosticError;
  message: string;
  name: string | null;
  stack?: string;
};

export function toDiagnosticError(
  error: unknown,
  remainingCauseDepth = 2
): DiagnosticError {
  if (!(error instanceof Error)) {
    return {
      message: String(error),
      name: null,
    };
  }

  return {
    message: error.message,
    name: error.name,
    ...(error.stack ? { stack: error.stack } : {}),
    ...(remainingCauseDepth > 0 && error.cause !== undefined
      ? {
          cause: toDiagnosticError(error.cause, remainingCauseDepth - 1),
        }
      : {}),
  };
}
