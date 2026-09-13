import { spawn } from "node:child_process";
import { once } from "node:events";
import { createRequire } from "node:module";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { runServiceAccountControl } from "../src/commands/service-account-control";
import {
  clearAuthSession,
  getAuthSession,
  setAuthSession,
} from "../src/config/auth-session";
import { withAuthSessionTransitionMutationLock } from "../src/config/auth-session-transition-lock";
import { writeDaemonRuntimeLease } from "../src/config/daemon-runtime-lease";
import {
  readDaemonServiceContract,
  upsertDaemonServiceContract,
} from "../src/config/daemon-service-contract";
import { buildRequestAuthHeaders } from "../src/config/request-headers";
import {
  cancelServiceAccountAdmission,
  readServiceAccountAdmission,
  reserveServiceAccountAdmission,
} from "../src/config/service-account-admission";
import { createControlledShutdownCoordinator } from "../src/local-service/carrier/service-runner";
import {
  admitServiceAccountStop,
  resolveServiceAccountIdentity,
  runServiceAccountCarrier,
} from "../src/local-service/lifecycle/service-account-authorization";
import { CURRENT_PROCESS_START_IDENTITY } from "../src/system/process-identity";
import { withTempHome } from "./helpers/fs";

const children: ReturnType<typeof spawn>[] = [];
const require = createRequire(import.meta.url);
const vitestRequire = createRequire(require.resolve("vitest/package.json"));
const loader = join(
  vitestRequire.resolve("tsx/package.json"),
  "..",
  "dist",
  "loader.mjs"
);
const authModule = new URL("../src/config/auth-session.ts", import.meta.url)
  .href;
const lockModule = new URL(
  "../src/config/auth-session-transition-lock.ts",
  import.meta.url
).href;
const admissionModule = new URL(
  "../src/config/service-account-admission.ts",
  import.meta.url
).href;

async function signIn(account: string): Promise<void> {
  await setAuthSession({
    accessToken: `test-token-${account}`,
    authBaseUrl: "https://auth.openmeld.invalid",
    clientId: "openmeld-cli",
    user: { id: account },
  });
}

function launch(script: string) {
  const child = spawn(
    process.execPath,
    [
      "--import",
      loader,
      "--input-type=module",
      "--eval",
      `
    import { readServiceAdmissionSessionWithOwnership, withAdmittedServiceSession, getAuthSession } from ${JSON.stringify(authModule)};
    import { withAuthSessionTransitionMutationLock } from ${JSON.stringify(lockModule)};
    import { reserveServiceAccountAdmission, admitServiceAccountOperation } from ${JSON.stringify(admissionModule)};
    const identity = { accountId: 'A', authBaseUrl: 'https://auth.openmeld.invalid', clientId: 'openmeld-cli', gatewayUrl: 'https://gateway.openmeld.invalid', lane: 'dev-local', deviceId: 'test-device', contractGeneration: 1 };
    const reservation = await withAuthSessionTransitionMutationLock(async () => {
      const session = await readServiceAdmissionSessionWithOwnership();
      if (session.user.id !== identity.accountId) throw new Error('account-mismatch');
      return await reserveServiceAccountAdmission({ operation: 'start', identity });
    });
    console.log(JSON.stringify({ id: reservation.id }));
    process.stdin.once('data', async () => {
      try { ${script} } catch (error) { console.log(JSON.stringify({ error: error.code ?? error.message })); }
      process.stdin.destroy();
    });
  `,
    ],
    { env: process.env, stdio: ["pipe", "pipe", "pipe"] }
  );
  children.push(child);
  const lines: string[] = [];
  const waiters: ((line: string) => void)[] = [];
  let pending = "";
  child.stdout?.setEncoding("utf8");
  child.stdout?.on("data", (chunk: string) => {
    pending += chunk;
    let end = pending.indexOf("\n");
    while (end >= 0) {
      const line = pending.slice(0, end);
      pending = pending.slice(end + 1);
      const waiter = waiters.shift();
      if (waiter) {
        waiter(line);
      } else {
        lines.push(line);
      }
      end = pending.indexOf("\n");
    }
  });
  return {
    child,
    next: async () =>
      JSON.parse(
        lines.length
          ? (lines.shift() ?? "null")
          : await new Promise<string>((r) => waiters.push(r))
      ),
  };
}

describe("Service account admission across processes", () => {
  async function connectedService() {
    process.env.OPENMELD_AUTH_FORCE_INSECURE_FILE_TOKEN = "1";
    process.env.OPENMELD_ENV_PRESET = "dev-local";
    await signIn("A");
    const contract = await upsertDaemonServiceContract({
      daemonVersion: "0.3.203",
      bundleId: "test-service-bundle",
      desiredState: "stopped",
      serviceController: "legacy-detached",
      autoStart: false,
      gatewayUrl: "https://gateway.openmeld.invalid",
      ownerUserId: "A",
      deviceId: "test-device",
      connectedComputerId: "test-connected-computer",
      heartbeatMs: 25_000,
    });
    const session = await getAuthSession();
    if (!session) {
      throw new Error("fixture sign-in failed");
    }
    return { contract, session };
  }

  it("binds the actual startup carrier's request credentials after admission", async () => {
    await withTempHome(async () => {
      const { contract, session } = await connectedService();
      const identity = await resolveServiceAccountIdentity(session, contract);
      identity.contractGeneration += 1;
      const reservation = await withAuthSessionTransitionMutationLock(
        async () =>
          await reserveServiceAccountAdmission({ operation: "start", identity })
      );
      await upsertDaemonServiceContract({
        ...contract,
        desiredState: "background",
      });
      const admitted = Promise.withResolvers<void>();
      const proceed = Promise.withResolvers<void>();
      const result = runServiceAccountCarrier(reservation.id, async () => {
        admitted.resolve();
        await proceed.promise;
        return await buildRequestAuthHeaders({
          requestUrl: "https://gateway.openmeld.invalid/v1/test",
        });
      });
      await admitted.promise;
      await signIn("B");
      proceed.resolve();
      expect(await result).toEqual({ Authorization: "Bearer test-token-A" });
      expect((await getAuthSession())?.user?.id).toBe("B");
    });
  });

  it.each([
    "missing",
    "expired",
    "different_account",
  ])("refuses %s authentication before any Service effect", async (state) => {
    await withTempHome(async () => {
      const { contract } = await connectedService();
      if (state === "missing") {
        await clearAuthSession();
      }
      if (state === "different_account") {
        await signIn("B");
      }
      if (state === "expired") {
        await setAuthSession({
          accessToken: "expired-test-token",
          authBaseUrl: "https://auth.openmeld.invalid",
          clientId: "openmeld-cli",
          user: { id: "A" },
          expiresAt: new Date(Date.now() - 1000).toISOString(),
        });
      }
      await expect(
        runServiceAccountControl({ operation: "start", expectedAccount: "A" })
      ).rejects.toMatchObject({
        code:
          state === "different_account"
            ? "service.account_admission.account_mismatch"
            : "service.account_admission.authentication_required",
      });
      expect(await readDaemonServiceContract()).toEqual(contract);
      expect(await readServiceAccountAdmission()).toBeNull();
    });
  });

  it("releases auth protection when Stop is accepted while its real drain remains pending", async () => {
    await withTempHome(async () => {
      const { contract, session } = await connectedService();
      await writeDaemonRuntimeLease({
        schema: "openmeld-daemon-runtime-lease-v1",
        v: 1,
        generation: contract.generation,
        bundleId: contract.bundleId,
        pid: process.pid,
        mode: "background",
        startedAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
        heartbeatAt: null,
        serviceController: "legacy-detached",
        managedBySystemService: false,
      });
      const identity = await resolveServiceAccountIdentity(session, contract);
      const reservation = await withAuthSessionTransitionMutationLock(
        async () =>
          await reserveServiceAccountAdmission({
            operation: "stop",
            identity,
            target: {
              ownerPid: process.pid,
              ownerProcessStartedAt: CURRENT_PROCESS_START_IDENTITY,
            },
          })
      );
      let stopping = false;
      const coordinator = createControlledShutdownCoordinator({
        hasUndrainedWork: () => true,
        isStopRequested: () => stopping,
        markStopping: () => {
          stopping = true;
        },
      });
      const accepted = Promise.withResolvers<void>();
      coordinator.attachSession(() => undefined);
      let completed = false;
      const draining = coordinator
        .request({
          mode: "graceful",
          gracePeriodMs: 2000,
          onAdmission: async (commit) => {
            await admitServiceAccountStop({
              id: reservation.id,
              ownerUserId: "A",
              deviceId: contract.deviceId,
              contractGeneration: contract.generation,
              commit,
            });
            accepted.resolve();
          },
        })
        .then(() => {
          completed = true;
        });
      await accepted.promise;
      await signIn("B");
      expect(completed).toBe(false);
      expect((await readServiceAccountAdmission())?.state).toBe("admitted");
      coordinator.handleSessionCompleted();
      await draining;
      expect(stopping).toBe(true);
      expect((await getAuthSession())?.user?.id).toBe("B");
    });
  });
  afterEach(async () => {
    for (const child of children.splice(0)) {
      if (child.exitCode === null && child.signalCode === null) {
        const exited = once(child, "exit");
        child.kill("SIGKILL");
        await exited;
      }
    }
  });

  it("holds real credential writers before admission, then preserves A after B signs in", async () => {
    await withTempHome(async () => {
      process.env.OPENMELD_AUTH_FORCE_INSECURE_FILE_TOKEN = "1";
      await signIn("A");
      const carrier = launch(`
        const session = await withAuthSessionTransitionMutationLock(async () => {
          const session = await readServiceAdmissionSessionWithOwnership();
          await admitServiceAccountOperation({ id: reservation.id, operation: 'start', identity });
          return session;
        });
        await withAdmittedServiceSession(session, async () => {
          console.log(JSON.stringify({ admitted: true }));
          await new Promise(resolve => process.stdin.once('data', resolve));
          console.log(JSON.stringify({ account: (await getAuthSession()).user.id }));
        });
      `);
      await carrier.next();
      await expect(signIn("B")).rejects.toMatchObject({
        code: "service.account_admission.busy",
      });
      await expect(clearAuthSession()).rejects.toMatchObject({
        code: "service.account_admission.busy",
      });
      expect((await getAuthSession())?.user?.id).toBe("A");
      carrier.child.stdin?.write("admit\n");
      expect(await carrier.next()).toEqual({ admitted: true });
      await signIn("B");
      carrier.child.stdin?.write("read\n");
      expect(await carrier.next()).toEqual({ account: "A" });
      expect((await getAuthSession())?.user?.id).toBe("B");
    });
  });

  it.each([
    "cancel",
    "owner_exit",
  ])("invalidates %s before a later credential write", async (mode) => {
    await withTempHome(async () => {
      process.env.OPENMELD_AUTH_FORCE_INSECURE_FILE_TOKEN = "1";
      await signIn("A");
      const carrier = launch(
        `await withAuthSessionTransitionMutationLock(async () => await admitServiceAccountOperation({ id: reservation.id, operation: 'start', identity })); console.log(JSON.stringify({ admitted: true }));`
      );
      const { id } = await carrier.next();
      if (mode === "cancel") {
        await cancelServiceAccountAdmission(id);
        await signIn("B");
        carrier.child.stdin?.write("late\n");
        expect(await carrier.next()).toEqual({
          error: "service.account_admission.cancelled",
        });
      } else {
        const exited = once(carrier.child, "exit");
        carrier.child.kill("SIGKILL");
        await exited;
        await signIn("B");
      }
      expect((await readServiceAccountAdmission())?.state).toBe("cancelled");
      expect((await getAuthSession())?.user?.id).toBe("B");
    });
  });
});
