import { cliBinaryServiceReleaseSchema } from "@openmeld/schemas";
import packageJson from "../../package.json";
import { isBinaryDistribution } from "../runtime/distribution";
import type { CliBinaryReleaseInfo } from "./version-state";

// The release embeds its selected Service artifact so setup and repair use the
// same target offline, without a second mutable version cache. Legacy releases
// continue to use their own CLI binary as the Service carrier.
export function resolveBundledServiceRelease():
  | CliBinaryReleaseInfo
  | undefined {
  if (!isBinaryDistribution()) {
    return undefined;
  }
  const metadata = packageJson as { openmeld?: { service?: unknown } };
  if (metadata.openmeld?.service === undefined) {
    return undefined;
  }
  const parsed = cliBinaryServiceReleaseSchema.safeParse(
    metadata.openmeld.service
  );
  if (!parsed.success) {
    throw new Error(
      "The installed CLI contains invalid Service release metadata."
    );
  }
  const platform = `${process.platform}-${process.arch}`;
  const artifact = parsed.data.platforms[platform];
  if (!artifact) {
    throw new Error(
      `The installed CLI has no Service artifact for ${platform}.`
    );
  }
  return {
    ...artifact,
    version: parsed.data.version,
    platform,
    minRequiredCliVersion: null,
  };
}
