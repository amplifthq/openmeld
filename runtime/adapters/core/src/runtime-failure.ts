import type { CliDriverError } from "./drivers/cli-driver.js";

export type AdapterRuntimeFailure = {
  code: string;
  errorType: "adapter" | "timeout";
  message: string;
};

export const classifyCliDriverTimeoutFailure = (input: {
  error: CliDriverError;
  providerLabel: string;
  timeoutMs: number | null;
}): AdapterRuntimeFailure => {
  const observedAnyOutput =
    hasVisibleText(input.error.stdoutText) ||
    hasVisibleText(input.error.stderrText);
  const code = observedAnyOutput
    ? "timed_out_after_output"
    : "timed_out_no_output";
  const phaseText = observedAnyOutput
    ? "after producing runtime output"
    : "before producing any runtime output";
  const timeoutLabel =
    input.timeoutMs == null ? "unknown" : `${input.timeoutMs}ms`;

  return {
    code,
    errorType: "timeout",
    message: `${code}: ${input.providerLabel} invocation exceeded ${timeoutLabel} ${phaseText}`,
  };
};

export const buildProviderExitError = (input: {
  providerLabel: string;
}): AdapterRuntimeFailure => {
  return {
    code: "provider_exit_error",
    errorType: "adapter",
    message: `provider_exit_error: ${input.providerLabel} invocation exited before returning a classified upstream error`,
  };
};

const hasVisibleText = (value: string | undefined): boolean => {
  return normalizeOptionalText(value) !== null;
};

const normalizeOptionalText = (value: string | undefined): string | null => {
  if (typeof value !== "string") {
    return null;
  }
  const normalized = value.trim();
  return normalized.length > 0 ? normalized : null;
};
