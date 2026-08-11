import type { SkippedDaemonProfile } from "@openmeld/schemas/types";

export function resolveCatalogSyncSkippedProfilesLogState(input: {
  hasProfiles: boolean;
  latestFingerprint: string | null;
  skippedProfiles: SkippedDaemonProfile[];
}): {
  fingerprint: string | null;
  shouldEmit: boolean;
} {
  if (input.hasProfiles || input.skippedProfiles.length === 0) {
    return {
      fingerprint: null,
      shouldEmit: false,
    };
  }

  const fingerprint = JSON.stringify(input.skippedProfiles);
  return {
    fingerprint,
    shouldEmit: input.latestFingerprint !== fingerprint,
  };
}
