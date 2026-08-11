import crypto from "node:crypto";
import { afterEach, describe, expect, it, vi } from "vitest";
import { runInit } from "../src/commands/init";
import { withSilencedStdio, withTempHome } from "./helpers/fs";

type InitResult = {
  openMeldProfileId: string;
  profileIdentity: {
    openMeldProfileId: string;
    profileName: string;
  };
};

describe("openmeld init", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("returns anon profile identity by default", async () => {
    await withTempHome(async () => {
      const result = (await withSilencedStdio(async () =>
        runInit({
          profileId: "96ef19c9-9e8e-452d-9221-4eb6bcde79ef",
        })
      )) as InitResult;
      expect(result.openMeldProfileId).toBe("anon--96ef19c9");
      expect(result.profileIdentity.openMeldProfileId).toBe(
        "96ef19c9-9e8e-452d-9221-4eb6bcde79ef"
      );
      expect(result.profileIdentity.profileName).toBe("anon");
    });
  });

  it("uses <name>--<uuid8> profile when profile name is provided", async () => {
    await withTempHome(async () => {
      const result = (await withSilencedStdio(async () =>
        runInit({
          profileId: "9e336b4b-0a6d-4e49-8ffa-b562302654fc",
          profileName: "Felix",
        })
      )) as InitResult;
      expect(result.openMeldProfileId).toBe("felix--9e336b4b");
      expect(result.profileIdentity.profileName).toBe("Felix");
    });
  });

  it("regenerates profile identity id for explicit profile when preserveProfileId is false", async () => {
    await withTempHome(async () => {
      const randomUuid = "11111111-2222-3333-4444-555555555555";
      const randomSpy = vi
        .spyOn(crypto, "randomUUID")
        .mockReturnValue(randomUuid);

      const result = (await withSilencedStdio(async () =>
        runInit({
          profile: "codex--team-a",
          profileId: "profile-fixed-id",
          preserveProfileId: false,
        })
      )) as InitResult;

      expect(result.openMeldProfileId).toBe("codex--team-a");
      expect(result.profileIdentity.openMeldProfileId).toBe(randomUuid);
      expect(result.profileIdentity.openMeldProfileId).not.toBe(
        "profile-fixed-id"
      );
      expect(randomSpy).toHaveBeenCalledTimes(1);
    });
  });

  it("keeps explicit profile identity id when preserveProfileId is true", async () => {
    await withTempHome(async () => {
      const randomSpy = vi.spyOn(crypto, "randomUUID");

      const result = (await withSilencedStdio(async () =>
        runInit({
          profile: "codex--team-a",
          profileId: "profile-fixed-id",
          preserveProfileId: true,
        })
      )) as InitResult;

      expect(result.openMeldProfileId).toBe("codex--team-a");
      expect(result.profileIdentity.openMeldProfileId).toBe("profile-fixed-id");
      expect(randomSpy).not.toHaveBeenCalled();
    });
  });
});
