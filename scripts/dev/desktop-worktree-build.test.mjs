import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import {
  checkDesktopWebServer,
  desktopDevelopmentPlan,
  desktopSourceIdentity,
  isDesktopBuildReusable,
} from "./desktop-worktree-build.mjs";
import { buildIsolatedDevEnvironment } from "./dev-isolated-lane.mjs";

test("native launch requires the matching live Web marker, with no redirects or credentials", async () => {
  const origin = "http://wt-aaaaaaaaaaaa.localhost:31000";
  await checkDesktopWebServer(origin, "expected", (url, options) => {
    assert.equal(url, `${origin}/desktop-build.json`);
    assert.equal(options.redirect, "manual");
    assert.equal(options.credentials, "omit");
    return Promise.resolve(Response.json({ webBuild: "expected" }));
  });
  for (const response of [
    Response.json({ webBuild: "old" }),
    new Response("", { status: 302 }),
    new Response("<html>HMR</html>"),
    Response.json({ webBuild: "expected", installedTarget: {} }),
  ]) {
    await assert.rejects(
      checkDesktopWebServer(origin, "expected", () => Promise.resolve(response))
    );
  }
  await assert.rejects(
    checkDesktopWebServer(origin, "expected", () =>
      Promise.reject(new Error("offline"))
    )
  );
  let fetched = false;
  await assert.rejects(
    checkDesktopWebServer("https://openmeld.ai", "expected", () => {
      fetched = true;
      return Promise.resolve(Response.json({ webBuild: "expected" }));
    })
  );
  assert.equal(fetched, false);
});

test("build receipts invalidate on source, lane or damaged output instead of trusting a skip flag", () => {
  const root = mkdtempSync(join(tmpdir(), "desktop-build-"));
  try {
    execFileSync("git", ["init", "-q", root]);
    mkdirSync(join(root, "clients/desktop/src"), { recursive: true });
    writeFileSync(join(root, "clients/desktop/src/main.ts"), "first");
    const context = { webOrigin: "http://wt-aaaaaaaaaaaa.localhost:31000" };
    const initial = desktopSourceIdentity(root, context);
    const plan = { appPath: join(root, "App.app") };
    mkdirSync(join(root, ".turbo/dev"), { recursive: true });
    writeFileSync(
      join(root, ".turbo/dev/desktop-build.json"),
      JSON.stringify({
        version: 1,
        sourceIdentity: initial,
        appPath: plan.appPath,
      })
    );
    assert.equal(
      isDesktopBuildReusable(root, plan, initial, () => undefined),
      true
    );
    assert.equal(
      isDesktopBuildReusable(root, plan, initial, () => {
        throw new Error("invalid signature");
      }),
      false
    );
    writeFileSync(join(root, "clients/desktop/src/main.ts"), "second");
    assert.equal(
      isDesktopBuildReusable(
        root,
        plan,
        desktopSourceIdentity(root, context),
        () => undefined
      ),
      false
    );
    assert.notEqual(
      initial,
      desktopSourceIdentity(root, {
        webOrigin: "http://wt-bbbbbbbbbbbb.localhost:31000",
      })
    );
    assert.equal(
      isDesktopBuildReusable(
        root,
        { appPath: "/another/App.app" },
        initial,
        () => undefined
      ),
      false
    );
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("plans an isolated app without credentials and rejects mixed lane endpoints", () => {
  const lane = {
    repoRoot: "/repo",
    laneId: "wt-aaaaaaaaaaaa",
    openMeldHome: "/repo/.turbo/dev/isolated/wt-aaaaaaaaaaaa/openmeld-home",
    ports: { web: 31_000, auth: 31_002, gateway: 31_001 },
  };
  const launch = {
    env: {
      ...buildIsolatedDevEnvironment(lane),
      OPENMELD_ENV_PRESET: "dev-local",
      SOME_SECRET: "must-not-be-packaged",
    },
  };
  const plan = desktopDevelopmentPlan(lane, launch, "arm64");
  assert.equal(
    plan.identity.authScheme,
    "sh.openmeld.desktop.dev.wt-aaaaaaaaaaaa.p31000"
  );
  assert.equal(
    JSON.stringify(plan.context).includes("must-not-be-packaged"),
    false
  );
  assert.equal(
    plan.appPath,
    "/repo/clients/desktop/dist/development/mac-arm64/OpenMeld Dev wt-aaaaaaaaaaaa.app"
  );
  assert.throws(() =>
    desktopDevelopmentPlan(lane, {
      env: { ...launch.env, WEB_APP_URL: "https://openmeld.ai" },
    })
  );
});
