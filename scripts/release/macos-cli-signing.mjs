import { spawnSync } from "node:child_process";
import { randomBytes } from "node:crypto";
import { existsSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";

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

export const DEFAULT_APPLE_TEAM_ID = "38FFHDPA3B";
export const DEFAULT_NOTARY_KEYCHAIN_PROFILE = "openmeld-notary";
export const MACOS_KEYCHAIN_ACCESS_GROUP = "38FFHDPA3B.sh.openmeld.shared";
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
    "sh.openmeld.cli",
    "--entitlements",
    input.entitlementsPath,
    ...(input.keychainPath ? ["--keychain", input.keychainPath] : []),
    "--sign",
    input.identityHash,
    input.outFile,
  ];
}

export function buildCiKeychainSearchListArgs(keychainPath) {
  return ["list-keychains", "-d", "user", "-s", keychainPath];
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
  const credentials = resolveAppleReleaseCredentials(env);
  const tempDirectory = mkdtempSync(
    path.join(tmpdir(), "openmeld-apple-release-")
  );
  let ephemeralKeychainPath = null;

  try {
    let activeCredentials = credentials;
    if (credentials.mode === "ci") {
      const ciAssets = prepareCiSigningAssets({
        credentials,
        env,
        tempDirectory,
      });
      ephemeralKeychainPath = ciAssets.keychainPath;
      activeCredentials = {
        ...credentials,
        keyPath: ciAssets.keyPath,
      };
    }

    const identityHash = resolveDeveloperIdIdentity({
      env,
      keychainPath: ephemeralKeychainPath,
      teamId: credentials.teamId,
    });
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
        credentials: activeCredentials,
        zipPath,
      }),
      command: "xcrun",
      env,
      label: "Submit the signed CLI to Apple notarization",
    });
    const submission = parseNotarytoolSubmission(submissionOutput);
    if (submission.status !== "Accepted") {
      const diagnostic = readNotarizationLog({
        credentials: activeCredentials,
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
    if (ephemeralKeychainPath) {
      spawnSync("security", ["delete-keychain", ephemeralKeychainPath], {
        encoding: "utf8",
        env,
      });
    }
    rmSync(tempDirectory, { force: true, recursive: true });
  }
}

function prepareCiSigningAssets(input) {
  const keychainPath = path.join(input.tempDirectory, "release.keychain-db");
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
    args: ["create-keychain", "-p", keychainPassword, keychainPath],
    command: "security",
    env: input.env,
    label: "Create an ephemeral signing Keychain",
  });
  runCommand({
    args: ["set-keychain-settings", "-lut", "21600", keychainPath],
    command: "security",
    env: input.env,
    label: "Configure the ephemeral signing Keychain",
  });
  runCommand({
    args: ["unlock-keychain", "-p", keychainPassword, keychainPath],
    command: "security",
    env: input.env,
    label: "Unlock the ephemeral signing Keychain",
  });
  runCommand({
    args: [
      "import",
      p12Path,
      "-k",
      keychainPath,
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
      keychainPath,
    ],
    command: "security",
    env: input.env,
    label: "Authorize Apple signing tools in the ephemeral Keychain",
  });
  runCommand({
    args: buildCiKeychainSearchListArgs(keychainPath),
    command: "security",
    env: input.env,
    label: "Select the ephemeral signing Keychain for this CI user",
  });

  return { keychainPath, keyPath };
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
    args: ["--verify", "--strict", "--verbose=2", input.outFile],
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
  if (
    !entitlements.includes(`<string>${MACOS_KEYCHAIN_ACCESS_GROUP}</string>`)
  ) {
    throw new Error(
      `Signed CLI is missing the OpenMeld Keychain access group: ${MACOS_KEYCHAIN_ACCESS_GROUP}`
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

function hasCredentialValue(value) {
  return typeof value === "string" && value.trim().length > 0;
}

function normalizeCredentialValue(value) {
  return hasCredentialValue(value) ? value.trim() : null;
}
