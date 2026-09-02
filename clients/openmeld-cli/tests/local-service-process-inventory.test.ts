import { describe, expect, it } from "vitest";
import { daemonRuntimeRootPath } from "../src/config/daemon-state";
import { openMeldRootDir } from "../src/config/paths";
import {
  daemonServiceExecutableWrapperPath,
  daemonServiceLauncherPath,
  daemonServiceLegacyWrapperPath,
} from "../src/local-service/lifecycle/daemon-service-bundle";
import { listDaemonOwnedProcesses } from "../src/local-service/lifecycle/daemon-service-process-inventory";

describe("local service process inventory", () => {
  it("ignores ordinary openmeld cli commands that are not service runners", async () => {
    await withDaemonEnvPreset("dev-local", async () => {
      const processes = await listDaemonOwnedProcesses({
        listProcesses: async () => [
          {
            pid: 101,
            parentPid: 1,
            command: `node ${openMeldRootDir()}/clients/openmeld-cli/dist/openmeld-dev.js start`,
          },
          {
            pid: 102,
            parentPid: 1,
            command: `node ${openMeldRootDir()}/clients/openmeld-cli/dist/openmeld.js --view agent doctor`,
          },
          {
            pid: 103,
            parentPid: 1,
            command:
              "node /Users/felix/.nvm/versions/node/v25.1.0/bin/openmeld-dev service status",
          },
          {
            pid: 104,
            parentPid: 1,
            command: `node ${openMeldRootDir()}/clients/openmeld-cli/dist/openmeld-dev.js service start --mode background`,
          },
        ],
      });

      expect(processes).toEqual([]);
    });
  });

  it("keeps a repo-local foreground service start process in the owned-process inventory", async () => {
    await withDaemonEnvPreset("dev-local", async () => {
      const processes = await listDaemonOwnedProcesses({
        listProcesses: async () => [
          {
            pid: 105,
            parentPid: 1,
            command: `node ${openMeldRootDir()}/clients/openmeld-cli/dist/openmeld-dev.js service start --mode foreground --json`,
          },
        ],
      });

      expect(processes).toEqual([
        expect.objectContaining({
          pid: 105,
          ownership: "cli_direct",
          mode: "foreground",
        }),
      ]);
    });
  });

  it("does not claim a repo-local service from another custom OPENMELD_HOME", async () => {
    const pathInput = {
      env: {
        ...process.env,
        OPENMELD_ENV_PRESET: "dev-local",
        OPENMELD_HOME: "/tmp/openmeld-current-worktree",
      },
    };

    const processes = await listDaemonOwnedProcesses({
      pathInput,
      listProcesses: async () => [
        {
          pid: 105,
          parentPid: 1,
          command: `node ${openMeldRootDir()}/clients/openmeld-cli/dist/openmeld-dev.js service start --mode foreground --json`,
        },
      ],
    });

    expect(processes).toEqual([]);
  });

  it("projects equals-style foreground mode for a repo-local service start process", async () => {
    await withDaemonEnvPreset("dev-local", async () => {
      const processes = await listDaemonOwnedProcesses({
        listProcesses: async () => [
          {
            pid: 106,
            parentPid: 1,
            command: `node ${openMeldRootDir()}/clients/openmeld-cli/dist/openmeld-dev.js service start --mode=foreground --json`,
          },
        ],
      });

      expect(processes).toEqual([
        expect.objectContaining({
          pid: 106,
          ownership: "cli_direct",
          mode: "foreground",
        }),
      ]);
    });
  });

  it("ignores log readers that reference the service runtime directory", async () => {
    const processes = await listDaemonOwnedProcesses({
      listProcesses: async () => [
        {
          pid: 104,
          parentPid: 1,
          command: `tail -F ${daemonRuntimeRootPath()}/logs/service.log`,
        },
      ],
    });

    expect(processes).toEqual([]);
  });

  it("ignores observer shell commands that quote a service launch command", async () => {
    const launcherPath = daemonServiceLauncherPath();
    const processes = await listDaemonOwnedProcesses({
      listProcesses: async () => [
        {
          pid: 105,
          parentPid: 1,
          command: `/bin/zsh -c ps -axo pid,command | rg '${launcherPath} service run'`,
        },
        {
          pid: 106,
          parentPid: 1,
          command: `/bin/zsh -c ps -axo pid,command | rg '${daemonServiceExecutableWrapperPath()} service run --mode foreground'`,
        },
      ],
    });

    expect(processes).toEqual([]);
  });

  it("does not treat a custom dev-local service launcher as prod owned", async () => {
    const processes = await listDaemonOwnedProcesses({
      pathInput: {
        env: { ...process.env, OPENMELD_ENV_PRESET: "prod" },
        homeDir: "/Users/felix",
      },
      listProcesses: async () => [
        {
          pid: 107,
          parentPid: 1,
          command:
            "/Users/felix/worktree/.turbo/dev/isolated/lane/openmeld-home/runtime/daemon/service-manager/OpenMeld Service Binary Dev service run --mode foreground",
        },
      ],
    });

    expect(processes).toEqual([]);
  });

  it("does not claim the canonical prod service from a custom prod home", async () => {
    const canonicalProdServicePath = daemonServiceExecutableWrapperPath({
      env: { ...process.env, OPENMELD_ENV_PRESET: "prod" },
      homeDir: "/Users/felix",
    });
    const processes = await listDaemonOwnedProcesses({
      pathInput: {
        env: {
          ...process.env,
          OPENMELD_ENV_PRESET: "prod",
          OPENMELD_HOME: "/tmp/openmeld-isolated-prod",
        },
        homeDir: "/Users/felix",
      },
      listProcesses: async () => [
        {
          pid: 108,
          parentPid: 1,
          command: `${canonicalProdServicePath} service run --mode foreground`,
        },
      ],
    });

    expect(processes).toEqual([]);
  });

  it("keeps repo-local and stable-launcher service run processes in the owned-process inventory", async () => {
    await withDaemonEnvPreset("dev-local", async () => {
      const processes = await listDaemonOwnedProcesses({
        listProcesses: async () => [
          {
            pid: 201,
            parentPid: 1,
            command: `node ${openMeldRootDir()}/clients/openmeld-cli/dist/openmeld-dev.js service run --mode foreground`,
          },
          {
            pid: 203,
            parentPid: 1,
            command: `node ${daemonServiceLauncherPath()} service run --mode foreground --profile daemon-service`,
          },
        ],
      });

      expect(processes).toHaveLength(2);
      expect(processes.map((processInfo) => processInfo.pid)).toEqual([
        201, 203,
      ]);
      expect(processes.map((processInfo) => processInfo.mode)).toEqual([
        "foreground",
        "foreground",
      ]);
    });
  });

  it("recognizes the OpenMeld-owned executable wrapper as a stable launcher process", async () => {
    await withDaemonEnvPreset("dev-local", async () => {
      const processes = await listDaemonOwnedProcesses({
        listProcesses: async () => [
          {
            pid: 251,
            parentPid: 1,
            command: `/bin/sh ${daemonServiceExecutableWrapperPath()} service run --mode foreground`,
          },
          {
            pid: 252,
            parentPid: 1,
            command: `${daemonServiceLegacyWrapperPath()} service run --mode foreground`,
          },
        ],
      });

      expect(processes).toHaveLength(2);
      expect(processes).toEqual([
        expect.objectContaining({
          pid: 251,
          ownership: "stable_launcher",
          mode: "foreground",
        }),
        expect.objectContaining({
          pid: 252,
          ownership: "stable_launcher",
          mode: "foreground",
        }),
      ]);
    });
  });

  it("does not own a process whose path only starts with the executable wrapper path", async () => {
    await withDaemonEnvPreset("dev-local", async () => {
      const processes = await listDaemonOwnedProcesses({
        listProcesses: async () => [
          {
            pid: 253,
            parentPid: 1,
            command: `/bin/sh ${daemonServiceExecutableWrapperPath()}-not-owned service run --mode foreground`,
          },
        ],
      });

      expect(processes).toEqual([]);
    });
  });

  it("recognizes a managed binary service process as a stable launcher process", async () => {
    const pathInput = {
      env: {
        ...process.env,
        OPENMELD_ENV_PRESET: "prod",
      },
      homeDir: "/Users/dev",
    };
    const processes = await listDaemonOwnedProcesses({
      pathInput,
      listProcesses: async () => [
        {
          pid: 275,
          parentPid: 1,
          command:
            "/Users/dev/.openmeld/versions/0.2.14/openmeld service run --mode foreground",
        },
      ],
    });

    expect(processes).toHaveLength(1);
    expect(processes[0]).toMatchObject({
      pid: 275,
      ownership: "stable_launcher",
      mode: "foreground",
    });
  });

  it("does not treat a dev-local managed binary service as prod owned", async () => {
    const pathInput = {
      env: {
        ...process.env,
        OPENMELD_ENV_PRESET: "prod",
      },
      homeDir: "/Users/dev",
    };
    const processes = await listDaemonOwnedProcesses({
      pathInput,
      listProcesses: async () => [
        {
          pid: 276,
          parentPid: 1,
          command:
            "/Users/dev/.openmeld-dev/versions/0.2.14/openmeld service run --mode foreground",
        },
      ],
    });

    expect(processes).toEqual([]);
  });

  it("does not treat a different OPENMELD_HOME managed binary as prod owned", async () => {
    const pathInput = {
      env: {
        ...process.env,
        OPENMELD_ENV_PRESET: "prod",
      },
      homeDir: "/Users/dev",
    };
    const processes = await listDaemonOwnedProcesses({
      pathInput,
      listProcesses: async () => [
        {
          pid: 277,
          parentPid: 1,
          command:
            "/Users/dev/work/openmeld/isolated/openmeld-home/versions/0.3.85/openmeld service run --mode foreground",
        },
      ],
    });

    expect(processes).toEqual([]);
  });

  it("keeps its own custom OPENMELD_HOME managed binary as prod owned", async () => {
    const pathInput = {
      env: {
        ...process.env,
        OPENMELD_ENV_PRESET: "prod",
        OPENMELD_HOME: "/Users/dev/work/openmeld/current/openmeld-home",
      },
      homeDir: "/Users/dev",
    };
    const processes = await listDaemonOwnedProcesses({
      pathInput,
      listProcesses: async () => [
        {
          pid: 278,
          parentPid: 1,
          command:
            "/Users/dev/work/openmeld/current/openmeld-home/versions/0.3.89/openmeld service run --mode foreground",
        },
      ],
    });

    expect(processes).toEqual([
      expect.objectContaining({
        pid: 278,
        ownership: "stable_launcher",
        mode: "foreground",
      }),
    ]);
  });

  it("still recognizes runtime-root legacy service processes", async () => {
    const processes = await listDaemonOwnedProcesses({
      listProcesses: async () => [
        {
          pid: 301,
          parentPid: 1,
          command: `node ${daemonRuntimeRootPath()}/bin/legacy-detached-service.js`,
        },
      ],
    });

    expect(processes).toHaveLength(1);
    expect(processes[0]).toMatchObject({
      pid: 301,
      ownership: "legacy_detached",
      mode: null,
    });
  });

  it("ignores the current command process and its shell wrapper when requested", async () => {
    await withDaemonEnvPreset("dev-local", async () => {
      const processes = await listDaemonOwnedProcesses({
        ignoreProcessIds: [401, 402],
        listProcesses: async () => [
          {
            pid: 401,
            parentPid: 400,
            command: `node ${openMeldRootDir()}/clients/openmeld-cli/dist/openmeld-dev.js service run --mode background`,
          },
          {
            pid: 402,
            parentPid: 399,
            command: `/bin/zsh -c node ${openMeldRootDir()}/clients/openmeld-cli/dist/openmeld-dev.js service run --mode background`,
          },
          {
            pid: 403,
            parentPid: 1,
            command: `node ${daemonServiceLauncherPath()} service run --mode foreground --profile daemon-service`,
          },
        ],
      });

      expect(processes).toHaveLength(1);
      expect(processes[0]).toMatchObject({
        pid: 403,
        ownership: "stable_launcher",
        mode: "foreground",
      });
    });
  });

  it("collapses the stable launcher wrapper when it has a child service process", async () => {
    await withDaemonEnvPreset("dev-local", async () => {
      const processes = await listDaemonOwnedProcesses({
        listProcesses: async () => [
          {
            pid: 501,
            parentPid: 1,
            command: `node ${daemonServiceLauncherPath()} service run --mode foreground --profile daemon-service`,
          },
          {
            pid: 502,
            parentPid: 501,
            command: `node ${openMeldRootDir()}/clients/openmeld-cli/dist/openmeld-dev.js service run --mode foreground --profile daemon-service`,
          },
        ],
      });

      expect(processes).toHaveLength(1);
      expect(processes[0]).toMatchObject({
        pid: 502,
        ownership: "stable_launcher",
        mode: "foreground",
      });
    });
  });

  it("treats a custom OPENMELD_HOME service launcher and its bundled child as one stable launcher owner", async () => {
    const pathInput = {
      env: {
        ...process.env,
        OPENMELD_ENV_PRESET: "dev-local",
        OPENMELD_HOME: "/tmp/openmeld-web-start-fresh",
      },
    };
    const processes = await listDaemonOwnedProcesses({
      pathInput,
      listProcesses: async () => [
        {
          pid: 551,
          parentPid: 1,
          command: `node ${daemonServiceLauncherPath(pathInput)} service run --mode foreground`,
        },
        {
          pid: 552,
          parentPid: 551,
          command: `node ${daemonRuntimeRootPath(pathInput)}/bundles/0.3.43/dist/openmeld-dev.js service run --mode foreground`,
        },
      ],
    });

    expect(processes).toHaveLength(1);
    expect(processes[0]).toMatchObject({
      pid: 552,
      parentPid: 551,
      ownership: "stable_launcher",
      mode: "foreground",
    });
  });

  it("recognizes package-install service run commands inside the canary lane", async () => {
    await withDaemonEnvPreset("canary", async () => {
      const processes = await listDaemonOwnedProcesses({
        listProcesses: async () => [
          {
            pid: 601,
            parentPid: 1,
            command:
              "node /Users/felix/.local/share/openmeld-canary/package-install/node_modules/openmeld/dist/openmeld.js service run --mode background",
          },
        ],
      });

      expect(processes).toHaveLength(1);
      expect(processes[0]).toMatchObject({
        pid: 601,
        ownership: "cli_direct",
        mode: "background",
      });
    });
  });

  it("does not treat canary package-install service runs as prod owned processes", async () => {
    await withDaemonEnvPreset("prod", async () => {
      const processes = await listDaemonOwnedProcesses({
        listProcesses: async () => [
          {
            pid: 611,
            parentPid: 1,
            command:
              "node /Users/felix/.local/share/openmeld-canary/package-install/node_modules/openmeld/dist/openmeld.js service run --mode background",
          },
        ],
      });

      expect(processes).toEqual([]);
    });
  });

  it("does not treat repo-local openmeld-dev service runs as prod owned processes", async () => {
    await withDaemonEnvPreset("prod", async () => {
      const processes = await listDaemonOwnedProcesses({
        listProcesses: async () => [
          {
            pid: 621,
            parentPid: 1,
            command: `node ${openMeldRootDir()}/clients/openmeld-cli/dist/openmeld-dev.js service run --mode background`,
          },
        ],
      });

      expect(processes).toEqual([]);
    });
  });

  it("does not treat dev-local or canary managed runtime paths as prod owned processes", async () => {
    await withDaemonEnvPreset("prod", async () => {
      const devPathInput = createLanePathInput("dev-local");
      const canaryPathInput = createLanePathInput("canary");
      const processes = await listDaemonOwnedProcesses({
        listProcesses: async () => [
          {
            pid: 625,
            parentPid: 1,
            command: `node ${daemonServiceLauncherPath(devPathInput)} service run --mode foreground`,
          },
          {
            pid: 624,
            parentPid: 1,
            command: `${daemonServiceExecutableWrapperPath(devPathInput)} service run --mode foreground`,
          },
          {
            pid: 626,
            parentPid: 625,
            command: `node ${daemonRuntimeRootPath(devPathInput)}/bundles/current/dist/openmeld-dev.js service run --mode foreground`,
          },
          {
            pid: 627,
            parentPid: 1,
            command: `node ${daemonServiceLauncherPath(canaryPathInput)} service run --mode foreground`,
          },
          {
            pid: 628,
            parentPid: 627,
            command: `node ${daemonRuntimeRootPath(canaryPathInput)}/bundles/current/dist/openmeld.js service run --mode foreground`,
          },
        ],
      });

      expect(processes).toEqual([]);
    });
  });

  it("does not treat prod package-install service runs as dev-local owned processes", async () => {
    await withDaemonEnvPreset("dev-local", async () => {
      const processes = await listDaemonOwnedProcesses({
        listProcesses: async () => [
          {
            pid: 631,
            parentPid: 1,
            command:
              "node /usr/local/lib/node_modules/openmeld/dist/openmeld.js service run --mode background",
          },
        ],
      });

      expect(processes).toEqual([]);
    });
  });

  it("does not treat prod or canary managed runtime paths as dev-local owned processes", async () => {
    await withDaemonEnvPreset("dev-local", async () => {
      const prodPathInput = createLanePathInput("prod");
      const canaryPathInput = createLanePathInput("canary");
      const processes = await listDaemonOwnedProcesses({
        listProcesses: async () => [
          {
            pid: 635,
            parentPid: 1,
            command: `node ${daemonServiceLauncherPath(prodPathInput)} service run --mode foreground`,
          },
          {
            pid: 636,
            parentPid: 635,
            command: `node ${daemonRuntimeRootPath(prodPathInput)}/bundles/current/dist/openmeld.js service run --mode foreground`,
          },
          {
            pid: 637,
            parentPid: 1,
            command: `node ${daemonServiceLauncherPath(canaryPathInput)} service run --mode foreground`,
          },
          {
            pid: 638,
            parentPid: 637,
            command: `node ${daemonRuntimeRootPath(canaryPathInput)}/bundles/current/dist/openmeld.js service run --mode foreground`,
          },
        ],
      });

      expect(processes).toEqual([]);
    });
  });

  it("does not treat prod or dev-local service runs as canary owned processes", async () => {
    await withDaemonEnvPreset("canary", async () => {
      const processes = await listDaemonOwnedProcesses({
        listProcesses: async () => [
          {
            pid: 641,
            parentPid: 1,
            command:
              "node /usr/local/lib/node_modules/openmeld/dist/openmeld.js service run --mode background",
          },
          {
            pid: 642,
            parentPid: 1,
            command: `node ${openMeldRootDir()}/clients/openmeld-cli/dist/openmeld-dev.js service run --mode background`,
          },
        ],
      });

      expect(processes).toEqual([]);
    });
  });

  it("does not treat prod or dev-local managed runtime paths as canary owned processes", async () => {
    await withDaemonEnvPreset("canary", async () => {
      const prodPathInput = createLanePathInput("prod");
      const devPathInput = createLanePathInput("dev-local");
      const processes = await listDaemonOwnedProcesses({
        listProcesses: async () => [
          {
            pid: 645,
            parentPid: 1,
            command: `node ${daemonServiceLauncherPath(prodPathInput)} service run --mode foreground`,
          },
          {
            pid: 646,
            parentPid: 645,
            command: `node ${daemonRuntimeRootPath(prodPathInput)}/bundles/current/dist/openmeld.js service run --mode foreground`,
          },
          {
            pid: 647,
            parentPid: 1,
            command: `node ${daemonServiceLauncherPath(devPathInput)} service run --mode foreground`,
          },
          {
            pid: 648,
            parentPid: 647,
            command: `node ${daemonRuntimeRootPath(devPathInput)}/bundles/current/dist/openmeld-dev.js service run --mode foreground`,
          },
        ],
      });

      expect(processes).toEqual([]);
    });
  });

  it("respects an explicit custom home directory when matching canary package-install service runs", async () => {
    await withDaemonEnvPreset("canary", async () => {
      const pathInput = {
        env: {
          ...process.env,
          OPENMELD_ENV_PRESET: "canary",
        },
        homeDir: "/tmp/test-home",
      };
      const processes = await listDaemonOwnedProcesses({
        pathInput,
        listProcesses: async () => [
          {
            pid: 651,
            parentPid: 1,
            command:
              "node /tmp/test-home/.local/share/openmeld-canary/package-install/node_modules/openmeld/dist/openmeld.js service run --mode background",
          },
        ],
      });

      expect(processes).toHaveLength(1);
      expect(processes[0]).toMatchObject({
        pid: 651,
        ownership: "cli_direct",
        mode: "background",
      });
    });
  });

  it("can inspect legacy shared processes through an explicit prod path input", async () => {
    await withDaemonEnvPreset("dev-local", async () => {
      const prodPathInput = {
        env: {
          ...process.env,
          OPENMELD_ENV_PRESET: "prod",
        },
      };
      const processes = await listDaemonOwnedProcesses({
        pathInput: prodPathInput,
        listProcesses: async () => [
          {
            pid: 701,
            parentPid: 1,
            command: `node ${daemonServiceLauncherPath(prodPathInput)} service run --mode background`,
          },
        ],
      });

      expect(processes).toHaveLength(1);
      expect(processes[0]).toMatchObject({
        pid: 701,
        ownership: "stable_launcher",
        mode: "background",
      });
    });
  });
});

async function withDaemonEnvPreset<T>(
  preset: "prod" | "dev-local" | "canary",
  fn: () => Promise<T>
): Promise<T> {
  const previousPreset = process.env.OPENMELD_ENV_PRESET;
  process.env.OPENMELD_ENV_PRESET = preset;
  try {
    return await fn();
  } finally {
    if (previousPreset === undefined) {
      process.env.OPENMELD_ENV_PRESET = undefined;
    } else {
      process.env.OPENMELD_ENV_PRESET = previousPreset;
    }
  }
}

function createLanePathInput(preset: "prod" | "dev-local" | "canary") {
  return {
    env: {
      ...process.env,
      OPENMELD_ENV_PRESET: preset,
    },
  };
}
