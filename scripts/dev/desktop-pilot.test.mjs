import assert from "node:assert/strict";
import {
  chmodSync,
  mkdirSync,
  mkdtempSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { resolveDesktopPilotLaunch } from "./desktop-pilot.mjs";

const MISSING_CLI = /installed CLI/;
const INVALID_PRESET = /development preset/;
const WRONG_WORKTREE = /another worktree/;

test("the Desktop launcher uses its owned lane CLI and overrides unrelated parent endpoints", () => {
  const root = mkdtempSync(join(tmpdir(), "openmeld-desktop-launch-"));
  const home = join(root, "lane-home");
  const lane = {
    repoRoot: root,
    laneId: "wt-example",
    openMeldHome: home,
    ports: {
      web: 28_320,
      gateway: 28_321,
      auth: 28_322,
      cliBinary: 28_323,
      webInspector: 28_328,
    },
    wranglerStateDirectory: join(root, "worker-state"),
    wranglerRegistryPath: join(root, "worker-registry"),
  };
  try {
    mkdirSync(join(home, "bin"), { recursive: true });
    const cli = join(home, "bin", "openmeld");
    assert.throws(() => resolveDesktopPilotLaunch({ lane, root }), MISSING_CLI);
    writeFileSync(cli, "#!/bin/sh\nexit 0\n");
    chmodSync(cli, 0o700);
    const launch = resolveDesktopPilotLaunch({
      lane,
      root,
      env: {
        OPENMELD_HOME: "/real-user-home",
        WEB_APP_URL: "https://openmeld.ai",
        OPENMELD_BIN: "/global/openmeld",
        OPENMELD_ENV_PRESET: "prod",
      },
    });
    assert.equal(launch.env.OPENMELD_HOME, home);
    assert.equal(launch.env.OPENMELD_BIN, cli);
    assert.equal(launch.env.OPENMELD_ENV_PRESET, "dev-local");
    assert.equal(launch.env.WEB_APP_URL, "http://wt-example.localhost:28320");
    assert.equal(
      launch.env.OPENMELD_AUTH_URL,
      "http://wt-example.localhost:28322"
    );
    assert.equal(
      launch.env.OPENMELD_GATEWAY_URL,
      "http://wt-example.localhost:28321"
    );
    assert.equal(
      launch.env.OPENMELD_DESKTOP_RENDERER_DIR,
      join(root, "clients/web/dist/client")
    );
    assert.equal(
      launch.env.OPENMELD_DESKTOP_USER_DATA_DIR,
      join(home, "desktop/user-data")
    );
    assert.equal(
      launch.args.at(-1),
      `--user-data-dir=${join(home, "desktop/user-data")}`
    );
    assert.throws(
      () => resolveDesktopPilotLaunch({ lane, root, preset: "prod" }),
      INVALID_PRESET
    );
    assert.throws(
      () =>
        resolveDesktopPilotLaunch({
          lane: { ...lane, repoRoot: "/other" },
          root,
        }),
      WRONG_WORKTREE
    );
    rmSync(cli);
    symlinkSync(process.execPath, cli);
    assert.throws(() => resolveDesktopPilotLaunch({ lane, root }), MISSING_CLI);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
