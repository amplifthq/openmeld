import type { CommandDeps } from "./commands";
import { installManagedBinary } from "./managed-binary";
import { resolveOpenMeldBin } from "./resolve-openmeld";
import { installWindowsComputerTools } from "./windows-computer-tools";

export type ComputerToolsObservation = NonNullable<
  Parameters<typeof installManagedBinary>[2]
>;

/** Explicit Connect bootstrap only. All account/Service state still belongs to CLI setup. */
export async function installComputerTools(
  webOrigin: string,
  deps: CommandDeps,
  observation: ComputerToolsObservation = {}
): Promise<string> {
  if (process.platform === "win32") {
    return await installWindowsComputerTools(deps, observation);
  }
  await installManagedBinary(webOrigin, deps, observation);
  return resolveOpenMeldBin({ env: deps.env, override: deps.openMeldBin });
}
