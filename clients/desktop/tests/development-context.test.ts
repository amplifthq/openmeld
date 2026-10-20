import {
  chmodSync,
  mkdirSync,
  mkdtempSync,
  realpathSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, it } from "vitest";
import { applyDesktopDevelopmentContext } from "../src/main/development-context";

it("restores only an isolated compiled lane on an environment-free OS launch", () => {
  const root = realpathSync(mkdtempSync(join(tmpdir(), "desktop-os-launch-")));
  const laneId = "wt-aaaaaaaaaaaa";
  const home = join(root, ".turbo/dev/isolated", laneId, "openmeld-home");
  mkdirSync(join(home, "bin"), { recursive: true });
  writeFileSync(join(home, "bin/openmeld"), "test");
  chmodSync(join(home, "bin/openmeld"), 0o700);
  const context = {
    version: 1,
    repoRoot: root,
    laneId,
    openMeldHome: home,
    preset: "dev-local",
    webOrigin: `http://${laneId}.localhost:31000`,
    authOrigin: `http://${laneId}.localhost:31002`,
    gatewayOrigin: `http://${laneId}.localhost:31001`,
  };
  try {
    const env: NodeJS.ProcessEnv = {
      WEB_APP_URL: "https://openmeld.ai",
      OPENMELD_HOME: "/production",
      OPENMELD_DESKTOP_RENDERER_DIR: "/foreign",
    };
    applyDesktopDevelopmentContext(context, env);
    expect(env.WEB_APP_URL).toBe(context.webOrigin);
    expect(env.OPENMELD_HOME).toBe(home);
    expect(env.OPENMELD_AUTH_CLIENT_ID).toBe("openmeld-cli-dev");
    expect(env.OPENMELD_DESKTOP_USER_DATA_DIR).toBe(
      join(home, "desktop/mock-keychain-user-data")
    );
    expect(env.OPENMELD_DESKTOP_RENDERER_DIR).toBeUndefined();
    applyDesktopDevelopmentContext({ ...context, preset: "canary" }, env);
    expect(env.OPENMELD_AUTH_CLIENT_ID).toBe("openmeld-cli");
    applyDesktopDevelopmentContext(context, env);
    expect(env.OPENMELD_AUTH_CLIENT_ID).toBe("openmeld-cli-dev");
    expect(() =>
      applyDesktopDevelopmentContext(
        { ...context, openMeldHome: "/foreign" },
        env
      )
    ).toThrow();
    expect(() =>
      applyDesktopDevelopmentContext(
        { ...context, webOrigin: "https://openmeld.ai" },
        env
      )
    ).toThrow();
    expect(() =>
      applyDesktopDevelopmentContext({ ...context, preset: "prod" }, env)
    ).toThrow();
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
