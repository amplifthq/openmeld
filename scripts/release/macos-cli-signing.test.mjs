import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { fileURLToPath } from "node:url";

import {
  assertNotarizationAccepted,
  buildCiKeychainSearchListPlan,
  buildCodeSignArgs,
  buildNotarytoolSubmitArgs,
  DEFAULT_APPLE_TEAM_ID,
  DEFAULT_NOTARY_KEYCHAIN_PROFILE,
  parseNotarytoolSubmission,
  REQUIRED_BUN_ENTITLEMENTS,
  resolveAppleReleaseCredentials,
} from "./macos-cli-signing.mjs";

const INCOMPLETE_CI_CREDENTIALS_RE =
  /APPLE_DEVELOPER_ID_P12_PASSWORD, APPLE_NOTARY_KEY_P8_BASE64, APPLE_NOTARY_KEY_ID, APPLE_NOTARY_ISSUER_ID/u;
const REJECTED_NOTARIZATION_RE =
  /submission-id.*Invalid.*critical validation errors/su;
const RESTRICTED_KEYCHAIN_ENTITLEMENT_RE =
  /<key>keychain-access-groups<\/key>/u;
const ENTITLEMENTS_PATH = fileURLToPath(
  new URL("./macos-cli.entitlements.plist", import.meta.url)
);

test("uses the local signing identity and Keychain notary profile by default", () => {
  assert.deepEqual(resolveAppleReleaseCredentials({}), {
    mode: "local",
    keychainProfile: DEFAULT_NOTARY_KEYCHAIN_PROFILE,
    teamId: DEFAULT_APPLE_TEAM_ID,
  });
});

test("allows local release configuration without switching to CI credentials", () => {
  assert.deepEqual(
    resolveAppleReleaseCredentials({
      APPLE_NOTARY_KEYCHAIN_PROFILE: "custom-notary-profile",
      APPLE_TEAM_ID: "CUSTOMTEAM",
    }),
    {
      mode: "local",
      keychainProfile: "custom-notary-profile",
      teamId: "CUSTOMTEAM",
    }
  );
});

test("fails closed when CI signing credentials are incomplete", () => {
  assert.throws(
    () =>
      resolveAppleReleaseCredentials({
        APPLE_DEVELOPER_ID_P12_BASE64: "encoded-p12",
        APPLE_TEAM_ID: "38FFHDPA3B",
      }),
    INCOMPLETE_CI_CREDENTIALS_RE
  );
});

test("resolves the complete CI signing credential contract", () => {
  assert.deepEqual(
    resolveAppleReleaseCredentials({
      APPLE_DEVELOPER_ID_P12_BASE64: "encoded-p12",
      APPLE_DEVELOPER_ID_P12_PASSWORD: "p12-password",
      APPLE_NOTARY_ISSUER_ID: "issuer-id",
      APPLE_NOTARY_KEY_ID: "key-id",
      APPLE_NOTARY_KEY_P8_BASE64: "encoded-p8",
      APPLE_TEAM_ID: "38FFHDPA3B",
    }),
    {
      mode: "ci",
      issuerId: "issuer-id",
      keyId: "key-id",
      keyP8Base64: "encoded-p8",
      p12Base64: "encoded-p12",
      p12Password: "p12-password",
      teamId: "38FFHDPA3B",
    }
  );
});

test("builds hardened-runtime codesign arguments for the Bun executable", () => {
  assert.deepEqual(
    buildCodeSignArgs({
      entitlementsPath: "/repo/scripts/release/macos-cli.entitlements.plist",
      identityHash: "ABC123",
      keychainPath: "/tmp/release.keychain-db",
      outFile: "/tmp/openmeld-cli-darwin-arm64-1.0.0",
    }),
    [
      "--force",
      "--options",
      "runtime",
      "--timestamp",
      "--identifier",
      "sh.openmeld.cli",
      "--entitlements",
      "/repo/scripts/release/macos-cli.entitlements.plist",
      "--keychain",
      "/tmp/release.keychain-db",
      "--sign",
      "ABC123",
      "/tmp/openmeld-cli-darwin-arm64-1.0.0",
    ]
  );
  assert.deepEqual(REQUIRED_BUN_ENTITLEMENTS, [
    "com.apple.security.cs.allow-jit",
    "com.apple.security.cs.allow-unsigned-executable-memory",
    "com.apple.security.cs.disable-executable-page-protection",
    "com.apple.security.cs.allow-dyld-environment-variables",
    "com.apple.security.cs.disable-library-validation",
  ]);
});

test("keeps the bare Developer ID CLI free of provisioning-profile entitlements", () => {
  const entitlements = readFileSync(ENTITLEMENTS_PATH, "utf8");

  assert.doesNotMatch(entitlements, RESTRICTED_KEYCHAIN_ENTITLEMENT_RE);
});

test("adds the signing Keychain without hiding the normal user Keychains", () => {
  const plan = buildCiKeychainSearchListPlan({
    currentSearchList: [
      '    "/Users/runner/Library/Keychains/login.keychain-db"',
      '    "/Library/Keychains/System.keychain"',
    ].join("\n"),
    ephemeralKeychainPath: "/private/tmp/release.keychain-db",
  });

  assert.deepEqual(plan.activateArgs, [
    "list-keychains",
    "-d",
    "user",
    "-s",
    "/private/tmp/release.keychain-db",
    "/Users/runner/Library/Keychains/login.keychain-db",
    "/Library/Keychains/System.keychain",
  ]);
  assert.deepEqual(plan.restoreArgs, [
    "list-keychains",
    "-d",
    "user",
    "-s",
    "/Users/runner/Library/Keychains/login.keychain-db",
    "/Library/Keychains/System.keychain",
  ]);
});

test("builds local and CI notarytool authentication arguments", () => {
  assert.deepEqual(
    buildNotarytoolSubmitArgs({
      credentials: {
        mode: "local",
        keychainProfile: "openmeld-notary",
        teamId: "38FFHDPA3B",
      },
      zipPath: "/tmp/openmeld.zip",
    }),
    [
      "notarytool",
      "submit",
      "/tmp/openmeld.zip",
      "--wait",
      "--output-format",
      "json",
      "--keychain-profile",
      "openmeld-notary",
    ]
  );

  assert.deepEqual(
    buildNotarytoolSubmitArgs({
      credentials: {
        mode: "ci",
        issuerId: "issuer-id",
        keyId: "key-id",
        keyPath: "/tmp/AuthKey.p8",
        teamId: "38FFHDPA3B",
      },
      zipPath: "/tmp/openmeld.zip",
    }),
    [
      "notarytool",
      "submit",
      "/tmp/openmeld.zip",
      "--wait",
      "--output-format",
      "json",
      "--key",
      "/tmp/AuthKey.p8",
      "--key-id",
      "key-id",
      "--issuer",
      "issuer-id",
    ]
  );
});

test("requires an Accepted notarization result", () => {
  const accepted = parseNotarytoolSubmission(
    JSON.stringify({ id: "submission-id", status: "Accepted" })
  );
  assert.deepEqual(accepted, {
    id: "submission-id",
    status: "Accepted",
  });
  assert.doesNotThrow(() => assertNotarizationAccepted(accepted));

  assert.throws(
    () =>
      assertNotarizationAccepted({
        id: "submission-id",
        message: "Archive contains critical validation errors",
        status: "Invalid",
      }),
    REJECTED_NOTARIZATION_RE
  );
});
