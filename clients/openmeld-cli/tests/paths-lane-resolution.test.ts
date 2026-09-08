import { mkdtemp, readdir, readFile, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { setAuthSession } from "../src/config/auth-session";
import {
  daemonServiceRuntimeStatePath,
  daemonStatePath,
} from "../src/config/daemon-state";
import {
  openMeldRootDir,
  resolveKnownOpenMeldEnvPresetFromArgv,
  resolveOpenMeldEnvPreset,
  resolveOpenMeldRootDir,
  resolveOpenMeldServiceOwnedPathInput,
} from "../src/config/paths";
import { setConfiguredBaseUrl } from "../src/config/runtime-config";
import {
  getSessionOpenMeldProfileId,
  setSessionOpenMeldProfileId,
} from "../src/config/session-profile";
import { upsertSpaceConfig } from "../src/space/local-state";

const DEV_ENTRY_COMMAND = "openmeld-dev";

describe("lane-aware OpenMeld home resolution", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("resolves default OpenMeld homes from the active lane", () => {
    expect(
      resolveOpenMeldRootDir({
        homeDir: "/tmp/openmeld-home",
        env: {},
        argv: ["/usr/local/bin/node", "/usr/local/bin/openmeld"],
      })
    ).toBe("/tmp/openmeld-home/.openmeld");
    expect(
      resolveOpenMeldRootDir({
        homeDir: "/tmp/openmeld-home",
        env: {},
        argv: ["/usr/local/bin/node", "/usr/local/bin/openmeld-dev"],
      })
    ).toBe("/tmp/openmeld-home/.openmeld-dev");
    expect(
      resolveOpenMeldRootDir({
        homeDir: "/tmp/openmeld-home",
        env: {},
        argv: ["/usr/local/bin/node", "/usr/local/bin/openmeld-canary"],
      })
    ).toBe("/tmp/openmeld-home/.openmeld-canary");
  });

  it("reports only known OpenMeld CLI entry presets when requested", () => {
    expect(
      resolveKnownOpenMeldEnvPresetFromArgv([
        "/usr/local/bin/node",
        "/usr/local/bin/openmeld",
      ])
    ).toBe("prod");
    expect(
      resolveKnownOpenMeldEnvPresetFromArgv([
        "/usr/local/bin/node",
        "/usr/local/bin/openmeld-dev",
      ])
    ).toBe("dev-local");
    expect(
      resolveKnownOpenMeldEnvPresetFromArgv([
        "/usr/local/bin/node",
        "/repo/clients/openmeld-cli/dist/cli-entry.js",
      ])
    ).toBeNull();
  });

  it("lets OPENMELD_HOME override every lane default", () => {
    expect(
      resolveOpenMeldRootDir({
        homeDir: "/tmp/openmeld-home",
        env: {
          OPENMELD_HOME: "/tmp/custom-openmeld-home",
          OPENMELD_ENV_PRESET: "dev-local",
        },
        argv: ["/usr/local/bin/node", "/usr/local/bin/openmeld-canary"],
      })
    ).toBe("/tmp/custom-openmeld-home");
  });

  it("keeps preset-owned OS resource coordination canonical across OPENMELD_HOME overrides", () => {
    const ownerInput = resolveOpenMeldServiceOwnedPathInput({
      homeDir: "/tmp/openmeld-home",
      env: {
        OPENMELD_HOME: "/tmp/isolated-openmeld-home",
        OPENMELD_ENV_PRESET: "prod",
      },
    });

    expect(resolveOpenMeldRootDir(ownerInput)).toBe(
      "/tmp/openmeld-home/.openmeld"
    );
  });

  it("lets OPENMELD_ENV_PRESET override the command entry", () => {
    expect(
      resolveOpenMeldEnvPreset({
        env: { OPENMELD_ENV_PRESET: "canary" },
        argv: ["/usr/local/bin/node", "/usr/local/bin/openmeld-dev"],
      })
    ).toBe("canary");
    expect(
      resolveOpenMeldRootDir({
        homeDir: "/tmp/openmeld-home",
        env: { OPENMELD_ENV_PRESET: "canary" },
        argv: ["/usr/local/bin/node", "/usr/local/bin/openmeld-dev"],
      })
    ).toBe("/tmp/openmeld-home/.openmeld-canary");
  });

  it("writes auth session into the dev-local lane root", async () => {
    await withLaneHome("dev-local", async (home) => {
      vi.stubEnv("OPENMELD_AUTH_FORCE_INSECURE_FILE_TOKEN", "1");

      await setAuthSession({
        accessToken: "dev-token",
        authBaseUrl: "http://localhost:8788",
        clientId: "openmeld-cli-dev",
        user: {
          id: "dev-user",
          email: "dev@example.com",
        },
      });

      const sessionPath = join(home, ".openmeld-dev", "auth", "session.json");
      const raw = await readFile(sessionPath, "utf8");
      expect(raw).toContain('"clientId": "openmeld-cli-dev"');
      expect(
        await pathExists(join(home, ".openmeld", "auth", "session.json"))
      ).toBe(false);
    });
  });

  it("writes runtime config, daemon state, and session profile into the canary root", async () => {
    await withLaneHome("canary", async (home) => {
      vi.stubEnv("OPENMELD_CLI_CONTEXT_ID", "canary-session");

      expect(openMeldRootDir()).toBe(join(home, ".openmeld-canary"));

      await setConfiguredBaseUrl("https://gateway.openmeld.invalid");
      expect(
        await readFile(
          join(home, ".openmeld-canary", "device", "preferences.json"),
          "utf8"
        )
      ).toContain('"baseUrl": "https://gateway.openmeld.invalid"');

      expect(daemonStatePath()).toBe(
        join(home, ".openmeld-canary", "system", "daemon-install.json")
      );
      expect(daemonServiceRuntimeStatePath()).toBe(
        join(
          home,
          ".openmeld-canary",
          "runtime",
          "daemon",
          "service-runtime.json"
        )
      );

      await setSessionOpenMeldProfileId("agt_canary");
      expect(await getSessionOpenMeldProfileId()).toBe("agt_canary");

      const sessionFiles = await readdir(
        join(home, ".openmeld-canary", "runtime", "sessions")
      );
      expect(sessionFiles).toHaveLength(1);
      expect(
        await pathExists(join(home, ".openmeld", "runtime", "sessions"))
      ).toBe(false);
    });
  });

  it("writes local space cache into the dev-local account tree", async () => {
    await withLaneHome("dev-local", async (home) => {
      vi.stubEnv("OPENMELD_AUTH_FORCE_INSECURE_FILE_TOKEN", "1");

      await setAuthSession({
        accessToken: "dev-token",
        authBaseUrl: "http://localhost:8788",
        clientId: "openmeld-cli-dev",
        user: {
          id: "dev-user",
          email: "dev@example.com",
        },
      });

      await upsertSpaceConfig({
        openMeldProfileId: "agt_demo_001",
        baseUrl: "http://localhost:8080",
        space: "space-demo",
        profileName: "Felix",
      });

      const spacesDir = join(
        home,
        ".openmeld-dev",
        "accounts",
        "localhost_8788",
        "dev-user",
        "profiles",
        "agt_demo_001",
        "space-cache"
      );
      const files = await readdir(spacesDir);
      expect(files).toHaveLength(1);
      expect(await readFile(join(spacesDir, files[0] ?? ""), "utf8")).toContain(
        '"openMeldProfileId": "agt_demo_001"'
      );
      expect(await pathExists(join(home, ".openmeld", "accounts"))).toBe(false);
    });
  });
});

async function withLaneHome(
  preset: "dev-local" | "canary",
  fn: (home: string) => Promise<void>
): Promise<void> {
  const dir = await mkdtemp(join(tmpdir(), "openmeld-lane-test-"));
  const previousEnv = captureEnv([
    "HOME",
    "OPENMELD_HOME",
    "OPENMELD_ENV_PRESET",
    "OPENMELD_USER_FACING_CLI_COMMAND",
    "OPENMELD_DEV_MODE",
    "OPENMELD_CLI_CONTEXT_ID",
    "OPENMELD_AGENT_SESSION_ID",
    "OPENMELD_AUTH_FORCE_INSECURE_FILE_TOKEN",
  ]);

  process.env.HOME = dir;
  Reflect.deleteProperty(process.env, "OPENMELD_HOME");
  process.env.OPENMELD_ENV_PRESET = preset;
  Reflect.deleteProperty(process.env, "OPENMELD_CLI_CONTEXT_ID");
  Reflect.deleteProperty(process.env, "OPENMELD_AGENT_SESSION_ID");
  Reflect.deleteProperty(
    process.env,
    "OPENMELD_AUTH_FORCE_INSECURE_FILE_TOKEN"
  );

  if (preset === "dev-local") {
    process.env.OPENMELD_USER_FACING_CLI_COMMAND = DEV_ENTRY_COMMAND;
    process.env.OPENMELD_DEV_MODE = "1";
  } else {
    process.env.OPENMELD_USER_FACING_CLI_COMMAND = "openmeld-canary";
    Reflect.deleteProperty(process.env, "OPENMELD_DEV_MODE");
  }

  try {
    await fn(dir);
  } finally {
    restoreEnv(previousEnv);
    await rm(dir, { recursive: true, force: true });
  }
}

function captureEnv(keys: string[]): Record<string, string | undefined> {
  return Object.fromEntries(keys.map((key) => [key, process.env[key]]));
}

function restoreEnv(previousEnv: Record<string, string | undefined>): void {
  for (const [key, value] of Object.entries(previousEnv)) {
    if (value === undefined) {
      Reflect.deleteProperty(process.env, key);
      continue;
    }
    process.env[key] = value;
  }
}

async function pathExists(path: string): Promise<boolean> {
  try {
    await stat(path);
    return true;
  } catch {
    return false;
  }
}
