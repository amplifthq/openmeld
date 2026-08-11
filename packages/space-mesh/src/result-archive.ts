import { resultArchiveModeSchema } from "@openmeld/schemas";
import type { ResultArchiveMode } from "@openmeld/schemas/types";

export function resolveResultArchiveBehavior(input: {
  contractMode: ResultArchiveMode;
  saveResult?: boolean;
}): {
  mode: ResultArchiveMode;
  shouldSave: boolean;
} {
  const parsedMode = resultArchiveModeSchema.safeParse(input.contractMode);
  if (!parsedMode.success) {
    throw new Error(
      parsedMode.error.issues[0]?.message ?? "result archive mode is invalid"
    );
  }

  const mode = resolveMode({
    contractMode: parsedMode.data,
    saveResult: input.saveResult,
  });
  return {
    mode,
    shouldSave: mode !== "none",
  };
}

function resolveMode(input: {
  contractMode: ResultArchiveMode;
  saveResult?: boolean;
}): ResultArchiveMode {
  if (input.saveResult === false) {
    return "none";
  }
  return input.contractMode;
}
