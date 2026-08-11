import { homedir } from "node:os";
import { describe, expect, it, vi } from "vitest";
import { assertSafePublishedProductionServiceRegistrationMutation } from "../src/config/published-production-safety";
import type {
  DaemonServiceCommandSpec,
  DaemonServiceManager,
} from "../src/local-service/lifecycle/daemon-service-manager";
import { guardDaemonServiceManagerMutations } from "../src/local-service/lifecycle/daemon-service-manager";

const PROD_ARGV = ["/usr/local/bin/node", "/usr/local/bin/openmeld"];
const DURING_TESTS_PATTERN = /during tests/;
const OUTSIDE_LANE_PATTERN = /outside the published production lane/;
const TEST_ARGV = ["/usr/local/bin/node", "/repo/node_modules/.bin/vitest"];
const PLAIN_ARGV = ["/usr/local/bin/node", "/repo/scripts/some-script.mjs"];

function buildRecordingManager(): {
  manager: DaemonServiceManager;
  calls: string[];
} {
  const calls: string[] = [];
  const record = (name: string) => (): Promise<void> => {
    calls.push(name);
    return Promise.resolve();
  };
  return {
    calls,
    manager: {
      controller: "launchd",
      install: (_spec: DaemonServiceCommandSpec): Promise<void> => {
        calls.push("install");
        return Promise.resolve();
      },
      uninstall: record("uninstall"),
      enableAutostart: record("enableAutostart"),
      disableAutostart: record("disableAutostart"),
      start: record("start"),
      stop: record("stop"),
      deactivate: record("deactivate"),
      status: (): Promise<{
        installed: boolean;
        running: boolean;
        enabled: boolean;
      }> => {
        calls.push("status");
        return Promise.resolve({
          installed: true,
          running: true,
          enabled: true,
        });
      },
      waitUntilAbsent: record("waitUntilAbsent"),
      waitUntilStopped: record("waitUntilStopped"),
      waitUntilRunning: record("waitUntilRunning"),
    },
  };
}

describe("published production service registration guard", () => {
  it("rejects production registration mutations from test processes", () => {
    expect(() =>
      assertSafePublishedProductionServiceRegistrationMutation("uninstall", {
        env: { VITEST: "true" },
        argv: PROD_ARGV,
      })
    ).toThrow(DURING_TESTS_PATTERN);
  });

  it("rejects test mutations even with an explicit prod preset and isolated home", () => {
    expect(() =>
      assertSafePublishedProductionServiceRegistrationMutation("stop", {
        env: {
          VITEST: "true",
          OPENMELD_ENV_PRESET: "prod",
          OPENMELD_HOME: "/tmp/isolated-home/.openmeld-test",
        },
        argv: TEST_ARGV,
      })
    ).toThrow(DURING_TESTS_PATTERN);
  });

  it("allows dev-local and canary registration mutations from test processes", () => {
    for (const preset of ["dev-local", "canary"]) {
      expect(() =>
        assertSafePublishedProductionServiceRegistrationMutation("install", {
          env: { VITEST: "true", OPENMELD_ENV_PRESET: preset },
          argv: TEST_ARGV,
        })
      ).not.toThrow();
    }
  });

  it("rejects a non-test prod-label mutation when the root left the published lane", () => {
    expect(() =>
      assertSafePublishedProductionServiceRegistrationMutation("uninstall", {
        env: { OPENMELD_HOME: "/tmp/isolated-home/.openmeld-fresh" },
        argv: PLAIN_ARGV,
      })
    ).toThrow(OUTSIDE_LANE_PATTERN);
  });

  it("allows a non-test prod mutation from the published production root", () => {
    expect(() =>
      assertSafePublishedProductionServiceRegistrationMutation("start", {
        env: {},
        argv: PROD_ARGV,
        homeDir: homedir(),
      })
    ).not.toThrow();
  });

  it("allows a non-test isolated-root mutation with an explicit prod preset", () => {
    expect(() =>
      assertSafePublishedProductionServiceRegistrationMutation("stop", {
        env: {
          OPENMELD_ENV_PRESET: "prod",
          OPENMELD_HOME: "/tmp/isolated-home/.openmeld-fresh",
        },
        argv: PLAIN_ARGV,
      })
    ).not.toThrow();
  });
});

describe("guardDaemonServiceManagerMutations", () => {
  const testProcessPathInput = {
    env: { VITEST: "true", OPENMELD_HOME: "/tmp/isolated-home/.openmeld-x" },
    argv: TEST_ARGV,
  };

  it("blocks every mutation before it reaches the underlying manager", async () => {
    const { manager, calls } = buildRecordingManager();
    const guarded = guardDaemonServiceManagerMutations(
      manager,
      testProcessPathInput
    );

    await expect(
      guarded.install({ executable: "/bin/true", args: [], env: {} })
    ).rejects.toThrow(DURING_TESTS_PATTERN);
    await expect(guarded.uninstall()).rejects.toThrow(DURING_TESTS_PATTERN);
    await expect(guarded.enableAutostart()).rejects.toThrow(
      DURING_TESTS_PATTERN
    );
    await expect(guarded.disableAutostart()).rejects.toThrow(
      DURING_TESTS_PATTERN
    );
    await expect(guarded.start()).rejects.toThrow(DURING_TESTS_PATTERN);
    await expect(guarded.stop()).rejects.toThrow(DURING_TESTS_PATTERN);
    await expect(guarded.deactivate()).rejects.toThrow(DURING_TESTS_PATTERN);
    expect(calls).toEqual([]);
  });

  it("keeps read-only operations unguarded", async () => {
    const { manager, calls } = buildRecordingManager();
    const guarded = guardDaemonServiceManagerMutations(
      manager,
      testProcessPathInput
    );

    await expect(guarded.status()).resolves.toMatchObject({ installed: true });
    expect(calls).toEqual(["status"]);
  });

  it("passes mutations through for an isolated lane preset", async () => {
    const { manager, calls } = buildRecordingManager();
    const guarded = guardDaemonServiceManagerMutations(manager, {
      env: { VITEST: "true", OPENMELD_ENV_PRESET: "dev-local" },
      argv: TEST_ARGV,
    });

    await guarded.stop();
    await guarded.uninstall();
    expect(calls).toEqual(["stop", "uninstall"]);
  });

  it("is applied by default when the pathInput omits overrides in a test process", async () => {
    vi.stubEnv("OPENMELD_ENV_PRESET", "");
    try {
      const { manager, calls } = buildRecordingManager();
      const guarded = guardDaemonServiceManagerMutations(manager);
      await expect(guarded.uninstall()).rejects.toThrow(DURING_TESTS_PATTERN);
      expect(calls).toEqual([]);
    } finally {
      vi.unstubAllEnvs();
    }
  });
});
