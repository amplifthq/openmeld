import { type ChildProcess, spawn } from "node:child_process";
import { randomUUID } from "node:crypto";
import { mkdtemp, readdir, rm } from "node:fs/promises";
import { createServer } from "node:http";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  beginAuthSessionTransition,
  buildStoredAuthSessionIdentity,
  getAuthSessionState,
  setAuthSession,
  withAdmittedServiceSession,
} from "../src/config/auth-session";
import { upsertDaemonServiceContract } from "../src/config/daemon-service-contract";
import { createExecutionHostClient } from "../src/local-service/execution-host/channel";
import { executionHostLaunchArguments } from "../src/local-service/execution-host/launch";
import { childExecutionHostChannel } from "../src/local-service/execution-host/process-channel";
import {
  CURRENT_PROCESS_START_IDENTITY,
  readProcessStartIdentity,
} from "../src/system/process-identity";

const require = createRequire(import.meta.url);
const loader = join(
  dirname(
    createRequire(require.resolve("vitest/package.json")).resolve(
      "tsx/package.json"
    )
  ),
  "dist/loader.mjs"
);
// Opt-in acceptance of the actual built package; default integration tests
// continue to use source and do not require a pre-existing dist directory.
const packaged = process.env.OPENMELD_TEST_HOST_ARTIFACT === "packaged";
const binary = process.env.OPENMELD_TEST_HOST_ARTIFACT === "binary";
const binaryPath = fileURLToPath(
  new URL(
    `../dist/binary/openmeld-cli-darwin-arm64-${(require("../package.json") as { version: string }).version}`,
    import.meta.url
  )
);
if (binary && (process.platform !== "darwin" || process.arch !== "arm64")) {
  throw new Error(
    "This compiled-artifact acceptance requires darwin-arm64; no other platform is implied."
  );
}
const entry = fileURLToPath(
  new URL(
    packaged ? "../dist/openmeld.js" : "../src/openmeld-entry.ts",
    import.meta.url
  )
);

describe("real execution Host entry", () => {
  let root: string;
  const children = new Set<ChildProcess>();
  const server = createServer((_request, response) =>
    response.writeHead(503).end()
  );
  let origin: string;
  beforeEach(async () => {
    root = await mkdtemp(join(tmpdir(), "openmeld-host-entry-"));
    await new Promise<void>((resolve) =>
      server.listen(0, "127.0.0.1", resolve)
    );
    const address = server.address();
    if (!address || typeof address === "string") {
      throw new Error("Fixture port missing");
    }
    origin = `http://127.0.0.1:${address.port}`;
    vi.stubEnv("HOME", root);
    vi.stubEnv("USERPROFILE", root);
    vi.stubEnv("OPENMELD_HOME", join(root, "state"));
    vi.stubEnv("OPENMELD_ENV_PRESET", "dev-local");
    vi.stubEnv("OPENMELD_GATEWAY_URL", origin);
    vi.stubEnv("OPENMELD_AUTH_URL", origin);
    vi.stubEnv("WEB_APP_URL", origin);
    // Disposable fake credentials only; never touches Keychain or a real token.
    vi.stubEnv("OPENMELD_AUTH_FORCE_INSECURE_FILE_TOKEN", "1");
  });
  afterEach(async () => {
    for (const child of children) {
      if (child.exitCode === null && child.signalCode === null) {
        const exited = new Promise<void>((resolve) =>
          child.once("exit", () => resolve())
        );
        child.kill("SIGKILL");
        await exited;
      }
    }
    children.clear();
    server.closeAllConnections();
    await new Promise<void>((resolve) => server.close(() => resolve()));
    vi.unstubAllEnvs();
    await rm(root, { recursive: true, force: true });
  });

  const start = (hostInstanceId: string, ipc = true) => {
    const child = spawn(
      binary ? binaryPath : process.execPath,
      executionHostLaunchArguments({
        binary,
        entry,
        execArgv: packaged ? [] : ["--import", loader],
        hostInstanceId,
      }),
      {
        env: { ...process.env, OPENMELD_DAEMON_RUNTIME_MODE: "background" },
        stdio: ipc
          ? ["ignore", "ignore", "pipe", "ipc"]
          : ["ignore", "ignore", "pipe"],
        serialization: "json",
        windowsHide: true,
      }
    );
    children.add(child);
    let stderr = "";
    child.stderr?.on("data", (chunk) => {
      stderr = (stderr + chunk.toString()).slice(-4096);
    });
    const exit = new Promise<number | null>((resolve, reject) => {
      child.once("exit", resolve);
      child.once("error", reject);
    });
    return { child, exit, stderr: () => stderr };
  };

  it("refuses direct public invocation before reading account or creating runtime state", async () => {
    const process = start(randomUUID(), false);
    expect(await process.exit).toBe(1);
    expect(process.stderr()).toContain("host.inherited_channel_required");
    expect(await readdir(root)).toEqual([]);
  });

  it.each([
    "none",
    "same-account",
    "other-account",
  ])("starts the real Host with empty inventory, preserving account transition=%s", async (transitionKind) => {
    await setAuthSession({
      accessToken: "fixture-old",
      authBaseUrl: origin,
      clientId: "fixture-client",
      user: { id: "old-account" },
    });
    const transition =
      transitionKind !== "none"
        ? await beginAuthSessionTransition({
            accessToken: "fixture-new",
            authBaseUrl: origin,
            clientId: "fixture-client",
            user: {
              id:
                transitionKind === "other-account"
                  ? "new-account"
                  : "old-account",
            },
          })
        : null;
    const candidate = (await getAuthSessionState()).session;
    if (!candidate?.user?.id) {
      throw new Error("Isolated fixture session missing");
    }
    // Match the Service runner: bind its startup login before reading the
    // identity that the separately launched Host independently verifies.
    const session = await withAdmittedServiceSession(
      candidate,
      async () => (await getAuthSessionState()).session
    );
    if (!session?.user?.id) {
      throw new Error("Admitted fixture session missing");
    }
    const contract = await upsertDaemonServiceContract({
      ownerUserId: session.user.id,
      deviceId: "fixture-device",
      connectedComputerId: "fixture-computer",
      gatewayUrl: origin,
      lane: "dev-local",
      daemonVersion: "0.0.0",
      bundleId: "fixture-bundle",
      desiredState: "background",
      serviceController: "legacy-detached",
      autoStart: false,
      heartbeatMs: 5000,
    });
    const instance = randomUUID();
    const running = start(instance);
    const client = createExecutionHostClient({
      channel: childExecutionHostChannel(running.child),
      hostInstanceId: instance,
    });
    try {
      const snapshot = await client.call("initialize", {
        ownerUserId: session.user.id,
        deviceId: contract.deviceId,
        lane: "dev-local",
        daemonSessionId: "fixture-session",
        serviceContractGeneration: contract.generation,
        sessionIdentity: buildStoredAuthSessionIdentity(session),
        stateRoot: join(root, "state"),
        authBaseUrl: origin,
        gatewayBaseUrl: origin,
        parentPid: process.pid,
        parentProcessStartedAt:
          readProcessStartIdentity(process.pid) ??
          CURRENT_PROCESS_START_IDENTITY,
      });
      expect(snapshot).toMatchObject({
        pid: running.child.pid,
        localQuiescent: true,
        activeCount: 0,
        pendingCount: 0,
      });
      await client.call("configureConnection", {
        executionAdmissionConfirmation: true,
        connectionGeneration: 1,
        catalogRevision: 0,
        leases: [],
      });
      await client.call("beginDrain", {});
      expect(await client.call("drain", {})).toMatchObject({
        localQuiescent: true,
        admission: "draining",
      });
      await client.call("stop", {}, { timeoutMs: null });
      running.child.disconnect();
      expect(await running.exit, running.stderr()).toBe(0);
      await transition?.commit();
      expect((await getAuthSessionState()).session?.user?.id).toBe(
        transitionKind === "other-account" ? "new-account" : "old-account"
      );
    } finally {
      client.dispose();
    }
  }, 20_000);
});
