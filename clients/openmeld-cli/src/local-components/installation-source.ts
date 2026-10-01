import { resolveCliBinaryPlatform } from "@openmeld/schemas";
import type { LocalComponentsInstallationSource } from "@openmeld/schemas/types";
import { resolveOpenMeldRootDir } from "../config/paths";
import { isBinaryDistribution } from "../runtime/distribution";
import { readManagedCliInstallation } from "./managed-install";
import { readWindowsManagedCliInstallation } from "./windows-managed-install";

// A retained Service may run from a daemon bundle. Source belongs to the
// selected managed CLI, not the carrier's executing path.
export async function resolveLocalComponentsInstallationSource(input: {
  platform?: string;
  arch?: string;
  binaryDistribution?: boolean;
  readInstallation?: typeof readManagedCliInstallation;
  readWindowsInstallation?: typeof readWindowsManagedCliInstallation;
  root?: string;
  expectedVersion?: string;
} = {}): Promise<
  LocalComponentsInstallationSource | undefined
> {
  const os = input.platform ?? process.platform;
  const platform = resolveCliBinaryPlatform(os, input.arch ?? process.arch);
  if (!(input.binaryDistribution ?? isBinaryDistribution())) {
    return { distribution: "npm", channel: "stable", platform };
  }
  try {
    const installed = await (input.readInstallation ?? readManagedCliInstallation)();
    if (!installed || (input.expectedVersion && installed.version !== input.expectedVersion)) {
      return undefined;
    }
    if (os === "win32") {
      const record = await (input.readWindowsInstallation ?? readWindowsManagedCliInstallation)(input.root ?? resolveOpenMeldRootDir());
      if (!record || record.version !== installed.version) {
        return undefined;
      }
      return { distribution: "binary", channel: record.releaseChannel ?? "stable", platform };
    }
    return { distribution: "binary", channel: "stable", platform };
  } catch {
    // Missing/corrupt provenance must not become a guessed update channel.
    return undefined;
  }
}
