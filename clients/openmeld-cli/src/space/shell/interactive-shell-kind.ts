export const INTERACTIVE_SPACE_SHELL_ENV_NAME =
  "OPENMELD_SPACE_INTERACTIVE_SHELL";

export type InteractiveHumanShellKind = "legacy" | "pi-tui";

export function resolveInteractiveHumanShellKind(): InteractiveHumanShellKind {
  const override = process.env[INTERACTIVE_SPACE_SHELL_ENV_NAME]
    ?.trim()
    .toLowerCase();
  if (override === "legacy" || override === "pi-tui") {
    return override;
  }
  if (!(process.stdin.isTTY === true && process.stdout.isTTY === true)) {
    return "legacy";
  }
  return "pi-tui";
}
