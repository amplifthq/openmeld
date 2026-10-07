import { type ChildProcess, execFile, spawn } from "node:child_process";
import { createHash, randomUUID } from "node:crypto";
import {
  mkdir,
  mkdtemp,
  readFile,
  realpath,
  rm,
  stat,
  writeFile,
} from "node:fs/promises";
import { createServer } from "node:http";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { dirname, isAbsolute, join } from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import { spawnAgentControllerProcess } from "@openmeld/adapter-core";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import packageJson from "../package.json";
import {
  beginAuthSessionTransition,
  buildStoredAuthSessionIdentity,
  getAuthSessionState,
  setAuthSession,
  withAdmittedServiceSession,
} from "../src/config/auth-session";
import { upsertDaemonServiceContract } from "../src/config/daemon-service-contract";
import { installDaemon } from "../src/config/daemon-state";
import {
  requestLocalDaemonServiceUpdateReadiness,
  requestLocalDaemonShutdown,
} from "../src/local-service/control-plane/client";
import { createExecutionHostClient } from "../src/local-service/execution-host/channel";
import { executionHostLaunchArguments } from "../src/local-service/execution-host/launch";
import { childExecutionHostChannel } from "../src/local-service/execution-host/process-channel";
import { restoreDaemonActiveBundleStateSnapshot } from "../src/local-service/lifecycle/daemon-service-bundle";
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
const binaryPath = process.env.OPENMELD_TEST_HOST_BINARY ?? "";
const evidenceDir = process.env.OPENMELD_TEST_ARTIFACT_EVIDENCE;
if (binary && !(binaryPath && isAbsolute(binaryPath))) {
  throw new Error(
    "Compiled-artifact acceptance requires the exact absolute OPENMELD_TEST_HOST_BINARY path."
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
    vi.stubEnv("APPDATA", join(root, "AppData", "Roaming"));
    vi.stubEnv("LOCALAPPDATA", join(root, "AppData", "Local"));
    vi.stubEnv("XDG_DATA_HOME", join(root, "data"));
    vi.stubEnv("OPENMELD_HOME", join(root, "state"));
    vi.stubEnv("OPENMELD_ENV_PRESET", "dev-local");
    vi.stubEnv("OPENMELD_GATEWAY_URL", origin);
    vi.stubEnv("OPENMELD_AUTH_URL", origin);
    vi.stubEnv("WEB_APP_URL", origin);
    // Disposable fake credentials only; never touches Keychain or a real token.
    vi.stubEnv("OPENMELD_AUTH_FORCE_INSECURE_FILE_TOKEN", "1");
  });

  it.runIf(binary && process.platform === "win32")(
    "runs the actual Service and its Host with only Windows system tools on PATH",
    async () => {
      await setAuthSession({
        accessToken: "fixture-service-token",
        authBaseUrl: origin,
        clientId: "fixture-client",
        user: { id: "fixture-owner" },
      });
      const version = packageJson.version;
      const bundleId = "fixture-binary-bundle";
      await installDaemon({
        daemonVersion: version,
        source: "daemon.command.install",
      });
      await upsertDaemonServiceContract({
        ownerUserId: "fixture-owner",
        deviceId: "fixture-device",
        connectedComputerId: "fixture-computer",
        gatewayUrl: origin,
        lane: "dev-local",
        daemonVersion: version,
        bundleId,
        desiredState: "background",
        serviceController: "legacy-detached",
        autoStart: false,
        heartbeatMs: 5000,
      });
      // The installer is a later gate. Prepare its validated artifact receipt in
      // this disposable lane, then run the unmodified production Service command.
      const now = new Date().toISOString();
      await restoreDaemonActiveBundleStateSnapshot({
        v: 2,
        schema: "openmeld-daemon-active-bundle-v2",
        bundleId,
        daemonVersion: version,
        entryScriptRelativePath: "openmeld.exe",
        bundleFormat: "binary_v1",
        sourceEntryScriptPath: binaryPath,
        sourcePackageRootPath: dirname(binaryPath),
        sourceDistRootPath: dirname(binaryPath),
        sourceDistFingerprint: createHash("sha256")
          .update(
            JSON.stringify([
              createHash("sha256")
                .update(await readFile(binaryPath))
                .digest("hex"),
              createHash("sha256")
                .update(
                  await readFile(
                    join(dirname(binaryPath), "openmeld-windows-process.exe")
                  )
                )
                .digest("hex"),
            ])
          )
          .digest("hex"),
        sourceKind: "package_install",
        createdAt: now,
        updatedAt: now,
      });
      const systemRoot = process.env.SystemRoot ?? process.env.SYSTEMROOT;
      if (!systemRoot) {
        throw new Error("Windows system directory missing");
      }
      const env = Object.fromEntries(
        Object.entries(process.env).filter(
          ([key]) => key.toLowerCase() !== "path"
        )
      );
      env.Path = [
        join(systemRoot, "System32"),
        join(systemRoot, "System32", "WindowsPowerShell", "v1.0"),
      ].join(";");
      // Desktop admission must query this real GUI carrier, not infer support
      // from a version string or a Node executable. This command is read-only.
      const capability = await promisify(execFile)(
        binaryPath,
        ["service", "control-carrier-capability", "--json"],
        { cwd: root, env, windowsHide: true, timeout: 10_000 }
      );
      const capabilityResponse = JSON.parse(capability.stdout);
      expect(capabilityResponse).toEqual({
        protocol: "account-checked-service-control-v3",
        platform: "win32",
        executable: expect.any(String),
      });
      expect(await realpath(capabilityResponse.executable)).toBe(
        await realpath(binaryPath)
      );
      env.OPENMELD_DAEMON_RUNTIME_DETACHED = "1";
      env.OPENMELD_DAEMON_RUNTIME_SYSTEM_SERVICE = "1";
      // A fixture-owned Windows Job contains the Service and every descendant.
      // No process-name cleanup, task registration, or real account is involved.
      const taskLog = join(root, "service-task.log");
      const serviceArgs = [
        "service",
        "run",
        "--mode",
        "background",
        "--view",
        "agent",
      ];
      const taskAction = {
        executable: binaryPath,
        args: serviceArgs,
        env: { OPENMELD_HOME: env.OPENMELD_HOME },
        logPath: taskLog,
      };
      const owned = spawnAgentControllerProcess({
        bin: binaryPath,
        args: [
          ...serviceArgs,
          "--openmeld-windows-task",
          Buffer.from(JSON.stringify(taskAction)).toString("base64"),
        ],
        cwd: root,
        env,
        shell: false,
      });
      let output = "";
      owned.child.stdout.on("data", (chunk) => {
        output = (output + chunk.toString()).slice(-1024 * 1024);
      });
      owned.child.stderr.on("data", (chunk) => {
        output = (output + chunk.toString()).slice(-1024 * 1024);
      });
      const exited = new Promise<number | null>((resolve, reject) => {
        owned.child.once("close", resolve);
        owned.child.once("error", reject);
      });
      exited.catch(() => undefined);
      const failures: unknown[] = [];
      try {
        // This request reaches Service -> real Bun Host -> Service over inherited
        // IPC. A listening connector or a version string alone cannot satisfy it.
        await expect
          .poll(
            async () => {
              if (owned.child.exitCode !== null) {
                throw new Error(`Service exited: ${output}`);
              }
              return await requestLocalDaemonServiceUpdateReadiness({
                timeoutMs: 1000,
              });
            },
            { timeout: 20_000 }
          )
          .toEqual({
            acceptedWakeCount: 0,
            safeToSwitch: true,
            unacknowledgedResultCount: 0,
          });
        await requestLocalDaemonShutdown({
          payload: { mode: "graceful", gracePeriodMs: 5000 },
        });
        expect(await exited, output).toBe(0);
      } catch (error) {
        failures.push(error);
      } finally {
        output += await readFile(taskLog, "utf8").catch(() => "");
        if (evidenceDir) {
          try {
            await mkdir(evidenceDir, { recursive: true });
            await writeFile(join(evidenceDir, "service-artifact.log"), output);
          } catch (error) {
            failures.push(error);
          }
        }
        owned.terminate("SIGKILL");
        const cleanup = await owned.terminateRemainingDescendants();
        if (!cleanup.ok) {
          failures.push(cleanup.error);
        }
      }
      if (failures.length > 0) {
        throw new AggregateError(
          failures,
          `Native Service acceptance failed: ${output}`
        );
      }
    }
  );
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
    // The runtime/system tools may create AppData while loading an executable.
    // The product must still reject public Host invocation before lane state.
    await expect(stat(join(root, "state"))).rejects.toMatchObject({
      code: "ENOENT",
    });
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
