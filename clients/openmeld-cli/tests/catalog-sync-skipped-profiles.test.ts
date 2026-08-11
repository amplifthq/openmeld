import { resolveCatalogSyncSkippedProfilesLogState } from "@openmeld/local-service";
import { describe, expect, it } from "vitest";
import type { SkippedDaemonProfile } from "../src/local-service/core/types";

describe("resolveCatalogSyncSkippedProfilesLogState", () => {
  it("emits when the catalog is empty and skipped profiles changed", () => {
    const skippedProfiles = [createSkippedProfile()];

    const result = resolveCatalogSyncSkippedProfilesLogState({
      hasProfiles: false,
      latestFingerprint: null,
      skippedProfiles,
    });

    expect(result).toEqual({
      fingerprint: JSON.stringify(skippedProfiles),
      shouldEmit: true,
    });
  });

  it("suppresses duplicate skipped profile logs for the same empty catalog", () => {
    const skippedProfiles = [createSkippedProfile()];
    const fingerprint = JSON.stringify(skippedProfiles);

    const result = resolveCatalogSyncSkippedProfilesLogState({
      hasProfiles: false,
      latestFingerprint: fingerprint,
      skippedProfiles,
    });

    expect(result).toEqual({
      fingerprint,
      shouldEmit: false,
    });
  });

  it("resets the fingerprint after profiles return so the same skipped set can emit again", () => {
    const skippedProfiles = [createSkippedProfile()];
    const initial = resolveCatalogSyncSkippedProfilesLogState({
      hasProfiles: false,
      latestFingerprint: null,
      skippedProfiles,
    });
    const reset = resolveCatalogSyncSkippedProfilesLogState({
      hasProfiles: true,
      latestFingerprint: initial.fingerprint,
      skippedProfiles,
    });
    const next = resolveCatalogSyncSkippedProfilesLogState({
      hasProfiles: false,
      latestFingerprint: reset.fingerprint,
      skippedProfiles,
    });

    expect(reset).toEqual({
      fingerprint: null,
      shouldEmit: false,
    });
    expect(next).toEqual({
      fingerprint: JSON.stringify(skippedProfiles),
      shouldEmit: true,
    });
  });
});

function createSkippedProfile(): SkippedDaemonProfile {
  return {
    profileId: "agt-skipped",
    profileName: "Skipped Agent",
    skipReason: "controller.binding.disabled",
  };
}
