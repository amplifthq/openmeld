/** Compatibility command for a peer that explicitly lacks supervision v1.
 * New native peers own the command group and receive the raw source instead.
 * Legacy Tini forwards catchable signals; SIGKILL cannot be forwarded.
 */
export function buildComputerCommandProcess(command: string): string {
  const quoted = `'${command.replaceAll("'", "'\\''")}'`;
  return `exec /usr/bin/tini -s -g -- /bin/sh -c ${quoted}`;
}
