export function shouldEmitRetentionWarning(input: {
  createOutboxRecord: boolean;
  signalType: string;
  finalDatabaseSizeBytes: number;
  thresholdBytes: number;
  nowMs: number;
  lastRetentionWarningAtMs: number;
  debounceMs: number;
}): boolean {
  if (!input.createOutboxRecord || input.signalType !== "signal.text") {
    return false;
  }
  if (input.finalDatabaseSizeBytes < input.thresholdBytes) {
    return false;
  }
  return input.nowMs - input.lastRetentionWarningAtMs >= input.debounceMs;
}
