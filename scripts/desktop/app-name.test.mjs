import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import test from "node:test";
import { desktopAuthIdentity } from "../../packages/schemas/src/desktop-auth-identity.ts";
import { desktopAppName, withDesktopAppName } from "./app-name.ts";

const desktopPackage = JSON.parse(
  readFileSync(
    new URL("../../clients/desktop/package.json", import.meta.url),
    "utf8"
  )
);

for (const [appId, expected] of [
  ["sh.openmeld.desktop", "OpenMeld"],
  ["sh.openmeld.desktop.test", "OpenMeld Test"],
  ["sh.openmeld.desktop.dev", "OpenMeld Dev"],
  [
    "sh.openmeld.desktop.dev.wt-7574cf217e3a.p3200",
    "OpenMeld Dev wt-7574cf217e3a",
  ],
  [
    "sh.openmeld.desktop.dev.wt-012345abcdef.p4500",
    "OpenMeld Dev wt-012345abcdef",
  ],
]) {
  test(`names ${appId} consistently across all native metadata`, () => {
    const base = {
      appId: "old-identity",
      productName: "old-name",
      extraMetadata: { productName: "old-name", version: "0.1.5" },
      mac: {
        identity: "-",
        icon: "resources/icon.icns",
        extendInfo: { CFBundleDisplayName: "old-name", CustomKey: "retained" },
      },
      protocols: [{ schemes: [appId] }],
    };
    const before = structuredClone(base);
    const result = withDesktopAppName(base, appId);
    assert.equal(desktopAppName(appId), expected);
    assert.equal(result.appId, appId);
    assert.equal(result.productName, expected);
    assert.equal(result.extraMetadata.productName, expected);
    assert.equal(result.mac.extendInfo.CFBundleName, expected);
    assert.equal(result.mac.extendInfo.CFBundleDisplayName, expected);
    assert.equal(result.extraMetadata.version, "0.1.5");
    assert.equal(result.mac.identity, "-");
    assert.equal(result.mac.icon, "resources/icon.icns");
    assert.equal(result.mac.extendInfo.CustomKey, "retained");
    assert.deepEqual(result.protocols, base.protocols);
    assert.deepEqual(base, before);
  });
}

test("names actual private and worktree auth identities without changing them", () => {
  for (const target of [undefined, "private"]) {
    const identity = desktopAuthIdentity(
      false,
      target,
      "http://wt-7574cf217e3a.localhost:3200"
    );
    assert.equal(
      identity.authScheme,
      "sh.openmeld.desktop.dev.wt-7574cf217e3a.p3200"
    );
    assert.equal(
      desktopAppName(identity.authScheme),
      "OpenMeld Dev wt-7574cf217e3a"
    );
    assert.equal(identity.clientId, "electron");
  }
  assert.equal(
    desktopAppName(desktopAuthIdentity(false, "private").authScheme),
    "OpenMeld Dev"
  );
});

test("bare local builds are explicitly development builds", () => {
  const expected = withDesktopAppName(
    desktopPackage.build,
    "sh.openmeld.desktop.dev"
  );
  assert.equal(desktopPackage.productName, expected.productName);
  assert.equal(desktopPackage.build.productName, expected.productName);
  assert.equal(desktopPackage.build.appId, expected.appId);
  assert.equal(
    desktopPackage.build.mac.extendInfo.CFBundleDisplayName,
    expected.productName
  );
  assert.equal(
    desktopPackage.build.mac.extendInfo.CFBundleName,
    expected.productName
  );
});

test("does not infer production from unknown or malformed identities", () => {
  for (const appId of [
    "",
    "production",
    "sh.openmeld.desktop.staging",
    "sh.openmeld.desktop.test.extra",
    "sh.openmeld.desktop.dev.",
    "sh.openmeld.desktop.dev.wt-bad.p3200",
    "sh.openmeld.desktop.dev.wt-7574cf217e3a",
    "sh.openmeld.desktop.dev.wt-7574cf217e3a.p3200.extra",
  ]) {
    assert.throws(
      () => withDesktopAppName({}, appId),
      /Unknown Desktop application identity/u
    );
  }
});

for (const [webOrigin, expected, appId] of [
  ["http://localhost:3200", "OpenMeld Dev", "sh.openmeld.desktop.dev"],
  [
    "http://wt-7574cf217e3a.localhost:3200",
    "OpenMeld Dev wt-7574cf217e3a",
    "sh.openmeld.desktop.dev.wt-7574cf217e3a.p3200",
  ],
]) {
  test(`private builder preserves the selected name for ${webOrigin}`, () => {
    const entry = new URL(
      "../../clients/desktop/electron-builder.private.config.mjs",
      import.meta.url
    ).href;
    const result = spawnSync(
      process.execPath,
      [
        "--experimental-strip-types",
        "--input-type=module",
        "--eval",
        `const { default: config } = await import(${JSON.stringify(entry)});
         console.log(JSON.stringify(config));`,
      ],
      { encoding: "utf8", env: { WEB_APP_URL: webOrigin } }
    );
    assert.equal(result.status, 0, result.stderr);
    const config = JSON.parse(result.stdout);
    assert.equal(config.productName, expected);
    assert.equal(config.extraMetadata.productName, expected);
    assert.equal(config.mac.extendInfo.CFBundleName, expected);
    assert.equal(config.mac.extendInfo.CFBundleDisplayName, expected);
    assert.equal(config.appId, appId);
    assert.deepEqual(config.protocols[0].schemes, [appId]);
    assert.equal(config.publish, null);
    assert.equal(config.mac.identity, desktopPackage.build.mac.identity);
  });
}
