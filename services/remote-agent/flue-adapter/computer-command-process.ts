/** Keep the native retained PID in charge of the command's entire process group.
 * computerd signals its spawned shell PID, which otherwise leaves shell children
 * running. exec replaces that shell with Tini; -g forwards signals to this
 * command's group and -s reaps orphaned children without becoming container init.
 */
export function buildComputerCommandProcess(command: string): string {
  const quoted = `'${command.replaceAll("'", "'\\''")}'`;
  return `exec /usr/bin/tini -s -g -- /bin/sh -c ${quoted}`;
}
