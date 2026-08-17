#!/usr/bin/env node

import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { createServer } from "node:http";
import { tmpdir } from "node:os";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";
import { gunzipSync, gzipSync } from "node:zlib";
import { buildOpenMeldSetupBootstrapScript } from "../../clients/web/src/lib/setup-bootstrap-script.ts";
import {
  buildBunCompileArgs,
  buildCliBinary,
  SUPPORTED_CLI_BINARY_PLATFORMS,
} from "../release/build-cli-binary.mjs";

const SCRIPT_DIR = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(SCRIPT_DIR, "..", "..");
const INTERACTIVE_PROMPT_SMOKE_ENTRY = path.join(
  SCRIPT_DIR,
  "fixtures",
  "interactive-prompt-binary-smoke.ts"
);
const DISCLAIMER_PROMPT_SMOKE_ENTRY = path.join(
  SCRIPT_DIR,
  "fixtures",
  "disclaimer-prompt-binary-smoke.ts"
);
const SETUP_PROGRESS_PROMPT_SMOKE_ENTRY = path.join(
  REPO_ROOT,
  "clients",
  "openmeld-cli",
  "tests",
  "fixtures",
  "setup-progress-prompt-binary-smoke.ts"
);
const CANARY_LAUNCHD_LABEL = "com.openmeld.openmeld-background-service.canary";

async function main() {
  const tempRoot = await mkdtemp(
    path.join(tmpdir(), "openmeld-cli-binary-smoke-")
  );
  const openMeldHome = path.join(tempRoot, ".openmeld-dev");
  let server;
  try {
    const built = buildCliBinary({
      outDir: path.join(tempRoot, "dist"),
      platform: "darwin-arm64",
    });
    const installOutcome = runCommand({
      command: built.outFile,
      args: ["install-self", "--json"],
      env: buildSmokeEnv({ tempRoot, openMeldHome }),
      label: "install-self from the freshly built binary",
    });
    const parsedInstall = JSON.parse(installOutcome.stdout);
    const managedBinaryPath = String(parsedInstall.managedBinaryPath ?? "");
    if (!managedBinaryPath.startsWith(openMeldHome)) {
      throw new Error(
        `managed binary escaped OPENMELD_HOME: ${managedBinaryPath}`
      );
    }

    runCommand({
      command: managedBinaryPath,
      args: ["--version"],
      env: buildSmokeEnv({ tempRoot, openMeldHome }),
      expectedStdout: built.version,
      label: "managed binary version smoke",
    });
    runInteractivePromptBinarySmoke({ tempRoot });
    runSetupProgressPromptBinarySmoke({ tempRoot });
    runDisclaimerPromptBinarySmoke({ tempRoot, openMeldHome });
    await runBinaryServiceLifecycleSmoke({
      built,
      tempRoot,
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

    const script = buildOpenMeldSetupBootstrapScript({
      authUrl: "http://localhost:8788",
      binaryManifestUrl: manifestUrl,
      distribution: "binary",
      gatewayUrl: "http://localhost:8080",
      lane: "dev-local",
      openMeldHome,
    });
    assertGeneratedBinaryBootstrap({
      manifestUrl,
      script,
    });

    process.stdout.write(
      [
        "[cli:binary:smoke] ok",
        `- version: ${built.version}`,
        `- artifact: ${built.artifactName}`,
        `- sha256: ${built.sha256}`,
        `- sizeBytes: ${built.sizeBytes}`,
        `- openMeldHome: ${openMeldHome}`,
        `- manifestUrl: ${manifestUrl}`,
        "",
      ].join("\n")
    );
  } finally {
    await server?.close();
    await rm(tempRoot, { force: true, recursive: true });
  }
}

function buildSmokeEnv(input) {
  const preset = input.preset ?? "dev-local";
  const userFacingCommand = path.join(input.openMeldHome, "bin", "openmeld");
  const authUrl = input.authUrl ?? "http://localhost:8788";
  const gatewayUrl = input.gatewayUrl ?? "http://localhost:8080";
  return {
    ...process.env,
    HOME: input.tempRoot,
    OPENMELD_AUTH_FORCE_INSECURE_FILE_TOKEN: "1",
    OPENMELD_AUTH_URL: authUrl,
    OPENMELD_ENV_PRESET: preset,
    OPENMELD_GATEWAY_URL: gatewayUrl,
    OPENMELD_HOME: input.openMeldHome,
    OPENMELD_USER_FACING_CLI_COMMAND: userFacingCommand,
  };
}

function runCommand(input) {
  process.stdout.write(`[cli:binary:smoke] ${input.label}\n`);
  const result = spawnSync(input.command, input.args, {
    cwd: REPO_ROOT,
    encoding: "utf8",
    env: input.env,
    timeout: input.timeoutMs ?? 30_000,
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

async function runBinaryServiceLifecycleSmoke(input) {
  process.stdout.write(
    "[cli:binary:smoke] binary launchd service lifecycle smoke\n"
  );
  if (process.platform !== "darwin") {
    process.stdout.write(
      "[cli:binary:smoke] skipped launchd lifecycle smoke outside darwin\n"
    );
    return;
  }
  assertLaunchdLabelFree(CANARY_LAUNCHD_LABEL);

  const openMeldHome = path.join(input.tempRoot, ".openmeld-canary");
  const authBaseUrl = "http://127.0.0.1:9";
  const env = buildSmokeEnv({
    authUrl: authBaseUrl,
    preset: "canary",
    tempRoot: input.tempRoot,
    openMeldHome,
  });
  await writeSmokeAuthSession({
    accessToken: "openmeld-binary-smoke-token",
    authBaseUrl,
    clientId: "openmeld-cli-binary-smoke",
    openMeldHome,
  });

  const installOutcome = runCommand({
    command: input.built.outFile,
    args: ["install-self", "--json"],
    env,
    label: "install-self for canary service lifecycle smoke",
  });
  const managedBinaryPath = String(
    JSON.parse(installOutcome.stdout).managedBinaryPath ?? ""
  );
  if (!managedBinaryPath.startsWith(openMeldHome)) {
    throw new Error(
      `canary managed binary escaped OPENMELD_HOME: ${managedBinaryPath}`
    );
  }

  try {
    runCommand({
      command: managedBinaryPath,
      args: ["service", "install", "--view", "agent"],
      env,
      label: "install binary-backed canary OpenMeld Service",
      timeoutMs: 120_000,
    });
    runCommand({
      command: managedBinaryPath,
      args: ["service", "start", "--view", "agent"],
      env,
      label: "start binary-backed canary OpenMeld Service",
      timeoutMs: 120_000,
    });
    assertServiceStatusRunning({
      managedBinaryPath,
      env,
    });
  } finally {
    runCommandBestEffort({
      command: managedBinaryPath,
      args: ["service", "stop", "--view", "agent"],
      env,
      label: "stop binary-backed canary OpenMeld Service",
      timeoutMs: 60_000,
    });
    runCommandBestEffort({
      command: managedBinaryPath,
      args: ["service", "uninstall", "--view", "agent"],
      env,
      label: "uninstall binary-backed canary OpenMeld Service",
      timeoutMs: 60_000,
    });
  }
}

function runInteractivePromptBinarySmoke(input) {
  process.stdout.write(
    "[cli:binary:smoke] interactive prompt stdin=/dev/tty smoke\n"
  );
  if (process.platform !== "darwin") {
    process.stdout.write(
      "[cli:binary:smoke] skipped interactive prompt smoke outside darwin\n"
    );
    return;
  }
  const outFile = path.join(input.tempRoot, "interactive-prompt-smoke");
  const buildResult = spawnSync(
    "bun",
    buildBunCompileArgs({
      bunTarget: SUPPORTED_CLI_BINARY_PLATFORMS["darwin-arm64"],
      entry: INTERACTIVE_PROMPT_SMOKE_ENTRY,
      outFile,
    }),
    {
      cwd: REPO_ROOT,
      env: process.env,
      stdio: "inherit",
    }
  );
  if (buildResult.error) {
    throw buildResult.error;
  }
  if (buildResult.status !== 0) {
    throw new Error(
      `interactive prompt binary smoke build failed with exit ${buildResult.status}`
    );
  }

  const expectScript = [
    "set timeout 8",
    "set binary $env(OPENMELD_PROMPT_SMOKE_BINARY)",
    'spawn sh -c "$binary < /dev/tty"',
    "expect {",
    "  -re {Press `Enter` to continue\\.} {}",
    "  timeout { exit 3 }",
    "  eof { exit 4 }",
    "}",
    "after 150",
    'send "\\033\\[B"',
    "after 100",
    'send " "',
    "after 100",
    'send "\\r"',
    "expect {",
    '  -re {RESULT:\\{"status":"submitted","value":\\["claude-code","opencode"\\]\\}} { exit 0 }',
    "  timeout { exit 3 }",
    "  eof { exit 4 }",
    "}",
  ].join("\n");
  const result = spawnSync("expect", ["-c", expectScript], {
    cwd: REPO_ROOT,
    encoding: "utf8",
    env: {
      ...process.env,
      OPENMELD_PROMPT_SMOKE_BINARY: outFile,
    },
    timeout: 15_000,
  });
  if (result.error) {
    throw result.error;
  }
  if (result.status !== 0) {
    throw new Error(
      [
        `interactive prompt binary smoke failed with exit ${result.status}`,
        result.stdout,
        result.stderr,
      ].join("\n")
    );
  }
}

function runDisclaimerPromptBinarySmoke(input) {
  process.stdout.write(
    "[cli:binary:smoke] disclaimer prompt stdin=/dev/tty smoke\n"
  );
  if (process.platform !== "darwin") {
    process.stdout.write(
      "[cli:binary:smoke] skipped disclaimer prompt smoke outside darwin\n"
    );
    return;
  }
  const outFile = path.join(input.tempRoot, "disclaimer-prompt-smoke");
  const buildResult = spawnSync(
    "bun",
    buildBunCompileArgs({
      bunTarget: SUPPORTED_CLI_BINARY_PLATFORMS["darwin-arm64"],
      entry: DISCLAIMER_PROMPT_SMOKE_ENTRY,
      outFile,
    }),
    {
      cwd: REPO_ROOT,
      env: process.env,
      stdio: "inherit",
    }
  );
  if (buildResult.error) {
    throw buildResult.error;
  }
  if (buildResult.status !== 0) {
    throw new Error(
      `disclaimer prompt binary smoke build failed with exit ${buildResult.status}`
    );
  }

  const expectScript = [
    "set timeout 8",
    "set binary $env(OPENMELD_DISCLAIMER_SMOKE_BINARY)",
    'spawn sh -c "$binary < /dev/tty"',
    "expect {",
    "  -re {Do you accept and continue\\?} {}",
    "  timeout { exit 3 }",
    "  eof { exit 4 }",
    "}",
    "after 150",
    'send "\\r"',
    "expect {",
    '  -re {RESULT:\\{"accepted":true\\}} {}',
    "  timeout { exit 3 }",
    "  eof { exit 4 }",
    "}",
    "expect {",
    "  eof {}",
    "  timeout { exit 3 }",
    "}",
    "set waitStatus [wait]",
    "if {[lindex $waitStatus 3] != 0} { exit 5 }",
    "exit 0",
  ].join("\n");
  const result = spawnSync("expect", ["-c", expectScript], {
    cwd: REPO_ROOT,
    encoding: "utf8",
    env: {
      ...buildSmokeEnv(input),
      OPENMELD_DISCLAIMER_SMOKE_BINARY: outFile,
    },
    timeout: 15_000,
  });
  if (result.error) {
    throw result.error;
  }
  if (result.status !== 0) {
    throw new Error(
      [
        `disclaimer prompt binary smoke failed with exit ${result.status}`,
        result.stdout,
        result.stderr,
      ].join("\n")
    );
  }
}

function runSetupProgressPromptBinarySmoke(input) {
  process.stdout.write(
    "[cli:binary:smoke] setup progress + prompt PTY smoke\n"
  );
  if (process.platform !== "darwin") {
    process.stdout.write(
      "[cli:binary:smoke] skipped setup progress + prompt smoke outside darwin\n"
    );
    return;
  }
  const outFile = path.join(input.tempRoot, "setup-progress-prompt-smoke");
  const buildResult = spawnSync(
    "bun",
    buildBunCompileArgs({
      bunTarget: SUPPORTED_CLI_BINARY_PLATFORMS["darwin-arm64"],
      entry: SETUP_PROGRESS_PROMPT_SMOKE_ENTRY,
      outFile,
    }),
    {
      cwd: REPO_ROOT,
      env: process.env,
      stdio: "inherit",
    }
  );
  if (buildResult.error) {
    throw buildResult.error;
  }
  if (buildResult.status !== 0) {
    throw new Error(
      `setup progress prompt binary smoke build failed with exit ${buildResult.status}`
    );
  }

  runSetupProgressPromptExpect({
    expectScript: [
      "set timeout 8",
      "set binary $env(OPENMELD_SETUP_PROMPT_SMOKE_BINARY)",
      'spawn sh -c "$binary < /dev/tty"',
      "stty rows 40 columns 120",
      "expect {",
      "  -re {LINE:.*Preparing OpenMeld Service} {}",
      "  timeout { exit 3 }",
      "  eof { exit 4 }",
      "}",
      "expect {",
      "  -re {What do you want to do\\?} {}",
      "  timeout { exit 3 }",
      "  eof { exit 4 }",
      "}",
      'send "\\r"',
      "expect {",
      '  -re {RESULT:\\{"status":"selected","choice":"sign_in"\\}} {}',
      "  timeout { exit 3 }",
      "  eof { exit 4 }",
      "}",
      "expect eof",
      "set waitStatus [wait]",
      "if {[lindex $waitStatus 3] != 0} { exit 5 }",
      "exit 0",
    ].join("\n"),
    outFile,
    scenario: "selection",
  });
  runSetupProgressPromptExpect({
    expectScript: [
      "set timeout 8",
      "set binary $env(OPENMELD_SETUP_PROMPT_SMOKE_BINARY)",
      'spawn sh -c "$binary < /dev/tty"',
      "stty rows 40 columns 120",
      "expect {",
      "  -re {LINE:.*Preparing OpenMeld Service} {}",
      "  timeout { exit 3 }",
      "  eof { exit 4 }",
      "}",
      "expect {",
      "  -re {What do you want to do\\?} {}",
      "  timeout { exit 3 }",
      "  eof { exit 4 }",
      "}",
      'send "\\003"',
      "expect {",
      '  -re {RESULT:\\{"status":"cancelled"\\}} {}',
      "  timeout { exit 3 }",
      "  eof { exit 4 }",
      "}",
      "expect eof",
      "set waitStatus [wait]",
      "if {[lindex $waitStatus 3] != 0} { exit 5 }",
      "exit 0",
    ].join("\n"),
    outFile,
    scenario: "Ctrl+C cancellation",
  });
}

function runSetupProgressPromptExpect(input) {
  const result = spawnSync("expect", ["-c", input.expectScript], {
    cwd: REPO_ROOT,
    encoding: "utf8",
    env: {
      ...process.env,
      OPENMELD_SETUP_PROMPT_SMOKE_BINARY: input.outFile,
    },
    timeout: 15_000,
  });
  if (result.error) {
    throw result.error;
  }
  if (result.status !== 0) {
    throw new Error(
      [
        `setup progress prompt ${input.scenario} smoke failed with exit ${result.status}`,
        result.stdout,
        result.stderr,
      ].join("\n")
    );
  }
}

function assertLaunchdLabelFree(label) {
  const result = spawnSync("launchctl", [
    "print",
    `gui/${process.getuid()}/${label}`,
  ]);
  if (result.status === 0) {
    throw new Error(
      `${label} is already loaded; stop the existing canary OpenMeld Service before running cli:binary:smoke.`
    );
  }
}

function assertServiceStatusRunning(input) {
  const deadline = Date.now() + 60_000;
  let lastOutput = "";
  while (Date.now() < deadline) {
    const result = runCommand({
      command: input.managedBinaryPath,
      args: ["service", "status", "--json"],
      env: input.env,
      label: "poll binary-backed canary OpenMeld Service status",
      timeoutMs: 30_000,
    });
    lastOutput = result.stdout;
    const envelope = parseJsonEnvelope(result.stdout);
    const statusPayload = envelope?.payload ?? envelope;
    const runtimeStatus =
      statusPayload?.runtime?.status ??
      statusPayload?.localResult?.runtime?.status ??
      statusPayload?.result?.runtime?.status;
    const anomalyCodes = (
      statusPayload?.inventory?.anomalies ??
      statusPayload?.localResult?.inventory?.anomalies ??
      statusPayload?.result?.inventory?.anomalies ??
      []
    ).map((anomaly) => anomaly.code);
    if (
      anomalyCodes.includes("service_manager_path_drift") ||
      anomalyCodes.includes("runtime_bundle_mismatch") ||
      anomalyCodes.includes("bundle_strategy_legacy")
    ) {
      throw new Error(
        `binary service inventory reported blocking binary-shape anomalies: ${anomalyCodes.join(", ")}`
      );
    }
    if (runtimeStatus === "running") {
      return;
    }
    Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 1000);
  }
  throw new Error(
    `binary service did not report running before timeout:\n${lastOutput}`
  );
}

function parseJsonEnvelope(output) {
  for (const line of output.split("\n")) {
    const trimmed = line.trim();
    if (!(trimmed.startsWith("{") && trimmed.endsWith("}"))) {
      continue;
    }
    try {
      return JSON.parse(trimmed);
    } catch (error) {
      throw new Error(`failed to parse JSON envelope line: ${trimmed}`, {
        cause: error,
      });
    }
  }
  return null;
}

async function writeSmokeAuthSession(input) {
  const tokenKey = createHash("sha256")
    .update(
      `${input.clientId}\n${input.authBaseUrl}\n${path.resolve(input.openMeldHome)}`
    )
    .digest("hex");
  const authDir = path.join(input.openMeldHome, "auth");
  const tokenDir = path.join(authDir, "tokens");
  await mkdir(tokenDir, { recursive: true });
  await writeFile(
    path.join(tokenDir, `${tokenKey}.token`),
    `${input.accessToken}\n`,
    {
      encoding: "utf8",
      mode: 0o600,
    }
  );
  await writeFile(
    path.join(authDir, "session.json"),
    `${JSON.stringify(
      {
        v: 1,
        tokenRef: {
          provider: "insecure-file",
          key: tokenKey,
        },
        tokenType: "Bearer",
        authBaseUrl: input.authBaseUrl,
        clientId: input.clientId,
        createdAt: new Date().toISOString(),
        expiresAt: new Date(Date.now() + 30 * 60_000).toISOString(),
        user: {
          id: "usr_binary_smoke",
          email: "binary-smoke@openmeld.local",
          name: "Binary Smoke",
        },
      },
      null,
      2
    )}\n`,
    {
      encoding: "utf8",
      mode: 0o600,
    }
  );
}

function runCommandBestEffort(input) {
  try {
    runCommand(input);
  } catch (error) {
    process.stderr.write(
      `[cli:binary:smoke] ${input.label} failed during cleanup: ${
        error instanceof Error ? error.message : String(error)
      }\n`
    );
  }
}

async function verifyManifestDownload(input) {
  process.stdout.write(
    "[cli:binary:smoke] manifest and artifact download sha256 smoke\n"
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

function assertGeneratedBinaryBootstrap(input) {
  process.stdout.write(
    "[cli:binary:smoke] generated dev-local binary bootstrap contract smoke\n"
  );
  for (const expected of [
    "OPENMELD_SETUP_DISTRIBUTION='binary'",
    `OPENMELD_SETUP_BINARY_MANIFEST_URL='${input.manifestUrl}'`,
    "install-self",
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
          minRequiredCliVersion: "0.1.3",
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
  const server = createServer((request, response) => {
    if (request.url === "/cli/manifest.json") {
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
      response.writeHead(200, {
        "cache-control": "no-store",
        "content-length": String(artifact.length),
        "content-type": "application/octet-stream",
      });
      response.end(artifact);
      return;
    }
    if (request.url === `/cli/download/${input.built.artifactName}.gz`) {
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
    origin,
    close: () =>
      new Promise((resolve, reject) => {
        server.close((error) => (error ? reject(error) : resolve()));
      }),
  };
}

main().catch((error) => {
  process.stderr.write(
    `${error instanceof Error ? error.message : String(error)}\n`
  );
  process.exitCode = 1;
});
