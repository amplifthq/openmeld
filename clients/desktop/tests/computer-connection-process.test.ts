import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  createComputerConnection,
  createComputerDisconnection,
  runConnectionSetup,
} from "../src/main/computer-connection";

describe("computer setup process outcome", () => {
  it("waits for current work before issuing expiring Prepare authorization", async () => {
    const home = await mkdtemp(join(tmpdir(), "desktop-update-wait-"));
    const marker = join(home, "drained");
    const bin = join(home, "openmeld");
    let prepareRequests = 0;
    let waitingObserved = false;
    try {
      await writeFile(
        bin,
        `#!${process.execPath}
const fs = require('node:fs');
if (process.argv.includes('--help')) process.exit(0);
if (process.argv.includes('connection-review')) {
  console.log(JSON.stringify({protocol:'computer-connection-v1',previousSessionIdentity:'reviewed-session',account:{id:'account-a',email:null},existingConnection:{deviceId:'device-a',runtimeLane:'dev-local'}}));
} else if (process.argv.includes('wait-for-update')) {
  fs.watch(${JSON.stringify(home)}, () => {
    if (!fs.existsSync(${JSON.stringify(marker)})) return;
    console.log(JSON.stringify({type:'line',code:'computer.update_ready',message:'Computer connection can continue.'}));
    process.exit(0);
  });
  console.log(JSON.stringify({type:'line',code:'setup.openmeld_tools_update.waiting',message:'Current tasks are still running.',data:{phase:'waiting_for_current_work',state:'active'}}));
} else process.exit(2);
`,
        { mode: 0o700 }
      );
      const connect = createComputerConnection({
        auth: {
          session: async () => ({
            user: { id: "account-a", email: "a@example.test", name: "Test" },
          }),
          cloudRequest: async () => {
            prepareRequests += 1;
            expect(waitingObserved).toBe(true);
            expect(await readFile(marker, "utf8")).toBe("drained");
            throw new Error("Fresh Prepare requested after drain");
          },
        },
        commandDeps: {
          openMeldBin: bin,
          env: {
            ...process.env,
            OPENMELD_HOME: home,
            OPENMELD_AUTH_URL: "http://lane.localhost:8788",
            OPENMELD_GATEWAY_URL: "http://lane.localhost:8080",
          },
        },
        webOrigin: "http://lane.localhost:3000",
        webBuild: "build",
        installed: false,
        ensureCompatible: async () => undefined,
        confirmSwitch: async () => false,
        onProgress: async (event) => {
          if (event.phase !== "waiting_for_current_work") {
            return;
          }
          expect(prepareRequests).toBe(0);
          waitingObserved = true;
          await writeFile(marker, "drained");
        },
      });
      await expect(
        connect({ expectedAccount: "account-a", resetThisComputer: true })
      ).rejects.toThrow("Fresh Prepare requested after drain");
      expect(prepareRequests).toBe(1);
    } finally {
      await rm(home, { recursive: true, force: true });
    }
  });
  it.each([
    {
      event: "computer.disconnected",
      type: "line",
      exit: 0,
      status: "disconnected",
    },
    {
      event: "computer.disconnected",
      type: "line",
      exit: 1,
      status: "unconfirmed",
    },
    {
      event: "computer.disconnect.started",
      type: "line",
      exit: 0,
      status: "unconfirmed",
    },
    {
      event: "computer.disconnected",
      type: "error",
      exit: 0,
      status: "unconfirmed",
    },
    {
      event: "service.account_admission.stop_refused",
      type: "error",
      exit: 1,
      status: "failed",
    },
    {
      event: "service.account_admission.stop_unconfirmed",
      type: "error",
      exit: 1,
      status: "unconfirmed",
    },
    {
      event: "service.account_admission.ownership_changed",
      type: "error",
      exit: 1,
      status: "unconfirmed",
    },
    {
      event: "service.account_admission.account_changed",
      type: "error",
      exit: 1,
      status: "connection_changed",
    },
  ])("reports Disconnect from real CLI evidence: $event / $type / $exit", async ({
    event,
    type,
    exit,
    status,
  }) => {
    const home = await mkdtemp(join(tmpdir(), "desktop-disconnect-test-"));
    const bin = join(home, "openmeld");
    let diagnosticsPath: string | undefined;
    try {
      await writeFile(
        bin,
        `#!${process.execPath}
if (process.argv.includes('connection-review')) {
  console.log(JSON.stringify({protocol:'computer-connection-v1',previousSessionIdentity:'reviewed-session',account:{id:'account-a',email:null},existingConnection:{deviceId:'device-a',runtimeLane:'dev-local'}}));
} else {
  const intent = JSON.parse(process.argv[process.argv.indexOf('--connection-intent') + 1]);
  if (intent.expectedAccount !== 'account-a' || intent.previousSessionIdentity !== 'reviewed-session') process.exit(2);
  console.log(JSON.stringify(${JSON.stringify({ type, code: event, message: "Operation evidence. Authorization: Bearer private-test-token" })}));
  process.exit(${exit});
}
`,
        { mode: 0o700 }
      );
      const phases: string[] = [];
      const disconnect = createComputerDisconnection({
        auth: {
          session: async () => ({
            user: {
              id: "account-a",
              email: "a@example.com",
              name: "Test account",
            },
          }),
        },
        commandDeps: {
          openMeldBin: bin,
          env: {
            ...process.env,
            OPENMELD_HOME: home,
            OPENMELD_AUTH_URL: "http://lane.localhost:8788",
            OPENMELD_GATEWAY_URL: "http://lane.localhost:8080",
          },
        },
        confirmDisconnect: async () => true,
        onPhase: (phase) => {
          phases.push(phase);
        },
      });
      const result = await disconnect({
        expectedAccount: "account-a",
        expectedConnection: { deviceId: "device-a", runtimeLane: "dev-local" },
      });
      expect(result.status).toBe(status);
      expect(phases).toEqual([
        "checking",
        "waiting_for_confirmation",
        "disconnecting",
      ]);
      expect(JSON.stringify(result)).not.toContain("private-test-token");
      if ("diagnosticsPath" in result) {
        diagnosticsPath = result.diagnosticsPath;
        expect(diagnosticsPath).toBeTruthy();
        const diagnostic = await readFile(diagnosticsPath as string, "utf8");
        expect(diagnostic).toContain(event);
        expect(diagnostic).not.toContain("private-test-token");
      }
    } finally {
      await rm(home, { recursive: true, force: true });
      if (diagnosticsPath) {
        await rm(dirname(diagnosticsPath), { recursive: true, force: true });
      }
    }
  });
  it.each([
    "rejects",
    "pending",
  ])("keeps completion authoritative when the progress observer %s", async (observer) => {
    const result = runConnectionSetup(
      process.execPath,
      [
        "-e",
        `
      console.log(JSON.stringify({type:'line',code:'prepare.session.progress.refresh_service',text:'Starting Service',data:{state:'started'}}));
      console.log(JSON.stringify({type:'result',code:'setup.complete'}));
    `,
      ],
      { ...process.env, OPENMELD_HOME: "/unused-disposable-process-test" },
      {
        onProgress: () =>
          observer === "rejects"
            ? Promise.reject(new Error("Observer failed"))
            : new Promise(() => undefined),
      }
    );
    await expect(result).resolves.toBeUndefined();
  });
  it("continues reading later output while a progress subscriber remains pending", async () => {
    const home = await mkdtemp(join(tmpdir(), "desktop-progress-test-"));
    const marker = join(home, "continue");
    try {
      await expect(
        runConnectionSetup(
          process.execPath,
          [
            "-e",
            `
        const fs = require('node:fs');
        fs.watch(${JSON.stringify(home)}, () => {
          if (!fs.existsSync(${JSON.stringify(home)})) process.exit(1);
          if (!fs.existsSync(${JSON.stringify(marker)})) return;
          console.log(JSON.stringify({type:'result',code:'setup.complete'}));
          process.exit(0);
        });
        console.log(JSON.stringify({type:'line',code:'prepare.session.progress.refresh_service',text:'Starting Service',data:{state:'started'}}));
      `,
          ],
          { ...process.env, OPENMELD_HOME: home },
          {
            onProgress: async () => {
              await writeFile(marker, "continue");
              await new Promise(() => undefined);
            },
          }
        )
      ).resolves.toBeUndefined();
    } finally {
      await rm(home, { recursive: true, force: true });
    }
  });

  it("parses structured rollback recovery without turning restoration into setup success", async () => {
    const home = await mkdtemp(join(tmpdir(), "desktop-recovery-test-"));
    const marker = join(home, "continue");
    let diagnosticDirectory: string | undefined;
    try {
      const progress: Array<{ code: string; phase?: string; state?: string }> =
        [];
      const result = runConnectionSetup(
        process.execPath,
        [
          "-e",
          `
		const fs = require('node:fs');
		fs.watch(${JSON.stringify(home)}, () => {
			if (!fs.existsSync(${JSON.stringify(marker)})) return;
			console.log(JSON.stringify({type:'line',code:'setup.computer_handoff_recovery.completed',text:'Restored the previous computer connection.',data:{phase:'restoring',state:'completed'}}));
			console.log(JSON.stringify({type:'error',code:'setup.failed',message:'The account switch failed.',data:{state:'failed'}}));
			process.exit(1);
		});
		console.log(JSON.stringify({type:'line',code:'setup.computer_handoff_recovery.started',text:'Restoring the previous computer connection.',data:{phase:'restoring',state:'active'}}));
	`,
        ],
        { ...process.env, OPENMELD_HOME: home },
        {
          onProgress: async (event) => {
            progress.push(event);
            if (event.code === "setup.computer_handoff_recovery.started") {
              await writeFile(marker, "continue");
            }
          },
        }
      );
      const error = await result.catch(
        (failure: Error & { diagnosticsPath: string }) => failure
      );
      expect(progress).toContainEqual(
        expect.objectContaining({
          code: "setup.computer_handoff_recovery.started",
          phase: "restoring",
          state: "active",
        })
      );
      expect(error).toMatchObject({ message: "The account switch failed." });
      if (error) {
        diagnosticDirectory = dirname(error.diagnosticsPath);
      }
    } finally {
      await rm(home, { recursive: true, force: true });
      if (diagnosticDirectory) {
        await rm(diagnosticDirectory, { recursive: true, force: true });
      }
    }
  });
  it.each([
    { code: 0, event: "setup.complete", succeeds: true },
    { code: 1, event: "setup.complete", succeeds: false },
    { code: 0, event: "setup.started", succeeds: false },
    { code: 0, event: "setup.complete", succeeds: true, compact: true },
  ])("requires successful exit and completion evidence: $code / $event", async ({
    code,
    event,
    succeeds,
    compact,
  }) => {
    const result = runConnectionSetup(
      process.execPath,
      [
        "-e",
        `console.log(JSON.stringify(${JSON.stringify(compact ? { t: "result", c: event } : { type: "result", code: event })}));process.exit(${code});`,
      ],
      { ...process.env, OPENMELD_HOME: "/unused-disposable-process-test" }
    );
    if (succeeds) {
      await expect(result).resolves.toBeUndefined();
    } else {
      const error = await result.catch(
        (failure: Error & { diagnosticsPath: string }) => failure
      );
      expect(error).toMatchObject({
        message: expect.stringContaining("could not finish connecting"),
      });
      if (error) {
        await rm(dirname(error.diagnosticsPath), {
          recursive: true,
          force: true,
        });
      }
    }
  });

  it("reports owner progress before exit and preserves a bounded redacted failure file", async () => {
    const home = await mkdtemp(join(tmpdir(), "desktop-connection-test-"));
    const marker = join(home, "continue");
    let diagnosticDirectory: string | undefined;
    try {
      const result = runConnectionSetup(
        process.execPath,
        [
          "-e",
          `
        const fs = require('node:fs');
        fs.watch(${JSON.stringify(home)}, () => {
          if (!fs.existsSync(${JSON.stringify(home)})) process.exit(1);
          if (!fs.existsSync(${JSON.stringify(marker)})) return;
          console.error('Native helper failed. Authorization: Bearer native-secret');
          console.log(JSON.stringify({type:'error',code:'prepare.auth.account_mismatch',message:'Account changed. Authorization: Bearer secret-token'}));
          process.exit(1);
        });
        console.log(JSON.stringify({type:'line',code:'prepare.session.progress.refresh_service',text:'Starting OpenMeld Service...',data:{state:'started'}}));
      `,
        ],
        { ...process.env, OPENMELD_HOME: home },
        {
          onProgress: async (event) => {
            if (event.code === "prepare.session.progress.refresh_service") {
              expect(event.message).toBe("Starting OpenMeld Service...");
              await writeFile(marker, "continue");
            }
          },
        }
      );
      const error = await result.catch(
        (failure: Error & { diagnosticsPath: string }) => failure
      );
      expect(error).toMatchObject({
        message: "Account changed. Authorization: Bearer [redacted]",
      });
      if (!error) {
        throw new Error("Expected setup failure");
      }
      diagnosticDirectory = dirname(error.diagnosticsPath);
      const diagnostic = await readFile(error.diagnosticsPath, "utf8");
      expect(diagnostic).toContain("prepare.auth.account_mismatch");
      expect(diagnostic).not.toContain("secret-token");
      expect(diagnostic).toContain(
        "Native helper failed. Authorization: Bearer [redacted]"
      );
      expect(diagnostic).not.toContain("native-secret");
      await expect(
        readFile(join(diagnosticDirectory, "setup.log"))
      ).rejects.toMatchObject({ code: "ENOENT" });
    } finally {
      await rm(home, { recursive: true, force: true });
      if (diagnosticDirectory) {
        await rm(diagnosticDirectory, { recursive: true, force: true });
      }
    }
  });
});
