import type { CommandDeps } from "./commands";
import { installManagedBinary } from "./managed-binary";

export type ComputerToolsObservation = NonNullable<
  Parameters<typeof installManagedBinary>[2]
>;

/** Explicit Connect bootstrap only. All account/Service state still belongs to CLI setup. */
export async function installComputerTools(
  webOrigin: string,
  deps: CommandDeps,
  observation: ComputerToolsObservation = {}
): Promise<string> {
  return await installManagedBinary(webOrigin, deps, observation);
}
