const SAFE_SHELL_WORD_RE = /^[A-Za-z0-9_./:@%+=,-]+$/u;
export const OPENMELD_SETUP_SCRIPT_END_MARKER =
  "# openmeld-setup-script-complete-v1";

function shellWord(value: string): string {
  return SAFE_SHELL_WORD_RE.test(value)
    ? value
    : `'${value.replaceAll("'", "'\\''")}'`;
}

/** Keep the zero-dependency setup handoff readable in Terminal. */
export function buildPosixSetupDownloadCommand(
  setupUrl: string,
  setupArgs: readonly string[] = []
): string {
  const protocol = new URL(setupUrl).protocol;
  if (!(protocol === "https:" || protocol === "http:")) {
    throw new Error("OpenMeld setup requires an HTTP or HTTPS download URL.");
  }
  const protocolOptions =
    protocol === "https:" ? " --proto '=https' --proto-redir '=https'" : "";
  return `curl -fsSL${protocolOptions} ${shellWord(setupUrl)} | sh -s -- ${setupArgs.map(shellWord).join(" ")}`.trimEnd();
}
