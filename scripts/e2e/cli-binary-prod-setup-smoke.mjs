#!/usr/bin/env node

import { spawn, spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { createServer } from "node:http";
import { tmpdir } from "node:os";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";
import { gunzipSync, gzipSync } from "node:zlib";
import { buildOpenMeldSetupBootstrapScript } from "../../clients/web/src/lib/setup-bootstrap-script.ts";
import {
  betterAuthDeviceAuthorizationTokenRequestSchema,
  betterAuthDeviceAuthorizationTokenResponseSchema,
  betterAuthSessionSnapshotResponseSchema,
  prepareSessionResponseSchema,
} from "../../packages/schemas/dist/index.js";
import { buildCliBinary } from "../release/build-cli-binary.mjs";

const SCRIPT_DIR = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(SCRIPT_DIR, "..", "..");
const BOOTSTRAP_HANDOFF_LINE = 'run_openmeld "$@" || exit $?';
const OPENMELD_ENV_KEYS_TO_CLEAR = new Set([
  "OPENMELD_AUTH_URL",
  "OPENMELD_ENV_PRESET",
  "OPENMELD_GATEWAY_URL",
  "OPENMELD_HOME",
  "OPENMELD_SETUP_FOLLOW_UP_CLI_COMMAND",
  "OPENMELD_USER_FACING_CLI_COMMAND",
]);

// Auth fixtures are validated by the shared Better Auth vendor-contract schemas.
// The HTTP server returns the unprojected fixture so its serialized shape keeps
// the extra vendor fields from the sanitized capture in
// services/auth/tests/better-auth-routes.test.ts; only fixture values differ.
const validateCapturedFixture = (schema, fixture) => {
  schema.parse(fixture);
  return fixture;
};
const FIXTURE_ACCOUNT_A_SESSION_RESPONSE = validateCapturedFixture(
  betterAuthSessionSnapshotResponseSchema,
  {
    session: {
      id: "fixture-session-a",
      token: "redacted-session-token-a",
      userId: "fixture-user-a",
      activeOrganizationId: "fixture-organization",
      expiresAt: "2099-08-31T00:00:00.000Z",
      createdAt: "2026-08-31T00:00:00.000Z",
      updatedAt: "2026-08-31T00:00:00.000Z",
      ipAddress: "127.0.0.1",
      userAgent: "",
    },
    user: {
      id: "fixture-user-a",
      email: "account-a@example.invalid",
      name: "Fixture Account A",
      emailVerified: true,
      image: null,
      username: null,
      displayUsername: null,
      createdAt: "2026-08-31T00:00:00.000Z",
      updatedAt: "2026-08-31T00:00:00.000Z",
    },
  }
);
const FIXTURE_ACCOUNT_B_SESSION_RESPONSE = validateCapturedFixture(
  betterAuthSessionSnapshotResponseSchema,
  {
    session: {
      id: "fixture-session-b",
      token: "redacted-session-token-b",
      userId: "fixture-user-b",
      activeOrganizationId: "fixture-organization",
      expiresAt: "2099-08-31T00:00:00.000Z",
      createdAt: "2026-08-31T00:00:00.000Z",
      updatedAt: "2026-08-31T00:00:00.000Z",
      ipAddress: "127.0.0.1",
      userAgent: "",
    },
    user: {
      id: "fixture-user-b",
      email: "account-b@example.invalid",
      name: "Fixture Account B",
      emailVerified: true,
      image: null,
      username: null,
      displayUsername: null,
      createdAt: "2026-08-31T00:00:00.000Z",
      updatedAt: "2026-08-31T00:00:00.000Z",
    },
  }
);
const FIXTURE_DEVICE_TOKEN_RESPONSE =
  betterAuthDeviceAuthorizationTokenResponseSchema.parse({
    access_token: "fixture-access-token-b",
    token_type: "Bearer",
    expires_in: 3600,
    scope: "openid profile email",
  });

async function main() {
  const tempRoot = await mkdtemp(
    path.join(tmpdir(), "openmeld-cli-binary-prod-smoke-")
  );
  const openMeldHome = path.join(tempRoot, ".openmeld");
  const keepTemp = process.env.OPENMELD_KEEP_BINARY_PROD_SMOKE === "1";
  let server;

  try {
    const built = buildCliBinary({
      outDir: path.join(tempRoot, "dist"),
      platform: "darwin-arm64",
    });
    server = await startBinaryManifestServer({
      artifactPath: built.outFile,
      built,
    });
    const manifestUrl = `${server.origin}/cli/manifest.json`;
    await verifyManifestDownload({
      expectedSha256: built.sha256,
      manifestUrl,
    });

    const productionBootstrap = buildOpenMeldSetupBootstrapScript({
      authUrl: server.origin,
      binaryManifestUrl: manifestUrl,
      distribution: "binary",
      gatewayUrl: server.origin,
      lane: "prod",
      openMeldHome,
    });
    server.setSetupScript(productionBootstrap);
    assertGeneratedProductionBinaryBootstrap({
      manifestUrl,
      script: productionBootstrap,
      openMeldHome,
    });

    const installOnlyBootstrap =
      buildInstallOnlyProductionBootstrap(productionBootstrap);
    const setupOutput = await runPipedSetupBootstrap({
      env: buildBootstrapEnv({ tempRoot }),
      script: installOnlyBootstrap,
    });
    assertBootstrapOutput({
      expectedDownloadSizeMb: Math.max(
        1,
        Math.round(server.archiveSizeBytes / 1_048_576)
      ),
      managedBinaryPath: path.join(openMeldHome, "bin", "openmeld"),
      output: setupOutput,
    });
    const requestCountsAfterInstall = server.getRequestCounts();
    const repeatedSetupOutput = await runPipedSetupBootstrap({
      env: buildBootstrapEnv({ tempRoot }),
      label: "repeated setup reuses the managed binary smoke",
      script: installOnlyBootstrap,
    });
    assertRepeatedBootstrapOutput({
      managedBinaryPath: path.join(openMeldHome, "bin", "openmeld"),
      output: repeatedSetupOutput,
    });
    const requestCountsAfterReuse = server.getRequestCounts();
    if (
      requestCountsAfterReuse.manifest !==
        requestCountsAfterInstall.manifest + 1 ||
      requestCountsAfterReuse.raw !== requestCountsAfterInstall.raw ||
      requestCountsAfterReuse.archive !== requestCountsAfterInstall.archive
    ) {
      throw new Error(
        `repeated setup downloaded an artifact: ${JSON.stringify({ requestCountsAfterInstall, requestCountsAfterReuse })}`
      );
    }

    const managedBinaryPath = path.join(openMeldHome, "bin", "openmeld");
    runCommand({
      args: ["--version"],
      command: managedBinaryPath,
      env: buildManagedBinaryEnv({ managedBinaryPath, tempRoot, openMeldHome }),
      expectedStdout: built.version,
      label: "managed production-lane binary version smoke",
    });
    await seedPreviousAccount({
      managedBinaryPath,
      openMeldHome,
      serverOrigin: server.origin,
      tempRoot,
    });
    const directAccountSwitchOutput = await runAccountSwitchPtySmoke({
      command: `'${managedBinaryPath}' setup --start-session fixture-prepare-session --device-code fixture-device-code-b --view human`,
      env: buildManagedBinaryEnv({
        managedBinaryPath,
        serverOrigin: server.origin,
        tempRoot,
        openMeldHome,
      }),
      interaction: "arrows-and-enter",
      label: "direct managed CLI account-switch PTY smoke",
    });
    assertAccountSwitchPtyOutput(directAccountSwitchOutput);
    const accountSwitchOutput = await runPipedAccountSwitchPtySmoke({
      env: buildManagedBinaryEnv({
        managedBinaryPath,
        serverOrigin: server.origin,
        tempRoot,
        openMeldHome,
      }),
      setupUrl: `${server.origin}/setup`,
    });
    assertAccountSwitchPtyOutput(accountSwitchOutput);
    const accountSwitchEscapeOutput = await runPipedAccountSwitchPtySmoke({
      env: buildManagedBinaryEnv({
        managedBinaryPath,
        serverOrigin: server.origin,
        tempRoot,
        openMeldHome,
      }),
      interaction: "escape",
      setupUrl: `${server.origin}/setup`,
    });
    assertAccountSwitchPtyOutput(accountSwitchEscapeOutput);
    const nonInteractiveAccountSwitchOutput =
      await runNonInteractivePipedAccountSwitchSmoke({
        env: buildManagedBinaryEnv({
          managedBinaryPath,
          serverOrigin: server.origin,
          tempRoot,
          openMeldHome,
        }),
        setupUrl: `${server.origin}/setup`,
      });
    assertNonInteractiveAccountSwitchOutput(nonInteractiveAccountSwitchOutput);
    assertAccountSwitchRevocationCount(server.getRequestCounts());

    process.stdout.write(
      [
        "[cli:binary:prod-smoke] ok",
        `- version: ${built.version}`,
        `- artifact: ${built.artifactName}`,
        `- sha256: ${built.sha256}`,
        `- sizeBytes: ${built.sizeBytes}`,
        `- archiveSizeBytes: ${server.archiveSizeBytes}`,
        `- displayedDownloadSizeMb: ${Math.max(1, Math.round(server.archiveSizeBytes / 1_048_576))}`,
        "- repeatedSetupArtifactDownloads: 0",
        `- localhostManifestUrl: ${manifestUrl}`,
        `- openMeldHome: ${openMeldHome}`,
        `- managedBinaryPath: ${managedBinaryPath}`,
        keepTemp ? `- tempRoot: ${tempRoot}` : "- tempRoot: cleaned up",
        "",
      ].join("\n")
    );
  } finally {
    await server?.close();
    if (keepTemp) {
      process.stdout.write(
        `[cli:binary:prod-smoke] kept temporary files at ${tempRoot}\n`
      );
    } else {
      await rm(tempRoot, { force: true, recursive: true });
    }
  }
}

function buildInstallOnlyProductionBootstrap(script) {
  const replacement = [
    'if [ "$OPENMELD_SETUP_DISTRIBUTION" != "binary" ]; then',
    '  die "The production binary smoke must use the binary distribution."',
    "fi",
    'install_binary_openmeld || die "OpenMeld could not install the CLI binary."',
    'say "OpenMeld binary install smoke complete."',
    'say "managedBinary=$OPENMELD_SETUP_BINARY_COMMAND"',
    '"$OPENMELD_SETUP_BINARY_COMMAND" --version < /dev/null || die "OpenMeld managed binary version smoke failed."',
  ].join("\n");
  const updated = script.replace(BOOTSTRAP_HANDOFF_LINE, replacement);
  if (updated === script) {
    throw new Error("could not replace the setup bootstrap handoff line");
  }
  return updated;
}

function buildBootstrapEnv(input) {
  return {
    ...Object.fromEntries(
      Object.entries(process.env).filter(
        ([key]) => !OPENMELD_ENV_KEYS_TO_CLEAR.has(key)
      )
    ),
    HOME: input.tempRoot,
  };
}

function buildManagedBinaryEnv(input) {
  return {
    ...buildBootstrapEnv({ tempRoot: input.tempRoot }),
    OPENMELD_ACCEPT_DISCLAIMER: "1",
    OPENMELD_AUTH_FORCE_INSECURE_FILE_TOKEN: "1",
    OPENMELD_DEV_MODE: "1",
    OPENMELD_ENV_PRESET: "prod",
    ...(input.serverOrigin
      ? {
          OPENMELD_AUTH_URL: input.serverOrigin,
          OPENMELD_GATEWAY_URL: input.serverOrigin,
        }
      : {}),
    OPENMELD_HOME: input.openMeldHome,
    OPENMELD_USER_FACING_CLI_COMMAND: input.managedBinaryPath,
  };
}

async function seedPreviousAccount(input) {
  await runCommandAsync({
    args: [
      "auth",
      "login",
      "--method",
      "ott",
      "--ott",
      "fixture-account-a",
      "--auth-url",
      input.serverOrigin,
      "--no-open",
      "--view",
      "human",
    ],
    command: input.managedBinaryPath,
    env: buildManagedBinaryEnv(input),
    expectedOutput: "Welcome account-a@example.invalid",
    label: "seed previous account through the real CLI login flow",
  });
}

async function runPipedAccountSwitchPtySmoke(input) {
  process.stdout.write(
    "[cli:binary:prod-smoke] piped bootstrap account-switch PTY smoke\n"
  );
  return await runAccountSwitchPtySmoke({
    command: `curl -fsSL '${input.setupUrl}' | sh -s -- setup --start-session fixture-prepare-session --device-code fixture-device-code-b --view human`,
    env: input.env,
    interaction: input.interaction ?? "arrows-and-enter",
    label:
      input.interaction === "escape"
        ? "cancel piped account-switch prompt with Escape"
        : "drive account-switch prompt through curl | sh",
  });
}

async function runAccountSwitchPtySmoke(input) {
  if (process.platform !== "darwin") {
    process.stdout.write(
      "[cli:binary:prod-smoke] skipped account-switch PTY smoke outside darwin\n"
    );
    return "SKIPPED";
  }

  const expectScript = [
    "set timeout 12",
    "set command $env(OPENMELD_ACCOUNT_SWITCH_COMMAND)",
    'spawn sh -c "stty rows 40 columns 120; $command"',
    "expect {",
    "  -re {Switch this computer from account-a@example\\.invalid to account-b@example\\.invalid\\?} {}",
    "  timeout { exit 3 }",
    "  eof { exit 4 }",
    "}",
    "after 150",
    ...(input.interaction === "escape"
      ? ['send "\\033"']
      : [
          'send "\\033\\[B"',
          "expect {",
          "  -re {●.*Switch account.*○.*Keep current account} {}",
          "  timeout { exit 5 }",
          "  eof { exit 6 }",
          "}",
          'send "\\033\\[A"',
          "expect {",
          "  -re {○.*Switch account.*●.*Keep current account} {}",
          "  timeout { exit 7 }",
          "  eof { exit 8 }",
          "}",
          'send "\\r"',
        ]),
    "expect {",
    "  -re {Account switch canceled\\. The current Computer connection was not changed\\.} {}",
    "  timeout { exit 9 }",
    "  eof { exit 10 }",
    "}",
    "expect eof",
    "set waitResult [wait]",
    "exit [lindex $waitResult 3]",
  ].join("\n");

  return await runCommandAsync({
    args: ["-c", expectScript],
    command: "expect",
    env: {
      ...input.env,
      OPENMELD_ACCOUNT_SWITCH_COMMAND: input.command,
    },
    label: input.label,
    timeoutMs: 20_000,
  }).then((result) => result.output);
}

async function runNonInteractivePipedAccountSwitchSmoke(input) {
  process.stdout.write(
    "[cli:binary:prod-smoke] non-interactive piped account-switch fails closed smoke\n"
  );
  const command = `curl -fsSL '${input.setupUrl}' | sh -s -- setup --start-session fixture-prepare-session --device-code fixture-device-code-b --view human`;
  const result = await runCommandAsync({
    args: ["-c", command],
    command: "sh",
    env: input.env,
    expectedExitCode: 1,
    label: "fail piped account switch without a controlling TTY",
    timeoutMs: 5000,
  });
  return result.output;
}

function assertAccountSwitchPtyOutput(output) {
  if (output === "SKIPPED") {
    return;
  }
  for (const expected of [
    "Switch this computer from account-a@example.invalid to account-b@example.invalid?",
    "Account switch canceled. The current Computer connection was not changed.",
  ]) {
    if (!output.includes(expected)) {
      throw new Error(
        `account-switch PTY output is missing ${expected}:\n${output}`
      );
    }
  }
}

function assertNonInteractiveAccountSwitchOutput(output) {
  const expected =
    "Run the setup command in an interactive Terminal to review and confirm the account switch.";
  if (!output.includes(expected)) {
    throw new Error(
      `non-interactive account-switch output is missing ${expected}:\n${output}`
    );
  }
  if (output.includes("Switch this computer from account-a@example.invalid")) {
    throw new Error(
      `non-interactive account switch displayed an unusable prompt:\n${output}`
    );
  }
}

function assertAccountSwitchRevocationCount(requestCounts) {
  const expectedRevocations = 4;
  if (requestCounts.authSignOut !== expectedRevocations) {
    throw new Error(
      `expected ${expectedRevocations} unused account-switch sessions to be revoked, received ${requestCounts.authSignOut}`
    );
  }
}

async function runPipedSetupBootstrap(input) {
  process.stdout.write(
    `[cli:binary:prod-smoke] ${input.label ?? "production setup bootstrap download/install smoke"}\n`
  );
  return await new Promise((resolve, reject) => {
    const child = spawn(
      "sh",
      [
        "-s",
        "--",
        "setup",
        "--start-session",
        "preptok_local_binary_prod_smoke",
        "--ott",
        "ott_local_binary_prod_smoke",
        "--view",
        "agent",
        "--local-agents",
        "none",
      ],
      {
        cwd: REPO_ROOT,
        env: input.env,
        stdio: ["pipe", "pipe", "pipe"],
      }
    );
    let stdout = "";
    let stderr = "";
    let settled = false;
    const finish = (error, output) => {
      if (settled) {
        return;
      }
      settled = true;
      clearTimeout(timeout);
      if (error) {
        reject(error);
        return;
      }
      resolve(output);
    };
    const timeout = setTimeout(() => {
      const output = `${stdout}\n${stderr}`;
      child.kill("SIGKILL");
      finish(
        new Error(
          ["production setup bootstrap smoke timed out", output].join("\n")
        )
      );
    }, 120_000);

    child.stdout.setEncoding("utf8");
    child.stderr.setEncoding("utf8");
    child.stdout.on("data", (chunk) => {
      stdout += chunk;
    });
    child.stderr.on("data", (chunk) => {
      stderr += chunk;
    });
    child.on("error", (error) => {
      finish(error);
    });
    child.on("close", (code, signal) => {
      const output = `${stdout}\n${stderr}`;
      if (code !== 0) {
        finish(
          new Error(
            [
              `production setup bootstrap smoke failed with exit ${String(code)}${signal ? ` signal ${signal}` : ""}`,
              output,
            ].join("\n")
          )
        );
        return;
      }
      finish(null, output);
    });
    child.stdin.end(input.script);
  });
}

function runCommand(input) {
  process.stdout.write(`[cli:binary:prod-smoke] ${input.label}\n`);
  const result = spawnSync(input.command, input.args, {
    cwd: REPO_ROOT,
    encoding: "utf8",
    env: input.env,
    timeout: 30_000,
  });
  if (result.status !== 0) {
    throw new Error(
      [
        `${input.command} ${input.args.join(" ")} failed with exit ${result.status}`,
        result.stdout,
        result.stderr,
      ].join("\n")
    );
  }
  if (
    input.expectedStdout &&
    String(result.stdout).trim() !== input.expectedStdout
  ) {
    throw new Error(
      `expected stdout ${input.expectedStdout}, received ${String(result.stdout).trim()}`
    );
  }
  return result;
}

async function runCommandAsync(input) {
  process.stdout.write(`[cli:binary:prod-smoke] ${input.label}\n`);
  return await new Promise((resolve, reject) => {
    const child = spawn(input.command, input.args, {
      cwd: REPO_ROOT,
      env: input.env,
      stdio: ["ignore", "pipe", "pipe"],
    });
    let output = "";
    let settled = false;
    const finish = (error, result) => {
      if (settled) {
        return;
      }
      settled = true;
      clearTimeout(timeout);
      if (error) {
        reject(error);
        return;
      }
      resolve(result);
    };
    const timeout = setTimeout(() => {
      child.kill("SIGKILL");
      finish(
        new Error(
          `${input.label} timed out after ${input.timeoutMs ?? 30_000}ms:\n${output}`
        )
      );
    }, input.timeoutMs ?? 30_000);
    for (const stream of [child.stdout, child.stderr]) {
      stream.setEncoding("utf8");
      stream.on("data", (chunk) => {
        output += chunk;
      });
    }
    child.on("error", (error) => finish(error));
    child.on("close", (code, signal) => {
      const expectedExitCode = input.expectedExitCode ?? 0;
      if (code !== expectedExitCode) {
        finish(
          new Error(
            `${input.label} exited ${String(code)} instead of ${String(expectedExitCode)}${signal ? ` signal ${signal}` : ""}:\n${output}`
          )
        );
        return;
      }
      if (input.expectedOutput && !output.includes(input.expectedOutput)) {
        finish(
          new Error(
            `${input.label} output is missing ${input.expectedOutput}:\n${output}`
          )
        );
        return;
      }
      finish(null, { exitCode: code, output });
    });
  });
}

async function verifyManifestDownload(input) {
  process.stdout.write(
    "[cli:binary:prod-smoke] localhost manifest and artifact sha256 smoke\n"
  );
  const manifestResponse = await fetch(input.manifestUrl);
  if (!manifestResponse.ok) {
    throw new Error(`manifest fetch failed: HTTP ${manifestResponse.status}`);
  }
  const manifest = await manifestResponse.json();
  const platform = manifest.channels?.stable?.platforms?.["darwin-arm64"];
  if (
    !platform?.archiveUrl ||
    platform.archiveFormat !== "gzip" ||
    platform.sha256 !== input.expectedSha256
  ) {
    throw new Error("manifest did not expose the expected darwin-arm64 binary");
  }
  const artifactResponse = await fetch(platform.archiveUrl);
  if (!artifactResponse.ok) {
    throw new Error(`artifact fetch failed: HTTP ${artifactResponse.status}`);
  }
  const archive = Buffer.from(await artifactResponse.arrayBuffer());
  const archiveSha256 = createHash("sha256").update(archive).digest("hex");
  if (archiveSha256 !== platform.archiveSha256) {
    throw new Error(
      `downloaded archive sha256 mismatch: ${archiveSha256} != ${platform.archiveSha256}`
    );
  }
  const artifact = gunzipSync(archive);
  const actualSha256 = createHash("sha256").update(artifact).digest("hex");
  if (actualSha256 !== input.expectedSha256) {
    throw new Error(
      `downloaded artifact sha256 mismatch: ${actualSha256} != ${input.expectedSha256}`
    );
  }
}

function assertBootstrapOutput(input) {
  for (const expected of [
    "Starting OpenMeld...",
    `Downloading OpenMeld (about ${input.expectedDownloadSizeMb} MB)...`,
    "OpenMeld binary install smoke complete.",
    `managedBinary=${input.managedBinaryPath}`,
  ]) {
    if (!input.output.includes(expected)) {
      throw new Error(`setup bootstrap output is missing: ${expected}`);
    }
  }
  if (input.output.includes("[bun] Warning")) {
    throw new Error(
      `setup bootstrap output included a Bun warning:\n${input.output}`
    );
  }
}

function assertRepeatedBootstrapOutput(input) {
  for (const expected of [
    "Starting OpenMeld...",
    "OpenMeld binary install smoke complete.",
    `managedBinary=${input.managedBinaryPath}`,
  ]) {
    if (!input.output.includes(expected)) {
      throw new Error(
        `repeated setup bootstrap output is missing: ${expected}`
      );
    }
  }
  if (input.output.includes("Downloading OpenMeld (about")) {
    throw new Error(
      `repeated setup downloaded the already-installed binary:\n${input.output}`
    );
  }
}

function assertGeneratedProductionBinaryBootstrap(input) {
  process.stdout.write(
    "[cli:binary:prod-smoke] generated production binary bootstrap contract smoke\n"
  );
  for (const expected of [
    "OPENMELD_SETUP_ENV_PRESET='prod'",
    "OPENMELD_SETUP_USER_FACING_COMMAND='openmeld'",
    "OPENMELD_SETUP_DISTRIBUTION='binary'",
    `OPENMELD_SETUP_BINARY_MANIFEST_URL='${input.manifestUrl}'`,
    `OPENMELD_SETUP_OPENMELD_HOME='${input.openMeldHome}'`,
    "curl -fL --progress-bar",
    'run_clean_openmeld_env "$OPENMELD_SETUP_BINARY_PATH" install-self',
    'run_interactive_openmeld_cli "$OPENMELD_SETUP_BINARY_COMMAND" "$@"',
  ]) {
    if (!input.script.includes(expected)) {
      throw new Error(`generated bootstrap script is missing: ${expected}`);
    }
  }
}

async function startBinaryManifestServer(input) {
  const artifact = await readFile(input.artifactPath);
  const archive = gzipSync(artifact, { level: 9 });
  const archiveSha256 = createHash("sha256").update(archive).digest("hex");
  const manifest = JSON.stringify(
    {
      schemaVersion: 1,
      channels: {
        stable: {
          version: input.built.version,
          minRequiredCliVersion: input.built.version,
          platforms: {
            [input.built.platform]: {
              url: "http://127.0.0.1:0/placeholder",
              sha256: input.built.sha256,
              sizeBytes: input.built.sizeBytes,
              archiveFormat: "gzip",
              archiveUrl: "http://127.0.0.1:0/archive-placeholder",
              archiveSha256,
              archiveSizeBytes: archive.byteLength,
            },
          },
        },
      },
    },
    null,
    2
  );

  let origin = "";
  const requestCounts = {
    archive: 0,
    authSignOut: 0,
    manifest: 0,
    raw: 0,
  };
  let setupScript = "";
  const server = createServer(async (request, response) => {
    if (request.url === "/setup") {
      response.writeHead(200, {
        "cache-control": "no-store",
        "content-type": "text/plain; charset=utf-8",
      });
      response.end(setupScript);
      return;
    }
    if (request.url === "/api/auth/one-time-token/verify") {
      await respondToValidatedJsonFixture({
        request,
        response,
        method: "POST",
        expectedPayload: { token: "fixture-account-a" },
        responseBody: FIXTURE_ACCOUNT_A_SESSION_RESPONSE,
        responseHeaders: {
          "set-auth-token": "fixture-access-token-a",
        },
      });
      return;
    }
    if (request.url === "/api/auth/device/token") {
      await respondToValidatedJsonFixture({
        request,
        response,
        method: "POST",
        parsePayload: (payload) =>
          betterAuthDeviceAuthorizationTokenRequestSchema.parse(payload),
        expectedPayload: {
          grant_type: "urn:ietf:params:oauth:grant-type:device_code",
          device_code: "fixture-device-code-b",
          client_id: "openmeld-cli",
        },
        responseBody: FIXTURE_DEVICE_TOKEN_RESPONSE,
      });
      return;
    }
    if (request.url === "/api/auth/get-session") {
      await respondToValidatedJsonFixture({
        request,
        response,
        method: "GET",
        expectedAuthorization: "Bearer fixture-access-token-b",
        responseBody: FIXTURE_ACCOUNT_B_SESSION_RESPONSE,
      });
      return;
    }
    if (request.url === "/api/auth/sign-out") {
      await respondToValidatedJsonFixture({
        request,
        response,
        method: "POST",
        expectedAuthorization: "Bearer fixture-access-token-b",
        expectedPayload: {},
        onValidated: () => {
          requestCounts.authSignOut += 1;
        },
        responseBody: { ok: true },
      });
      return;
    }
    if (request.url === "/v1/prepare/sessions/resolve-token") {
      await respondToValidatedJsonFixture({
        request,
        response,
        method: "POST",
        expectedPayload: { opaqueToken: "fixture-prepare-session" },
        responseBody: prepareSessionResponseSchema.parse({
          snapshot: buildPrepareSessionSnapshot(),
        }),
      });
      return;
    }
    if (request.url === "/cli/manifest.json") {
      requestCounts.manifest += 1;
      const body = manifest
        .replace(
          "http://127.0.0.1:0/placeholder",
          `${origin}/cli/download/${input.built.artifactName}`
        )
        .replace(
          "http://127.0.0.1:0/archive-placeholder",
          `${origin}/cli/download/${input.built.artifactName}.gz`
        );
      response.writeHead(200, {
        "cache-control": "no-store",
        "content-type": "application/json; charset=utf-8",
      });
      response.end(body);
      return;
    }
    if (request.url === `/cli/download/${input.built.artifactName}`) {
      requestCounts.raw += 1;
      response.writeHead(200, {
        "cache-control": "no-store",
        "content-length": String(artifact.length),
        "content-type": "application/octet-stream",
      });
      response.end(artifact);
      return;
    }
    if (request.url === `/cli/download/${input.built.artifactName}.gz`) {
      requestCounts.archive += 1;
      response.writeHead(200, {
        "cache-control": "no-store",
        "content-length": String(archive.length),
        "content-type": "application/gzip",
      });
      response.end(archive);
      return;
    }
    response.writeHead(404, { "content-type": "text/plain; charset=utf-8" });
    response.end("not found");
  });

  await new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolve);
  });
  const address = server.address();
  if (!address || typeof address === "string") {
    throw new Error("could not resolve smoke server address");
  }
  origin = `http://127.0.0.1:${address.port}`;
  return {
    archiveSizeBytes: archive.byteLength,
    origin,
    getRequestCounts: () => ({ ...requestCounts }),
    setSetupScript: (script) => {
      setupScript = script;
    },
    close: () =>
      new Promise((resolve, reject) => {
        server.close((error) => (error ? reject(error) : resolve()));
      }),
  };
}

async function respondToValidatedJsonFixture(input) {
  try {
    if (input.request.method !== input.method) {
      throw new Error(
        `expected ${input.method}, received ${String(input.request.method)}`
      );
    }
    if (
      input.expectedAuthorization !== undefined &&
      input.request.headers.authorization !== input.expectedAuthorization
    ) {
      throw new Error("received an unexpected authorization header");
    }

    if (input.expectedPayload !== undefined) {
      const rawPayload = await readJsonRequestPayload(input.request);
      const parsedPayload = input.parsePayload
        ? input.parsePayload(rawPayload)
        : rawPayload;
      if (
        JSON.stringify(parsedPayload) !== JSON.stringify(input.expectedPayload)
      ) {
        throw new Error(
          `received an unexpected request payload: ${JSON.stringify(parsedPayload)}`
        );
      }
    }

    input.onValidated?.();
    input.response.writeHead(200, {
      "content-type": "application/json; charset=utf-8",
      ...input.responseHeaders,
    });
    input.response.end(JSON.stringify(input.responseBody));
  } catch (error) {
    input.response.writeHead(400, {
      "content-type": "text/plain; charset=utf-8",
    });
    input.response.end(
      `fixture contract mismatch: ${error instanceof Error ? error.message : String(error)}`
    );
  }
}

async function readJsonRequestPayload(request) {
  let body = "";
  request.setEncoding("utf8");
  for await (const chunk of request) {
    body += chunk;
  }
  return JSON.parse(body);
}

function buildPrepareSessionSnapshot() {
  const now = "2026-08-31T00:00:00.000Z";
  return {
    prepareSessionId: "fixture-prepare-session",
    ownerUserId: "fixture-user-b",
    humanProfileId: "22222222-2222-4222-8222-222222222222",
    deviceId: "fixture-device",
    runtimeLane: "prod",
    targetSpaceId: null,
    sessionRevision: 1,
    lifecycleStatus: "active",
    phase: "reporting_runtime",
    steps: [
      "computer",
      "connect_terminal",
      "choose_local_agents",
      "prepare_selected_agents",
      "refresh_service",
      "report_runtime",
      "verify_setup",
      "ready",
    ].map((id) => ({
      id,
      state: "pending",
      title: id,
      summary: id,
      blockerReasonCode: null,
      startedAt: null,
      completedAt: null,
      updatedAt: now,
    })),
    localAgentCatalog: null,
    localReadinessSnapshot: null,
    selectedLocalAgentIds: [],
    terminalConnection: {
      status: "connected",
      connectionId: "fixture-terminal",
      connectionEpoch: 1,
      connectedAt: now,
      lastSeenAt: now,
      disconnectedAt: null,
      disconnectReason: null,
    },
    blockers: [],
    diagnosticCorrelationId: "prepare:fixture-prepare-session",
    createdAt: now,
    updatedAt: now,
    completedAt: null,
    expiresAt: "2099-08-31T00:30:00.000Z",
  };
}

main().catch((error) => {
  process.stderr.write(
    `${error instanceof Error ? error.message : String(error)}\n`
  );
  process.exitCode = 1;
});
