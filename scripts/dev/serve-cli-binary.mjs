#!/usr/bin/env node

import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { readFile, stat } from "node:fs/promises";
import { createServer } from "node:http";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";
import { gzipSync } from "node:zlib";
import { buildCliBinary } from "../release/build-cli-binary.mjs";
import { buildCodeSignArgs } from "../release/macos-cli-signing.mjs";
import { readCurrentIsolatedDevLane } from "./dev-isolated-lane.mjs";

const SCRIPT_DIR = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(SCRIPT_DIR, "..", "..");
const DEFAULT_PORT = 3197;

async function main() {
  process.title = `node ${fileURLToPath(import.meta.url)}`;
  const port = readPort();
  const built = buildCliBinary({
    outDir: path.join(REPO_ROOT, "clients", "openmeld-cli", "dist", "binary"),
    platform: "darwin-arm64",
  });
  // Keychain recovery smoke must exercise the same signing identity across
  // managed CLI and stable Service copies. Ad-hoc builds remain the default.
  const signingIdentity = process.env.OPENMELD_CLI_BINARY_DEV_SIGNING_IDENTITY;
  if (signingIdentity) {
    execFileSync(
      "codesign",
      buildCodeSignArgs({
        entitlementsPath: path.join(
          REPO_ROOT,
          "scripts/release/macos-cli.entitlements.plist"
        ),
        identityHash: signingIdentity,
        outFile: built.outFile,
      }),
      { stdio: "inherit" }
    );
    execFileSync("codesign", ["--verify", "--strict", built.outFile], {
      stdio: "inherit",
    });
  }
  const artifact = await readFile(built.outFile);
  const actualSha256 = createHash("sha256").update(artifact).digest("hex");
  if (!signingIdentity && actualSha256 !== built.sha256) {
    throw new Error(
      `built artifact sha256 mismatch: ${actualSha256} != ${built.sha256}`
    );
  }
  built.sha256 = actualSha256;
  const artifactStats = await stat(built.outFile);
  const archive = gzipSync(artifact, { level: 9 });
  const archiveSha256 = createHash("sha256").update(archive).digest("hex");

  let origin = "";
  const server = createServer((request, response) => {
    if (request.url === "/cli/manifest.json") {
      response.writeHead(200, {
        "cache-control": "no-store",
        "content-type": "application/json; charset=utf-8",
        "x-content-type-options": "nosniff",
      });
      response.end(
        `${JSON.stringify(
          {
            schemaVersion: 1,
            channels: {
              stable: {
                version: built.version,
                minRequiredCliVersion: built.version,
                platforms: {
                  [built.platform]: {
                    url: `${origin}/cli/download/${built.artifactName}`,
                    sha256: built.sha256,
                    sizeBytes: artifactStats.size,
                    archiveFormat: "gzip",
                    archiveUrl: `${origin}/cli/download/${built.artifactName}.gz`,
                    archiveSha256,
                    archiveSizeBytes: archive.byteLength,
                  },
                },
              },
            },
          },
          null,
          2
        )}\n`
      );
      return;
    }

    if (request.url === `/cli/download/${built.artifactName}`) {
      response.writeHead(200, {
        "cache-control": "no-store",
        "content-disposition": `attachment; filename="${built.artifactName}"`,
        "content-length": String(artifact.length),
        "content-type": "application/octet-stream",
        "x-content-type-options": "nosniff",
      });
      response.end(artifact);
      return;
    }
    if (request.url === `/cli/download/${built.artifactName}.gz`) {
      response.writeHead(200, {
        "cache-control": "no-store",
        "content-disposition": `attachment; filename="${built.artifactName}.gz"`,
        "content-length": String(archive.length),
        "content-type": "application/gzip",
        "x-content-type-options": "nosniff",
      });
      response.end(archive);
      return;
    }

    response.writeHead(404, {
      "cache-control": "no-store",
      "content-type": "text/plain; charset=utf-8",
      "x-content-type-options": "nosniff",
    });
    response.end("not found");
  });

  await new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(port, "127.0.0.1", resolve);
  });
  const address = server.address();
  if (!address || typeof address === "string") {
    throw new Error("could not resolve CLI binary dev server address");
  }
  origin = `http://127.0.0.1:${address.port}`;

  process.stdout.write(
    [
      "[cli:binary:serve] OpenMeld CLI binary dev server is running.",
      `- version: ${built.version}`,
      `- artifact: ${built.artifactName}`,
      `- sha256: ${built.sha256}`,
      `- sizeBytes: ${artifactStats.size}`,
      `- archiveSizeBytes: ${archive.byteLength}`,
      `- manifestUrl: ${origin}/cli/manifest.json`,
      "",
      "Local dev-local setup uses this manifest URL by default. Start local Web with:",
      "pnpm dev:web",
      "",
      "If you changed OPENMELD_CLI_BINARY_DEV_PORT, start local Web with:",
      `VITE_OPENMELD_CLI_BINARY_MANIFEST_URL=${origin}/cli/manifest.json pnpm dev:web`,
      "",
    ].join("\n")
  );
}

function readPort() {
  if (process.argv.includes("--worktree")) {
    return readCurrentIsolatedDevLane(REPO_ROOT).ports.cliBinary;
  }
  const raw = process.env.OPENMELD_CLI_BINARY_DEV_PORT;
  if (!raw) {
    return DEFAULT_PORT;
  }
  const parsed = Number.parseInt(raw, 10);
  if (!Number.isInteger(parsed) || parsed < 1 || parsed > 65_535) {
    throw new Error(
      `OPENMELD_CLI_BINARY_DEV_PORT must be a TCP port, received ${raw}`
    );
  }
  return parsed;
}

main().catch((error) => {
  process.stderr.write(
    `${error instanceof Error ? error.message : String(error)}\n`
  );
  process.exitCode = 1;
});
