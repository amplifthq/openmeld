export const MANUAL_OPENMELD_UPGRADE_COMMAND = "npm install -g openmeld@latest";
const SAFE_SHELL_ARGUMENT_PATTERN = /^[A-Za-z0-9_./:@%+=,-]+$/;

export function buildManualOpenMeldUpgradeCommand(
  input: { globalPrefixPath?: string | null } = {}
): string {
  const globalPrefixPath = input.globalPrefixPath?.trim();
  if (!globalPrefixPath) {
    return MANUAL_OPENMELD_UPGRADE_COMMAND;
  }
  return `npm install -g --prefix ${formatShellArgument(globalPrefixPath)} openmeld@latest`;
}

export const OPENMELD_UPGRADE_METADATA_RECOVERY_HINTS = [
  MANUAL_OPENMELD_UPGRADE_COMMAND,
  "openmeld reset --yes",
  "openmeld start",
  "openmeld upgrade --check",
] as const;

export const OPENMELD_UPGRADE_FAILURE_HINTS = [
  MANUAL_OPENMELD_UPGRADE_COMMAND,
  "openmeld upgrade --check",
  "openmeld upgrade --yes",
] as const;

function formatShellArgument(value: string): string {
  if (SAFE_SHELL_ARGUMENT_PATTERN.test(value)) {
    return value;
  }
  return JSON.stringify(value);
}
