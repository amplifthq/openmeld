const SAFE_SHELL_WORD_RE = /^[A-Za-z0-9_./:@%+=,-]+$/u;
export const OPENMELD_SETUP_SCRIPT_END_MARKER =
  "# openmeld-setup-script-complete-v1";

function downloadScript(httpsOnly: boolean): string {
  const protocolOptions = httpsOnly
    ? "--proto '=https' --proto-redir '=https' "
    : "";
  return `setup_file=$(mktemp "\${TMPDIR:-/tmp}/openmeld-setup.XXXXXX") || exit 1; trap 'rm -f "$setup_file"' EXIT; curl -fsSL ${protocolOptions}--connect-timeout 10 --speed-limit 1 --speed-time 30 -o "$setup_file" "$1" || exit 1; [ -s "$setup_file" ] || { echo 'OpenMeld setup download was empty.' >&2; exit 1; }; [ "$(tail -n 1 "$setup_file")" = '${OPENMELD_SETUP_SCRIPT_END_MARKER}' ] || { echo 'OpenMeld setup download was incomplete.' >&2; exit 1; }; shift; sh "$setup_file" "$@" < /dev/null`;
}

function shellWord(value: string): string {
  return SAFE_SHELL_WORD_RE.test(value)
    ? value
    : `'${value.replaceAll("'", "'\\''")}'`;
}

/** Keep the copied command on one line while checking download success before running it. */
export function buildPosixSetupDownloadCommand(
  setupUrl: string,
  setupArgs: readonly string[] = []
): string {
  const protocol = new URL(setupUrl).protocol;
  if (!(protocol === "https:" || protocol === "http:")) {
    throw new Error("OpenMeld setup requires an HTTP or HTTPS download URL.");
  }
  return [
    "sh",
    "-c",
    shellWord(downloadScript(protocol === "https:")),
    "sh",
    shellWord(setupUrl),
    ...setupArgs.map(shellWord),
  ].join(" ");
}
