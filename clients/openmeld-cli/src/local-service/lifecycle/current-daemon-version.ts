import { OPENMELD_VERSION } from "../../runtime/version";

export function resolveCurrentDaemonExpectedVersion(): string {
  return resolveBundledServiceRelease()?.version ?? OPENMELD_VERSION;
}

import { resolveBundledServiceRelease } from "../../config/service-release";
