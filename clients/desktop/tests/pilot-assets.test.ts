import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { readInstalledDesktopTarget } from "../../../scripts/desktop/installed-target";
import { resolvePilotAssets } from "../src/main/pilot-assets";
import { createPilotProtocol } from "../src/main/pilot-protocol";

const roots: string[] = [];
const webBuild = "a".repeat(64);
const unavailable = /missing, incomplete, or stale/u;
const rootCommand = /repo-root/u;

afterEach(() => {
  for (const root of roots.splice(0)) {
    rmSync(root, { recursive: true, force: true });
  }
});

describe("private packaged renderer", () => {
  it("loads installed resources without a lane and rejects mismatched compiled targets", () => {
    const resourcesPath = mkdtempSync(
      join(tmpdir(), "desktop-installed-assets-")
    );
    roots.push(resourcesPath);
    const assets = join(resourcesPath, "desktop-renderer");
    mkdirSync(join(assets, "assets"), { recursive: true });
    const installedTarget = readInstalledDesktopTarget({
      OPENMELD_DESKTOP_TARGET: "production",
      OPENMELD_DESKTOP_TEST_WEB_ORIGIN: "https://untrusted.invalid",
    });
    if (!installedTarget) {
      throw new Error("Expected installed target");
    }
    expect(installedTarget.webOrigin).toBe("https://openmeld.ai");
    writeFileSync(join(assets, "_shell.html"), "<html>Installed</html>");
    writeFileSync(
      join(assets, "desktop-build.json"),
      JSON.stringify({ webBuild, installedTarget })
    );
    const input = {
      privatePackage: false,
      resourcesPath,
      webBuild,
      installedTarget,
      env: {},
    };
    expect(resolvePilotAssets(input)).toBe(assets);
    expect(
      resolvePilotAssets({
        ...input,
        env: {
          OPENMELD_DESKTOP_RENDERER_DIR: "/untrusted",
          OPENMELD_DESKTOP_PILOT: "1",
          WEB_APP_URL: "https://untrusted.invalid",
        },
      })
    ).toBe(assets);
    writeFileSync(
      join(assets, "desktop-build.json"),
      JSON.stringify({ webBuild })
    );
    expect(() => resolvePilotAssets(input)).toThrow(
      "Reinstall OpenMeld Desktop"
    );
  });
  it("serves its own shared shell and chunks even when an external renderer override is set", async () => {
    const resourcesPath = mkdtempSync(
      join(tmpdir(), "desktop-package-assets-")
    );
    roots.push(resourcesPath);
    const assets = join(resourcesPath, "desktop-renderer");
    mkdirSync(join(assets, "assets"), { recursive: true });
    writeFileSync(
      join(assets, "desktop-build.json"),
      JSON.stringify({ webBuild })
    );
    const html =
      '<html><script type="module" src="/assets/entry.js"></script></html>';
    writeFileSync(join(assets, "_shell.html"), html);
    writeFileSync(
      join(assets, "assets/entry.js"),
      "export const packaged = true;"
    );
    const input = {
      privatePackage: true,
      resourcesPath,
      webBuild,
      env: {
        OPENMELD_DESKTOP_PILOT: "1",
        OPENMELD_DESKTOP_RENDERER_DIR: "/unrelated/worktree",
      },
    };
    expect(resolvePilotAssets(input)).toBe(assets);
    const serve = createPilotProtocol({
      assets,
      webOrigin: "http://localhost:3000",
      webBuild,
      cookie: () => {
        throw new Error("Local assets must not read credentials");
      },
      fetch: () => {
        throw new Error("Local assets must not fetch hosted Web");
      },
    });
    expect(
      await (
        await serve(new Request("openmeld-desktop://app/desktop-shell"))
      ).text()
    ).toBe(html);
    expect(
      await (
        await serve(new Request("openmeld-desktop://app/assets/entry.js"))
      ).text()
    ).toBe("export const packaged = true;");
    expect(() => resolvePilotAssets({ ...input, env: {} })).toThrow(
      rootCommand
    );
    expect(() =>
      resolvePilotAssets({ ...input, webBuild: "b".repeat(64) })
    ).toThrow(unavailable);
    rmSync(join(assets, "_shell.html"));
    expect(() => resolvePilotAssets(input)).toThrow(unavailable);
    rmSync(assets, { recursive: true });
    expect(() => resolvePilotAssets(input)).toThrow(unavailable);
  });
});
