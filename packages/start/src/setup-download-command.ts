const SAFE_SHELL_WORD_RE = /^[A-Za-z0-9_./:@%+=,-]+$/u;

const DOWNLOAD_SCRIPT = `setup_file=$(mktemp "\${TMPDIR:-/tmp}/openmeld-setup.XXXXXX") || exit 1; trap 'rm -f "$setup_file"' EXIT; curl -fsSL --connect-timeout 10 --speed-limit 1 --speed-time 30 -o "$setup_file" "$1" || exit 1; [ -s "$setup_file" ] || { echo 'OpenMeld setup download was empty.' >&2; exit 1; }; shift; sh "$setup_file" "$@" < /dev/null`;

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
  return [
    "sh",
    "-c",
    shellWord(DOWNLOAD_SCRIPT),
    "sh",
    shellWord(setupUrl),
    ...setupArgs.map(shellWord),
  ].join(" ");
}
