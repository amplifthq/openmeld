import { readDaemonServiceContract } from "../../config/daemon-service-contract";
import { resolveBundledServiceRelease } from "../../config/service-release";
import { compareSemver } from "../../config/version-state";
import { OPENMELD_VERSION } from "../../runtime/version";

export async function resolveCurrentDaemonExpectedVersion(
  selectedVersion = resolveBundledServiceRelease()?.version ?? OPENMELD_VERSION
): Promise<string> {
  const contract = await readDaemonServiceContract();
  // Release selection must not silently downgrade an installed Service.
  // Inventory still verifies its bytes, runtime contract and lane.
  return contract && compareSemver(contract.daemonVersion, selectedVersion) > 0
    ? contract.daemonVersion
    : selectedVersion;
}
