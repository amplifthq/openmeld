import assert from "node:assert/strict";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { pathToFileURL } from "node:url";
import { desktopPilotBuildPrerequisites } from "../../clients/web/scripts/desktop-pilot-build.ts";

const requireWeb = createRequire(
  new URL("../../clients/web/package.json", import.meta.url)
);
const { resolveConfig } = await import(
  pathToFileURL(requireWeb.resolve("vite"))
);
const requiredAuthUrl = /require a valid VITE_BETTER_AUTH_URL/u;

test("rejects unusable pilot Auth config after real Vite env loading, without changing Web builds", async () => {
  const root = mkdtempSync(join(tmpdir(), "desktop-pilot-build-"));
  const previous = process.env.VITE_BETTER_AUTH_URL;
  const load = (enabled = true) =>
    resolveConfig(
      {
        root,
        configFile: false,
        plugins: [desktopPilotBuildPrerequisites(enabled)],
      },
      "build",
      "production"
    );
  try {
    Reflect.deleteProperty(process.env, "VITE_BETTER_AUTH_URL");
    await assert.rejects(load(), requiredAuthUrl);
    await load(false);
    writeFileSync(join(root, ".env"), "VITE_BETTER_AUTH_URL=invalid\n");
    await assert.rejects(load(), requiredAuthUrl);
    writeFileSync(
      join(root, ".env.production"),
      "VITE_BETTER_AUTH_URL=http://wt-test.localhost:28290\n"
    );
    assert.equal(
      (await load()).env.VITE_BETTER_AUTH_URL,
      "http://wt-test.localhost:28290"
    );
    process.env.VITE_BETTER_AUTH_URL = "";
    await assert.rejects(load(), requiredAuthUrl);
    process.env.VITE_BETTER_AUTH_URL = "http://wt-other.localhost:28302";
    assert.equal(
      (await load()).env.VITE_BETTER_AUTH_URL,
      "http://wt-other.localhost:28302"
    );
  } finally {
    if (previous === undefined) {
      Reflect.deleteProperty(process.env, "VITE_BETTER_AUTH_URL");
    } else {
      process.env.VITE_BETTER_AUTH_URL = previous;
    }
    rmSync(root, { recursive: true, force: true });
  }
});
