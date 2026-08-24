#!/usr/bin/env node

import { spawn } from "node:child_process";
import { randomUUID } from "node:crypto";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { createServer } from "node:http";
import { tmpdir } from "node:os";
import path from "node:path";
import process from "node:process";

const SMOKE_ACCESS_TOKEN = "openmeld-signed-secure-storage-smoke-token";
const SMOKE_OTT = "openmeld-signed-secure-storage-smoke-ott";

export async function smokeSignedMacOsSecureStorage(input) {
  if (input.platform !== "darwin-arm64") {
    throw new Error(
      `signed macOS secure storage smoke requires darwin-arm64, received ${input.platform}`
    );
  }

  const tempRoot = await mkdtemp(
    path.join(tmpdir(), "openmeld-signed-secure-storage-")
  );
  const openMeldHome = path.join(tempRoot, ".openmeld");
  const server = await startAuthFixture();
  const env = buildSmokeEnv({
    openMeldHome,
    outFile: input.outFile,
    serverOrigin: server.origin,
  });
  let loggedOut = false;
  try {
    const version = await runCli({
      args: ["--version"],
      command: input.outFile,
      env,
      label: "launch the signed CLI",
    });
    if (version.stdout.trim().length === 0) {
      throw new Error("signed CLI returned an empty version");
    }

    await runCli({
      args: [
        "login",
        "--view",
        "agent",
        "--ott",
        SMOKE_OTT,
        "--auth-url",
        server.origin,
        "--client-id",
        "openmeld-cli-signed-secure-storage-smoke",
      ],
      command: input.outFile,
      env,
      label: "save and reload an auth session with macOS secure storage",
    });

    const sessionPayload = JSON.parse(
      await readFile(path.join(openMeldHome, "auth", "session.json"), "utf8")
    );
    if (sessionPayload?.tokenRef?.provider !== "macos-keychain") {
      throw new Error(
        `signed CLI used the wrong macOS token provider: ${String(sessionPayload?.tokenRef?.provider ?? "missing")}`
      );
    }

    const status = await runCli({
      args: ["auth", "status", "--view", "agent"],
      command: input.outFile,
      env,
      label: "reload the saved auth session in a new CLI process",
    });
    if (
      !(
        status.stdout.includes('"signedIn":true') &&
        status.stdout.includes('"state":"valid"')
      )
    ) {
      throw new Error(
        `signed CLI could not reload the secure auth session:\n${status.stdout}\n${status.stderr}`
      );
    }

    await runCli({
      args: ["logout", "--view", "agent"],
      command: input.outFile,
      env,
      label: "delete the secure storage smoke session",
    });
    loggedOut = true;

    await smokeNoninteractiveProtectedKeychainRead({
      command: input.outFile,
      env,
      sessionPayload,
    });
  } finally {
    if (!loggedOut) {
      await runCli({
        args: ["logout", "--view", "agent"],
        command: input.outFile,
        env,
        label: "clean up the secure storage smoke session",
      }).catch((error) => {
        process.stderr.write(
          `[release:apple] secure storage smoke cleanup needs attention: ${error instanceof Error ? error.message : String(error)}\n`
        );
      });
    }
    await server.close();
    await rm(tempRoot, { force: true, recursive: true });
  }
}

async function smokeNoninteractiveProtectedKeychainRead(input) {
  const account = `openmeld-auth-noninteractive-${randomUUID()}`;
  const service = "sh.openmeld.auth.token";
  await runCli({
    args: [
      "add-generic-password",
      "-a",
      account,
      "-s",
      service,
      "-T",
      "/usr/bin/security",
      "-w",
      SMOKE_ACCESS_TOKEN,
    ],
    command: "/usr/bin/security",
    env: input.env,
    label: "create a protected Keychain item for the noninteractive read smoke",
  });

  try {
    await writeFile(
      path.join(input.env.OPENMELD_HOME, "auth", "session.json"),
      `${JSON.stringify({
        ...input.sessionPayload,
        tokenRef: {
          provider: "macos-keychain",
          service,
          account,
        },
      })}\n`,
      "utf8"
    );

    const status = await runCli({
      args: ["auth", "status", "--view", "agent"],
      allowedExitCodes: [1],
      command: input.command,
      env: input.env,
      label: "fail closed without a background Keychain authorization window",
      timeoutMs: 4000,
    });
    if (
      !(
        status.stdout.includes('"reasonCode":"session_token_unavailable"') &&
        status.stdout.includes(
          "OpenMeld did not open a background authorization window"
        )
      )
    ) {
      throw new Error(
        `signed CLI did not report the protected Keychain item clearly:\n${status.stdout}\n${status.stderr}`
      );
    }
  } finally {
    await runCli({
      args: ["delete-generic-password", "-a", account, "-s", service],
      command: "/usr/bin/security",
      env: input.env,
      label: "delete the protected Keychain smoke item",
    }).catch((error) => {
      process.stderr.write(
        `[release:apple] protected Keychain smoke cleanup needs attention: ${error instanceof Error ? error.message : String(error)}\n`
      );
    });
  }
}

function buildSmokeEnv(input) {
  return {
    ...Object.fromEntries(
      Object.entries(process.env).filter(
        ([key]) =>
          key !== "OPENMELD_AUTH_ALLOW_INSECURE_FILE_TOKEN" &&
          key !== "OPENMELD_AUTH_FORCE_INSECURE_FILE_TOKEN"
      )
    ),
    OPENMELD_ENV_PRESET: "prod",
    OPENMELD_GATEWAY_URL: input.serverOrigin,
    OPENMELD_HOME: input.openMeldHome,
    OPENMELD_USER_FACING_CLI_COMMAND: input.outFile,
  };
}

function runCli(input) {
  process.stdout.write(`[release:apple] ${input.label}\n`);
  return new Promise((resolve, reject) => {
    const child = spawn(input.command, input.args, {
      env: input.env,
      stdio: ["ignore", "pipe", "pipe"],
    });
    let stdout = "";
    let stderr = "";
    const timeoutMs = input.timeoutMs ?? 30_000;
    const timeout = setTimeout(() => {
      child.kill("SIGKILL");
      reject(new Error(`${input.label} timed out after ${timeoutMs} ms`));
    }, timeoutMs);
    child.stdout.setEncoding("utf8");
    child.stderr.setEncoding("utf8");
    child.stdout.on("data", (chunk) => {
      stdout += chunk;
    });
    child.stderr.on("data", (chunk) => {
      stderr += chunk;
    });
    child.on("error", (error) => {
      clearTimeout(timeout);
      reject(error);
    });
    child.on("close", (code, signal) => {
      clearTimeout(timeout);
      const allowedExitCodes = input.allowedExitCodes ?? [0];
      if (!(code !== null && allowedExitCodes.includes(code))) {
        const outcome = signal ? `signal ${signal}` : `exit ${String(code)}`;
        reject(
          new Error(
            `${input.label} failed with ${outcome}:\n${stdout}\n${stderr}`
          )
        );
        return;
      }
      resolve({ code, stderr, stdout });
    });
  });
}

async function startAuthFixture() {
  const server = createServer((request, response) => {
    if (
      request.method === "POST" &&
      request.url === "/api/auth/one-time-token/verify"
    ) {
      response.writeHead(200, {
        "content-type": "application/json",
        "set-auth-token": SMOKE_ACCESS_TOKEN,
      });
      response.end(
        JSON.stringify({
          session: {
            expiresAt: "2099-12-31T00:00:00.000Z",
            id: "signed-secure-storage-smoke-session",
          },
          user: {
            email: "secure-storage-smoke@openmeld.invalid",
            id: "signed-secure-storage-smoke-user",
            name: "Secure Storage Smoke",
          },
        })
      );
      return;
    }
    if (request.method === "GET" && request.url === "/api/auth/get-session") {
      response.writeHead(200, { "content-type": "application/json" });
      response.end(
        JSON.stringify({
          session: { id: "signed-secure-storage-smoke-session" },
          user: { id: "signed-secure-storage-smoke-user" },
        })
      );
      return;
    }
    response.writeHead(404, { "content-type": "application/json" });
    response.end(JSON.stringify({ message: "Not found" }));
  });
  await new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolve);
  });
  const address = server.address();
  if (!address || typeof address === "string") {
    server.close();
    throw new Error("could not resolve secure storage smoke server address");
  }
  return {
    close: () =>
      new Promise((resolve, reject) => {
        server.close((error) => (error ? reject(error) : resolve()));
      }),
    origin: `http://127.0.0.1:${address.port}`,
  };
}
