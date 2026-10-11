import { spawnSync } from "node:child_process";
import { randomBytes } from "node:crypto";
import { existsSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";
import {
  OPENMELD_MACOS_CLI_SIGNING_IDENTITY,
  OPENMELD_MACOS_CLI_SIGNING_REQUIREMENT,
} from "../../packages/schemas/src/schemas/http/cli-binary-manifest.ts";

const SCRIPT_DIR = path.dirname(fileURLToPath(import.meta.url));
const ENTITLEMENTS_PATH = path.join(SCRIPT_DIR, "macos-cli.entitlements.plist");
const CI_SECRET_NAMES = [
  "APPLE_DEVELOPER_ID_P12_BASE64",
  "APPLE_DEVELOPER_ID_P12_PASSWORD",
  "APPLE_NOTARY_KEY_P8_BASE64",
  "APPLE_NOTARY_KEY_ID",
  "APPLE_NOTARY_ISSUER_ID",
  "APPLE_TEAM_ID",
];
const CI_CREDENTIAL_TRIGGER_NAMES = CI_SECRET_NAMES.filter(
  (name) => name !== "APPLE_TEAM_ID"
);
const SIGNING_IDENTITY_LINE_RE = /^\s*\d+\)\s+([0-9A-Fa-f]{40})\s+"([^"]+)"/u;
const LINE_SPLIT_RE = /\r?\n/u;
const HARDENED_RUNTIME_FLAG_RE = /flags=.*\bruntime\b/u;
const SIGNING_TIMESTAMP_RE = /(?:Timestamp|Signed Time)=/u;

export const DEFAULT_APPLE_TEAM_ID =
  OPENMELD_MACOS_CLI_SIGNING_IDENTITY.teamIdentifier;
export const DEFAULT_NOTARY_KEYCHAIN_PROFILE = "openmeld-notary";
export const REQUIRED_BUN_ENTITLEMENTS = [
  "com.apple.security.cs.allow-jit",
  "com.apple.security.cs.allow-unsigned-executable-memory",
  "com.apple.security.cs.disable-executable-page-protection",
  "com.apple.security.cs.allow-dyld-environment-variables",
  "com.apple.security.cs.disable-library-validation",
];

export function resolveAppleReleaseCredentials(env = process.env) {
  const hasCiCredential = CI_CREDENTIAL_TRIGGER_NAMES.some((name) =>
    hasCredentialValue(env[name])
  );
  if (!hasCiCredential) {
    return {
      mode: "local",
      keychainProfile:
        normalizeCredentialValue(env.APPLE_NOTARY_KEYCHAIN_PROFILE) ??
        DEFAULT_NOTARY_KEYCHAIN_PROFILE,
      teamId:
        normalizeCredentialValue(env.APPLE_TEAM_ID) ?? DEFAULT_APPLE_TEAM_ID,
    };
  }

  const missing = CI_SECRET_NAMES.filter(
    (name) => !hasCredentialValue(env[name])
  );
  if (missing.length > 0) {
    throw new Error(
      `Apple release credentials are incomplete. Missing: ${missing.join(", ")}`
    );
  }

  return {
    mode: "ci",
    issuerId: normalizeCredentialValue(env.APPLE_NOTARY_ISSUER_ID),
    keyId: normalizeCredentialValue(env.APPLE_NOTARY_KEY_ID),
    keyP8Base64: normalizeCredentialValue(env.APPLE_NOTARY_KEY_P8_BASE64),
    p12Base64: normalizeCredentialValue(env.APPLE_DEVELOPER_ID_P12_BASE64),
    p12Password: String(env.APPLE_DEVELOPER_ID_P12_PASSWORD),
    teamId: normalizeCredentialValue(env.APPLE_TEAM_ID),
  };
}

export function buildCodeSignArgs(input) {
  return [
    "--force",
    "--options",
    "runtime",
    "--timestamp",
    "--identifier",
    OPENMELD_MACOS_CLI_SIGNING_IDENTITY.codeIdentifier,
    "--entitlements",
    input.entitlementsPath,
    ...(input.keychainPath ? ["--keychain", input.keychainPath] : []),
    "--sign",
    input.identityHash,
    input.outFile,
  ];
}

export function buildCiKeychainSearchListPlan(input) {
  const originalPaths = String(input.currentSearchList ?? "")
    .split(LINE_SPLIT_RE)
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => {
      let parsed;
      try {
        parsed = JSON.parse(line);
      } catch (error) {
        throw new Error(
          `Could not parse the macOS user Keychain search list entry ${line}: ${error instanceof Error ? error.message : String(error)}`
        );
      }
      if (typeof parsed !== "string" || parsed.length === 0) {
        throw new Error(
          `macOS returned an invalid user Keychain search list entry: ${line}`
        );
      }
      return parsed;
    });
  const activePaths = [
    input.ephemeralKeychainPath,
    ...originalPaths.filter((path) => path !== input.ephemeralKeychainPath),
  ];
  return {
    activateArgs: buildUserKeychainSearchListArgs(activePaths),
    restoreArgs: buildUserKeychainSearchListArgs(originalPaths),
  };
}

export function buildNotarytoolSubmitArgs(input) {
  return [
    "notarytool",
    "submit",
    input.zipPath,
    "--wait",
    "--output-format",
    "json",
    ...buildNotarytoolAuthArgs(input.credentials),
  ];
}

export function parseNotarytoolSubmission(rawOutput) {
  let value;
  try {
    value = JSON.parse(String(rawOutput));
  } catch (error) {
    throw new Error(
      `Apple notarization returned invalid JSON: ${error instanceof Error ? error.message : String(error)}`
    );
  }
  if (
    !value ||
    typeof value !== "object" ||
    typeof value.id !== "string" ||
    value.id.trim().length === 0 ||
    typeof value.status !== "string" ||
    value.status.trim().length === 0
  ) {
    throw new Error(
      "Apple notarization response must include non-empty id and status fields."
    );
  }
  return {
    id: value.id.trim(),
    status: value.status.trim(),
    ...(typeof value.message === "string" && value.message.trim().length > 0
      ? { message: value.message.trim() }
      : {}),
  };
}

export function assertNotarizationAccepted(submission) {
  if (submission.status === "Accepted") {
    return;
  }
  throw new Error(
    [
      `Apple notarization ${submission.id} returned ${submission.status}.`,
      submission.message ?? "Apple did not return an explanatory message.",
    ].join(" ")
  );
}

export function signAndNotarizeCliBinary(input) {
  if (process.platform !== "darwin") {
    throw new Error(
      `Apple CLI signing requires macOS, but this release is running on ${process.platform}.`
    );
  }
  if (input.platform !== "darwin-arm64") {
    throw new Error(
      `Apple CLI signing only supports darwin-arm64, received ${input.platform}.`
    );
  }
  if (!existsSync(input.outFile)) {
    throw new Error(`CLI binary does not exist: ${input.outFile}`);
  }
  if (!existsSync(ENTITLEMENTS_PATH)) {
    throw new Error(`CLI entitlements do not exist: ${ENTITLEMENTS_PATH}`);
  }

  const env = input.env ?? process.env;
  const session = createAppleReleaseSigningSession(env);
  const {
    credentials,
    identityHash,
    keychainPath: ephemeralKeychainPath,
    tempDirectory,
  } = session;
  try {
    runCommand({
      args: buildCodeSignArgs({
        entitlementsPath: ENTITLEMENTS_PATH,
        identityHash,
        keychainPath: ephemeralKeychainPath,
        outFile: input.outFile,
      }),
      command: "codesign",
      env,
      label: "Sign the OpenMeld CLI with Developer ID",
    });
    verifySignedCliBinary({
      env,
      outFile: input.outFile,
      teamId: credentials.teamId,
    });

    const zipPath = path.join(
      tempDirectory,
      `${path.basename(input.outFile)}.zip`
    );
    runCommand({
      args: ["-c", "-k", "--keepParent", input.outFile, zipPath],
      command: "/usr/bin/ditto",
      env,
      label: "Package the signed CLI for Apple notarization",
    });

    const submissionOutput = runCommand({
      args: buildNotarytoolSubmitArgs({
        credentials,
        zipPath,
      }),
      command: "xcrun",
      env,
      label: "Submit the signed CLI to Apple notarization",
    });
    const submission = parseNotarytoolSubmission(submissionOutput);
    if (submission.status !== "Accepted") {
      const diagnostic = readNotarizationLog({
        credentials,
        env,
        submissionId: submission.id,
      });
      assertNotarizationAccepted({
        ...submission,
        message: [submission.message, diagnostic].filter(Boolean).join("\n"),
      });
    }

    process.stdout.write(
      `[release:apple] Apple notarization accepted: ${submission.id}\n`
    );
    return {
      credentialMode: credentials.mode,
      submissionId: submission.id,
      teamId: credentials.teamId,
    };
  } finally {
    session.close();
  }
}

export function createAppleReleaseSigningSession(env = process.env) {
  if (process.platform !== "darwin") {
    throw new Error("Apple release signing requires macOS.");
  }
  const credentials = resolveAppleReleaseCredentials(env);
  const tempDirectory = mkdtempSync(
    path.join(tmpdir(), "openmeld-apple-release-")
  );
  let ephemeralKeychainPath = null;
  let restoreUserKeychainSearchListArgs = null;
  let closed = false;
  const close = () => {
    if (closed) {
      return;
    }
    closed = true;
    if (restoreUserKeychainSearchListArgs) {
      runCleanupCommand({
        args: restoreUserKeychainSearchListArgs,
        command: "security",
        env,
        label: "Restore the original user Keychain search list",
      });
    }
    if (ephemeralKeychainPath) {
      runCleanupCommand({
        args: ["delete-keychain", ephemeralKeychainPath],
        command: "security",
        env,
        label: "Delete the ephemeral signing Keychain",
      });
    }
    rmSync(tempDirectory, { force: true, recursive: true });
  };
  try {
    let activeCredentials = credentials;
    if (credentials.mode === "ci") {
      ephemeralKeychainPath = path.join(tempDirectory, "release.keychain-db");
      const currentSearchList = runCommand({
        args: ["list-keychains", "-d", "user"],
        command: "security",
        env,
        label: "Read the existing user Keychain search list",
      });
      const plan = buildCiKeychainSearchListPlan({
        currentSearchList,
        ephemeralKeychainPath,
      });
      restoreUserKeychainSearchListArgs = plan.restoreArgs;
      const assets = prepareCiSigningAssets({
        credentials,
        env,
        keychainPath: ephemeralKeychainPath,
        keychainSearchListArgs: plan.activateArgs,
        tempDirectory,
      });
      activeCredentials = { ...credentials, keyPath: assets.keyPath };
    }
    const identityHash = resolveDeveloperIdIdentity({
      env,
      keychainPath: ephemeralKeychainPath,
      teamId: credentials.teamId,
    });
    return {
      credentials: activeCredentials,
      identityHash,
      keychainPath: ephemeralKeychainPath,
      tempDirectory,
      close,
    };
  } catch (error) {
    close();
    throw error;
  }
}

export function prepareDesktopAppleSigning(env = process.env) {
  const session = createAppleReleaseSigningSession(env);
  try {
    const childEnv = { ...env };
    if (session.credentials.teamId !== DEFAULT_APPLE_TEAM_ID) {
      throw new Error("Desktop signing requires the production Apple team.");
    }
    if (session.credentials.mode === "ci") {
      runCommand({
        command: "xcrun",
        args: [
          "notarytool",
          "store-credentials",
          DEFAULT_NOTARY_KEYCHAIN_PROFILE,
          "--key",
          session.credentials.keyPath,
          "--key-id",
          session.credentials.keyId,
          "--issuer",
          session.credentials.issuerId,
          "--keychain",
          session.keychainPath,
        ],
        env,
        label: "Prepare Desktop notarization in the ephemeral Keychain",
      });
      childEnv.APPLE_KEYCHAIN = session.keychainPath;
      childEnv.CSC_KEYCHAIN = session.keychainPath;
      childEnv.APPLE_KEYCHAIN_PROFILE = DEFAULT_NOTARY_KEYCHAIN_PROFILE;
    }
    for (const name of CI_CREDENTIAL_TRIGGER_NAMES) {
      delete childEnv[name];
    }
    return { env: childEnv, close: session.close };
  } catch (error) {
    session.close();
    throw error;
  }
}

function prepareCiSigningAssets(input) {
  const keyPath = path.join(input.tempDirectory, "AuthKey.p8");
  const p12Path = path.join(input.tempDirectory, "DeveloperID.p12");
  const keychainPassword = randomBytes(32).toString("base64url");

  writeSecretFile({
    encoded: input.credentials.p12Base64,
    filePath: p12Path,
    name: "APPLE_DEVELOPER_ID_P12_BASE64",
  });
  writeSecretFile({
    encoded: input.credentials.keyP8Base64,
    filePath: keyPath,
    name: "APPLE_NOTARY_KEY_P8_BASE64",
  });

  runCommand({
    args: ["create-keychain", "-p", keychainPassword, input.keychainPath],
    command: "security",
    env: input.env,
    label: "Create an ephemeral signing Keychain",
  });
  runCommand({
    args: ["set-keychain-settings", "-lut", "21600", input.keychainPath],
    command: "security",
    env: input.env,
    label: "Configure the ephemeral signing Keychain",
  });
  runCommand({
    args: ["unlock-keychain", "-p", keychainPassword, input.keychainPath],
    command: "security",
    env: input.env,
    label: "Unlock the ephemeral signing Keychain",
  });
  runCommand({
    args: [
      "import",
      p12Path,
      "-k",
      input.keychainPath,
      "-P",
      input.credentials.p12Password,
      "-T",
      "/usr/bin/codesign",
      "-T",
      "/usr/bin/security",
    ],
    command: "security",
    env: input.env,
    label: "Import the Developer ID signing identity",
  });
  runCommand({
    args: [
      "set-key-partition-list",
      "-S",
      "apple-tool:,apple:",
      "-s",
      "-k",
      keychainPassword,
      input.keychainPath,
    ],
    command: "security",
    env: input.env,
    label: "Authorize Apple signing tools in the ephemeral Keychain",
  });
  runCommand({
    args: input.keychainSearchListArgs,
    command: "security",
    env: input.env,
    label: "Add the signing Keychain beside the normal user Keychains",
  });
  return { keyPath };
}

function resolveDeveloperIdIdentity(input) {
  const output = runCommand({
    args: [
      "find-identity",
      "-v",
      "-p",
      "codesigning",
      ...(input.keychainPath ? [input.keychainPath] : []),
    ],
    command: "security",
    env: input.env,
    label: "Resolve the Developer ID signing identity",
  });
  const matches = output
    .split(LINE_SPLIT_RE)
    .map((line) => line.match(SIGNING_IDENTITY_LINE_RE))
    .filter(Boolean)
    .filter(
      (match) =>
        match[2].startsWith("Developer ID Application:") &&
        match[2].includes(`(${input.teamId})`)
    );
  if (matches.length !== 1) {
    throw new Error(
      `Expected exactly one Developer ID Application identity for team ${input.teamId}, found ${matches.length}.`
    );
  }
  return matches[0][1];
}

function verifySignedCliBinary(input) {
  runCommand({
    args: [
      "--verify",
      "--strict",
      "--verbose=2",
      `-R=${OPENMELD_MACOS_CLI_SIGNING_REQUIREMENT}`,
      input.outFile,
    ],
    command: "codesign",
    env: input.env,
    label: "Verify the Developer ID signature",
  });
  const details = runCommand({
    args: ["--display", "--verbose=4", input.outFile],
    command: "codesign",
    env: input.env,
    label: "Inspect the Developer ID signature",
  });
  const requiredDetails = [
    "Identifier=sh.openmeld.cli",
    `TeamIdentifier=${input.teamId}`,
    "Authority=Developer ID Application:",
  ];
  for (const detail of requiredDetails) {
    if (!details.includes(detail)) {
      throw new Error(
        `Signed CLI is missing expected signature detail: ${detail}`
      );
    }
  }
  if (!HARDENED_RUNTIME_FLAG_RE.test(details)) {
    throw new Error("Signed CLI is missing the hardened runtime flag.");
  }
  if (!SIGNING_TIMESTAMP_RE.test(details)) {
    throw new Error("Signed CLI is missing a trusted signing timestamp.");
  }

  const entitlements = runCommand({
    args: ["--display", "--entitlements", ":-", input.outFile],
    command: "codesign",
    env: input.env,
    label: "Inspect the signed CLI entitlements",
  });
  for (const entitlement of REQUIRED_BUN_ENTITLEMENTS) {
    if (!entitlements.includes(`<key>${entitlement}</key>`)) {
      throw new Error(
        `Signed CLI is missing required entitlement: ${entitlement}`
      );
    }
  }
  if (entitlements.includes("<key>keychain-access-groups</key>")) {
    throw new Error(
      "Signed bare CLI must not require a provisioning profile for Keychain access."
    );
  }
}

function readNotarizationLog(input) {
  try {
    return runCommand({
      args: [
        "notarytool",
        "log",
        input.submissionId,
        ...buildNotarytoolAuthArgs(input.credentials),
      ],
      command: "xcrun",
      env: input.env,
      label: "Read the rejected Apple notarization log",
    });
  } catch (error) {
    return `Notarization log lookup failed: ${error instanceof Error ? error.message : String(error)}`;
  }
}

function buildNotarytoolAuthArgs(credentials) {
  if (credentials.mode === "local") {
    return ["--keychain-profile", credentials.keychainProfile];
  }
  if (!credentials.keyPath) {
    throw new Error(
      "CI notarization credentials are missing the decoded .p8 path."
    );
  }
  return [
    "--key",
    credentials.keyPath,
    "--key-id",
    credentials.keyId,
    "--issuer",
    credentials.issuerId,
  ];
}

function writeSecretFile(input) {
  const decoded = Buffer.from(input.encoded, "base64");
  if (decoded.length === 0) {
    throw new Error(`${input.name} decoded to an empty file.`);
  }
  writeFileSync(input.filePath, decoded, { mode: 0o600 });
}

function runCommand(input) {
  process.stdout.write(`[release:apple] ${input.label}\n`);
  const result = spawnSync(input.command, input.args, {
    encoding: "utf8",
    env: input.env,
    maxBuffer: 10 * 1024 * 1024,
  });
  if (result.error) {
    throw result.error;
  }
  const output = `${String(result.stdout ?? "")}${String(result.stderr ?? "")}`;
  if (result.status !== 0) {
    throw new Error(
      `${input.label} failed with exit code ${result.status}.${output.trim() ? `\n${output.trim()}` : ""}`
    );
  }
  return output.trim();
}

function buildUserKeychainSearchListArgs(paths) {
  return ["list-keychains", "-d", "user", "-s", ...paths];
}

function runCleanupCommand(input) {
  const result = spawnSync(input.command, input.args, {
    encoding: "utf8",
    env: input.env,
  });
  if (!result.error && result.status === 0) {
    return;
  }
  const output = `${String(result.stdout ?? "")}${String(result.stderr ?? "")}`;
  const detail = result.error
    ? result.error.message
    : `exit ${String(result.status)}${output.trim() ? `: ${output.trim()}` : ""}`;
  process.stderr.write(`[release:apple] ${input.label} failed: ${detail}\n`);
}

function hasCredentialValue(value) {
  return typeof value === "string" && value.trim().length > 0;
}

function normalizeCredentialValue(value) {
  return hasCredentialValue(value) ? value.trim() : null;
}
