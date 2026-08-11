import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { runWhoami } from "../src/commands/whoami";
import { setAuthSession } from "../src/config/auth-session";
import { resolveOpenMeldProfileOrNull } from "../src/config/resolve-openmeld-profile";
import { getConfiguredViewCustomization } from "../src/config/runtime-config";
import { withCapturedStdio, withTempHome } from "./helpers/fs";
import { createTestOpenMeldProfile } from "./helpers/openmeld-profile-fixture";

vi.mock("../src/config/resolve-openmeld-profile", () => {
  return {
    resolveOpenMeldProfileOrNull: vi.fn(),
  };
});

describe("runtime view customization", () => {
  afterEach(() => {
    process.env.OPENMELD_AUTH_FORCE_INSECURE_FILE_TOKEN = undefined;
    const vitestWithUnstubGlobal = vi as typeof vi & {
      unstubGlobal?: (name: string) => void;
    };
    if (typeof vitestWithUnstubGlobal.unstubGlobal === "function") {
      vitestWithUnstubGlobal.unstubGlobal("fetch");
    } else {
      vi.unstubAllGlobals();
    }
    vi.restoreAllMocks();
    vi.resetAllMocks();
  });

  it("supports custom messages and compact agent envelopes", async () => {
    await withTempHome(async (home) => {
      await mkdir(join(home, ".openmeld"), { recursive: true });
      await writeFile(
        join(home, ".openmeld", "config.json"),
        `${JSON.stringify(
          {
            v: 1,
            viewCustomization: {
              messages: {
                agent: {
                  "whoami.loaded": "WHOAMI/{{profile}}",
                },
              },
              render: {
                agent: {
                  envelopeMode: "compact",
                },
              },
            },
            updatedAt: new Date().toISOString(),
          },
          null,
          2
        )}\n`,
        "utf8"
      );

      process.env.OPENMELD_AUTH_FORCE_INSECURE_FILE_TOKEN = "1";
      await setAuthSession({
        accessToken: "token-custom-1",
        tokenType: "Bearer",
        authBaseUrl: "https://auth.openmeld.invalid",
        clientId: "openmeld-cli",
      });
      vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("offline")));
      vi.mocked(resolveOpenMeldProfileOrNull).mockResolvedValueOnce(
        createTestOpenMeldProfile({
          openMeldProfileId: "codex--aaaaaaaa",
          profileName: "Codex",
          profileKind: "agent",
          createdAt: "2026-02-20T00:00:00.000Z",
          updatedAt: "2026-02-20T00:00:00.000Z",
        })
      );

      const { stdout } = await withCapturedStdio(async () => {
        await runWhoami({ profile: "codex--aaaaaaaa", view: "agent" });
      });

      const lines = stdout
        .trim()
        .split("\n")
        .filter((line) => line.length > 0)
        .map((line) => JSON.parse(line));

      const loadedEvent = lines.find(
        (line) => line?.t === "info" && line?.c === "whoami.loaded"
      );
      expect(loadedEvent).toMatchObject({
        t: "info",
        c: "whoami.loaded",
        m: "WHOAMI/codex--aaaaaaaa",
      });
      const profileResult = lines.find(
        (line) => line?.t === "result" && line?.c === "whoami.openmeld_profile"
      );
      expect(profileResult).toMatchObject({
        t: "result",
        c: "whoami.openmeld_profile",
      });
      expect(profileResult?.p?.profileName).toBe("Codex");
    });
  });

  it("supports human data envelope mode", async () => {
    await withTempHome(async (home) => {
      await mkdir(join(home, ".openmeld"), { recursive: true });
      await writeFile(
        join(home, ".openmeld", "config.json"),
        `${JSON.stringify(
          {
            v: 1,
            viewCustomization: {
              render: {
                human: {
                  dataMode: "envelope",
                },
              },
            },
            updatedAt: new Date().toISOString(),
          },
          null,
          2
        )}\n`,
        "utf8"
      );

      process.env.OPENMELD_AUTH_FORCE_INSECURE_FILE_TOKEN = "1";
      await setAuthSession({
        accessToken: "token-custom-2",
        tokenType: "Bearer",
        authBaseUrl: "https://auth.openmeld.invalid",
        clientId: "openmeld-cli",
      });
      vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("offline")));
      vi.mocked(resolveOpenMeldProfileOrNull).mockResolvedValueOnce(
        createTestOpenMeldProfile({
          openMeldProfileId: "felix--bbbbbbbb",
          profileName: "Felix",
          profileKind: "human",
          createdAt: "2026-02-20T00:00:00.000Z",
          updatedAt: "2026-02-20T00:00:00.000Z",
        })
      );

      const { stdout } = await withCapturedStdio(async () => {
        await runWhoami({ profile: "felix--bbbbbbbb", view: "human" });
      });

      const lines = stdout
        .trim()
        .split("\n")
        .filter((line) => line.length > 0)
        .map((line) => JSON.parse(line));

      expect(lines[0]).toMatchObject({
        type: "result",
        code: "whoami.openmeld_profile",
      });
      expect(lines[0]?.payload?.profileName).toBe("Felix");
    });
  });

  it("ignores invalid customization payloads with no valid fields", async () => {
    await withTempHome(async (home) => {
      await mkdir(join(home, ".openmeld"), { recursive: true });
      await writeFile(
        join(home, ".openmeld", "config.json"),
        `${JSON.stringify(
          {
            v: 1,
            viewCustomization: {
              messages: {
                human: {
                  "whoami.loaded": 123,
                },
              },
              render: {
                human: {
                  dataMode: "invalid",
                },
              },
            },
            updatedAt: new Date().toISOString(),
          },
          null,
          2
        )}\n`,
        "utf8"
      );

      const viewCustomization = await getConfiguredViewCustomization();
      expect(viewCustomization).toBeNull();
    });
  });
});
