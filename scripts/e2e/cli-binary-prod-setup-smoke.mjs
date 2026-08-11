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
import { buildCliBinary } from "../release/build-cli-binary.mjs";

const SCRIPT_DIR = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(SCRIPT_DIR, "..", "..");
const BOOTSTRAP_HANDOFF_LINE =
  'run_openmeld "$@" || die "OpenMeld could not set up this computer. Fix the error above, then copy a fresh setup command from OpenMeld Web and run setup again."';
const OPENMELD_ENV_KEYS_TO_CLEAR = new Set([
  "OPENMELD_AUTH_URL",
  "OPENMELD_ENV_PRESET",
  "OPENMELD_GATEWAY_URL",
  "OPENMELD_HOME",
  "OPENMELD_SETUP_FOLLOW_UP_CLI_COMMAND",
  "OPENMELD_USER_FACING_CLI_COMMAND",
]);

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
      binaryManifestUrl: manifestUrl,
      distribution: "binary",
      lane: "prod",
      openMeldHome,
    });
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
    OPENMELD_ENV_PRESET: "prod",
    OPENMELD_HOME: input.openMeldHome,
    OPENMELD_USER_FACING_CLI_COMMAND: input.managedBinaryPath,
  };
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
  const requestCounts = { archive: 0, manifest: 0, raw: 0 };
  const server = createServer((request, response) => {
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
